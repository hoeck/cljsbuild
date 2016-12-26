const assert = require('assert');
const http = require('http');
const url = require('url');
const process = require('process');

const connect = require('connect');
const Jasmine = require('jasmine');
const jasmineCo = require('jasmine-co');
const SpecReporter = require('jasmine-spec-reporter');
const MockScriptEnvironment = require('mock-script-environment');

const scriptEnv = new MockScriptEnvironment();

module.exports = {
    scriptEnv,
    cljsbuild,
    httpServer,
    mockMavenAndClojars,
    resetScriptEnv
};

function httpServer ({port = 80} = {}) {
    const app = connect();

    return new Promise((resolve) => {
        const server = http.createServer(app).listen(port, () => {
            resolve({
                use: app.use.bind(app),
                close () {
                    return new Promise((resolve) => {
                        server.close(resolve);
                    });
                }
            });
        });
    });
}

/**
 * Set up a mock maven and clojars http repo server.
 */
function * mockMavenAndClojars ({mavenCallback, clojarsCallback}) {
    // mock external repositories
    scriptEnv.mockHost('search.maven.org');
    scriptEnv.mockHost('clojars.org');

    const server = yield httpServer();

    server.use((req, res) => {
        const parsedUrl = url.parse(req.url, true);

        if (req.headers.host === 'search.maven.org' && parsedUrl.pathname === '/solrsearch/select') {
            // an array like [{v: '1.0.0'}, {v: '0.9.3'}]
            const versions = mavenCallback(parsedUrl.query.q);

            if (!versions) {
                res.writeHead(500, 'server error');
                res.end();
                return;
            }

            res.end(JSON.stringify({
                response: {
                    docs: versions
                }
            }));

            return;
        }

        if (req.headers.host === 'clojars.org' && parsedUrl.pathname === '/search') {
            // an array of items: {v: '1.0.1'}
            const rawVersions = clojarsCallback(parsedUrl.query.q);
            const versions = rawVersions.map((v) => {
                // accept the maven mock format too (just an object with a
                // single v key denoting the version)
                if (Object.keys(v).join() === 'v') {
                    const [groupId, artifactId] = parsedUrl.query.q.split(' ');

                    return {
                        version: v.v,
                        group_name: groupId,
                        jar_name: artifactId
                    };
                } else {
                    // raw clojars format
                    return v;
                }
            });

            if (!versions) {
                res.writeHead(500, 'server error');
                res.end();
                return;
            }

            res.end(JSON.stringify({
                results: versions
            }));

            return;
        }

        res.writeHead(404, 'not found');
        res.end();
    });

    return server;
}

function cljsbuild (...args) {
    return scriptEnv.exec(`/cljsbuild/cljsbuild.js ${args.join(' ')}`);
}

function resetScriptEnv () {
    scriptEnv.clear();

    // cljsbuilds shebang line is `#!/usr/bin/env node`, so we need env and node
    // on the PATH to be able to run it
    scriptEnv.provideCommand('node');
    scriptEnv.provideCommand('env');
}

function runTests () {
    const jasmineRunner = new Jasmine(); // installs the jasmine globals

    // monkeypatch global jasmine functions to make them generator-friendly
    jasmineCo.install();

    jasmine.getEnv().clearReporters();
    jasmineRunner.addReporter(new SpecReporter());

    jasmineRunner.loadConfig({
        spec_dir: 'test',
        spec_files: [
            '*.spec.js'
        ]
    });

    jasmineRunner.onComplete((success) => {
        process.exit(success ? 0 : 1);
    });

    jasmineRunner.execute();
}

runTests();
