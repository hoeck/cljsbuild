#!/usr/bin/env node

'use strict';

const assert = require('assert');
const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const process = require('process');
const querystring = require('querystring');
const url = require('url');
const util = require('util');

const asTable = require('as-table');
const lodash = require('lodash');
const mkdirp = require('mkdirp');
const neodoc = require('neodoc');
const simpleGet = require('simple-get');

/* logging */

let logVerbosity = 1;

function log (...args) {
    if (logVerbosity > 0) {
        console.log(...args);
    }
}

function info (...args) {
    if (logVerbosity > 1) {
        console.log(...args);
    }
}

function warn (...args) {
    console.error('Warning:', ...args);
}

function logErrorAndExit (...args) {
    console.error('Error:', ...args);
    process.exit(1);
}

/* utils */

function sh (command) {
    info(`running ${JSON.stringify(command)}`);

    // TODO: configurable log output, log output with prefix, e.g. 'maven> '
    //       But: that means I cannot use *Sync functions, must write
    //       everything with Promises or generators.
    childProcess.execSync(command, {stdio: [0, 1, 2]});
}

function removeFile (fileName) {
    try {
        fs.unlinkSync(fileName);
    } catch (e) {
        info('could not remove file', fileName, 'error:', e.stack);
    };
}

// read a string from fileName, return '' if fileName does not exist
function readFile (fileName) {
    try {
        return fs.readFileSync(fileName).toString();
    } catch (e) {
        if (e.code !== 'ENOENT') {
            throw e;
        }

        return '';
    }
}

// convert a js object to a string evaling to the same in cljs
// flat=true to omit toplevel braces for argument application in templates
function jsToClj (object, flat = false) {
    if (util.isString(object)) {
        if (object[0] === ':') {
            return object; // a keyword
        }

        return JSON.stringify(object);
    }

    if (util.isNumber(object)) {
        return JSON.stringify(object);
    }

    if (util.isBoolean(object)) {
        return object ? "true" : "false";
    }

    if (util.isArray(object)) {
        const elements = object.map(jsToClj).join(' ');
        if (flat) {
            return elements;
        }
        return `[${elements}]`;
    }

    const pairs = Object.keys(object).map((k) => {
        return `${jsToClj(k)} ${jsToClj(object[k])}`;
    }).join(',\n');

    if (flat) {
        return pairs;
    }
    return `{${pairs}}`;
}

function isRlwrapAvailable () {
    try {
        childProcess.execSync('rlwrap -v');

        return true;
    } catch (e) {
        return false;
    }
}

function readCljsBuildPackageJson () {
    try {
        return JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json')));
    } catch (e) {
        warn('error while trying to load cljsbuilds package.json');
        throw e;
    }
}

function findLatestClojarsRelease (groupId, artifactId, releasesOnly) {
    return new Promise((resolve, reject) => {
        const qs = querystring.encode({
            q: `${groupId || ''} ${artifactId || ''}`,
            format: 'json'
        });
        const url = `http://clojars.org/search?${qs}`;

        simpleGet.concat(url, (err, res, data) => {
            if (err) {
                reject(err);
                return;
            }

            const release = JSON.parse(data)
                      .results
                      .filter((item) => {
                          if (releasesOnly) {
                              const releaseRegex = /^[0-9]+\.[0-9]+\.[0-9]+(-[0-9]+)?$/;

                              return item.version.match(releaseRegex);
                          }

                          return true;
                      })
                      .filter((item) => {
                          return item.group_name === groupId && item.jar_name === artifactId;
                      })[0];

            resolve((release || {}).version);
        });
    });
}

function findLatestMavenRelease (groupId, artifactId, releasesOnly) {
    return new Promise((resolve, reject) => {
        const qs = querystring.encode({
            q: `g:${JSON.stringify(groupId || '')} AND a:${JSON.stringify(artifactId || '')}`,
            wt: 'json',
            rows: 32,
            core: 'gav'
        });
        const url = `http://search.maven.org/solrsearch/select?${qs}`;

        simpleGet.concat(url, (err, res, rawData) => {
            if (err) {
                reject(err);
                return;
            }

            const data = JSON.parse(rawData);

            // don't pick alpha, beta, and RC versions
            if (releasesOnly) {
                const releaseRegex = /^[0-9]+\.[0-9]+\.[0-9]+(-[0-9]+)?$/;

                resolve((data.response.docs.filter(item => item.v.match(releaseRegex))[0] || {}).v);
            } else {
                resolve((data.response.docs[0] || {}).v);
            }
        });
    });
}

