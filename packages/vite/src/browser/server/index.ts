import type { ResolvedServerOptions, ServerOptions } from '../../node/server'

export function resolveServerOptions(
  root: string,
  raw?: ServerOptions
): ResolvedServerOptions {
  const server = raw || {}
  let allowDirs = server.fs?.allow
  const deny = server.fs?.deny || ['.env', '.env.*', '*.{crt,pem}']

  if (!allowDirs) {
    allowDirs = [root]
  }

  server.fs = {
    strict: server.fs?.strict ?? true,
    allow: allowDirs,
    deny
  }
  return server as ResolvedServerOptions
}
