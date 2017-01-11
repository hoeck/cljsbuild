const {scriptEnv, cljsbuild, resetScriptEnv} = require('./test');

describe('the build command', () => {

    beforeEach(() => {
        resetScriptEnv();
    });

    describe('in an empty or misconfigured project', () => {
        it('should complain about a missing package.json', function * () {
            try {
                const res = yield cljsbuild();
                expect(false).toBe(true);
            } catch (err) {
                expect(err.stderr.trim()).toBe('Error: package.json does not exist');
            }
        });

        it('should complain about a broken package.json', function * () {
            scriptEnv.writeFiles({
                'package.json': 'foo'
            });

            try {
                const res = yield cljsbuild();
                expect(false).toBe(true);
            } catch (err) {
                expect(err.stderr.trim()).toMatch(/^Error: cannot parse package.json/g);
            }
        });

        it('should complain about missing cljsbuild config in package.json', function * () {
            scriptEnv.writeFiles({
                'package.json': '{}'
            });

            try {
                const res = yield cljsbuild();
                expect(false).toBe(true);
            } catch (err) {
                const lines = err.stderr.split('\n').filter(x => x);
                expect(lines).toEqual([
                    'Warning: no "cljsbuild" key found in package.json',
                    'Error: undefined package.json value: cljsbuild.main',
                ]);
            }
        });
    });

    describe('in a configured project', () => {
        let mvnSpy;
        let javaSpy;

        beforeEach(() => {
            scriptEnv.writeFiles({
                'package.json': JSON.stringify({
                    cljsbuild: {
                        main: 'foo-main',
                        dependencies: 'foo-cljs-package'
                    }
                })
            });

            mvnSpy = scriptEnv.mockCommand('mvn').and.callFake(() => {
                scriptEnv.writeFiles({
                    '.cljsbuild/classpath.value': 'foo-bar-classpath'
                });
            });

            javaSpy = scriptEnv.mockCommand('java');
        });

        it('should use the config in package.json and maven to launch the cljs compiler', function * () {
            yield cljsbuild();

            const files = scriptEnv.readFiles();
            expect(files).toEqual({
                '.cljsbuild/classpath.hash': jasmine.any(String),
                '.cljsbuild/classpath.value': 'foo-bar-classpath',
                '.cljsbuild/build.clj': jasmine.any(String),
                'package.json': '{"cljsbuild":{"main":"foo-main","dependencies":"foo-cljs-package"}}'
            });
            expect(files['.cljsbuild/build.clj']).not.toMatch(/:advanced/);
            expect(mvnSpy).toHaveBeenCalledWith({
                args: [
                    'dependency:build-classpath',
                    '-f=/test/workdir/.cljsbuild/pom.xml',
                    '-Dmdep.outputFile=/test/workdir/.cljsbuild/classpath.value'
                ]
            });
            expect(javaSpy).toHaveBeenCalledWith({
                args: [
                    '-cp', 'foo-bar-classpath:.cljsbuild/user:src',
                    'clojure.main',
                    '.cljsbuild/build.clj'
                ]
            });
        });

        it('should build with :advanced when the -p flag is given', function * () {
            yield cljsbuild('-p');

            expect(scriptEnv.readFiles()['.cljsbuild/build.clj']).toMatch(/:advanced/);
        });

        it('should build with :advanced when the --production flag is given', function * () {
            yield cljsbuild('--production');

            expect(scriptEnv.readFiles()['.cljsbuild/build.clj']).toMatch(/:advanced/);
        });
    });
});
