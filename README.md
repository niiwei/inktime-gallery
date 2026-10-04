<div align="center">
  <img src="public/brand/inktime-mark.svg" alt="InkTime Gallery logo" width="96" height="96">

  # AI 照片画廊 InkTime Gallery

  简体中文 | [English](README.en.md)

  把本地相册里真正值得回看的照片，变成一座会自己更新的回忆画廊。

  [![Build](https://github.com/niiwei/inktime-gallery/actions/workflows/build.yml/badge.svg)](https://github.com/niiwei/inktime-gallery/actions/workflows/build.yml)
  [![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
  [![macOS](https://img.shields.io/badge/macOS-Apple%20Silicon-black.svg)](#下载安装)
  [![Windows](https://img.shields.io/badge/Windows-11%20x64-0078d4.svg)](#下载安装)
  [![Ollama](https://img.shields.io/badge/Ollama-ready-0f766e.svg)](#本地模型)
</div>

![InkTime Gallery 画廊主界面](docs/images/gallery-main.png)

## 为什么做它

相册越堆越多，真正值得回看的照片反而沉在截图、连拍、饭菜、票据和随手保存里。等你想起整理，已经不知道从哪张开始。

InkTime Gallery 是一个本地优先的照片回忆助手。它扫描你指定的图片文件夹，让视觉模型帮你找出值得重新看见的瞬间，写一句克制的中文短句，生成相框图和桌面壁纸，并按整点自动轮换。0.2.0 开始准备 macOS 与 Windows 11 x64 测试版共用底座。

它不要求你把私人照片上传到云相册，也不需要维护一套远程服务。照片、数据库、渲染图和壁纸历史都放在本机；如果你选择本地 Ollama 模型，读图过程也可以完全在本机完成。

## 0.2.0 测试版状态

当前版本已经包含分页图库、缩略图与可见区域渲染、回看／照片管理／任务／壁纸／设置导航、可恢复任务队列、人工结果编辑、分组修正、备份恢复和跨平台打包入口。Node API 隔离测试 17/17 通过，前端构建通过；浏览器 smoke 使用真实 Chrome 和临时数据库，覆盖导入试处理、详情、布局预览、跨页选择和备份入口，并记录 1 千／1 万张合成重复图片样本的首屏冷／热耗时 89/68 ms、72/69 ms（20 张卡片挂载、无页面错误）。

已发布预发布测试版，固定1000张真实照片基准已完成，真实万张验收仍待补齐；macOS 登录/唤醒调度和 Windows 11 x64 安装、主屏壁纸、登录唤醒、升级卸载仍需在对应设备验收。当前不包含 HEIC、云同步、Windows ARM64、多屏独立壁纸、智能搜索或自动更新。

## 它能做什么

| 能力 | 你会得到什么 |
| --- | --- |
| 回忆度评分 | 不是判断照片“好不好看”，而是判断它和生活、人物、地点、事件的连接有多强。 |
| 戳心短句 | 为每张照片补一句克制、自然、有余味的中文短句，让普通照片也多一点回看的入口。 |
| 画廊管理 | 分页、服务端筛选和缩略图把全部图片、代表照片、AI 处理结果、精选照片、跳过和失败状态放进同一个清晰画廊。 |
| 可恢复任务 | 处理任务写入 SQLite，支持暂停、继续、取消、失败重试，重启后继续查看任务。 |
| 自由编辑 | 相框布局支持拖拽、缩放、删除图层和保存模板，不再只能手填数字。 |
| 结果修正 | 可修改短句、日期和地点，更换连拍代表、拆分分组、排除壁纸，并保留人工修改。 |
| API / 本地模型接入 | 支持 OpenAI 兼容 API，也支持 Ollama 等本地视觉模型，隐私和效果可以自己取舍。 |
| 桌面壁纸轮播 | 从精选或 AI 处理后的照片里生成桌面壁纸，并按整点自动切换；Windows 版本暂以主屏测试为目标。 |
| 相框渲染 | 把照片、标题、日期和短句渲染成完整相框图，适合收藏、分享或设为壁纸。 |

## 产品预览

### 画廊与详情

| 精选照片画廊 | 照片详情页 |
| --- | --- |
| <img src="docs/images/gallery-main.png" alt="InkTime Gallery 精选照片画廊" width="420"> | <img src="docs/images/photo-detail.png" alt="InkTime Gallery 照片详情页" width="420"> |

### 设置与提示词

| 模型设置 | 提示词设置 |
| --- | --- |
| <img src="docs/images/model-settings.png" alt="InkTime Gallery 模型设置" width="360"> | <img src="docs/images/prompt-settings.png" alt="InkTime Gallery 提示词设置" width="360"> |

### 相框与壁纸

| 相框布局编辑器 | Mac 壁纸效果 |
| --- | --- |
| <img src="docs/images/layout-editor.png" alt="InkTime Gallery 相框布局编辑器" width="420"> | <img src="docs/images/mac-wallpaper.png" alt="InkTime Gallery Mac 壁纸效果" width="420"> |

## 下载安装

0.2.0-beta.1 已公开发布为预发布测试版，包含 Mac 与 Windows 安装包：

- [下载 InkTime Gallery](https://github.com/niiwei/inktime-gallery/releases/tag/v0.2.0-beta.1)

当前 0.2.0 测试版说明：

- macOS 构建目标为 Apple Silicon DMG，Windows 构建目标为 Windows 11 x64 NSIS；CI 已配置两种构建，Windows 实机验收仍待完成。
- 构建未签名，首次打开时可能需要在系统安全设置中手动允许运行。
- 测试版暂不提供自动更新。升级前请在设置中创建备份。
- 如果使用本地模型，需要先安装并启动 [Ollama](https://ollama.com/)。

## 快速开始

0.2.0 测试包与验收记录见 [升级记录](docs/upgrade-assessment-2026-10-04.md)。

普通用户：

1. 从 [Releases](https://github.com/niiwei/inktime-gallery/releases) 下载对应平台的测试版安装包，选择 `v0.2.0-beta.1`。
2. macOS 打开 DMG，把 `InkTime Gallery.app` 拖进 `Applications`；Windows 运行 NSIS 安装包并选择安装目录。
3. 启动 Ollama，并确保本地视觉模型已经可用。
4. 打开 InkTime Gallery，选择照片目录，检查模型配置，先试处理 3 张，再自主开始批量处理或开启自动壁纸。

### 数据备份与恢复

运行数据位于 Electron 用户数据目录。macOS 默认是 `~/Library/Application Support/inktime-gallery/`；Windows 默认由 Electron 的 `app.getPath('userData')` 决定，通常位于当前用户的 `%APPDATA%/inktime-gallery/`。不要把仓库里的开发 `data/` 当作安装后的用户库。

升级前退出旧版并复制整个用户目录作为完整回退副本；新版也可在“设置”中创建SQLite台账备份（不含照片文件）；备份完成后再替换安装包。恢复前暂停或退出处理任务，在“设置”中选择备份文件恢复，重启应用后检查精选、分组、壁纸历史和缺失文件提示。恢复动作不会重新下载模型，也不会删除原始照片。

测试版已验证隔离库的迁移、备份恢复和精选／历史保留；真实用户库操作前仍建议保留应用目录和原始照片的独立副本。

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

发送给 Ollama 的图片会先压到最长边 `1024px`，并使用 `num_ctx=8192`。如果要切换在线模型，可以参考 [.env.example](.env.example) 设置本地环境变量。不要把 `.env` 或 `.env.local` 提交到仓库。

## 运行方式

InkTime Gallery 不是两个应用，而是同一个应用的两种运行形态：

| 形态 | 适合谁 | 怎么理解 |
| --- | --- | --- |
| 开发模式 | 开发者 | 前端、本地 API、Electron 分开跑，方便调试。 |
| 打包 App | 普通用户 | macOS 使用 DMG，Windows 使用 NSIS x64 安装包；安装后启动 `InkTime Gallery`。 |

内部结构：

| 层 | 路径 | 作用 |
| --- | --- | --- |
| 桌面壳 | `electron/` | 启动跨平台窗口、托盘、运行时目录，并管理 macOS LaunchAgent 与 Windows 调度入口。 |
| 本地 API | `server/` | 负责配置、SQLite、分页扫描、模型调用、持久任务、渲染和壁纸副作用。 |
| 平台适配 | `server/platform/`、`scripts/windows/` | 复用壁纸选择逻辑，分别桥接 macOS 与 Windows 主屏壁纸和调度。 |
| 界面 | `src/ui/` | React 回看、照片管理、任务、壁纸、设置和布局编辑器。 |
| 后台脚本 | `scripts/` | 独立壁纸脚本及 Windows 安装／调度辅助脚本。 |
| 文档 | `docs/` | 架构、路线图、设计记录、上游阅读笔记。 |

打包后的运行数据不在仓库里，而在：

```text
~/Library/Application Support/inktime-gallery/config/
~/Library/Application Support/inktime-gallery/data/
# Windows: %APPDATA%/inktime-gallery/ (由 Electron 的 userData 决定)
```

仓库本身不包含你的私人照片、运行时 SQLite、渲染图片、壁纸图片、日志或本地环境变量。安装包也排除开发态 `data/`、`local-tests/` 和 `tmp/`。

## 自动换壁纸

自动换壁纸不是靠 App 一直挂着定时器，而是由系统调度负责。macOS 使用 `LaunchAgent`；Windows 测试版使用当前用户交互会话内的 Task Scheduler。

macOS 下 InkTime Gallery 会安装或更新这个系统任务：

```text
~/Library/LaunchAgents/com.inktime.gallery.wallpaper.plist
```

到了配置好的整点，macOS 会拉起应用的 `--wallpaper-once` 入口执行独立壁纸脚本。这个脚本直接读取运行时配置和 SQLite，设置壁纸后再核对当前 macOS 桌面路径，确认一致才写入 `wallpaper_history`。

Windows 调度和 `--wallpaper-once` 入口已随包提供，但登录、唤醒、错过整点后的单次补执行、设置并回读主屏壁纸，尚未在 Windows 11 x64 实机验收。macOS 真实壁纸设置与回读、退出后独立LaunchAgent执行及同周期去重已通过可恢复测试并还原原壁纸；真实登录/唤醒仍待验收。新安装自动轮换默认关闭。

## 开发命令

```bash
npm run dev            # 启动浏览器式开发服务
npm run electron:dev   # 启动 Electron 开发模式
npm run build          # 构建前端静态资源
npm run electron:pack  # 打包本地可运行的 macOS App
npm run electron:dist  # 构建可分发的 DMG
npm run electron:dist:win  # 在 Windows runner 上构建 NSIS x64 测试包
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
├── docs/                  # 架构、路线图、设计说明和 README 截图
└── reference/InkTime/     # dai-hongtao/InkTime 的本地只读参考副本
```

## 路线图

0.2.0 已完成持久化队列、分页图库、备份恢复和基础分组修正的代码与隔离验证。后续重点是固定样本库性能基准、真实 Mac 登录/唤醒验收、Windows 11 x64 安装与桌面验收，以及更好的相似照片质量筛选。

仍在规划中的方向包括更丰富的壁纸池、后台扫描、安静时段、按 run／日期／模型统计 token 和成本、修复派生文件，以及语义相册或智能搜索。HEIC、云同步、Windows ARM64、多屏独立壁纸、签名和自动更新不属于 0.2.0 测试版。

详细规划见 [docs/personal-roadmap.md](docs/personal-roadmap.md)。这个文件适合继续记录产品设计和未来规划。

## 参与贡献

欢迎提交 PR。开始之前请先阅读 [CONTRIBUTING.md](CONTRIBUTING.md)，并至少运行一次：

```bash
npm run build
```

## 许可证

项目使用 MIT License，详见 [LICENSE](LICENSE)。

## 致谢

- 参考项目：[dai-hongtao/InkTime](https://github.com/dai-hongtao/InkTime)
- README 结构参考：[Best-README-Template](https://github.com/othneildrew/Best-README-Template)
- Markdown 语法整理参考：[guodongxiaren/README](https://github.com/guodongxiaren/README)