/* services */

/**
 * Access build options defined in ./package.json
 */
class Config {

    constructor () {
        this._cljsbuild = null;
    }

    _getDefaults () {
        return {
            fakeProjectFile: 'project.clj',
            tempdir: '.cljsbuild',
            target: 'out/main.js',
            assetPath: '.',
            src: 'src',
            main: undefined,
            replPort: 9000,
            replHost: 'localhost',
            dependencies: undefined
        };
    }

    _loadPackageJson () {
        let contents;

        try {
            contents = fs.readFileSync('package.json');
        } catch (e) {
            if (e.code === 'ENOENT') {
                logErrorAndExit('package.json does not exist');
            }

            throw e;
        }

        try {
            return JSON.parse(contents);
        } catch (e) {
            logErrorAndExit(`cannot parse package.json: ${e.message}`);
        }
    }

    _loadConfig () {
        // TODO: allow overwriting of keys from package.json via a cli switch,
        //       e.g. to turn on the :verbose cljs compiler flag programmatically

        if (this._cljsbuild) {
            return;
        }

        const data = this._loadPackageJson();

        if (!data.hasOwnProperty('cljsbuild')) {
            warn('no "cljsbuild" key found in package.json');
        }

        const defaults = this._getDefaults();

        this._cljsbuild = Object.assign({}, defaults, data.cljsbuild);

        // more checks
        const unknownKeys = lodash.difference(Object.keys(this._cljsbuild), Object.keys(defaults));

        if (unknownKeys.length) {
            warn(`unknown keys in package.json "cljsbuild": ${unknownKeys.join(', ')}`);
        }
    }

    _updatePackageJson (address, value) {
        const path = address.slice(0,-1);
        const property = address.slice(-1)[0];

        const packageJson = this._loadPackageJson();

        let pointer = packageJson;

        path.forEach((key) => {
            if (pointer[key] === undefined) {
                pointer[key] = {};
            }

            pointer = pointer[key];
        });

        pointer[property] = value;

        fs.writeFileSync('package.json', JSON.stringify(packageJson, null, 2));

        this._cljsbuild = null;
        this._loadConfig();
    }

    /**
     * Return a property from cljsbuild package.json entry.
     *
     * Print an errormessage and exit if the key does not exist.
     */
    getConfig (key) {
        this._loadConfig();

        const value = this._cljsbuild[key];

        if (value === undefined) {
            logErrorAndExit(`undefined package.json value: cljsbuild.${key}`);
        }

        return value;
    }

    _fetchLatestVersion (name, releasesOnly) {
        const groupId = name.split('/')[0];
        const artifactId = name.split('/')[1] || groupId;

        return findLatestMavenRelease(groupId, artifactId, releasesOnly).then((version) => {
            if (version) {
                return {name, version};
            }

            return findLatestClojarsRelease(groupId, artifactId, releasesOnly).then((version) => {
                if (version) {
                    return {name, version};
                }

                warn(`no version found for package ${JSON.stringify(name)}`);

                return undefined;
            });
        });
    };

    // find the latest version for each package in packages
    // returns a promise resolving to a map of name -> version
    _findPackageVersions (packages, releasesOnly) {
        return Promise.all(packages.map((name) => {
            return this._fetchLatestVersion(name, releasesOnly);
        })).then((depsWithVersions) => {
            const dependencies = {};

            depsWithVersions.forEach((d) => {
                if (d) {
                    dependencies[d.name] = d.version;
                }
            });

            return dependencies;
        });
    }

