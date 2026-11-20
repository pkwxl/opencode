// A `with { type: "file" }` import resolves to the file's path string at
// runtime / in compiled artifacts.
declare module "*.md" {
  const path: string
  export default path
}

declare module "*.json" {
  const path: string
  export default path
}
// The spec's published doc (0280): the server-side protocol-doc ratchet
// reads it through the package's declared export — the specifier the only
// route from a shell (0196 D1), never a relative path.
declare module "@opencode-ai/auto-core/docs/protocol.md" {
  const text: string
  export default text
}
