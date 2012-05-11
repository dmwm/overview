// Like d3.nest but takes arrays of arrays of data.
d3.vnest = function() {
  var nest = {},
      keys = [],
      sortKeys = [],
      sortValues,
      rollup;

  function map(arrays, depth) {
    if (depth >= keys.length)
    {
      arrays = (arrays.length == 1 ? arrays[0] : d3.merge(arrays));
      return rollup ? rollup.call(nest, arrays)
        : (sortValues ? arrays.sort(sortValues) : arrays);
    }

    var a = -1,
        an = arrays.length,
        key = keys[depth++],
        keyValue,
        object,
        o = {};

    while (++a < na)
    {
      var a = arrays[a],
          n = a.length,
          i = -1;

      while (++i < n) {
        if ((keyValue = key(object = a[i])) in o) {
          o[keyValue][0].push(object);
        } else {
          o[keyValue] = [[object]];
        }
      }
    }

    for (keyValue in o) {
      o[keyValue] = map(o[keyValue], depth);
    }

    return o;
  }

  function entries(map, depth) {
    if (depth >= keys.length) return map;

    var a = [],
        sortKey = sortKeys[depth++],
        key;

    for (key in map) {
      a.push({key: key, values: entries(map[key], depth)});
    }

    if (sortKey) a.sort(function(a, b) {
      return sortKey(a.key, b.key);
    });

    return a;
  }

  nest.map = function(arrays) {
    return map(arrays, 0);
  };

  nest.entries = function(arrays) {
    return entries(map(arrays, 0), 0);
  };

  nest.key = function(d) {
    keys.push(d);
    return nest;
  };

  nest.sortKeys = function(order) {
    sortKeys[keys.length - 1] = order;
    return nest;
  };

  nest.sortValues = function(order) {
    sortValues = order;
    return nest;
  };

  nest.rollup = function(f) {
    rollup = f;
    return nest;
  };

  return nest;
};
