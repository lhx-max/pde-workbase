# App 首次上线、npm 发包与版本更新

文档修订：3.3.1；日期：2026-10-23。适用于独立 App、surface、画布卡包及 CLI 的交付。本文提供共同操作流程；实际包名、权限、流水线、服务地址和正式登记入口由对应负责人确认并写入 App 合同，不虚构统一发布按钮。

## 1. 先分清发布对象

| 对象 | 是什么 | 发布到哪里 | 负责人 |
| --- | --- | --- | --- |
| surface / 宿主包装层 | App 编辑器及其宿主适配组件；本体系按 npm 包交付，可同包或拆包 | 公司内网 npm，再由消费宿主安装固定版本 | App 负责人发包，宿主负责人接收 |
| 卡包 | 画布卡片的渲染、轻编辑与适用动作，包含纯服务端注册入口 | 公司内网 npm；画布前端和服务端分别安装/登记 | 卡包负责人、画布负责人 |
| CLI 与调用 Skill | Agent/人的命令行客户端和使用说明 | npm/tgz；安装到实际执行环境 | App 负责人交付，Agent 环境维护者安装 |
| App 后端 | 权威业务 API、Provider、任务与资源访问服务 | Appwrite Functions；权威数据库和文件使用 Appwrite 资源 | App 及部署资源负责人 |
| Appwrite 资源 | 私有库、集合/schema、桶、索引与恢复数据 | 已批准的目标环境 | 资源归属仓库负责人 |
| MA 应用登记 | 正式 manifest、动作权限、应用版本、实例及会话关系 | 基座正式目录与发布机制 | App 方交付，基座负责人接收 |

Git push 保存源码；npm publish 上传组件/工具制品；PDE 静态部署上传网站构建产物；后端部署启动业务服务；MA 登记把 App 接入宿主。它们是不同交付动作。npm 包可以包含多个公开入口，包名、版本和职责以发布清单为准。

`.tgz` 是 npm 安装包的文件形态，可先用于本地/隔离联调；正式 registry 分发上传已验收的确切 tgz 字节。Skill ZIP 是规范资料包，不是 App 的 npm 包或运行服务。

## 2. 首次上线顺序

1. **冻结发布清单**：记录源码 commit、包与后端版本、镜像摘要、协议/schema、宿主/SDK/peer 兼容、资源及负责人；未提交候选必须明确，不能写成远端已存在。准备上一稳定版本和迁移/回滚条件。
2. **部署后端及资源**：按 App 自己的说明，预置真实私有 schema/桶，配置平台运行身份、精确动作授权和稳定 HTTPS 对外入口。完成创建、条件保存、文件读取、越权拒绝和空缓存重启读回。PDE 静态托管不启动 Node 后端。
3. **交付固定制品**：按下节发布 surface/卡包及适用 CLI；包内带齐 CSS、Worker、字体、类型、声明入口和许可文件。在仓外干净安装，不依赖源码软链。
4. **接入画布（适用时）**：画布维护者安装卡包/编辑器及纯服务端 kind/动作登记，验证绑定原 App 实例、保存/同步、复制隔离与资源授权。独立 App 可不经过画布。
5. **接入 DA/MA（适用时）**：基座维护者按其机制接收组件、manifest、Provider 地址与认证配置，完成静态安装、正式目录登记和实例/会话关联。与画布 COI 自注册分开；安装包不等于正式登记。
6. **环境验收并发布**：在目标测试环境验证真实身份、旧/新实例、真实 Agent 调用、失败恢复与 UI 读回，再由环境负责人按批准流水线发布生产并复验。没有提供生产部署/登记入口时，交付包与缺口，不能称已上线。

如果业务需要无停机升级，须另有经过验收的并发写/迁移方案。当前四 App 后端采用独占写锁、单副本前提：停止接收请求、排空操作、确认落盘和释放自身锁、停止旧进程，再启动新进程；不能滚动重叠启动两个写者，崩溃锁也不能按时间自动抢占。

### 云函数发布的必验项

业务后端默认部署为 Appwrite Functions，宿主容器只消费组件包及适用的受限转发层；不能以驻留在宿主容器内的 App 服务替代该交付。平台注入的执行身份须在目标私有库、桶及所需 scopes 上实测读写，不要求公共写权限；维护登录态只用于获准的运维操作，不进入发布物。

