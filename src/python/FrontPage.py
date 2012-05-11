from WMCore.REST.Server import RESTFrontPage
from glob import glob
import os, re

class FrontPage(RESTFrontPage):
  """Overview front page.

  Overview provides only one web page, the front page. The page just
  loads the javascript user interface, complete with CSS and all JS
  code embedded into it. The only additional callouts needed are the
  image resources needed for YUI and other site graphics.

  The JavaScript code performs all the app functionality via the REST
  interface defined by the :class:`~.Data` class. Mostly it just
  organises available monitoring entities into a nice user interface.
  Virtually all interactive functionality is done on the client side.

  User navigation state is stored in the fragment part of the URL, e.g.
  <https://cmsweb.cern.ch/overview/phedex/transfer-rate>."""

  def __init__(self, app, config, mount):
    """
    :arg app: reference to the application object.
    :arg config: reference to the configuration.
    :arg str mount: URL mount point."""
    CONTENT = os.path.abspath(__file__).rsplit('/', 5)[0]
    X = (__file__.find("/xlib/") >= 0 and "x") or ""
    ROOT = "%s/%sdata/web/" % (CONTENT, X)

    roots = \
    {
      "overview":
      {
        "root": ROOT,
        "rx": re.compile(r"^[-A-Za-z0-9]+\.(?:css|js|png|gif|html)$")
      },

      "yui":
      {
        "root": "%s/build/" % os.environ["YUI3_ROOT"],
        "rx": re.compile(r"^[-a-z0-9]+/[-a-z0-9/_]+\.(?:css|js|png|gif)$")
      },

      "d3":
      {
        "root": "%s/data/" % os.environ["D3_ROOT"],
        "rx": re.compile(r"^[-a-z0-9]+/[-a-z0-9]+(?:\.[-a-z0-9]+)?(?:\.min)?\.(?:css|js)$")
      },

      "polymaps":
      {
        "root": "%s/data/" % os.environ["POLYMAPS_ROOT"],
        "rx": re.compile(r"^[-a-z0-9]+(?:\.min)?\.(?:css|js)$")
      },

      "xregexp":
      {
        "root": "%s/data/xregexp/" % os.environ["XREGEXP_ROOT"],
        "rx": re.compile(r"^[-a-z0-9]+(?:-min)?\.js$")
      }
    }

    MIN = (os.path.exists("%s/overview-min.html" % ROOT) and "-min") or ""
    frontpage = "overview/overview%s.html" % MIN
    viewhtml = glob(ROOT + "view-*" + MIN + ".html")
    viewcssref = ["overview/%s" % x.rsplit("/", 1)[1]
                   for x in glob(ROOT + "view-*" + MIN + ".css")]
    viewjsref = ["overview/%s" % x.rsplit("/", 1)[1]
                 for x in glob(ROOT + "view-*" + MIN + ".js")]
    cssref = "@MOUNT@/static?" + "&".join(["yui/cssreset/reset%s.css" % MIN,
                                           "yui/cssfonts/fonts%s.css" % MIN,
                                           "yui/cssgrids/grids%s.css" % MIN,
                                           "yui/cssbase/base%s.css" % MIN,
                                           "overview/overview%s.css" % MIN,
                                           "overview/button%s.css" % MIN,
                                           "overview/popup-menu%s.css" % MIN,
                                           "overview/world-map%s.css" % MIN]
                                          + viewcssref)
    jsref = "@MOUNT@/static?" + "&".join(["rest/preamble.js",
                                          "yui/yui/yui%s.js" % MIN,
                                          "polymaps/polymaps%s.js" % MIN.replace("-", ".")] +
                                         ["d3/d3/d3%s%s.js" % (x, MIN.replace("-", "."))
                                          for x in ("", ".layout", ".chart", ".geo")] +
                                         ["xregexp/xregexp%s%s.js" % (x, MIN)
                                          for x in ("", "-unicode-base",
                                                    "-unicode-categories")] +
                                         ["overview/%s%s.js" % (x, MIN)
                                          for x in ("sprintf", "utils", "time",
                                                    "d3ext", "app", "cache",
                                                    "view")]
                                         + viewjsref +
                                         ["overview/start%s.js" % MIN])

    RESTFrontPage.__init__(self, app, config, mount, frontpage, roots,
                           substitutions = { "CSSREF": cssref, "JSREF": jsref },
                           embeddings = { "VIEWHTML": viewhtml })
