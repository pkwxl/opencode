// `with { type: "file" }` 导入在运行期/编译产物中解析为文件路径字符串。
declare module "*.md" {
  const path: string
  export default path
}

declare module "*.json" {
  const path: string
  export default path
}
