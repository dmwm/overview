from Overview.Scraper import ImageScraperEntity

class JobQueueImage(ImageScraperEntity):
  """REST entity object for serving scraped images for job queues."""
  def __init__(self, app, api, config, mount):
    ImageScraperEntity.__init__(self, app, api, config, mount, "job-queue")

    for x in ("cmscaf1nd", "cmscaf1nh", "cmscaf1nw", "cmscafalcamille",
              "cmexpress", "cmsinter", "cmsphedex", "cmsrelval",
              "cmsrepack", "cmst0"):
      api.scraper.scrape(**self._lrf((), [x], "rrd_RUN_d.gif",
                                     queue=x, detailed=0,
                                     auto_update=0, time=0))
