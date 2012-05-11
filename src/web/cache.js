var Cache = function(Y, owner, debug)
{
  /** Myself. */
  var _self = this;

  /** Validity flag: force reload from data server. */
  var _RELOAD = -1;

  /** Validity flag: soft reload, let browser decide whether to reload. */
  var _INVALID = 0;

  /** Validity flag: data is present and valid. */
  var _VALID = 1;

  /** Pending XHR requests. */
  var _pending = {};

  /** Item descriptions and their raw data. */
  var _data = {};

  /** XHR IO engine. We want events emitted to get full info. */
  var _io = new Y.IO({ emitFacade: true });

  /** Create an element in the cache. */
  var _make = function(path)
  {
    var id = "#debug-data" + path.replace(/[^A-Za-z0-9]+/, "-");
    var n = debug.one(id);
    if (! n)
    {
      n = Y.Node.create("<p id='" + id + "'"
                        + (path.indexOf("?") >= 0 ? (" title='" + path + "'") : "")
                        + ">" + path.replace(/\?.*/, "?...") + "</p>");
      debug.append(n);
    }

    _data[path] = { valid: _INVALID, expires: 0, obj: null, node: n, callbacks: [] };
  }

  /** Complete fetching the request @a obj. Marks the object valid and removes
      the XHR pending object for it. Marks state complete if no more data is
      pending download. Calls _rebuildAndUpdate if state has become complete,
      otherwise schedules the call if no further updates arrive within 500 ms. */
  var _complete = function(path, obj, o)
  {
    var hdate = o.getResponseHeader("Date");
    var hcache = o.getResponseHeader("Cache-Control");
    var maxage = (hcache && /max-age=(\d+)/.exec(hcache));

    obj.node.setAttribute("class", "valid");
    obj.expires = (hdate && maxage
                   ? (new Date(hdate).getTime()/1000 + parseInt(maxage[1]))
                   : (new Date().getTime()/1000 + 900));
    obj.valid = _VALID;
    delete _pending[path];

    _self.complete = true;
    for (var n in _data)
      if (_data[n].valid != _VALID || n in _pending)
        _self.complete = false;

    while (obj.callbacks.length)
    {
      cb = obj.callbacks.shift();
      cb.args.unshift(_self.complete, obj.obj);
      cb.func.apply(owner, cb.args);
    }
  };

  /** Utility function to abort all pending GET requests. */
  var _abort = function()
  {
    for (var p in _pending)
      _pending[p].abort();
    _pending = {};
  };

  /** Report a data server interaction error. */
  var _error = function(file, line, category, message, id)
  {
    _abort();
    for (var path in _data)
      _data[path].valid = _RELOAD;

    if (id) message += "; server error id: " + id;
    owner.errorReport(10000, file, line, "state", category, message, true);
  };

  var _exception = function(err)
  {
    // FIXME: consider using https://github.com/eriwen/javascript-stacktrace
    var fileName = (err.fileName ? err.fileName.replace(/.*\//, "") : "(unknown)"),
        lineNumber = (err.lineNumber ? err.lineNumber : 0),
        desc = "";

    for (var attr in err)
      desc += "<br/>" + Y.Escape.html(attr) + " = "
              + Y.Escape.html(err[attr]);

    _error(fileName, lineNumber, "exception", "An exception '"
           + Y.Escape.html(err.name) + "' was raised during data load: "
           + Y.Escape.html(err.message)
           + (desc ? ("; technical detail:" + desc) : ""));
  };

  /** Handle successfully retrieved data. */
  var _success = function(e)
  {
    var o = e.data;
    var obj = e.arguments.obj;
    var path = e.arguments.path;
    var hash = Y.Array.hash;

    try
    {
      var ctype = o.getResponseHeader("Content-Type");
      if (o.status == 304)
      {
        _complete(path, obj, o);
      }
      else if (o.status != 200)
      {
        obj.node.setAttribute("class", "invalid");
        _error("(cache)", 0, "bad-status", "Internal error retrieving '"
               + Y.Escape.html(path)
               + "': success handler called with status code " + o.status
               + " != 200 ('" + Y.Escape.html(o.statusText) + "')",
               o.getResponseHeader("X-Error-ID"));
      }
      else if (ctype != "application/json")
      {
        obj.node.setAttribute("class", "invalid");
        _error("(state)", 0, "bad-ctype", "Internal error retrieving '"
               + Y.Escape.html(path)
               + "': expected 'application/json' reply, got '"
               + Y.Escape.html(ctype) + "'");
      }
      else
      {
        var val = Y.JSON.parse(o.responseText);
        if (val.result && val.desc && val.desc.columns)
        {
          obj.obj = val.result.map(function(row) {
            return hash(val.desc.columns, row); });
          _complete(path, obj, o);
        }
        else if (val.result)
        {
          obj.obj = val.result;
          _complete(path, obj, o);
        }
        else
        {
          obj.node.setAttribute("class", "error");
          _error("(state)", 0, "bad-json", "Internal error retrieving '"
                 + Y.Escape.html(path) + "': failed to understand json"
                 + " result starting with '"
                 + Y.Escape.html(o.responseText.substr(0, 30))
                 + "...'");
        }
      }
    }
    catch (err)
    {
      obj.node.setAttribute("class", "error");
      _exception(err);
    }
  };

  /** Handle failure to retrieve data from the server. */
  var _failure = function(e)
  {
    var o = e.data, path = e.arguments.path, obj = e.arguments.obj,
        appcode = 0, detail = null, errinfo = null, errid = null;
    try
    {
      appcode = o.getResponseHeader("X-Rest-Status");
      detail  = o.getResponseHeader("X-Error-Detail");
      errinfo = o.getResponseHeader("X-Error-Info");
      errid   = o.getResponseHeader("X-Error-ID");
      appcode = appcode && parseInt(appcode);
    }
    catch (_)
    {
      // Ignore errors.
    }

    if (! detail)
      detail = "Overview server responded " + Y.Escape.html(o.statusText)
               + " (HTTP status " + o.status + ")";

    if (errinfo)
      detail += ": " + errinfo;

    if (appcode)
      detail += ", server error code " + appcode;

    if (path)
      detail += " while retrieving " + Y.Escape.html(path);

    if (obj)
      obj.node.setAttribute("class", "invalid");

    if (o.status == 0 && o.statusText == "abort")
      for (var path in _data)
        _data[path].valid = _RELOAD;
    else if (appcode)
      _error("(cache)", 0, "app-fail", detail, errid);
    else if (o.status == 403)
      _error("(cache)", 0, "permission", "Permission denied. " + detail, errid);
    else if (o.status == 400)
      _error("(cache)", 0, "data-fail", "Invalid data. " + detail, errid);
    else if (o.status == 500)
      _error("(cache)", 0, "exec-fail", "Operation failed. " + detail, errid);
    else if (o.status == 503 || o.status == 504)
      _error("(cache)", 0, "unavailable", "Service unavailable. " + detail, errid);
    else
      _error("(cache)", 0, "comm-error", "Communication failure. " + detail, errid);
  };

  /** Issue a server request for @a path and @a obj in @a state. */
  var _refresh = function(path, obj, state)
  {
    // Mark state incomplete.
    _self.complete = false;

    // Mark object invalid if previously valid, but don't undo forced reload.
    // The caller will use _RELOAD or _INVALID as state as appropriate.
    if (obj.valid > state)
      obj.valid = state;

    // If there's already pending operation to load it, cancel it. Callers
    // are smart enough to avoid this in case they don't want this behaviour.
    if (path in _pending)
    {
      _pending[path].abort();
      delete _pending[path];
    }

    // Reset expire time.
    obj.expires = 0;

    // Mark the object in pending state in debug display.
    obj.node.setAttribute("class", "pending");

    // Set request headers. We always add the 'Accept' header. We also add
    // 'Cache-Control' header if we want to force redownload. Note that the
    // browser will automatically add 'If-None-Match' header if it has an
    // existing but out-of-date object with 'ETag' header.
    //
    // Note that the browser will happily return data to us from its cache
    // as long as it's within the expire time limits, without checking with
    // the server (= without doing a conditional GET). This is what we want,
    // and we force reload when we know we want to avoid stale data.
    var headers = { "Accept": "application/json" };
    if (obj.valid == _RELOAD)
      headers["Cache-Control"] = "max-age=0, must-revalidate";

    // Start XHR I/O on this object.
    _pending[path] = _io.send(REST_SERVER_ROOT + "/data" + path,
                              { on: { success: _success, failure: _failure },
                                context: this, method: "GET", sync: false,
                                timeout: null, headers: headers,
                                arguments: { obj: obj, path: path } });
  };

  /** Get a cached object. */
  this.get = function(path)
  {
    return path in _data && _data[path];
  };

  /** Require a cache element to be loaded. Refreshes those that
      are out of date and not currently pending load. */
  this.require = function()
  {
    var args = Array.prototype.slice.call(arguments, 0);
    var path = args.shift();
    var callback = args.shift();
    if (! (path in _data))
      _make(path);
    var obj = _data[path];
    if (obj.valid == _VALID)
    {
      args.unshift(_self.complete, obj.obj);
      callback.apply(owner, args);
    }
    else
    {
      obj.callbacks.push({ func: callback, args: args });
      if (! (path in _pending))
        _refresh(path, obj, _INVALID);
    }

    return _self;
  };

  /** Cancel all pending data requests. */
  this.cancel = function()
  {
    for (var path in _data)
      _data[path].callbacks = [];

    _abort();
  };

  /** Invalidate the specifiied state items so they will be retrieved again
      on the next 'require()'. Does not force them to be redownloaded from
      the server, but will ask browser to get the data again. This allows
      the browser to check with the server for updates on expired data. */
  this.invalidate = function()
  {
    for (var i = 0; i < arguments.length; ++i)
    {
      var path = arguments[i];
      if (! (path in _data))
        continue;
      var obj = _data[path];
      obj.node.setAttribute("class", "");
      obj.valid = _INVALID;
    }

    return _self;
  };

  /** Force the provided list of state elements to refresh immediately. */
  this.refresh = function()
  {
    for (var i = 0; i < arguments.length; ++i)
    {
      var path = arguments[i];
      if (! (path in _data))
        _make(path);
      var obj = _data[path];
      _refresh(path, obj, _RELOAD);
    }

    return _self;
  };

  /** Scheduled call to expire cached data. */
  var _purgeExpiredData = function() {
    var now = (new Date()).getTime()/1000;
    for (var path in _data)
      if (_data[path].valid == _VALID
          && _data[path].expires < now)
        delete _data[path];
  };

  var _purge = setInterval(_purgeExpiredData, 60000);

  return this;
};
