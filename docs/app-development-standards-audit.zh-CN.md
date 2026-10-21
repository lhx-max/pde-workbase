# App 开发规范审计与补齐记录

核对日期：2026-10-21。本任务只整理规范，不承担另一个对话正在执行的打包发布，不改宿主/SDK/业务实现。下列代码状态为本轮检查时的快照；发布或后续修复必须更新对应任务证据。

## 1. 原来的问题不是缺少接口表

原 Skill 以卡包开发为中心，只有“卡片=一个npm包”的入口；App规范已有 P1–P24、租户与Provider，但没有一个从零理解“产品/包/实例/宿主/服务”的完整路径。历史运行状态和新合同混在正文中，导致开发者可能同时遵循互相矛盾的规则。

本轮新增 [开发手册](../.devin/skills/canvas-app-platform/docs/app-development-handbook.zh-CN.md) 与 [逐 App 合同模板](../.devin/skills/canvas-app-platform/templates/APP_CONTRACT.template.md)，更新 Skill 路由与旧文档冲突点。没有创造第二套接口、建新框架或替平台补未确认 API。

## 2. 文档矛盾与修正

| 原有表述 | 具体风险 | 本轮修正 |
| --- | --- | --- |
| 卡片=一个包，所有任务先读卡包合同 | 不知道该做卡包还是有后端的App | 分 App、surface、包装层、卡包、卡实例、CLI；按任务加载 |
| FDE只能改三处被当所有任务禁区 | App接入误以为也不能做后端/规范 | 冻结区明确只限制FDE卡包任务，用户授权按实际任务 |
| P1–P24是全体系唯一协议 | 每个App重复实现目录/治理；MA manifest直接复用COI | 明确COI profile、提供者与MA适配分层 |
| `bizId`表示画布实例 | 把外部项目/个人空间当内部画布 | 引入ID表，COI例子用canvasInstanceId；历史类型名注释 |
| filePath是唯一绑定键 | 跨团队/画布撞路径，复制后仍指原件 | doc绑定域为team+canvas+node，路径只是定位符 |
| App直接共享桶凭据且不能自建存储 | 暴露凭据，否定独立App数据归属 | App自有数据归App，交换走API；卡包走注入文件端口 |
| 所有卡内容都由App保存 | 纯JSON卡被迫建独立数据库 | 仅已绑定App正文以业务App为权威 |
| 打开时用卡镜像覆盖Doc | 打开页面就抹掉另一入口的修改 | 打开只读；有基线写/冲突/显式恢复 |
| App页签必须同时建卡 | 独立文档/外部MA实例无法成立 | 绑定详情同实例；独立资产允许无卡；入口规则不全局化 |
| actor有值、缓存查不到就放行 | 本地过滤被当生产认证 | actor不是票据，可信网关/委托先验证；缓存不授信 |
| updatedAt天然单调、读最新基线即可写 | Provider整数版本与正文hash混用；检查/提交有竞争窗 | 分版本域，补基线必须证明原子性，不宣称现有实现已安全闭环 |
| CLI源码存在就能给MA直接用 | 没安装包、网络/身份/实例不可达 | 源码/独立安装/运行环境/MA调用分开验收 |
| 云接入后不再需要任何本地数据 | 删除恢复队列/操作日志 | 正文与运行持久数据分开，存储模式显式 |
| 早期候选表与后续“不建表”并列 | 新Agent照旧计划建tenant/bindings等云表 | 标历史规划，当前云设计不代表本地索引可删 |
| doc“全合规100%”，文件写可最后写赢 | 把旧测试当生产结论，绕过正文428/409 | 删除全合规结论，历史表按日期解释，正文以增补为准 |
| 从 `feat/zhuzhiheng-da-cloud` 开卡包分支 | 跨仓/旧分支错误 | 卡包合同与当前根AGENTS一致：card-pack-base |
| Appwrite函数执行URL直接拼业务路径 | HTTP适配部署后404/外壳不匹配 | 必须测试网关与函数传输映射，不写假通用地址 |
| 只要表里✅就“上线” | 本地/Function/云端staging被混为一谈 | 定义独立、卡片、安装、模拟、正式、Agent、staging验收门 |

