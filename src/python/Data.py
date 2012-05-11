import os
from WMCore.REST.Server import RESTApi
from WMCore.REST.Format import RawFormat
from Overview.DataC2CMS import C2CMSImage
from Overview.DataCAF import CAFData
from Overview.DataDDT import DDTImage
from Overview.DataEOS import EOSImage
from Overview.DataHost import HostData
from Overview.DataJobQueue import JobQueueImage
from Overview.DataLXBatch import LXBatchImage
from Overview.DataPhEDEx import PhEDEx
from Overview.DataWorldMap import WorldMapShape, WorldMapTile
from Overview.Scraper import ContentProxy, ContentScraper, ImageScraper
from Overview.Debug import debug

class Data(RESTApi):
  """Server object for REST data access API."""
  def __init__(self, app, config, mount):
    """
    :arg app: reference to application object; passed to all entities.
    :arg config: reference to configuration; passed to all entities.
    :arg str mount: API URL mount point; passed to all entities."""
    RESTApi.__init__(self, app, config, mount)
    for k, v in app.appconfig.debug.iteritems():
      debug[k] = v
    if not getattr(app, 'contentproxy', None):
      app.contentproxy = ContentProxy(app.appconfig)
    if not getattr(app, 'contentscraper', None):
      app.contentscraper = ContentScraper(app.appconfig)
    self.proxy = app.contentproxy
    self.scraper = app.contentscraper

    self._add({ "caf":        CAFData(app, self, config, mount),
                "phedex":     PhEDEx(app, self, config, mount),
                "host":       HostData(app, self, config, mount),
                "world-map":  WorldMapShape(app, self, config, mount) })

class Image(RESTApi):
  """Server object for REST image access API."""
  def __init__(self, app, config, mount):
    """
    :arg app: reference to application object; passed to all entities.
    :arg config: reference to configuration; passed to all entities.
    :arg str mount: API URL mount point; passed to all entities."""
    CONTENT = os.path.abspath(__file__).rsplit('/', 5)[0]
    X = (__file__.find("/xlib/") >= 0 and "x") or ""

    RESTApi.__init__(self, app, config, mount)
    self.missing = open("%s/%sdata/web/missing.png" % (CONTENT, X)).read()
    self.formats = [("image/png", RawFormat())]
    if not getattr(app, 'contentproxy', None):
      app.contentproxy = ContentProxy(app.appconfig)
    if not getattr(app, 'imagescraper', None):
      app.imagescraper = ImageScraper(app.appconfig)
    self.proxy = app.contentproxy
    self.scraper = app.imagescraper

    self._add({ "eoscms":     EOSImage(app, self, config, mount),
                "c2cms":      C2CMSImage(app, self, config, mount),
                "ddt":        DDTImage(app, self, config, mount),
                "lxbatch":    LXBatchImage(app, self, config, mount),
                "job-queue":  JobQueueImage(app, self, config, mount),
                "world-map":  WorldMapTile(app, self, config, mount) })
