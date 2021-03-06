const {scriptEnv, cljsbuild, mockMavenAndClojars, resetScriptEnv} = require('./test');

describe('the repl and nrepl commands', () => {
    let mvnSpy;
    let mvnSpyClasspath;
    let javaSpy;

    const mvnArgs = [
        'dependency:build-classpath',
        '-f=/test/workdir/.cljsbuild/pom.xml',
        '-Dmdep.outputFile=/test/workdir/.cljsbuild/classpath.value'
    ];

    function getJavaArgs(classpath) {
        return [
            '-cp',
            `${classpath}:.cljsbuild/user:src`,
            'clojure.main',
            '.cljsbuild/build.clj'
        ];
    }

    beforeEach(function * () {
        resetScriptEnv();

        scriptEnv.writeFiles({
            'package.json': JSON.stringify({
                cljsbuild: {
                    main: 'foo-main',
                    dependencies: {
                        'com.foo/bar': '1.2.3'
                    }
                }
            })
        });

        mvnSpyClasspath = 'foo-bar-classpath';
        mvnSpy = scriptEnv.mockCommand('mvn').and.callFake(() => {
            scriptEnv.writeFiles({
                '.cljsbuild/classpath.value': mvnSpyClasspath
            });
        });

        javaSpy = scriptEnv.mockCommand('java');
    });

    describe('repl', () => {
        it('should spin up a java process running the repl', function * () {

            yield cljsbuild('repl');

            expect(mvnSpy).toHaveBeenCalledWith({args: mvnArgs});

            // java is called two times: to build cljs and to start the repl
            expect(javaSpy.calls.allArgs()).toEqual([
                [{args: getJavaArgs('foo-bar-classpath')}]
            ]);
        });

        it('should use rlwrap if available', function * () {
            const rlwrapSpy = scriptEnv.mockCommand('rlwrap');

            yield cljsbuild('repl');

            expect(rlwrapSpy.calls.allArgs()).toEqual([
                // first call to detect that rlwrap is available
                [{args: ['-v']}],
                // second call for the repl
                [{args: ['java'].concat(getJavaArgs('foo-bar-classpath'))}]
            ]);

            const buildCljs = scriptEnv.readFiles()['.cljsbuild/build.clj'];

            expect(buildCljs).toMatch(/cljs.repl\/repl/);
        });

        it('should use a cached classpath file if depdendencies are unchanged', function * () {
            // first call caches the classpath
            yield cljsbuild('repl');

            expect(mvnSpy).toHaveBeenCalled();
            expect(scriptEnv.readFiles()).toEqual(jasmine.objectContaining({
                '.cljsbuild/classpath.hash': '3e6dc8fd0c699061d6bb7d1ba26ccb29831b4cbf',
                '.cljsbuild/classpath.value': 'foo-bar-classpath'
            }));

            // the second call uses the cached classpath
            mvnSpy.calls.reset();
            javaSpy.calls.reset();

            yield cljsbuild('repl');

            expect(mvnSpy).not.toHaveBeenCalled();
            expect(javaSpy).toHaveBeenCalledWith({args: getJavaArgs('foo-bar-classpath')});

            // changing the dependencies should update the cache
            mvnSpy.calls.reset();
            mvnSpyClasspath = 'foo-bar-updated-classpath';
            javaSpy.calls.reset();
            scriptEnv.writeFiles({
                'package.json': JSON.stringify({
                    cljsbuild: {
                        main: 'foo-main',
                        dependencies: {
                            'com.foo/bar': '1.2.4'
                        }
                    }
                })
            });

            yield cljsbuild('repl');

            expect(mvnSpy).toHaveBeenCalledWith({args: mvnArgs});
            expect(javaSpy).toHaveBeenCalledWith({args: getJavaArgs('foo-bar-updated-classpath')});
            expect(scriptEnv.readFiles()).toEqual(jasmine.objectContaining({
                '.cljsbuild/classpath.hash': 'fde3520603de14df16c1495b78816c7bf200d9dd',
                '.cljsbuild/classpath.value': 'foo-bar-updated-classpath'
            }));
        });

        it('should start a figwheel cljs-repl with "--figwheel"', function * () {
            yield cljsbuild('repl', '--figwheel');

            expect(mvnSpy).toHaveBeenCalled();

            const buildCljs = scriptEnv.readFiles()['.cljsbuild/build.clj'];

            expect(buildCljs).toMatch(/\(fig\/cljs-repl\)/);
            expect(buildCljs).toMatch(/\(start-repl\)/);
            expect(buildCljs).not.toMatch(/cljs.repl\/repl/);
        });
    });

    describe('nrepl', () => {
        it('should spin up a java process running the nrepl server', function * () {
            yield cljsbuild('nrepl');

            expect(mvnSpy).toHaveBeenCalledWith({args: mvnArgs});
            expect(javaSpy.calls.allArgs()).toEqual([
                [{args: getJavaArgs('foo-bar-classpath')}]
            ]);

            const buildCljs = scriptEnv.readFiles()['.cljsbuild/build.clj'];

            expect(buildCljs).toMatch(/start-server/);
        });

        it('should create a user.clj file with the "start-repl" function', function * () {
            yield cljsbuild('nrepl');

            const userClj = scriptEnv.readFiles()['.cljsbuild/user/user.clj'];

            expect(userClj).toMatch(/defn start-repl/);
        });

        it('should create a user.clj file with the "start-repl" function and figwheel', function * () {
            yield cljsbuild('nrepl', '--figwheel');

            const userClj = scriptEnv.readFiles()['.cljsbuild/user/user.clj'];

            expect(userClj).toMatch(/defn start-repl/);
            expect(userClj).toMatch(/fig\/cljs-repl/);
        });
    });
});
