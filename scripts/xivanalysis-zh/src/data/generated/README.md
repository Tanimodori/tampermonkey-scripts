# generated

这个目录由 `rushx bake:statuses` 生成，**不要手改**，也不要把它加进 `.gitignore`。

- `statuses.json` —— 构建时被 `src/data/statuses.ts` import 的纯数组，Vite 会内联进产物。
- `statuses.meta.json` —— 上游 commit、国服版本、条目数、`dataSha256` 与告警；只给烘焙/校验脚本读，不参与打包。

更新后两个文件要一起提交。离线校验用 `rushx bake:statuses:verify`。
