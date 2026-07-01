# InkTime Replica Workspace Guide

## Language
- 默认中文沟通；代码、命令、变量名使用英文。

## Project Shape
- `reference/InkTime/`: 上游参考仓库，只读研究使用，不在其中实现新功能。
- `electron/`: Electron macOS 外壳、托盘菜单、LaunchAgent 管理和运行时目录初始化。
- `server/`: 内嵌 Express 服务，负责配置、SQLite、模型调用、渲染、壁纸和处理队列。
- `src/`: React 前端源码。
- `src/core/`: 图片评分、推荐理由、布局计算、渲染管线等与 UI 无关的核心逻辑。
- `src/ui/`: 前端页面、组件和交互。
- `src/data/`: 示例数据、类型定义、静态 mock。
- `config/`: 默认配置；打包 App 运行时会复制到 `~/Library/Application Support/inktime-gallery/config/`。
- `data/`: 开发态数据库、渲染图和壁纸输出；打包 App 运行时使用用户目录下的 `data/`。
- `public/samples/`: 本地样例图片。
- `docs/`: 设计记录、上游阅读笔记和实现取舍。

## Naming
- TypeScript/JavaScript 文件使用 `kebab-case`。
- React 组件使用 `PascalCase.tsx`。
- 核心函数使用清晰动词短语，如 `scoreImage`, `renderLayout`, `buildGalleryItems`。
- 图片和生成物文件名使用小写短横线，必要时加日期或序号。

## Implementation Rules
- 先读参考实现，再写本项目代码；复刻需求只保留图片评分、推荐理由、布局渲染和画廊展示。
- 不实现墨水屏色彩抖动、灰阶适配或硬件相关能力，除非后续明确要求。
- UI 通过 `/api/*` 调用内嵌服务；模型调用、SQLite、渲染和壁纸副作用放在 `server/` 或 `electron/`，不要写进组件。
- 保持改动外科手术式：不做未请求的扩展、不提前抽象。

## Verification
- 每次功能改动后至少运行可用的 lint/build/test 之一。
- 若引入图片渲染能力，必须用本地样例验证输出图片能生成并在画廊中显示。
