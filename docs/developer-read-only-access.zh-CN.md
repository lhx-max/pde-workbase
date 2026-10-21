# 开发者只读访问：仓库、接口与 Appwrite

核对日期：2026-10-21。**已配置并实测：这两个App的Appwrite数据资源默认允许已登录用户读取，新增/修改/删除只给明确维护者或服务身份；匿名不可读。无需逐个申请reader名单。** 真实25项检查及配置读回见 [云端验收](verification/developer-readonly/README.md)。通用HTTP业务token仍不是只读token，下面明确区分两种入口。

## 1. 代码与服务入口

| 项目 | 在线仓库 | 责任 |
| --- | --- | --- |
| 画布 | [design/designai-app-canvas](https://git.corp.kuaishou.com/design/designai-app-canvas) | 画布、卡包平台、COI/Provider、独立CLI |
| 文档 | [design/designai-app-doc](https://git.corp.kuaishou.com/design/designai-app-doc) | 独立文档后端、正文存储、doc-surface与独立壳 |
| 外部MA-V | [design/design-ai-client](https://git.corp.kuaishou.com/design/design-ai-client) | 基座/身份/目录/会话/MA运行，接入需指定其实际兼容版本 |

Git读取权限、npm读取权限、App接口权限和Appwrite数据权限是四件事。拿到仓库或安装组件不授予后端数据权限。Git线上存在也不代表本机未提交改动已经同步。

本次实际核对并配置的非敏感存储标识：

| 配置 | 当前代码约定 |
| --- | --- |
| Appwrite API | `https://frontend-cloud.corp.kuaishou.com/v1` |
| 数据项目 | `grworkspace`；不得与MA身份项目混为一谈 |
| 画布库 / 桶 | `canvas_app_dev` / `canvas_assets_v2` |
| 文档库 / 桶 | `doc_app_dev` / `doc_assets_v2` |

当前默认读取入口为上述Appwrite API，不是npm地址，也不是业务COI/Provider地址。“users”指此数据项目的已登录用户，不限某个开发者名单；账号准入/SSO仍由平台管理，不等于匿名公开。不得给开发者项目管理员或写入服务凭据。

### 已可读取的HTTP路径

用平台正常登录得到**自己的用户会话**，由Appwrite客户端按其认证方式访问；传 `x-appwrite-project: grworkspace`。当前内网兼容实现使用用户会话cookie，不能拿维护者cookie代替；本次验证用全新普通账号会话，未使用管理员key。

```text
GET https://frontend-cloud.corp.kuaishou.com/v1/databases/canvas_app_dev/collections/canvases/documents
GET https://frontend-cloud.corp.kuaishou.com/v1/databases/doc_app_dev/collections/documents/documents
GET .../databases/<上述库>/collections/<该库集合>/documents/<documentId>
GET .../storage/buckets/canvas_assets_v2/files/<fileId>/download
GET .../storage/buckets/doc_assets_v2/files/<fileId>/download
```

可以查看schema、列表、指定记录与文件；写入同一批共享资源被ACL拒绝。数据项目的其他App/库/桶不在这次授权范围里。读取可见范围是这两套已配置资源，不承诺按业务teamId过滤的细粒度视图；如需只看指定业务团队，使用后续认证业务网关，不能把Appwrite的全库读当作业务团队隔离。

## 2. 开发者怎样查看

优先读schema理解字段，再通过自己的已登录会话查询上述资源；写入联调使用自己的隔离数据根/环境。查看数据不要求成为项目管理员。

| 工作 | 允许方式 | 禁止方式 |
| --- | --- | --- |
| 理解字段/动作 | 本仓contracts、COI能力清单、专项合同；文档仓公开protocol/API类型 | 为了看字段先拿数据库写凭据 |
| 查看共享数据 | 已登录用户默认可读这两个App的指定集合/桶，无需逐个加名单 | 共享管理员cookie、CANVAS_AUTH_TOKEN、函数执行key |
| 核查其他项目/更细粒度数据 | 使用其实际资源授权；需要业务团队隔离时走认证业务网关 | 推导整个grworkspace项目所有资源都已开放 |
| 做写入联调 | 自己的本地服务/明确隔离测试环境、专用数据根与实例 | 用共享只读身份测试create/write，或修改共享样例/业务原件 |

Appwrite读取之外，文档与画布还有业务接口。以下是后续只读业务网关的候选白名单，**没有给通用服务token加reader角色，也不能把它们冒充本次新开的只读URL**：

| 能力 | 现有业务路径 |
| --- | --- |
| 目录/能力 | `GET /api/apps`、`GET /api/apps/canvas`；文档自身 `GET /api/apps/doc` |
| 已授权实例状态 | `GET /api/apps/canvas/instances/:id/state`、`GET /api/apps/doc/instances/:id/state` |
| 画布摘要/版本/绑定 | `GET /api/apps/canvas/instances/:id/context`、`revision`、`bindings` |
| 指定逻辑文件 | `GET /api/apps/<appId>/instances/:id/files?path=...`，还需路径、大小与内容类型限制 |

doc状态可经画布已注册的App代理访问；其余路径由实际服务提供。审计、显隐配置、用户目录、任意文件枚举/下载和诊断端点不因GET而自动开放。文件正文同样受数据授权与脱敏约束。

只读入口上线后可按其认证合同使用CLI：`CANVAS_SERVER_URL=<只读业务入口>`，执行 `canvas-cli apps list` / `canvas-cli apps state canvas --instance <已授权画布ID>`；凭据由安全环境注入。**CLI客户端选read命令只是操作方式，真正不能写必须由服务端拒绝。**

## 3. “不能改”必须落实在哪

共享只读接口需要同时满足：

1. 身份先验证，读取按授权团队/实例过滤；不信任调用者自报team/user头。未知身份、过期凭据、越权实例拒绝。
2. 接口按method＋规范化path白名单开放，只允许审查过的读取能力；create/write/operations/register/归档/恢复/上传/权限配置全部拒绝，禁止任意URL转发。
3. 原始写入口不能被同一开发者凭据绕过。读者不持有维护者token、Appwrite写权限或可执行写动作的函数凭据。
4. Provider读取常使用POST，不属于上面的GET白名单。若需要开放，必须额外按已审核action及schema检查只读语义，不能因为manifest标read就盲信，更不能开放整个Function executions任意path/body。
5. 只读调用不能触发隐式create/初始化、同步修复、重试任务或正文保存。读取授权不等于恢复/修复授权。
6. 读者、可访问资源、有效期、撤销与日志有记录；读权限不代表允许拿到全量业务数据。

若由Appwrite直接提供只读访问，还需逐层检查当前平台支持的授权机制：集合/文档、桶/文件、团队成员、用户通配授权、API key scope和函数执行。Appwrite权限是授予式的：更广层已有写授权时，再添加read角色不会抵消write。API key调用另有服务器权限语义，不能把用户ACL直接当key的限制。参见官方 [权限说明](https://appwrite.io/docs/advanced/security/permissions) 和 [认证说明](https://appwrite.io/docs/advanced/security/authentication)。

公司实例的能力以实际版本为准。当前客户端代码记录了内网Appwrite 1.8.1的cookie/JWT/key适配限制；这只是历史兼容记录，不能据此要求开发者申请一个未经验证可用的“只读API key”，也不能复制维护者cookie作替代。

## 4. 当前保护与仍有的边界

- 画布 [初始化脚本](../scripts/appwrite-provision.sh) 和文档仓同名脚本原先给users写权限；已改成 `read("users")` + 显式writer权限，要求维护者提供 `APPWRITE_SERVICE_WRITER_IDS`。对应函数部署脚本也不再默认 `--execute users`。开发者不需要也不应运行这些管理脚本。
- 画布 [通用服务token校验](../apps/server/src/server.ts) 没有把持有者区分成reader/writer；`CANVAS_AUTH_TOKEN`不是现成的只读token。开发态tenant头只做上下文，不证明身份。
- doc的部署认证要求可信团队provider，Provider入口还有上游信任前提；不能将开发默认配置公开给他人并称只读。
- 本任务已备份并更新7个集合、2个桶、2条写函数的ACL；只读者不能执行带写权限的函数。维护者直接创建/读回/清理专用测试数据成功，两条维护函数GET执行均200；函数代码/原写scope未修改。
- 普通账号实际改变revision/名称、增删记录及文件、上传、写函数执行均拒绝；完全同值的空操作可能200但不改变数据，实测不能用空操作代替权限验证。临时数据已清理，测试账号禁用、会话撤销。

这不封禁维护者/项目管理员，也不改变其他App、已有持有写scope的服务key或本地单用户工作台。要保持开发者只读，就不能再向他们分发这些写入凭据。当前业务token/正式MA/staging接入仍按相应合同另验。

## 5. 后续只读业务网关的验收清单（维护者执行）

上文的Appwrite开发资源默认只读已经验收；以下是今后需要按业务团队/实例过滤的HTTP网关清单，不是要求默认读者再申请名单。维护者先列环境、入口、资源范围、读接口、字段、凭据来源/期限、原写入口和撤销方式；开发者不自行改库。

- [ ] 给真实reader身份，授权资源可读，未授权资源不可读；匿名/过期凭据拒绝。
- [ ] 测试create/write/operations、注册、上传、归档、恢复、权限配置均拒绝；测试数据/目标明确隔离，读者访问的共享原件不被修改。
- [ ] 原业务入口、Provider/Function、数据库/桶均不能用同一凭据绕过限制。
- [ ] 广域users/team授权、API key和控制台权限已核对，没有继承到写权限。
- [ ] 读取前后目标revision/哈希不变，无创建资产/同步任务等副作用。
- [ ] 给出实际URL、身份配置说明、测试记录和撤销方式；README仅在这些证据齐备后标“只读已开放”。
