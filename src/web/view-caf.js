var CAF = X.inherit(View, function(Y, gui, rank)
{
  /*
    0 && view.node().all(".fetch-content").each(function(node) {
      _self.cache.get("text/plain", node.getAttribute("x-content"), function(val) {
        X.applyContent(node, val);
      });
    });
  */

  View.call(this, Y, gui, rank, "CAF",
            [{ label: "storage-pools", title: "Storage pools" },
             { label: "batch-farm",    title: "Batch farm" },
             { label: "job-summary",   title: "Job summary" },
             { label: "disk-usage",    title: "Disk Monitoring" }]);

  return this;
});
