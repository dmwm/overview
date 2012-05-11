from Overview.Scraper import ImageScraperEntity

class LXBatchImage(ImageScraperEntity):
  """REST entity object for serving scraped images for EOSCMS."""
  def __init__(self, app, api, config, mount):
    ImageScraperEntity.__init__(self, app, api, config, mount, "lxbatch")

    for x in ("cmscaf", "cmscafexclusive", "cmscafshared", "cmsexpress",
              "cmsinter", "cmsphedex", "cmst0"):
      map(lambda args: api.scraper.scrape(**args),
          (self._lemon((x,), ["cpu", "net"],
                       "web", "info", "/lemon-web/images/",
                       entity="lxbatch/%s" % x, time=0, offset=0),))

      if x in ("cmscafexclusive", "cmscafshared", "cmsexpress"):
        continue

      map(lambda args: api.scraper.scrape(**args),
          (self._lemon((x,), ["loadavg"],
                       "web", "metric_distribution", "cache/",
                       entity="lxbatch/%s" % x, metric="LoadAvg", field="LoadAvg"),))
