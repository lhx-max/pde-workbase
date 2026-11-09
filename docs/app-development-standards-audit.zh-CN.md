# App 开发规范审计与补齐记录

最新复核：2026-10-22。新增示范合同深度审查见§7；§1–§6保留2026-10-21审计快照，其中工程缺口不可覆盖后续交付记录。

原核对日期：2026-10-21。本任务只整理规范，不承担另一个对话正在执行的打包发布，不改宿主/SDK/业务实现。下列代码状态为本轮检查时的快照；发布或后续修复必须更新对应任务证据。

## 1. 原来的问题不是缺少接口表

原 Skill 以卡包开发为中心，只有“卡片=一个npm包”的入口；App规范已有 P1–P24、租户与Provider，但没有一个从零理解“产品/包/实例/宿主/服务”的完整路径。历史运行状态和新合同混在正文中，导致开发者可能同时遵循互相矛盾的规则。

本轮新增 [开发手册](../.devin/skills/designai-app-platform/docs/app-development-handbook.zh-CN.md) 与 [逐 App 合同模板](../.devin/skills/designai-app-platform/templates/APP_CONTRACT.template.md)，更新 Skill 路由与旧文档冲突点。没有创造第二套接口、建新框架或替平台补未确认 API。

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
| 开发者共享数据只读 | 后续已配置7集合/2桶默认登录读、显式writer写，两条写函数限writer；[25项实测](verification/developer-readonly/README.md)通过；通用HTTP token未分reader/writer | 开发资源读取用自身会话；业务网关细粒度reader角色另接，不能共享writer凭据 | 后端/平台维护者 |
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

- [App规范](../.devin/skills/designai-app-platform/docs/app-development-spec.zh-CN.md)、[卡包合同](../.devin/skills/designai-app-platform/docs/canvas-card-pack.zh-CN.md)、[互联协议](../.devin/skills/designai-app-platform/docs/canvas-app-interop.zh-CN.md)、[正文增补](../.devin/skills/designai-app-platform/docs/document-sync-contract.zh-CN.md)、[数据模型](../.devin/skills/designai-app-platform/docs/data-model.zh-CN.md)。
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

## 7. 2026-10-22：一涵示范合同深度审查

