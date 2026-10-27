# generated

这个目录由 `rushx bake:statuses` 生成，**不要手改**，也不要把它加进 `.gitignore`。

- `statuses.json` —— 按 id 升序的 status 对照表，构建时被 `src/data/statuses.ts` import，Vite 会内联进产物。
- `statuses.meta.json` —— 上游 commit、国服版本、条目数与 `data.sha256`；只给烘焙/校验脚本读，不参与打包。

`statuses.json` 使用元组 + 稀疏例外，只存运行时需要的子集：

```json
{
  "rows": [[1191, "Rampart", 210152, "铁壁"]],
  "enNames": { "1892": "Neutral Sect" },
  "enIcons": { "1191": 213911 },
  "zhIcons": {}
}
```

- `rows`：`[id, upstream 名, upstream 图标, 国服名]`。`id` 是游戏 `Status` 表 row_id，不是 FFLogs 的 `+1,000,000` ID。
- `enNames`：en 名与 upstream 名不同的例外（比较时 trim + lowercase）。
- `enIcons`：en 图标与 upstream 图标不同的例外。
- `zhIcons`：国服图标与当前 en/upstream 图标不同的例外。

en 名与 en 图标未列例外时回落到 upstream；国服图标未列 `zhIcons` 时先回落到 en 图标（若有），再回落到 upstream。源文件保持 2 空格缩进；`vite.config.ts` 的 `json.stringify` 会把 import 转成紧凑的 `JSON.parse`，缩进不计入 bundle。运行时页面没有 row_id，先按 upstream name、再按 en name 匹配；同名多 id 时用 upstream/en/zh 图标消歧。告警只写 stderr，不进入 meta。

这两个文件在 `.gitattributes` 中固定为 LF，因为 `data.sha256` 按原始字节计算。更新后两个文件要一起提交。离线校验用 `rushx bake:statuses:verify`。
