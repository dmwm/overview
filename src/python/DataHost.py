from WMCore.REST.Auth import authz_match
from WMCore.REST.Server import RESTEntity, restcall
from WMCore.REST.Error import MissingObject, InvalidParameter
from WMCore.REST.Validation import validate_strlist, \
       _validate_one, _validate_all
from WMCore.REST.Tools import tools
from Overview.IPInfo import IPInfo, IPResolver, HostInfo
from Overview.Debug import debug
from threading import Thread, Condition
from collections import namedtuple
from netaddr import IPAddress
import cjson, re, cherrypy, time, random

RXIP = re.compile(r"^[.0-9]+$")
RXHOST = re.compile(r"^(?:[-a-z0-9]+\.)+[a-z]{2,5}$")
Value = namedtuple("Value", ["expires", "data"])
Task = namedtuple("Task", ["kind", "hosts", "reply"])

def _check_ip(argname, val):
  if not isinstance(val, str) or not RXIP.match(val):
    raise InvalidParameter("Incorrect '%s' parameter" % argname)
  try:
    val = IPAddress(val)
  except:
    raise InvalidParameter("Incorrect '%s' parameter" % argname)

  return val

def validate_iplist(argname, param, safe):
  """Validates that an argument is an array of strings, each of which
  is a valid IP address.

  Checks that an argument named `argname` is either a single string or
  an array of strings, each of which is convertible to an `IPAddress`
  object. If successful the array is copied into `safe.kwargs` and the
  value is removed from `param.kwargs`. The value always becomes an
  array in `safe.kwargs`, even if no or only one argument was provided.

  Note that an array of zero length is accepted, meaning there were no
  `argname` parameters at all in `param.kwargs`."""
  _validate_all(argname, param, safe, _check_ip)

def validate_ip(argname, param, safe, optional = False):
  """Validates that an argument is a valid IP address.

  Checks that an argument named `argname` exists in `param.kwargs`
  and it is a string convertible to an `IPAddress` object. If
  successful the string is copied into `safe.kwargs` and the value
  is removed from `param.kwargs`.

  If `optional` is True, the argument is not required to exist in
  `param.kwargs`; None is then inserted into `safe.kwargs`. Otherwise
  a missing value raises an exception."""
  _validate_one(argname, param, safe, _check_ip, optional)

class Reply:
  result = None
  kind = None
  error = None
  signal = None
  submitted = False
  finished = False
  pending = None
  until = 0

  def _ipinfo(self, i):
    return { "ip": str(i.ip), "cidr": str(i.cidr),
             "domain": i.domain, "hostname": i.hostname,
             "cidrhost": i.cidrhost, "wildhost": i.wildhost,
             "asn": {
               "cc": i.asn.cc, "asn": i.asn.asn, "country": i.asn.country,
               "rir": i.asn.rir, "org": i.asn.org, "desc": i.asn.desc,
               "date": i.asn.date
             },
             "geoip": {
               "cc": i.geoip.cc, "country": i.geoip.country,
               "continent": i.geoip.continent, "region": i.geoip.region,
               "city": i.geoip.city, "lat": i.geoip.lat, "lon": i.geoip.long
             }
           }

  def _hostinfo(self, info):
    return { "hostname": info.hostname,
             "ipaddrs": [self._ipinfo(i) for i in info.ipaddrs.values()],
             "dnsinfo": { "CNAME": dict((k, v) for k, v in info.cnames.iteritems() if v),
                          "A": dict((k, map(str, v)) for k, v in info.addrs.iteritems() if v) },
             "names": [x for x in info.all_names],
             "addrs": [x for x in info.all_addrs] }

  def __call__(self, info, origin, remain):
    debug("HOSTDATA", 3, "replied to %s", self)
    if self.kind == "name":
      if isinstance(info, HostInfo):
        if remain:
          debug("HOSTDATA", 2,
                "host %s: %d out of %d host addresses, waiting for remaining %d",
                info.hostname, len(info.ipaddrs), len(info.all_addrs), remain)
        else:
          assert info.hostname in self.pending
          self.pending.remove(info.hostname)
          debug("HOSTDATA", 1,
                "host %s: all %d addresses resolved, %d requests remain",
                info.hostname, len(info.ipaddrs), len(self.pending))
          with self.signal:
            if not self.result:
              self.result = []
            self.result.append(self._hostinfo(info))
            if not self.pending:
              self.signal.notifyAll()
      else:
        debug("HOSTDATA", 1, "%s: ignoring address update for %s",
              (origin and origin.hostname), info.ip)
    elif self.kind == "ip":
      assert isinstance(info, IPInfo)
      assert info.ip in self.pending
      assert not remain
      self.pending.remove(info.ip)
      debug("HOSTDATA", 1, "ip %s: address resolved, %d requests remain",
            info.ip, len(self.pending))
      with self.signal:
        if not self.result:
          self.result = []
        self.result.append(self._ipinfo(info))
        if not self.pending:
          self.signal.notifyAll()
    else:
      assert False, "internal error, lookup neither host nor ip"

