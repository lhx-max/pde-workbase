# 四 App 的运行交付入口

画布、文档、草图、生图都是独立 Node 24 服务，分别使用各仓的部署制品；生图由生图仓 `Dockerfile.backend` 构建的独立后端承载，不再由画布服务兼任。`compose.acceptance.yml` 只管理 App 自有服务，MA/DA 的宿主、菜单、身份、目录登记和 Agent 调度继续由宿主负责。旧 Canvas Appwrite Function 目前仅公开健康和部分能力声明，业务调用明确返回未支持，不能当作本版完整后台使用。

## 准备与启动

四个仓库放在相邻目录，或设置 `CANVAS_SOURCE`、`DOC_SOURCE`、`SKETCH_SOURCE`、`IMAGE_SOURCE` 为完整源目录。`IMAGE_SOURCE` 默认指向相邻的 `designai-app-image` 正式仓检出；用候选工作树构建验收时显式覆盖该变量，文档与验收记录须分开标注候选来源和正式仓，不写本机绝对路径。运行配置模板见同目录 `canvas.env.example`、`doc.env.example`、草图仓 `deploy/staging.env.example` 和生图仓 `deployment/backend.env.example`；compose 路径模板见 `deployment.env.example`。模板的空动作授权表示只读，正式读写须填写明确批准的动作范围。分别设置 `CANVAS_RUNTIME_ENV`、`DOC_RUNTIME_ENV`、`SKETCH_RUNTIME_ENV`、`IMAGE_RUNTIME_ENV`，指向权限为 600 的运行配置文件；配置文件保存在仓库和镜像外。执行 `docker compose -f deployment/compose.acceptance.yml config --quiet` 检查，再 build 和 up。当前文件只向本机回环地址发布端口；平台提供稳定 HTTPS 网关、允许的精确 Origin 与资源鉴权桥。

生图服务默认向回环发布 `IMAGE_PORT`（默认 17466）；compose 的 `IMAGE_PORT` 同时决定容器监听与发布端口，并覆盖 env 文件中的同名值。除 env 文件外，生图还需要三个逐个只读挂载的外部文件，目标路径与生图仓 `deployment/compose.backend.yml` 一致：`IMAGE_APPWRITE_KEY_SOURCE` 挂到 `/run/secrets/image-appwrite-api-key`，`IMAGE_WRITE_GRANTS_SOURCE` 挂到 `/run/secrets/image-write-grants`，`IMAGE_MODEL_ADAPTER_SOURCE` 挂到 `/run/adapters/image-model.js`。源文件放在仓库外、权限受限的父目录中，逐文件只读授予容器 UID1000；密钥和授权配置不进入仓库、镜像或任何跟踪文件。`IMAGE_MODEL_ADAPTER` 是部署方安装的可信服务端模块，按逐已验证调用者返回模型凭据，模块本身不含凭据；仅交付 CPU/矢量能力的部署可在 env 中显式 `IMAGE_MODELS=disabled` 并在自己的部署覆盖文件中移除模型模块挂载（本验收 compose 仍要求三个文件），此时模型操作明确不可用，不能按模型验收口径报告。

## 生产配置

生产配置必须提供各自的 Appwrite endpoint/project/database/bucket、运行时 collection、服务端运行身份、MA authority、稳定 HTTPS 公网入口，以及精确的服务端动作授权。具体变量见各仓 entrypoint 与配置校验。画布还需 `CANVAS_RUNTIME_NAMESPACE`、`CANVAS_APPWRITE_SINGLE_WRITER=true`、`CANVAS_REPLICAS=1`；文档需 `DOC_RUNTIME_NAMESPACE`、`DOC_APPWRITE_SINGLE_WRITER=true`、`DOC_REPLICAS=1`；草图需 `SKETCH_APPWRITE_SINGLE_WRITER=true`、`SKETCH_REPLICAS=1`；生图需 `IMAGE_RUNTIME_NAMESPACE`、`IMAGE_MA_APPLICATION_ID`、`IMAGE_WRITE_GRANTS_FILE`、精确 Origin 白名单 `IMAGE_ALLOWED_ORIGINS`（不允许 `*`）、`IMAGE_APPWRITE_SINGLE_WRITER=true`、`IMAGE_REPLICAS=1`，服务端密钥经 `IMAGE_APPWRITE_API_KEY_FILE` 指向的文件提供。不能把维护 Cookie/Session 当生产运行身份，也不能把 MA 用户凭据当图片模型凭据。运行时 namespace 必须由显式的 schema/初始化步骤准备，不通过启动回退到本地。

