YUI({ base: REST_SERVER_ROOT + "/static/yui",
      comboBase: REST_SERVER_ROOT + "/static/yui?",
      root: "", combine: true, filter: REST_DEBUG && "raw" })
.use("yui", "controller", "history", "node", "dump", "substitute", "escape",
     "panel", "event-resize", "event-valuechange", "node-event-delegate",
     "io-base", "io-form", "json-parse", "autocomplete", "dd-plugin",
     "autocomplete-filters", "autocomplete-filters-accentfold",
     "autocomplete-highlighters", "autocomplete-highlighters-accentfold",
     function(Y){ new Overview(Y, [PhEDEx, Shift, CERNCore, Tier0, CAF,
                                   DDT, Grid],
                               REST_DEBUG); });
