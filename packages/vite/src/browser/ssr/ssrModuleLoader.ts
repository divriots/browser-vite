import path from 'path'
import { pathToFileURL } from 'url'
import type { ViteDevServer } from '../../node/server'
import { unwrapId } from '../../node/utils'
import {
  ssrExportAllKey,
  ssrModuleExportsKey,
  ssrImportKey,
  ssrImportMetaKey,
  ssrDynamicImportKey
} from '../../node/ssr/ssrTransform'
import { transformRequest } from '../../node/server/transformRequest'
import type { InternalResolveOptions } from '../../node/plugins/resolve'

interface SSRContext {
  global: typeof globalThis
}

type SSRModule = Record<string, any>

const pendingModules = new Map<string, Promise<SSRModule>>()
const pendingImports = new Map<string, string[]>()

export async function ssrLoadModule(
  url: string,
  server: ViteDevServer,
  nodeImport: (id: string) => Promise<any>,
  context: SSRContext = { global },
  urlStack: string[] = []
): Promise<SSRModule> {
  url = unwrapId(url)

  // when we instantiate multiple dependency modules in parallel, they may
  // point to shared modules. We need to avoid duplicate instantiation attempts
  // by register every module as pending synchronously so that all subsequent
  // request to that module are simply waiting on the same promise.
  const pending = pendingModules.get(url)
  if (pending) {
    return pending
  }

  const modulePromise = instantiateModule(
    url,
    server,
    nodeImport,
    context,
    urlStack
  )
  pendingModules.set(url, modulePromise)
  modulePromise
    .catch(() => {
      pendingImports.delete(url)
    })
    .finally(() => {
      pendingModules.delete(url)
    })
  return modulePromise
}

async function instantiateModule(
  url: string,
  server: ViteDevServer,
  nodeImport: (id: string) => Promise<any>,
  context: SSRContext = { global },
  urlStack: string[] = []
): Promise<SSRModule> {
  const { moduleGraph } = server
  const mod = await moduleGraph.ensureEntryFromUrl(url, true)

  if (mod.ssrModule) {
    return mod.ssrModule
  }

  const result =
    mod.ssrTransformResult ||
    (await transformRequest(url, server, { ssr: true }))
  if (!result) {
    // TODO more info? is this even necessary?
    throw new Error(`failed to load module for ssr: ${url}`)
  }

  const ssrModule = {
    [Symbol.toStringTag]: 'Module'
  }
  Object.defineProperty(ssrModule, '__esModule', { value: true })

  // Tolerate circular imports by ensuring the module can be
  // referenced before it's been instantiated.
  mod.ssrModule = ssrModule

  const ssrImportMeta = {
    // The filesystem URL, matching native Node.js modules
    url: pathToFileURL(mod.file!).toString()
  }

  urlStack = urlStack.concat(url)
  const isCircular = (url: string) => urlStack.includes(url)

  const {
    isProduction,
    resolve: { dedupe, preserveSymlinks },
    root
  } = server.config

  // The `extensions` and `mainFields` options are used to ensure that
  // CommonJS modules are preferred. We want to avoid ESM->ESM imports
  // whenever possible, because `hookNodeResolve` can't intercept them.
  const resolveOptions: InternalResolveOptions = {
    dedupe,
    extensions: ['.js', '.cjs', '.json'],
    isBuild: true,
    isProduction,
    isRequire: true,
    mainFields: ['main'],
    preserveSymlinks,
    root
  }

  // Since dynamic imports can happen in parallel, we need to
  // account for multiple pending deps and duplicate imports.
  const pendingDeps: string[] = []

  const ssrImport = async (dep: string) => {
    dep = unwrapId(dep)
    if (dep[0] !== '.' && dep[0] !== '/') {
      return proxyESM(await nodeImport(dep))
    }
    if (!isCircular(dep) && !pendingImports.get(dep)?.some(isCircular)) {
      pendingDeps.push(dep)
      if (pendingDeps.length === 1) {
        pendingImports.set(url, pendingDeps)
      }
      const mod = await ssrLoadModule(
        dep,
        server,
        nodeImport,
        context,
        urlStack
      )
      if (pendingDeps.length === 1) {
        pendingImports.delete(url)
      } else {
        pendingDeps.splice(pendingDeps.indexOf(dep), 1)
      }
      // return local module to avoid race condition #5470
      return mod
    }
    return moduleGraph.urlToModuleMap.get(dep)?.ssrModule
  }

  const ssrDynamicImport = (dep: string) => {
    // #3087 dynamic import vars is ignored at rewrite import path,
    // so here need process relative path
    if (dep[0] === '.') {
      dep = path.posix.resolve(path.dirname(url), dep)
    }
    return ssrImport(dep)
  }

  function ssrExportAll(sourceModule: any) {
    for (const key in sourceModule) {
      if (key !== 'default') {
        Object.defineProperty(ssrModule, key, {
          enumerable: true,
          configurable: true,
          get() {
            return sourceModule[key]
          }
        })
      }
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  const AsyncFunction = async function () {}.constructor as typeof Function
  const initModule = new AsyncFunction(
    `global`,
    ssrModuleExportsKey,
    ssrImportMetaKey,
    ssrImportKey,
    ssrDynamicImportKey,
    ssrExportAllKey,
    result.code + `\n//# sourceURL=${mod.url}`
  )
  await initModule(
    context.global,
    ssrModule,
    ssrImportMeta,
    ssrImport,
    ssrDynamicImport,
    ssrExportAll
  )

  return Object.freeze(ssrModule)
}

// rollup-style default import interop for cjs
function proxyESM(mod: any) {
  // This is the only sensible option when the exports object is a primitve
  if (isPrimitive(mod)) return { default: mod }

  let defaultExport = 'default' in mod ? mod.default : mod

  if (!isPrimitive(defaultExport) && '__esModule' in defaultExport) {
    mod = defaultExport
    if ('default' in defaultExport) {
      defaultExport = defaultExport.default
    }
  }

  return new Proxy(mod, {
    get(mod, prop) {
      if (prop === 'default') return defaultExport
      return mod[prop] ?? defaultExport?.[prop]
    }
  })
}

function isPrimitive(value: any) {
  return !value || (typeof value !== 'object' && typeof value !== 'function')
}
