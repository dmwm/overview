// * Graphs
//
// Static, time included in plot:
//   Table (-> region cross rate!) (1 or 2 categories)
//   Single or stacked group of plots (1 or 2 categories):
//     Time-value line graph
//     Time-value stacked line graph
//     Time-value cumulative stacked line graph
//     Y bar graph (stacked, minus plot stacking)
//     Time-value calendar heat map (merge results per stack)
//   Always stacked plots (1 category):
//     Time-value serial heat map (~ quality map)
//
// Time point or animated plots (1, 2 or N categories):
//   World map (1 category, 1 or 2 2D data points, amount)
//     X(-Y)-Z scatter graph (X, Y world locations, Z = amount)
//   Chord (1 category) [+ 1-2 categories for array of graphs]
//     X-Y-Z graph (X, Y entities, Z = amount)
//   Sunburst (=~ pie) (N categories) [+ 1-2 categories for array of graphs]
//     N-level data hierarchy (site, group space use, transfer rate / volume)
//   Density plot (1 category, vector of data points -> density histogram)
//     Category-Value-Weight graph (block latency)
//   Single or stacked group of plots (1 or 2 categories, 3D data points):
//     X-Y(-Z) scatter graph (rate vs. quality)
//   Always stacked plots (1 category, amount):
//     X bar graph (e.q. quality as a bar)
//
// Time series graph
//   Graph array (1x1 for simple graph, 1xN, MxN) of graphs with 1 or 2 categories
//
//  { timeseries: [{ start:12345, end:56789 }, { start:x, end:y }, ...],
//    legend: { T1_CH_CERN: { title: "T1_CH_CERN", total: 0, rank: 0, attrs: {} }, ... },
//    title: ["CMS PhEDEx Production - Transfer rate by destination", "96 hours from X to Y UTC" ],
//    graphs: [ [ { yarray: "FNAL", xarray: "T1", title: ["", "", ...], ytitle: "",
//                  stats: { total: { T1_CH_CERN: 0, ... }, min:, max:, avg:, median: },
//                  stacks: [ { title: "", data: [ [ { category: {T1_CH_CERN}, x: 12345, y: 0.1, y0: }]]}]},
//                { yarray: "FNAL", xarray: "T2" },
//                { yarray: "FNAL", xarray: "T3" } ],
//              [ { yarray: "T0", xarray: "T0", title: }, null, null ] ] }
//
//
//
// * Historical
//
// Link:
//   Transfer rate       value
//     Region cross rate
//   Transfer volume     value, cumulative
//   Quality: map        value
//   Quality: attempts   value, cumulative
//   Quality: successes  value, cumulative
//   Quality: failures   value, cumulative
//   Rate vs. quality    value
// Node:
//   Queued              value
//   Routed              value
//   Resident            value
//   Requested           value
//   Idle                value
//   Block latency       value
//
// * Current only
//
// Node:
//   Space use           site (incomplete? subscribed? custodial?) (dataset filter; split: production, conditions, data tiers, mc/datatype, iscomplete, iscustodial, issubscribed, physics group, block id)
// Group:
//   Space use           group (split: tier, region, country, site)

