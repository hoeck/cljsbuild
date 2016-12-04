const assert = require('assert');
const process = require('process');

const Jasmine = require('jasmine');
const jasmineCo = require('jasmine-co');
const SpecReporter = require('jasmine-spec-reporter');
const MockScriptEnvironment = require('mock-script-environment');

const scriptEnv = new MockScriptEnvironment();

module.exports = {
    scriptEnv,
    cljsbuild (...args) {
        return scriptEnv.exec(`/cljsbuild/cljsbuild.js ${args.join(' ')}`);
    }
};

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
