"""Utilities for looking up information about IP addresses."""

__all__ = ["URL_MOZILLA_PSL", "URL_MAXMIND_GEOCITY",
           "IPTask", "IPInfo", "ASInfo", "GeoIPInfo",
           "GeoIPLookup", "PublicSuffixLookup", "IPResolver"]

import os, os.path, sys, re, yaml, adns, urllib2, GeoIP
from Overview.Debug import debug
from time import time, sleep
from yaml import CLoader as YAMLLoader
from yaml import CDumper as YAMLDumper
from cStringIO import StringIO
from gzip import GzipFile
from netaddr import *
from stat import *
from adns import rr

"""URL for the current public suffix list."""
URL_MOZILLA_PSL = 'http://mxr.mozilla.org/mozilla-central/source/netwerk/dns/effective_tld_names.dat?raw=1'

"""URL for the current MaxMind open-source GeoIP city database."""
URL_MAXMIND_GEOCITY = 'http://geolite.maxmind.com/download/geoip/database/GeoLiteCity.dat.gz'

"""Regular expression matching country code lookups from cymru.com."""
RX_ASN_CC = re.compile(r"(\d+) \| (\S+) \| (\S+) \| ([-\d]*)"
                       r" \| (\S*)([- ,]+(.*))?$")

"""Regular expression matching ASN lookups from cymru.com."""
RX_ASN = re.compile(r"(\d+) \| (\S+) \| (\S+) \| (\S+) \| (\d{4}-\d\d-\d\d)$")

def _adns_status_name_of(status):
  """Map ADNS status code to a name.."""
  if status == -1:
    return "cancelled"

  for name, value in adns.status.__dict__.iteritems():
    if value == status:
      return name

  return "unknown status"

# ------------------------------------------------------------
class IPTask:
  """Pending `IPResolver` operation."""
  def __init__(self, callback, maxtries, ongoing = False, tries = 0):
    """Constructor, initialises fields with specified values."""
    self.attrs = [False, ongoing, tries, maxtries, callback]

  @property
  def done(self):
    """Boolean, indicates if the task has been completed."""
    return self.attrs[0]

  @done.setter
  def done(self, value):
    self.attrs[0] = value

  @property
  def ongoing(self):
    """Boolean, indicates if the task has been started."""
    return self.attrs[1]

  @ongoing.setter
  def ongoing(self, value):
    self.attrs[1] = value

  @property
  def tries(self):
    """Number of attempts at the task so far."""
    return self.attrs[2]

  @tries.setter
  def tries(self, value):
    self.attrs[2] = value

  @property
  def maxtries(self):
    """Maximum number of times to attempt the task."""
    return self.attrs[3]

  @property
  def callback(self):
    """Function to call the execute the task."""
    return self.attrs[4]

  def __call__(self, *args, **kwargs):
    """Invoke the task callback."""
    return self.attrs[4](*args, **kwargs)

  def __repr__(self):
    return "IPTask(done=%s, ongoing=%s, tries=%s, max=%s, callback=%s)" % tuple(self.attrs)

# ------------------------------------------------------------
class HostInfo:
  """Host name summary information.

  hostname -- Original host name which was resolved.

  cnames -- Canonical forward looked up name(s), if any were found.
  This is dictionary of (name, alias list) for the names found, in
  a possibly recursive sequence of steps.

  addrs -- Forward looked up address(es), if any were found. This is
  a dictionary of (name, list) for responses to looking up addresses
  for `hostname` and all alternative `cnames` found (aka `all_names`).

  ipaddrs -- Flat dictionary of `IPInfo` results of reverse lookup
  results for all hosts listed in `addrs`.

  all_names -- All host names associated with this hosts.

  all_addrs -- All addresses associated with this hosts.
  """
  def __init__(self, hostname):
    self.hostname = hostname
    self.cnames = {}
    self.addrs = {}
    self.ipaddrs = {}
    self.all_names = set((hostname,))
    self.all_addrs = set()

  def __repr__(self):
    return "HostInfo(hostname=%s, names=%s, addrs=%s)" % \
      (self.hostname, self.all_names, self.all_addrs)

# ------------------------------------------------------------
class IPInfo:
  """IP address summary information.

  ip -- IPAddress object for the address.

  cidr -- IPNetwork object for the CIDR the address belongs to, either
  one of the autonomous system's CIDRs, or ip/32 if address could not
  be mapped to an AS. Note that AS may be composed of several CIDRs;
  `cidr` contains the one which associates the address to the AS.

  asn -- Reference to `ASInfo` object describing the ASN the IP
  address belongs to. If the address could not be mapped to any ASN
  this will point to a dummy empty object `IPResolver.NULL_ASN`.

  geoip -- Reference to GeoIPObject for the IP address location. This
  reference is always set, but may point to `GeoIPLookup.NULL_GEOIP`.

  domain -- Name of the domain the IP address belongs to. After full
  address resolution this will always be set, either to a string with
  the real or guessed domain name, or string "AS#nnnn (asn-org)".

  hostname -- Reverse looked up host name, if any was found.

  cidrhost -- Reverse looked up host name for CIDR base address.

  wildhost -- Reverse looked up name for a nearby IP address.

  hosts -- The `HostInfo` objects for forward lookup which originated
  the reverse lookup, if any exist. Note that multiple `HostInfo`
  may have translated into looking up the same `IPInfo`.
  """
  def __init__(self, ip):
    self.ip = ip
    self.cidr = IPNetwork(ip)
    self.asn = None
    self.geoip = None
    self.domain = None
    self.hostname = None
    self.cidrhost = None
    self.wildhost = None
    self.hosts = []

  def __repr__(self):
    return "IPInfo(ip=%s, cidr=%s)" % (self.ip, self.cidr)

