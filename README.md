<p align="center">
  <img src="https://raw.github.com/divriots/browser-vite/master/browser-vite.svg" height="200px">
</p>
<br/>
<p align="center">
  <a href="https://npmjs.com/package/browser-vite"><img src="https://img.shields.io/npm/v/browser-vite.svg" alt="npm package"></a>
  <a href="https://nodejs.org/en/about/releases/"><img src="https://img.shields.io/node/v/browser-vite.svg" alt="node compatibility"></a>
  <br/>
</p>
<p align="center">
  <a href="https://divRIOTS.com">Brought to you by<br/></a>
  <a href="https://divRIOTS.com#gh-light-mode-only" target="_blank">
        <img width="150" height="40" src="https://divRIOTS.com/divriots.svg#gh-light-mode-only" alt="‹div›RIOTS" />
        </a>
        <a href="https://divRIOTS.com#gh-dark-mode-only" target="_blank">
        <img width="150" height="40" src="https://divRIOTS.com/divriots-dark.svg#gh-dark-mode-only" alt="‹div›RIOTS" />
        </a>
</p>
<br/>

# Vite for Browser ⚡

This is a fork of vite which aims at being used in a browser (served by service worker).

- [Introduction blog post](https://divriots.com/blog/vite-in-the-browser)

Used in [Backlight.dev](https://backlight.dev) and in the upcoming [Replic.dev](https://replic.dev)

---

Here are the changes made, required to run it in the Browser:
- Generate an un-bundled `browser` build: [rollup.config.js#L218-L274](https://github.com/divriots/vite/blob/browser-vite/packages/vite/rollup.config.js#L218-L274)
  - avoids duplicate dependencies in App using it
  - prefers browser alternatives for dependencies
- Shim CLI-only dependencies (chalk,debug...): [rollup.config.js#L470-L477](https://github.com/divriots/vite/blob/browser-vite/packages/vite/rollup.config.js#L470-L477)
- Limit FS dependency
  - remove watch/glob/config
  - but keep resolving project files through FS (will be shimmed in-App)
- Remove serve
- Remove dependency handling/optimizing/resolving
  - handled in-App through custom plugins
  - using a service to generate/serve optimized dependencies (see below)

Another change was made to support running the dependency optimizer as a service:
- Parse CJS exports (using cjs-module-lexer) to avoid the es-interop transform (further de-coupling vite & optimizer): [#8e80d8](https://github.com/divriots/vite/commit/8e80d88372b4ea287b502ceec7edf52a4c3026b3)

# Usage

A full sample is left as an exercise to the reader, but here are the bits you'll need:

## Installation

Prefer installing as vite alias, so that official vite plugins will work OOB.
When importing `vite` below, all imports will be resolved in `browser-vite`.

```
$ npm install --save vite@npm:browser-vite
```

Package has 2 entry points:
- `vite/node/node`: regular vite node bundle
- `vite/node/browser`: browser build -> make sure to use this one, either explicitely or having your bundle use the package.json `browser` field

## Service worker

You'll need a service worker which will intercept all requests from your vite iframe, so that they get served by vite.
e.g. with workbox:

```js
workbox.routing.registerRoute(
  /^https?:\/\/HOST/BASE_URL\/(\/.*)$/,
  async ({
    request,
    params,
    url,
  }: import('workbox-routing/types/RouteHandler').RouteHandlerCallbackContext): Promise<Response> => {
    const req = request?.url || url.toString();
    const [pathname] = params as string[];
    // send the request to vite worker
    const response = await postToViteWorker(pathname)
    return response;
  }
);
```

## Vite worker

Note: You need to alias `fs` builtin to a VFS implementation (e.g. `memfs`), you may also need other node builtins browserified, for reference we've been running these aliases:

```
fs: memfs,
path: path-browserify,
querystring: querystring-es3,
url: url/url.js,
crypto: crypto-browserify,
stream: readable-stream-no-circular,
readable-stream: readable-stream-no-circular,
safe-buffer: buffer,
timers: timers-browserify,
os: os-browserify,
tty: tty-browserify,
readline: EMPTY,
fsevents: EMPTY,
chokidar: EMPTY,
readdirp: EMPTY,
consolidate: EMPTY,
pnpapi: EMPTY,
// esm-browser version fails to parse HTML in worker, due to DOM (document) reference
// AFAICT node version works in web worker
@vue/compiler-dom: @vue/compiler-dom/dist/compiler-dom.cjs.js
```

The vite worker will load `browser-vite` and instanciate a custom `ViteDevServer`:

```js
import {
  transformWithEsbuild,
  ModuleGraph,
  transformRequest,
  createPluginContainer,
  createDevHtmlTransformFn,
  resolveConfig,
  generateCodeFrame,
  ssrTransform,
  ssrLoadModule,
  ViteDevServer,
  PluginOption
} from 'vite';

export async function createServer(
  const config = await resolveConfig(
    {
      plugins: [
        // virtual plugin to provide vite client/env special entries (see below)
        viteClientPlugin,
        // virtual plugin to resolve NPM dependencies, e.g. using unpkg, skypack or another provider (browser-vite only handles project files)
        nodeResolvePlugin,
        // add vite plugins you need here (e.g. vue, react, astro ...)
      ]
      base: BASE_URL, // as hooked in service worker
      // not really used, but needs to be defined to enable dep optimizations
      cacheDir: 'browser',
      root: VFS_ROOT,
      // any other configuration (e.g. resolve alias)
    },
    'serve'
  );
  const plugins = config.plugins;
  const pluginContainer = await createPluginContainer(config);
  const moduleGraph = new ModuleGraph((url) => pluginContainer.resolveId(url));

  const watcher: any = {
    on(what: string, cb: any) {
      return watcher;
    },
    add() {},
  };
  const server: ViteDevServer = {
    config,
    pluginContainer,
    moduleGraph,
    transformWithEsbuild,
    transformRequest(url, options) {
      return transformRequest(url, server, options);
    },
    ssrTransform,
    printUrls() {},
    _globImporters: {},
    ws: {
      send(data) {
        // send HMR data to vite client in iframe however you want (post/broadcast-channel ...)
      },
      async close() {},
      on() {},
      off() {},
    },
    watcher,
    async ssrLoadModule(url) {
      return ssrLoadModule(url, server, loadModule);
    },
    ssrFixStacktrace() {},
    async close() {},
    async restart() {},
    _optimizeDepsMetadata: null,
    _isRunningOptimizer: false,
    _ssrExternals: [],
    _restartPromise: null,
    _forceOptimizeOnRestart: false,
    _pendingRequests: new Map(),
  };

  server.transformIndexHtml = createDevHtmlTransformFn(server);

  // apply server configuration hooks from plugins
  const postHooks: ((() => void) | void)[] = [];
  for (const plugin of plugins) {
    if (plugin.configureServer) {
      postHooks.push(await plugin.configureServer(server));
    }
  }

  // run post config hooks
  // This is applied before the html middleware so that user middleware can
  // serve custom content instead of index.html.
  postHooks.forEach((fn) => fn && fn());

  await pluginContainer.buildStart({});
  await runOptimize(server);
  
  return server;
}
```

If you want to optimize (bundle) the npm deps, you can do so:

```js
import {
  scanImports,
  flattenId,
  createMissingImporterRegisterFn,
  ResolvedConfig,
  DepOptimizationMetadata,
  ViteDevServer,
} from 'vite';

export async function runOptimize(server: ViteDevServer) {
  const optimizeConfig = {
    ...server.config,
    build: {
      ...server.config.build,
      rollupOptions: {
        ...server.config.build.rollupOptions,
        input: ENTRY_FILES,
      },
    },
  };

  try {
    server._isRunningOptimizer = true;
    server._optimizeDepsMetadata = null;
    server._optimizeDepsMetadata = await optimizeDeps(
      server,
      optimizeConfig,
    );
  } finally {
    server._isRunningOptimizer = false;
  }
  server._registerMissingImport = createMissingImporterRegisterFn(
    server,
    (_config, _force, _asCommand, newDeps) =>
      optimizeDeps(server, optimizeConfig, newDeps)
  );
}

async function optimizeDeps(
  server: ViteDevServer,
  config: ResolvedConfig,
  deps?: Record<string, string>
): Promise<DepOptimizationMetadata> {
  const mainHash = '0';
  const data: StudioDepOptimizationMetadata = {
    hash: mainHash,
    browserHash: mainHash,
    optimized: {},
  };

  if (deps) {
    console.log('New dependencies: ', Object.keys(deps));
  } else {
    const { missing } = await scanImports(config);
    deps = missing;
    console.log('Scanned dependencies: ', Object.keys(deps));
  }
  // Optimize dependency set using a bundler service, e.g. esm.sh
  return data;
}
```

Vite client plugin (while env works as is, you probably need a different bundle for the client, so that you can inject HMR messages).

```js
import { CLIENT_ENTRY, CLIENT_DIR, ENV_ENTRY, Plugin } from 'vite';
import vite_client from 'vite/dist/client/browser.mjs?raw';
import vite_client_env from 'vite/dist/client/env.mjs?raw';

const viteClientPlugin: Plugin = {
  name: 'vite:browser:hmr',
  enforce: 'pre',
  resolveId(id) {
    if (id.startsWith(CLIENT_DIR)) {
      return {
        id: /\.mjs$/.test(id) ? id : `${id}.mjs`,
        external: true,
      };
    }
  },
  load(id) {
    if (id === CLIENT_ENTRY) {
      return vite_client;
    }
    if (id === ENV_ENTRY) {
      return vite_client_env;
    }
  },
};

export { viteClientPlugin };


```


---

**That's all folks ! Below is upstream README !**

---

# Vite ⚡

> Next Generation Frontend Tooling

- 💡 Instant Server Start
- ⚡️ Lightning Fast HMR
- 🛠️ Rich Features
- 📦 Optimized Build
- 🔩 Universal Plugin Interface
- 🔑 Fully Typed APIs

Vite (French word for "quick", pronounced [`/vit/`](https://cdn.jsdelivr.net/gh/vitejs/vite@main/docs/public/vite.mp3), like "veet") is a new breed of frontend build tool that significantly improves the frontend development experience. It consists of two major parts:

- A dev server that serves your source files over [native ES modules](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Modules), with [rich built-in features](https://vitejs.dev/guide/features.html) and astonishingly fast [Hot Module Replacement (HMR)](https://vitejs.dev/guide/features.html#hot-module-replacement).

- A [build command](https://vitejs.dev/guide/build.html) that bundles your code with [Rollup](https://rollupjs.org), pre-configured to output highly optimized static assets for production.

In addition, Vite is highly extensible via its [Plugin API](https://vitejs.dev/guide/api-plugin.html) and [JavaScript API](https://vitejs.dev/guide/api-javascript.html) with full typing support.

[Read the Docs to Learn More](https://vitejs.dev).

## Migrating from 1.x

Check out the [Migration Guide](https://vitejs.dev/guide/migration.html) if you are upgrading from 1.x.

## Packages

| Package                                           | Version (click for changelogs)                                                                                                       |
| ------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------- |
| [vite](packages/vite)                             | [![vite version](https://img.shields.io/npm/v/vite.svg?label=%20)](packages/vite/CHANGELOG.md)                                       |
| [@vitejs/plugin-vue](packages/plugin-vue)         | [![plugin-vue version](https://img.shields.io/npm/v/@vitejs/plugin-vue.svg?label=%20)](packages/plugin-vue/CHANGELOG.md)             |
| [@vitejs/plugin-vue-jsx](packages/plugin-vue-jsx) | [![plugin-vue-jsx version](https://img.shields.io/npm/v/@vitejs/plugin-vue-jsx.svg?label=%20)](packages/plugin-vue-jsx/CHANGELOG.md) |
| [@vitejs/plugin-react](packages/plugin-react)     | [![plugin-react version](https://img.shields.io/npm/v/@vitejs/plugin-react.svg?label=%20)](packages/plugin-react/CHANGELOG.md)       |
| [@vitejs/plugin-legacy](packages/plugin-legacy)   | [![plugin-legacy version](https://img.shields.io/npm/v/@vitejs/plugin-legacy.svg?label=%20)](packages/plugin-legacy/CHANGELOG.md)    |
| [create-vite](packages/create-vite)               | [![create-vite version](https://img.shields.io/npm/v/create-vite.svg?label=%20)](packages/create-vite/CHANGELOG.md)                  |

## Contribution

See [Contributing Guide](https://github.com/vitejs/vite/blob/main/CONTRIBUTING.md).

## License

MIT
