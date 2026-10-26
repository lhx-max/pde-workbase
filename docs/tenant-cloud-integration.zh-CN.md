# 租户、团队与 Appwrite 接入

2026-10-21。本文记录 App 侧实现与验收；不代表 MA 正式登录、应用登记或 staging 已通过。

## 归属与身份

- MA 负责用户、租户选择、业务空间、成员及应用实例。我们不复制组织目录或项目名单。
- 兼容现有合同：MA `tenantId` 对应 App 的 `teamId`；MA `bizId` 是业务空间，不是画布内部 `projectId`。同一租户的不同空间/实例也必须隔离。
- 卡包的 `team` 是开发命名空间，不是运行时资产的所属团队。
- 新的 `@ks-designai/app-authority` 后端包按已发布的 MA `/me`、`/application-instances/{id}` 读合同验证当前票据、用户状态和实例访问权。普通 `x-team-id/x-user-id` 不作为认证。
- 画布接口同时检查资产 teamId、bizId 和 MA applicationInstanceId；文档检查 teamId 与 bizId，允许同一空间的已授权入口编辑其共享正文。旧的无归属记录不会被第一个访问者自动接管。

## 服务配置

正常 CLI 默认要求 Appwrite；缺配置直接失败。隔离 fixture 才可显式设 `CANVAS_STORAGE_MODE=local-test`。画布 `createCanvasServer` 的云端模式还必须提供 `authority`，缺少时业务请求503；私有维护 runner 的 `developmentActor` 是明确标记的开发例外，生产环境禁止使用，不作为正式 MA 验收。

MA 参数沿用基座命名：

```dotenv
MAV_API_TRANSPORT=appwrite
MAV_APPWRITE_ENDPOINT=https://frontend-cloud.corp.kuaishou.com/v1/functions/mavapi/executions
MAV_APPWRITE_PROJECT_ID=mavbackendwyh20261013
APPWRITE_ENDPOINT=https://frontend-cloud.corp.kuaishou.com/v1
APPWRITE_PROJECT=grworkspace
APPWRITE_DATABASE=canvas_app_dev
APPWRITE_BUCKET=canvas_assets_v2
```

也可明确配置 `MAV_API_ORIGIN` 使用相同 REST 合同。MA 地址是认证/实例授权来源；APPWRITE配置是我们的存储。服务存储凭据只能在后端配置，不能交给前端或当作用户票据。以上示例不包含存储凭据，也不证明部署已接入。

请求携带：

```text
X-MAV-SSO-Authorization: Bearer <MA登录SDK签发的当前用户票据>
X-MAV-Tenant: <基座当前tenantId>
X-MAV-Application-Instance-Id: <基座applicationInstanceId>
```

不是拿通用 CodeFlicker 生图授权、管理员存储cookie或自报actor替代这份票据。调用 Appwrite Function 的外层执行会话与其请求体中 MA 凭据也是不同层。

前端 surface 提供 `createMaCanvasTransport({baseUrl,tenantId,applicationInstanceId,getCredential})`，由 App 包装层注入官方登录SDK的 getter（返回 `Bearer ...`），不改基座或共享SDK。该 transport 每次请求取票据、覆盖伪造身份头，并拒绝向其他origin或API前缀发送票据。Provider包装层也须使用同一认证fetcher。`img/frame`导航不能附加这些头，需要宿主受认证的cookie代理或显式 `resourceUrl`；不能把JWT放进URL。

## 数据保存

CLI 的同一身份接缝：MA执行环境可挂载 `CANVAS_MA_CREDENTIAL_FILE`（绝对路径，内容为其签发的 `Bearer ...`）、`MAV_TENANT_ID`、`MAV_APPLICATION_INSTANCE_ID`。CLI按请求读取，不把凭据写进业务JSON或输出；非loopback必须HTTPS。文件由可信宿主/执行环境提供，本包不伪造MA票据，也不把维护者存储cookie发给Agent。旧npm CLI需升级发布后才具备这个接缝。