    /**
     * Write an initial cljsbuild config into package.json.
     *
     * options:
     *  - releasesOnly .. do not use alpha, beta, rc versions
     *  - cider .. add cider/nrepl && refactor-nrepl
     *  - figwheel .. add figwheel-sidecar
     *  - dryRun .. only show what would have be written into package.json
     */
    initConfig (options) {
        const data = this._loadPackageJson();

        if (data.cljsbuild && data.cljsbuild.dependencies) {
            logErrorAndExit('package.json cljsbuild.dependencies does already exist');
        }

        const defaultPackages = [];

        // base clojurescript
        defaultPackages.push(
            'org.clojure/clojure',
            'org.clojure/clojurescript'
        );

        // nrepl
        defaultPackages.push(
            'org.clojure/tools.nrepl',
            'com.cemerick/piggieback',
            'weasel'
        );

        // emacs cider
        if (options.cider) {
            defaultPackages.push(
                'cider/cider-nrepl',
                'refactor-nrepl'
            );
        }

        if (options.figwheel) {
            defaultPackages.push(
                'figwheel-sidecar'
            );
        }

        this._findPackageVersions(defaultPackages, options.releasesOnly).then((dependencies) => {
            const packageJsonCljsbuild = {
                main: '<add-your-namespace-here>/core',
                dependencies
            };

            if (options.dryRun) {
                log('cljsbuild config data:', '\n'+JSON.stringify(packageJsonCljsbuild, null, 2));
            } else {
                info('writing cljsbuild section to package.json');
                this._updatePackageJson(['cljsbuild'], packageJsonCljsbuild);
                info('done');
            }
        }).catch(logErrorAndExit);
    }

    /**
     * Update the cljs dependencies to their newest versions
     *
     * Options:
     *  - releasesOnly .. not use alpha, beta, rc versions
     *  - dryRun .. do not write the new versions to package.json, just print it
     */
    updateDependencies (options) {
        const current = this.getConfig('dependencies');
        const packageNames = Object.keys(current);

        this._findPackageVersions(packageNames, options.releasesOnly).then((fetched) => {
            const updated = Object.assign(
                {},
                ...packageNames.filter((packageName) => {
                    const fetchedVersion = fetched[packageName];
                    const currentVersion = current[packageName];
                    const isUpdated = fetchedVersion && fetchedVersion !== currentVersion;

                    return isUpdated;
                }).map((packageName) => {
                    return {[packageName]: fetched[packageName]};
                })
            );

            if (!Object.keys(updated).length) {
                log('no updates found');
                return;
            }

            if (options.dryRun) {
                log('would update the following dependencies in package.json:');
            } else {
                log('updating package.json with new cljs versions:');
            }

            log(asTable(Object.keys(updated).map((packageName) => {
                return [
                    '',
                    packageName,
                    current[packageName],
                    '=>',
                    fetched[packageName]
                ];
            })));

            if (!options.dryRun) {
                this._updatePackageJson(
                    ['cljsbuild', 'dependencies'],
                    Object.assign({}, current, updated)
                );
                log('done');
            }
        }).catch(logErrorAndExit);
    }
}

/**
 * Invoke Maven using depedencies defined in the config.
 */
class Maven {

    constructor (config) {
        this._config = config;
    }

    // return a hash over the declared depdendencies of a project
    _hashDepdendencies () {
        // deterministically serialize the dependencies
        const dependencies = this._config.getConfig('dependencies');
        const dependencyList = [];

        Object.keys(dependencies).forEach((name) => {
            dependencyList.push([name, dependencies[name]]);
        });

        dependencyList.sort((a,b) => {
            const x = a[0];
            const y = b[0];

            if (x < y) {
                return -1;
            }
            if (y > x) {
                return 1;
            }

            return 0;
        });

        const dependencyString = dependencyList.map(d => `${d[0]}${d[1]}`).join('');

        // hash them
        return crypto.createHash('sha1').update(dependencyString).digest().toString('hex');;
    }

    // return the path of the generated pom.xml which drives maven
    _getPomXmlPath () {
        // do not clutter the root directory
        return path.resolve(path.join(this._config.getConfig('tempdir'), 'pom.xml'));
    }

