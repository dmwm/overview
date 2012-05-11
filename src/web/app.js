var Overview = function(Y, views, debug)
{
  // Patch up for old browsers.
  if (! Object.keys)
    Object.keys = Y.Object.keys;

  // Myself.
  var _gui = this;

  // Time-out object for hiding message overlay.
  var _messagesTO = null;

  // Messages overlay.
  var _messages = Y.one("#messages");

  // Content areas.
  var _content = Y.one("#content");

  // All views.
  var _views = [];

  // Current view.
  var _view = null;

  // History controller.
  this.history = new Y.Controller({ root: REST_SERVER_ROOT });

  // Some static regexps for validation.
  this.rx = { FLOAT: new XRegExp("^[0-9]+(\\.[0-9]*)?$"),
              INT: new XRegExp("^[0-9]+$") };

  /** Return the current view. */
  this.view = function()
  {
    return _view;
  };

  /** Show a message @a msg in the overlay area for @a timeout milliseconds.
      If previous messages are already showing, reset them if @a reset is
      truthy, otherwise append to existing messages. The messages will
      automatically hide away after @a timeout. */
  this.displayMessage = function(timeout, type, msg, reset)
  {
    if (_messagesTO && ! reset)
      msg = _messages.getContent() + msg;

    if (_messagesTO)
      _messagesTO.cancel();

    _messagesTO = Y.later(timeout, _gui, _gui.hideMessage);
    X.applyContentStyle(_messages, type, msg, "display", "");
  };

  /** Hide and empty the message overlay, if any. */
  this.hideMessage = function()
  {
    X.applyContentStyle(_messages, "", "", "display", "none");
  };

  /** Report an error. Displays the error message in the overlay
      area with a link to report the issue in trac if @a show, plus
      sends the message automatically to the server as problem
      feedback. Returns the full message. Both the server feedback
      and trac ticket link are given unique id which can be used to
      identify this specific issue in logs. */
  this.errorReport = function(timeout, file, line, origin, category, message, show)
  {
    var errid = X.randomid();
    var emsg = X.encodeAsPath(message);
    var file = file.replace(/.*\//, "");
    var label = X.encodeAsPath("[#" + category + ":" + errid
                + "] Overview web problem");
    var url = REST_SERVER_ROOT + "/feedback"
              + "?o=" + X.encodeAsPath(origin)
              + ";i=" + errid
              + ";c=" + category
              + ";l=" + X.encodeAsPath(file + ":" + line)
              + ";m=" + emsg;

    var msg = message.replace(/[. ]*$/, "")
              + ". (Automatically reported, in case of questions please"
              + " follow up <a href='https://svnweb.cern.ch/trac/CMSDMWM/"
              + "newticket?component=Overview&amp;summary=" + label + "&amp;"
              + "description=" + emsg + "' target='_new'>on trac</a>.)";

    if (show)
      _gui.displayMessage(timeout, "alert", msg);
    try { Y.io(url); } catch (e) { if (console && console.log) console.log(url); }
    return msg;
  };

  /** Page error handler. Automatically reports bugs to server and
      shows an error message overlay. */
  this.pageErrorHandler = function(msg, url, line)
  {
    _gui.errorReport(10000, url, line, "page", "exception",
                     "Internal error while rendering this page: "
                     + msg.toString().replace(/\s+/g, " "), true);
    _gui.view().error();
    return true;
  };

  /** Callback to handle clicks on internal links. If the link has
      class 'dispatch-only', makes a direct state transition, else
      pushes the new link target state to the history stack. */
  var _internalLink = function(e)
  {
    // Ignore events from buttons other than the first/left one.
    if (e.button !== 1 || e.ctrlKey || e.metaKey)
      return;

    // Tell view we are about to do internal navigation, so it can
    // get rid of local overrides.
    _gui.view().prenavigate();

    // Actually navigate to new state.
    var path = _gui.history.removeRoot(e.target.getAttribute("href"));
    if (e.target.hasClass('dispatch-only'))
      _gui.history._dispatch(path);
    else
      _gui.history.save(path);

    // Stop propagation.
    e.preventDefault();
  };

  /** Start running the Overview UI. */
  this.start = function(at)
  {
    // Redirect clicks on 'internal' links to history dispatching.
    Y.one(document.body).delegate("click", _internalLink, "a.internal");

    // Maybe show debug menus.
    Y.one("#sidebar-debug-data").setStyle("display", debug ? "" : "none");

    // Redirect the default route to the specified view.
    this.history.route("/*any", function() { _gui.history.save(at); });

    // Apply current view.
    this.history.dispatch();
  };

  /** Ensure @a view is activated. */
  this.enter = function(view)
  {
    var views = Y.one("#views");

    // Mark appropriate view selected.
    views.all("a.internal").each(function(n)
      {
        var href = _gui.history.removeRoot(n.getAttribute("href"));
	if (href.replace(/.*\//, "") == view.id)
	  n.ancestor(".title").addClass("selected");
	else
	  n.ancestor(".title").removeClass("selected");
      });

    // If another view is currently attached, detach and attach views first
    // and soft invalidate state data so we query browser for any updates.
    // But do the latter just periodically, not on every navigation.
    if (_view != view)
    {
      var prev = _view;

      if (_view)
        _view.detach();
      _view = view;
      if (_view)
        _view.attach();
    }

    // Update the side bar. Fill in sub-page links.
    var content = "";
    var node = Y.one("#sidebar-pages .content");
    if (_view)
      Y.each(_view.pages, function(p) {
        var title = Y.Escape.html(p.title || _view.label);
        var margin = (p.margin ? (" style='margin-top:" + p.margin + "'") : "");
	content += (p == _view.page ? ("<p" + margin + ">" + title + "</p>")
                    : ("<p" + margin + "><a href='" + REST_SERVER_ROOT + p.url
                       + "' class='internal'>" + title + "</a></p>"));
      });

    X.applyContent(node, content || "<p class='faded'>No pages</p>");
    X.applyStyle(node.get("parentNode"), "display", "");

    // Fill in service links.
    node = Y.one("#sidebar-links .content");
    content = (_view && _view.links && _view.links.getContent());
    X.applyContent(node, content || "");
    X.applyStyle(node.get("parentNode"), "display", content ? "" : "none");

    // Fill in intro.
    node = Y.one("#sidebar-intro");
    content = (_view && _view.intro && _view.intro.getContent());
    X.applyContent(node, content || "");
    X.applyStyle(node, "display", content ? "" : "none");

    // Fill in instructions.
    node = Y.one("#sidebar-instructions .content");
    content = (_view && _view.instructions && _view.instructions.getText());
    if (content && content.length > 80)
      content = content.substr(0, 80) + "... <a href=''>(More)</a>";
    X.applyContent(node, content || "");
    X.applyStyle(node.get("parentNode"), "display", content ? "" : "none");
  };

  // If not in debug mode, capture errors and report them to server.
  if (! debug)
    window.onerror = _gui.pageErrorHandler;

  // Add views.
  for (var view = 0; view < views.length; ++view)
    _views.push(new views[view](Y, this, view));

  // Start up.
  this.start("/phedex");
  return this;
};
