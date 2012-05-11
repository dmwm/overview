from Overview.Scraper import ImageScraperEntity, makeurl
import time

class DDTImage(ImageScraperEntity):
  """REST entity object for distributed data transfer plots."""
  def __init__(self, app, api, config, mount):
    ImageScraperEntity.__init__(self, app, api, config, mount, "transfers")
    map(lambda args: api.scraper.scrape(**args),
        (self._graph(("t0-ch-cern", "request"), "request",
                     link="dest", no_mss="false", span="3600",
                     node="T0_CH_CERN_MSS"),
         self._graph(("t0-ch-cern", "pending", "self"), "pending",
                     link="dest", no_mss="false", span="3600",
                     from_node=".*", to_node="T0_CH_CERN"),
         self._graph(("t0-ch-cern", "pending", "t1"), "pending",
                     link="link", no_mss="false", span="3600",
                     from_node="T0_CH_CERN_Export", to_node="T1.*"),
         self._graph(("t0-ch-cern", "quality", "t1"), "quality_all",
                     link="link", no_mss="false", span="3600",
                     from_node="T0_CH_CERN_Export", to_node="T1.*"),
         self._graph(("t0-ch-cern", "pending", "mss"), "pending",
                     link="link", no_mss="false", span="3600",
                     from_node="T0_CH_CERN_Export", to_node="T0_CH_CERN_MSS"),
         self._graph(("t0-ch-cern", "quantity", "mss"), "quantity",
                     link="link", no_mss="false", span="3600",
                     from_node="T0_CH_CERN_Export", to_node="T0_CH_CERN_MSS"),
         self._graph(("t0-ch-cern", "idle"), "idle",
                     link="link", no_mss="false", span="3600",
                     node="T0_CH_CERN_MSS"),
         self._graph(("t0-ch-cern", "request"), "request",
                     link="dest", no_mss="false", span="3600",
                     node="T0_CH_CERN_MSS")))

    for s in ("T1_CH_CERN", "T1_DE_KIT", "T1_ES_PIC", "T1_FR_CCIN2P3",
               "T1_IT_CNAF", "T1_TW_ASGC", "T1_UK_RAL", "T1_US_FNAL",
	       "T2_CH_CERN"):
      pretty = s.lower().replace("_", "-")
      map(lambda args: api.scraper.scrape(**args),
          (self._graph((pretty, "request"), "request",
                       link="dest", no_mss="false", span="3600",
                       node=s),
	   self._graph((pretty, "pending", "self"), "pending",
                       link="dest", no_mss="false", span="3600",
                       from_node=".*", to_node=s),
	   self._graph((pretty, "pending", "t0-t1"), "pending",
                       link="link", no_mss="true", span="3600",
                       from_node="^T[01]", to_node=s),
	   self._graph((pretty, "quality", "t0-t1"), "quality_all",
                       link="link", no_mss="true", span="3600",
                       from_node="^T[01]", to_node=s),
	   self._graph((pretty, "quantity", "buffer"), "quantity",
                       link="link", no_mss="true", span="3600",
                       from_node=".*", to_node=((s.startswith("T1")
                                                 and (s + "_Buffer"))
                                                or s)),
	   self._graph((pretty, "quantity", "all"), "quantity",
                       link="link", no_mss="false", span="3600",
                       from_node=".*", to_node=s),
	   self._graph((pretty, "idle"), "idle",
                       link="link", no_mss="false", span="3600",
                       node=s),
	   self._graph((pretty, "request"), "request",
                       link="dest", no_mss="false", span="3600",
                       node=s)))

  def _urledit(self, url):
    now = int((time.time() + 3599)/3600) * 3600
    return "%s&starttime=%d&endtime=%d" % (url, now - 96*3600, now)

  def _graph(self, section, base, **kwargs):
    base = self.app.appconfig.phedex + ("/graphs/%s?" % base)
    return { "url": makeurl(base, conn="Prod/WebSite", **kwargs),
             "urledit": self._urledit, "match": None, "images": None,
             "section": self._prefix + section }