| 云端位置 | 已落地的字段/用途 |
| --- | --- |
| `canvas_app_dev/canvases` | `teamId`、`createdBy`、`assetMetadata`，以及原state/revision/operations/snapshots/extra |
| `assetMetadata` | 画布资产自身的名称、创建/更新/归档时间、MA业务空间/实例映射；不是 MA 项目目录 |
| `doc_app_dev/documents` | `teamId`、`bizId`、`createdBy`、`nodeId`、`mirrorCanvasId`、`mirrorPath`、`archivedAt`，以及原文件索引字段 |
| `card_grants` | 平台默认、团队及单画布的可用卡种规则 |

新增字段已经通过增量工具加入上述开发云库；既有行没有批量补归属或改写。`createCloudProjectRegistry` 从同一批画布云行重建可丢弃的本地投影，成功响应和状态提交前等待云元数据写入；清空本地目录后可恢复画布身份和状态。当前这层按单后端写者使用，不声明多副本元数据CAS。

文件通过所属画布或文档的API授权。文件索引的canvasId/documentId继承所属资产的团队关系，不要求每个卡片、每个二进制重复保存组织目录。

开发项目中此前用户指定的“Appwrite已登录开发者默认只读”ACL继续保留，这是开发者查看共享开发资源的权限，不是终端用户的团队业务授权。生产数据策略不能直接复制全体开发者读权限；本次验证的是 MA 身份驱动的 App API 隔离。

## 卡片入口与使用权限

`card_grants` 优先级仍为 `project:<画布内部ID>` → `team:<teamId>` → `*`；明确的空数组禁用全部卡种，无规则沿用既有默认全开放策略。规则读取失败不能当作“没有规则”。例如维护者可配置：

```json
{"scope":"team:design_agent","allowedKinds":["image","text"],"source":"local"}
```

规则由有写权限的维护者通过Appwrite控制台或 `CardRegistryStore.upsertGrant` 管理；普通开发者只读，不从客户端actor推断管理员身份。没有替实际团队擅自设置限制，验收只创建并清理了隔离团队规则。

- `GET /api/apps/canvas/instances/{id}/capabilities` 返回该团队/画布实际允许的kind。
- 原有 `CanvasKindAvailability` 与新团队结果取交集，共用的新建菜单随之隐藏未授权入口；读取失败时入口集合为空，不残留前一团队的菜单。
- 后端同时拒绝未授权kind的创建、已有卡修改、兼容批量保存绕过，以及代价较高的生成调用；不能只隐藏菜单。
- 这是“新建入口/能力可用性”，不是把既有资产从文档中删除。规则变化后保留原始节点，避免刷新保存误删；既有内容的保密边界由所属资产的团队/空间授权保证。没有承诺同一画布内部任意一张卡片的独立密级ACL。
- 菜单重新挂载/刷新时重读规则，尚未做策略变更的实时推送。

## 验证和未完成边界

[真实云端验收](verification/team-tenancy-20261021/runtime.json) 使用真实Appwrite表和桶；MA身份正向采用隔离的合同fixture，覆盖两个团队、同租户不同空间、伪造身份、云端保存、空缓存重启和文档恢复。fixture不代替真实 MA 账号/应用实例的正向验收。

菜单测试实际渲染共用新建菜单，验证团队过滤及切换失败不泄露上一团队入口。授权包另验证MA拒绝、网络故障、Function信封和实例不匹配。没有为验证而放开普通users写权限。

正式 MA SDK票据注入、正式实例登记、宿主资源代理和线上后端部署仍须由相应运行环境接线验收。原 `canvas-coi` 函数的存储授权失败也不能由本次居民服务+云存储测试掩盖。文档回执、绑定索引及同步恢复队列的持久范围继续以正文合同为准；本次资产归属接入不等于所有运行队列已完成无本地依赖改造。

`@ks-designai/app-authority` 当前为仓内工作区包，文档仓使用同一版本的可安装vendor tarball；尚未发布到npm。画布surface新增API也需要后续打包发布后才能被旧npm消费者使用。