# ------------------------------------------------------------
class ASInfo:
  """Information about the autonomous system an IP address belongs to.

  asn -- Autonomous system number as a string for real networks, the
  string "@addr/prefix" for reserved networks, or None if unknown.

  cc -- Two-letter uppercase country code. This is usually the country
  of the organisation, not of the IP address, and may be inaccurate or
  something vague like EU (Europe). In some cases it does not describe
  the country of the IP address very well. Prefer GeoIP information
  over this one.

  country -- Country name, based on `cc`.

  rir -- The Regional Internet Registry managing this ASN.

  org -- A label describing the organisation. This is usually some all
  uppercase and numbers and dashes word, which is suitable for showing
  an abberivated name for a network. However sometimes it's just the
  first word of the full organisation name, the rest is in `desc`.

  desc -- The rest of the description of the organisation owning the
  ASN. This is usually the name of the organisation. However sometimes
  it's actually all but the first word of the organisation's name, and
  `org` contains the rest.

  date -- Date of ASN registration. May be empty or None.
  """
  def __init__(self, asn = None, cc = None, rir = None,
               org = None, desc = None, date = None):
    self.asn = asn
    self.cc = cc
    self.country = GeoIP.country_names.get(cc, "")
    self.rir = rir
    self.org = org
    self.desc = desc
    self.date = date

# ------------------------------------------------------------
class GeoIPInfo:
  """Geographic information about an IP address.

  Some or all the fields may be None for unknown quantities.  There is
  no guarantee the region, city, longitude or latitude are known. The
  country, region and city names may include UTF-8 characters, however
  generally they appear to be the English names of the locations.

  cc -- Two-letter uppercase ISO country code.

  country -- The name of the country.

  continent -- Two-letter uppercase continent code.

  region -- The name of the region.

  city -- The name of the city.

  lat -- Latitude, degrees east as a floating point number.

  long -- Longitude, degrees north as a floating point number.
  """
  def __init__(self, cc = None, country = None, continent = None,
	       region = None, city = None, lat = None, long = None):
    self.cc = cc
    self.country = country
    self.continent = continent
    self.region = region
    self.city = city
    self.lat = lat
    self.long = long

# ------------------------------------------------------------
class GeoIPLookup:
  """Utility for GeoIP geographical IP address information look-ups."""
  NULL_GEOIP = GeoIPInfo() # Null info for use with failed lookups.

  def __init__(self, path = None, url = URL_MAXMIND_GEOCITY):
    """Constructor.

    Initialises GeoIP lookup. If necessary downloads `url` into local
    cache file `path`, by default "GeoLiteCity.dat".  The local file
    is refreshed if it doesn't exist or is more than 15 days old.

    @param path -- path for storing locally cached city database.

    @param url -- URL for the original MaxMind city database file.
    """
    self.path = path or "GeoLiteCity.dat"
    self.url = url
    self.reload()

  def reload(self):
    """Open GeoIP city database.

    Reloads the database from upstream database if there is no locally
    cached file, or the file is too old. Saves the cached data in
    uncompressed format, ready for opening. Opens the file for use.
    """
    if not os.path.exists(self.path) \
       or time() - os.stat(self.path)[ST_MTIME] >= 15 * 86400:
      debug("GEOIP", 1, "downloading new geoip database")
      newpath = self.path + ".new"
      newfile = open(newpath, "w")
      dbfile = urllib2.urlopen(self.url).read()
      newfile.write(GzipFile(fileobj = StringIO(dbfile)).read())
      newfile.close()
      if os.path.exists(self.path):
        os.remove(self.path)
      os.rename(newpath, self.path)

    debug("GEOIP", 1, "opening geoip database %s", self.path)
    self.gip = GeoIP.open(self.path, GeoIP.GEOIP_MEMORY_CACHE)
    self.gip.set_charset(GeoIP.GEOIP_CHARSET_UTF8)

  def lookup(self, ip):
    """Look up GeoIP city-level information by IP address.

    @param ip -- The IP address to look up.

    @return GeoIPInfo object describing the location. If no information
    is found, returns a reference to `NULL_GEOIP`.
    """
    rec = self.gip.record_by_addr(str(ip))
    if rec:
      return GeoIPInfo(cc = rec['country_code'],
                       country = rec['country_name'],
                       continent = GeoIP.country_continents[rec['country_code']],
                       region = rec['region_name'],
                       city = rec['city'],
                       lat = rec['latitude'],
                       long = rec['longitude'])
    else:
      return self.NULL_GEOIP

