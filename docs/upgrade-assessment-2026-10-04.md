# InkTime 0.2.0 升级与测试版交付记录

核对日期：2026-10-04。用户已批准先验收 Mac 性能与核心体验，再验收 Windows 11 x64 主屏版本。代码与安装包已准备；阶段验收尚未全部通过。用户追加授权公开发布，现已发布 [v0.2.0-beta.1 预发布测试版](https://github.com/niiwei/inktime-gallery/releases/tag/v0.2.0-beta.1)，不标记全面验收完成。

## 已确定的范围

保留米白、绿色、夕阳品牌；保留 Ollama、现有云接口、JPEG/PNG/WebP、模型调用方式和默认并发。本轮不增加 HEIC、智能搜索、语义相册、云同步、Windows ARM64、多屏独立壁纸、签名或自动更新。原始照片和既有未提交文件不修改。

结构约定先更新于 `AGENTS.md`。运行数据仍使用 Electron 用户目录；开发数据库和私人生成物不进入安装包。

## 实现与验收对应

| 计划 | 实现 | 目前证据 |
| --- | --- | --- |
| 图库性能 | SQL 分页/组合筛选/稳定排序，默认60张；缩略图缓存、懒加载、虚拟列表，详情大图 | 真实1千照片扫描/缩略图/API/浏览器基准与合成1万库基准；真实万张验收待补 |
| 增量扫描/保存 | 文件尺寸/mtime复用特征；事务外图片读取，50项短事务写入；逐图 upsert；任务结束统一分组，时间窗口比较 | 重复扫描不重算、源文件变化、旧结果保留测试通过 |
| 恢复队列 | SQLite任务/任务项/配置快照/持久扫描报告/分析、文案、渲染检查点；源版本和配置匹配才复用 | 分析后和渲染中强退恢复不重复已保存模型调用；暂停取消、失败重试通过；全部阶段中断矩阵待补 |
| 后台行为 | 隐藏窗口继续，退出中止请求并暂停；重启提示自主恢复；壁纸独立入口 | 打包Mac关闭/退出/重启测试通过 |
| 数据升级 | schema版本3；首次迁移一致性备份；应用内备份/恢复/缺失文件检查 | 旧schema、原ID、精选、历史保留；恢复后队列可继续 |
| 核心体验 | 回看/照片管理/任务/壁纸/设置；导入试处理；跨页选中与全部筛选选择；人工文案、日期、地点；代表图/拆组；跳过图可强制处理 | 浏览器实际渲染、跨页选择、详情、布局预览和备份入口通过；完整键盘/缩放/对比度矩阵待补 |
| 布局与字体 | 会话撤销、对齐、单图预览；模板保存与批量任务分开；Noto中文字体及OFL许可，旧模板不改写，字体不可用回退 | Sharp真实输出、随包字体加载通过；Windows渲染待实机 |
| 壁纸 | 排除最近7次，候选不足逐步放宽；排除标记；状态/历史/下一次时间/比例预览；平台回读成功才记历史 | Mac两桌面真实设置/回读、退出后LaunchAgent独立执行、同周期补执行去重通过并恢复原壁纸；真实登录/唤醒待测 |
| Windows | IDesktopWallpaper PowerShell/C#桥接；主屏；当前用户交互Task Scheduler；登录/唤醒/整点入口；卸载移除任务 | 源码/资源审查与NSIS生成通过；全部Windows实机验收待执行 |

## 可复验入口与已执行结果

- `npm test`：17项集成/迁移/资源与壁纸路径测试通过。
- `npm run build`：TypeScript和Vite通过。`/fonts` 构建提示是运行时静态路由，打包Mac实际字体渲染已验证。
- `node tests/benchmark.js upgraded`：对比初始版本，同一合成万张库响应约7.3 MB降至49 KB，筛选P95约83 ms降至13 ms。证据 `tmp/upgrade/benchmark-baseline.json`、`benchmark-upgraded.json`。
- `node tests/browser-smoke.js`：真实Chrome、临时SQLite、合成重复图；冷缓存清理后1千首屏86/82 ms，1万85/69 ms（冷/热），只挂载20张可见卡片，无页面错误。证据 `tmp/upgrade/browser-metrics.json` 与截图。
- `node tests/real-library-benchmark.js`：配置目录中1328张真实照片取固定1000张，以临时符号链接和数据库测试，原图不修改；首次扫描16790 ms、重复70 ms（1000张全部复用）、缩略图生成7864 ms、筛选P95 3.45 ms、浏览器冷/热首屏186/83 ms，滚动前后只挂载20张。处理结果元数据为模拟内容，不调用模型，不留私人照片截图。证据 `tmp/upgrade/real-library-metrics.json`。
- `node tests/desktop-smoke.js`：打包Mac最新自动化启动1822 ms（内部窗口创建284 ms），真实Sharp渲染、关窗继续、退出暂停、重启恢复。隔离用户数据、禁用系统调度。证据 `tmp/upgrade/desktop-metrics.json`。
- `node tests/live-model-smoke.js`：已安装Qwen3-VL-8B模型对合成PNG真实分析/文案/渲染成功，20.6秒，2803 tokens。不自动下载模型。证据 `tmp/upgrade/live-model-metrics.json`。
- `INKTIME_TEST_SYSTEM_WALLPAPER=1 node tests/mac-wallpaper-smoke.js`：Mac真实壁纸设置与回读、确认后记录历史通过；两个桌面原壁纸已逐一恢复并核对。未改变现有定时任务。证据 `tmp/upgrade/mac-wallpaper-metrics.json`。

- `INKTIME_TEST_SYSTEM_WALLPAPER=1 node tests/mac-scheduler-smoke.js`：临时LaunchAgent在API退出后运行打包应用的独立入口，真实设置与回读、同周期再次触发不重复执行、不启动AI通过；原壁纸恢复并核对，测试任务移除。应用用 `ditto` 复制到隔离目录，避免从受保护的Documents仓库后台运行触发权限等待；正式安装应放Applications。生产LaunchAgent包含RunAtLoad与Aqua会话限制，真实登录/唤醒仍待测。证据 `tmp/upgrade/mac-scheduler-metrics.json`。

这些数值是当前机器上的局部证据，不能替代真实万张照片库、干净安装或Windows实机验收。打包冷启动有波动，曾有空库引导启动超过2秒，最新内部日志窗口创建284 ms、自动化启动1822 ms；尚未完成真实万张库性能验收，不以空库替代。Mac启动数字包含应用进程启动与首个空图库引导页面，浏览器数字只测页面导航，二者不能混用。正式性能目标保持首屏可操作≤2秒、筛选P95≤300 ms。

## 安装包与发布状态

本地产物（Git忽略）与 Release 下载：

- `release/InkTime Gallery-0.2.0-arm64.dmg`：Apple Silicon Mac。
- `release/windows/InkTime Gallery Setup 0.2.0.exe`：Windows11 x64 NSIS。

安装包资源已核对：没有SQLite/开发库/本地环境文件，字体、独立脚本、平台桥接齐全；Windows包包含win32 x64 Sharp原生模块和libvips DLL。SHA256留存在 `tmp/upgrade/installers.json`，本次最终产物如下：

| 安装包 | SHA256 |
| --- | --- |
| .dmg | `a26d3598536fc8de10b914340b69e80675f494f506d2ab94b6403c34b3ff3ef1` |
| .exe | `40d400e344f8419ca1bd4af03430f0bf301165473b7cb25c3fbeacbd725d1cdf` |

Mac通过 `npm run electron:dist -- --publish never` 构建。Windows本地使用独立win32依赖目录交叉构建，跳过可执行文件资源编辑；安装包已生成，但程序EXE图标/内部元数据仍应由Windows runner重新生成并核验。`.github/workflows/build.yml` 已配置macOS/Windows原生runner、API测试与两平台安装包构建，已触发远端运行，两平台测试步骤通过，原生打包结果见 [CI 运行](https://github.com/niiwei/inktime-gallery/actions/runs/37199131723)。

两个包均未签名，可能出现系统来源提示。测试版不接自动更新。安装包排除开发数据库、私人生成物和测试目录；升级不替换用户库。

## 安装与恢复

1. 升级前退出旧版，复制用户目录作为完整回退副本；应用内SQLite备份只覆盖台账，不包含原图和派生图。旧版没有备份入口时，可在退出后复制整个用户目录。
2. Mac打开DMG，将App拖入Applications；Windows运行NSIS，按当前用户安装。不要同时启动新旧版。
3. 启动Ollama或配置既有云接口；选择原生目录，检查模型，试处理3张。新安装自动轮换默认关闭，由用户在设置中开启。
4. 旧SQLite首次升级会在 `data/backups/pre-upgrade-*.sqlite` 保存一致性备份。ID、精选、分组及壁纸历史保留。
5. 设置中可创建备份、恢复和检查缺失文件。恢复前暂停并等待活动请求结束；恢复会先备份当前台账，重启/刷新后检查数据。缺失派生图可独立重渲染，源图离线先恢复路径。
6. 如需回退旧版，先退出应用，再恢复升级前的完整用户目录；不要只替换仍带WAL的数据库文件。

用户目录：Mac `~/Library/Application Support/inktime-gallery/`；Windows通常 `%APPDATA%/inktime-gallery/`，以Electron `userData` 为准。Windows卸载移除壁纸计划任务并保留用户数据；Mac移除App前先关闭自动轮换。

## 差异审查

已按规则与批准需求进行两路只读审查。修复了打包资源重复unpacked、Windows计划XML顺序、变化源未重新处理、来源集合过滤、日期范围、壁纸池/历史预览和失败重跑状态隐藏等问题；回归测试覆盖对应行为。简化迁移单元样例之外，补了完整旧SQLite schema的端到端迁移与后续操作测试。

## 剩余验收与已知限制

- Mac：真实1万照片库冷/热启动、滚动/进程内存与扫描耗时；分析/文案/渲染各阶段强退；真实登录/唤醒系统自动轮换；干净安装、升级保留数据。
- Windows11 x64：干净安装、中文空格路径、Sharp/SQLite/字体、实际照片处理、主屏缩放、壁纸COM回读、登录/唤醒补执行、禁用和卸载移除任务、升级保留库。需要用户提供实机执行入口或安装反馈。
- 完整交互：全部筛选任务集合固定、Shift/Cmd/Ctrl、代表图修正、撤销、键盘焦点、缩放与对比度须补完整矩阵。
- 仓库原有 `reference/InkTime/data/world_cities_zh.csv` 缺失；GPS城市映射目前回退为无城市信息，EXIF已有地点仍可用，也可人工修正。本轮未下载来源/许可未知的数据。
- 渲染临时目录在启动时清理半成品；极窄的文件移入正式目录到数据库提交窗口内强退，仍可能留下未引用的完整图片对。旧结果不会被替换，历史输出暂不自动清理。
- 暂未签名、已公开预发布、未启用自动更新。真实设备验收通过前不标记本轮全面完成。

发布源码提交 `08c0466`，修复 Windows 壁纸别名路径比较；远端两个资产大小与 SHA256 已核对一致。

接口与架构见 `docs/architecture.md`。Windows桥接和调度契约对照 [IDesktopWallpaper](https://learn.microsoft.com/en-us/windows/win32/api/shobjidl_core/nn-shobjidl_core-idesktopwallpaper) 与 [Task Scheduler schema](https://learn.microsoft.com/en-us/windows/win32/taskschd/task-scheduler-schema)；官方文档核对不能替代实机运行。
