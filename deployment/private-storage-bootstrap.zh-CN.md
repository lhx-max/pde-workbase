# 私有存储首次部署工具

本工具预置四个 App 各自的私有资源，补齐首次部署所需的业务集合、字段、索引、桶及适用的 runtime namespace。它是应用方交付的独立运维制品，不修改 MA 宿主、SDK、目录或 Agent 调度，也不完成正式 MA 登记。资源操作由对应仓库负责人审批；部署身份、schema 管理身份及业务用户身份分别管理。

## 制品与运行条件

取得同一版本的 `dist/provision-private-storage.mjs`、`storage-contracts.json`、`manifest.json` 与 `SHA256SUMS`，使用 Node 24。该工具已打包全部应用自有依赖，可在没有源码检出、pnpm 或全局 Appwrite CLI 的机器上运行。源码入口为画布仓 `tools/provision/src/cli.ts`，构建入口为 `scripts/build-private-storage-bootstrap.ts`。这里不声称制品已经发布到 npm 或某个远端下载地址。

`storage-contracts.json` 是声明合同，不是 Appwrite 官方导出/导入格式。正式部署前核对合同、后端镜像版本和当前平台支持；不能把旧开发脚本的字段表当作完整生产 schema。

## 先生成计划

默认模式只输出计划和资源合同，不读取凭据、不连接云端、不创建任何资源。所有 database/bucket ID 都必须明确指定并属于所选 App 前缀；旧开发库、旧共享开发桶和跨 App ID 被拒绝。

```sh
node dist/provision-private-storage.mjs --app canvas --database canvas_app_staging_v1 --bucket canvas_assets_staging --namespace canvas-staging-v1
node dist/provision-private-storage.mjs --app doc --database doc_app_staging_v1 --bucket doc_assets_staging --namespace doc-staging-v1
node dist/provision-private-storage.mjs --app sketch --database sketch_app_staging_v2 --bucket sketch_assets_staging
node dist/provision-private-storage.mjs --app image --database image_app_staging_v1 --bucket image_assets_staging --namespace image-staging-v1
```

这些 ID 与 namespace 是明确的候选示例，不表示平台已分配。审批后使用实际值；namespace 必须与运行配置相同。Sketch 当前只使用 runtime 集合承载写锁，不需要 JsonState 业务 namespace，不能虚构同名环境变量。

## 检查与执行

云端模式必须指定 HTTPS `/v1` endpoint 和 project；提供一个外部 `APPWRITE_PROVISION_KEY` 或 `APPWRITE_PROVISION_KEY_FILE`，不能同时提供。预置身份须有已批准的数据库/集合/schema/索引/桶管理权限及适用的初始化读写权限；运行服务使用另一个最小权限的运行身份。凭据不写入制品、业务数据或日志。

```sh
APPWRITE_PROVISION_KEY_FILE=/absolute/private/provision-key node dist/provision-private-storage.mjs --app doc --database doc_app_staging_v1 --bucket doc_assets_staging --namespace doc-staging-v1 --endpoint https://frontend-cloud.corp.kuaishou.com/v1 --project grworkspace --inspect

APPWRITE_PROVISION_KEY_FILE=/absolute/private/provision-key node dist/provision-private-storage.mjs --app doc --database doc_app_staging_v1 --bucket doc_assets_staging --namespace doc-staging-v1 --endpoint https://frontend-cloud.corp.kuaishou.com/v1 --project grworkspace --apply --output /absolute/private/provision-result.json
```

`--inspect` 只读，返回 schema 与 namespace 的实际就绪状态；结果 `ready=false` 不能当作部署完成。`--apply` 才会创建缺失资源。执行前停止目标 App，避免与其写者并发；工具发现已有写锁会拒绝，不能用来抢锁。生产模式不能使用维护会话；非生产显式本地维护的 `--prefs` 仅供资源负责人排障，不是生产运行方式，也不能将维护凭据发给执行 Agent。

## 创建与拒绝规则

- database、collection、bucket 使用本工具明确的归属名称。只恢复自己的部分创建过程，不接管任意既有私有库/桶。
- collection 固定 `documentSecurity=true`、授权为空；bucket 固定 `fileSecurity=true`、授权为空、最大文件为 30,000,000 字节。文件和业务请求继续由 App 鉴权。
- 先只读检查已存在的归属、策略、字段和索引；任一不匹配即拒绝。不会重写 ACL、字段大小/类型、已有索引、桶配额或其他安全策略。
- 等待属性和索引实际 `available` 后才报告 schema 就绪；处理失败或超时明确退出，可在检查状态后显式重跑。不会因请求结果不确定自动重试创建，也不会删除半成品或迁移旧业务数据。
- 适用的 namespace 先检查现存 manifest。缺失时取得该 App 的独占写锁，只创建 manifest；确认成功后释放自己的锁。业务数据、历史回执和其他 namespace 不变。初始化不确定时保留锁供负责人检查，不自动删锁或抢占。
- 唯一允许的 DELETE 是经过所有权检查后释放本次取得的写锁文档；不会删除业务行、集合、数据库、文件或桶。

旧 `scripts/appwrite-provision.sh` 仅适用于已有明确开发 profile，使用 users-read，不可用于 staging/生产。新私有存储不会被旧开发资源自动替代，开发 ACL 也不会被本工具改写。已有平台预置资源若归属或 schema 不匹配，交由该资源负责人核对，不通过脚本强制收编。

## 初始化后的验收

按各 App 的运行配置模板，填写独立运行服务密钥、MA authority、HTTPS 公网地址和精确动作授权；启动单副本并检查 health/ready。随后使用真实授权的实例验证创建、条件写、回执重放、文件下载、跨租户/实例拒绝、撤权和停止后重启恢复。预置就绪不能替代业务验收，更不能替代正式 MA 目录登记、逐用户模型授权、宿主 Agent 工具桥或 staging 验收。

本交付的自动化证据包含隔离协议 fixture 的首次创建、私有策略、真实 JsonState/写锁/新进程式重读、并发拒绝、部分创建后恢复及制品外部执行；这些检查不冒充某个正式环境已经获批或上线。