    createPomXml () {
        const buffer = [];

        buffer.push('<project>');

        buffer.push('<modelVersion>4.0.0</modelVersion>');

        buffer.push('<groupId>org.clojars.YOUR-CLOJARS-USERNAME-HERE</groupId>',
                    '<artifactId>JAR-NAME-HERE</artifactId>',
                    '<version>JAR-VERSION-HERE</version>',
                    '<name>JAR-NAME-HERE</name>',
                    '<description>JAR-DESCRIPTION-HERE</description>',
                    '<licenses>',
                    '  <license>',
                    '    <name>Eclipse Public License 1.0</name>',
                    '    <url>http://opensource.org/licenses/eclipse-1.0.php</url>',
                    '    <distribution>repo</distribution>',
                    '  </license>',
                    '</licenses>');

        buffer.push('<repositories>',
                    '  <repository>',
                    '    <id>clojars</id>',
                    '    <url>http://clojars.org/repo/</url>',
                    '  </repository>',
                    '</repositories>');

        buffer.push('<dependencies>');

        const dependencies = this._config.getConfig('dependencies');
        Object.keys(dependencies).forEach((k) => {
            const res = k.split('/');
            const groupId = res[0];
            const artifactId = res[1] || groupId;
            const version = dependencies[k];

            buffer.push('<dependency>',
                        `  <groupId>${groupId}</groupId>`,
                        `  <artifactId>${artifactId}</artifactId>`,
                        `  <version>${version}</version>`,
                        '</dependency>');
        });

        buffer.push('</dependencies>');
        buffer.push('</project>');
        buffer.push('');

        const pomXmlPath = this._getPomXmlPath();

        info(`writing ${JSON.stringify(pomXmlPath)}`);
        fs.writeFileSync(pomXmlPath, buffer.join('\n'));
    }

    installDependencies () {
        try {
            this.createPomXml();
            sh(`mvn install -f ${this._getPomXmlPath()}`);
        } finally {
            removeFile(this._getPomXmlPath());
        }
    }

    // compute, cache and return the projects classpath
    // (installs depdendencies when missing)
    getClasspath () {
        const classpathValueFile = path.resolve(path.join(this._config.getConfig('tempdir'), 'classpath.value'));
        const classpathHashFile = path.resolve(path.join(this._config.getConfig('tempdir'), 'classpath.hash'));

        const lastDependencyHash = readFile(classpathHashFile);
        const currentDependencyHash = this._hashDepdendencies();
        const cachedClasspath = readFile(classpathValueFile);

        // use value from cache if not stale and the cache exists
        if ((lastDependencyHash === currentDependencyHash) && cachedClasspath) {
            info(`using cached classpath from ${classpathValueFile}`);

            return cachedClasspath;
        }

        try {
            // compute the classpath
            this.createPomXml();
            sh(`mvn dependency:build-classpath -f=${this._getPomXmlPath()} -Dmdep.outputFile=${classpathValueFile}`);

            // cache the classpath
            fs.writeFileSync(classpathHashFile, currentDependencyHash);

            return fs.readFileSync(classpathValueFile).toString();
        } finally {
            removeFile(this._getPomXmlPath());
        }
    }
}

/**
 * Call the cljs compiler and start an nrepl server
 */
class ClojureScript {

    constructor (params) {
        this._maven = params.maven;
        this._config = params.config;
    }

    _getUserCljPath () {
        return path.join(this._config.getConfig('tempdir'), 'user', 'user.clj');
    }

    _getBuildCljPath () {
        return path.join(this._config.getConfig('tempdir'), 'build.clj');
    }

    _getFakeProjectFilePath () {
        return this._config.getConfig('fakeProjectFile');
    }

    _getNreplPortPath () {
        return '.nrepl-port';
    }

    _getCompilerOptions () {
        // see https://github.com/clojure/clojurescript/wiki/Compiler-Options
        return {
            // entry point namespace
            ':main': this._config.getConfig('main'),

            // name of the generated js file
            ':output-to': this._config.getConfig('target'),

            // directory for compiled files during development
            ':output-dir': path.dirname(this._config.getConfig('target')),
            ':asset-path': this._config.getConfig('assetPath')
        };
    }

    _getFigwheelSetup ({startImmediately} = {}) {
        const buildOpts = Object.assign(this._getCompilerOptions(), {
            ':verbose': true // TODO: make that a package.json arg
        });

        return [
            `(require '[figwheel-sidecar.repl-api :as fig])`,
            ``,
            `(fig/start-figwheel!`,
            ` {:figwheel-options {} ;; <-- figwheel server config goes here `,
            `  :build-ids ["dev"]   ;; <-- a vector of build ids to start autobuilding`,
            `  :all-builds          ;; <-- supply your build configs here`,
            `  [{:id "dev"`,
            `    :figwheel true`,
            `    :source-paths [${jsToClj(this._config.getConfig('src'))}]`,
            `    :compiler ${jsToClj(buildOpts)}}]})`,
            ``,
            `(defn start-repl [] (fig/cljs-repl))`,
            ``,
            startImmediately ? `(start-repl)` : ``
        ];
    }

