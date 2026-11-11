/**
 * Render-entry boundary gate: bundles this package's `./render` export with
 * esbuild (static and lazy imports, through installed dependencies) and fails
 * if anything resolves to `@pascal-app/editor` or `next`. Read-only viewers
 * load `./render` without the editor, so nothing on that graph may need it.
 *
 * Self-tests first prove the gate is not vacuous: a probe importing the editor
 * (statically and lazily) and the package root (whose tools and panel do
 * import the editor) must both be rejected.
 */
import { readFileSync, realpathSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, type Plugin } from 'esbuild'
import ts from 'typescript'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ownSource = resolve(root, 'src')
const forbiddenSpecifier = /^(?:@pascal-app\/editor|next)(?:\/|$)/
const forbiddenPath = /(?:^|\/)node_modules\/(?:@pascal-app\/editor|next)(?:\/|$)/

function rejectForbidden(path: string, importer?: string) {
  if (forbiddenSpecifier.test(path) || forbiddenPath.test(path.replaceAll('\\', '/')))
    throw new Error(
      `Forbidden render dependency: ${path}${importer ? ` (imported by ${relative(root, importer)})` : ''}`,
    )
}

const boundary: Plugin = {
  name: 'render-entry-boundary',
  setup(context) {
    context.onResolve({ filter: /.*/ }, async (args) => {
      if (args.pluginData?.boundaryChecked) return
      rejectForbidden(args.path, args.importer)
      const result = await context.resolve(args.path, {
        kind: args.kind,
        resolveDir: args.resolveDir,
        importer: args.importer,
        pluginData: { boundaryChecked: true },
      })
      if (result.errors.length) return result
      rejectForbidden(result.path, args.importer)
      if (result.path && !result.external && result.namespace === 'file')
        rejectForbidden(realpathSync(result.path), args.importer)
      if (result.external) throw new Error(`Uninspected external render dependency: ${args.path}`)
      return { ...result, pluginData: undefined }
    })
  },
}

// A computed import()/require() is invisible to the resolver hook; this
// package's own modules must reach the render graph through literal imports.
function rejectComputedLoads(path: string) {
  const file = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true)
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression
      const isLoad =
        callee.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(callee) && callee.text === 'require')
      const arg = node.arguments[0]
      if (isLoad && !(arg && (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg))))
        throw new Error(`Computed import()/require() in ${relative(root, path)}`)
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
}

function bundle(entryPoints: Record<string, string>, plugins: Plugin[] = []) {
  return build({
    absWorkingDir: root,
    entryPoints,
    bundle: true,
    platform: 'browser',
    format: 'esm',
    splitting: true,
    metafile: true,
    write: false,
    outdir: resolve(root, '.render-entry-check'),
    logLevel: 'silent',
    plugins: [boundary, ...plugins],
  })
}

async function expectRejected(label: string, run: () => Promise<unknown>) {
  try {
    await run()
  } catch (error) {
    if (String(error).includes('Forbidden render dependency:')) return
    throw error
  }
  throw new Error(`Boundary self-test accepted ${label}`)
}

function probe(source: string): Plugin {
  return {
    name: 'probe',
    setup(context) {
      context.onResolve({ filter: /^render-probe$/ }, () => ({ path: 'probe', namespace: 'probe' }))
      context.onLoad({ filter: /.*/, namespace: 'probe' }, () => ({
        contents: source,
        resolveDir: root,
      }))
    },
  }
}

for (const dependency of ['@pascal-app/editor', 'next/navigation']) {
  for (const source of [
    `import '${dependency}'`,
    `export const lazy = () => import('${dependency}')`,
  ]) {
    await expectRejected(source, () => bundle({ probe: 'render-probe' }, [probe(source)]))
  }
}

const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
const exportPath = (key: string): string => {
  const entry = manifest.exports?.[key]
  const path = typeof entry === 'string' ? entry : entry?.default
  if (!path) throw new Error(`package.json has no "${key}" export`)
  return resolve(root, path)
}

await expectRejected('the package root', () => bundle({ root: exportPath('.') }))

const result = await bundle({ render: exportPath('./render') }).catch((error: unknown) => {
  const errors = (error as { errors?: { text: string }[] }).errors
  console.error(errors?.map((e) => e.text).join('\n') ?? String(error))
  process.exit(1)
})
let ownModules = 0
for (const input of Object.keys(result.metafile.inputs)) {
  rejectForbidden(input)
  const path = resolve(root, input)
  if (path.startsWith(`${ownSource}/`)) {
    rejectComputedLoads(path)
    ownModules++
  }
}
if (ownModules === 0) throw new Error('No package modules reached the render bundle')
for (const [path, output] of Object.entries(result.metafile.outputs)) {
  for (const dependency of output.imports) {
    rejectForbidden(dependency.path)
    if (dependency.external) throw new Error(`External dependency in ${path}: ${dependency.path}`)
  }
}

const bytes = result.outputFiles.reduce((sum, file) => sum + file.contents.byteLength, 0)
console.log('Boundary self-tests passed (editor and next probes, package root rejected)')
console.log(
  `./render: ${ownModules} package modules, ${Object.keys(result.metafile.inputs).length} inputs, ${bytes} bytes across ${result.outputFiles.length} chunks — no @pascal-app/editor or next`,
)