旧附录保留历史样例，但已加日期/适用警示；P编号以 App规范 §4.2 为准，不把旧合规表错号当合同。

## 3. 接缝还需工程补齐，不能只靠规范解决

| 缺口/待核验项 | 本轮看到的依据 | 具体出口 | 责任归属 |
| --- | --- | --- | --- |
| 独立安装包、内网发布、干净消费者验收 | 画布有surface pack/verify工具；文档/CLI分发正在另一任务处理；本轮不重复运行发布 | 实际包名/版本/registry、tarball完整性、安装/运行证据 | 当前打包发布任务 |
| 宿主包装层可移植 | Kit此前有本机文档file路径及默认本机服务；不能当通用发布配置 | 固定安装包、profile配置、无源码绝对路径，在未改宿主打开 | App交付方；主体发布任务核最新状态 |
| COI动作参数→Agent schema闭包 | 卡包合同§11仍列inputSchema自动暴露待补；MA画布manifest的operations items较宽 | 精确可校验动作联合类型/示例；缺参数、非法kind失败用例 | 画布API/卡包平台 |
| CLI完整写入前提 | 当前`http-cli.ts`的apps call将body-file封成input，未提供顶层expectedRevision/稳定幂等键flags | 独立CLI交付选择暴露完整信封或明确request命令；实测409/重放/不确定写入 | CLI发布与能力维护者 |
| 可信Provider入口 | 画布`requireLocal`默认503/仅loopback；doc`providerTenant`假设可信上游 | 确认正式认证/网络合同，错误票据与跨租户拒绝 | App适配方＋基座接口提供方 |
| Provider版本竞争窗口 | doc外层`checkProviderRevision`与正文执行分开；补最新baseline不自动保护过时输入 | 原子比较/提交或可信内层版本传递；并发竞争测试 | doc后端维护者 |
| 回执重启语义 | doc动作回执为Map；画布有持久operation-journal | 每个action公开稳定键作用域/持久范围，重启重放测试 | 各业务后端 |
| 正式目录/发布入口 | 本轮已知MA目录/实例曾返回STORAGE_ACCEPTANCE_REQUIRED；本地未确认独立mavapi源码/发布API | 正式机制提交两份manifest，目录/实例/会话真实读回 | 基座维护者；App交付文件 |
| SDK生命周期/transport接缝 | 目标SessionAppSurface实际传context/fileClient/conversation，无保存钩子/provider注入 | 现有公开入口足够则包装层适配；否则列最小接口缺口和支持范围 | App适配方；基座能力由其维护者处理 |
| MA自主工具通道 | 目标api.ts发消息前关键词plan执行动作再拼prompt | MA真实run/tool-call至Provider回执、UI完整关联 | MA执行环境维护者＋App联调 |
| staging持久化/多实例 | doc Appwrite无真CAS，依赖显式single-writer；正文/队列非分布式事务 | 远端单写部署与持久卷/恢复验收；多写者另有存储方案再声明 | App后端/部署维护者 |
| 能力声明与所有运行入口一致 | 本地Express与canvas-coi函数、不同卡种/handler不是同一范围 | 按实际部署入口跑每个声明动作，未支持显式unavailable | 各部署入口维护者 |
| 可执行的通用验收包 | 现有测试按画布/doc领域分布，还没有证明新App只填合同就能一键跑全套 | 先复用实际可共享的schema/安装/Provider合同用例，业务断言由App提供；用第三个最小App验证后再固化脚手架 | 后续规范工具任务，不在本轮文档里伪造已完成 |

这里没有要求全部缺口先做完才能写新App。先跑独立业务和标准交付；需要某能力才推进相应验收门。外部依赖不能由零背景Agent通过猜接口、关门禁或造数据绕过。

## 4. 本轮核对的源与边界

以下均为本地源码/产物检查，没有线上发布、数据库登记或MA执行环境安装：

