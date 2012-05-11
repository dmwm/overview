from Overview.Scraper import ImageScraperEntity

class C2CMSImage(ImageScraperEntity):
  """REST entity object for serving scraped images for CMS Castor instances."""
  def __init__(self, app, api, config, mount):
    ImageScraperEntity.__init__(self, app, api, config, mount, "c2cms")

    # "server", "t0test" deliberately excluded - not monitored in sls/lemon
    for x in ("default", "cmsprod", "cmsprodlogs", "cmst3", "t0export",
              "t0streamer", "t0input", "t0temp", "t1transfer"):
      xup = "CASTORCMS_%s" % x.upper()
      map(lambda args: api.scraper.scrape(**args),
          (self._lemon((x,), ["cpu", "net"],
                       "status", "info", "/lemon-status/images/",
                       entity="c2cms/%s" % x, time="0.0.5", offset=0),
           self._lemon((x,), ["loadavg"],
                       "status", "metric_distribution", "cache/",
                       entity="c2cms/%s" % x, metric="LoadAvg", field="LoadAvg"),
           self._sls((x,), ["availability"], "graph", id=xup,
                     more="availability", period="24h"),
           self._sls((x,), ["disk-space"], "graph", id=xup,
                     more="nv:Total Space TB", period="day"),
           self._sls((x,), ["disk-free"], "graph", id=xup,
                     more="nv:Percentage Free Space", period="week")))
