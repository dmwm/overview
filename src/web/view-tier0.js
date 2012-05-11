var Tier0 = X.inherit(View, function(Y, gui, rank)
{
  View.call(this, Y, gui, rank, "Tier-0",
            [{ label: "jobs",       title: "Job queues" },
             { label: "t0export",   title: "Cluster: t0export" },
             { label: "t1transfer", title: "Cluster: t1transfer" },
             { label: "t0input",    title: "Cluster: t0input" },
             { label: "cmst0",      title: "Cluster: cmst0" }]);

  return this;
});
