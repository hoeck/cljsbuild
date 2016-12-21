const fs = require('fs');

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
    });

    afterEach(function * () {
        yield server.close();
    });

    it('should setup "cljsbuild.dependencies" using the latest maven dependencies', function * () {
        scriptEnv.writeFiles({'package.json': '{}'});
        maven.and.returnValue([{v: '1.2.4-alpha'}, {v: '1.2.3'}, {v: '1.2.2'}]);
        clojars.and.returnValue([]);

        const res = yield cljsbuild('init');
        const packageJson = JSON.parse(scriptEnv.readFiles()['package.json']);

        expect(packageJson).toEqual({
            cljsbuild: {
                main: jasmine.any(String),
                dependencies: {
                    "org.clojure/clojure": '1.2.4-alpha',
                    "org.clojure/clojurescript": '1.2.4-alpha',
                    "org.clojure/tools.nrepl": '1.2.4-alpha',
                    "com.cemerick/piggieback": '1.2.4-alpha',
                    weasel: '1.2.4-alpha'
                }
            }
        });
    });

    it('should setup "cljsbuild.dependencies" using the latest clojars depdendencies', function * () {
        scriptEnv.writeFiles({'package.json': '{}'});

        // if a package cannot be found in maven, its looked up in clojars
        maven.and.returnValue([]);
        clojars.and.returnValue([
            {v: '4.5.6-alpha'},
            {v: '4.5.5'},
            {v: '4.5.4'}
        ]);

        yield cljsbuild('init');

        const packageJson = JSON.parse(scriptEnv.readFiles()['package.json']);
        expect(packageJson).toEqual({
            cljsbuild: {
                main: jasmine.any(String),
                dependencies: {
                    "org.clojure/clojure": '4.5.6-alpha',
                    "org.clojure/clojurescript": '4.5.6-alpha',
                    "org.clojure/tools.nrepl": '4.5.6-alpha',
                    "com.cemerick/piggieback": '4.5.6-alpha',
                    weasel: '4.5.6-alpha'
                }
            }
        });
    });

    it('should only pick release versions with "--releases-only"', function * () {
        scriptEnv.writeFiles({'package.json': '{}'});

        maven.and.returnValue([
            {v: '1.2.4-alpha'},
            {v: '1.2.3'},
            {v: '1.2.2'}
        ]);

        yield cljsbuild('init', '--releases-only');

        const packageJson = JSON.parse(scriptEnv.readFiles()['package.json']);
        expect(packageJson.cljsbuild.dependencies).toEqual(
            jasmine.objectContaining({
                "org.clojure/clojure": '1.2.3'
            })
        );
    });

    it('should include dependencies neccesary for cider with "--cider"', function * () {
        scriptEnv.writeFiles({'package.json': '{}'});

        maven.and.returnValue([{v: '1.0.1'}]);

        yield cljsbuild('init', '--cider');

        const packageJson = JSON.parse(scriptEnv.readFiles()['package.json']);
        expect(packageJson.cljsbuild.dependencies).toEqual(
            jasmine.objectContaining({
                'org.clojure/clojure': '1.0.1',
                'cider/cider-nrepl': '1.0.1',
                'refactor-nrepl': '1.0.1'
            })
        );
    });

    it('should only print what would have been done with "--dry-run"', function * () {
        scriptEnv.writeFiles({'package.json': '{}'});

        maven.and.returnValue([{v: '1.0.1'}]);

        const res = yield cljsbuild('init', '--dry-run');

        expect(res.stdout).toMatch(/org.clojure\/clojure/);

        const packageJson = JSON.parse(scriptEnv.readFiles()['package.json']);
        expect(packageJson.cljsbuild).toBeUndefined();
    });

    it('should exit with an error if package.json "cljsbuild.dependencies" does already exist', function * () {
        scriptEnv.writeFiles({
            'package.json': JSON.stringify({
                cljsbuild: {
                    dependencies: []
                }
            })
        });

        try {
            yield cljsbuild('init');
            expect(false).toBe(true);
        } catch (err) {
            expect(err.stderr.trim()).toBe('Error: package.json cljsbuild.dependencies does already exist');
        }
    });
});
