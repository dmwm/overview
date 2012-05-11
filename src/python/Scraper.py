import os, sys, re, time, pycurl, urllib, urlparse, cherrypy, traceback, gzip, zlib
from WMCore.REST.Tools import tools
from WMCore.REST.Error import MissingObject, InvalidParameter
from WMCore.REST.Server import RESTEntity, restcall
from Overview.HTTPRequest import RequestManager
from Overview.X509 import SSLOptions
from Overview.Debug import debug
from threading import Thread, Condition
from collections import namedtuple
from cStringIO import StringIO
from PIL import Image as PILImage

RX_CONTENT_ENCODING = re.compile(r"(?i)^content-encoding:\s*(\S+)")
RX_PATH = re.compile(r"^[-a-z0-9]+$")

Value = namedtuple("Value", ["expires", "data"])
Task = namedtuple("Task", ["url", "key", "period", "content_type", "convert", "result"])

class ContentCache(Thread):
  """Utility to get content from the web"""
  _ID = "CCACHE"
  _ident = "Overview/%s Python/%s" % \
           (os.environ["OVERVIEW_VERSION"],
            ".".join(map(str, sys.version_info[:3])))

  def __init__(self, appconfig):
    debug(self._ID, 1, "creating new content cache")
    Thread.__init__(self, name = "ContentCache")
    self._ssl = SSLOptions(key_file = appconfig.x509key,
                           cert_file = appconfig.x509cert,
                           ca_path = appconfig.x509cadir)

    self._reqman = RequestManager(num_connections = 10,
                                  ssl_opts = self._ssl,
                                  user_agent = self._ident,
                                  handle_init = self._hinit,
                                  request_init = self._reqinit,
                                  request_error = self._reqerror,
                                  request_respond = self._reqdone)
    self._cv = Condition()
    self._stopme = False
    self._values = {}
    cherrypy.engine.subscribe('start', self.start)
    cherrypy.engine.subscribe('stop', self.stop, priority=100)

  def exists(self, key, predicate=None):
    """Check if the given `key` satisfying `predicate` has been registered."""
    with self._cv:
      return self._has(key, predicate)

  def data(self, key):
    """Returns the data for a previously registered `key`."""
    with self._cv:
      _, val = self._get(key)
      return val.data

  def stop(self):
    with self._cv:
      self._stopme = True
      self._cv.notifyAll()

  def _has(self, key, predicate=None):
    try:
      _, val = self._get(key)
      if predicate:
        return predicate(val)
      else:
        return True
    except KeyError:
      return False

  def _get(self, key):
    if isinstance(key, basestring):
      return self._values, self._values[key]
    else:
      val = self._values
      for sect in key[:-1]:
        val = val[sect]
      leaf = val[key[-1]]
      if isinstance(leaf, dict):
        raise KeyError("%s is not a leaf" % key)
      return val, leaf

  def _put(self, key, expires, value):
    val = Value(expires, value)
    if isinstance(key, basestring):
      self._values[key] = val
      return self._values, val
    else:
      v = self._values
      for sect in key[:-1]:
        if sect not in v:
          v[sect] = {}
        v = v[sect]
      v[key[-1]] = val
      return v, val

  def _store(self, task, value):
    with self._cv:
      self._put(task.key, time.time() + task.period, value)

  def _hinit(self, c):
    """Initialise curl handle `c`."""
    c.setopt(pycurl.SSL_VERIFYPEER, 0) # FIXME
    c.setopt(pycurl.SSL_VERIFYHOST, 1)

  def _reqinit(self, c, task):
    debug(self._ID, 2, "initialising request to %s (%s)",
          task.url, task.content_type)
    c.headers = []
    c.setopt(pycurl.URL, task.url)
    c.setopt(pycurl.HEADERFUNCTION, c.headers.append)
    c.setopt(pycurl.HTTPHEADER, ["Accept: %s" % task.content_type,
                                 "Accept-Encoding: gzip, deflate"])

  def _reqerror(self, c, task, errmsg, errno):
    result = getattr(task, "result", None)
    cherrypy.log(("CACHE ERROR %s request failed with error:"
                  " %s (code %d), headers %s") %
                 (getattr(task, "url", c.getinfo(pycurl.EFFECTIVE_URL)),
                  errmsg, errno, c.headers))
    if result:
      with result["signal"]:
        debug(self._ID, 2, "signaling error on %s, pending %d",
              task.url, result["pending"])
        if not result["error"]:
          result["error"] = RuntimeError("http error %s (code %d)"
                                         % (errmsg, errno))
        result["signal"].notifyAll()

  def _reqdone(self, c):
    result = c.task.result

    try:
      code = c.getinfo(pycurl.HTTP_CODE)
      debug(self._ID, 2, "request done %s => http %d", c.task.url, code)
      if code != 200:
        raise RuntimeError("http response %d from %s" % (code, c.task.url))

      value = c.buffer.getvalue()
      for h in c.headers:
        m = RX_CONTENT_ENCODING.match(h)
        if m:
          enc = m.group(1)
          if enc == "deflate":
            debug(self._ID, 3, "decompressing deflated content")
            value = zlib.decompress(value, -zlib.MAX_WBITS)
          elif enc == "gzip":
            debug(self._ID, 3, "decompressing gzipped content")
            value = gzip.GzipFile(fileobj=StringIO(value)).read()
          else:
            cherrypy.log("WARNING: ignoring content encoding %s for %s"
                         % (enc, c.task.url))

      if c.task.convert:
        debug(self._ID, 3, "converting value for %s, len %d",
              c.task.url, len(value))
        value = c.task.convert(c.task, c, value)

      if value:
        debug(self._ID, 1, "storing value for %s into %s, expires %d",
              c.task.url, c.task.key, c.task.period)
        self._store(c.task, value)

      if result:
        with result["signal"]:
          debug(self._ID, 2, "signaling result on %s, pending %d",
                c.task.url, result["pending"])
          assert result["pending"] > 0
          result["pending"] -= 1
          if result["pending"] == 0:
            result["signal"].notifyAll()
    except Exception, e:
      cherrypy.log(("CACHE ERROR %s processing failed with error:"
                    " %s, headers %s") % (c.task.url, str(e), c.headers))
      for line in traceback.format_exc().rstrip().split("\n"):
        cherrypy.log("  " + line)
      if result:
        with result["signal"]:
          debug(self._ID, 2, "signaling error on %s, pending %d",
                c.task.url, result["pending"])
          if not result["error"]:
            result["error"] = e
          result["signal"].notifyAll()

