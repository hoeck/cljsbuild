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

    it('should setup cljsbuild.dependencies using maven', function * () {
        scriptEnv.writeFiles({'package.json': '{}'});
        maven.and.returnValue([{v: '1.2.3'}]);
        clojars.and.returnValue([]);

        const res = yield cljsbuild('init');
        const packageJson = JSON.parse(scriptEnv.readFiles()['package.json']);

        expect(packageJson).toEqual({
            cljsbuild: {
                main: jasmine.any(String),
                dependencies: {
                    "org.clojure/clojure": '1.2.3',
                    "org.clojure/clojurescript": '1.2.3',
                    "org.clojure/tools.nrepl": '1.2.3',
                    "com.cemerick/piggieback": '1.2.3',
                    weasel: '1.2.3'
                }
            }
        });
    });

    it('should setup cljsbuild.dependencies using clojars', function * () {
        scriptEnv.writeFiles({'package.json': '{}'});
        maven.and.returnValue([]);
        clojars.and.callFake((query) => {
            const [groupId, artifactId] = query.split(' ');

            return [{
                version: '4.5.6',
                group_name: groupId,
                jar_name: artifactId
            }];
        });

        const res = yield cljsbuild('init');

        const packageJson = JSON.parse(scriptEnv.readFiles()['package.json']);
        expect(packageJson).toEqual({
            cljsbuild: {
                main: jasmine.any(String),
                dependencies: {
                    "org.clojure/clojure": '4.5.6',
                    "org.clojure/clojurescript": '4.5.6',
                    "org.clojure/tools.nrepl": '4.5.6',
                    "com.cemerick/piggieback": '4.5.6',
                    weasel: '4.5.6'
                }
            }
        });
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