本轮按用户要求只审查和修正规范，不继续正式 MA 联调，不修改一涵的示范仓/宿主/SDK/业务代码。示范来源为 [design/design-agent-plugin-kit master](https://kdev.corp.kuaishou.com/git/design/design-agent-plugin-kit/-/files?branchName=master&repoId=647255&repoName=design-agent-plugin-kit)，公司远端核对为 794be21a58f846ae3b5e959a8fd7eed680d476cc。通过 git show 读取已提交 README、SDK types/provider/file/conversation/instance-policy、registry、设计画布 manifest/组件和 Preview；不以 dirty 工作区新增插件作为示范合同。

目标宿主对照采用已记录 fa9475183ee91b4e4ba948eee7f86312db4022f4 的 ma-applications schema、resolver、SessionAppSurface。该分支是外部兼容记录，不冒充云端实际部署版本。完整逐项结果集中在 [示范合同对照](../.devin/skills/designai-app-platform/docs/da-plugin-kit-integration.zh-CN.md#2-合同逐项对照)。

| 发现的规范问题 | 本轮修正 | 性质与限制 |
| --- | --- | --- |
| 示范仓被笼统称工具仓；本机 doc/canvas-workspace 实验易误认一涵已提交示范 | 明确基于一涵后端的 App 示范；已提交只有设计画布/素材收藏；保留 KDev/Git/SDK/基座/业务仓索引 | 仓库证据，不宣称官方接纳我们的 App |
| COI自注册/30s心跳、P1–P24及响应包写成所有App通用要求 | 标清内部COI角色/profile；MA用自己的登记和信封 | 外部兼容纠正，不新增协议 |
| 外部Provider只有动作样例、调用者到MA与MA到Provider混写 | 补snapshot形状及read-action选择，区分两跳strict schema和data/content | 按消费能力实现，不造假GET接口 |
| “去重平台管”容易导致超时后每次新建请求键 | 明确SDK action每次生成新UUID；逻辑操作保留键/输入/基线，权威后端负责持久幂等 | 本项目可靠性增补，不宣称SDK提供持久回执 |
| 示例actor/localhost/可选providerClient容易被当正式认证/默认配置 | 核对实际props，正式配置注入；Preview身份、事件提示与示例地址不作生产依据 | 不改外部宿主，不猜认证接缝 |
| platform/显隐默认放行与团队过滤易被当资源写授权 | 明确显隐不授予业务读写；云端不能默认local/local；完整实例归属和动作授权另验 | 本项目授权要求，非MA官方新增接口 |
| App独立等同每App一库/一进程，与生图复用画布后台冲突 | 独立指责任与业务边界；已批准共享后端按实际归属声明 | 不借规范强拆当前实现 |
| 包名、CLI flags、Provider仅loopback、本机适配位置沿用旧状态 | 更新实际doc包名和CLI版本前提；包装层回App自有仓；旧loopback说法指向实际交付版本 | 源码/制品/正式环境仍分开，未重新运行代码验收 |
| 历史附录标题“可直接抄”，P号错位，旧manifest暗示无前提写 | 历史样例明确不可直接用于当前交付；改正P3/P4/P7/P16/P17/P18/P19，主manifest按版本化写要求 | 历史输出不改造成新验收证据 |
| 模板无法强制区分规则来源、两跳信封与读合同 | 补来源分层、instanceMode、读合同、两跳信封、幂等与桥的实际语义 | 开发前可填写；外部未提供项不阻塞内部业务 |

本轮结论：现有规范的大方向已参考示范，但修正前不能称逐项完整对齐。修正后的规范明确外部接入形状与内部责任，不替代四 App 源码的全量兼容审计、正式登记、Agent 或 staging 验收。

新开发者应能按入口完成三种判断：纯卡包复用画布持久化、不建新Provider；独立App只按选定profile承担接口；接MA时交付静态组件/manifest/Provider与环境配置，按正式合同登记。若只读到示范默认localhost或Preview的“已发送”就宣称正式接入，仍不合格。本轮未创建新App或做独立Agent盲测。

本轮文档检查：7份文件的82条本地文件/标题引用与代码围栏检查通过，原HEAD/index保留。Codex skill-creator 的 quick_validate 在修改前后均因既有Devin技能frontmatter的 version 字段报错（该校验器不接受此字段）；未为迁就校验器重命名既有中文技能或删除Devin版本信息，因此不宣称完整Codex技能校验通过。本轮没有修改运行代码、重新调用模型、登记应用或部署；代码验收仍以各App交付证据为准。

## 8. 2026-10-22：实际联调修复后的规范复盘

范围是上一轮四App代码修复与交付过程（跨2026-10-21至22），不是已完成正式MA联调。此次回看实际源码、回归用例和已保存输出，仅更新规范，不重复跑云端/模型任务。示范合同的修正见§7；这里回答实际工程问题是否值得升格为共同规范。

### 8.1 需要补充的约束

| 实际发现及依据 | 规范缺口 | 本次增改与适用范围 |
| --- | --- | --- |
| 可选manifest字段直接进入严格云状态口会失败；修复后用实际AppwriteJsonState codec（HTTP为替身）验证元数据写入和重建。见 [codec回归](../apps/server/tests/cloud-artifact-metadata.test.ts)、[当次45项输出](verification/four-app-completion-20261022/artifact-strict-codec-tests3.log) | “能存JSON”没明确真实序列化及替身边界 | 云状态DTO显式归一；实际codec完成写/flush/新实例读回。不能只用Map替身判云端可用 |
| 云状态包在写入/flush失败后锁住受影响状态口，防止继续返回未落云的内存成功。见 [失败与非法JSON用例](../packages/app-cloud-state/tests/appwrite-json-state.test.ts)、[当次35项输出](verification/four-app-completion-20261022/cloud-state-final-tests.log) | 旧文档只写“不确定请求先查回执”，未覆盖服务内存也可能偏离权威状态 | 补提交失败后的不可用/恢复语义，保留原请求，不静默继续写或自动重试；不强制所有App采用同一个恢复算法 |
| 文档/草图包装层增加不可变身份快照，测试宿主原地修改context/actor时旧工厂仍保持A身份。见文档仓 packages/doc-surface/tests/ma-wrapper.test.tsx、草图仓 apps/web/tests/sketch-da-mount.test.tsx；[当次文档7项输出](verification/four-app-completion-20261022/doc-clean-surface-tests.log) | 原规范已有“A→B不能借B凭据”，但没说明对象原地变更这一失败入口 | 将旧原则具体化为白名单不可变快照和旧回调请求断言；单纯忽略迟到UI响应不足以证明隔离 |
| 最终doc/sketch vendor采用内容哈希文件名，最终消费者报告固定四包SHA。见 [最终包结果](verification/four-app-completion-20261022/final-package-consumer.json)、根package.json与pnpm-lock.yaml | 旧文档禁止覆盖已发布npm版本，却没覆盖本地同名tgz与旧lock/cache | 本地候选包同样按字节定位；变更路径/版本后同步lock，固定最终字节后再干净安装；不用放宽integrity掩盖问题 |
| Appwrite客户端拒绝重定向并隐藏上游错误body。见 [实际客户端](../apps/server/src/storage/appwrite-client.ts)、[回归用例](../apps/server/tests/appwrite-error-sanitization.test.ts) | “不打印token”未覆盖自动转发与上游错误透传 | 特权请求固定可信目标/逐跳授权，上游body不直透UI/CLI/回执；不要求普通无凭据下载一律禁跳转 |

上述约束统一落在 [交付增补](../.devin/skills/designai-app-platform/docs/unified-app-delivery.zh-CN.md)；主规范/手册只路由，模板补可填写项，避免五处复制全文。它们是本项目工程要求，不声称一涵示范SDK已提供这些保证。

### 8.2 已有规则足够，不重复新增

- 完整MA归属、当前动作权限、撤权后拒绝缓存回执：统一增补已覆盖，保留对应修复与越权证据即可。
- 版本竞争、稳定幂等键、响应丢失、付费生成不盲重跑：正文/草图案例和统一增补已覆盖，不再定义另一套通用事务协议。
- Appwrite ID/索引限制、独占写锁、崩溃锁不按TTL抢占、生产私有ACL：已有规则继续按实际版本与环境验，不把本次35字符映射推广成全平台永久限制。
- 新上传对象收窄grants、冲突对象不自动修权限、signature不是自己的字节校验：此前已写入统一增补，本次不重复加表或维护第二套权限系统。

### 8.3 删除和纠正什么

§7已移除的泛化表述继续有效：每App必须实现全部P接口、所有后台必须独立进程/库、“去重平台管”、SDK可选props当必传、COI注册等于MA登记、历史样例可直接抄。不再把旧工程缺口表当当前实现状态，§3只保留日期明确的审计历史，当前状态回到[实际交付记录](four-app-completion-20261022.md)。

本轮没有删除历史失败证据、业务差异或尚未验收项，也没有新建协议/中间层/通用脚手架。模板按使用能力填写，纯卡包无特权HTTP客户端或独立云状态口时可写N/A及原因。仅改文档的验证不提升为源码、生产权限或真实MA验收通过。

本轮验证：5份文档的68条本地文件/标题引用、代码围栏及增量空白检查通过；原HEAD/index保留。只复核既有运行证据，没有将旧测试计为本轮重跑结果；本轮文档变更尚未提交/推送。

## 9. 2026-10-22：本地基座后端专项的验收缺口

本轮已经实际改代码、运行服务及CLI，不继承§7/§8“仅文档审查”的执行范围。证据集中在 [后端专项报告](verification/ma-backend-local-20261022/README.md)；启动与复现见 [本地联调说明](ma-local-integration-runbook.zh-CN.md)。正式MA、逐用户模型授权和云端页面未因本轮通过而自动升级状态。

现有规范已经要求完整租户作用域、可信写策略、持久回执和真实消费制品验收。此次多数是实现/验收覆盖未落实，不再复制一份通用权限体系；补以下可复现检查点：

| 实际缺陷/观察 | 需要落实的验收，而非另建协议 |
| --- | --- |
| Doc缺biz声明被当作可匹配任意业务 | 缺字段必须按合同拒绝/精确匹配，不能把undefined当通配；正文、元数据、文件、回执、镜像队列分别验作用域 |
| metadata rename/archive/bind绕过正文的单写者闸口 | 所有持久化mutation共用写入前提；不能只测正文PUT，PATCH及后台投递也要覆盖 |
| 新Sketch私有库未建MA三字段和运行锁集合 | 真正从空schema预置→检查字段可用/ACL→写锁→独立CLI；已存在开发库通过不能代替新环境可部署 |
| Sketch日志称loopback，实际全网卡监听 | 实际lsof核对监听地址；开发隔离入口显式loopback，不能仅看日志 |
| 无键临时回执无限增长 | 约定会话缓存边界；只淘汰可丢弃无键条目，不淘汰幂等声明而使重试重复执行；云端journal另外验重启 |
| Canvas读任务wait采用POST，被统一写闸误拒绝 | 根据具体动作语义授权；只对精确等待路由放读，不能把全部POST或全部/wait后缀一概放行 |
| Doc Provider显式null/数组input造成500 | 严格输入对象校验在解析期400，真实HTTP复验，不只调用内部函数 |
| 资源展示桥URL误用为后端媒体交付描述 | 浏览器展示地址与规范文件标识分开；新请求持久化前组装规范URL，旧幂等请求不能在恢复时改写 |
| 图片Worker单包测试绿，消费方重打包后不能启动 | 最终宿主安装实际制品，操作Worker预览→保存→刷新→规范文件下载与像素核对；不能只检查dist里有worker.js |
| 语义自动化删除不生效，真实鼠标删除成功 | 观察不足不能升格产品缺陷；保留诊断证据，换实际交互并读回后再决定是否修代码 |

本轮新增维护的 `e2e/ma-cli-isolated-acceptance.ts` 使用显式local-test、唯一测试租户、真实CLI子进程、规范文件下载/解码和最终归档；不能拿它验证正式生产身份。未配置的mirror/binding按明确不可用记录，不能为了让测试绿放宽归属检查或造共享权限表。

## 10. 2026-10-22：白皮书3.0与持续维护

本轮按“首次加入的开发者与AI能够完成适合本架构的App开发”的目标重整规范体系。正式入口为 [Skill](../.devin/skills/designai-app-platform/SKILL.md) → [白皮书](../.devin/skills/designai-app-platform/docs/app-development-handbook.zh-CN.md) → 适用专项合同 → App自己的开发合同；资源查询使用 [仓库/负责人/文档/云资源目录](../.devin/skills/designai-app-platform/docs/platform-resource-catalog.zh-CN.md)。

- **新增**：后端完整闭环要求、异步字段语义映射、首条业务纵向链路、外部接入最小输入与提供方、规范维护流程；模板补资源/审批/实际CLI/规范影响。平台归属和完整版本、幂等等沿用原合同，不新建并行API。
- **调整**：通用架构与本轮状态分开；分支/React/运行栈按实际仓库适用；批准共享后端不要求物理新库；新App按已批准资源配置，不由命名推导桶存在；案例按能力与症状加载。
- **移除或迁出当前流程**：入口中的注册账号/获取Cookie、缺基线写入片段及阶段性已完成表述；旧COI样例迁至独立历史文件。保留来源与迁移指针，不改写历史验收。
- **统一审批归属**：项目负责人本轮明确“谁负责仓库，谁审批所属资源”。目录记录实际仓库负责人；跨仓共享由资源归属方审批，不设统一平台审批人，不把文档作者或数据治理协作人推断为全局管理员。
- **增加维护出口**：代码改动涉及架构、协议、身份/权限、权威存储、资源或制品时，同一交付更新适用规范、模板、目录或案例，并说明兼容影响；实现已被原合同覆盖的修复不重复增全局规则。

Devin仅用SWE2对修改前快照提出12条问题，Root逐条裁定。不采纳“所有写CLI都加--instance”“固定7天回执”“一律禁止共享存储”等无适用依据的建议。走读覆盖纯卡包、独立App和已有App适配，不宣称已按新规范真实开发三套App。

本轮只做规范/索引与只读文档校验工具，并GET核对相关Appwrite元数据；未改业务代码、ACL/schema、登记或部署。Skill frontmatter改为跨Agent可识别的目录同名ID和metadata版本；Codex校验与Devin发现分别实测。链接/标题/围栏正常及负向检查、工具类型检查和资源读回等证据见 [白皮书审查报告](verification/app-standard-whitepaper-20261022/README.md)。


## 2026-10-23：白皮书3.0.5可靠性补充

完整页面后的真实云关停复验暴露Doc空闲预连接等待与最终残留锁；大回执检查又确认单槽累计容量问题。新增通用条款：网络排空与客户端断开后的业务排空分开、最终退出/锁状态必验；单条/累计回执遵守真实配额，分片内容先确认再发布索引，格式升级保留旧键并声明旧版本回退边界。同步白皮书、可靠性合同与APP_CONTRACT模板，不将Node内部实现或某次测试数量固化成平台API。

Doc/Sketch归档可见性按入口声明，未为统一测试改权限；同页组件提示层须按实例根节点归属。应用修复与最终制品/证据见 [最终验收](verification/concurrent-ui-20261023/README.md)，本地与正式MA/生产身份/staging分别报告。容量、单副本和未配置高级能力明确列限制，未宣称无限运行。
