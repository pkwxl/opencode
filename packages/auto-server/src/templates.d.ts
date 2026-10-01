// A `with { type: "file" }` import resolves to the file's path string at
// runtime and in the compiled output.
declare module "*.md" {
  const path: string
  export default path
}

declare module "*.json" {
  const path: string
  export default path
}
