/** Utility to generate time series. */
var TimeSeries = new function()
{
  var _series = this;
  var _june2004 = Math.floor(Date.UTC(2004, 5, 1, 0, 0, 0)/1000);

  var HourSpan = function()
  {
    var _max = 336;
    var _default = 96;
    var _self = this;
    var _rx = /^(\d{4})(\d{2})(\d{2})(\d{2})\d{2}$/;
    this.letter = "h";
    this.name = "hour";
    this.title = "Hourly";

    this.bin = function(time)
    {
      return Math.floor(time/3600) * 3600;
    };

    this.end = function(value)
    {
      var match;
      if (value && (match = _rx.exec(value)))
      {
        var year = parseInt(match[1]);
        var month = parseInt(match[2]);
        var day = parseInt(match[3]);
        var hour = parseInt(match[4]);
        if ((year >= 2004 && year < 2999)
            && (month >= 1 && month <= 12)
            && (day >= 1 && day <= 31)
            && (hour >= 0 && hour <= 23))
          return Math.floor(Date.UTC(year, month-1, day, hour, 59, 59)/1000);
      }

      return null;
    };

    this.format = function(value)
    {
      var t = new Date(value * 1000);
      return sprintf("%04d-%02d-%02d %02d:%02d",
                     t.getUTCFullYear(),
                     t.getUTCMonth()+1,
                     t.getUTCDate(),
                     t.getUTCHours(),
                     t.getUTCMinutes());
    };

    this.urlarg = function(value)
    {
      var t = new Date(value * 1000);
      return sprintf("%04d%02d%02d%02d59",
                     t.getUTCFullYear(),
                     t.getUTCMonth()+1,
                     t.getUTCDate(),
                     t.getUTCHours());
    };

    this.series = function(start, end)
    {
      var series = [];
      var low = Math.floor(start / 3600);
      var high = Math.max(low+1, Math.floor((end+3599) / 3600));
      for (var t = low; t < high; ++t)
        series.push({ start: t * 3600, end: (t+1) * 3600 });
      return series;
    };

    this.range = function(d, start, end, num)
    {
      if (! end)
        end = Math.floor(new Date().getTime()/1000);

      var range = _self.series(end, end)[0];
      if (end != range.start)
        end = range.end;

      if (start && start < end && start >= 0)
        start = Math.max(start, end - _max * 3600);
      else
        start = end - Math.max(1, Math.min(_max, num || _default)) * 3600;

      start = Math.max(start, _june2004);
      start = _self.series(start, start)[0].start;

      d.start = start;
      d.end = end;
    };
  };

  var DaySpan = function()
  {
    var _max = 365;
    var _default = 90;
    var _self = this;
    var _rx = /^(\d{4})(\d{2})(\d{2})$/;
    this.letter = "d";
    this.name = "day";
    this.title = "Daily";

    this.bin = function(time)
    {
      return Math.floor(time/86400) * 86400;
    };

    this.end = function(value)
    {
      var match;
      if (value && (match = _rx.exec(value)))
      {
        var year = parseInt(match[1]);
        var month = parseInt(match[2]);
        var day = parseInt(match[3]);
        if ((year >= 2004 && year < 2999)
            && (month >= 1 && month <= 12)
            && (day >= 1 && day <= 31))
          return Math.floor(Date.UTC(year, month-1, day, 23, 59, 59)/1000);
      }

      return null;
    };

    this.format = function(value)
    {
      var t = new Date(value * 1000);
      return sprintf("%04d-%02d-%02d",
                     t.getUTCFullYear(),
                     t.getUTCMonth()+1,
                     t.getUTCDate());
    };

    this.urlarg = function(value)
    {
      var t = new Date(value * 1000);
      return sprintf("%04d%02d%02d",
                     t.getUTCFullYear(),
                     t.getUTCMonth()+1,
                     t.getUTCDate());
    };

    this.series = function(start, end)
    {
      var series = [];
      var low = Math.floor(start / 86400);
      var high = Math.max(low+1, Math.floor((end+86399) / 86400));
      for (var t = low; t < high; ++t)
        series.push({ start: t * 86400, end: (t+1) * 86400 });
      return series;
    };

    this.range = function(d, start, end, num)
    {
      if (! end)
        end = Math.floor(new Date().getTime()/1000);

      var range = _self.series(end, end)[0];
      if (end != range.start)
        end = range.end;

      if (start && start < end && start >= 0)
        start = Math.max(start, end - _max * 86400);
      else
        start = end - Math.max(1, Math.min(_max, num || _default)) * 86400;

      start = Math.max(start, _june2004);
      start = _self.series(start, start)[0].start;

      d.start = start;
      d.end = end;
    };
  };

  var WeekSpan = function()
  {
    // Test data for week mappings
    // Year %G%V   %Y%m%d   %s
    // 2004 200401 20040101 1072915200
    // 2005 200453 20050101 1104537600
    // 2006 200552 20060101 1136073600
    // 2007 200701 20070101 1167609600
    // 2008 200801 20080101 1199145600
    // 2009 200901 20090101 1230768000
    // 2010 200953 20100101 1262304000
    // 2011 201052 20110101 1293840000
    // 2012 201152 20120101 1325376000
    // 2013 201301 20130101 1356998400
    // 2014 201401 20140101 1388534400
    // 2015 201501 20150101 1420070400
    // 2016 201553 20160101 1451606400
    // 2017 201652 20170101 1483228800
    // 2018 201801 20180101 1514764800
    // 2019 201901 20190101 1546300800

    var _max = 315;
    var _default = 52;
    var _self = this;
    var _rx = /^(\d{4})(\d{2})$/;
    this.letter = "w";
    this.name = "week";
    this.title = "Weekly";

    var _weekday = function(time)
    {
      return ((new Date(time * 1000)).getUTCDay()+6) % 7;
    };

    this.bin = function(time)
    {
      return (Math.floor(time / 86400) - _weekday(time)) * 86400;
    };

    this.end = function(value)
    {
      var match;
      if (value && (match = _rx.exec(value)))
      {
        var year = parseInt(match[1]);
        var week = parseInt(match[2]);
        if ((year >= 2004 && year < 2999) && (week >= 1 && week <= 53))
        {
          // January 4th is always in ISO week one, so find out what
          // day of week that is, then go back to Monday of that week,
          // and advance specified number of weeks minus one.
          var jan4 = Math.floor(Date.UTC(year, 0, 4, 0, 0, 0)/1000);
          return jan4 - _weekday(jan4)*86400 + 7*week*86400 - 1;
        }
      }

      return null;
    };

    this.format = function(value)
    {
      var thursday = value + 86400*(3 - _weekday(value));
      var year = new Date(thursday*1000).getUTCFullYear();
      var jan4 = Math.floor(Date.UTC(year, 0, 4, 0, 0, 0)/1000);
      var week1monday = jan4 - _weekday(jan4)*86400;
      var week = Math.floor((value - week1monday) / (7*86400)) + 1;
      return sprintf("%04d-%02d", year, week);
    };

    this.urlarg = function(value)
    {
      var thursday = value + 86400*(3 - _weekday(value));
      var year = new Date(thursday*1000).getUTCFullYear();
      var jan4 = Math.floor(Date.UTC(year, 0, 4, 0, 0, 0)/1000);
      var week1monday = jan4 - _weekday(jan4)*86400;
      var week = Math.floor((value - week1monday) / (7*86400)) + 1;
      return sprintf("%04d%02d", year, week);
    };

    this.series = function(start, end)
    {
      var series = [];
      var low = Math.floor(start / 86400) - _weekday(start);
      var high = Math.max(low+1, Math.floor((end+86399) / 86400));
      for (var t = low; t < high; t += 7)
        series.push({ start: t * 86400, end: (t+7) * 86400 });
      return series;
    };

    this.range = function(d, start, end, num)
    {
      if (! end)
        end = Math.floor(new Date().getTime()/1000);

      var range = _self.series(end, end)[0];
      if (end != range.start)
        end = range.end;

      if (start && start < end && start >= 0)
        start = Math.max(start, end - _max * 7*86400);
      else
        start = end - Math.max(1, Math.min(_max, num || _default)) * 7*86400;

      start = Math.max(start, _june2004);
      start = _self.series(start, start)[0].start;

      d.start = start;
      d.end = end;
    };
  };

  var MonthSpan = function()
  {
    var _max = 240;
    var _default = 60;
    var _self = this;
    var _rx = /^(\d{4})(\d{2})$/;
    this.letter = "m";
    this.name = "month";
    this.title = "Monthly";

    this.bin = function(time)
    {
      var t = new Date(time * 1000);
      var year = t.getUTCFullYear();
      var month = t.getUTCMonth();
      return Math.floor(Date.UTC(year, month, 1, 0, 0, 0) / 1000);
    };

    this.end = function(value)
    {
      var match;
      if (value && (match = _rx.exec(value)))
      {
        var year = parseInt(match[1]);
        var month = parseInt(match[2]);
        if ((year >= 2004 && year < 2999) && (month >= 1 && month <= 12))
          return Math.floor(Date.UTC(year, month, 1, 0, 0, 0)/1000)-1;
      }

      return null;
    };

    this.format = function(value)
    {
      var t = new Date(value * 1000);
      return sprintf("%04d-%02d", t.getUTCFullYear(), t.getUTCMonth()+1);
    };

    this.urlarg = function(value)
    {
      var t = new Date(value * 1000);
      return sprintf("%04d%02d", t.getUTCFullYear(), t.getUTCMonth()+1);
    };

    this.series = function(start, end)
    {
      var series = [];
      var limit = Math.floor((end+86399)/86400) * 86400;
      var t = new Date(start * 1000);
      var year = t.getUTCFullYear();
      var month = t.getUTCMonth();
      var day = Math.floor(Date.UTC(year, month, 1, 0, 0, 0) / 1000);
      do
      {
        var low = day;
        if (++month > 11)
          ++year, month = 0;
        day = Math.floor(Date.UTC(year, month, 1, 0, 0, 0) / 1000);
        series.push({ start: low, end: day });
      }
      while (day < limit);
      return series;
    };

    this.range = function(d, start, end, num)
    {
      if (! end)
        end = Math.floor(new Date().getTime()/1000);

      var range = _self.series(end, end)[0];
      if (end != range.start)
        end = range.end;

      if (start && start < end && start >= 0)
      {
        var s = new Date(start * 1000);
        var syear = s.getUTCFullYear();
        var smonth = s.getUTCMonth();
        var e = new Date(end * 1000);
        var eyear = e.getUTCFullYear();
        var emonth = e.getUTCMonth();
        num = (eyear - syear) * 12 + emonth - smonth;
      }

      num = Math.max(1, Math.min(_max, num || _default));
      var t = new Date(end * 1000);
      var year = t.getUTCFullYear();
      var month = t.getUTCMonth();
      for (var i = 0; i < num; ++i)
        if (--month < 0)
          --year, month = 11;
      start = Math.floor(Date.UTC(year, month, 1, 0, 0, 0)/1000);

      start = Math.max(start, _june2004);
      start = _self.series(start, start)[0].start;

      d.start = start;
      d.end = end;
    };
  };

  var YearSpan = function()
  {
    var _max = 42;
    var _default = 42;
    var _self = this;
    var _rx = /^(\d{4})$/;
    this.letter = "y";
    this.name = "year";
    this.title = "Yearly";

    this.bin = function(time)
    {
      var year = (new Date(time * 1000)).getUTCFullYear();
      return Math.floor(Date.UTC(year, 0, 1, 0, 0, 0) / 1000);
    };

    this.end = function(value)
    {
      var match;
      if (value && (match = _rx.exec(value)))
      {
        var year = parseInt(match[1]);
        if (year >= 2004 && year < 2999)
          return Math.floor(Date.UTC(year+1, 0, 1, 0, 0, 0) / 1000)-1;
      }

      return null;
    };

    this.format = function(value)
    {
      return sprintf("%04d", (new Date(value * 1000)).getUTCFullYear());
    };

    this.urlarg = function(value)
    {
      return sprintf("%04d", (new Date(value * 1000)).getUTCFullYear());
    };

    this.series = function(start, end)
    {
      var series = [];
      var limit = Math.floor((end+86399)/86400) * 86400;
      var year = (new Date(start * 1000)).getUTCFullYear();
      var day = Math.floor(Date.UTC(year, 0, 1, 0, 0, 0) / 1000);
      do
      {
        var low = day;
        day = Math.floor(Date.UTC(++year, 0, 1, 0, 0, 0) / 1000);
        series.push({ start: low, end: day });
      }
      while (day < limit);
      return series;
    };

    this.range = function(d, start, end, num)
    {
      if (! end)
        end = Math.floor(new Date().getTime()/1000);

      var range = _self.series(end, end)[0];
      if (end != range.start)
        end = range.end;

      if (start && start < end && start >= 0)
      {
        var syear = (new Date(start * 1000)).getUTCFullYear();
        var eyear = (new Date(end * 1000)).getUTCFullYear();
        num = eyear - syear;
      }

      num = Math.max(1, Math.min(_max, num || _default));
      var year = (new Date(end * 1000)).getUTCFullYear();
      start = Math.floor(Date.UTC(year-num, 0, 1, 0, 0, 0) / 1000);

      start = Math.max(start, _june2004);
      start = _self.series(start, start)[0].start;

      d.start = start;
      d.end = end;
    };
  };

  this.search = function(series, time)
  {
    var mid, bin, lo = 0, hi = series.length-1;
    while (lo <= hi)
    {
      mid = (lo + hi) >> 1;
      bin = series[mid];
      if (time >= bin.end)
        lo = mid+1;
      else if (time < bin.start)
        hi = mid-1;
      else
        return bin;
    }
    return null;
  };

  this.min = _june2004;
  this.spans = [ new HourSpan(), new DaySpan(), new WeekSpan(),
                 new MonthSpan(), new YearSpan() ];
  this.byName = {};
  this.byLetter = {};
  for (var i = 0; i < this.spans.length; ++i)
  {
    var s = this.spans[i];
    this.byName[s.name] = s;
    this.byLetter[s.letter] = s;
    s.search = this.search;
  }
}();
