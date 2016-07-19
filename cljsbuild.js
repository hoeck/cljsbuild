#!/usr/bin/env node

'use strict';

const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');
const process = require('process');

const lodash = require('lodash');
const mkdirp = require('mkdirp');
const neodoc = require('neodoc');

/* logging */

function log (...args) {
    console.log(...args);
}

let logVerbosity = 0;

function info (...args) {
    if (logVerbosity) {
        log(...args);
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
    childProcess.execSync(command, {stdio: [0, 1, 2]});
}

function removeFile (fileName) {
    try {
        fs.unlink(fileName);
    } catch (e) {};
}

function jsObjectToClj (object) {
    return '{' + Object.keys(object).map((k) => {
        return `:${k} ${typeof object[k] === 'object' ? jsObjectToClj(object[k]) : object[k]}`;
    }).join(',') + '}';
}

function isRlwrapAvailable () {
    try {
        childProcess.execSync('which rlwraps');

        return true;
    } catch (e) {
        return false;
    }
}

function readCljsBuildPackageJson () {
    try {
        return JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json')));
    } catch (e) {
        log('error while trying to load cljsbuilds package.json');
        throw e;
    }
}

/* services */


/**
 * Access build options defined in ./package.json
 */
class Config {

    constructor () {
        this._cljsbuild = {};

        this._loadPackageJson();
        this._checkCljsbuildData();
    }

    _getDefaults () {
        return {
            tempdir: '.cljsbuild',
            target: 'out/main.js',
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
            if (e.errno === 'ENOENT') {
                logErrorAndExit('package.json does not exist');
            }

            throw e;
        }

        const data = JSON.parse(contents);

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

    _checkCljsbuildData () {
        const defaults = this._getDefaults();

    }

    getConfig (key) {
        const value = this._cljsbuild[key];

        if (value === undefined) {
            logErrorAndExit(`undefined package.json value: cljsbuild.${key}`);
        }

        return value;
    }
}

/**
 * Invoke Maven using depedencies defined in the config.
 */
class Maven {

    constructor (config) {
        this._config = config;
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

        const pomXmlPath = 'pom.xml';

        info(`writing ${JSON.stringify(pomXmlPath)}`);
        fs.writeFileSync(pomXmlPath, buffer.join('\n'));
    }

    installDependencies () {
        this.createPomXml();
        sh('mvn install');
    }

    // TODO: cache classpath if deps are unchanged - as getting the cp takes sooooo long (it always tries to lookup SNAPSHOT deps online)
    getClasspath () {
        this.createPomXml();

        const classPathfileName = 'buildjs_cp.txt';

        try {
            sh(`mvn dependency:build-classpath -Dmdep.outputFile=${classPathfileName}`);
            return fs.readFileSync(classPathfileName).toString();
        } finally {
            removeFile(classPathfileName);
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

    // user.clj file autoloaded by clojure, defines start-repl to initiate a
    // piggiback+weasel cljs repl.
    // Takes the same params as _createBuildClj
    _createUserClj (params) {
        const buffer = [];

        if (params.usePiggieback) {
            buffer.push(
                `(require 'cemerick.piggieback)`,
                `(require 'weasel.repl.websocket)`,
                ``,
                `(defn start-repl []`,
                `  (cemerick.piggieback/cljs-repl`,
                `    (weasel.repl.websocket/repl-env :ip "0.0.0.0" :port 9001)))`
            );
        }

        const userCljPath = this._getUserCljPath();

        info(`writing ${JSON.stringify(userCljPath)}`);
        mkdirp.sync(path.dirname(userCljPath));
        fs.writeFileSync(userCljPath, buffer.join('\n'));
    }

    // create a build.clj file that invokes the clojurescript compiler and/or
    // starts a standalone repl or nrepl server
    _createBuildClj (params) {
        const buffer = [];

        // cljs.build.api
        if (params.buildMethod) {
            assert(['build', 'watch'].indexOf(params.buildMethod) === 0);

            const buildOpts = {
                main: `'${this._config.getConfig('main')}`,
                'output-to': `"${this._config.getConfig('target')}"`
            };

            buffer.push(
                `(require 'cljs.build.api)`,
                ``,
                `(cljs.build.api/${params.buildMethod}`,
                `  ${JSON.stringify(this._config.getConfig('src'))}`,
                `  ${jsObjectToClj(buildOpts)}`,
                `)`
            );
        }

        // console cljs.repl + watch
        if (params.useRepl) {
            buffer.push(
                `(require 'cljs.repl)`,
                `(require 'cljs.build.api)`,
                `(require 'cljs.repl.browser)`,
                ``,
                `(cljs.repl/repl (cljs.repl.browser/repl-env)`,
                `  :watch ${this._config.getConfig('src')}`,
                `  :output-dir ${JSON.stringify(path.dirname(this._config.getConfig('target')))}`,
                `)`
            );
        }

        // nrepl + cemerik/piggieback + middleware + .nrepl-port file + fake
        // project.clj to let emacs (and other IDEs) pick up the repl port automatically
        if (params.useNrepl) {
            buffer.push(
                `(require '[clojure.tools.nrepl.server :as server])`,
                `(require '[cemerick.piggieback :as pback])`,
                `(require 'cider.nrepl)`,
                ``,
                `(let [conn (server/start-server`,
                `             :handler (apply server/default-handler`,
                `                             #'pback/wrap-cljs-repl`,
                `                             ;; https://github.com/clojure-emacs/cider-nrepl/blob/v0.12.0/src/cider/nrepl.clj`,
                `                             (map resolve cider.nrepl/cider-middleware)`,
                `                      )`,
                `           )`,
                `     ]`,
                `  ;;  nrepl-port file picked up by emacs-cider (and other IDEs?)`,
                `  (spit ".repl-port" (:port conn))`,
                `  ;; fake project.clj file to make emacs-cider (and other IDEs?) recognize our clojurescript project root`,
                `  (spit "project.clj" "")`,
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
        const classpath = [this._maven.getClasspath(),
                           this._getUserCljPath(),
                           this._config.getConfig('src')].join(':');
        const buildClj = this._getBuildCljPath();

        sh(`${rlwrap}java -cp ${classpath} clojure.main ${buildClj}`);
    }

    build () {
        this._createBuildClj({buildMethod: 'build'});
        this._runBuildClj();
    }

    watch () {
        this._createBuildClj({buildMethod: 'watch'});
        this._runBuildClj();
    }

    repl () {
        this.build();
        this._createBuildClj({useRepl: true});
        this._runBuildClj({useRlwrap: true});
    }

    nrepl () {
        this.build();
        this._createBuildClj({useNrepl: true});
        this._runBuildClj({});
    }
}

function runBuildCommand (args) {
    const config = new Config();
    const maven = new Maven(config);
    const cljs = new ClojureScript({maven, config});

    if (args.install) {
        info('installing cljs depedencies via maven');
        maven.installDependencies();
    } else if (args.repl) {
        info('starting cljs repl');
        cljs.repl();
    } else if (args.nrepl) {
        info('starting nrepl server');
        cljs.nrepl();
    } else {
        info('building');
        cljs.build();
    }
}

const docstring = `\
Build, install dependencies and manage REPLs for a Clojurescript project.

usage:
    cljsbuild [options] [build-options]
    cljsbuild [options] install
    cljsbuild [options] repl
    cljsbuild [options] nrepl

options:
    -h, --help        show help
    -v, --verbose     verbose output
    --version         show cljsbuilds version

build-options
    -p, --production  build with optimizazion level :advanced
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
        logVerbosity = 1;
    }

    runBuildCommand(args);
}

main();
