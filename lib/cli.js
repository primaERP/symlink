var cp = require('child_process');
var path = require('path');
var async = require('async');
var chalk = require('chalk');

var defaultHandler = function (cmds, done) {
  cmds.forEach(function (cmd) {
    console.log(cmd);
  });
  done(null);
};

var filterWarnings = /^npm WARN (skippingAction|notsup|optional|prefer|deprecated) /;

var executeHandler = function (cmds, done) {
  var proj = null;
  var iterator = function (cmd, cb) {
    if (cmd.indexOf('#') == 0) {
      proj = cmd.substring(1).trim();
      console.log('');
    } else {
      console.log(chalk.blue('[' + proj + '] ') + cmd);
    }
    cp.exec(cmd, function(err, stdout, stderr) {
      if (stderr) {
        var filterOwn = new RegExp('npm WARN ' + proj);
        stderr.split('\n').filter(function(l) {
          return l && !filterWarnings.test(l) && !filterOwn.test(l);
        }).forEach(function(l) {
            console.log(chalk.blue('[' + proj + '] ') + chalk.red(l));
        });
      }
      cb(err, stdout);
    });
  };
  async.mapSeries(cmds, iterator, done);
};

module.exports = function (argv, done) {
  // repoDirs are the unnamed arguments (usually just one super dir)
  var dirs = argv._.map(function (dir) {
    return path.join(process.cwd(), dir);
  });

  // execute main module function with one of the handlers as the cb
  var handler = argv.e ? executeHandler : defaultHandler;
  require('./symlink')(dirs, argv.g || [], argv.u, function (err, cmds) {
    err ? done(err) : handler(cmds, done);
  });
};
