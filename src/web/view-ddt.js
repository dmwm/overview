var DDT = X.inherit(View, function(Y, gui, rank)
{
  var _self = this;
  var _t0graphs  = [ "request", "pending/self",
                     "pending/t1", "quality/t1",
                     "pending/mss", "quantity/mss",
                     "idle", "request" ];
  var _t12graphs = [ "request", "pending/self",
                     "pending/t0-t1", "quality/t0-t1",
                     "quantity/buffer", "quantity/all",
                     "idle", "request" ];

  var _site = function(req, page, template)
  {
    var graph = 0;
    var graphs = page.label.charAt(1) == "0" ? _t0graphs : _t12graphs;
    var view = _self.templatePage(req, page, template);
    _self.doc.all("img").each(function(img) {
      img.setAttribute("src", REST_SERVER_ROOT + "/image/" + _self.id + "/"
                       + X.encodeAsPath(page.label) + "/" + graphs[graph++]);
    });
  };

  View.call(this, Y, gui, rank, "DDT",
            [{ route: _site, template: "site", label: "t0-ch-cern", title: "T0_CH_CERN",  },
             { route: _site, template: "site", label: "t1-ch-cern", title: "T1_CH_CERN" },
             { route: _site, template: "site", label: "t1-de-kit", title: "T1_DE_KIT" },
             { route: _site, template: "site", label: "t1-es-pic", title: "T1_ES_PIC" },
             { route: _site, template: "site", label: "t1-fr-ccin2p3", title: "T1_FR_CCIN2P3" },
             { route: _site, template: "site", label: "t1-it-cnaf", title: "T1_IT_CNAF" },
             { route: _site, template: "site", label: "t1-tw-asgc", title: "T1_TW_ASGC" },
             { route: _site, template: "site", label: "t1-uk-ral", title: "T1_UK_RAL" },
             { route: _site, template: "site", label: "t1-us-fnal", title: "T1_US_FNAL" },
             { route: _site, template: "site", label: "t2-ch-cern", title: "T2_CH_CERN" } ]);

  return this;
});
