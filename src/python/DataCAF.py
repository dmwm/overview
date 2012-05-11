from WMCore.REST.Server import RESTEntity, restcall
from WMCore.REST.Tools import tools
import cjson, re

class CAFData(RESTEntity):
  """REST entity object for CAF information."""
  def __init__(self, app, api, config, mount):
    _rxtotal = re.compile(r"useable total space in TB:.*?<td[^>]*>([0-9,]+)</td>")
    _rxfree = re.compile(r"useable free space in TB:.*?<td[^>]*>([0-9,]+)</td>")
    _rxlist = [(l, re.compile(rx)) for l, rx in
               map(lambda s: s.split(":", 1), app.appconfig.cafdata)]
    _dataurl = "%s/datasvc/json/prod/blockreplicas?node=T2_CH_CERN" % app.appconfig.phedex
    _diskurl = "%s?id=EOSCMS" % (app.appconfig.sls % "service") # FIXME CASTORCMS_CMSCAF?

    def _space(task, c, page):
      # Parse the SLS disk space information. Locate the total
      # space information field and extract total CAF disk size
      # from it.  Note that SLS reports volume in metric, while
      # we use powers of two for the rest.  Only 95% of the
      # reported space is actually valid for use.
      page = page.replace("\n", " ")
      mt = re.search(_rxtotal, page)
      mf = re.search(_rxfree, page)
      return mt and mf and \
        { "total": float(mt.group(1).replace(",", "")) * 0.95 * 1000**4 / 1024**4,
          "free":  float(mf.group(1).replace(",", "")) * 0.95 * 1000**4 / 1024**4 }

    def _blocks(task, c, page):
      # Parse PhEDEx json data. Find datasets from blocknames, and
      # accumulate statistics on total size and creation time.
      # Assign each dataset to the first label in rxlist which
      # matches the dataset name.
      value = {}
      for block in cjson.decode(page)['phedex']['block']:
	dsname = block['name'].split("#")[0]
	size = float(block['replica'][0]['bytes'])
        ctime = float(block['replica'][0]['time_create'])
	label = "other"
	for l, rx in _rxlist:
	  if rx.search(dsname):
	    label = l
	    break

	if label not in value:
	  value[label] = {}

	if dsname not in value[label]:
	  value[label][dsname] = { 'size': size, 'ctime': ctime }
	else:
	  value[label][dsname]['size'] += size
          if ctime < value[label][dsname]['ctime']:
            value[label][dsname]['ctime'] = ctime

      return value

    RESTEntity.__init__(self, app, api, config, mount)
    api.scraper.scrape(("caf", "usage"), { "value": _diskurl },
                       content_type="text/html", convert=_space)
    api.scraper.scrape(("caf", "blocks"), { "value": _dataurl },
                       convert=_blocks)

  def validate(self, apiobj, method, api, param, safe):
    if len(param.args) == 1 and param.args[0] in ('alca', 'comm', 'phys', 'other'):
      safe.kwargs["group"] = param.args.pop(0)

  @restcall
  @tools.expires(secs=1800)
  def get(self, group):
    result = { "capacity": { "total": 0, "free": 0 },
               "size": 0, "blocks": None }

    total = self.api.scraper.data(("caf", "usage", "value"))
    if total:
      result["capacity"] = total

    data = self.api.scraper.data(("caf", "blocks", "value"))
    if data:
      blocks = data.get(group, {})
      size = sum(b['size'] for b in blocks.values())
      result["size"] = size
      result["blocks"] = blocks

    return [result]