    // user.clj file autoloaded by clojure
    _createUserClj (params = {}) {
        const buffer = [];
        const buildOpts = this._getCompilerOptions();

        if (params.usePiggieback) {
            // defines start-repl to initiate a piggiback+weasel (websocket) cljs repl
            buffer.push(
                `(require 'cemerick.piggieback)`,
                `(require 'weasel.repl.websocket)`,
                ``,
                `(defn start-repl []`,
                `  (cemerick.piggieback/cljs-repl`,
                `    (weasel.repl.websocket/repl-env :ip "0.0.0.0" :port 9001)`,
                `    ${jsToClj(buildOpts, true)}))`
            );
        }

        if (params.useFigwheel) {
            buffer.push(...this._getFigwheelSetup({startImmediately: false}));
        }

        const userCljPath = this._getUserCljPath();

        if (buffer.length) {
            info(`writing ${JSON.stringify(userCljPath)}`);
            mkdirp.sync(path.dirname(userCljPath));
            fs.writeFileSync(userCljPath, buffer.join('\n'));
        } else if (fs.existsSync(path.dirname(userCljPath))) {
            // clean up an old user.clj
            info(`removing ${JSON.stringify(userCljPath)}`);
            removeFile(userCljPath);
        }
    }

    // create a build.clj file that invokes the clojurescript compiler and/or
    // starts a standalone repl or nrepl server
    _createBuildClj (params) {
        const buffer = [];

        // cljs.build.api
        if (params.buildMethod) {
            assert(['build', 'watch'].indexOf(params.buildMethod) !== -1);

            const buildOpts = Object.assign(this._getCompilerOptions(), {
                ':optimizations': params.production ? ':advanced' : ':none'
            });

            buffer.push(
                `(require 'cljs.build.api)`,
                ``,
                `(defn run-build []`,
                `  (cljs.build.api/${params.buildMethod}`,
                `    ${jsToClj(this._config.getConfig('src'))}`,
                `    ${jsToClj(buildOpts)}`,
                `  ))`,
                ``,
                `(if ${Boolean(params.buildAsync)} (.start (Thread. run-build)) (run-build))`
            );
        }

        // console cljs.repl + watch
        if (params.useRepl) {
            const buildOpts = Object.assign(this._getCompilerOptions(), {
                ':watch': this._config.getConfig('src')
            });

            buffer.push(
                `(require 'cljs.repl)`,
                `(require 'cljs.build.api)`,
                `(require 'cljs.repl.browser)`,
                ``,
                `(cljs.repl/repl (cljs.repl.browser/repl-env)`,
                `  ${jsToClj(buildOpts, true)}`,
                `)`
            );
        }

        // drop into a figwheel cljs repl
        if (params.useFigwheel) {
            buffer.push(...this._getFigwheelSetup({startImmediately: true}));
        }

        // nrepl + cemerik/piggieback + middleware + .repl-port file + fake
        // project.clj to let emacs (and other IDEs) pick up the repl port automatically
        if (params.useNrepl) {
            buffer.push(
                `(require '[clojure.tools.nrepl.server :as server])`,
                `(require '[cemerick.piggieback :as pback])`,
                `(require 'cider.nrepl)`, // TODO: add --cider option to nrepl task
                ``,
                `(let [conn (server/start-server`,
                `             :handler (apply server/default-handler`,
                `                             #'pback/wrap-cljs-repl`,
                `                             ;; https://github.com/clojure-emacs/cider-nrepl/blob/v0.12.0/src/cider/nrepl.clj`,
                `                             (map resolve cider.nrepl/cider-middleware)`,
                `                      )`,
                `           )`,
                `     ]`,
                `  ;; repl-port file picked up by emacs-cider (and other IDEs?)`,
                `  (spit ${JSON.stringify(this._getNreplPortPath())} (:port conn))`,
                `  ;; fake project.clj file to make emacs-cider (and other IDEs?) recognize our clojurescript project root`,
                `  (spit ${JSON.stringify(this._getFakeProjectFilePath())} "")`,
                ``,
                `  (print "nrepl server listening on port" (:port conn))`,
                `)`
            );
        }

        const buildCljPath = this._getBuildCljPath();

        info(`writing ${JSON.stringify(buildCljPath)}`);
        mkdirp.sync(path.dirname(buildCljPath));
        fs.writeFileSync(buildCljPath, buffer.join('\n'));
    }

