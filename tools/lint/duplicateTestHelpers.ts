// NOTE: AGENTS.md "Code shape": test setup is shared, not copied. Fails when
// two test files declare the same top-level helper: the same name and the
// same body, laid out any way, where every top-level name the body reads (a
// constant or type of its own file, or an import) also means the same thing.
// So two
// `ticksFor`s that divide by a FRAME_MS of 16 and of 50 are different helpers,
// and two that divide by the same one are a copy.
//
// A helper here is a function, or a constant built from something: an object,
// an array, or a call (a Model, a spawn, a locator). Plain numbers, strings,
// and arithmetic on names (`FRAME_MS = 50`, `CENTER_X = PARLOUR.width / 2`)
// are a file's own tuning and may repeat.
//
// Files are compared within one code base: `src` and `tools` together (their
// shared helpers live in `src/testing.ts` and `src/model.fixture.ts`), each
// package under `packages/` (`test/fixtures.ts`), and `infra`
// (`worker/testing.ts`). The shared homes count as test files, so a copy of
// what is already shared fails as well.
//
//   bun tools/lint/duplicateTestHelpers.ts [root]

import { Glob } from 'bun'
import { dirname, join } from 'node:path'
import { parseSync } from 'oxc-parser'

// NOTE: the repository, or another checkout of it given as the argument.
const ROOT = join(
  process.argv[2] ?? new URL('../..', import.meta.url).pathname,
  '/',
)

const PATTERNS: ReadonlyArray<string> = [
  'src/**/*.test.ts',
  'tools/**/*.test.ts',
  'packages/*/test/**/*.test.ts',
  'infra/**/*.test.ts',
  // NOTE: the shared homes, so a test that copies what is already shared
  // fails too.
  'src/testing.ts',
  'src/model.fixture.ts',
  'packages/*/test/fixtures.ts',
  'infra/worker/testing.ts',
]

const groupOf = (file: string): string =>
  file.startsWith('packages/')
    ? file.split('/').slice(0, 2).join('/')
    : file.startsWith('infra/')
      ? 'infra'
      : 'src'

type Node = Readonly<{ type: string; start: number; end: number }> &
  Readonly<Record<string, unknown>>

const isNode = (value: unknown): value is Node =>
  typeof value === 'object' &&
  value !== null &&
  'type' in value &&
  typeof value.type === 'string'

const childrenOf = (node: Node): ReadonlyArray<Node> =>
  Object.values(node).flatMap(value =>
    Array.isArray(value) ? value.filter(isNode) : isNode(value) ? [value] : [],
  )

const namesIn = (node: Node): ReadonlySet<string> => {
  const names = new Set<string>()
  const visit = (current: Node): void => {
    if (current.type === 'Identifier' && typeof current['name'] === 'string') {
      names.add(current['name'])
    }
    // NOTE: `x.name` and `{ name: x }` do not read a binding called `name`.
    const skipped =
      (current.type === 'MemberExpression' && current['computed'] !== true) ||
      (current.type === 'Property' &&
        current['computed'] !== true &&
        current['shorthand'] !== true)
        ? (current['property'] ?? current['key'])
        : undefined
    childrenOf(current)
      .filter(child => child !== skipped)
      .forEach(visit)
  }
  visit(node)
  return names
}

// NOTE: a value with no structure of its own: a literal, a name, a member of
// a name, or arithmetic on those.
const isPlain = (node: Node): boolean => {
  switch (node.type) {
    case 'Literal':
    case 'Identifier':
      return true
    case 'TemplateLiteral':
      return (
        Array.isArray(node['expressions']) && node['expressions'].length === 0
      )
    case 'MemberExpression':
      return isNode(node['object']) && isPlain(node['object'])
    case 'UnaryExpression':
      return isNode(node['argument']) && isPlain(node['argument'])
    case 'BinaryExpression':
      return (
        isNode(node['left']) &&
        isPlain(node['left']) &&
        isNode(node['right']) &&
        isPlain(node['right'])
      )
    case 'TSAsExpression':
    case 'TSSatisfiesExpression':
      return isNode(node['expression']) && isPlain(node['expression'])
    default:
      return false
  }
}

type Declaration = Readonly<{ name: string; node: Node; line: number }>

type Helper = Readonly<{
  file: string
  name: string
  line: number
  key: string
}>

// NOTE: a relative import as a path from the root, so `./zombies` in src and
// `../../src/zombies` in tools name the same module.
const moduleOf = (file: string, source: string): string =>
  source.startsWith('.')
    ? join(dirname(file), source).replace(/\.(ts|js|mjs)$/, '')
    : source

