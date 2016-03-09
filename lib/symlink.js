var join = require('path').join
  , $ = require('interlude')
  , fs = require('fs')
  , async = require('async')
  , semver = require('semver');

var getVersion = function (str) {
  var match = /^(?:[<>]?=|~|\^)?((?:[\dx]+\.)+[\dx]+)$/.exec(str);
  if (match != null) {
    return match[1];
  }
  return str;
};

var getJson = function (pth, cb) {
  var pkgjson = join(pth, 'package.json');
  fs.exists(pkgjson, function (exists) {
    if (exists) {
      fs.readFile(pkgjson, function (err, data) {
        cb(err, err ? null : { path: pth, data: JSON.parse(data) });
      });
    }
    else {
      cb(null, null); // no error but no package.json
    }
  });
};

var getJsons = function (dir, cb) {
  fs.readdir(dir, function (err, data) {
    if (err) {
      return cb(err);
    }
    var paths = data.map(function (str) {
      return join(dir, str);
    });
    async.map(paths, getJson, cb);
  });
};

var getJsonsFromDirectories = function (dirs, cb) {
  async.map(dirs, getJsons, cb);
};

var analyze = function (deps, absPaths, globals, names, uninstall, peerDeps, versions) {
  var ownDeps = {}      // deps in names
    , foreignDeps = {}; // deps not in names

  // partition dependencies
  Object.keys(deps).forEach(function (k) {
    ownDeps[k] = deps[k].filter($.elem(names));
    foreignDeps[k] = deps[k].filter($.notElem(names));
  });

  // sort deps in order of safe linking between each other
  var sorted = $.range(names.length).map(function () {
    var safe = $.firstBy(function (n) {
      // safe to link iff no local deps unlinked
      return !$.intersect(ownDeps[n], names).length;
    }, names);

    if (!safe) {
      // impossible to link a to b if b also tries to link to a without querying npm
      var err = "cannot link cyclically dependent: " + JSON.stringify(names);
      throw new Error(err);
    }
    names.splice(names.indexOf(safe), 1); // remove it from names
    return safe;
  });

  var cmds = [];
  if (uninstall) {
    sorted.reverse().forEach(function(n){
      var cd = 'cd ' + absPaths[n] + ' && ';

      cmds.push(cd + 'npm unlink');

      var linked = $.intersect(globals, foreignDeps[n]).concat(ownDeps[n]);
      if (linked.length > 0) {
        cmds.push(cd + 'npm unlink ' + linked.join(' '));
      }

      var remaining = foreignDeps[n].filter($.notElem(linked));
      if (remaining.length > 0) {
        cmds.push(cd + 'npm uninstall ' + remaining.join(' '));
      }

    });
  } else {

    sorted.forEach(function(n) {
      // then find all commands required for each module in the found safe order
      var cd = 'cd ' + absPaths[n] + ' && ';

      // npm link in -g requested modules and internal deps when they are specified
      var linked = $.intersect(globals, foreignDeps[n]).concat(ownDeps[n]);
      var missing = [];
      var invalid = [];
      linked.forEach(function (d) {
        Object.keys(peerDeps[d]).forEach(function (e){
          var peerVer = peerDeps[d][e];
          var ver = versions[n][e];
          if (!ver) {
            var reqVer = getVersion(peerVer);
            if (reqVer && (reqVer.indexOf("x") > 0 || semver.satisfies(reqVer, peerVer))) {
              missing.push(e + "@" + reqVer);
            } else {
              invalid.push(n + ":" + e + "@[?.?.?] ... " + d + ":" + e + "@" + peerVer);
            }
          } else {
            var pureVer = getVersion(ver);
            if (!semver.satisfies(pureVer, peerVer)) {
              invalid.push(n + ":" + e + "@" + ver + " ... " + d + ":" + e + "@" + peerVer);
            }
          }
        });
      });

      if (invalid.length > 0) {
        var err = "Some dependencies don't satisfy peer dependencies\n  " + invalid.join("\n  ");
        throw new Error(err);
      }
      if (linked.length > 0) {
        cmds.push(cd + 'npm link ' + linked.join(' '));
      }
      if (missing.length > 0) {
        cmds.push(cd + 'npm install --save --save-exact ' + missing.join(' '));
      }

      cmds.push(cd + 'npm install');

      // npm link (to make this available to the modules with more dependencies)
      cmds.push(cd + 'npm link');
    });
  }
  return cmds;
};


module.exports = function (dirs, globals, uninstall, cb) {
  var deps = {}         // { module name -> [jsonDeps + jsonDevDeps }
    , absPaths = {}		// { module name -> abs module path }
    , peerDeps = {}     // { module name -> peerDeps }
    , versions = {};    // { module name -> version}

  getJsonsFromDirectories(dirs, function (err, datas) {
    if (err) {
      return cb(err);
    }
    var names = datas.reduce(function (acc, data) {
      var namesCurr = data.filter(function (o) {
        return o !== null; // folders with package.json
      }).map(function (o) {
        var json = o.data;
        var name = json.name;
        var mDeps = $.extend(
          json.dependencies || {},
          json.devDependencies || {});
        deps[name] = Object.keys(mDeps);
        absPaths[name] = o.path;
        peerDeps[name] = json.peerDependencies;
        versions[name] = mDeps;
        return name;
      });
      return acc.concat(namesCurr);
    }, []);

    var cmds;
    try {
      cmds = analyze(deps, absPaths, globals, names, uninstall, peerDeps, versions);
    }
    catch (err) {
      return cb(err);
    }
    return cb(null, cmds);
  });
};
