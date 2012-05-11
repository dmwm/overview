var Shift = X.inherit(View, function(Y, gui, rank)
{
  View.call(this, Y, gui, rank, "Shift",
            [{ template: "main", label: null, title: null }]);

  return this;
});
