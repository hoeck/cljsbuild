const fs = require('fs');

const {scriptEnv, cljsbuild} = require('./test');

describe('the basic options', () => {

    beforeEach(() => {
        scriptEnv.clear();
    });

    describe('"--version"', () => {
        it('should print the version and exit', function * () {
            const {stdout} = yield cljsbuild('--version');

            expect(stdout).toMatch(/^cljsbuild version.*/g);
        });
    });

    describe('"--help"', () => {
        it('should print some help and exit', function * () {
            const {stdout} = yield cljsbuild('--help');

            expect(stdout).toMatch(/usage/);
        });
    });
});
