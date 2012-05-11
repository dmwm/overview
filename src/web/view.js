/** Manager of view contents.

    ViewContent manages dynamic content to be displayed on a page. It provides
    the means to make optimal incremental DOM updates when underlying app
    model data updates asynchronously, for example in response to XHR data
    requests. More importantly it also provides a sane model for maintaining
    user-editable content such as forms, while the underlying data changes.

    Specifically perhaps the most important service offered by this class is
    to allow form default values to be updated dynamically, for instance in
    response to XHR triggered updates to application state. The ViewContent
    instance tracks which form fields have been modified by the user, and
    respects those changes; values which have not been changed by the user
    are adjusted with the data model changes. When the application retrieves
    form values, ViewContent returns the user-changed value or the default as
    appropriate. It's also possible to tell the ViewContent instance to
    discard its local state, for example in response to user navigation.

    The general programming model is that the application "attaches" a view
    from a template, defines new HTML content, form values, event callbacks
    and focus node for template "elements", and then flushes the accumulated
    changes to the page with a "render" call. At that point ViewContent does
    an optimal minimal update of the page to make it reflect the desired
    state, but respecting form changes already made by the user.

    An instance of this object should be created for each unique "view"
    content group in the application. Each instance is tied to a template
    which should be defined as a <script type='text/x-template' id='t-id' />
    in the main document body. Document elements marked with 'x-element'
    attribute become available as modifiable elements in the ViewContent.

    For example the following template:

      <script type='text/x-template' id='t-view-hello'
       ><span x-element='message'></span
      ></script>

    Can for example be accessed as follows:

      var views = new ViewContentSet({ hello: "view-hello" });
      var view = views.attach("hello", _self.doc);
      view.content("message", "<b>Hello world! Click me for an alert.</b>");
      view.on("message", "click", function() { alert("You clicked me"); });
      view.render();
*/
ViewContent = function(Y, id)
{
  /** Reference to myself. */
  var _self = this;

  /** The document I have been attached to. */
  var _doc = null;

  /** The current instantiation of the template, including any accumulated
      content() changes made so far. */
  var _buffer = Y.Node.create("<div />");

  /** The template string. */
  var _template = Y.one("#t-" + id).getContent();

  /** Known view elements. Captured at template instantiation time as any
      node with x-element attribute. */
  var _elements = [];

  /** Registered form validators to invoke on element value changes. */
  var _validators = {};

  /** Queued new default values for form elements: <input>, <select>,
      <button> and <textarea> ones. These are the defaults to show when
      the user hasn't altered the value yet. */
  var _values = {};

  /** Queued new HTML content for non-form elements. */
  var _content = {};

  /** Elements whose control value overrides defaults, i.e. were modified
      by the user and we haven't been told to discard the value. */
  var _incharge = {};

  /** Elements for which a new value was queued programmatically, as if
      the user had edited it. Once we render these become _incharge. */
  var _takecharge = {};

  /** Form elements queued to be enabled. By default everything is enabled
      on attach, but specific elements can be queued to be disabled. */
  var _enabled = {};

  /** Queued CSS style changes. */
  var _style = {};

  /** Events currently registered for items on managed content. */
  var _events = {};

  /** Queued new element event handlers. */
  var _evreq = {};

  /** Queued actions to be executed once when the form has been attached
      for the first time. Usually these are things like making one-time
      changes to form controls such as installing auto-completion. */
  var _once = [];

  /** Queued form element which should receive focus on render. */
  var _focus = null;

  /** Flag indicating that we got attached for display such that we should
      force a rebuild of the entire page. We attach the view label to the
      _doc, and check on attach() call if it matches; if not, we force a
      reload. This assumes the app will call detach() when navigating out
      of the current view so we can undo that setting. */
  var _reload = false;

  /** Get the value of a YUI node. The text from <input> and <textarea> is
      automatically trimmed to remove leading and trailing whitespace. For
      <select> this is the "value" of the selected option, and for checkbox
      type <input> it is a boolean indicating whether the item was checked,
      otherwise the value or content of the form element as appropriate. */
  var _getValue = function(node)
  {
    switch (node.get("tagName"))
    {
    case 'SELECT':
      return node.get("value");

    case 'TEXTAREA':
      return Y.Lang.trim(node.get("value"));

    case 'INPUT':
      if (node.get("type") == "checkbox")
        return node.get("checked");
      else
        return Y.Lang.trim(node.get("value"));

    default:
      return node.getContent();
    }
  };

  /** Set the value of a YUI node. Sets <select> to show the <option> whose
      @a value is the one specified, a checkbox type <input> to the boolean
      value (true = checked), the text value for <input> or <textarea>, and
      the content for anything else (e.g. a <button>). */
  var _setValue = function(node, value)
  {
    switch (node.get("tagName"))
    {
    case 'SELECT':
      if (node.get("value") != value)
        node.all("option[value=" + value + "]").set("selected", true);
      break;

    case 'TEXTAREA':
      X.applyValue(node, value);
      break;

    case 'INPUT':
      if (node.get("type") != "checkbox")
        X.applyValue(node, value);
      else if (node.get("checked") != value)
        node.set("checked", value);
      break;

    default:
      X.applyContent(node, value);
      break;
    }
  };

  /** Attach the form to a document element. This should be called first
      before invoking any of the other content queing methods, and at the
      end the app should call render().

      The application also needs to arrange a call to detach() prior to
      reusing @a doc for any other HTML content so this object knows the
      contents have become invalid.

      If this is the first call with the same document element since the
      beginning or since the last detach() call, the subsequent render()
      will force a full page update. Otherwise only incremental content
      updates are made. */
  this.attach = function(doc)
  {
    _doc = doc;
    _once = [];
    _focus = null;
    _elements = [];
    _buffer.setContent(_template);
    _buffer.all("*[x-element]").each(function(n) {
      _elements.push(n.getAttribute("x-element"));
    });
    Y.each(_elements, function(item) { _enabled[item] = true; });
    _reload = (doc.getAttribute("x-view-id") != id);
  };

  /** Detach the form from the document element. This detaches all registered
      event handlers, clears all internal state, and removes the view marker
      from the document so subsequent attach() calls know to rebuild the
      form contents from scratch. */
  this.detach = function()
  {
    if (_doc)
      _doc.setAttribute("x-view-id", "");
    Y.each(_events, function(events) {
      Y.each(events, function(sub) { sub.detach(); });
    });
    _doc = null;
    _buffer.setContent("");
    _validators = {};
    _values = {};
    _content = {};
    _incharge = {};
    _takecharge = {};
    _style = {};
    _events = {};
    _focus = null;
    _reload = false;
    _once = [];
  };

  /** Tell the form to lose all local modified values and to fall back on the
      application-provided defaults on the next attach()/render() call pair. */
  this.loseValues = function()
  {
    _incharge = {};
  };

  /** Get the actual node for form element @a item. It's only valid to call
      this after render() has been called, or inside an once() callback. */
  this.node = function(item)
  {
    return item ? _doc.one("*[x-element=" + item + "]") : _doc;
  };

  /** Get the node for the current queued content for for element @a item.
      This can be called after attach() has been called. Note that the
      buffer element only reflects queued content and style, but not
      other attributes such as form values or event callbacks. */
  this.buffer = function(item)
  {
    return item ? _buffer.one("*[x-element=" + item + "]") : _buffer;
  };

  /** Queue @a item to become the focus element on next render() call. If
      item is null, focus will not be touched. The default value is null,
      so focus will not be changed at all unless this method is called
      with a non-null argument. */
  this.focus = function(item)
  {
    _focus = item;
  };

  /** Queue @a callback to be invoked for @a event on @a item at the next
      render() call. Any previous @a event handler for the same @a item will
      be detached first, even if it was registered at a previous attach()/
      render() cycle. In other words, it's safe to register the same event
      handlers on every cycle, they do not accumulate over several calls. */
  this.on = function(item, event, callback)
  {
    if (! (item in _evreq))
      _evreq[item] = {};
    _evreq[item][event] = callback;
  };

  /** Queue @a item enabled state to be set to @a value. By default all the
      form elements will be marked enabled, so call this with false value if
      you want to disable some elements. */
  this.enable = function(item, value)
  {
    _enabled[item] = value;
  };

  /** Queue input validator @a callback to @a item. The callback will be
      invoked with three arguments, the current value, the YUI node, and
      this view content object. The function should return true if the
      value is valid; otherwise the form element will be marked with CSS
      class "invalid-value" as a signal to the user. As with events, it is
      safe to register the same validator on each attach()/render() cycle. */
  this.validator = function(item, callback)
  {
    _validators[item] = callback;
  };

  /** Queue @a item innerHTML content to be set to @a value. Note that the
      only attributes you can set on element is CSS via style(). You can
      not for example set "href" on an <a> object, you need to construct
      a full <a> object as the contents of the parent each time. */
  this.content = function(item, value)
  {
    if (_reload)
      X.applyContent(_self.buffer(item), value);
    else
      _content[item] = value;
  };

  /** Queue @a item CSS property @a style to be set to @a value. */
  this.style = function(item, style, value)
  {
    if (_reload)
      X.applyStyle(_self.buffer(item), style, value);
    else
    {
      if (! (item in _style))
        _style[item] = {};

      _style[item][style] = value;
    }
  };

  /** Queue @a item default value to be set to @a value. If @a incharge, act as
      if it was user input, otherwise treat @a value as the default which is
      overridden by any user changes. Use this only on form elements such as
      <input>, <select>, <textarea> and <button>; use content() to set the
      HTML contents of an element. */
  this.value = function(item, value, incharge)
  {
    _values[item] = value;
    if (incharge)
      _takecharge[item] = true;
  };

  /** Return the current value of @a item.

      The text from <input> and <textarea> is automatically trimmed to remove
      leading and trailing whitespace. For <select> this is the "value" of the
      selected option, and for checkbox type <input> it is a boolean indicating
      whether the item was checked, otherwise the value or content of the form
      element as appropriate.

      If invoked between attach() and render(), returns the queued values for
      elements for which there are no user edits. Otherwise returns the actual
      form element value. */
  this.valueOf = function(item)
  {
    if (item in _values && (! (item in _incharge) || _reload))
      return _values[item];
    else
      return _getValue(_self.node(item));
  };

  /** Check if @a item has local edits which override form defaults. Returns
      true if user edits override defaults, i.e. this object is "in charge of"
      the contents. */
  this.incharge = function(item)
  {
    return (item in _incharge) || (item in _takecharge);
  };

  /** Queue a callback to be invoked once when the attach()/render() pair
      results in full page rebuild. Use this to modify the form nodes, for
      example to install auto-complete event handlers which should be added
      exactly once per YUI node.

      The first argument is the callback to invoke, the rest are the
      arguments to pass to it.

      Note that "once" here refers to "once per node creation", not "once
      ever in application." The nodes on the view are recreated whenever the
      ViewContent is attached the first time, or after a view was detached. */
  this.once = function()
  {
    _once.push(arguments);
  };

  /** Flush all queued updates to the page in optimal minimal rendering. */
  this.render = function()
  {
    if (_reload)
    {
      Y.each(_events, function(events) {
        Y.each(events, function(sub) { sub.detach(); });
      });

      X.applyContent(_doc, _buffer.getContent());
      _doc.setAttribute("x-view-id", id);

      Y.each(_once, function(arglist) {
        var func = arglist[0];
        func.apply(_self, Array.prototype.slice.call(arglist, 1));
      });

      _incharge = {};
      _events = {};
    }

    Y.each(_elements, function(item)
    {
      var node = _self.node(item);
      var element = node.get("tagName");

      if (item in _content)
      {
        var oldval;
        if (element == 'SELECT')
          oldval = _getValue(node);

        X.applyContent(node, _content[item]);

        if (element == 'SELECT')
          _setValue(node, oldval);
      }

      if (item in _style)
        Y.each(_style[item], function(value, style) {
          X.applyStyle(node, style, value);
        });

      if (! (item in _incharge) && item in _values)
      {
        _setValue(node, _values[item]);
        if (item in _takecharge)
          _incharge[item] = 1;
      }

      switch (element)
      {
      case 'INPUT':
      case 'SELECT':
      case 'BUTTON':
      case 'TEXTAREA':
        if (_enabled[item])
        {
          node.set("disabled", false);
          node.removeClass("faded");
        }
        else
        {
          node.set("disabled", true);
          node.addClass("faded");
        }
        break;
      }

      if (! (item in _events))
      {
        _events[item] = {};

        switch (element)
        {
        case 'SELECT':
          _events[item]["$valueChange"] =
            node.on("change", function(e) { _incharge[item] = true; });
          break;

        case 'TEXTAREA':
        case 'INPUT':
          _events[item]["$valueChange"] =
            node.on("valueChange", function(e)
            {
              _incharge[item] = true;
              if (item in _validators)
                if (_validators[item](_getValue(node), node, _self))
                  node.removeClass("invalid-value");
                else
                  node.addClass("invalid-value");
            });
          break;
        }
      }

      Y.each(_evreq[item] || {}, function(callback, ev)
      {
        if (ev in _events[item])
          _events[item][ev].detach();

        _events[item][ev] = node.on(ev, callback);
      });

      if (_reload && _focus == item)
        node.getDOMNode().focus();
    });

    _takecharge = {};
    _evreq = {};
    _focus = null;
    _reload = false;
  };
};

