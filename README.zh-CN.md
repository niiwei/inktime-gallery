<div align="center">
  <img src="public/brand/inktime-mark.svg" alt="InkTime logo" width="96" height="96">

  # InkTime Gallery

  [English](README.md) | 简体中文

  一个面向 macOS 的本地优先照片回忆画廊应用：把你自己的图片变成 AI 文案、相框渲染图和自动轮换的桌面壁纸。
</div>

## 项目简介

InkTime Gallery 是一个为个人照片库设计的 macOS 应用。它会扫描指定文件夹，把每张源图记录进 SQLite，再调用本地或 OpenAI 兼容视觉模型去判断照片的回忆价值，最后生成画廊卡片和 macOS 壁纸。

它的设计前提是“本地优先、私人使用”：你的照片、数据库、渲染结果和壁纸历史都保留在自己的机器上。

## 目录

- [核心能力](#核心能力)
- [下载安装](#下载安装)
- [快速开始](#快速开始)
- [本地模型](#本地模型)
- [运行方式](#运行方式)
- [开发命令](#开发命令)
- [项目结构](#项目结构)
- [路线图](#路线图)
- [参与贡献](#参与贡献)
- [许可证](#许可证)

## 核心能力

- 全量扫描本地图片目录，并为每张照片维护处理状态：`pending`、`processed`、`skipped`、`failed`、`processing`
- 默认支持本地 Ollama，也支持 OpenAI 兼容接口
- 自动生成中文描述、标签、回忆度、推荐理由和底部短句
- 支持全部源图、代表照片、AI 全部照片、精选照片四类画廊视图
- 提供类似 Figma 交互的相框布局编辑器，支持横图、竖图、方图模板
- 支持不重跑模型的重渲染
- 支持手动设置壁纸、随机换壁纸和系统级整点自动换壁纸
- 支持处理中止、详情页键盘切换、快捷键 `F` 加入精选

## 下载安装

普通用户推荐直接从 GitHub Releases 下载：

- `InkTime.dmg`

当前发布说明：

- 适用于 Apple Silicon Mac
- 当前构建未签名，首次打开时可能需要在 macOS 安全设置中手动允许运行

## 快速开始

普通用户：

1. 从 [Releases](https://github.com/niiwei/inktime/releases) 下载 `InkTime.dmg`
2. 打开 DMG，把 `InkTime.app` 拖进 `Applications`
3. 启动 Ollama，并确保本地视觉模型已经可用
4. 打开 InkTime，选择照片目录，先扫描，再处理选中的图片

开发者：

```bash
npm install
npm run electron:dev
```

## 本地模型

默认配置面向本地 Ollama：

```json
{
  "providerBaseUrl": "http://127.0.0.1:11434",
  "apiKeyEnvName": "",
  "model": "qwen3-vl:8b"
}
```

发送给 Ollama 的图片会先压到最长边 `1024px`，并使用 `num_ctx=8192`。

如果要切换在线模型，可以参考 [.env.example](.env.example) 设置本地环境变量。不要把 `.env` 或 `.env.local` 提交到仓库。

## 运行方式

InkTime 不是两个应用，而是**同一个应用的两种运行形态**：

- 开发时：像网页一样分开跑前端和本地服务，方便调试
- 正式使用时：打包成一个 `InkTime.app`，双击就能启动

内部结构可以理解成：

| 层 | 路径 | 作用 |
| --- | --- | --- |
| 桌面壳 | `electron/` | 启动 macOS 窗口、托盘、运行时目录、LaunchAgent 管理 |
| 本地 API | `server/` | 负责配置、SQLite、扫描、模型调用、渲染和壁纸副作用 |
| 界面 | `src/ui/` | React 画廊、设置、精选、布局编辑器 |
| 后台脚本 | `scripts/` | 给 macOS `launchd` 用的独立壁纸脚本 |
| 文档 | `docs/` | 架构、路线图、设计记录、上游阅读笔记 |

打包后的运行数据不在仓库里，而在：

```text
~/Library/Application Support/inktime-gallery/config/
~/Library/Application Support/inktime-gallery/data/
```

仓库本身不包含你的私人照片、运行时 SQLite、渲染图片、壁纸图片、日志或本地环境变量。

## 自动换壁纸

自动换壁纸不是靠 App 一直挂着定时器，而是由 macOS `LaunchAgent` 负责。

InkTime 会安装或更新这个系统任务：

```text
~/Library/LaunchAgents/com.inktime.gallery.wallpaper.plist
```

到了配置好的整点，macOS 会拉起 `scripts/set-random-wallpaper.js`。这个脚本直接读取运行时配置和 SQLite，设置壁纸后再核对当前 macOS 桌面路径，确认一致才写入 `wallpaper_history`。

如果电脑正在睡眠，睡眠期间不会执行，等机器醒来后再等待下一次触发点。

## 开发命令

启动浏览器式开发服务：

```bash
npm run dev
```

启动 Electron 开发模式：

```bash
npm run electron:dev
```

构建前端静态资源：

```bash
npm run build
```

打包本地可运行的 macOS App：

```bash
npm run electron:pack
```

构建可分发的 DMG：

```bash
npm run electron:dist
```

## 项目结构

```text
.
├── electron/              # Electron 主进程和 LaunchAgent 管理器
├── server/                # 内嵌 Express API 与本地处理逻辑
├── scripts/               # 独立壁纸自动化脚本
├── src/                   # React 应用和共享前端类型
├── config/                # 默认配置模板
├── assets/                # 应用图标和托盘资源
├── public/                # 静态资源
├── docs/                  # 架构、路线图、设计说明
└── reference/InkTime/     # 上游只读参考材料
```

## 路线图

- 大规模图片库的持久化处理队列
- 更好的连拍分组和代表图选择
- 更丰富的壁纸池和质量筛选
- 数据库备份、恢复、健康检查和修复
- 按 run、日期、模型统计 token 和成本

详细规划见 [docs/personal-roadmap.md](docs/personal-roadmap.md)。

## 参与贡献

欢迎提交 PR。开始之前请先阅读 [CONTRIBUTING.md](CONTRIBUTING.md)，并至少运行一次：

```bash
npm run build
```

## 许可证

项目使用 MIT License，详见 [LICENSE](LICENSE)。

## 致谢

- 上游参考项目：[InkTime](reference/InkTime/)
- README 结构参考：[Best-README-Template](https://github.com/othneildrew/Best-README-Template)
- Markdown 语法整理参考：[guodongxiaren/README](https://github.com/guodongxiaren/README)