var PhEDEx = X.inherit(View, function(Y, gui, rank)
{
  var _self = this;
  this.cache = new Cache(Y, this, Y.one("#sidebar-debug-data .content"));
  this.plot = null;

  var _rxcompile = function(pattern)
  {
    var e;
    try { return new XRegExp(pattern); }
    catch (e) { return null; }
  }

  var _test = function(value, expr)
  {
    if (expr instanceof RegExp)
      return expr.test(value);
    else if (Y.Lang.isFunction(expr))
      return expr(value) ? true : false;
    else
      return value ? true : false;
  };

  var arc2path = function(arc)
  {
    var sanitized = { type: "MultiLineString", coordinates: [] },
        line = arc.coordinates,
        coords = [line[0]];

    for (var i = 1; i < line.length; ++i)
    {
      if (Math.abs(line[i][0] - line[i-1][0]) > 180) {
        sanitized.coordinates.push(coords);
        coords = [];
      }
      coords.push(line[i]);
    }

    sanitized.coordinates.push(coords);
    return sanitized;
  };

  var _dbpath = { "p": "prod", "d": "debug", "t": "dev" };

  var _rx =
  {
    optint:     /^\d*$/,
    optfloat:   /^([0-9]+(\\.[0-9]*)?)?$/,
    tier:       /^(T\d+)_.*/,
    country:    /^T\d+_([A-Z]{2})_.*/,
    sitesuffix: /_(Buffer|Disk|MSS|Export)$/,
    region:     [ { rx: /^T0_/, region: "T0" },
                  { rx: /^T2_CH_CAF/, region: "CAF" },
                  { rx: /^T\d+_(TW|IN|KR|PK|TH|NZ)_/, region: "ASGC" },
                  { rx: /^T\d+_((HU|RU|UA|GR)_|CH_CERN)/, region: "CERN" },
                  { rx: /^T\d+_IT_/, region: "CNAF" },
                  { rx: /^T\d+_(US|BR|TR|MX)_/, region: "FNAL" },
                  { rx: /^T\d+_(AT|DE|PL|CH)_/, region: "KIT" },
                  { rx: /^T\d+_(FR|BE|CN)_/, region: "IN2P3" },
                  { rx: /^T\d+_(ES|PT)_/, region: "PIC" },
                  { rx: /^T\d+_(UK|EE|FI)_/, region: "RAL" } ] };

  var _groupname =
  {
    "n": function(db, name) { return name; },
    "s": function(db, name) { return name.replace(_rx.sitesuffix, ""); },
    "c": function(db, name) { return name.replace(_rx.country, "$1"); },
    "r": function(db, name) { for (var i = 0; i < _rx.region.length; ++i)
                                if (_rx.region[i].rx.test(name))
                                  return _rx.region[i].region;
                              return "Other"; },
    "t": function(db, name) { return name.replace(_rx.tier, "$1"); },
    "i": function(db, name) { return db; },
    "x": function(db, name) { return ""; } };

  var _nodelabel =
  {
    "d": function(groups, dest)
         {
           var group = dest._group_dest,
               key = group.name,
               g = groups[key];

           if (! g)
             g = groups[key] = { key: key, display: key,
                                 colour: group.colour,
                                 group_dest: group };

           return g;
         }
  };

  var _linklabel =
  {
    "l": function(groups, dest, src)
         {
           var dgroup = dest._group_dest,
               sgroup = src._group_src,
               key = dgroup.name + " " + sgroup.name,
               d = sgroup.name + " -> " + dgroup.name,
               g = groups[key];

           if (! g)
             g = groups[key] = { key: key, display: d, colour: null,
                                 group_src: sgroup, group_dest: dgroup };

           return g;
         },

    "s": function(groups, dest, src)
         {
           var group = src._group_src,
               key = group.name,
               g = groups[key];

           if (! g)
             g = groups[key] =  { key: key, display: key,
                                  colour: group.colour,
                                  group_dest: group };

           return g;
         },

    "d": function(groups, dest, src)
         {
           var group = dest._group_dest,
               key = group.name,
               g = groups[key];

           if (! g)
             g = groups[key] = { key: key, display: key,
                                 colour: group.colour,
                                 group_dest: group };

           return g;
         }
  };

  var _urlopts =
  {
    "w": { name: "timewidth", nullable: true,
           test: gui.rx.INT, convert: parseInt },
    "s": { name: "span", test: /^[hdwmy]$/,
           titles: { "h": "Hour", "d": "Day", "w": "Week",
                     "m": "Month", "y": "Year" } },
    "u": { name: "upto", test: /^(now|\d{6,12})$/ },
    "S": { name: "filter_src", nullable: true,
           test: _rxcompile, convert: _rxcompile },
    "D": { name: "filter_dest", nullable: true,
           test: _rxcompile, convert: _rxcompile },
    "l": { name: "links", test: /^[wmsa]$/,
           titles: { "w": "WAN", "m": "Migration", "s": "Staging", "a": "All" } },
    "q": { name: "quantity", test: /^[dsl]$/,
           titles: { "d": "Destination", "s": "Source", "l": "Link" } },
    "i": { name: "instance", test: /^[pdt]+$/,
           titles: { "p": "Production", "d": "Debug", "t": "Dev" } },
    "c": { name: "chart", test: /^[hlatbsdpow]$/,
           titles: { "h": "Histogram", "l": "Line", "a": "Calendar", "t": "Table",
                     "b": "Bar", "s": "Scatter", "d": "Density", "p": "Partition",
                     "o": "Chord", "w": "World" } },
    "y": { name: "style", test: /^[scp]$/,
           titles: { "s": "Stacked", "c": "Cumulative", "p": "Points Only" } },
    "O": { name: "order", test: /^[pctmousgb]+$/,
           titles: { "p": "Production", "c": "Conditions", "t": "Data Tiers",
                     "m": "MC/Data Type", "o": "Complete?", "u": "Custodial?",
                     "s": "Subscribed?", "g": "Physics Group", "b": "Block ID" } },
    "m": { name: "merge", nullable: true,
           test: gui.rx.FLOAT, convert: parseFloat },
    "a": { name: "axis_type", test: /^[lg]$/,
           titles: { "l": "Linear", "g": "Logarithmic" } },
    "N": { name: "axis_min", nullable: true,
           test: gui.rx.FLOAT, convert: parseFloat },
    "X": { name: "axis_max", nullable: true,
           test: gui.rx.FLOAT, convert: parseFloat },
    "B": { name: "axis_bins", nullable: true,
           test: gui.rx.INT, convert: parseInt },
    "R": { name: "split_rows", test: /^[nstcrix]$/,
           titles: { "n": "Node", "s": "Site", "t": "Tier", "c": "Country",
                     "r": "Region", "i": "Instance", "x": "None" } },
    "C": { name: "split_cols", test: /^[nstcrix]$/,
           titles: { "n": "Node", "s": "Site", "t": "Tier", "c": "Country",
                     "r": "Region", "i": "Instance", "x": "None" } },
    "t": { name: "stacking", test: /^[nstcrix]$/,
           titles: { "n": "Node", "s": "Site", "t": "Tier", "c": "Country",
                     "r": "Region", "i": "Instance", "x": "None" } },
    "g": { name: "group_value", test: /^[nstcri]$/,
           titles: { "n": "Node", "s": "Site", "t": "Tier", "c": "Country",
                     "r": "Region", "i": "Instance" } },
    "G": { name: "group_link", test: /^[nstcria]$/,
           titles: { "n": "Node", "s": "Site", "t": "Tier", "c": "Country",
                     "r": "Region", "i": "Instance", "a": "As Destination" } },
    "L": { name: "sort_legend", test: /^[lvc]$/,
           titles: { "l": "Label", "v": "Value", "c": "Count" } },
    "T": { name: "animate", test: /^[yn]$/, titles: { "y": "On", "n": "Off" } },
    "V": { name: "animate_step", nullable: true,
           test: gui.rx.INT, convert: parseInt },
    "P": { name: "print", nullable: true, test: /^[pcj]$/,
           titles: { "p": "Plot", "c": "CSV", "j": "JSON" } }
  };

  var _defaults =
  {
    w: "96", s: "h", u: "now", S: "", D: "", l: "w", q: "d", i: "p", c: "h",
    O: "pctm", y: "s", m: 2, a: "l", N: "", X: "", B: "", R: "x", C: "x", t: "x",
    g: "n", G: "a", L: "l", T: "y", V: "400", P: ""
  };

  this.Graph = function(node, title)
  {
    var _me = this;
    var _redrawTO = null;
    var _complete = false;

    this.node = node;
    this.params = { valid: /^.$/, invalid: {}, defaults: {},
                    url: {}, parsed: {}, label: {}, modified: {} };
    this.attrs = { instance_title: null, filter_title: null, data_title: null,
                   span: null, start: null, end: null,
                   group_dest: null, group_src: null,
                   group_row: null, group_column: null,
                   group_stack: null, data_label: null,
                   datareqs: [], animator: null, animate_index: null };

    this.title = title;
    this.label = title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    this.axis_title = { x: "X Title", y: "Y Title" };
    this.per_link = false;
    this.per_node = false;
    this.has_time_axis = /^[hlat]$/;
    this.time_series_data = {};
    this.basic_data = {};
    this.other_data = {};
    this.raw_data = {};
    this.metadata = { nodes: {}, links: {}, hosts: {} };
    this.canvas = null;

    this.reset = function()
    {
      _me.metadata = { nodes: {}, links: {}, hosts: {} };
      _me.raw_data = {};
      _me.canvas = null;
      _complete = false;

      if (_redrawTO)
      {
        clearTimeout(_redrawTO);
        _redrawTO = null;
      }

      _me.attrs.animate_index = null;
      if (_me.attrs.animator)
      {
        clearInterval(_me.attrs.animator);
        _me.attrs.animator = null;
      }
    };

    this.detach = function()
    {
      _me.reset();
      _self.cache.cancel();
    };

    var _scheduleAnimation = function(index, anim)
    {
      if (_me.attrs.animator)
        clearInterval(_me.attrs.animator);

      if (_me.params.parsed.animate == "y")
        _me.attrs.animator = setInterval(function()
          { anim(_me.attrs.animate_index = index()); },
          _me.params.parsed.animate_step);
      else
        anim(index());
    };

    var _scheduleRequire = function(r)
    {
      if (! r.pending)
      {
        r.pending = true;
        setTimeout(function() { _self.cache.require(r.path, _me.finish, r); }, 0);
      }
    };

    this.next = function()
    {
      var reqs = _me.attrs.datareqs;
      _complete = (reqs.length == 0);

      for (var i = 0; i < reqs.length; ++i)
        _scheduleRequire(reqs[i]);

      if (_redrawTO)
      {
        clearTimeout(_redrawTO);
        _redrawTO = null;
      }

      if (! _complete)
        _redrawTO = setTimeout(_me.redraw, 1000);
      else
        _me.redraw();
    };

    this.finish = function(complete, rawdata, req)
    {
      req.rawdata = rawdata;
      req.complete = true;

      var reqs = _me.attrs.datareqs.sort(function(a, b) {
        return (a.rank - b.rank) || a.path.localeCompare(b.path);
      });

      while (reqs.length && reqs[0].complete)
      {
        var r = reqs.shift();
        r.callback(r.rawdata, r);
      }

      if (reqs.length)
        _me.next();
      else
      {
        _complete = true;
        if (_redrawTO)
        {
          clearTimeout(_redrawTO);
          _redrawTO = null;
        }

        _me.redraw();
      }
    };

    this.redraw = function()
    {
      console.log(_me);
      _me.redraw_chart[_me.params.parsed.chart]();
    }

    var _grid = function(chart)
    {
    };

    this.redraw_chart = {};
    this.redraw_chart.h = function()
    {
      var opts = _me.params.parsed,
          attrs = _me.attrs,
          span = attrs.span,
          c = _me.canvas,
          tsbin = attrs.timeseries.length-1,
          div = new Y.Node(c.chartdiv.node()),
          bb = div.get("region"),
          w = div.get("winWidth") - bb.left - 10,
          h = div.get("winHeight") - bb.top - 10,
          height = Math.max(400, Math.floor(9*w/16), h),
          xaxis = d3.scale.linear(),

          raw_filter = _me.raw_data_filter,
          raw_value = _me.raw_data_value,
          values = d3.merge(d3.values(_me.raw_data))
                   .filter(function(d) {
                     return    d.timebin >= attrs.start
                            && d.timebin < attrs.end
                            && d._link._filter_keep
                            && raw_filter(d);
                   }),
          legend = d3.nest()
                   .key(function(d) { return d._link._group.key; })
                   .rollup(function(d) {
                      var v = [0, 0, 0, d[0]._link._group];
                      d.forEach(raw_value, v);
                      v[0] /= (attrs.end - attrs.start);
                      return v;
                    })
                   .entries(values),
          data   = d3.nest()
                   .key(function(d) { return d._link._to._group_row.name; })
                   .key(function(d) { return d._link._to._group_column.name; })
                   .key(function(d) { return d._timebin.start; })
                   .key(function(d) { return d._link._to._group_stack.name; })
                   .key(function(d) { return d._link._group.key; })
                   .rollup(function(d) {
                      var v = [0, 0, 0, d[0]._link._group];
                      d.forEach(raw_value, v);
                      return v;
                    })
                   .entries(values),
          nrows = data.length,
          ncols = Math.max.apply(Math, data.map(function(d) { return d.values.length; })),
          wunit = Math.floor((w - 20) / ncols),
          hunit = Math.floor((h - 20) / nrows),
          gridrows, gridcols, graphs,
          svg, body, rules, xtitle, ytitle, x, y;

      gridrows = c.chartdiv.selectAll("div.row")
                  .data(data, function(d) { return d.key; })
                  .sort(function(a, b) { return d3.ascending(a.key, b.key); });
      gridrows.enter()
        .append("div")
          .attr("class", "row")
        .append("div")
          .attr("class", "title")
          .style("-webkit-transform", "rotate(-90deg)")
          .style("-moz-transform", "rotate(-90deg)")
          .style("-ms-transform", "rotate(-90deg)")
          .style("-o-transform", "rotate(-90deg)")
          .style("filter", "progid:DXImageTransform.Microsoft.BasicImage(rotation=3);")
          .style("display", function(d) { return d.key ? "" : "none"; })
          .text(function(d) { return d.key; });
      gridrows.exit().remove();

      gridcols = gridrows.selectAll("div.col")
                   .data(function(d) { return d.values; },
                         function(d) { return d.key; })
                   .sort(function(a, b) { return d3.ascending(a.key, b.key); });
      (graphs = gridcols.enter()
        .append("div")
          .attr("class", "col"))
        .append("div")
          .attr("class", "title")
          .style("display", function(d) { return d.key ? "" : "none"; })
          .text(function(d) { return d.key; });
      gridcols.exit().remove();

      svg = graphs
        .append("svg")
          .style("background", "rgba(0, 0, 0, 0.05)")
          .style("width", wunit + "px")
          .style("height", hunit + "px")
        .append("g")
          .attr("class", "graph")
          .attr("transform", "translate(5," + (hunit-5) + ")scale(1, 1)");

      body = svg.append("g")
        .attr("class", "body")
        .attr("transform", "translate(10,10)");

      rules = svg.append("g")
        .attr("class", "rules");

      xtitle = svg.append("text")
        .attr("class", "axis-title")
        .attr("text-anchor", "middle")
        .attr("x", wunit/2)
        .attr("y", 0)
        .text(_me.axis_title.x);

      ytitle = svg.append("text")
        .attr("class", "axis-title")
        .attr("text-anchor", "middle")
        .attr("transform", "rotate(-90)translate(0,10)")
        .attr("x", hunit/2)
        .attr("y", 0)
        .text(_me.title + ", " + _me.axis_title.y);

      //console.log(legend);
      //console.log(data);
    };

    this.redraw_chart.l = function()
    {
      var opts = _me.params.parsed,
          attrs = _me.attrs;
    };

    this.redraw_chart.a = function()
    {
      var opts = _me.params.parsed,
          attrs = _me.attrs;
    };

    this.redraw_chart.t = function()
    {
      var opts = _me.params.parsed,
          attrs = _me.attrs;
    };

    this.redraw_chart.b = function()
    {
      var opts = _me.params.parsed,
          attrs = _me.attrs;
    };

    this.redraw_chart.s = function()
    {
      var opts = _me.params.parsed,
          attrs = _me.attrs;
    };

    this.redraw_chart.d = function()
    {
      var opts = _me.params.parsed,
          attrs = _me.attrs;
    };

    this.redraw_chart.p = function()
    {
      var opts = _me.params.parsed,
          attrs = _me.attrs;
    };

    this.redraw_chart.o = function()
    {
      var opts = _me.params.parsed,
          attrs = _me.attrs;
    };

    this.redraw_chart.w = function()
    {
      var opts = _me.params.parsed,
          attrs = _me.attrs,
          span = attrs.span,
          c = _me.canvas,
          po = org.polymaps,
          arc = d3.geo.greatArc().precision(1),
          tsbin = attrs.timeseries.length-1;
          div = new Y.Node(c.chartdiv.node()),
          bb = div.get("region"),
          w = Math.max(400, div.get("winWidth") - bb.left - 10),
          h = Math.max(400, div.get("winHeight") - bb.top - 10),
          svg = new Y.Node(c.svg),
          visible = null,

          zoom = c.map.zoom,
          raw_filter = _me.raw_data_filter,
          raw_value = _me.raw_data_value,
          values = d3.merge(d3.values(_me.raw_data))
                   .filter(function(d) {
                     return    d.timebin >= attrs.start
                            && d.timebin < attrs.end
                            && d._link._group.group_src.geoip
                            && d._link._group.group_dest.geoip
                            && d._link._filter_keep
                            && raw_filter(d);
                    }),
          links  = d3.nest()
                   .key(function(d) { return d._timebin.start; })
                   .key(function(d) { return d._link._group.key; })
                   .rollup(function(d) {
                      var v = [0, 0, 0, d[0]._link._group];
                      d.forEach(raw_value, v);
                      return v;
                    })
                   .map(values);
          sites  = d3.nest()
                   .key(function(d) { return d._timebin.start; })
                   .key(function(d) { return d._link._group.group_dest.name; })
                   .rollup(function(d) {
                      var v = [0, 0, 0, d[0]._link._group.group_dest];
                      d.forEach(raw_value, v);
                      return v;
                    })
                   .map(values);

      svg.setAttribute("width", w + "px");
      svg.setAttribute("height", h + "px");
      for (var bin = 0; bin < attrs.timeseries.length; ++bin)
      {
        var ts = attrs.timeseries[bin],
            nsecs = ts.end - ts.start,
            gl = c.links[ts.start],
            gs = c.sites[ts.start];

        gl.on("load", po.stylist()
              .attr("fill", "none")
              .attr("stroke", function(d) { return d.v[3].group_dest.colour; })
              .attr("stroke-width", function(d) {
                return Math.pow(2,zoom()-5) * Math.max(0.2,Math.sqrt(d.v[0]/nsecs)); })
              .attr("stroke-opacity", "0.4")
              .attr("stroke-linecap", "round")
              .title(function(d) {
                return sprintf("%s: %.1f MB/s, %d files",
                               d.v[3].display, d.v[0]/nsecs, d.v[1]); }))
          .features(d3.values(links[ts.start])
                    .sort(function(a, b) { return b[0] - a[0]; })
                    .map(function(d) {
                      var sloc = d[3].group_src.geoip,
                          dloc = d[3].group_dest.geoip;
                     
                      return { type: "Feature", title: d[3].display, v: d,
                               geometry: arc2path(arc({ source: [sloc.lon, sloc.lat],
                                                        target: [dloc.lon, dloc.lat] })) };
                    }));
        gs.on("load", po.stylist()
              .attr("r", function(d) {
                return Math.pow(2, zoom()-5) * Math.sqrt(d.v[0]/nsecs); })
              .attr("fill", function(d) { return d.v[3].colour; })
              .attr("fill-opacity", "0.8")
              .attr("stroke", "#000")
              .attr("stroke-opacity", "0.4")
              .attr("stroke-width", "1px")
              .title(function(d) {
                return sprintf("%s: %.1f MB/s, %d files",
                               d.v[3].name, d.v[0]/nsecs, d.v[1]); }))
          .features(d3.values(sites[ts.start])
                    .sort(function(a, b) { return b[0] - a[0]; })
                    .map(function(d) {
                      var dloc = d[3].geoip;
                      return { type: "Feature", title: d[3].name, v: d,
                               geometry: { type: "Point",
                                           coordinates: [dloc.lon, dloc.lat] } };
                    }));
      }

      _scheduleAnimation
        (function()
         {
           var bin = tsbin;
           if (--tsbin < 0)
             tsbin = attrs.timeseries.length-1;
           return attrs.timeseries[bin];
         },
         function(ts)
         {
           if (visible)
           {
             c.links[visible].visible(false);
             c.sites[visible].visible(false);
           }

           visible = ts.start;
           c.links[visible].visible(true);
           c.sites[visible].visible(true);

           c.timeslot
            .html(span.title + " "
                  + span.format(ts.start) + " &#8212; "
                  + span.format(ts.end-1) + " UTC");
         });
    };

    this.basic_data["nodes"] = function(rawdata, req)
    {
      var db = req.db,
          hosts = _me.metadata.hosts,
          table = _me.metadata.nodes[db] = {},
          opts = _me.params.parsed,
          attrs = _me.attrs,
          c = d3.scale.category20(),
          groups = { n: {}, s: {}, c: {}, r: {}, t: {}, i: {}, x: {} },
          sereq = {};

      for (var i = 0; i < rawdata.length; ++i)
      {
        var n = rawdata[i];

        table[n.name] = n;
        n._group = {};
        n._filter_keep = true;

        if (opts.filter_dest && ! opts.filter_dest.test(n.name))
          n._filter_keep = false;

        if (n.se && ! (n.hostinfo = hosts[n.se]))
          sereq[n.se] = 1;

        for (var grouping in _groupname)
        {
          var group, groupname = _groupname[grouping](db, n.name);
          if (! (groupname in groups[grouping]))
            group = groups[grouping][groupname]
              = { name: groupname, colour: null, hosts: {}, geoip: null };
          else
            group = groups[grouping][groupname];

          n._group[grouping] = group;

          if (n.se && n.hostinfo)
          {
            group.hosts[n.se] = n.hostinfo;
            Y.Object.each(n.hostinfo.ipaddrs, function(addr) {
              if (addr.geoip && addr.geoip.lat && addr.geoip.lon)
                group.geoip = addr.geoip;
            });
          }
        }

        n._group_dest = n._group[attrs.group_dest];
        n._group_src = n._group[attrs.group_src];
        n._group_row = n._group[attrs.group_row];
        n._group_column = n._group[attrs.group_column];
        n._group_stack = n._group[attrs.group_stack];
      }

      Y.each(Y.Object.keys(table).sort(d3.ascending),
             function(node, i) { table[node].colour = c(i); });

      for (var grouping in _groupname)
        Y.each(Y.Object.keys(groups[grouping]).sort(d3.ascending),
               function(g, i) { groups[grouping][g].colour = c(i); });

      if (! Y.Object.isEmpty(sereq))
      {
        var hosts = Y.Object.keys(sereq).sort(function(a, b) {
          var aparts = a.split(".").reverse();
          var bparts = b.split(".").reverse();
          for (var i = 0; i < aparts.length || i < bparts.length; ++i)
          {
            if (i >= aparts.length)
              return -1;
            if (i >= bparts.length)
              return 1;
            var diff = aparts[i].localeCompare(bparts[i]);
            if (diff)
              return diff;
          }
          return 0;
        });

        hosts = hosts.map(function(h) { return "host=" + X.encodeAsPath(h); });
        while (hosts.length)
        {
          var qs = hosts.splice(0, 5).join("&");
          _me.attrs.datareqs.push({ rank: 30, callback: _me.host_data,
                                    path: "/host/name?" + qs });
        }
      }
    };

    this.other_data["links"] = function(rawdata, req)
    {
      var nodes = _me.metadata.nodes[req.db],
          table = _me.metadata.links[req.db] = {},
          opts = _me.params.parsed,
          attrs = _me.attrs,
          groups = {};

      for (var i = 0; i < rawdata.length; ++i)
      {
        var l = rawdata[i],
            dest = nodes[l.to],
            src = nodes[l.from],
	    group = attrs.data_label(groups, dest, src);
 
	table[l.to + " " + l.from] = l;
        l._filter_keep = true;
        l._group = group;
        l._to = dest;
        l._from = src;

        switch (opts.links)
        {
        case "w": l._filter_keep = (l.kind == "WAN"); break;
        case "m": l._filter_keep = (l.kind == "Migration"); break;
        case "s": l._filter_keep = (l.kind == "Staging"); break;
        }

        if (l._filter_keep && opts.filter_src && ! opts.filter_src.test(l.from))
          l._filter_keep = false;

        if (l._filter_keep && opts.filter_dest && ! opts.filter_dest.test(l.to))
          l._filter_keep = false;
      }
    };

    this.host_data = function(rawdata, req)
    {
      var hosts = _me.metadata.hosts,
          nodes = _me.metadata.nodes;

      for (var i = 0; i < rawdata.length; ++i)
        hosts[rawdata[i].hostname] = rawdata[i];

      for (var db in nodes)
        for (var node in nodes[db])
        {
          var n = nodes[db][node];
          if (n.se && n.se in hosts)
          {
            var i = hosts[n.se];
            n.hostinfo = i;
            for (var grouping in _groupname)
            {
              var g = n._group[grouping];
              g.hosts[n.se] = i;
              Y.Object.each(i.ipaddrs, function(addr) {
                if (addr.geoip && addr.geoip.lat && addr.geoip.lon)
                  g.geoip = addr.geoip;
              });
            }
          }
        }
    };

    this.parse = function(queryopts)
    {
      var attrname, attr, i, v,
          params = _me.params,
          valid = params.valid,
          invalid = Y.merge({}, params.invalid),
          values = [_defaults, params.defaults, queryopts];

      for (attrname in _urlopts)
      {
        attr = _urlopts[attrname];
        if (! attr.internal && ! valid.test(attrname))
          continue;

        for (i = 0; i < (attr.internal ? 2 : values.length); ++i)
        {
          if (! (attrname in values[i]))
            continue;

          v = values[i][attrname];
          if (((attr.nullable && v == "") || _test(v, attr.test))
              && (! (attrname in invalid) || ! _test(v, invalid[attrname])))
          {
            if (attr.titles && (v in attr.titles))
              params.label[attr.name] = attr.titles[v];
            params.modified[attrname] = (i == 2 && params.url[attrname] != v);
            params.parsed[attr.name] = ((attr.nullable && v == "") ? null
                                        : (attr.convert ? attr.convert(v) : v));
            params.url[attrname] = v;
          }
        }
      }

      if (params.parsed.chart == "w" && params.parsed.quantity != "l")
      {
        params.parsed.quantity = params.url.q = "l";
        params.label.quantity = _urlopts.q.titles.l;
        params.modified.q = false;
      }
    };

    this.run = function(queryopts)
    {
      _me.parse(queryopts);

      var opts = _me.params.parsed,
          label = _me.params.label,
          attrs = _me.attrs,
          data = attrs.datareqs,
          dblist = [];

      attrs.instance_title = "";
      for (var db = 0; db < opts.instance.length; ++db)
      {
        var dbletter = opts.instance[db];
        var path = _dbpath[dbletter];
        dblist.push(path);
        attrs.instance_title += (attrs.instance_title ? ", " : "");
        attrs.instance_title += _urlopts.i.titles[dbletter];

        for (var rd in _me.basic_data)
          data.push({ rank: 0, db: path, callback: _me.basic_data[rd],
                      path: ("/phedex/" + path + "/" + rd) });

        for (var rd in _me.other_data)
          data.push({ rank: 10, db: path, callback: _me.other_data[rd],
                      path: ("/phedex/" + path + "/" + rd) });
      }

      if (! Y.Object.isEmpty(_me.time_series_data))
      {
        attrs.span = TimeSeries.byLetter[opts.span];
        attrs.end = (opts.upto && attrs.span.end(opts.upto));
        attrs.span.range(attrs, null, attrs.end, opts.timewidth || 0);
        if (_me.has_time_axis.test(opts.chart) || opts.animate == "y")
          attrs.timeseries = attrs.span.series(attrs.start, attrs.end);
        else
          attrs.timeseries = [{ start: attrs.start, end: attrs.end }];

        for (var t = attrs.start, l = Math.floor((attrs.end + 86399)/86400) * 86400;
             t < l; t += 86400)
        {
          var dt = new Date(t*1000);
          var day = sprintf("%04d%02d%02d",
                            dt.getUTCFullYear(),
                            dt.getUTCMonth()+1,
                            dt.getUTCDate());

          for (var rd in _me.time_series_data)
            for (var db = 0; db < dblist.length; ++db)
              data.push({ rank: 20, db: path, callback: _me.time_series_data[rd],
                          path: ("/phedex/" + dblist[db] + "/" + rd + "/"
                                 + (opts.span == "h" ? "H" : "D") + day) });
        }

        _me.axis_title.x = attrs.span.name.charAt(0).toUpperCase()
                           + attrs.span.name.substr(1);
      }

      attrs.group_row = (opts.split_rows || "x");
      attrs.group_column = (opts.split_cols || "x");
      attrs.group_stack = (opts.stacking || "x");
      attrs.group_src = (opts.group_value || "n");
      attrs.group_dest = (opts.group_value || "n");

      if (_me.per_node)
      {
        attrs.filter_title = null;
        if (opts.filter_dest)
          attrs.filter_title = "Nodes Matching '"
                               + Y.Escape.html(opts.filter_dest.source) + "'";

        attrs.data_title = "By Destination " + label.group_value;
        attrs.data_label = _nodelabel.d;
      }
      else if (_me.per_link)
      {
        attrs.filter_title = null;
        if (opts.filter_src)
          attrs.filter_title = "Sources matching '"
                               + Y.Escape.html(opts.filter_src.source) + "'";

        if (opts.filter_dest)
          attrs.filter_title =
            ((attrs.filter_title ? attrs.filter_title + " and d" : "D")
             + "estinations matching '"
             + Y.Escape.html(opts.filter_dest.source) + "'");

        var link = (opts.group_link == "a" ? opts.group_value : opts.group_link);
        attrs.group_src = link;
        attrs.data_label = _linklabel[opts.quantity];
        attrs.data_title = "By ";
        if (opts.quantity == "l")
        {
          if (opts.group_link == "a" || opts.group_value == opts.group_link)
            attrs.data_title += label.group_value + " links";
          else
            attrs.data_title += label.group_link + " to "
                                + label.group_value + " links";
        }
        else
        {
          if (opts.group_value == "i")
            attrs.data_title += label.group_value;
          else
            attrs.data_title += label.quantity + " " + label.group_value;
        }

        attrs.data_title += " of " + label.links + " connections";
      }

      _me.reset();
      _me.initdraw();
      _me.next();
      return _me;
    };

    this.initdraw = function()
    {
      var opts = _me.params.parsed,
          attrs = _me.attrs,
          c = _me.canvas,
          po = org.polymaps;

      if (! c || node.getAttribute("x-chart") != opts.chart)
      {
        node.generateID();
        node.setAttribute("x-chart", opts.chart);
        node.setAttribute("class", "figure");
        X.applyContent(node, "");

        c = _me.canvas = {};
        c.container = d3.select(node.getDOMNode());

        c.title = c.container.append("h2").attr("class", "figure-title");
        c.subtitle = c.container.append("h3").attr("class", "figure-subtitle");

        if (attrs.timeseries)
          c.timeslot = c.container.append("h3").attr("class", "figure-subtitle");

        c.chartdiv = c.container.append("div")
          .attr("class", "charts")
          .style("width", "100%");

        switch (opts.chart)
        {
        case "h":
          break;

        case "l":
          break;

        case "a":
          break;

        case "t":
          break;

        case "b":
          break;

        case "s":
          break;

        case "d":
          break;

        case "p":
          break;

        case "o":
          break;

        case "w":
          c.svg = po.svg("svg");
          c.map = po.map()
             .container(c.chartdiv.node().appendChild(c.svg))
             .center({lat: 30, lon: -20})
             .centerRange([{lat: -85.05112877980659, lon: -180 },
                           {lat: +85.05112877980659, lon: +180 }])
             .zoomRange([2, 9]).zoom(3)
             .add(po.interact())
             .add(po.image()
                  .url(REST_SERVER_ROOT + "/image/world-map/{Z}-r{Y}-c{X}.jpg")
                  .id("map-image"))
             .add(po.compass().pan("none"));

          c.links = {};
          c.sites = {};
          for (var i = 0; i < attrs.timeseries.length; ++i)
          {
            var tsbin = attrs.timeseries[i].start;
            c.map.add(c.links[tsbin] = po.geoJson().visible(false));
            c.map.add(c.sites[tsbin] = po.geoJson().visible(false));
          }
          break;
        }
      }

      c.title.html(attrs.instance_title + " " + _me.title);
      c.subtitle.html((attrs.filter_title || "") + " " + attrs.data_title);
      if (attrs.timeseries)
        c.timeslot.html(attrs.span.title + " "
                        + attrs.span.format(attrs.start) + " &#8212; "
                        + attrs.span.format(attrs.end-1) + " UTC");

      if ("svg" in c)
      {
        var div = new Y.Node(c.chartdiv.node()),
            bb = div.get("region"),
            w = Math.max(400, div.get("winWidth") - bb.left - 10),
            h = Math.max(400, div.get("winHeight") - bb.top - 10);
        c.svg.setAttribute("width", w + "px");
        c.svg.setAttribute("height", h + "px");
      }
    };

    return this;
  };

  this.LinkValueGraph = X.inherit(_self.Graph, function(node, title, attr, multiplier)
  {
    _self.Graph.call(this, node, title);

    var _me = this;
    var _bytes = attr + "_bytes";
    var _files = attr + "_files";

    this.params.valid = /^[^OaNXB]$/;
    this.params.invalid = { c: /^[dp]$/ };
    this.params.defaults = { T: "n" };
    this.per_link = true;

    this.raw_data_filter = function(d)
    {
      return d[_bytes] > 0 && d[_files] > 0;
    };

    this.raw_data_value = function(d)
    {
      this[0] += d[_bytes]*multiplier;
      this[1] += d[_files];
    };

    for (var i = 4; i < arguments.length; ++i)
      this.time_series_data[arguments[i]] = function(rawdata, req)
      {
        var search_span = _me.attrs.span.search,
            timeseries = _me.attrs.timeseries,
            links = _me.metadata.links[req.db];

        for (var j = 0; j < rawdata.length; ++j)
        {
          var d = rawdata[j];
          d._timebin = search_span(timeseries, d.timebin);
          d._linkid = d.to_node + " " + d.from_node;
          d._link = links[d._linkid];
          d._db = req.db;
        }

        _me.raw_data[req.path] = rawdata;
      };

    return this;
  });

  this.LinkStatsGraph = X.inherit(_self.LinkValueGraph, function(node, title, attr, multiplier)
  {
    _self.LinkValueGraph.call(this, node, title, attr, multiplier, "link-stats");
    return this;
  });

  this.LinkEventsGraph = X.inherit(_self.LinkValueGraph, function(node, title, attr, multiplier)
  {
    _self.LinkValueGraph.call(this, node, title, attr, multiplier, "link-events");
    // this.params.defaults.L = "c";
    return this;
  });

  this.NodeVolumeGraph = X.inherit(_self.Graph, function(node, title, attr, multiplier)
  {
    _self.Graph.call(this, node, title);
    var _me = this;
    var _bytes = attr + "_bytes";
    var _files = attr + "_files";
    this.params.valid = /^[^OaNXBtG]$/;
    this.params.invalid = { c: /^[dpo]$/, q: /^[^d]$/ };
    this.params.defaults = { c: "l", y: "s", T: "n" };
    this.per_node = true;

    this.raw_data_filter = function(d)
    {
      return d[_bytes] > 0 && d[_files] > 0;
    };

    this.raw_data_value = function(d)
    {
      this[0] += d[_bytes]*multiplier;
      this[1] += d[_files];
    };

    this.time_series_data["dest-stats"] = function(rawdata, req)
    {
      var search_span = _me.attrs.span.search,
          timeseries = _me.attrs.timeseries,
          nodes = _me.metadata.nodes[req.db];

      for (var i = 0; i < rawdata.length; ++i)
      {
        var d = rawdata[i];
        d._timebin = search_span(timeseries, d.timebin);
        d._node = nodes[d.node];
        d._db = req.db;
      }

      _me.raw_data[req.path] = rawdata;
    };

    return this;
  });

  this.TransferMap = X.inherit(_self.LinkStatsGraph, function(node)
  {
    _self.LinkEventsGraph.call(this, node, "Transfer Map", "done", 1e-6);
    this.params.valid = /^[^yOmaNXBRCtL]$/;
    this.params.defaults = { c: "w", g: "s", T: "y" };
    this.params.invalid = { l: /^[^w]$/, q: /^[^l]$/, c: /^[^w]$/,
                            g: /^[^s]$/, G: /^[^sa]$/ };
    return this;
  });

  this.TransferRate = X.inherit(_self.LinkStatsGraph, function(node)
  {
    _self.LinkEventsGraph.call(this, node, "Transfer Rate", "done", 1e-6);
    this.axis_title.y = "MB/s";
    return this;
  });

  this.RegionCrossRate = X.inherit(_self.LinkStatsGraph, function(node)
  {
    _self.LinkEventsGraph.call(this, node, "Region Cross Rate", "done", 1e-6);
    this.axis_title.y = "MB/s";
    this.params.valid = /^[^yOmaNXBRCtL]$/;
    this.params.invalid = { l: /^[^w]$/, q: /^[^l]$/, c: /^[^t]$/,
                            g: /^[^r]$/, G: /^[^r]$/ };
    this.params.defaults = { l: "w", q: "l", c: "t", g: "r", G: "r", T: "n" };
    return this;
  });

  this.TransferQuality = X.inherit(_self.LinkEventsGraph, function(node)
  {
    _self.LinkEventsGraph.call(this, node, "Transfer Quality", "done", 1e-6);
    this.axis_title.y = "";
    this.params.valid = /^[^OaNXB]$/;
    this.params.invalid = { c: /^[dp]$/, L: /^c$/ };
    this.params.defaults = { c: "a", t: "n", T: "n" };
    this.per_link = true;

    this.raw_data_filter = function(d)
    {
      return d.done_files > 0 && d.fail_files > 0;
    };

    this.raw_data_value = function(d)
    {
      this[0] += d.done_files;
      this[1] += d.fail_files;
      this[2] = (this[0] ? (this[0] / (this[0]+this[1])) : -1);
    };

    return this;
  });

  this.RateQuality = X.inherit(_self.LinkValueGraph, function(node)
  {
    _self.LinkValueGraph.call(this, node, "Rate vs. Quality", "done", 1e-6,
                              "link-stats", "link-events");
    var _me = this;
    this.axis_title.y = "";
    this.params.valid = /^[^OB]$/;
    this.params.invalid = { c: /^[hlbdpow]$/, y: /^[sc]$/, L: /^[vc]$/ },
    this.params.defaults = { c: "s", T: "n" };
    this.per_link = true;

    this.raw_data_filter = function(d)
    {
      return ("xfer_bytes" in d
              ? (d.xfer_bytes > 0 && d.xfer_files > 0)
              : (d.done_files > 0 && d.fail_files > 0));
    };

    this.raw_data_value = function(d)
    {
      if ("xfer_bytes" in d)
      {
        this[0][0] += d.xfer_bytes*1e-6;
        this[0][1] += d.xfer_files;
      }
      else
      {
        this[1][0] += d.done_files;
        this[1][1] += d.fail_files;
        this[1][2] = (this[1][0] ? (this[1][0] / (this[1][0]+this[1][1])) : -1);
      }
    };

    return this;
  });

  this.TransferVolume = X.inherit(_self.LinkStatsGraph, function(node)
  {
    _self.LinkStatsGraph.call(this, node, "Transfer Volume", "xfer", 1e-12);
    this.axis_title.y = "TB";
    this.params.defaults = { c: "l", y: "s", T: "n" };
    return this;
  });

  this.SiteSpaceUse = X.inherit(_self.Graph, function(node)
  {
    _self.Graph.call(this, node, "Site Space Use");
    var _me = this;
    this.axis_title.y = "TB";
    this.params.valid = /^[^wsuSlyaNXBtGLTV]$/;
    this.params.invalid = { c: /^[absdow]$/, q: /^[^d]$/ };
    this.params.defaults = { c: "p" };
    this.per_node = true;

    this.basic_data["groups"] = function(rawdata, req)
    {
      // FIXME;
    };

    this.other_data["group-usage"] = function(rawdata, req)
    {
      // FIXME;
    };

    return this;
  });

  this.GroupSpaceUse = X.inherit(_self.Graph, function(node)
  {
    _self.Graph.call(this, node, "Group Space Use");
    var _me = this;
    this.axis_title.y = "TB";
    this.params.valid = /^[^wsuSlyaNXBtGLTV]$/;
    this.params.invalid = { c: /^[absdow]$/, q: /^[^d]$/ };
    this.params.defaults = { c: "p" };
    this.per_node = true;

    this.basic_data["groups"] = function(rawdata, req)
    {
      // FIXME;
    };

    this.other_data["group-usage"] = function(rawdata, req)
    {
      // FIXME;
    };

    return this;
  });

  this.TransferAttempts = X.inherit(_self.LinkEventsGraph, function(node)
  {
    _self.LinkEventsGraph.call(this, node, "Transfer Attempts", "try", 1e-12);
    this.axis_title.y = "TB";
    return this;
  });

  this.TransferCompleted = X.inherit(_self.LinkEventsGraph, function(node)
  {
    _self.LinkEventsGraph.call(this, node, "Transfer Completed", "done", 1e-12);
    this.axis_title.y = "TB";
    return this;
  });

  this.TransferFailures = X.inherit(_self.LinkEventsGraph, function(node)
  {
    _self.LinkEventsGraph.call(this, node, "Transfer Failures", "fail", 1e-12);
    this.axis_title.y = "TB";
    return this;
  });

  this.QueuedVolume = X.inherit(_self.NodeVolumeGraph, function(node)
  {
    _self.NodeVolumeGraph.call(this, node, "Queued Volume", "dest", 1e-12);
    this.axis_title.y = "TB";
    return this;
  });

  this.MissingVolume = X.inherit(_self.NodeVolumeGraph, function(node)
  {
    _self.NodeVolumeGraph.call(this, node, "Missing Volume", "miss", 1e-12);
    this.axis_title.y = "TB";
    return this;
  });

  this.ResidentVolume = X.inherit(_self.NodeVolumeGraph, function(node)
  {
    _self.NodeVolumeGraph.call(this, node, "Resident Volume", "node", 1e-12);
    this.axis_title.y = "TB";
    return this;
  });

  this.RequestedVolume = X.inherit(_self.NodeVolumeGraph, function(node)
  {
    _self.NodeVolumeGraph.call(this, node, "Requested Volume", "request", 1e-12);
    this.axis_title.y = "TB";
    return this;
  });

  this.IdleVolume = X.inherit(_self.NodeVolumeGraph, function(node)
  {
    _self.NodeVolumeGraph.call(this, node, "Idle Volume", "idle", 1e-12);
    this.axis_title.y = "TB";
    return this;
  });

  this.BlockLatency = X.inherit(_self.Graph, function(node)
  {
    _self.Graph.call(this, node, "Block Latency");
    var _me = this;
    this.axis_title.y = "Hours";
    this.axis_title.z = "Blocks";
    this.params.valid = /^[^OtG]$/;
    this.params.invalid = { c: /^[^dt]$/, q: /^[^d]$/ };
    this.params.defaults = { c: "d", T: "n" };
    this.per_node = true;

    this.time_series_data["block-latency"] = function(rawdata, req)
    {
      // FIXME;
    };

    return this;
  });

  var _plots = [[this.TransferMap, this.TransferRate, this.RegionCrossRate,
                 this.TransferQuality, this.RateQuality,
                 this.TransferVolume],
                [this.SiteSpaceUse, this.GroupSpaceUse],
                [this.TransferAttempts, this.TransferCompleted,
                 this.TransferFailures],
                [this.QueuedVolume, this.MissingVolume,
                 this.ResidentVolume, this.RequestedVolume,
                 this.IdleVolume],
                [this.BlockLatency]];

  var _view = null;
  var _page = null;
  var _contentDisplayMode = "full";
  var _savedStyleForHidden = {};
  var _styleForExposedPath = {
    "left":           "auto",
    "right":          "auto",
    "top":            "auto",
    "bottom":         "auto",
    "display":        "",
    "position":       "static",
    "margin-top":     "0px",
    "margin-left":    "0px",
    "margin-bottom":  "0px",
    "margin-right":   "0px",
    "padding-top":    "0px",
    "padding-left":   "0px",
    "padding-bottom": "0px",
    "padding-right":  "0px",
  };

  var _hideApplyStyle = function(node, attr, value)
  {
    var val = node.getStyle(attr);
    if (val != value)
    {
      var id = node.get("id");
      node.setStyle(attr, value);
      if (! (id in _savedStyleForHidden))
        _savedStyleForHidden[id] = {};
      _savedStyleForHidden[id][attr] = val;
    }
  };

  var _hideSiblingsToRoot = function(child, parent)
  {
    parent.get("childNodes").each(function(sibling) {
      if (sibling.get("tagName")) // Skip text nodes
      {
        sibling.generateID();
        if (sibling == child)
          for (var attr in _styleForExposedPath)
            _hideApplyStyle(sibling, attr, _styleForExposedPath[attr]);
        else
          _hideApplyStyle(sibling, "display", "none");
      }
    });

    var granny = parent.get("parentNode");
    if (granny && granny.get("tagName") != "HTML")
      _hideSiblingsToRoot(parent, granny);
  };

  var _switchToHiddenContent = function()
  {
    var node = _view.node();
    if (_contentDisplayMode != "hidden")
    {
      _savedStyleForHidden = {};
      _contentDisplayMode = "hidden";
      _hideSiblingsToRoot(node, node.get("parentNode"));
      _hideApplyStyle(node, "margin", "5px");
    }

    return node;
  };

  var _switchToShownContent = function()
  {
    var node = _view.node();
    if (_contentDisplayMode != "full")
    {
      _contentDisplayMode = "full";
      for (var id in _savedStyleForHidden)
      {
        var n = Y.one("#" + id);
        var attrs = _savedStyleForHidden[id];
        for (var attr in attrs)
          X.applyStyle(n, attr, attrs[attr]);
      }
      _savedStyleForHidden = {};
    }

    return node;
  };

  this.prenavigate = function()
  {
  };

  this.attach = function()
  {
  };

  this.detach = function()
  {
    _switchToShownContent();
    _self.cache.cancel();
  };

  var _showPlot = function(req, page, node)
  {
    if (_self.plot && ! (_self.plot instanceof page.plottype))
    {
      _self.plot.detach();
      _self.plot = null;
    }

    if (! _self.plot)
      _self.plot = new page.plottype(node);

    _self.plot.run(req.query);
  };

  var _showCSVData = function(req, page, node)
  {
    node.setContent("I should show some CSV data here");
  };

  var _showJSONData = function(req, page, node)
  {
    node.setContent("I should show some JSON data here");
  };

  var _plot = function(req, page, template)
  {
    _page = page;
    _view = _self.templatePage(req, page, template);
    switch (req.query.P)
    {
    default:  _showPlot(req, page, _switchToShownContent()); break
    case "p": _showPlot(req, page, _switchToHiddenContent()); break;
    case "c": _showCSVData(req, page, _switchToHiddenContent()); break;
    case "j": _showJSONData(req, page, _switchToHiddenContent()); break;
    }
  };

  var pages = [];
  Y.each(_plots, function(a, i) {
    Y.each(a, function(p, j) {
      var plot = new p();
      pages.push({ route: _plot, template: "plot", title: plot.title,
                   label: "plot/" + plot.label, plottype: p,
                   margin: (i && j == 0 ? "1.25em" : "") });
    });
  });
  View.call(this, Y, gui, rank, "PhEDEx", pages);

  var YWPA = Y.WidgetPositionAlign;
  var _panel = new Y.Panel({ bodyContent: "", headerContent: "", render: true,
                             plugins: [ Y.Plugin.Drag ], visible: false,
                             align: { points: [ YWPA.TR, YWPA.TR ] } });
  _panel.get("boundingBox").addClass("popup-panel");

  var _positionPanel = function(bb, rold)
  {
    var w = bb.get("winWidth");
    var h = bb.get("winHeight");
    var rnew = bb.get("region");

    _panel.set("x", rold.right - rnew.width);
    rnew = bb.get("region");

    if (rnew.top < 40)
      _panel.set("y", Math.min(40, h - 10));
    if (rnew.bottom > h - 5)
      _panel.set("y", Math.max(10, h - rnew.height - 5));
    if (rnew.left < 10)
      _panel.set("x", Math.min(10, w - 10));
    if (rnew.right > w - 5)
      _panel.set("x", Math.max(5, w - rnew.width - 5));
  };

  var _showDataPanel = function()
  {
    var bb = _panel.get("boundingBox");
    var r = bb.get("region");
    _panel.set("bodyContent", Y.one("#t-panel-phedex-data").getContent());
    _panel.set("headerContent", "Data Selection").syncUI();
    _panel.set("visible", true);
    _panel.render();
    _positionPanel(bb, r);
  };

  var _showDisplayPanel = function()
  {
    var bb = _panel.get("boundingBox");
    var r = bb.get("region");
    _panel.set("bodyContent", Y.one("#t-panel-phedex-display").getContent());
    _panel.set("headerContent", "Display Options").syncUI();
    _panel.set("visible", true);
    _panel.render();
    _positionPanel(bb, r);
  };

  gui.history.route("/phedex/show/data", _showDataPanel);
  gui.history.route("/phedex/show/display", _showDisplayPanel);
  //_showDataPanel();

  this.errorReport = gui.errorReport;
  return this;
});
