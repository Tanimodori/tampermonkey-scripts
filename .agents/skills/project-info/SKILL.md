---
name: project-info
description: 介绍项目的技术栈、构成与运行环境
---

# 技术栈

本项目为基于 rush 的 monorepo 项目，使用 pnpm@10 进行包管理，主要开发语言为 typeScript，使用 vite 作为构建工具，oxc 进行格式化与代码检查，tsc 进行类型检查。

# 项目构成

本项目主要包含以下几类子项目：

- 用于 Tampermonkey 的脚本。
- 用于 ffxiv logs 的脚本。
- 基于 Node.js 的后端服务。
- 其他辅助工具与脚本。

# 运行环境

本项目的运行环境如下：

- 脚本：Tampermonkey 脚本运行在浏览器环境中，需确保浏览器已安装 Tampermonkey 插件。
- 后端服务：运行于 Linux 的 docker-compose 容器中。
