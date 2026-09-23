// xiv-api-provider 在 Node 构建期把 `readSheet`/`parseSheetCsv` 走的那条 csv-parse 路径外部化成
// `import { parse } from "csv-parse/sync"`;而 csv-parse 顶层用 Node 的 `Buffer` 造 BOM 常量,一旦进 IIFE
// 浏览器产物就会在加载时抛 `ReferenceError: Buffer is not defined`。本 userscript 从不调用那条路径,故在
// vite.config 里把 `csv-parse/sync` 指向这个空壳,确保 Node 全局不进包、也不掩盖真实的解析需求。
export const parse = (): never => {
  throw new Error('csv-parse is unavailable in the browser build (the userscript never reads datamine CSV at runtime)');
};

export default parse;
