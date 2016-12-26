const {scriptEnv, cljsbuild, resetScriptEnv} = require('./test');

describe('the basic options', () => {

    beforeEach(() => {
        resetScriptEnv();
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
