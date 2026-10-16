/**
 * CyberJudah web build: chunking that keeps code out of the start-up download.
 *
 * Expo's serializer moves every module that two async chunks share into one `__common` chunk,
 * which the page loads before anything else. With async routes (each screen its own chunk) and
 * the lazy boundaries of the web build (helpers/deferred.tsx), almost the whole app is shared by
 * some two chunks, so `__common` held nearly everything and the reader still downloaded it all
 * before its first chapter.
 *
 * Here `__common` holds only the shared modules the root layout needs (it is loaded first on every
 * page anyway). A module shared only by chunks loaded later stays in each of them: whichever loads
 * first defines it, the other's copy is skipped (Metro defines a module id once), so it still runs
 * once. A dynamic import loads the chunk the imported module starts.
 *
 * Only the production web export changes; native and development builds keep Expo's chunking.
 * If Expo's serializer no longer has the functions replaced here, its own chunking is kept.
 */
const fs = require('fs')
const Module = require('module')
const path = require('path')

const PATCH = `
function extractCommonChunk(chunks, graph, options) {
  const platform = graph.transformOptions && graph.transformOptions.platform
  const asyncChunks = [...chunks.values()].filter(chunk => chunk.isAsync)
  const rootLayout = asyncChunks.find(chunk =>
    chunk.entries.some(module =>
      /^app[\\\\/]_layout\\.[jt]sx?$/.test(path_1.default.relative(options.projectRoot, module.path))
    )
  )
  if (platform !== 'web' || options.dev || !rootLayout) return __expoExtractCommonChunk(chunks, graph, options)
  const common = [...rootLayout.deps].filter(dep =>
    asyncChunks.some(chunk => chunk !== rootLayout && chunk.deps.has(dep))
  )
  if (!common.length) return undefined
  for (const chunk of asyncChunks) for (const dep of common) chunk.deps.delete(dep)
  return new Chunk('/__common.js', common, graph, options, false, true)
}
function makeChunkByPathLookupMap(chunks) {
  // A module in a chunk loaded at start needs no load; else the chunk it starts, else the first.
  const chunkByPath = new Map()
  const ordered = [...chunks].sort((a, b) => Number(a.isAsync) - Number(b.isAsync))
  for (const chunk of ordered) if (!chunk.isAsync) for (const module of chunk.deps) if (!chunkByPath.has(module.path)) chunkByPath.set(module.path, chunk)
  for (const chunk of ordered) for (const module of chunk.entries) if (!chunkByPath.has(module.path) && chunk.deps.has(module)) chunkByPath.set(module.path, chunk)
  for (const chunk of ordered) for (const module of chunk.deps) if (!chunkByPath.has(module.path)) chunkByPath.set(module.path, chunk)
  return chunkByPath
}
`

function installWebChunking() {
  let file
  try {
    file = require.resolve('@expo/metro-config/build/serializer/serializeChunks', {
      paths: [path.dirname(require.resolve('expo/metro-config'))],
    })
  } catch {
    return
  }
  const original = require(file)
  const source = fs.readFileSync(file, 'utf8')
  const names = ['function extractCommonChunk(', 'function makeChunkByPathLookupMap(']
  if (!names.every(name => source.split(name).length === 2) || !original.graphToSerialAssetsAsync) {
    console.warn('[web-chunking] Expo serializer changed; keeping its own chunking.')
    return
  }
  const patched = new Module(file, module)
  patched.filename = file
  patched.paths = Module._nodeModulePaths(path.dirname(file))
  patched._compile(
    source
      .replace(names[0], 'function __expoExtractCommonChunk(')
      .replace(names[1], 'function __expoMakeChunkByPathLookupMap(') + PATCH,
    file
  )
  original.graphToSerialAssetsAsync = patched.exports.graphToSerialAssetsAsync
}

/**
 * The workspace packages (strong/packages/*) carry their own node_modules, so the web bundle had
 * two copies of `effect`, `fast-check`, `htmlparser2`, `entities`… (the app's and the package's).
 * On the web, a package the app also has, at the same version, resolves to the app's copy: the
 * same code, bundled once. A different version keeps its own copy.
 */
function dedupeWorkspacePackages(config, projectRoot) {
  const appModules = path.join(projectRoot, 'node_modules')
  const version = dir => {
    try {
      return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version
    } catch {
      return undefined
    }
  }
  const list = dir => {
    try {
      return fs.readdirSync(dir).filter(name => !name.startsWith('.'))
    } catch {
      return []
    }
  }
  // The workspace packages, as the app resolves them (node_modules links) and as checked out.
  const workspaces = new Set()
  const addWorkspace = dir => {
    try {
      if (fs.existsSync(path.join(dir, 'package.json'))) workspaces.add(fs.realpathSync(dir))
    } catch {}
  }
  const packagesDir = path.resolve(projectRoot, '../../packages')
  for (const name of list(packagesDir)) addWorkspace(path.join(packagesDir, name))
  for (const scope of list(appModules).filter(name => name.startsWith('@')))
    for (const name of list(path.join(appModules, scope))) {
      const dir = path.join(appModules, scope, name)
      try {
        if (
          fs.lstatSync(dir).isSymbolicLink() &&
          !fs.realpathSync(dir).includes(`${path.sep}node_modules${path.sep}`)
        )
          addWorkspace(dir)
      } catch {}
    }
  const shared = new Set()
  for (const workspace of workspaces) {
    const modules = path.join(workspace, 'node_modules')
    for (const entry of list(modules)) {
      const names = entry.startsWith('@')
        ? list(path.join(modules, entry)).map(name => `${entry}/${name}`)
        : [entry]
      for (const name of names) {
        const own = version(path.join(modules, name))
        if (own && own === version(path.join(appModules, name))) shared.add(name)
      }
    }
  }
  if (!shared.size) return config
  const roots = [...workspaces].map(dir => dir + path.sep)
  const upstream = config.resolver.resolveRequest
  const fromApp = path.join(projectRoot, 'package.json')
  config.resolver.resolveRequest = (context, moduleName, platform, ...rest) => {
    const resolve = upstream ?? context.resolveRequest
    const parts = moduleName.split('/')
    const name = moduleName.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
    if (
      platform === 'web' &&
      shared.has(name) &&
      roots.some(root => context.originModulePath.startsWith(root))
    )
      return resolve({ ...context, originModulePath: fromApp }, moduleName, platform, ...rest)
    return resolve(context, moduleName, platform, ...rest)
  }
  return config
}

module.exports = { installWebChunking, dedupeWorkspacePackages }