# ------------------------------------------------------------
class PublicSuffixLookup:
  """Utility for mapping host names to domains using the public suffix
  list to determine what part of the name is a domain.

  Automatically downloads the master suffix list from Mozilla's MXR
  and translates it to a YAML lookup table with punycoded names
  convenient for lookups with host names.

  See <http://publicsuffix.org/> for more about the public suffix
  list. It is or has been used among others by Mozilla, Chrome and
  Opera web browsers.

  See <http://blogs.msdn.com/b/ieinternals/archive/2009/09/19/
  private-domain-names-and-public-suffixes-in-internet-explorer.aspx>
  for the logic in Internet Explorer 8 handles and earlier for
  determining the domain name part.
  """
  def __init__(self, path = None, url = URL_MOZILLA_PSL):
    """Constructor.

    Initialises suffix lookup. If necessary downloads `url` into local
    cache file `path`, by default "psl.yml".  The local file is
    refreshed if it doesn't exist or is more than 15 days old.

    @param path -- path for storing locally cached YAML database.

    @param url -- URL for the original Mozilla MXR suffix list file.
    """
    self.path = path or "psl.yml"
    self.url = url
    self.psl = {}
    self.reload()

  def reload(self):
    """Read the public suffix list.

    Reloads the database from upstream database if there is no locally
    cached file, or the file is too old. Saves the cached data in YAML
    format, with punycoded names.  If the cache file exists and is
    valid, it is loaded as is.

    Please note that py2-yaml used for reading and writing YAML should
    have been built with libyaml for this to perform optimally.
    """
    if not os.path.exists(self.path) \
       or time() - os.stat(self.path)[ST_MTIME] >= 15 * 86400:
      debug("PSL", 1, "downloading fresh psl database")
      self._parse(urllib2.urlopen(self.url))
      newpath = self.path + ".new"
      newfile = open(newpath, "w")
      newfile.write(yaml.dump(self.psl, Dumper = YAMLDumper))
      newfile.close()
      if os.path.exists(self.path):
        os.remove(self.path)
      os.rename(newpath, self.path)
    else:
      debug("PSL", 1, "reading psl database %s", self.path)
      self.psl = yaml.load(open(self.path).read(), YAMLLoader)

  def _parse(self, file):
    """Convert public suffix list file to dictionary of dictionaries
    by reversed domain, with each domain component in punycode.

    @param file -- python file-like object to read from.

    @return none, updates `self.psl`.
    """
    self.psl = {}
    for line in file.readlines():
      line = line.decode("utf-8")
      line = re.sub(r"//.*", "", line)
      line = re.sub(r"\s.*", "", line)
      if len(line) > 0:
        exc = False
        if line[0] == "!":
          exc = True
          line = line[1:]

        parts = [(re.match(r"^[\x20-\x7e]+$", part) and part)
	         or "xn--%s" % part.encode("punycode")
	         for part in line.split(".")[::-1]]

        d = self.psl
        for i in xrange(len(parts)):
	  part = parts[i].encode("utf-8")
	  if i < len(parts)-1:
	    if part not in d or not isinstance(d[part], dict):
	      d[part] = {}
	    d = d[part]
	  else:
	    d[part] = exc

  def domain(self, hostname):
    """Translate host name to a domain name using the public suffix list.

    @param -- string, the host name to look up

    @return string with the domain portion of `hostname`.
    """
    dir = self.psl
    domain = []

    insuffix = True
    parts = hostname.split(".")[::-1]
    first = True
    while len(parts):
      debug("PSL", 3, "hostname %s domain %s parts %s insuffix %s dir %s",
            hostname, domain, parts, insuffix, (first and "{(all)}") or dir)
      part = parts.pop(0)
      if insuffix:
	domain.append(part)
      first = False
      if part in dir:
        if isinstance(dir[part], dict):
	  dir = dir[part]
        else:
	  insuffix = not dir[part]
          dir = {}
      elif "*" in dir:
	insuffix = not dir["*"]
        dir = {}
      else:
	break

    domname = ".".join(domain[::-1])
    debug("PSL", 2, "hostname %s mapped to domain %s", hostname, domname)
    return domname