- [App规范](../.devin/skills/canvas-app-platform/docs/app-development-spec.zh-CN.md)、[卡包合同](../.devin/skills/canvas-app-platform/docs/canvas-card-pack.zh-CN.md)、[互联协议](../.devin/skills/canvas-app-platform/docs/canvas-app-interop.zh-CN.md)、[正文增补](../.devin/skills/canvas-app-platform/docs/document-sync-contract.zh-CN.md)、[数据模型](../.devin/skills/canvas-app-platform/docs/data-model.zh-CN.md)。
- [卡包SDK](../packages/canvas-card-sdk/src/index.ts)、[COI实际路由](../apps/server/src/routes/app-canvas.ts)、[Provider](../apps/server/src/routes/canvas-provider.ts)、[CLI](../apps/server/src/http-cli.ts)、[canvas-surface公共合同](../packages/canvas-surface/README.md)。
- 外部兼容基线：`/private/tmp/da-ma` 的 `packages/contracts/src/api/ma-applications.ts`、`ma-v/src/session-apps/SessionAppSurface.tsx`、`resolver.ts` 与 `ma-v/src/api.ts`；目标commit `fa9475183`。它们只作为审计对象，不成为本仓运行依赖。
- doc参考：`/Users/zhuzhiheng/Desktop/designai-app-doc/apps/server/src/protocol.ts`、`open-platform.ts`、`app.ts`、`packages/doc-surface/src/api-types.ts`；Kit SDK 1.0.0 的类型与实际props分开核。
- 历史本地证据：[Kit画布运行](verification/canvas-kit-runtime/result.json)、[模拟登记](verification/ma-registration-simulation/README.md)、[双入口责任与状态](canvas-doc-relationship-and-status.zh-CN.md)。旧验证不提升为当前正式环境通过。

旧DA的Agent API/CLI链路只用于提醒“发现→版本化写→回执/读回”的证据纪律；本仓命令与接口以当前源码为准，不导入旧仓资源或复用其发布状态。

## 5. 文档验收：用新Agent视角走三条任务

本轮是主Agent对照合同/源码的桌面推演，不声称做了独立盲测或重建示例App。

| 情境 | 从哪里开始 | 应能独立得到的结果 | 正确停止点 |
| --- | --- | --- | --- |
| 纯JSON业务卡 | Skill→手册§1/§6→卡包合同 | 不建新数据库；renderer/onPatch、服务端kind、dataVersion、保存读回 | Function缺handler时标该入口未支持，不改宿主掩盖 |
| 新独立编辑器App并嵌卡 | 手册→APP_CONTRACT→App规范/正文或业务专项合同 | 同组件独立壳/详情、权威数据、绑定/文件、版本化写、复制与恢复证据 | 业务同步未通不能只截UI报完工 |
| 已有App给MA-V及Agent使用 | 手册§7–§11→目标SDK/schema→发布清单 | 包装层、两种manifest映射、Provider、CLI/Skill/配置、安装和mock边界 | 正式登记/工具执行缺失则提交完整包与具体缺口，不能称Agent已调用 |

复核还应做到：所有新本地链接存在；旧冲突表述已替换；APP_CONTRACT能表达N/A/待提供；生产认证和模拟登记不混淆；包名/发布状态不写成未经核对的事实。后续新App开发应按模板积累真实执行证据，才能继续检验这套手册的可用性。

## 6. 本轮文档检查结果

- 10份Skill/专项合同/新增模板与审计文件的46条本地Markdown文件引用检查通过；代码块闭合、关键主题和已识别旧冲突表述检查通过（后续新增引用应再次检查）。
- `git diff --check` 通过；没有修改运行代码、package.json、锁文件或发布配置。
- 对三种新Agent任务做了上节的人工走读；没有启动无背景子Agent盲测，不能以此宣布“任何Agent必然零问答完成所有外部接入”。
- 下一轮最有价值的验证是用这套入口完成一个新的最小App，记录它缺失的信息，再提炼实际可复用的脚手架与合同验收；发布任务仍按其原范围推进。
