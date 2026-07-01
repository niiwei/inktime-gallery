# InkTime Gallery

这是一个面向本地相册的轻量复刻版 `InkTime`，当前重点是 Mac 桌面端的照片分析、信息渲染和壁纸管理：

- 全量扫描指定目录，维护 SQLite 源图台账和处理状态。
- 调用视觉模型生成中文描述、标签、回忆度、推荐理由和底部短句。
- 渲染带照片信息的相框图片与适配 Mac 桌面的壁纸图片。
- 在中文桌面 App 里查看全部源图、代表照片、AI 全部照片和精选照片。
- 支持可视化相框布局编辑、保存布局并重渲染。
- 支持随机/手动/整点自动设置 macOS 壁纸，壁纸来源可选代表照片、AI 全部照片或精选照片。
- 默认做工程预筛选，自动排除常见截图文件名和近重复/连拍备选图。

## 功能范围

当前项目聚焦这些能力：

- 本地目录扫描、SQLite 台账和处理状态管理
- 本地或兼容 OpenAI 接口的视觉模型分析
- 相框渲染图和 macOS 壁纸图生成
- 代表照片、AI 全部照片、精选照片三类图库浏览
- 可视化布局编辑与重渲染
- 随机/手动/定时设置 macOS 壁纸

当前版本不包含：

- 墨水屏色彩抖动
- `.bin` / `.h` 导出
- ESP32 固件与定时刷新

## 启动

```bash
npm install
npm run dev
```

打开 [http://127.0.0.1:5173](http://127.0.0.1:5173)

桌面 App 开发运行：

```bash
npm run electron:dev
```

打包本机可运行的 Mac App：

```bash
npm run electron:pack
```

## 配置

开发态默认配置在 [config/gallery.config.json](config/gallery.config.json)。仓库内的默认配置不会提交个人照片目录；如果 `imageDir` 留空，服务端会回退到当前用户的 `~/Pictures`。

打包后的 App 会把运行配置放在 `~/Library/Application Support/inktime-gallery/config/gallery.config.json`，也可以直接在 App 的“设置”面板中修改：

- 图片目录
- 模型接口地址（支持本地 Ollama，默认 `http://127.0.0.1:11434`）
- API Key 环境变量名（本地 Ollama 可留空）
- 模型与模型候选列表
- 截图剔除规则
- 每次处理上限
- 数据目录与数据库文件名
- 渲染尺寸
- 相框布局模板
- Mac 壁纸尺寸、壁纸来源与自动更换间隔
- 模型评分 Prompt

## 本地模型

默认面向本地 `ollama`：

```json
{
  "providerBaseUrl": "http://127.0.0.1:11434",
  "apiKeyEnvName": "",
  "model": "qwen3-vl:8b"
}
```

如果你改回在线模型，服务端会优先从本地 `.env.local` / `.env` 读取 API Key，不会在前端页面直接展示。本地视觉模型默认把图片压到最长边 1024px 再发给 Ollama，并使用 `num_ctx=8192`。

可以从 [.env.example](.env.example) 复制本地环境变量模板。不要把 `.env` 或 `.env.local` 提交到仓库。

## 数据持久化

开发态结果默认保存在 `data/`。打包 App 的运行结果默认保存在 `~/Library/Application Support/inktime-gallery/data/`：

- `data/gallery.sqlite`：SQLite 数据库，包含原始照片、AI 处理结果、精选照片和壁纸历史
- `data/renders/`：带照片信息的渲染图片
- `data/wallpapers/`：适配 macOS 桌面的壁纸图片

## 使用要点

- “扫描目录”只同步源图台账、计算文件哈希和感知哈希，不调用模型。
- “处理新图”会先刷新跳过状态，再只处理 `pending` 源图。
- “处理选中”可覆盖处理所选源图；停止按钮会中断正在等待的模型请求，已完成图片保留。
- “保存布局并重渲染”会保存当前相框模板并覆盖生成渲染图，不重新调用模型。
- 详情页支持 `←` / `→` 切换照片，`F` 加入或取消精选。
- 自动换壁纸由 macOS `LaunchAgent` 按整点触发；App 负责安装、更新和卸载该系统任务。

## 自动换壁纸

自动换壁纸任务文件位于：

- `~/Library/LaunchAgents/com.inktime.gallery.wallpaper.plist`

它会在整点拉起独立脚本 `scripts/set-random-wallpaper.js`。这个脚本直接读取运行时配置和 SQLite，不依赖 InkTime 窗口保持打开。

需要注意：

- 机器处于睡眠状态时，任务不会在睡眠中执行。
- 公开仓库不包含你的个人照片、运行时数据库或 `Application Support` 数据。
- 首次拉起桌面 App 后，InkTime 才会根据设置安装或刷新 `LaunchAgent`。

## 协作

- 贡献方式见 [CONTRIBUTING.md](CONTRIBUTING.md)
- 许可证见 [LICENSE](LICENSE)

## 文档

- [docs/architecture.md](docs/architecture.md)：当前架构、API、数据模型、处理和壁纸机制
- [docs/brand-system.md](docs/brand-system.md)：Logo、颜色与界面视觉规范
- [docs/personal-roadmap.md](docs/personal-roadmap.md)：个人长期使用路线图，包括大批量处理、连拍去重、壁纸池和 token 成本可视化
- [docs/upstream-reading.md](docs/upstream-reading.md)：上游 InkTime 仓库阅读笔记
