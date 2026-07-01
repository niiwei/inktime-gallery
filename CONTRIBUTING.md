# Contributing

欢迎提交 issue、fork 和 pull request。

## Before You Open A PR

- 用 `npm install` 安装依赖
- 至少运行一次 `npm run build`
- 不要提交个人照片、`data/` 运行结果、`release/` 打包产物或 `.env.*`
- 如果改动影响到配置、壁纸调度、处理流程或数据结构，请同步更新 `README.md` 和 `docs/`

## Development Notes

- 开发态运行：`npm run dev`
- 桌面 App 开发运行：`npm run electron:dev`
- 本机打包：`npm run electron:pack`

## Pull Requests

- 保持改动聚焦，不顺手重构无关部分
- 新增行为请附上验证方式
- 涉及 UI、壁纸或处理流程改动时，请说明实际验证结果