class ContentProxy(ContentCache):
  """Utility to get content from the web"""
  _NUM_SIGS = 8
  _ID = "CPROXY"

  def __init__(self, appconfig):
    debug(self._ID, 1, "creating new content proxy")
    ContentCache.__init__(self, appconfig)
    self._signals = map(lambda x: Condition(), xrange(0, self._NUM_SIGS))

  def fetch(self, section, expires, urls,
            content_type="application/json",
            convert=None, merge=None):
    """
    Retrieve data from URLs, caching it locally for `expires` seconds. Usually
    the content is JSON but it can be something else too, like HTML. All the
    URLs will be fetched, converted using `convert`, stored, then merged to a
    new value with `merge`.

    :arg str section: label for this item
    :arg int expires: maximum time to cache the responses
    :arg str content_type: expected content type in response
    :arg callable convert: response conversion, e.g. cjson.decode
    :arg callable merge: reply post-processor
    :arg dict urls: (title, url) or (title, (url, urledit)) of data to retrieve
    """
    debug(self._ID, 1, "%s: fetch from %s, expires %d, content type %s",
          section, urls, expires, content_type)
    if len(urls) > 1 and not merge:
      raise ValueError("merge needed to reduce %s from %s" % (section, urls))

    if not merge:
      merge = lambda group: group[urls.keys()[0]].data

    if isinstance(section, basestring):
      section = (section,)

    now = time.time()
    merged = section + ("merged",)
    signal = self._signals[(hash(merged) >> 24) % self._NUM_SIGS]
    reply = { "pending": 0, "error": None, "signal": signal }

    with self._cv:
      if not self._has(merged):
        debug(self._ID, 2, "%s: inserting null value", merged)
        self._put(merged, 0, None)

      for title, url in urls.iteritems():
        key = section + (title,)
        if self._has(key):
          _, val = self._get(key)
          if val.expires >= now:
            debug(self._ID, 2, "%s: valid value for %s", key, url)
            continue
        else:
          debug(self._ID, 2, "%s: inserting null value for %s", key, url)
          self._put(key, 0, None)

        if isinstance(url, tuple):
          url, urledit = url
          if urledit:
            url = urledit(url)

        reply["pending"] += 1
        self._reqman.put(Task(url, key, expires, content_type, convert, reply))
        debug(self._ID, 2, "%s: requested %s", key, url)

      if reply["pending"]:
        debug(self._ID, 3, "%s: signaling requests", section)
        self._cv.notifyAll()

    with signal:
      while True:
        if self._stopme:
          debug(self._ID, 3, "%s: reply cancelled for stop", merged)
          raise RuntimeError("server stopped")
        elif reply["error"]:
          debug(self._ID, 2, "%s: reply was an error", merged)
          raise reply["error"]
        elif not reply["pending"]:
          debug(self._ID, 2, "%s: reply complete", merged)
          break
        else:
          debug(self._ID, 3, "%s: waiting for reply", merged)
          signal.wait()

    with self._cv:
      newval = None
      now = time.time()
      if not self._has(merged):
        # unlikely but possible it got removed
        debug(self._ID, 2, "%s: replacing lost key", merged)
        self._put(merged, 0, None)
      group, val = self._get(merged)
      if val.expires >= now:
        debug(self._ID, 1, "%s: returning valid value", merged)
        return val.data
      else:
        debug(self._ID, 2, "%s: merging new value", merged)
        newval = merge(group)
        self._put(merged, now + expires, newval)
        return newval

  def _purge(self, now, container, key, val):
    if isinstance(val, dict):
      for k, v in val.items():
        self._purge(now, val, k, v)
      if container and not val:
        del container[key]
    elif val.expires and val.expires < now:
      del container[key]

  def run(self):
    with self._cv:
      while not self._stopme:
        debug(self._ID, 1, "processing requests")
        self._reqman.process(lock = self._cv.acquire, unlock = self._cv.release)

        debug(self._ID, 1, "purging values")
        self._purge(time.time(), None, None, self._values)

        debug(self._ID, 1, "waiting")
        if not self._stopme:
          self._cv.wait()
        debug(self._ID, 1, "wait done")

    debug(self._ID, 1, "server thread stopped, waking waiters")
    for s in self._signals:
      with s:
        s.notifyAll()
    debug(self._ID, 1, "server thread stopped")

