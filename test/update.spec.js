const {scriptEnv, cljsbuild, mockMavenAndClojars} = require('./test');

describe('the init command', () => {
    let server;
    let maven;
    let clojars;

    beforeEach(function * () {
        scriptEnv.clear();

        maven = jasmine.createSpy();
        clojars = jasmine.createSpy();

        server = yield mockMavenAndClojars({
            mavenCallback: maven,
            clojarsCallback: clojars
        });

        // prepare a single package json for all tests
        scriptEnv.writeFiles({
            'package.json': JSON.stringify({
                cljsbuild: {
                    dependencies: {
                        'com.foo/lib-a': '1.2.3',
                        'com.foo/lib-b': '4.5.6'
                    }
                }
            })
        });
    });

    afterEach(function * () {
        yield server.close();
    });

    it('it should update dependencies in package.json cljsbuild.dependencies', function * () {
        maven.and.callFake((query) => {
            if (query.match(/lib-a/)) {
                return [{v: '1.2.4'}];
            }
            if (query.match(/lib-b/)) {
                return [{v: '1.0.0-alpha'}];
            }

            return [];
        });

        yield cljsbuild('update');

        const packageJson = JSON.parse(scriptEnv.readFiles()['package.json']);
        expect(packageJson).toEqual({
            cljsbuild: {
                dependencies: {
                    // will choose the first result from maven.org/clojars,
                    // regardless of actual version number
                    'com.foo/lib-a': '1.2.4',
                    'com.foo/lib-b': '1.0.0-alpha'
                }
            }
        });
    });

    it('should only pick release versions with "--releases-only"', function * () {

        // using maven or clojars shouldn't matter
        maven.and.returnValue([]);
        clojars.and.returnValue([
            {v: '9.0.1-snapshot'},
            {v: '9.0.0'}
        ]);

        yield cljsbuild('update', '--releases-only');

        const packageJson = JSON.parse(scriptEnv.readFiles()['package.json']);
        expect(packageJson).toEqual({
            cljsbuild: {
                dependencies: {
                    'com.foo/lib-a': '9.0.0',
                    'com.foo/lib-b': '9.0.0'
                }
            }
        });
    });

    it('should not modify package.json with "--dry-run"', function * () {

        // using maven or clojars shouldn't matter
        maven.and.returnValue([]);
        clojars.and.returnValue([{v: '9.0.0'}]);

        const res = yield cljsbuild('update', '--dry-run');

        const packageJson = JSON.parse(scriptEnv.readFiles()['package.json']);
        expect(packageJson).toEqual({
            cljsbuild: {
                dependencies: {
                    'com.foo/lib-a': '1.2.3',
                    'com.foo/lib-b': '4.5.6'
                }
            }
        });
        expect(res.stdout).toMatch(/lib-a/);
    });
});