/** Manage a set of ViewContent objects.

    The @a items should be an object whose keys are view labels and
    values are the id to pass to ViewContent constructor. */
ViewContentSet = function(Y, items)
{
  /** Myself. */
  var _self = this;

  /** Dictionary of views by constructor labels. */
  var _views = {};

  /** Name of the current view. */
  var _current = null;

  // Build view content objects.
  Y.each(items, function(id, label) {
    _views[label] = new ViewContent(Y, id);
  });

  /** Attach ViewContent identified by @a to with @a doc and remember it as the
      current one.  If any other ViewContent is currently attached, detach it
      first. */
  this.attach = function(to, doc)
  {
    Y.each(_views, function(view, label) {
      if (label != to)
        view.detach();
    });

    var view = _views[to];
    view.attach(doc);
    _current = to;
    return view;
  };

  /** Detach the currently attached view, if any. */
  this.detach = function()
  {
    _current = null;
    Y.each(_views, function(v) { v.detach(); });
  };

  /** Tell all views to lose their local edit changes and to fall back on the
      default values on the next attach()/render() cycle. */
  this.loseValues = function()
  {
    Y.each(_views, function(view) { view.loseValues(); });
  };

  /** Return the name of the currently attached view. */
  this.current = function()
  {
    return _current;
  };

  /** Return the ViewContent identified by @a name, or the current view if
      @a name is null (e.g. if called without arguments). If no ViewContent
      is currently selected, or @a name is unknown, returns null. */
  this.view = function(name)
  {
    var which = name || _current;
    return which && _views[which];
  };
};