const lineOf = (text: string, offset: number): number =>
  text.slice(0, offset).split('\n').length

const helpersOf = (file: string, text: string): ReadonlyArray<Helper> => {
  const { program } = parseSync(file, text)
  const declarations = new Map<string, Declaration>()
  const helperNames = new Set<string>()
  const imports = new Map<string, string>()

  for (const raw of program.body as unknown as ReadonlyArray<Node>) {
    const statement =
      raw.type === 'ExportNamedDeclaration' && isNode(raw['declaration'])
        ? raw['declaration']
        : raw
    if (statement.type === 'ImportDeclaration') {
      const source = (statement['source'] as Node)['value']
      for (const specifier of statement['specifiers'] as ReadonlyArray<Node>) {
        const local = (specifier['local'] as Node)['name'] as string
        const imported = isNode(specifier['imported'])
          ? String(
              specifier['imported']['name'] ?? specifier['imported']['value'],
            )
          : specifier.type
        imports.set(local, `${moduleOf(file, String(source))}#${imported}`)
      }
    }
    // NOTE: a type a helper names is part of what it means, but no helper.
    if (
      (statement.type === 'TSTypeAliasDeclaration' ||
        statement.type === 'TSInterfaceDeclaration') &&
      isNode(statement['id'])
    ) {
      const name = statement['id']['name'] as string
      declarations.set(name, {
        name,
        node: statement,
        line: lineOf(text, statement.start),
      })
    }
    if (statement.type === 'FunctionDeclaration' && isNode(statement['id'])) {
      const name = statement['id']['name'] as string
      declarations.set(name, {
        name,
        node: statement,
        line: lineOf(text, statement.start),
      })
      helperNames.add(name)
    }
    if (statement.type === 'VariableDeclaration') {
      for (const declarator of statement[
        'declarations'
      ] as ReadonlyArray<Node>) {
        const id = declarator['id']
        const init = declarator['init']
        if (isNode(id) && id.type === 'Identifier' && isNode(init)) {
          const name = id['name'] as string
          declarations.set(name, {
            name,
            node: init,
            line: lineOf(text, declarator.start),
          })
          if (!isPlain(init)) {
            helperNames.add(name)
          }
        }
      }
    }
  }

  const keys = new Map<string, string>()
  const keyOf = (name: string, seen: ReadonlySet<string>): string => {
    const known = keys.get(name)
    if (known !== undefined) {
      return known
    }
    const declaration = declarations.get(name)
    if (declaration === undefined) {
      return imports.get(name) ?? ''
    }
    if (seen.has(name)) {
      return `cycle:${name}`
    }
    const inner = new Set([...seen, name])
    const body = text
      .slice(declaration.node.start, declaration.node.end)
      .replace(/\s+/g, '')
      .replace(/,([)\]}>])/g, '$1')
    const meanings = [...namesIn(declaration.node)]
      .filter(other => other !== name)
      .filter(other => declarations.has(other) || imports.has(other))
      .sort()
      .map(other => `${other}=${keyOf(other, inner)}`)
    const key = [body, ...meanings].join('\n')
    keys.set(name, key)
    return key
  }

  return [...helperNames].map(name => ({
    file,
    name,
    line: declarations.get(name)?.line ?? 0,
    key: keyOf(name, new Set()),
  }))
}

const copies = new Map<string, Array<Helper>>()
for (const pattern of PATTERNS) {
  for await (const file of new Glob(pattern).scan({ cwd: ROOT })) {
    if (file.includes('node_modules')) {
      continue
    }
    const text = await Bun.file(`${ROOT}${file}`).text()
    for (const helper of helpersOf(file, text)) {
      const at = `${groupOf(file)}\n${helper.name}\n${helper.key}`
      copies.set(at, [...(copies.get(at) ?? []), helper])
    }
  }
}

const repeated = [...copies.values()]
  .filter(list => new Set(list.map(({ file }) => file)).size > 1)
  .sort((a, b) => (a[0]?.name ?? '').localeCompare(b[0]?.name ?? ''))

for (const list of repeated) {
  const [first, ...rest] = list
  console.error(
    `${first?.file}:${first?.line}: \`${first?.name}\` is copied in ${rest.map(({ file, line }) => `${file}:${line}`).join(', ')}`,
  )
}
if (repeated.length > 0) {
  console.error(
    `${repeated.length} test helper(s) copied between test files: share each from src/testing.ts or src/model.fixture.ts (a package's test/fixtures.ts, infra's worker/testing.ts).`,
  )
  process.exit(1)
}