平台注入的内网存储端点可以按平台合同使用内部 HTTP，但只允许服务端装配的精确 endpoint/project 与执行身份组合。对外入口及普通外部端点仍要求 HTTPS；不得从业务请求指定受信任端点，不得将维护会话转发到内网通道。端点能访问不代表运行身份经另一网关仍有权限，两条路径分别验证。

二进制响应经 JSON 信封传输时，内层原始 MIME、文件摘要和业务状态必须保持；不得让运行时对外层 JSON 响应头的修改污染内层文件头。验收须经过真实平台执行，并在实际消费组件中验证保存、刷新和资源展示。启动成功、缺配置拒绝、内存替身通过均不能代替云端业务验收；MA 夹具也不能代替正式身份及 Agent 调用验收。

## 3. npm 发包前准备

- 从目标仓维护者确认包名与 scope 的发布权限。`@ks-designai` 等已有 scope 不是任意人都可发布；资源审批入口见[资源目录](platform-resource-catalog.zh-CN.md)。
- 本项目确认的公司 registry 为 `https://npm.corp.kuaishou.com/`。在发布包的 `publishConfig.registry` 和实际发布参数明确指定，不依赖全局默认 registry，也不默认添加 `--access public`。可见性和读写权限按公司 registry 的实际策略核对。
- 使用公司规定的 npm 登录/SSO 或 CI 身份。若 registry 支持，可用 `npm whoami --registry https://npm.corp.kuaishou.com/` 核对当前身份；失败交负责人核查，不把 Appwrite 登录当作 npm 发布授权，不记录 token 或复制维护者凭据。
- 在实际待发布的 package 目录检查 `name/version/exports/types/files/peerDependencies/bin`（按包类型适用）。根工作区可能是 `private:true`；不要为发子包取消根私有标志，也不要误发整个 monorepo。
- 公司 registry 的新包必须在 `package.json.repository` 声明实际公司 Git 仓库（`type: git`、`url`）；monorepo 子包同时填写 `directory`。缺少仓库信息会触发发布策略拒绝，不能仅凭 HTTP 403 推断为账号权限不足，应按响应原因修复。明确拒绝且确认版本未创建后，可重新封装同一未发布版本；已经上传的版本或包含它的已发布依赖包必须递增版本，不覆盖旧制品。
- 不原地覆盖已发布版本。根据兼容性发布新版本；0.x 阶段的破坏性升级策略也须写清。npm 包版本与 MA 应用发布版本可以不同，兼容清单必须将两者关联。

下面仅是组件包元数据示例。包名与版本为占位示例，不表示已批准、已创建或已发布；出口路径必须与真实构建文件一致。React 等 peer 按实际目标宿主配置，不从示例推定版本。

```json
{
  "name": "@your-scope/example-surface",
  "version": "0.1.0",
  "type": "module",
  "files": ["dist", "README.md", "LICENSE"],
  "exports": {
    ".": {"types": "./dist/index.d.ts", "import": "./dist/index.js"},
    "./styles.css": "./dist/styles.css"
  },
  "publishConfig": {"registry": "https://npm.corp.kuaishou.com/"}
}
```

卡包补齐其公开的纯服务端入口，例如 `./server`，且不导入 React；CLI 配置真实 `bin` 与独立依赖。保留实际需要的许可/NOTICE。公司 registry 的包归属、登录方式与访问控制以其支持合同为准，npm 官方公有站的账户/可见性默认值不能直接套用。

## 4. 构建、打包与上传命令

以下为**执行发布任务时**的示例，不因读取本规范而执行上传。先审查 package 的 `prepare/prepack/prepublishOnly/postpack` 等生命周期；`--dry-run` 不代表所有生命周期都无副作用。示例使用 `--ignore-scripts` 检查、封装已经显式构建的产物；若目标包依赖必要的打包脚本，应先按已审查流程产出最终 tgz，不能跳过必要生成步骤后发布缺文件的包。

### 4.1 在目标仓完成检查与构建