/** View constructor. */
var View = function(Y, gui, rank, label, pages)
{
  /** Myself. */
  var _self = this;

  /** My name for internal references. */
  this.id = label.toLowerCase().replace("/", "-");

  /** My human visible name. */
  this.label = label;

  /** Save rank so main application can use it to generate menu. */
  this.rank = rank;

  /** Document area for displaying this view. */
  this.doc = Y.one("#content");

  /** View master objects. */
  this.pages = [];

  /** Current page. */
  this.page = null;

  /** ViewContentSet for this view. */
  this.views = null;

  /** Links for this view. */
  this.links = Y.one("#t-links-" + this.id);

  /** Introduction for this view. */
  this.intro = Y.one("#t-intro-" + this.id);

  /** Instructions for this view. */
  this.instructions = Y.one("#t-instructions-" + this.id);

  /** Run actions on internal navigation. Default does nothing,
      derived classes should implement this if they maintain an
      internal state which ignores some history changes, such as
      when listening for local form value updates. */
  this.prenavigate = function()
  {
  };

  /** Attach view to current viewport. Default does nothing. */
  this.attach = function()
  {
  };

  /** Detach view from the viewport. Removes all document contents. */
  this.detach = function()
  {
    X.applyContent(this.doc, "");
  };

  /** Respond to model load errors. Removes all document contents. */
  this.error = function()
  {
    X.applyContent(this.doc, "");
  };

  /** Respond to model load completion. Refreshes sidebar and
      re-dispatches the controller to activate current view. */
  this.update = function()
  {
  };

  /** Replace the title on this history state. */
  this.title = function()
  {
    var title = [];

    for (var i = 0; i < arguments.length; ++i)
      if (arguments[i])
	title.push(arguments[i]);

    title.push(label);
    title.push("Overview");
    title = title.join(" | ");

    if (gui.history._history)
    {
      var d = gui.history._dispatch;
      gui.history._dispatch = function() {};
      gui.history._history.replace({}, { title: title });
      gui.history._dispatch = d;
    }

    document.title = title;
  };

  /** The main view page, show site list and site info, with links
      to details and site-specific operations. */
  this.templatePage = function(req, page, template)
  {
    _self.page = page;
    gui.enter(_self);

    var view = _self.views.attach(template, _self.doc);
    _self.title(page.title);
    view.render();

    Y.all(".page-relink").each(function(node) {
      var r;
      if ((r = node.getAttribute("x-replace").match(/^([A-Za-z0-9]+)=(.*)/)))
      {
        var q = {}; q[r[1]] = r[2]; q = Y.merge(q, req.query);
        node.setAttribute("href", req.path + X.qstring(q));
      }
    });

    return view;
  };

  var _pageHandler = function(handler, page, template)
  {
    return function(req) { handler(req, page, template); };
  };

  {
    var _viewset = {};
    var _viewurls = {};
    for (var i = 0; i < pages.length; ++i)
    {
      var page = pages[i];
      var template = page.template || page.label;
      var handler = page.route || (template && _self.templatePage);
      page.url = "/" + this.id + (page.label ? ("/" + page.label) : "");

      if (template && ! (template in _viewset))
        _viewset[template] = "view-" + this.id + "-" + template;

      if (handler && ! (page.url in _viewurls))
      {
        callback = _pageHandler(handler, page, template);
        if (i == 0 && page.label)
          gui.history.route("/" + this.id, callback);

        gui.history.route(page.url, callback);
        _viewurls[page.url] = page;
      }

      this.pages.push(page);
    }

    this.views = new ViewContentSet(Y, _viewset);

    // Add a menu item.
    var views = Y.one("#views");
    var first = (views.getDOMNode().childElementCount == 1 ? " first" : "");
    views.append("<h2 class='title" + first + "' id='view-" + this.id
                 + "'>" + "<a class='internal' href='" + REST_SERVER_ROOT
                 + "/" + this.id + "'>" + this.label + "</a></h2>");
  }

  return this;
};
