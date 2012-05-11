var X = new function()
{
  var _X = this;
  var _F = function() {};
  var RE_THOUSANDS = /(\d)(\d{3}($|\D))/;
  var RE_DECIMAL = /^(.*?)(\.[^.]*)?$/;
  var _rxvalidators = {};
  var _node = { dl: document.createElement("dl"),
                ul: document.createElement("ul"),
                tr: document.createElement("tr"),
                div: document.createElement("div"),
                table: document.createElement("table"),
                tbody: document.createElement("tbody"),
                select: document.createElement("select") };

  // Check if content assignment on stand-alone table elements is broken.
  _node.tbody.innerHTML = "<tr><td>foo</td></tr>";
  var _tableHack = (_node.innerHTML != "<tr><td>foo</td></tr>");

  // Check if we can use HTML normalisation; IE9 and earlier cannot.
  var _canNormaliseHTML = true;
  try { _node.table.innerHTML = "<tbody><tr><td>foo</td></tr></tbody>"; }
  catch (err) { _canNormaliseHTML = false; }

  /** Utility to render numbers with thousand separators. */
  this.thousands = function(val)
  {
    var r = RE_DECIMAL.exec(val);
    var prefix = r[1];
    var suffix = r[2];
    if (suffix)
      suffix = suffix.substring(0, 3);
    else
      suffix = "";

    while (true)
    {
      var t = prefix.replace(RE_THOUSANDS, "$1'$2")
      if (t == prefix)
        break;
      else
        prefix = t;
    }
    return prefix + suffix;
  };

  /** Set up @a child for inheritance from @a parent. */
  this.inherit = function(parent, child)
  {
    _F.prototype = parent.prototype;
    child.prototype = new _F();
    child.prototype.constructor = child;
    child.superclass = parent.prototype;
    return child;
  };

  /** Ask a confirmation question @a question with @a button
      label and execute @a doit if clicked. */
  this.confirm = function(Y, question, button, doit)
  {
    var panel = new Y.Panel({
      bodyContent: question,
      width: "40%", centered: true, modal: true,
      zIndex: 10, render: "#confirm-panel",
      buttons: [{ value: button, section: Y.WidgetStdMod.FOOTER,
                  action: function(e) { e.preventDefault(); panel.hide(); doit(); }},
                { value: "Cancel", section: Y.WidgetStdMod.FOOTER,
                  action: function(e) { e.preventDefault(); panel.hide(); } }]
    });
  };

  /** Set the YUI Node object @a obj innerHTML to @a newval.
      Only the values that differ from the desired value are
      modified to avoiding firing unnecessary DOM events. */
  this.applyContent = function(obj, newval)
  {
    // Different browsers have different ways for returning
    // innerHTML, say for attribute value quoting, and newval
    // may not match that convention. To match the convention
    // put newvl through an innerHTML before comparing it.
    //
    // However several browsers don't allow innerHTML to be set
    // on a stand-alone tbody/tr, so we need an additional
    // contortion to modify a table first, then retrieve the
    // part we want. In addition up to and including IE9 cannot
    // make certain direct innerHTML changes; Y.Node has the
    // hacks needed to make it work, but we don't have Y here
    // so can't crete a new node, so just skip normalisation.
    var node = _node.div, strip = 0;
    if (_canNormaliseHTML)
    {
      if (newval.match(/^<option[\s>]/i))
        node = _node.select;
      else if (newval.match(/^<tr[\s>]/i))
      {
        if (! _tableHack)
          node = _node.tbody;
        else
        {
          newval = "<tbody>" + newval + "</tbody>";
          node = _node.table;
          strip = 1;
        }
      }
      else if (newval.match(/^<td[\s>]/i))
      {
        if (! _tableHack)
          node = _node.tr;
        else
        {
          newval = "<table><tbody>" + newval + "</tbody></table>";
          node = _node.table;
          strip = 2;
        }
      }
      else if (newval.match(/^<(thead|tbody)[\s>]/i))
        node = _node.table;
      else if (newval.match(/^<dt[\s>]/i))
        node = _node.dl;
      else if (newval.match(/^<li[\s>]/i))
        node = _node.ul;

      node.innerHTML = newval;
      newval = node.innerHTML;
      for ( ; strip > 0; --strip)
        newval = newval.replace(/^<[a-z]+>(.*)<\/[a-z]+>$/, "$1");
    }

    if (obj.getContent() != newval)
      obj.setContent(newval);
  };

  /** Set the YUI Node object @a obj class name to @a newval.
      Only the values that differ from the desired value are
      modified to avoiding firing unnecessary DOM events. */
  this.applyClass = function(obj, newval)
  {
    if (obj.get("className") != newval)
      obj.set("className", newval);
  };

  /** Set the YUI Node object @a obj value to @a newval.
      Only the values that differ from the desired value are
      modified to avoiding firing unnecessary DOM events. */
  this.applyValue = function(obj, newval)
  {
    if (obj.get("value") != newval)
      obj.set("value", newval);
  };

  /** Set the YUI Node object @a obj title to @a newval.
      Only the values that differ from the desired value are
      modified to avoiding firing unnecessary DOM events. */
  this.applyTitle = function(obj, newval)
  {
    if (obj.getAttribute("title") != newval)
      obj.setAttribute("title", newval);
  };

  /** Set the YUI Node object @a obj @a style to @a newval.
      Only the values that differ from the desired value are
      modified to avoiding firing unnecessary DOM events. */
  this.applyStyle = function(obj, style, newval)
  {
    if (obj.getStyle(style) != newval)
      obj.setStyle(style, newval);
  };

  /** Set the YUI Node object @a obj innerHTML to @a newval, the title to
      @a newtitle and class name to @a className. Only the values that
      differ from the desired value are modified to avoiding firing
      unnecessary DOM events. */
  this.applyContentTitle = function(obj, className, newval, newtitle)
  {
    _X.applyContent(obj, newval);
    _X.applyClass(obj, className);
    _X.applyTitle(obj, newtitle);
  };

  /** Set the YUI Node object @a obj innerHTML to @a newval, the @a style to
      @a styleval and class name to @a className. Only the values that
      differ from the desired value are modified to avoiding firing
      unnecessary DOM events. */
  this.applyContentStyle = function(obj, className, newval, style, styleval)
  {
    _X.applyContent(obj, newval);
    _X.applyClass(obj, className);
    _X.applyStyle(obj, style, styleval);
  };

  /** Get a YUI Node object @a node DOM attribute @a attr. If a value is set,
      decode it as URI component and return it, otherwise return null. */
  this.getDOMAttr = function(node, attr)
  {
    var value = node.getAttribute(attr);
    if (value) value = decodeURIComponent(value);
    return value;
  };

  /** Set a YUI Node object @a node DOM attribute @a attr to @a val.
      The value is encoded as URI component. */
  this.setDOMAttr = function(node, attr, val)
  {
    node.setAttribute(attr, _X.encodeAsPath(val));
  };

  /** Set a YUI Node object @a node DOM attribute @a attr to @a val.
      Only the values that differ from the desired value are modified
      to avoid firing unnecessary DOM events. */
  this.applyDOMAttr = function(node, attr, val)
  {
    if (_X.getDOMAttr(node, attr) != val)
      _X.setDOMAttr(node, attr, val);
  };

  /** Given YUI3 event @a e, find DOM ancestor with attribute @a attr. */
  this.findEventAncestor = function(e, attr)
  {
    e.preventDefault();
    for (var value, node = e.target; node; node = node.get("parentNode"))
      if ((value = _X.getDOMAttr(node, attr)))
        return { node: node, value: value };

    return null;
  };

  /** Ignore trailing single clicks within this time window (ms) of receiving
      a dblclick event. This helps avoid 'select' single-click after 'activate'
      double-click. Some people struggle to get the number of clicks right. */
  this.DBL_CLICK_DELAY = 100;

  /** If a dblclick event has arrived within this time window (ms) of the
      first single-click, deliver the earlier single click event. */
  this.DBL_CLICK_TIME = 250;

  /** Event handler to be used for click/dblclick events which automatically
      disambiguates the event type and calls either the single-click handler
      @a singleCall or the double-click handler @a doubleCall, but not both.

      Use this when you have separate 'select' and 'activate' actions on the
      target, and don't want the double-click 'activate' to also trigger the
      'select' action on the first click. This is normally expected, but not
      how JavaScript DOM event model works by default.

      The @a data should be an unique object associated with this click
      handler, initialised as:

         { event: null, timeout: null, timeClick: 0, timeDoubleClick: 0 }

      The click event handlers @a singleCall and @a doubleCall are called as
      usual with the event object object as an argument. */
  this.dblclick = function(e, data, singleCall, doubleCall)
  {
    e.cancelBubble = true;
    if (e.stopPropagation)
      e.stopPropagation();

    var t = new Date().getTime();
    if (e.type == 'click')
    {
      if (t - data.timeDoubleClick < _X.DBL_CLICK_DELAY)
        return false;
      data.event = { srcElement: (e.srcElement || e.target),
                     type: e.type, x: e.x || e.clientX };
      data.timeClick = t;
      data.timeout = setTimeout(function() {
          var event = data.event;
          data.event = null;
          data.timeClick = 0;
          data.timeDoubleClick = 0;
          return (event && singleCall(event));
        }, _X.DBL_CLICK_TIME);
    }
    else if (e.type == 'dblclick')
    {
      data.timeDoubleClick = new Date().getTime();
      if (data.timeout)
      {
        clearTimeout(data.timeout);
        data.timeout = null;
        data.event = null;
      }
      doubleCall(e);
    }
  };

  /** Weekday short names, [0] = Sunday, [7] = Saturday. */
  this.WEEKDAY = [ "Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat" ];

  /** Month short names, [0] = January, [11] = December. */
  this.MONTH = [ "Jan", "Feb", "Mar", "Apr", "May", "Jun",
                 "Jul", "Aug", "Sep", "Oct", "Nov", "Dec" ];

  /** Format Date object @a ref into a string, automatically selecting the
      most appropriate representation in reference to current Date @a now.
      Selects shorter forms for the same day, week and month, following
      conventions humans tend to find natural. Handles both @a ref time in
      the past or in the future relative to @a now. */
  this.formatTime = function(ref, now)
  {
    var str = "";
    var future = 0;
    var diff = (now.getTime() - ref.getTime()) / 1000;
    var nowday = now.getDay();
    var refday = ref.getDay();

    if (diff < 0)
    {
      diff = -diff;
      future = 1;
    }

    if (diff < 60 && refday == nowday)
      return sprintf("%d'' %s",
                     diff,
                     future ? "in future" : "ago");

    if (diff < 3600 && refday == nowday)
      return sprintf("%d' %d'' %s",
                     (diff % 3600) / 60,
                     (diff % 60),
                     future ? "in future" : "ago");

    if (diff < 4*3600 && refday == nowday)
      return sprintf("%dh %d' %d'' %s",
                     diff / 3600,
                     (diff % 3600) / 60,
                     (diff % 60),
                     future ? "in future" : "ago");

    if (diff < 86400 && ! future)
      return sprintf("%sat %02d:%02d.%02d",
                     (refday == nowday ? "" : "Yesterday "),
                     ref.getHours(),
                     ref.getMinutes(),
                     ref.getSeconds());

    if (diff < 7*86400 && ! future)
      return sprintf("%s %02d:%02d.%02d",
                     _X.WEEKDAY[ref.getDay()],
                     ref.getHours(),
                     ref.getMinutes(),
                     ref.getSeconds());

    if (diff < 365*86400 && ! future)
      return sprintf("%s %d, %02d:%02d.%02d",
                     _X.MONTH[ref.getMonth()],
                     ref.getDate(),
                     ref.getHours(),
                     ref.getMinutes(),
                     ref.getSeconds());

    return sprintf("%s %d, %d, %02d:%02d.%02d",
                   _X.MONTH[ref.getMonth()],
                   ref.getDate(),
                   ref.getFullYear(),
                   ref.getHours(),
                   ref.getMinutes(),
                   ref.getSeconds());
  };

  /** Encode path string @a str for embedding in hyperlinks. */
  this.encodeAsPath = function(str)
  {
    return encodeURIComponent(str)
      .replace(/%2F/g, "/")
      .replace(/'/g, "%27")
      .replace(/"/g, "%22");
  };

  /** Build a mapping table from the <option> values of a
      <select> to corresponding index for use as selectedIndex. */
  this.optionmap = function(sel)
  {
    var map = {};
    for (var i = 0; i < sel.childNodes.length; ++i)
      map[sel.childNodes[i].value] = i;
    return map;
  };

  /** Generate a random id. */
  this.randomid = function()
  {
    var id = "";
    for (var i = 0; i < 8; ++i)
      id += String.fromCharCode(97 + Math.floor(Math.random() * 24));
    return id;
  };

  /** Generate multi-column style string. */
  this.multicolumn = function(width, gap, rule)
  {
    if (rule)
      rule = "column-rule:" + rule
             + ";-moz-column-rule:" + rule
             + ";-webkit-column-rule:" + rule + ";";
    else
      rule = "";

    return "column-width:" + width + "px; column-gap:" + gap + "px;"
      + "-moz-column-width:" + width + "px; -moz-column-gap:" + gap + "px;"
      + "-webkit-column-width:" + width + "px; -webkit-column-gap:" + gap + "px;"
      + rule;
  };

  /** Instantiate a validator function which matches value with @a rx.
      If @a optional is trueish, completely empty values are ok. The
      validator function callbacks are cached so it's ok to call this
      repeatedly with the same arguments. */
  this.rxvalidate = function(rx, optional)
  {
    if (! (optional in _rxvalidators))
      _rxvalidators[optional] = {};
    if (! (rx in _rxvalidators[optional]))
      _rxvalidators[optional][rx] =
        (optional
         ? function(value) { return ! value || rx.test(value); }
         : function(value) { return rx.test(value); });

    return _rxvalidators[optional][rx];
  };

  /** Generate a normalised query string from dictionary @a args. */
  this.qstring = function(args)
  {
    var qs = "";
    Object.keys(args).sort().map(function(k) {
      qs += (qs ? "&" : "?") + k + "=" + _X.encodeAsPath(args[k]);
    });
    return qs;
  };

  return this;
}();