class ContentScraper(ContentCache):
  """Utility to get content from the web"""
  _ID = "CSCRAPER"

  def __init__(self, appconfig):
    debug(self._ID, 1, "creating new content scraper")
    ContentCache.__init__(self, appconfig)
    self._scrape = []

  def scrape(self, section, urls,
             content_type="application/json",
             period=900, convert=None):
    """
    Register URLs for scraping content. Usually the content is JSON but it can
    be something else too, like HTML. All the URLs will be fetched, converted
    using `convert` and stored.

    :arg str section: label for this item
    :arg int period: interval in seconds between checks
    :arg str content_type: expected content type in response
    :arg callable convert: response conversion, e.g. cjson.decode
    :arg dict urls: (title, url) or (title, (url, urledit)) of data to retrieve
    """
    debug(self._ID, 1, "%s: scrape %s, period %d, content type %s",
          section, urls, period, content_type)
    with self._cv:
      if isinstance(section, basestring): section = (section,)
      map(lambda title: self._put(section + (title,), 0, None), urls.keys())
      self._scrape.append({ "section": section, "period": period,
                            "content_type": content_type, "urls": urls,
                            "convert": convert })
      self._cv.notifyAll()

  def run(self):
    with self._cv:
      while not self._stopme:
        debug(self._ID, 1, "executing scrape cycle")
        now = time.time()
        for s in self._scrape:
          for title, url in s["urls"].iteritems():
            key = s["section"] + (title,)
            debug(self._ID, 3, "%s: considering %s", key, url)
            _, val = self._get(key)
            if val.expires < now:
              if isinstance(url, tuple):
                url, urledit = url
                if urledit:
                  url = urledit(url)
              debug(self._ID, 2, "%s: refetching expired %s (%.2f ago)",
                    key, url, now - val.expires)
              self._reqman.put(Task(url, key, s["period"], s["content_type"],
                                    s["convert"], None))

        debug(self._ID, 1, "processing requests")
        self._reqman.process(lock = self._cv.acquire, unlock = self._cv.release)

        debug(self._ID, 1, "waiting")
        if not self._stopme:
          self._cv.wait(30)
        debug(self._ID, 1, "wait done")

    debug(self._ID, 1, "server thread stopped")

