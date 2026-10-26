# generated

这个目录由 `rushx bake:statuses` 生成，**不要手改**，也不要把它加进 `.gitignore`。

- `statuses.json` —— 构建时被 `src/data/statuses.ts` import 的纯数组，Vite 会内联进产物。
- `statuses.meta.json` —— 上游 commit、国服版本、条目数、`dataSha256`、告警与 `diagnostics.iconDrift`；只给烘焙/校验脚本读，不参与打包。

`statuses.json` 每条的 `id` 是游戏 `Status` 表 row_id，不是 FFLogs 的 `+1,000,000` ID；`iconId` 是上游 xivanalysis 的显示图标，不是国服 `Icon.id`。`diagnostics.iconDrift` 记录上游 icon 与当前游戏数据不一致的条目及其归属（同名行、旧图标、其他名称），只用于诊断，不参与运行时匹配。

更新后两个文件要一起提交。离线校验用 `rushx bake:statuses:verify`。
