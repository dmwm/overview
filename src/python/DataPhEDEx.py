import cherrypy, cjson, time, calendar, traceback
from Overview.Scraper import makeurl
from WMCore.REST.Server import RESTEntity, restcall
from WMCore.REST.Error import InvalidParameter, NoSuchInstance, \
                              APINotSpecified, APIMethodMismatch

class DataServiceEntity(RESTEntity):
  # Use supplied 'expires' for response header, but cache data only for 120s.
  _retention = 120

  def __init__(self, app, api, config, mount):
    RESTEntity.__init__(self, app, api, config, mount)
    self._datasvc = app.appconfig.phedex + "/datasvc/json"

  def validate(self, apiobj, method, api, param, safe):
    pass

  def _convert(self, task, c, value):
    return cjson.decode(value)

  def _retrieve(self, key, urls, convert=None, merge=None, expires=None):
    expires = expires or getattr(self, "_expires", 86400)
    val = self.api.proxy.fetch(("phedex", "datasvc") + key, self._retention, urls,
                               convert=convert or self._convert, merge=merge)
    cherrypy.response.headers["Cache-Control"] = "max-age=%d" % expires
    return val

class TranslatedDataServiceEntity(DataServiceEntity):
  # _entity = "nodes"
  # _payload = "node"
  # _keys = ("a", "b", "c")
  # _xkeys = { "c": ("d", "e", "f") }
  # _casts = { "d": int, "e": float }

  def __init__(self, app, api, config, mount):
    DataServiceEntity.__init__(self, app, api, config, mount)
    if not getattr(self, "_casts", None):
      self._casts = {}
    if not getattr(self, "_xkeys", None):
      self._xkeys = {}
    self._columns = [((k in self._xkeys) and { k: self._xkeys[k] }) or k
                     for k in self._keys]

  def _cast(self, k, v):
    if v is not None and k in self._casts:
      return self._casts[k](v)
    else:
      return v

  def _xconvert(self, key, val):
    if key in self._xkeys:
      return map(lambda v: [self._cast(k, v.get(k, None))
                            for k in self._xkeys[key]],
                 val)
    else:
      return self._cast(key, val)

  def _convert(self, task, c, value):
    return map(lambda v: [self._xconvert(k, v.get(k, None)) for k in self._keys],
               cjson.decode(value)["phedex"][self._payload])

  @restcall
  def get(self, instance):
    urls = { "data": makeurl("%s/%s/%s" % (self._datasvc, instance, self._entity)) }
    data = self._retrieve((instance, self._entity), urls)
    cherrypy.request.rest_generate_preamble = { "columns": self._columns }
    return data

class LocalDataByDay(DataServiceEntity):
  _svc = "http://localhost:9001/overviewdb/phedex"

  def validate(self, apiobj, method, api, param, safe):
    DataServiceEntity.validate(self, apiobj, method, api, param, safe)

    if not param.args or not isinstance(param.args[0], basestring):
      raise InvalidParameter("Missing date argument")
    try:
      day = param.args.pop(0)
      if day == "today":
        safe.kwargs["mode"] = "H"
        safe.kwargs["day"] = int(time.time() / 86400) * 86400
      elif day[0] in ("H", "D") and day[1:].isdigit():
        safe.kwargs["mode"] = day[0]
        safe.kwargs["day"] = calendar.timegm(time.strptime(day[1:], "%Y%m%d"))
      else:
        raise InvalidParameter("Invalid date parameter")
    except ValueError, e:
      raise InvalidParameter("Invalid date parameter", errobj = e,
                             trace = traceback.format_exc())

  @restcall
  def get(self, instance, mode, day):
    expires = ((time.time() - day >= 36*3600 and 30*86400) or 900)
    day = mode + time.strftime("%Y%m%d", time.gmtime(day))
    urls = { "data": makeurl("%s/%s/%s/%s" % (self._svc, instance, self._item, day)) }
    data = self._retrieve((instance, self._item, day), urls, expires=expires)
    cherrypy.request.rest_generate_preamble = data["desc"]
    return data["result"]

class Nodes(TranslatedDataServiceEntity):
  _entity = "nodes"
  _payload = "node"
  _keys = ("name", "kind", "technology", "se")

class Links(TranslatedDataServiceEntity):
  _entity = "links"
  _payload = "link"
  _keys = ("kind", "status", "distance",
           "from", "from_kind", "from_agent_protocols",
           "from_agent_update", "from_agent_age",
           "to", "to_kind", "to_agent_protocols",
           "to_agent_update", "to_agent_age")
  _casts = { "from_agent_update": float,
             "to_agent_update": float,
             "distance": int }

class Groups(TranslatedDataServiceEntity):
  _entity = "groups"
  _payload = "group"
  _keys = ("name",)

class GroupUsage(TranslatedDataServiceEntity):
  _expires = 3600
  _entity = "groupusage"
  _payload = "node"
  _keys = ("name", "se", "group")
  _xkeys = { "group": ("name", "dest_bytes", "dest_files", "node_bytes", "node_files") }
  _casts = { "dest_bytes": int, "dest_files": int, "node_bytes": int, "node_files": int }

class LinkEvents(LocalDataByDay):
  _item = "link-events"

class LinkStats(LocalDataByDay):
  _item = "link-stats"

class DestStats(LocalDataByDay):
  _item = "dest-stats"

class BlockLatency(LocalDataByDay):
  _item = "block-latency"

class PhEDEx(RESTEntity):
  """REST entity object for PhEDEx information."""
  def __init__(self, app, api, config, mount):
    self._instances = app.appconfig.phedexinst
    self._entities = { "nodes":         Nodes(app, api, config, mount),
                       "links":         Links(app, api, config, mount),
                       "groups":        Groups(app, api, config, mount),
                       "group-usage":   GroupUsage(app, api, config, mount),
                       "link-events":   LinkEvents(app, api, config, mount),
                       "link-stats":    LinkStats(app, api, config, mount),
                       "dest-stats":    DestStats(app, api, config, mount),
                       "block-latency": BlockLatency(app, api, config, mount) }

  def validate(self, apiobj, method, api, param, safe):
    # Check we have an instance
    if not param.args or param.args[0] not in self._instances:
      raise NoSuchInstance()
    instance = param.args.pop(0)

    # Check we have sub-api defined.
    if not param.args:
      raise APINotSpecified()

    if param.args[0] not in self._entities:
      raise APIMethodMismatch()

    # Pass validation to nested entity.
    entity = self._entities[param.args.pop(0)]
    entity.validate(apiobj, method, api, param, safe)

    # Now wrap the nested safe parameters into a proxy to our own get().
    kwargs = dict((k, v) for k, v in safe.kwargs.iteritems())
    for k in kwargs: del safe.kwargs[k]
    safe.kwargs["kwargs"] = kwargs
    safe.kwargs["entity"] = entity
    safe.kwargs["instance"] = instance

  @restcall
  def get(self, instance, entity, kwargs):
    return entity.get(instance=instance, **kwargs)
