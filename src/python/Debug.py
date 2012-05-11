"""Utilities for debug output."""
import os, cherrypy

class Debug:
  """Debug object, with multiple debug levels per category."""

  def __init__(self):
    """Constructor. Initialises default debug level to zero."""
    self.levels = { "*": 0 }

  def __len__(self):
    """Return the number of debug categories, including the default one."""
    return len(self.levels)

  def __setitem__(self, name, value):
    """Set the debugging threshold of a categroy.

    @param name -- the category name, use '*' for default category.
    @param value -- the threshold, use zero to suppress all output."""
    self.levels[name] = value

  def __getitem__(self, name):
    """Get the debugging threshold for a category.

    @param name -- the category name.

    @return The debugging threshold. If the category `name` is not
    known, returns the default threshold for category '*'."""
    if name in self.levels:
      return self.levels[name]
    else:
      return self.levels["*"]

  def __delitem__(self, name):
    """Remove debugging threshold for a category."""
    if name != "*" and name in self.levels:
      del self.levels[name]

  def __iter__(self):
    """Return an iterable of the debugging category keys."""
    return self.levels.iterkeys()

  def iterkeys(self):
    """Return an iterable of the debugging category keys."""
    return self.levels.iterkeys()

  def __contains__(self, item):
    """Check if the category has been given a debugging level."""
    return item in self.levels

  def __call__(self, category, level, fmt, *args):
    """Print out debugging information if we are in debug mode.

    @param category -- debug message category.

    @param level -- debug level this is intented for; output is
    suppressed if the current debug threshold for `category` is
    less than this.

    @param fmt, args -- the output format string and arguments.
    """
    if self.__getitem__(category) >= level:
      cherrypy.log("DEBUG%d %s: %s" % (level, category, fmt % args))

"""Debug management object."""
debug = Debug()

if __name__ == "__main__":
  debug["*"] = 1
  debug["test"] = 2
  debug("test", 1, "foo %s", "bar")
  debug("TEST", 2, "%s", ("foo", "bar"))
  debug("BAR", 1, "BAR: %s", "foobar")
  print [x for x in debug.iterkeys()]
  del debug["test"]
  print [x for x in debug.iterkeys()]
