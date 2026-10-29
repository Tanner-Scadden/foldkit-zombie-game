// NOTE: the root package has no Bun types, so this declares the slice of
// the Bun global that the spike uses.
declare namespace Bun {
  type OnResolveArgs = { path: string; importer: string }
  type OnLoadArgs = { path: string }
  type PluginBuilder = {
    onResolve(
      options: { filter: RegExp },
      callback: (args: OnResolveArgs) => { path: string; namespace: string },
    ): void
    onLoad(
      options: { filter: RegExp; namespace: string },
      callback: (args: OnLoadArgs) => { contents: string; loader: 'js' },
    ): void
  }
  type BunPlugin = { name: string; setup(build: PluginBuilder): void }
  type BuildOutput = {
    success: boolean
    logs: ReadonlyArray<unknown>
    outputs: ReadonlyArray<{ size: number }>
    metafile?: { inputs: Record<string, unknown> }
  }
  function build(options: {
    entrypoints: Array<string>
    outdir: string
    target: 'node' | 'browser'
    format: 'esm'
    minify: boolean
    metafile: boolean
    plugins: Array<BunPlugin>
    define: Record<string, string>
  }): Promise<BuildOutput>
}
