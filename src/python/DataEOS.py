from Overview.Scraper import ImageScraperEntity

class EOSImage(ImageScraperEntity):
  """REST entity object for serving EOSCMS images."""
  def __init__(self, app, api, config, mount):
    ImageScraperEntity.__init__(self, app, api, config, mount, "eoscms")

    map(lambda args: api.scraper.scrape(**args),
        (self._sls(("default",), ["availability"], "graph",
                   id="EOSCMS", more="availability", period="24h"),
         self._sls(("default",), ["open-files"], "graph",
                   id="EOSCMS", more="nv_mult", no_nvs=2,
                   nv1="eos_space_ropen", nv2="eos_space_wopen",
                   grp="open files", period="24h"),
         self._sls(("default",), ["disk-io"], "graph",
                   id="EOSCMS", more="nv_mult", no_nvs=2,
                   nv1="eos_space_diskreadratemb", nv2="eos_space_diskwriteratemb",
                   grp="aggeregate disk i/o rate MB/s", period="24h"),
         self._sls(("default",), ["net"], "graph",
                   id="EOSCMS", more="nv_mult", no_nvs=2,
                   nv1="eos_space_netinratemib", nv2="eos_space_netoutratemib",
                   grp="aggeregate network rate MB/s", period="24h"),
         self._sls(("default",), ["space-use"], "graph",
                   id="EOSCMS", more="nv_mult", no_nvs=2,
                   nv1="eos_space_nominalsize", nv2="eos_space_usedbytes",
                   rp="nominal vs used space", period="24h"),
         self._sls(("default",), ["xroot-latency"], "graph",
                   id="EOSCMS", more="nv_mult", no_nvs=2,
                   nv1="XRDCPin time", nv2="XRDCPout time",
                   grp="XROOT access latency", period="24h"),
         self._sls(("default",), ["srm-latency"], "graph",
                   id="EOSCMS", more="nv_mult", no_nvs=4,
                   nv1="PutFile time", nv2="GetFile time",
                   nv3="GetTurl time", nv4="DeleteFile time",
                   grp="SRM access latency", period="24h")))

    for x in ("storage", "gridftp", "servers"):
      map(lambda args: api.scraper.scrape(**args),
          (self._lemon((x,), ["cpu", "net"],
                       "status", "info", "/lemon-status/images/",
                       entity="eoscms/%s" % x, time="0.0.5", offset=0),
           self._lemon((x,), ["loadavg"],
                       "status", "metric_distribution", "cache/",
                       entity="eoscms/%s" % x, metric="LoadAvg", field="LoadAvg")))
