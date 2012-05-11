from WMCore.Configuration import Configuration
import os

class Config(Configuration):
  """Default Overview server configuration."""
  def __init__(self, authkey = None, key = None, cert = None, nthreads = 5, port = 9000):
    """
    :arg str key: X509 key, usually a proxy.
    :arg str cert: X509 certificate, usually a proxy.
    :arg str authkey: Location of wmcore security header authentication key.
    :arg integer nthreads: Number of server threads to create.
    :arg integer port: Server port."""

    Configuration.__init__(self)
    main = self.section_("main")
    srv = main.section_("server")
    srv.thread_pool = nthreads
    main.application = "overview"
    main.port = port
    main.index = "ui"

    main.authz_defaults = { "role": None, "group": None, "site": None }
    sec = main.section_("tools").section_("cms_auth")
    sec.key_file = authkey

    app = self.section_("overview")
    app.admin = "cms-service-webtools@cern.ch"
    app.description = "CMS computing monitoring service"
    app.title = "CMS Overview"
    app.debug = {}

    app.x509key = key
    app.x509cert = cert
    app.x509cadir = "/etc/grid-security/certificates"

    app.sls = "http://sls.cern.ch/sls/%s.php"
    app.lrf = "http://lsf-rrd.cern.ch/lrf-lsf/info.php"
    app.lemon = "http://lemonweb.cern.ch/lemon-%s/%s.php"
    app.phedex = "https://cmsweb.cern.ch/phedex"
    app.phedexinst = ["prod", "debug", "test"]
    app.sitedb = "https://cmsweb.cern.ch/sitedb"
    app.world = os.environ["NATURALEARTHDATA_ROOT"] + "/data"
    app.cafdata = ["alca:alca",
                   "comm:^(/calo/|/minimumbias/|/monitor/|/testenables/"
		   "|/hltdebug/|/hcalhpdnoise/|/randomtriggers/"
		   "|/test/commissioning|/calprivate|/barrelmuon/"
		   "|/endcapsmuon/|/minbias/|/[^/]*(cosmic|beamhalo)"
		   "|/global[^/]*-A/)",
		   "phys:^"]

    views = self.section_("views")
    ui = views.section_("ui")
    ui.object = "Overview.FrontPage.FrontPage"

    views.section_("data").object = "Overview.Data.Data"
    views.section_("image").object = "Overview.Data.Image"

class DBConfig(Configuration):
  """Overview database data provider server configuration."""
  def __init__(self, phedexdb = None, nthreads = 5, port = 9001):
    """
    :arg str phedexdb: Location of PhEDEx database configuration,
      "module.object". Defaults to "PhEDExAuth.dbparam".
    :arg integer nthreads: Number of server threads to create.
    :arg integer port: Server port."""

    Configuration.__init__(self)
    main = self.section_("main")
    srv = main.section_("server")
    srv.thread_pool = nthreads
    srv.socket_host = "127.0.0.1"
    main.application = "overviewdb"
    main.port = port
    main.index = None

    app = self.section_("overviewdb")
    app.admin = "cms-service-webtools@cern.ch"
    app.description = "CMS Overview database data source"
    app.title = "CMS Overview Database"

    views = self.section_("views")
    phedex = views.section_("phedex")
    phedex.object = "Overview.DataDB.PhEDEx"
    phedex.db = phedexdb or "PhEDExAuth.dbparam"
