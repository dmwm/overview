var Grid = X.inherit(View, function(Y, gui, rank)
{
  View.call(this, Y, gui, rank, "Grid",
            [{ template: "main", label: null, title: null }]);

  return this;
});
