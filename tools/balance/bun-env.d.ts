// NOTE: Bun sets import.meta.main on the entry module. Node and vitest
// leave it undefined, so a module a test imports never runs its CLI.
interface ImportMeta {
  readonly main?: boolean
}