    _runBuildClj (options) {
        const rlwrap = (options || {}).useRlwrap && isRlwrapAvailable() ? 'rlwrap ' : '';
        const classpath = [
            this._maven.getClasspath(),

            // user clj is at tempdir/user/user.clj, so tempdir must be on the cp
            path.dirname(this._getUserCljPath()),

            this._config.getConfig('src')
        ].join(':');
        const buildClj = this._getBuildCljPath();

        sh(`${rlwrap}java -cp ${classpath} clojure.main ${buildClj}`);
    }

    build ({production} = {}) {
        this._createBuildClj({buildMethod: 'build', production});
        this._createUserClj(); // empty user.clj to overwrite any existing prev. user.clj
        this._runBuildClj();
    }

    watch (options) {
        this._createBuildClj({buildMethod: 'watch'});
        this._createUserClj();
        this._runBuildClj(options);
    }

    repl (options) {
        if (options.figwheel) {
            this._createBuildClj({useFigwheel: true});
            this._createUserClj({}); // empty user clj
            this._runBuildClj({useRlwrap: true});
        } else {
            this._createBuildClj({useRepl: true, buildMethod: "build"});
            this._createUserClj(); // empty user clj
            this._runBuildClj({useRlwrap: true});
        }
    }

    nrepl (options) {
        if (options.figwheel) {
            // figwheel build-watches and also provides functions to start the cljs repl
            this._createBuildClj({useNrepl: true});
            this._createUserClj({useFigwheel: true});
        } else {
            this._createBuildClj({useNrepl: true, buildMethod: "watch", buildAsync: true});
            this._createUserClj({usePiggieback: true});
        }

        // cleanup tempfiles
        process.on('SIGINT', () => process.exit());
        process.on('exit', () => {
            removeFile(this._getNreplPortPath());
            removeFile(this._getFakeProjectFilePath());
        });

        this._runBuildClj({});
    }
}

function runCommand (args) {
    const config = new Config();
    const maven = new Maven(config);
    const cljs = new ClojureScript({maven, config});

    if (args.install) {
        log('installing cljs depedencies via maven ...');
        maven.installDependencies();
    } else if (args.repl) {
        log('starting cljs repl ...');
        cljs.repl({figwheel: args['--figwheel']});
    } else if (args.nrepl) {
        log('starting nrepl server ...');
        cljs.nrepl({figwheel: args['--figwheel']});
    } else if (args.init) {
        log('initializing cljs dependencies in package.json ...');
        config.initConfig({
            releasesOnly: args['--releases-only'],
            cider: args['--cider'],
            dryRun: args['--dry-run']
        });
    } else if (args.update) {
        log('updating cljs dependencies configured in package.json ...');
        config.updateDependencies({
            releasesOnly: args['--releases-only'],
            cider: args['--cider'],
            dryRun: args['--dry-run']
        });
    }
    else if (args.watch) {
        log('watching ...');
        cljs.watch();
    } else {
        log('building ...');
        cljs.build({
            production: args['--production']
        });
    }
}

const docstring = `\
Build, install dependencies and manage REPLs for a Clojurescript project.

usage:
    cljsbuild [options] [build-options]
    cljsbuild [options] watch
    cljsbuild [options] init [dependency-options]
    cljsbuild [options] update [dependency-options]
    cljsbuild [options] install
    cljsbuild [options] repl [repl-options]
    cljsbuild [options] nrepl [repl-options]

options:
    -h, --help             show help
    -v, --verbose          verbose output
    --version              show cljsbuilds version

build-options:
    -p, --production       build with optimization level :advanced

dependency-options:
    -c, --cider            add emacs cider dependencies
    -f, --figwheel         add figwheel-sidecar to the dependencies
    -r, --releases-only    do not use alpha, beta or RC releases
    -d, --dry-run          only show what would be written to package.json

repl-options:
    -f, --figwheel         use figwheel
`;

function main () {
    const args = neodoc.run(docstring, {smartOptions: true});

    if (args['--version']) {
        const version = readCljsBuildPackageJson().version;

        log(`cljsbuild version ${version}`);

        return;
    }

    if (args['--help']) {
        log(docstring);

        return;
    }

    if (args['--verbose']) {
        logVerbosity += 1;
    }

    runCommand(args);
}

main();