class HostCache(Thread):
  """Utility to resolve host information."""
  _PURGE_INTERVAL = 4*3600
  _NUM_SIGS = 8

  def __init__(self, statedir):
    Thread.__init__(self, name = "HostCache")
    self._ip2i = IPResolver(cachedir = statedir, maxtime=15)
    self._cv = Condition()
    self._stopme = False
    self._requests = []
    self._last_purge = time.time()
    self._signals = map(lambda x: Condition(), xrange(0, self._NUM_SIGS))
    cherrypy.engine.subscribe('start', self.start)
    cherrypy.engine.subscribe('stop', self.stop, priority=100)

  def _purge(self):
    now = time.time()
    debug("HOSTDATA", 1, "purging address resolver")
    self._last_purge = time.time()
    self._ip2i.purge()

  def statistics(self):
    with self._cv:
      return self._ip2i.statistics()

  def reset_statistics(self):
    with self._cv:
      self._ip2i.reset_statistics()

  def purge(self):
    with self._cv:
      self._purge()

  def stop(self):
    debug("HOSTDATA", 1, "requesting to stop resolved thread")
    with self._cv:
      self._stopme = True
      self._cv.notifyAll()

  def lookup(self, kind, hosts, maxwait=30):
    """
    Lookup information either by IP address or host name.

    :arg str kind: "ip" or "name"
    :arg list hosts: list of host name string, ip address or a real name
    :arg float maxwait: maximum time in seconds to wait for a result.
    """
    reply = Reply()
    reply.kind = kind
    reply.until = time.time() + maxwait
    reply.signal = random.choice(self._signals)
    reply.pending = set(hosts)

    with self._cv:
      self._requests.append(Task(kind, hosts, reply))
      self._cv.notifyAll()

    with reply.signal:
      while True:
        if self._stopme:
          raise RuntimeError("server stopped")
        elif reply.error:
          raise reply.error
        elif not reply.pending:
          reply.finished = True
          return reply.result
        else:
          reply.signal.wait()

  def run(self):
    with self._cv:
      while not self._stopme:
        npending = 0
        ncurreq = len(self._requests)

        # Insert any new requests. If they fail, remember the error.
        for r in self._requests:
          if not r.reply.submitted:
            debug("HOSTDATA", 1, "submitting request: %s %s", r.kind, r.hosts)
            r.reply.submitted = True
            try:
              self._ip2i.submit(r.hosts, kind=r.kind, callback=r.reply)
            except Exception, e:
              r.reply.error = e

        # Pump any pending lookups for up to .25 seconds. Note that this
        # will wait only as long as needed, and will quit immediately
        # if there is no work at all. It's not unusual we need to wait
        # longer than this for final results; see the check further on.
        try:
          self._cv.release()
          npending = self._ip2i.process(.25)
        finally:
          self._cv.acquire()

        # Post-process requests. Remove fully completed, expired and
        # failed lookups from the request queue.
        nmodified = 0
        now = time.time()
        for r in self._requests[:]:
          rr = r.reply
          if rr.finished:
            debug("HOSTDATA", 2, "request completed: %s %s", r.kind, r.hosts)
            self._requests.remove(r)
            nmodified += 1
          elif rr.submitted and rr.until < now:
            debug("HOSTDATA", 1, "request has expired: %s %s", r.kind, r.hosts)
            self._requests.remove(r)
            with rr.signal:
              rr.error = RuntimeError("maximum wait time exhausted")
              rr.signal.notifyAll()
            nmodified += 1
          elif rr.submitted and rr.error:
            debug("HOSTDATA", 1, "request failed: %s %s", r.kind, r.hosts)
            self._requests.remove(r)
            with rr.signal:
              rr.signal.notifyAll()
            nmodified += 1

        # Wait to be notified, but only if we don't already have work to do.
        skipwait = (self._stopme or npending or nmodified
                    or len(self._requests) != ncurreq)
        debug("HOSTDATA", 2, ("wait for signal, %d pending, %d requests"
                              " now vs. %d before, %d modified: %s"),
              npending, len(self._requests), ncurreq, nmodified,
              (skipwait and "skipping unnecessary wait") or "waiting")
        if not skipwait:
          if now - self._last_purge > self._PURGE_INTERVAL:
            self._purge()
          self._cv.wait((self._requests and 0.25) or None)
          debug("HOSTDATA", 2, "wait done")

    debug("HOSTDATA", 1, "server thread stopped")

class HostData(RESTEntity):
  """REST entity object for Host information."""

  def __init__(self, app, api, config, mount):
    RESTEntity.__init__(self, app, api, config, mount)
    self._cache = HostCache(app.statedir)

  def validate(self, apiobj, method, api, param, safe):
    if method == "GET":
      if not len(param.args) or param.args[0] not in ("ip", "name", "stats"):
        raise InvalidParameter("Missing or wrong ip/host category")
      safe.kwargs["kind"] = kind = param.args.pop(0)
      if kind == "ip":
        validate_iplist("host", param, safe)
      elif kind == "name":
        validate_strlist("host", param, safe, RXHOST)
      elif kind == "stats":
        authz_match(role=["Global Admin"], group=["global"])
        safe.kwargs["host"] = []

    elif method == "POST":
      authz_match(role=["Global Admin"], group=["global"])
      if not len(param.args) or param.args[0] not in ("stats", "purge"):
        raise InvalidParameter("Invalid operation")
      safe.kwargs["operation"] = param.args.pop(0)

  def _statistics(self):
    stats = self._cache.statistics()
    cherrypy.request.rest_generate_preamble = \
      { "columns": ["count", "response", "code"] }
    return [[stats[key], key[1], key[0]]
            for key in sorted(stats.keys())]

  @restcall
  @tools.expires(secs=12*3600)
  def get(self, kind, host):
    if kind == "stats":
      return self._statistics()
    else:
      return self._cache.lookup(kind, host)

  @restcall
  def post(self, operation):
    if operation == "purge":
      self._cache.purge()
      return ["ok"]
    else:
      stats = self._statistics()
      self._cache.reset_statistics()
      return stats