# ------------------------------------------------------------
class IPResolver:
  """Utility for harvesting information about IP addresses.

  Resolves IP addresses to host names, domain names, autonomous systems
  and to coarse and fine-grained geographical location:

  - Addresses in IANA unavailable networks are mapped to a special form
    without issuing DNS queries.

  - Each IP address is reverse mapped to DNS host name, if available.

  - Each IP address is reverse mapped to the autonomous system (AS)
    number and network CIDR block (address/width) with routeviews.org
    and cymru.com DNS servers. If the AS information is found, it is
    further mapped to country code and the name of the organisation
    using cymru.com DNS servers.

  - Each IP address is reverse mapped to a geographical location -
    country, region, city, longitude and latitude - using the MaxMind
    open-source GeoIP city database.

  - If the domain name cannot be determined because direct reverse host
    name lookup on the IP address itself fails, a guess at the domain is
    made with reverse lookup on the CIDR block base address. If this
    also fails, nearby IP addresses are reverse lookup searched for
    possible domain names. This is heuristic and may yield inaccurate
    results in densely populated ISP address ranges, but usually is
    sufficiently close to be useful for website access analytics.

  - The principal host name, or if not found, the CIDR or scanned nearby
    address names are mapped to a domain name using the Mozilla public
    suffix list in order to eliminate uninteresting parts of the host
    name. If none of the reverse lookups yielded a name, the domain name
    is set to the ASN plus organisation label for the ASN.

  DNS queries are performed on the background, resolving possibly
  several thousand IP addresses in parallel. The initial AS and host
  reverse lookups are attempted a couple of times in case of a timeout
  and are normally given fairly liberal amount of time to complete.
  The CIDR and nearby address scans are performed with modest time
  windows to avoid excess waiting for answers which usually will not
  come; usually any matches found with these methods can be discovered
  in just a few seconds.

  The GeoIP and public suffix databases are cached somewhere locally,
  and automatically refetched if more than 15 days have passed since the
  last download.  The GeoIP file is stored uncompressed, ready for
  opening with GeoIP library calls, so some 30 MB is needed to keep it
  around. The public suffix list is stored as an uncompressed YAML file
  with punycode domain names. It is recommended to build py2-yaml with
  libyaml for better performance.

  The host and domain names are returned in punycode. The geographical
  information is UTF-8 encoded. Other text, e.g. ASN names, are ASCII.
  """

  # IANA reserved CIDR blocks.
  PRIVATE = IPSet([IPNetwork(i, implicit_prefix = True) for i in
                   "10/8", "172.16/12", "192.0.2/24",
                   "192.168/16", "239.192/14"])
  RESERVED = IPSet([IPNetwork(i, implicit_prefix = True) for i in
                    "0/8", "127/8", "169.254/16",
                    "225/8", "226/7", "228/6", "234/7",
                    "236/7", "238/8", "240/4"])
  UNAVAILABLE = PRIVATE | RESERVED

  # Null info for use with failed lookups.
  NULL_ASN = ASInfo()

  def __init__(self, cachedir = None,
               gip = None, psl = None, res = None,
               maxtime = 30, maxtries = 3):
    """Constructor.

    Initialises the lookup object so it is ready for queries.

    @param cachedir -- Default location for caching databases, used if
    `gip` or `psl` have not been specified. If unset and neither `gip`
    nor `psl` arguments are provided, the databases are cached in the
    current directory.

    @param gip -- Reference to GeoIPLookup object. If None, a new
    object is created, using `cachedir` or current directory as the
    location for the city database file.

    @param psl -- Reference to PublicSuffixLookup object. If None, a
    new object is created, using `cachedir` or current directory as
    the location for the YAML cache database.

    @param res -- Reference to adns DNS resolver object. If None, a
    new resolver is created. If you want to use a nameserver other
    than your system default one, pass in custom adns object created
    with the appropriate "nameserver x.y.z.w" resolver argument.

    @param maxtime -- The maximum time to wait for DNS replies. Some
    DNS servers are slow to respond so some queries take a long time
    to complete, or will simply time out. If the client is submitting
    large numbers of addresses for query, the stragglers are handled
    automatically and there is no reason to reduce the query time-out.
    However if the client has just a few addresses to resolve, or is
    in a hurry to get the answer, set `maxtime` to some smaller value.

    @param maxtries -- The maximum number of times to attempt main
    queries per IP address. In general this value should be greater
    than one to avoid failures resulting from dropped DNS packets and
    to catch straggler responses from slow, far away and somewhat
    misconfigured DNS servers. More than three rarely improves the
    accuracy of the results.
    """
    now = time()
    self.maxtime = maxtime
    self.maxtries = maxtries
    geopath = (cachedir and "%s/GeoLiteCity.dat" % cachedir)
    pslpath = (cachedir and "%s/psl.yml" % cachedir)
    self.res = res or adns.init(adns.iflags.noautosys)
    debug("IP2INFO", 2, "dns resolver initialised %.2f", time() - now)
    self.gip = gip or GeoIPLookup(path = geopath)
    debug("IP2INFO", 2, "geoip resolver initialised %.2f", time() - now)
    self.psl = psl or PublicSuffixLookup(path = pslpath)
    debug("IP2INFO", 2, "domain resolver initialised %.2f", time() - now)
    self.ptrfail = set()
    self.ptrmap = {}
    self.asnmap = self._asninit()
    self.queries = {}
    self.ipaddrs = {}
    self.notify = {}
    self.resstat = {}
    debug("IP2INFO", 1, "initialisation complete %.2f", time() - now)

  def _asninit(self):
    """Build initial AS lookup map with just unavailable networks."""
    asnmap = {}
    for cidr in self.UNAVAILABLE.iter_cidrs():
      asn = "@%s" % str(cidr)
      asnmap[asn] = ASInfo(asn = asn, cc = "--")
    return asnmap

  def _reserved(self, ip):
    """Check if an IP address is in any reserved CIDR block.

    @param ip -- IPAddress object for the IP address to look up.

    @return None if the address is not reserved, or IPNetwork object
    for the CIDR block that was reserved.
    """
    for cidr in self.UNAVAILABLE.iter_cidrs():
      if ip in cidr:
        return cidr

    return None

  def _issue(self):
    """Process task queue.

    Walks over all IP addresses and examines their pending task queue.
    Starts new tasks while there are IP addresses with queued tasks we
    can issue. Keeps issuing tasks as long as something can start.

    @return Number of pending tasks left.
    """
    debug("IP2INFO", 3, "issuing tasks for %d addresses", len(self.ipaddrs))
    now = time()
    npending = ntasks = 0
    done = False
    while not done:
      npending = 0
      ntasks = 0
      ncompleted = 0
      naborted = 0
      nongoing = 0
      nretried = 0

      for info, tasks in self.ipaddrs.values():
        # If this IP address has no more tasks, skip it.
        if len(tasks) == 0:
          continue

        # Count this address as pending tasks.
        ntasks += len(tasks)
        npending += 1
        task = tasks[0]

        # If the top task is done, reap it.
        if task.done:
          tasks.pop(0)
          ncompleted += 1
          continue

        # If the top task is till ongoing, don't disturb.
        if task.ongoing:
          nongoing += 1
          continue

        # Maybe start the top task.
        task.ongoing = True

        # If the task has already been attempted enough, give up.
        if task.tries >= task.maxtries:
          tasks.pop(0)
          naborted += 1

        # Try to run the task. If it says it's done, reap it.
        elif task(info, task, tasks):
          tasks.pop(0)
          ncompleted += 1

        # Otherwise we left the task running, move on.
        else:
          task.tries += 1
          nretried += 1

      # Report where we are. Keep going if we have no pending tasks at
      # all, or all of them are already ongoing.
      done = (npending == 0 or npending == nongoing)
      debug("IP2INFO", 3,
            "task status after %.3f s: %d pending, %d tasks, %d completed,"
            " %d aborted, %d ongoing, %d (re)tried, will %srepeat",
            time() - now, npending, ntasks, ncompleted, naborted, nongoing,
            nretried, (done and "not ") or "")

    # Report time spent issuing tasks.
    debug("IP2INFO", 2, "done issuing tasks in %.3f s, %d pending, %d tasks",
          time() - now, npending, ntasks)
    return npending

  def _timeout(self):
    """Cancel queries which have timed out after `self.maxtime`."""

    # Scan for queries which have been going on for too long.
    now = time()
    expired = []
    for q, info in self.queries.iteritems():
      if now > info[0] + self.maxtime:
        expired.append((q, info))

    # Now expire them. Call the callbacks so the tasks move on.
    debug("IP2INFO", 3, "cancelling %d timed out queries", len(expired))
    for q, info in expired:
      (created, callback, args) = info
      del self.queries[q]
      q.cancel()
      callback((-1, None, None, tuple()), *args)

  def _tick_stats(self, type):
    """Tick statistics by DNS answer type."""
    if type not in self.resstat:
      self.resstat[type] = 0
    self.resstat[type] += 1

  def _submit(self, addr, type, callback, *extra):
    """Submit a DNS query.
    @param addr -- the address to look up
    @param type -- request record type (adns.rr.*)
    @param callback -- function to call back if the query is answered
    @param extra -- additional arguments to `callback`.
    """
    debug("IP2INFO", 3, "submitting lookup of %s, type %d", addr, type)
    self.queries[self.res.submit(addr, type)] = \
        (time(), callback, (addr,) + extra)

  def _submit_ptr(self, callback, ip, type = rr.PTR):
    """Submit a DNS reverse lookup query, but avoid making duplicates.

    If there is already a query ongoing for the given reverse IP address,
    no new query is submitted but the address is cached in `self.ptrmap`
    so the callback knows to consider this new association. The purpose
    is to help caller make multiple reverse IP address queries for a
    given "destination" address, and avoid any excess ones when making
    network address scans for multiple "origin" address.

    Addresses which fail reverse lookup with permanent error such as
    NXDOMAIN are remembered. Future queries on those addresses are
    short-circuited and immediately invoke the `callback` without
    issuing a new DNS query.

    @param callback -- function to call back if the query is answered
    @param ip -- the reversed IP address to look up
    @param info -- the forward IP address this query updates
    @param type -- request record type (adns.rr.*).
    """
    # If known to fail, skip.
    if ip in self.ptrfail:
      callback(None, ip)
      return

    # Add to pending list of ptr lookups
    if ip not in self.ptrmap:
      self.ptrmap[ip] = []
    self.ptrmap[ip].append(callback)

    # Create DNS query if this is first pending lookup for this address.
    if len(self.ptrmap[ip]) == 1:
      debug("IP2INFO", 3, "submitting ptr lookup of %s", ip)
      self._submit(ip.reverse_dns, type, self._ptr_result, ip)

  def _ptr_result(self, answer, addr, ip):
    """Respond to PTR query results."""
    debug("IP2INFO", 3, "ptr result %s %s %s", addr, ip, answer)
    self._tick_stats(answer[0])
    if answer[0] > adns.status.max_tempfail:
      # permanent failure, remember not to ask again
      debug("IP2INFO", 3, "blacklisting %s %s (%d)",
            ip, _adns_status_name_of(answer[0]), answer[0])
      self.ptrfail.add(ip)
    hostname = (len(answer[3]) > 0 and answer[3][0].lower()) or None
    for callback in self.ptrmap[ip]:
      callback(hostname, ip)
    del self.ptrmap[ip]

  def process(self, waittime = 1):
    """Process DNS queries and callbacks for up to `waittime` seconds."""

    # Wait for any queries to complete. Issue any new tasks created.
    now = time()
    npending = self._issue()
    num = len(self.queries)
    until = now + waittime
    prevtime = now
    while len(self.queries):
      ndone = 0
      for q in self.res.completed(.25):
        (created, callback, args) = self.queries[q]
        del self.queries[q]
        callback(q.check(), *args)
        ndone +=1

      if ndone > 0:
        npending = self._issue()

      # See if we should quit. Throttle back if 'completed()' returned
      # quickly and we are busy looping.
      xnow = time()
      if xnow > until:
        break
      if xnow - prevtime < 0.1 and (npending or len(self.queries)):
        sleep(min(0.5, until - xnow))
      prevtime = xnow

    # Expire whatever was running too long, and report timing.
    self._timeout()
    debug("IP2INFO", 2, "processed %d dns queries in %.2f s,"
          " %d remain, %d pending",
          num, time() - now, len(self.queries), npending)
    return npending

  def purge(self):
    """Purge cached information and reload databases if possible."""
    now = time()
    if self.queries:
      return

    for _, tasks in self.ipaddrs.values():
      if tasks:
        return

    assert not self.ptrmap
    assert not self.queries
    assert not self.notify
    self.ptrfail = set()
    self.asnmap = self._asninit()
    self.ipaddrs = {}
    self.resstat = {}
    self.gip.reload()
    self.psl.reload()
    debug("IP2INFO", 1, "reload complete %.2f", time() - now)

  def wait(self):
    """Wait for pending results to complete."""
    while self.process() > 0 or len(self.queries) > 0:
      pass

  def query(self):
    """Retrieve results for all submitted queries.

    @return Dictionary of IP address (kind, host) tuples to
    `IPInfo` and `HostInfo` objects, one for every unique IP
    address earlier issued with `submit()`.
    """
    return dict((addr, val[0]) for addr, val in self.ipaddrs.iteritems())

  def statistics(self):
    """Return dictionary of resolver statistics by answer type."""
    return dict(((status, _adns_status_name_of(status)), count)
                for status, count in self.resstat.iteritems())

  def reset_statistics(self):
    """Reset resolver statistics."""
    self.resstat = {}

  def submit(self, iplist, kind="ip", origin=None, callback=None):
    """Submit IP addresses for query.

    Begins issuing queries for IP addresses in the input in parallel.
    Results will be accumulated in an internal table for later access.

    Resolving an address may involve the following queries:
    - GeoIP database lookup
    - IP address to name reverse lookup: maxtries
    - IP address to ASN reverse lookup: maxtries
    - ASN country code lookup: 2 tries
    - CIDR base address lookup: 1 try
    - Nearby address scan: 1 try.

    The resolver issues background queries for addresses in parallel.
    It is best if the client feeds addresses to resolve regularly and
    calls `process()` regularly and frequently enough to collect
    results and to ensure continuous progress and for a query query
    pattern which generally yields good results and avoids excess
    dropped DNS packets and is resilient to sporadic failures.

    @param kind -- "ip" or "name" to indicate whether iplist are a
    list of IP addresses or host names, respectively.

    @param iplist -- Some iterable of IP addresses, either strings or
    IPAddress objects. If `kind` is "name", then host names.

    @param origin -- If `kind` is "ip", possible original forward
    lookup that originated this request. This will be hooked up into
    `IPInfo.hosts` in the final results.

    @param callback -- Optional callable for notifying final result.
    For forward lookups, the callable must be able to handle multiple
    notifications for the same destination, with incomplete results.

    @return No return value. Results can be retrieved with `query()`.
    """
    assert kind in ("ip", "name")
    now = time()
    numreq = 0
    newreq = 0
    for ip in iplist:
      numreq += 1
      if kind == "name":
        assert isinstance(ip, str), "host name must be a string"
        ipkey = (kind, ip)
        if ipkey not in self.ipaddrs:
          newreq += 1
          info = HostInfo(ip)
          tasks = [IPTask(self._cname_lookup, self.maxtries),
                   IPTask(self._addr_lookup, self.maxtries)]
          self.ipaddrs[ipkey] = (info, tasks)
        else:
          _, tasks = self.ipaddrs[ipkey]
          if not tasks:
            tasks.append(IPTask(self._notify_hosts, 1))

        if callback:
          if ipkey not in self.notify:
            self.notify[ipkey] = []
          self.notify[ipkey].append(callback)
      else:
        if self._insert_lookup(ip, origin, callback):
          newreq += 1

    self._issue()
    debug("IP2INFO", 1, "submitted %d addresses, %d new in %.2f s",
          numreq, newreq, time() - now)

  def _insert_lookup(self, ip, origin=None, callback=None):
    """Internal utility to insert a new task to look up an IP address."""
    if isinstance(ip, str):
      ip = IPAddress(ip)

    isnew = False
    ipstr = str(ip)
    ipkey = ("ip", ipstr)
    if ipkey not in self.ipaddrs:
      info = IPInfo(ip)
      info.hosts.append(origin)
      info.asn = self.NULL_ASN
      info.geoip = GeoIPLookup.NULL_GEOIP
      tasks = [IPTask(self._geoip_lookup,    1),
               IPTask(self._asn_lookup_1,    1),
               IPTask(self._hostname_lookup, self.maxtries),
               IPTask(self._asn_lookup_2,    self.maxtries),
               IPTask(self._asn_lookup_3,    self.maxtries),
               IPTask(self._cidr_lookup,     1),
               IPTask(self._wild_lookup,     1),
               IPTask(self._domain_lookup,   1),
               IPTask(self._notify_addrs,    1)]
      self.ipaddrs[ipkey] = (info, tasks)
      isnew = True
    else:
      info, tasks = self.ipaddrs[ipkey]
      if origin not in info.hosts:
        info.hosts.append(origin)
      if not tasks:
        tasks.append(IPTask(self._notify_addrs, 1))

    if callback:
      if ipkey not in self.notify:
        self.notify[ipkey] = []
      self.notify[ipkey].append(callback)

    return isnew

  def _cname_lookup(self, info, task, tasks):
    """Issue canonical name lookup for a host name. For the occasional
    poorly configured sites with CNAME linked to another CNAME, issues
    a few levels of recursive requests to get to a final host name."""
    debug("IP2INFO", 2, "cname lookup %s %s", info.hostname, info.cnames)

    # Report ready if we already have a result.
    if info.cnames:
      return True

    # Do DNS CNAME lookup.
    def responder(answer, addr):
      debug("IP2INFO", 2, "cname result %s from %s: %s",
            addr, info.hostname, answer)
      self._tick_stats(answer[0])
      task.done = True
      task.ongoing = False
      if addr not in info.cnames:
        info.cnames[addr] = []
      for cname in answer[3]:
        info.all_names.update((cname,))
        cnames = info.cnames[addr]
        cnames.append(cname)
        if len(cnames) < 5:
          self._submit(cname, rr.CNAME, responder)
          task.ongoing = True
          task.done = False

    self._submit(info.hostname, rr.CNAME, responder)
    return False

  def _addr_lookup(self, info, task, tasks):
    """Issue forward name lookup for a host name. Issues A requests for
    the original host name and all CNAMEs discovered. All successfully
    looked up addresses get their own reverse IP lookup process."""
    debug("IP2INFO", 2, "addr lookup %s %s %s",
          info.hostname, info.addrs, info.all_names)

    # Report ready if we already have a result.
    if info.addrs:
      return True

    # Do DNS forward lookup for hostname and all CNAMEs.
    def responder(answer, name):
      debug("IP2INFO", 2, "addr result %s from %s: %s", name, info.hostname, answer)
      self._tick_stats(answer[0])
      if name not in info.addrs:
        info.addrs[name] = []
      for ipstr in answer[3]:
        info.all_addrs.update((ipstr,))
        ip = IPAddress(ipstr)
        info.addrs[name].append(ip)
        self._insert_lookup(ip, info)
      task.done = (len(info.addrs) == len(info.all_names))
      task.ongoing = not task.done
      if task.done and answer[0] > adns.status.max_misconfig and not info.all_addrs:
        tasks.append(IPTask(self._notify_hosts, 1))

    for name in info.all_names:
      self._submit(name, rr.A, responder)
    return False

  def _geoip_lookup(self, info, task, tasks):
    """Perform GeoIP lookup for an IP address."""
    debug("IP2INFO", 2, "geoip lookup %s %s", info.ip, info.geoip)

    # Report ready if we already have a result.
    if info.geoip != GeoIPLookup.NULL_GEOIP:
      return True

    # Lookup GeoIP info.
    info.geoip = self.gip.lookup(info.ip)
    return True

  def _asn_lookup_1(self, info, task, tasks):
    """Perform first step of ASN lookup, by checking reserved addresses."""
    debug("IP2INFO", 2, "asn lookup/reserved %s %s", info.ip, info.asn.asn)

    if info.asn == self.NULL_ASN:
      resv = self._reserved(info.ip)
      if resv:
        info.cidr = resv
        info.domain = str(resv)
        info.asn = self.asnmap["@%s" % info.domain]
    return True

  def _hostname_lookup(self, info, task, tasks):
    """Issue reverse name lookup for an IP address."""
    debug("IP2INFO", 2, "hostname lookup %s %s %s",
          info.ip, info.hostname, info.domain)

    # Report ready if we already have a result.
    if info.hostname or info.domain:
      return True

    # Do DNS reverse hostname lookup.
    def responder(hostname, ip):
      debug("IP2INFO", 2, "hostname %s -> %s", info.ip, hostname)
      task.ongoing = False
      if hostname != None:
        info.hostname = hostname
        task.done = True

    self._submit_ptr(responder, info.ip, rr.PTRraw)
    return False

  def _asn_lookup_2(self, info, task, tasks):
    """Perform second step of AS lookups for IP addresses by using
    routeviews.org reverse mapping DNS servers."""
    debug("IP2INFO", 2, "asn lookup/routeviews %s %s", info.ip, info.asn.asn)

    # Report ready if we already have a result.
    if info.asn != self.NULL_ASN:
      return True

    # Define responder to routeviews.org ASN lookup query.  Expects
    # TXT 3-tuple (name, cidr, width) answer. Keeps the first answer
    # received in the answer record. If this creates ASInfo it will
    # request ASN cc lookup too.
    def responder(answer, addr):
      debug("IP2INFO", 3, "routeviews result %s from %s: %s", addr, info.ip, answer)
      self._tick_stats(answer[0])
      task.ongoing = False
      if len(answer[3]) > 0 and len(answer[3][0]) == 3:
        task.done = True
        (asn, cidr, w) = answer[3][0]
        info.cidr = IPNetwork("%s/%s" % (cidr, w))
        if asn in self.asnmap:
          debug("IP2INFO", 3, "routeviews existing asn %s", asn)
          info.asn = self.asnmap[asn]
        else:
          debug("IP2INFO", 2, "routeviews new asn %s, cidr %s", asn, info.cidr)
          info.asn = self.asnmap[asn] = ASInfo(asn = asn)
          tasks.insert(1, IPTask(self._asn_lookup_cc, 2))

    # Do reverse TXT lookup on IP address from routeviews.org DNS.
    revaddr = info.ip.reverse_dns
    if revaddr.endswith(".in-addr.arpa."):
      rev = revaddr[:-14] + ".asn.routeviews.org"
    elif revaddr.endswith(".ip6.arpa."):
      rev = revaddr[:-10] + ".asn.routeviews.org"
    else:
      assert False, "reverse address %s not recognised" % revaddr
    debug("IP2INFO", 3, "submitting asn lookup %s", rev)
    self._submit(rev, rr.TXT, responder)
    return False

  def _asn_lookup_3(self, info, task, tasks):
    """Perform third step of AS lookups for IP addresses by using
    cymru.com reverse mapping DNS servers."""
    debug("IP2INFO", 2, "asn lookup/cymru %s %s", info.ip, info.asn.asn)

    # Report ready if we already have a result.
    if info.asn != self.NULL_ASN:
      return True

    # Define responder to cymru.com ASN lookup query.  Expects 1-tuple
    # "ASN | CIDR | CC | RIR | YYYY-MM-DD" answer. Keeps the last
    # record of the answer received, it's the most specific CIDR. If
    # this creates ASInfo it will request ASN cc lookup too.
    def responder(answer, addr):
      debug("IP2INFO", 3, "cymru result %s from %s: %s", addr, info.ip, answer)
      self._tick_stats(answer[0])
      task.ongoing = False
      if len(answer[3]) > 0 and len(answer[3][-1]) == 1:
        m = RX_ASN.match(answer[3][-1][0])
        if m:
          task.done = True
          if m.group(1) in self.asnmap:
            debug("IP2INFO", 3, "cymru existing asn %s", m.group(1))
            info.asn = self.asnmap[m.group(1)]
          else:
            debug("IP2INFO", 2, "cymru new asn %s, cidr %s, cc %s",
                  m.group(1), m.group(2), m.group(3))
            tasks.insert(1, IPTask(self._asn_lookup_cc, 2))
            info.asn = self.asnmap[m.group(1)] = \
                ASInfo(asn = m.group(1),
                       cc = m.group(3),
                       rir = m.group(4),
                       date = m.group(5))

    # Do reverse TXT lookup on IP address from cymru.com DNS.
    revaddr = info.ip.reverse_dns
    if revaddr.endswith(".in-addr.arpa."):
      rev = revaddr[:-14] + ".origin.asn.cymru.com"
    elif revaddr.endswith(".ip6.arpa."):
      rev = revaddr[:-10] + ".origin6.asn.cymru.com"
    else:
      assert False, "reverse address %s not recognised" % revaddr
    debug("IP2INFO", 3, "submitting asn lookup %s", rev)
    self._submit(rev, rr.TXT, responder)
    return False

  def _asn_lookup_cc(self, info, task, tasks):
    """Perform final step of AS lookups, verifying country code for the
    autonomous system from cymru.com database using DNS lookups. This
    is more accurate than the code returned by initial AS lookups."""
    debug("IP2INFO", 2, "asn lookup/cc %s %s", info.ip, info.asn.asn)

    # Double check ASN lookup was really successful.
    if not info.asn.asn or not info.asn.asn.isdigit():
      return True

    # Define responder to country code lookup from cymru.com. Expects
    # 1-tuple answer matching RX_ASN_CC. Parse the one reply received.
    def responder(answer, addr):
      debug("IP2INFO", 3, "cc result %s from %s: %s", addr, info.asn.asn, answer)
      self._tick_stats(answer[0])
      task.ongoing = False
      if len(answer[3]) > 0 and len(answer[3][0]) == 1:
        m = RX_ASN_CC.match(answer[3][0][0])
        if m and m.group(1) == info.asn.asn:
          debug("IP2INFO", 2, "cc assigning %s = %s", m.group(1), m.group(2))
          info.asn.cc = m.group(2)
          info.asn.rir = m.group(3)
          info.asn.date = m.group(4)
          info.asn.org = m.group(5)
          info.asn.desc = m.group(7)
          task.done = True

    debug("IP2INFO", 3, "submitting asn lookup %s", info.asn.asn)
    self._submit("as%s.asn.cymru.com" % info.asn.asn, rr.TXT, responder)
    return False

  def _cidr_lookup(self, info, task, tasks):
    """Try PTR reverse lookup on the CIDR base address for addresses which
    failed normal hostname reverse lookup."""
    debug("IP2INFO", 2, "cidr lookup %s %s", info.ip, info.cidrhost)

    if info.domain or info.hostname or info.cidrhost:
      return True

    # Define responder to handle results.
    def responder(hostname, ip):
      debug("IP2INFO", 3, "cidr result %s -> %s", info.ip, hostname)
      task.ongoing = False
      if hostname != None:
        task.done = True
        info.cidrhost = hostname
        debug("IP2INFO", 2, "cidr hostname found %s: %s",
              info.ip, info.cidrhost)

    self._submit_ptr(responder, info.cidr.ip, rr.PTRraw)
    return False

  def _wild_lookup(self, info, task, tasks):
    """For addresses we have failed to reverse lookup, and failed to
    reverse lookup CIDR base address, try other addresses in the same
    CIDR block. If the CIDR is narrower than /24, scan it entirely,
    and otherwise scan the nearest /24 segment. Remember which ever
    name we first come up with."""
    debug("IP2INFO", 2, "wild lookup %s %s", info.ip, info.wildhost)

    if info.domain or info.hostname or info.cidrhost or info.wildhost:
      return True

    # FIXME: Handle IPv6 here.
    cidrw = (info.cidr.prefixlen >= 24 and info.cidr.prefixlen) or 25
    addrs = [xip for xip in IPNetwork("%s/%d" % (info.ip, cidrw))]

    # Define responder to handle results for nearby address scan.
    # Remember only the first result we receive.
    def responder(hostname, ip):
      debug("IP2INFO", 2, "wild result %s -> %s -> %s %d",
            info.ip, ip, hostname, len(addrs))
      addrs.remove(ip)
      task.ongoing = (len(addrs) > 0)
      if hostname != None:
        task.done = True
        task.ongoing = False
        if not info.wildhost:
          info.wildhost = hostname
          debug("IP2INFO", 2, "wild hostname found %s: %s",
                info.ip, info.wildhost)

    for xip in addrs[:]:
      debug("IP2INFO", 3, "wild hostname lookup %s", xip)
      self._submit_ptr(responder, xip, rr.PTRraw)

    return False

  def _domain_lookup(self, info, task, tasks):
    """Look up domain part based on whatever name we managed to get."""
    debug("IP2INFO", 2, "domain lookup %s %s %s",
          info.ip, info.hostname, info.domain)

    if not info.domain:
      if info.hostname:
        info.domain = self.psl.domain(info.hostname)
      elif info.cidrhost:
        info.domain = self.psl.domain(info.cidrhost)
      elif info.wildhost:
        info.domain = self.psl.domain(info.wildhost)
      elif info.asn and info.asn.asn:
        info.domain = "AS#%s (%s)" % (info.asn.asn, info.asn.org)

    if not info.hostname:
      info.hostname = str(info.ip)

    return True

  def _notify_hosts(self, info, task, tasks):
    """Notify completely looked up host objects."""
    assert isinstance(info, HostInfo)
    key = ("name", info.hostname)
    assert key in self.notify
    debug("IP2INFO", 2, "notify callbacks host %s %d %s %s",
          info.hostname, len(self.notify[key]), info.all_addrs, info.ipaddrs)
    assert len(info.all_addrs) == len(info.ipaddrs)
    debug("IP2INFO", 2, "notify callbacks host %s %d",
          info.hostname, len(self.notify[key]))

    callbacks = self.notify[key]
    del self.notify[key]
    for f in callbacks:
      f(info, None, 0)

    return True

  def _notify_addrs(self, info, task, tasks):
    """Notify parent host objects and callbacks on completion of ip lookup."""

    # For forward + reverse lookup, fill discovered info into host object.
    # This differs from _notify_host() in that we aren't sure all lookups
    # are complete, as individual ip address lookups for the host complete
    # asynchronously from each other.
    debug("IP2INFO", 2, "notify callbacks ip %s -> %s",
          info.ip, " ".join(h.hostname for h in info.hosts) or "(No host)")

    ipstr = str(info.ip)
    key = ("ip", ipstr)
    if key in self.notify:
      callbacks = self.notify[key]
      del self.notify[key]
      debug("IP2INFO", 3, "%d ip callbacks for %s",
            len(ipcallbacks), info.ip)

      for f in callbacks:
        f(info, info, 0)

    for host in info.hosts:
      remain = 0
      if ipstr not in host.ipaddrs:
        assert len(host.ipaddrs) < len(host.all_addrs)
        host.ipaddrs[ipstr] = info
        remain = (len(host.all_addrs) - len(host.ipaddrs))

      key = ("name", host.hostname)
      if key in self.notify:
        debug("IP2INFO", 2, "%d host callback(s) for %s via %s, %d remain",
              len(self.notify[key]), host.hostname, info.ip, remain)
        callbacks = self.notify[key]
        if not remain:
          del self.notify[key]

        for f in callbacks:
          f(host, info, remain)

    return True

