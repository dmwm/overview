from WMCore.REST.Server import DatabaseRESTApi, RESTEntity, restcall
from WMCore.REST.Error import InvalidParameter
import time, calendar, cherrypy, traceback

class DataByDay(RESTEntity):
  def validate(self, apiobj, method, api, param, safe):
    if len(param.args) == 1 and isinstance(param.args[0], basestring):
      day = param.args.pop(0)
      if day == "today":
        safe.kwargs["span"] = 3600
        safe.kwargs["day"] = int(time.time() / 86400) * 86400
      elif day[0] in ("H", "D") and day[1:].isdigit():
        try:
          safe.kwargs["span"] = (3600 if day[0] == "H" else 86400)
          safe.kwargs["day"] = calendar.timegm(time.strptime(day[1:], "%Y%m%d"))
        except ValueError, e:
          raise InvalidParameter("Invalid date", errobj = e,
                                 trace = traceback.format_exc())

  @restcall
  def get(self, span, day):
    # Data from day within 36 hours from now is volatile with 15-minute
    # expire time, all other historical data is aggressively cacheable.
    expires = ((time.time() - day >= 36*3600 and 30*86400) or 900)
    cherrypy.response.headers["Cache-Control"] = "max-age=%d" % expires
    return self.api.query(None, None, self._sql, span=span,
                          starttime=day, endtime=day+86400)

class LinkEvents(DataByDay):
  # quality = done/(done + failed) if done
  _sql = """select
              trunc(timebin/:span)*:span timebin,
              t.name to_node, f.name from_node,
              nvl(sum(h.done_bytes),0)   done_bytes,
              nvl(sum(h.done_files),0)   done_files,
              nvl(sum(h.fail_bytes),0)   fail_bytes,
              nvl(sum(h.fail_files),0)   fail_files,
              nvl(sum(h.expire_bytes),0) expire_bytes,
              nvl(sum(h.expire_files),0) expire_files,
              nvl(sum(h.try_bytes),0)    try_bytes,
              nvl(sum(h.try_files),0)    try_files
            from t_history_link_events h
              join t_adm_node f on f.id = h.from_node
              join t_adm_node t on t.id = h.to_node
            where timebin >= :starttime and timebin < :endtime
            group by trunc(timebin/:span)*:span, t.name, f.name"""

class LinkStats(DataByDay):
  _sql = """select
              trunc(timebin/:span)*:span timebin,
              t.name to_node, f.name from_node,
              nvl(sum(pend_bytes)      keep (dense_rank last order by timebin asc),0) pend_bytes,
              nvl(sum(pend_files)      keep (dense_rank last order by timebin asc),0) pend_files,
              nvl(sum(wait_bytes)      keep (dense_rank last order by timebin asc),0) wait_bytes,
              nvl(sum(wait_files)      keep (dense_rank last order by timebin asc),0) wait_files,
              nvl(sum(cool_bytes)      keep (dense_rank last order by timebin asc),0) cool_bytes,
              nvl(sum(cool_files)      keep (dense_rank last order by timebin asc),0) cool_files,
              nvl(sum(ready_bytes)     keep (dense_rank last order by timebin asc),0) ready_bytes,
              nvl(sum(ready_files)     keep (dense_rank last order by timebin asc),0) ready_files,
              nvl(sum(xfer_bytes)      keep (dense_rank last order by timebin asc),0) xfer_bytes,
              nvl(sum(xfer_files)      keep (dense_rank last order by timebin asc),0) xfer_files,
              nvl(sum(confirm_bytes)   keep (dense_rank last order by timebin asc),0) confirm_bytes,
              nvl(sum(confirm_files)   keep (dense_rank last order by timebin asc),0) confirm_files,
              nvl(sum(param_rate)      keep (dense_rank last order by timebin asc),0) param_rate,
              nvl(sum(param_latency)   keep (dense_rank last order by timebin asc),0) param_latency
            from t_history_link_stats h
              join t_adm_node f on f.id = h.from_node
              join t_adm_node t on t.id = h.to_node
            where timebin >= :starttime and timebin < :endtime
            group by trunc(timebin/:span)*:span, t.name, f.name"""

class DestStats(DataByDay):
  _sql = """select
              trunc(timebin/:span)*:span timebin, n.name node,
              nvl(sum(dest_bytes)      keep (dense_rank last order by timebin asc),0) dest_bytes,
              nvl(sum(dest_files)      keep (dense_rank last order by timebin asc),0) dest_files,
              nvl(sum(cust_dest_bytes) keep (dense_rank last order by timebin asc),0) cust_dest_bytes,
              nvl(sum(cust_dest_files) keep (dense_rank last order by timebin asc),0) cust_dest_files,
              nvl(sum(src_bytes)       keep (dense_rank last order by timebin asc),0) src_bytes,
              nvl(sum(src_files)       keep (dense_rank last order by timebin asc),0) src_files,
              nvl(sum(node_bytes)      keep (dense_rank last order by timebin asc),0) node_bytes,
              nvl(sum(node_files)      keep (dense_rank last order by timebin asc),0) node_files,
              nvl(sum(cust_node_bytes) keep (dense_rank last order by timebin asc),0) cust_node_bytes,
              nvl(sum(cust_node_files) keep (dense_rank last order by timebin asc),0) cust_node_files,
              nvl(sum(miss_bytes)      keep (dense_rank last order by timebin asc),0) miss_bytes,
              nvl(sum(miss_files)      keep (dense_rank last order by timebin asc),0) miss_files,
              nvl(sum(cust_miss_bytes) keep (dense_rank last order by timebin asc),0) cust_miss_bytes,
              nvl(sum(cust_miss_files) keep (dense_rank last order by timebin asc),0) cust_miss_files,
              nvl(sum(request_bytes)   keep (dense_rank last order by timebin asc),0) request_bytes,
              nvl(sum(request_files)   keep (dense_rank last order by timebin asc),0) request_files,
              nvl(sum(idle_bytes)      keep (dense_rank last order by timebin asc),0) idle_bytes,
              nvl(sum(idle_files)      keep (dense_rank last order by timebin asc),0) idle_files
            from t_history_dest h
              join t_adm_node n on n.id = h.node
            where timebin >= :starttime and timebin < :endtime
            group by trunc(timebin/:span)*:span, n.name"""

class BlockLatency(DataByDay):
  _sql = """select
              n.name destination,
              l.last_replica,
              -- l.percent95_replica,
              -- l.percent75_replica,
              -- l.percent50_replica,
              -- l.percent25_replica,
              l.first_replica,
              -- l.suspend_time, -- l.total_suspend_time,
              l.files,
              l.bytes,
              l.latency
            from t_log_block_latency l
              join t_adm_node n on n.id = l.destination
            where l.last_replica >= :starttime
              and l.last_replica < :endtime
              and l.last_replica is not null
              and l.last_replica > l.first_replica
              and :span > 1"""

class PhEDEx(DatabaseRESTApi):
  """Server object for REST API to PhEDEx database data."""
  def __init__(self, app, config, mount):
    """
    :arg app: reference to application object; passed to all entities.
    :arg config: reference to configuration; passed to all entities.
    :arg str mount: API URL mount point; passed to all entities."""
    DatabaseRESTApi.__init__(self, app, config, mount)
    self._add({ "link-events":   LinkEvents(app, self, config, mount),
                "link-stats":    LinkStats(app, self, config, mount),
                "dest-stats":    DestStats(app, self, config, mount),
                "block-latency": BlockLatency(app, self, config, mount) })
