---
name: rush-monorepo
description: 介绍rush项目中开发环境的注意事项以及工作流。
---

在基于 rush 的 monorepo 项目中，请使用 `rush.json` 中指定的包管理器进行包管理，检查并确认项目的主要开发语言、构建工具、格式化与代码检查工具、以及类型检查工具。代码编写时应遵循 es6 / typescript / oxlint 推荐的规范。

# 开发环境

本项目的开发环境中，请遵守以下原则：

- 请始终生成 Bash 命令，即便开发环境为 Windows，使用 Git Bash 或 WSL 进行执行，不要生成任何 PowerShell 命令。
- 请始终优先使用 `rush` / `rushx` / `rush-pnpm` 进行包管理与任务执行。不要使用 `npm` / `npx` / `yarn` / `pnpm` / `pnx` 等命令。`rushx` 命令应始终用于执行子项目的脚本，请确保在子项目目录下执行。
- 对于在任何位置生成临时验证脚本，或者修改已有的依赖项目的内部代码的情况，请在操作之前请求用户确认，并在验证完成后及时恢复原状。

# 工作流

对于任何功能修改或者问题修复，应该在修改后验证其正确性，如果未添加对应的测试任务，请在`package.json` 中的 `scripts` 部分添加相应的任务。主要手段从先到后包括：

- 格式化：执行 `rushx format`，使用 `oxfmt` 进行代码格式化。
- 单元测试：执行 `rushx test --run`，使用 `vitest` 进行测试。
- 代码检查：执行 `rushx lint`，使用 `oxc` 进行代码检查。
- 类型检查：执行 `rushx typecheck`，使用 `tsc` 进行类型检查。
