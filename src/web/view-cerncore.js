var CERNCore = X.inherit(View, function(Y, gui, rank)
{
  View.call(this, Y, gui, rank, "CERN/Core",
            [{ template: "main", label: null, title: null }]);

  return this;
});