画布通过 `CANVAS_IMAGE_APP_ORIGIN` 与 `CANVAS_IMAGE_APPLICATION_ID` 接入独立生图后端，两者必须同时配置。`CANVAS_IMAGE_APP_ORIGIN` 必须是不含凭据和路径的精确源，并逐项列入 `CANVAS_TRUSTED_APP_ORIGINS` 白名单；画布只向该白名单源转发已验证调用者的身份头，未列入即拒绝。生产环境该 origin 必须是画布容器可达的 HTTPS 网关地址，服务间 HTTP 在生产不受支持；仅非生产环境允许精确的 loopback HTTP origin。未配置时画布保持旧画布承载 profile，不登记独立生图端点。

接入独立生图后，画布只保存布局、完整目标作用域、工作区/资产/哈希/尺寸引用、自身投递回执和经认证的预览代理；不复制生图字节、配置、任务或编辑工程。生图字节、任务、回执与工程归生图后端及其私有库/桶，删除或撤权后迟到结果不得覆盖新内容。

生产入口只读检查业务及运行时 collection 为 `documentSecurity=true, $permissions=[]`，bucket 为 `fileSecurity=true, $permissions=[]`。应新建独立私有存储并配置服务端服务身份；旧开发 bucket/collection 的 users-read 不满足生产条件，不自动改 ACL。生图开发资源 `image_app_dev`/`app_runtime_state` 与 `image_assets_v2` 已于 2026-10-23 核验为私有（集合/桶授权为空）；该核验只覆盖开发环境，生产仍须独立预置与核验。当前内部云是否提供适用的稳定运行身份及 Node 服务环境，需要平台提供并实测；镜像能构建不证明这些条件已具备。

业务数据和恢复映射以云端为权威；`/tmp` 只保存可丢弃的预览、编码和工作文件。本配置不挂业务本地盘、不包含登录态或密钥。显式 `local-test` 仅供隔离制品检查，不能作为云端验收。

## 首次私有资源初始化

使用[私有存储初始化工具](private-storage-bootstrap.zh-CN.md)交付的独立 Node 24 制品，先生成无 I/O 计划，再按资源负责人批准的 ID 和 schema 管理身份执行只读核查及显式创建。工具覆盖四 App 的业务集合、适用索引、私有桶和 namespace；属性/索引未 available、归属或策略不符、已有写者时拒绝。旧开发 `scripts/appwrite-provision.sh` 不能用于 staging/生产。初始化工具与运行服务使用不同用途的凭据，不能把预置成功算作正式 MA 或业务验收。

## 单写者与升级

每个数据库/运行时 collection 中，以服务名 `canvas`、`doc`、`sketch`、`image` 获取原子独占锁。第二个进程不能启动；正常关闭时，先停止请求并刷新持久状态，再确认释放自身锁。配置保持单副本、停止旧进程后再启新进程，不能滚动重叠启动。

锁没有租约抢占或分布式 fencing。进程崩溃可能留下锁，此时新进程拒绝启动；先确认旧进程、旧容器和旧部署副本确实停止，检查云端写入状态，才能由运维显式处理该服务锁。不要自动删锁，也不要仅因锁“看起来很旧”就接管。直接嵌入 `createCanvasServer` 的宿主也要承担同样的独占启动责任；CLI 已完成接线。

## 验收边界

分别记录：制品安装/构建，App 服务及真实云数据，MA 正式登记/同实例读写/撤权，Agent 实际调用，staging 部署。自有 MA 合同 fixture、隔离 local-test 启动、包已安装、`config --quiet` 或镜像构建通过，都不算正式 MA、staging 或部署成功。生图服务的部署验收清单以生图仓 `deployment/README.zh-CN.md` 为准；正式 MA 登记、HTTPS 网关、运行时凭据、逐调用者模型授权与 Agent 工具桥是外部负责人输入，缺失时保留待验状态。真实联调还需要可访问 MA 测试站、已授权实例、平台动作授权结果、资源鉴权通道和 Agent 调用入口；缺任何一项都保留待验状态。
