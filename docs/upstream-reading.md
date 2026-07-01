# InkTime Upstream Reading Notes

参考仓库：`reference/InkTime`

## Repository Map
- `analyze_photos.py`: 扫描相册，读取 EXIF，把图片转成 base64，调用 OpenAI 兼容 VLM，生成照片描述、类型、回忆度、美观度、理由、一句话文案，并写入 SQLite。
- `render_daily_photo.py`: 从 `photos.db` 读取评分结果，按“历史上的今天”选片，渲染 480x800 图片，再做四色墨水屏抖动并导出 `.bin` / `.h`。
- `render_daily_photo_133c.py`: 另一个屏幕尺寸/设备版本的渲染脚本。
- `server.py`: Flask 服务，提供 review WebUI、模拟器、图片静态读取、ESP32 下载 `.bin` 的接口。
- `esp32/`: ESP32 固件、屏幕驱动头文件、PCB 资料。复刻版当前不使用。
- `config-example.py`: 图片库路径、数据库路径、VLM API、WebUI、字体、输出目录、每日选片数量等配置。

## Data Model
核心表为 `photo_scores`，主键是图片路径。主要字段：
- `caption`: VLM 生成的画面描述。
- `type`: 人物、家庭、旅行、风景、美食、宠物、日常等类型。
- `memory_score`: 0-100 的回忆价值。
- `beauty_score`: 0-100 的美观程度。
- `reason`: 简短推荐理由。
- `side_caption`: 电子相框底部短句。
- `width` / `height` / `orientation`: 图片基础尺寸信息。
- `exif_json` 与拆分后的 EXIF 字段：拍摄时间、相机、GPS、城市等。

## Scoring Flow
`analyze_photos.py` 的评分由 VLM 完成：
1. 读取并压缩图片，必要时用 Pillow 处理 HEIC/EXIF 方向。
2. 提取 EXIF，包括时间、尺寸、相机参数、GPS。
3. VLM 输出严格 JSON：`caption`、`type`、`memory_score`、`beauty_score`、`reason`。
4. 再用一次 VLM 生成 `side_caption`。
5. 若照片 GPS 不在常驻地半径内，回忆度加 5 分。
6. 写入 `photo_scores`，支持断点续跑和并发处理。

## Selection And Rendering
`render_daily_photo.py` 的选择逻辑围绕电子相框：
1. 从 EXIF 日期提取 `MM-DD`。
2. 先找今天这个月日的高分照片。
3. 若没有超过阈值的候选，就按日期向前回溯。
4. 仍没有则用全局最高分兜底。
5. 渲染时用 480x800 画布，上方照片铺满裁剪，底部 100px 放文案、日期、地点。
6. 最后做四色墨水屏量化和 Floyd-Steinberg 抖动，导出 ESP32 可读取的 BIN。

## WebUI
`server.py` 的 review 页面直接拼 HTML：
- `/review`: 分页展示数据库照片，支持按日期和分数排序。
- `/sim`: 进入某张照片的墨水屏模拟器。
- `/sim_render`: 调用 `render_daily_photo.render_image` 后再抖动，返回 PNG。
- `/images/<path>`: 从相册目录安全读取原图。
- `/static/inktime/<key>/*.bin`: ESP32 下载入口。

## Replica Scope
本项目保留：
- 图片评分字段：回忆度、美观度、总分、推荐理由。
- 图片类型/标签与一句话说明。
- 铺满裁剪 + 底部信息区的图片渲染。
- Electron 桌面 App、前端画廊、SQLite 本地数据和 macOS 壁纸管理。

本项目暂不做：
- 墨水屏四色调色板。
- Floyd-Steinberg 抖动。
- `.bin` / `.h` 导出。
- ESP32 固件、下载密钥、定时刷新。
- “历史上的今天”自动选片。