按 AGENTS 和该包实际 scripts 完成安装、类型、相关测试及构建。依赖变化时先更新锁文件，再在干净环境冻结锁安装；本仓不使用根 build/test 别名。`pnpm --filter <实际包名> run build` 只是包级构建方式，不能将占位符直接当命令运行。

进入**目标可发布 package 目录**，核对包名和版本后执行：

```sh
npm pack --dry-run --json --ignore-scripts
npm pack --json --ignore-scripts --pack-destination /absolute/release-directory
```

输出 JSON 的 `filename/files/integrity` 用于定位并检查最终 tarball。发布目录由维护者选择并准备；不使用包含业务数据或凭据的目录。检查 `.env`、登录态、私钥、服务凭据和本机路径未入包；确认 JS、类型、CSS、Worker、字体及 `/server` 或 CLI bin 确实存在，不能只看文件数量。

在隔离消费工程中安装**这一个 tgz**，使用其公开出口验证组件、样式、服务端入口、CLI 与实际 API 读写；需要宿主上下文时使用已批准的适配配置。记录 tgz 的 SHA256 和兼容结果，之后不重新构建并悄悄换字节。

### 4.2 上传已验 tgz 到公司 npm

实际使用前将下列值替换为已批准的包名、新版本和最终 tgz 路径。`next` 仅为候选标签示例，不表示生产或某个环境已经部署；目标 registry 须支持对应命令和标签策略。

```sh
APP_REGISTRY='https://npm.corp.kuaishou.com/'
APP_PACKAGE='@your-scope/example-surface'
APP_VERSION='0.1.0'
APP_TGZ='/absolute/release-directory/approved-package.tgz'

npm view "$APP_PACKAGE@$APP_VERSION" version --registry "$APP_REGISTRY"
npm publish "$APP_TGZ" --registry "$APP_REGISTRY" --tag next --ignore-scripts
npm view "$APP_PACKAGE@$APP_VERSION" version dist.integrity dist.tarball --json --registry "$APP_REGISTRY"
```

第一条用于检查版本：已存在就停止，不能覆盖；`E404` 也可能是无读取权限或 registry 选错，必须先确认身份、包归属与目标地址，不能仅凭 404 就上传。首次新包先取得 scope/包名创建权限。`401/403` 交负责人核查，不切公网或换他人身份。

上传超时、断网或结果不确定时，先查询该确切版本是否已存在并核对摘要；不要立刻换一个版本再次发布。输出成功、网页有包名或 `npm view` 可见仍不替代下载和消费验收。

### 4.3 从 registry 下载读回并验收

在新的隔离验证目录，使用该环境允许的独立缓存，从 registry 下载确切版本：

```sh
npm pack "$APP_PACKAGE@$APP_VERSION" --registry "$APP_REGISTRY" --ignore-scripts --json --pack-destination /absolute/download-directory --cache /absolute/verification-cache
```

对下载 tgz 和发布前批准 tgz 计算 SHA256，核对 `dist.integrity` 与锁文件记录；不一致时停止交付并查 registry/制品差异，不能放宽 integrity。再从 registry 安装固定版本、核验公开出口与实际消费行为。

只有目标仓的发布流程要求且已授权修改标签时，才把**同一已验版本**提升为稳定标签：

```sh
npm dist-tag add "$APP_PACKAGE@$APP_VERSION" latest --registry "$APP_REGISTRY"
```

移动标签不会更新已锁定依赖、正在运行的宿主或已登记的应用实例。依赖应固定已验版本；应用发布另走以下消费流程。发错版本按平台支持的弃用/纠错流程处理，不删除重发同版本。

## 5. 画布、基座怎样消费新包

维护者在自己的消费仓更新依赖至确切版本，例如：

```sh
APP_CONSUMER='@your-scope/consumer-app'
APP_PACKAGE='@your-scope/example-surface'
APP_VERSION='0.1.0'
pnpm --filter "$APP_CONSUMER" add --save-exact "$APP_PACKAGE@$APP_VERSION" --registry https://npm.corp.kuaishou.com/
```

上方名称与版本先替换为实际批准值；安装位置按该仓结构确认。提交 package.json 与对应 lockfile，重新安装、构建并部署消费宿主；不能只改版本文字或等浏览器自动发现 registry 更新。

