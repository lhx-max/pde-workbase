# 四 App 部署候选与独立生图验收 · 2026-10-23

> 历史验收快照：以下为记录日期的结果和现场路径，不作为当前配置；不应重建已退役的数据目录。原始日志/会话不随源码交付，当前版本以发布清单为准。

当前交付为 App 自有代码与可部署制品的候选版本。正式 MA 登记、生产运行凭据、HTTPS 网关、逐用户模型 broker 和 MA 自主 Agent 工具桥仍须独立验收；没有实际 staging/生产部署。

| 检查 | 真实范围与证据 |
| --- | --- |
| 独立生图云存储 | 生图私有 `image_app_dev/app_runtime_state` 与 `image_assets_v2`；大文件完整上传、结果下载、独占运行锁、重启恢复。两个真实模型的 2K 方图均解码为 2048×2048；高清档另按模型原生尺寸验收：GPT 方图 2880×2880，Gemini 方图 4096×4096。见 `real-models.json` 与高清档独立证据 |
| 工具完整链路 | CPU 裁剪/调整/旋转、实际 VTracer；打光、多角度、定位修改、扩图、消除、重排、样机融合各一次真实 Gemini 调用。产物从生图私有桶回读并解码。四类未配置服务在受理前返回 503，任务与版本不变。见 `real-tools-final.json` |
| 失败与修复 | 特定原生 PNG 在旧 5MiB 分块中返回 500；精确 5,000,000 字节分块后，8,590,322 字节原件与完整 30,000,000 字节文件均逐字节读回一致。30,000,001 字节在写入前返回 413，版本和资产数不变。完整 multipart 只作为诊断：大文件受网关限制，因此最终运行入口固定为十进制 5MB 分块，未降低业务上限。未迁移资产索引、未采用 gzip 封装。见 `decimal-chunks-platform-proof.json`、`original-upload-cloud.json`、`original-size-boundary.json`。Root 同时对完整旋转结果做逐像素比较。源码调试入口曾缺编译 Worker；复验改用 dist，并验证 Linux 容器中的真实 Worker。保留首轮失败，不覆盖为全绿 |
| 编辑工程 | 自有资源路径的样机 JSON、编辑版本、稳定回执、精确重放、旧编辑版本拒绝及新进程恢复。见 `real-edit-cloud.json` |
| 画布引用 | Canvas 保存布局、完整目标资源引用与自己的回执；Image 保存配置、任务、工程、原件和结果。真实云端引用、预览字节/hash、重放、冲突、跨作用域拒绝与新服务恢复。Canvas 使用既有开发云 ACL，本项不证明生产私有 Canvas。见 `cloud-references.json` |
| 真实页面 | 从已安装的两个公开 surface 挂载页面，点击“放入画布”，真实画布显示产物；云端回读只含引用与画布字段。见 `canvas-reference.png`、`agent-image-root-readback.json` |
| 实际 Agent 调用 | Devin SWE2 发现已安装 CLI，提交旋转、等待完成、下载、精确重放；旧版本 409、外部实例 403。另一路从 Canvas CLI 读取引用，再使用 Image CLI 下载相同资产。Root 独立回读、哈希和像素验证。见 `agent-image-cli.json`、`agent-cross-app-read.json` 与对应 root-readback |
| 固定包消费 | 四个实际 tgz 在全新外部消费者安装、类型检查、浏览器打包/CSS和纯 Node 出口通过；Canvas 另做 `skipLibCheck=false` 声明检查和单 React 验证。见 `four-package-consumer.json` |
| 容器 | 四个 Linux amd64 镜像已真实构建；三服务非 root、缺配置拒绝、显式 local-test HTTP 启停、前端静态资源和 PDF/视频处理；Image 生产形态使用真实 HTTPS 协议 fixture，验证私钥文件挂载、首次 namespace 初始化命令、只读、双写者拒绝、原生 CPU/Worker、SIGTERM 与新进程恢复。见 `image-linux-amd64.json`、`three-app-linux-amd64.json` |

自动化回归：Image 244；Canvas 服务端 656 通过/1 条旧 cookie-gated live 测试跳过，独立 profile 同时拒绝旧生图入口及错误的 surface 输入；画布组件 262，Web 514；Doc 服务端 191、组件 7；Sketch 服务端 61、Web 34。各仓适用类型检查、Canvas guard、规范链接检查及 Web 生产构建均核验。跳过的旧 live 测试不计通过，独立真实云端探针单列留证。

`devin-model-audit.json` 记录使用的模型，仅 SWE2。外部 CLI Agent 成功不代表 MA 执行环境已经安装、发现或授权该工具。完整会话与真实凭据不进入本目录。

交付制品位于仓内 `artifacts/releases/20261023/`：固定 npm 包、镜像清单/源输入摘要、冻结 compose、镜像离线包和启动说明。该目录被 Git 忽略；源码分支与未提交工作保留，没有更新 main、推送或发布 npm。镜像与代码、包与真正宿主安装、开发云与生产 ACL、模拟身份与正式身份分别验收。

未配置能力为 GPU 放大、分层/OCR、自动曲面识别、透明背景模型；dense-b 编辑工程也不属于当前手动样机 JSON 合同。未声明它们已可用。已有用户数据和旧联调入口未迁移、未删除。

最终生产配置模板经纯配置检查通过，冻结 compose 与两个源码 compose 均在明确的外部文件下解析成功；四镜像离线包已实际 `docker load` 并比对镜像 ID。见 `deployment-config.json`、`image-archive-load.log`。这些检查没有启动真实生产环境。
