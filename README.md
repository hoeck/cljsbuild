# Cljsbuild

A simple Clojurescript build tool for Nodejs.

# Features

- simple
- build cljs
- launch a tty cljs repl
- launch an nrepl server
- with figwheel support (`cljsbuild nrepl -f`)
- store config and maven deps in package.json
- works with npm scripts

# Installation

You need at least node v6.9.4

    npm install cljsbuild --save-dev

Cljsbuild also needs Java (for the Clojurescript compiler and repl/nrepl) and
Maven2 for Java dependency management (`apt install maven2`).

# New Project Setup

1. Generate a new package.json with `npm init`
2. Install cljsbuild, a static http server, a copy-and-watch tool and a command runner: `npm install cljsbuild http-server cpx concurrently --save-dev`
3. Add cljsbuild configuration by calling `node_modules/.bin/cljsbuild init --figwheel`
4. Run `node_modules/.bin/cljsbuild install`
5. Create a `src/app/core.cljs` file: `(ns app.core)`
6. Edit `package.json` `cljsbuild` `main` to match `app.core`
7. Create an `html/index.html` file to load the cljs app: `<!doctype html><html><body><script src="js/main.js"></script></body></html>`
8. Add an entry to `package.json` `scripts`: `"repl": "concurrently --kill-others --raw 'http-server -c-1 --silent -p 8080 build 0<&-' 'cpx html/index.html build --watch 0<&-' 'cljsbuild repl --figwheel'"`
9. Run `npm run repl` and wait around 1 minute for the cljs compiler to compile everything, make sure port 8080 is not in use
10. After `Prompt will show when Figwheel connects to your application` shows up, open http://localhost:8080
11. Happy Hacking!

Check the [simple fighwheel example](examples/simple-figwheel/README.md).

# Example Usage

    cljsbuild -h             # help screen
    cljsbuild                # install dependencies and build
    cljsbuild repl           # start a cljs repl
    cljsbuild nrepl -f       # start an nrepl server and provide a start-repl function that launches figwheel

# Configuration

Cljsbuild reads its config from the `cljsbuild` key in package.json:

    cljsbuild: {
      main: "my-app-namespace.core"    # cljs main namespace
      src: "src"                       # cljs source directory
      depedencies: {                   # cljs dependencies fetched via maven
        "org.clojure/clojure": "1.7.0",
        "org.clojure/clojurescript": "1.7.170",
        <...>
      }
    }

Run `node_modules/.bin/cljsbuild init` to initialize the config,
`node_modules/.bin/cljsbuild update` to update any maven dependencies.

# Scripting

Use npm [scripts](https://docs.npmjs.com/misc/scripts) to assemble cljsbuild and other tools:

    "scripts": {
      "build-production": "cljsbuild --production",
      "dev-nrepl": "paralellshell 'http-server -c-1 --silent' 'cljsbuild nrepl'"
    }

and invoke them on the commandline

    $ npm run dev-nrepl
