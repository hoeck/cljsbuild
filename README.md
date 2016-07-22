# Cljsbuild

A simple Clojurescript build tool for Nodejs.

# Installation

Cljsbuild needs Java (for the Clojurescript compiler and repl/nrepl) and Maven2 for Java dependency management (`apt-get install maven2`).

    npm install cljsbuild --save-dev

# Example Usage

    cljsbuild -h             # help screen
    cljsbuild                # install dependencies and build
    cljsbuild repl           # start a cljs repl
    cljsbuild nrepl          # start an nrepl server and provide a start-repl function

# Configuration and Setup

Cljsbuild reads its config from the `cljsbuild` key in package.json:

    cljsbuild: {
      main: "my-app-namespace.core"    # cljs main namespace
      src: "src"                       # cljs source directory
      depedencies: {                   # cljs dependencies fetched via maven
        "org.clojure/clojure": "1.7.0",
        "org.clojure/clojurescript": "1.7.170",
        "com.cemerick/piggieback": "0.2.1",
        "weasel": "0.7.0",
        "com.taoensso.forks/http-kit": "2.1.20",
        "org.clojure/tools.nrepl": "0.2.12",
        "cider/cider-nrepl": "0.13.0-SNAPSHOT",
        "refactor-nrepl": "2.0.0-SNAPSHOT"
      }
    }

Use npm [scripts](https://docs.npmjs.com/misc/scripts) to assemble cljsbuild and other tools:

    "scripts": {
      "build-production": "cljsbuild --production",
      "dev-nrepl": "sh -c 'http-server & cljsbuild nrepl'"
    }

and invoke them on the commandline

    $ npm run dev-nrepl