- 卡包分别核对前端 renderer 与纯服务端 kind/动作登记；surface/包装层核对公开出口、CSS、peer、注入 API/认证与实际尺寸。
- 目标 MA 当前按静态 registry 构建导入；新 npm 包不会自动热替换已运行组件。基座维护者更新构建与正式发布记录，应用方不擅自修改他人宿主/SDK。
- MA 的静态 manifest、目录版本、后端 currentVersion 和实例 applicationVersion 需满足目标 resolver 合同。升级前确认旧实例是保留旧版本、兼容打开还是显式迁移；不得只改 manifest.version 就让旧实例隐式换身份或重建业务数据。
- CLI 安装在实际 Agent 执行环境；新增动作/参数同步 manifest、CLI/调用 Skill 和精确权限，再验证真实 run/tool-call、Provider 回执及同实例 UI。

## 6. 更新与回滚决策

| 改了什么 | 更新哪些部分 | 发布前必须核对 |
| --- | --- | --- |
| 兼容的后端修复 | App 服务/镜像 | API/Provider 合同与权限保持兼容、旧客户端读写、运行恢复 |
| surface / 包装层 / 卡包界面 | 新 npm 版本、消费方依赖与构建 | 类型/CSS/Worker、宿主安装、同实例保存与刷新；不能仅发 npm |
| 新动作、权限或破坏性协议 | 后端、manifest、适用 CLI/Skill、宿主登记/授权 | 旧调用方与旧实例的版本策略、精确权限、失败与回执 |
| 数据/schema/持久格式 | 备份与迁移、服务版本、部署约束 | 先声明前后兼容与回滚条件，验证旧记录、未完成任务及幂等回执恢复 |
| 静态独立壳 | 静态构建资源与部署配置 | 资源缓存、API/登录、真实页面；不推导 MA 内嵌组件已升级 |

回滚须使用已保留的旧包/镜像及消费锁文件，并恢复兼容的应用登记版本/实例策略。已经迁移为旧服务不可读的数据，不能只切镜像假装完成回滚；按经演练的恢复或前向修复方案处理，不自动删库、改 ACL 或丢弃历史回执。包版本、后端版本和 MA 应用版本分别登记，不要求三者数字相同。

## 7. 每个 App 必填的发布操作单

在 `docs/APP_CONTRACT.md` 或其引用的部署文档填写：负责人；获准基线/commit；npm 包名/scope/registry/版本/tag/摘要；后端制品与平台/流水线入口；HTTPS/身份/资源配置来源；schema/迁移；消费方与宿主版本；正式登记/实例升级机制；Agent 工具安装位置；验收步骤；回滚目标与命令。未知项标待提供并列责任人，不填推测地址或凭据。

规范更新本身不执行 npm 发布、改标签、资源迁移或部署。上述流程在实际发布任务中按其授权范围执行并记录真实结果。

## 8. 生产交接、维护与下线

发布完成须由接收方核对实际运行版本、访问入口与关键业务结果，并留下接收记录。服务启动或流水线成功不能代替生产复验。

App 合同同时登记：维护人及故障接收入口；健康检查、错误与异步任务失败的观测/告警方式；请求与任务/回执的关联方式；适用的费用与配额；备份位置、恢复步骤和演练证据。各项按目标平台的真实支持填写，未配置项列缺口，不把文档要求写成已实现能力。

下线前明确旧实例、卡片绑定、私有资源和业务数据的处理及保留规则。按已批准范围停止发现/入口和新任务，处理进行中任务，再归档或迁移实例及资源；不得将移除组件等同于删除原内容，也不得未经授权删除桶、历史回执或用户数据。

## 参考依据

公司 registry 与包字段核对自当前画布仓 `packages/canvas-surface/package.json`、`packages/canvas-cli/package.json`；部署边界核对自各 App 的部署合同。npm 命令语义参考 [npm publish](https://docs.npmjs.com/cli/v11/commands/npm-publish/)、[npm pack](https://docs.npmjs.com/cli/v11/commands/npm-pack/) 与 [npm dist-tag](https://docs.npmjs.com/cli/v11/commands/npm-dist-tag/)，并核对本机 `--help`。公司 registry 的认证、可见性和平台发布机制仍须按其实际支持确认。