######################################################################
if __name__ == "__main__":
  debug["*"] = 3

  nameservers = ((None,), # Default
                 ("8.8.8.8", "8.8.4.4"), # Google
                 ("67.138.54.100", "207.225.209.66"), # ScrubIt
                 ("156.154.70.1", "156.154.71.1"), # dnsadvantage
                 ("208.67.222.222", "208.67.220.220"), # OpenDNS
                 ("199.166.28.10", "199.166.29.3", "199.166.31.3",
                  "204.57.55.100", "199.5.157.128")) # ORSC

  def report(i, origin, remain):
    if isinstance(i, HostInfo):
      print "host=%s names=%s addrs=%s ipaddrs=%d ip=%s [%s]%s" % \
        (i.hostname, i.all_names, i.all_addrs, len(i.ipaddrs),
         origin.ip, origin.cidr, (not remain and " last notification") or "")
      i = origin
    print "%-40s %-10s %-6s %-25s %-18s %s %s %s %s" % \
      ("ip=%s [%s]" % (i.ip, i.cidr),
       "asn=%s,%s" % (i.asn.cc, i.asn.asn),
       "cc=%s" % i.geoip.cc,
       "domain=%s" % i.domain,
       "pos=%s" % ((i.geoip.lat != None and "%.4f,%.4f" % (i.geoip.lat, i.geoip.long)) or ""),
       "name=%s cidrname=%s wildname=%s" % (i.hostname, i.cidrhost, i.wildhost),
       "loc=%s" % ", ".join(x for x in (i.geoip.country, i.geoip.region, i.geoip.city) if x != None),
       "org=%s desc=%s" % (i.asn.org, i.asn.desc),
       "host=%s" % ", ".join(h.hostname for h in i.hosts))

  ns = nameservers[0][0]
  if ns == None:
    res = adns.init(adns.iflags.noautosys)
  else:
    res = adns.init(adns.iflags.noautosys, sys.stderr, "nameserver %s" % ns)

  x = IPResolver(res = res)
  x.submit(sys.argv[2:], kind=sys.argv[1], callback=report)
  x.wait()

  resstat = x.statistics()
  for key in sorted(resstat.keys()):
    status, name = key
    debug("STATS", 1, " %7d %s (%s)", resstat[key], name, status)
