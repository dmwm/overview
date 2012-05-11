from Overview.Scraper import makeurl
from WMCore.REST.Server import RESTEntity, restcall
from WMCore.REST.Error import InvalidParameter
from WMCore.REST.Format import RawFormat
from WMCore.REST.Tools import tools
from tempfile import mkstemp
import os, re, shapefile

# http://mike.teczno.com/notes/blue-marble-tiles.html
RX_TILE = re.compile(r"^(\d+)-r(\d+)-c(\d+)\.jpg$")
class WorldMapTile(RESTEntity):
  def __init__(self, app, api, config, mount):
    RESTEntity.__init__(self, app, api, config, mount)
    self._datasvc = "http://s3.amazonaws.com/com.modestmaps.bluemarble"
    self._cachedir = app.statedir + "/worldmap"
    if not os.path.isdir(self._cachedir):
      os.makedirs(self._cachedir, 0755)
    self._umask = os.umask(0)
    os.umask(self._umask)

  def validate(self, apiobj, method, api, param, safe):
    if not param.args:
      raise InvalidParameter("Missing tile")
    tile = param.args.pop(0)
    m = RX_TILE.match(tile)
    if not param.args and m:
      safe.kwargs["tile"] = m.groups()

  @restcall(formats=[("image/jpeg", RawFormat())])
  @tools.expires(secs=365*86400)
  def get(self, tile):
    # The cache file. Avoid putting too many files per directory.
    cache = "%s/Z%s/R%s/C%s.jpg" % ((self._cachedir,) + tile)

    # The cache directory for this tile. Create it if needed.
    # Multiple threads may attempt to create it concurrently,
    # so make sure we don't fail if one succeeds over another.
    dirname = cache.rsplit("/", 1)[0]
    if not os.path.isdir(dirname):
      try: os.makedirs(dirname, 0755)
      except:
        if not os.path.isdir(dirname):
          raise

    # If we've already cached the image tile, return it. The
    # data is forever cacheable on disk.
    if os.path.isfile(cache):
      return open(cache).read()

    # Tile not present, fetch and save in cache, then return it.
    # The cache file update has to happen atomically as several
    # threads might attempt it concurrently.
    im = self.api.proxy.fetch(("worldmap", "-".join(tile)), 30,
                              { "data": makeurl("%s/%s-r%s-c%s.jpg" %
                                                ((self._datasvc,) + tile)) },
                              content_type="image/*")
    if im:
      (fd, tmp) = mkstemp(dir=dirname)
      os.write(fd, im)
      os.close(fd)
      os.chmod(tmp, 0666 & ~self._umask)
      os.rename(tmp, cache)

    return im

class WorldMapShape(RESTEntity):
  def __init__(self, app, api, config, mount):
    RESTEntity.__init__(self, app, api, config, mount)
    self._data = app.appconfig.world

  def validate(self, apiobj, method, api, param, safe):
    pass

  @restcall
  @tools.expires(secs=365*86400)
  def get(self, tile):
    return ""
