<div align="center">
  <img src="public/brand/inktime-mark.svg" alt="InkTime Gallery logo" width="96" height="96">

  # InkTime Gallery

  简体中文 | [English](README.en.md)

  把本地相册里真正值得回看的照片，变成一座会自己更新的回忆画廊。

  [![Build](https://github.com/niiwei/inktime/actions/workflows/build.yml/badge.svg)](https://github.com/niiwei/inktime/actions/workflows/build.yml)
  [![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
  [![macOS](https://img.shields.io/badge/macOS-Apple%20Silicon-black.svg)](#下载安装)
  [![Ollama](https://img.shields.io/badge/Ollama-ready-0f766e.svg)](#本地模型)
</div>

![InkTime Gallery 画廊主界面](docs/images/gallery-main.png)

## 为什么做它

相册越堆越多，真正值得回看的照片反而沉在截图、连拍、饭菜、票据和随手保存里。等你想起整理，已经不知道从哪张开始。

InkTime Gallery 是一个本地优先的 Mac 照片回忆助手。它扫描你指定的图片文件夹，让视觉模型帮你找出值得重新看见的瞬间，写一句克制的中文短句，生成相框图和 Mac 壁纸，并按整点自动轮换。

它不要求你把私人照片上传到云相册，也不需要维护一套远程服务。照片、数据库、渲染图和壁纸历史都放在你的 Mac 上；如果你选择本地 Ollama 模型，读图过程也可以完全在本机完成。

## 它能做什么

| 能力 | 你会得到什么 |
| --- | --- |
| 回忆度评分 | 不是判断照片“好不好看”，而是判断它和生活、人物、地点、事件的连接有多强。 |
| 戳心短句 | 为每张照片补一句克制、自然、有余味的中文短句，让普通照片也多一点回看的入口。 |
| 画廊管理 | 把全部图片、代表照片、AI 处理结果、精选照片、跳过和失败状态放进同一个清晰画廊。 |
| 自由编辑 | 相框布局支持拖拽、缩放、删除图层和保存模板，不再只能手填数字。 |
| API / 本地模型接入 | 支持 OpenAI 兼容 API，也支持 Ollama 等本地视觉模型，隐私和效果可以自己取舍。 |
| macOS 壁纸轮播 | 从精选或 AI 处理后的照片里生成 Mac 壁纸，并按整点自动切换。 |
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

普通用户推荐直接下载 GitHub Release：

- [下载 InkTime Gallery](https://github.com/niiwei/inktime/releases/latest)

当前版本说明：

- 目前主要面向 Apple Silicon Mac。
- 当前构建未签名，首次打开时可能需要在 macOS 安全设置中手动允许运行。
- 如果使用本地模型，需要先安装并启动 [Ollama](https://ollama.com/)。

## 快速开始

普通用户：

1. 从 [Releases](https://github.com/niiwei/inktime/releases) 下载 `InkTime Gallery.dmg`。
2. 打开 DMG，把 `InkTime Gallery.app` 拖进 `Applications`。
3. 启动 Ollama，并确保本地视觉模型已经可用。
4. 打开 InkTime Gallery，选择照片目录，先扫描，再处理选中的图片。

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
| 打包 App | 普通用户 | 下载 `InkTime Gallery.app` 或 `InkTime Gallery.dmg`，双击启动。 |

内部结构：

| 层 | 路径 | 作用 |
| --- | --- | --- |
| 桌面壳 | `electron/` | 启动 macOS 窗口、托盘、运行时目录、LaunchAgent 管理。 |
| 本地 API | `server/` | 负责配置、SQLite、扫描、模型调用、渲染和壁纸副作用。 |
| 界面 | `src/ui/` | React 画廊、设置、精选、布局编辑器。 |
| 后台脚本 | `scripts/` | 给 macOS `launchd` 用的独立壁纸脚本。 |
| 文档 | `docs/` | 架构、路线图、设计记录、上游阅读笔记。 |

打包后的运行数据不在仓库里，而在：

```text
~/Library/Application Support/inktime-gallery/config/
~/Library/Application Support/inktime-gallery/data/
```

仓库本身不包含你的私人照片、运行时 SQLite、渲染图片、壁纸图片、日志或本地环境变量。

## 自动换壁纸

自动换壁纸不是靠 App 一直挂着定时器，而是由 macOS `LaunchAgent` 负责。

InkTime Gallery 会安装或更新这个系统任务：

```text
~/Library/LaunchAgents/com.inktime.gallery.wallpaper.plist
```

到了配置好的整点，macOS 会拉起 `scripts/set-random-wallpaper.js`。这个脚本直接读取运行时配置和 SQLite，设置壁纸后再核对当前 macOS 桌面路径，确认一致才写入 `wallpaper_history`。

如果电脑正在睡眠，睡眠期间不会执行；机器醒来后，会等下一次系统触发点。

## 开发命令

```bash
npm run dev            # 启动浏览器式开发服务
npm run electron:dev   # 启动 Electron 开发模式
npm run build          # 构建前端静态资源
npm run electron:pack  # 打包本地可运行的 macOS App
npm run electron:dist  # 构建可分发的 DMG
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

- 大规模图片库的持久化处理队列。
- 更好的相似照片分组和代表图选择。
- 更丰富的壁纸池和质量筛选。
- 数据库备份、恢复、健康检查和修复。
- 按 run、日期、模型统计 token 和成本。

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