class ImageScraper(ContentScraper):
  """Utility to get images from the web"""
  _ID = "ISCRAPER"
  _rximg = re.compile(r"<img\s+(.*?)/?>", re.I)
  _rxattr = re.compile(r"^([-A-Za-z0-9]+)=(\"[^\"]*\"|'[^']*'|\S+)\s*/?")

  def scrape(self, section, url, images=None, match=None, period=900, urledit=None):
    """
    Register a HTML page to scrape for images matching a pattern.
    Images will be available for retrieval via `image()` using the
    names listed in `images`. If `images` and `match` are None, then
    scrapes images directly, otherwise scrapes images off an HTML
    page.

    :arg str section: identifier for images from this address
    :arg str url: html address where to retrieve page or image
    :arg callable urledit: dynamically modify url before request
    :arg list(str) images: list of image names
    :arg re match: regular expression to match image(s)
    :arg int period: interval in seconds between checks
    """
    debug(self._ID, 1, "%s: scrape %s, images %s match %s period %d",
          section, url, images, match, period)
    if match:
      ContentScraper.scrape(self, section, { "page": (url, urledit) },
                            period = period, content_type = "text/html",
                            convert = lambda t,c,v: \
                              self._images(t, v, match, images))
    else:
      ContentScraper.scrape(self, section[:-1], { section[-1]: (url, urledit) },
                            period = period, content_type = "image/*",
                            convert = self._pngdata)

  def _images(self, task, page, match, images):
    debug(self._ID, 2, "%s: scanning images in %s", task.key, task.url)
    img = 0
    for imgtag in re.findall(self._rximg, page.replace("\n", " ")):
      while True:
        m = self._rxattr.match(imgtag)
        if not m:
          break

        arg = m.group(2)
        if len(arg) >= 2 and arg[0] == '"' and arg[-1] == '"':
          arg = arg[1:-1]
        elif len(arg) >= 2 and arg[0] == "'" and arg[-1] == "'":
          arg = arg[1:-1]

        if m.group(1) == "src" and re.search(match, arg):
          arg = arg.replace("&amp;", "&").replace(" ", "%20")
          url = urlparse.urljoin(task.url, arg)
          key = task.key[:-1] + (images[img],)
          debug(self._ID, 2, "%s: retrieving image #%d %s from %s (%s)",
                key, img+1, images[img], url, arg)
          self._reqman.put(Task(url, key, task.period, "image/*",
                                self._pngdata, None))
          img += 1
        imgtag = imgtag[m.end():]

    if img != len(images):
      cherrypy.log("SCRAPER WARNING %s found %d of %d images" %
                   (task.url, img, len(images)))

    return "x"

  def _pngdata(self, task, c, imgdata):
    """Return image `data` as PNG image, using MIME type `format`.
    Returns `data` as is if `format` is image/png, otherwise converts
    the `data` into PNG format and returns that instead."""
    ctype = c.getinfo(pycurl.CONTENT_TYPE)
    if not (ctype and ctype.startswith("image/")):
      cherrypy.log("SCRAPER ERROR %s content type '%s' not an image, headers %s" %
                   (c.getinfo(pycurl.EFFECTIVE_URL), ctype, c.headers))
      return None
    elif ctype != 'image/png':
      debug(self._ID, 3, "%s: converting image %s to png", task.key, ctype)
      png = StringIO()
      PILImage.open(StringIO(imgdata)).save(png, "PNG")
      imgdata = png.getvalue()
      png.close()
    return imgdata

class ImageScraperEntity(RESTEntity):
  """REST entity object for serving miscellaneous scraped images."""
  def __init__(self, app, api, config, mount, prefix):
    RESTEntity.__init__(self, app, api, config, mount)
    self._prefix = (prefix,)

  def validate(self, apiobj, method, api, param, safe):
    if not param.args:
      raise InvalidParameter("Path required")
    for name in param.args:
      if not RX_PATH.match(name):
        raise InvalidParameter("Invalid path")
    item = self._prefix + tuple(param.args)
    if not self.api.scraper.exists(item, lambda v: bool(v.data)):
      raise MissingObject("No such image")
    safe.kwargs["item"] = item
    param.args[:] = []

  @restcall
  @tools.expires(secs=900)
  def get(self, item):
    return self.api.scraper.data(item)

  def _lemon(self, section, images, prov, kind, match, **kwargs):
    base = (self.app.appconfig.lemon % (prov, kind)) + "?"
    return { "url": makeurl(base, type="host", cluster=1, **kwargs),
             "match": match, "images": images,
             "section": self._prefix + section }

  def _lrf(self, section, images, match, **kwargs):
    base = self.app.appconfig.lrf + "?"
    return { "url": makeurl(base, **kwargs),
             "match": match, "images": images,
             "section": self._prefix + section }

  def _sls(self, section, images, match, **kwargs):
    base = (self.app.appconfig.sls % "history") + "?"
    return { "url": makeurl(base, **kwargs),
             "match": match, "images": images,
             "section": self._prefix + section }

def makeurl(baseurl, **kwargs):
  return baseurl + "&".join("%s=%s" % (k, urllib.quote_plus(str(v), "/"))
                            for k, v in sorted(kwargs.iteritems()))
