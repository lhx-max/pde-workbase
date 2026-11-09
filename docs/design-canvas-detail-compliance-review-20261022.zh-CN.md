# Design Canvas 图片详情接入：规范核对与修改清单

2026-10-22。核对对象：`MarioDesign-FT/design-canvas` 的 `embed-canvas-surface-20261021` 分支，提交 `996622df61943932a0f1e8adfee26c7bf5c53e3a`。本机只读检出位于 `/Users/zhuzhiheng/Desktop/design-canvas`。

依据：画布 [App开发规范](../.devin/skills/designai-app-platform/docs/app-development-spec.zh-CN.md)、[开发手册](../.devin/skills/designai-app-platform/docs/app-development-handbook.zh-CN.md)、[四App交付合同](four-app-delivery-contract.zh-CN.md)及[图片打开合同](image-app-handoff.zh-CN.md)。同时阅读对方交接、源码和测试；没有修改对方源码、注册应用、调用云端写入或付费模型。

## 结论

**应保留其完整编辑器与保存核心，补接入适配和交付缺口；目前不能认定满足完整详情接入/注册规范。** 它是图片深编辑App，不替代本项目主画布，也不替代现有生图任务服务。`appId=design-canvas` 与包名可以保留，不能直接重命名覆盖现有 `image` App。

规范中 P1/P22/P23/P24 属于宿主职责，不要求对方重复实现。P18/SSE、P20快照等二期能力如实标不可用，不是本轮阻塞。正式MA Provider/登记/staging不作为先打通画布内部详情的前置，但不能宣称已通过。

## 已有基础：可以复用

- React `DesignCanvas` 组件，React/ReactDOM为peer且构建external；完整编辑器使用Shadow DOM，具备实例化入口、场景读写、图片导入、PNG导出。
- COI manifest、实例创建/列表/读取、版本化写、rename/archive/restore/duplicate、scene.json文件、持久回执、结构化错误。
- `permissions`未接真实权限服务时明确501；Provider缺可信委托时503，这些是符合诚实边界的行为。
- Appwrite用户JWT再验证、团队成员检查、用户私有作用域、CAS和持久幂等；不能因此推断已符合MA团队/业务空间/实例写授权。
- 独立图片存储及读取恢复适配，历史内嵌图片兼容；不能直接把带storageRef的原始HTTP场景传给组件。

## 画布内部详情闭环前需要补

| 编号 | 缺口与实际依据 | 修改建议 / 责任 | 成功信号 |
| --- | --- | --- | --- |
| D1 | `registration.ts`有30秒检查/重注册，但源码调用只出现在测试；`serve.ts`未接注册配置和启动调用 | 对方补App侧可配置启动/停止入口及受信任transport，或交付明确负责调用helper的部署包装层；没有启动接线不能标“已自注册” | 用实际启动命令登记；宿主目录可见正确endpoint/manifest；重启/停用/地址冲突按约定处理，不自动覆盖他人条目 |
| D2 | 当前画布图片 `open-editor`硬编码查 `image`，对方身份为 `design-canvas`；单独登记对方不会改变图片详情目标 | 我方将详情目标改为显式可配置映射，保留生图App `image` 的职责；不把两种App ID或实例ID混用 | 生图仍可调用；同一图片详情打开的是design-canvas；缺登记/禁用时明确不可用 |
| D3 | `editor.ts`绑定是`standalone-v1 + team/user/canvas/node`；已有开发绑定可重开，但首次真实源节点的授权解析未实现 | 双方先明确授权素材入口与绑定合同；对方新增host profile/授权resolver，我方交付经过验证的节点和资源上下文。不能把客户端传canvasId/nodeId/path当节点访问凭据 | 首次从真实图片卡导入；重复打开同一编辑实例；换用户/跨项目/伪造节点拒绝；源图被替换有明确行为 |
| D4 | 组件handle能exportPng、onChange只是编辑通知；尚无“保存后的结果已回到主画布”的闭环 | 双方补结果交付/取消/失败合同，明确导出格式、尺寸/透明度、资产位置、覆盖或新增策略和返回的业务版本；我方按源图版本/身份条件回填 | 编辑保存→实际主画布结果更新→关闭重开；原节点已删/替换或取消后，迟到结果不覆盖 |
| D5 | `createAppwriteStorage`直接构造公司SDK/Functions/Storage，桶名固定`canvas_images_dev`；surface只暴露编辑事件，无transport/工具服务配置。不能把开发示例当生产宿主适配 | 对方保留显式开发adapter，另提供可注入的宿主storage/asset/tool transport或包装surface；配置桶/项目/函数/服务地址，不要求改编辑器场景模型 | 同一组件能用隔离测试adapter和获授权真实adapter；不要求宿主复制其内部存储代码或提供私有桶密钥；HTTP storageRef能正确恢复 |
| D6 | 完整App中AI功能仍fetch同源`/api/tools/*`、上传`/api/uploads`；嵌入主画布时请求会落宿主origin，源码未提供统一工具transport prop | 对方将工具访问接到公开、可注入的适配层；按实际部署把每条调用绑定用户授权、任务和用量，未配置工具禁用/明确不可用 | 不改宿主全局fetch、不复制其开发服务即可定向调用；实际请求落正确服务；保存/普通编辑不因AI未配置失败；付费任务只在明确授权下验收 |
| D7 | `packages/canvas-surface/package.json`带`private:true`，构建脚本原样复制到`dist/surface`，目前只能本地pack，尚不是可发布npm交付物 | 对方准备可发布的surface产物配置，保留应用根private；核验JS/类型/CSS/字体/worker及React单实例，发布固定版本并交付校验和 | 从registry在仓外消费者安装；在完整主画布挂载并完成编辑/保存/重开，不依赖兄弟仓源码 |

D4的完成回调/图片交换在我们现有互联文档也有“待定”项，因此是双方需要补全的合同，不应单方面判定对方违反一个已经冻结的回传schema。D5允许把持久化放在宿主包装层；不要求所有App采用同一组件props名称。

## 进入共享MA/DA环境前必须补

### A1：认证、动作授权与归属

现有HTTP接收Appwrite JWT + X-Team-Id，再由Appwrite验证用户与团队，这是明确的开发profile，可以保留。我们的MA profile使用已发布的MA身份/实例读取适配和可信写策略；现有画布网关不会自动把MA授权换成对方的Appwrite用户JWT。直接接现有地址将缺少其要求的Bearer JWT，不能通过转发自报user/team来“兼容”。

对方需要App侧适配器验证可信宿主委托、绑定MA team/biz/applicationInstance与自身业务实例，并把读/写权限分开。当前保存scope为team+user+scene，未体现正式业务空间/宿主实例映射；这不是已确认的漏洞利用结论，但不足以证明四App合同要求的跨业务空间隔离。MA可读或Appwrite团队成员身份不能单独授权全部写动作。

验收包含：只读用户写拒绝、同团队跨biz/宿主实例拒绝、伪造身份拒绝、授权不可用默认拒绝；重启恢复不能靠持久化SSO凭据。

### A2：Provider交付与路由

`handleProtocol`有MA信封处理和`authorizeProvider`接缝；但当前`createProtocolServer`仅接收`/api/apps/design-canvas*`路径，`serve.ts`没有Provider授权注入，不能把这一个COI进程地址直接作为已验证的MA Provider入口。

在真实MA接入阶段再提供独立或明确复用的Provider部署入口、可信网关校验、实际应用/实例版本映射及部署manifest。缺配置继续503，不先开放假身份。此项不阻塞只做获授权的内部图片详情验收。

### A3：部署与资源限制

HTTP默认loopback，Appwrite开发项目/Team不代表生产租户。配置域名/TLS、允许origin、超时、存储项目/桶与服务身份；图片原始二进制外置不等于任意HTTP body都可超过现有限制。不要在生产使用固定开发Team或固定个人生图授权。重启恢复、真实大图、取消/回传及用量分别验收。

## 我方也有的接缝：不能全部推给对方

1. 图片详情路由当前固定`image`，需要明确配置`design-canvas`而不破坏现有生图动作；不能只写一行注册数据就宣称接入。
2. 当前泛用外部App代理提供actions、instances/state等路由，未见泛用`action-receipts`转发。若Agent只知道宿主地址，应按既有App合同补回执代理或明确获授权的查询入口。对方已经提供回执接口，不能要求其改成内部专用格式来规避我方缺口。
3. 图片输入/输出和完成回传合同需要双方确定；画布负责自己的节点/布局和条件回填，不直接写对方私有Appwrite数据。
4. 注册权限与可信transport由实际部署profile提供，不能为测试绕过我方目录治理或改一涵的宿主/SDK。

## 权限诊断补充（2026-10-22）

从CLI管理会话得到401仅证明管理接口未授权，不证明普通用户函数执行一定被拒绝。业务联调应先使用本人SSO项目身份、业务Team及函数执行策略验证，不默认申请整个控制台管理权。维护者的CLI步骤与边界见 [后端联调权限说明](design-canvas-backend-access-guide-20261022.zh-CN.md)。

## 本次验证范围

主要源码定位（相邻仓路径仅用于本机审查，不是运行依赖）：[注册helper](../../design-canvas/functions/canvas-storage/src/registration.ts)、[实际启动入口](../../design-canvas/functions/canvas-storage/src/serve.ts)、[COI/Provider核心](../../design-canvas/functions/canvas-storage/src/protocol.ts)、[HTTP门面](../../design-canvas/functions/canvas-storage/src/http.ts)、[节点绑定](../../design-canvas/functions/canvas-storage/src/editor.ts)、[组件接口](../../design-canvas/packages/canvas-surface/src/index.tsx)、[Appwrite开发适配](../../design-canvas/packages/canvas-storage/src/index.ts)、[组件包配置](../../design-canvas/packages/canvas-surface/package.json)。

- 只读审查上述commit与我方当前源码、规范，检出仓工作区保持干净。
- 实际重跑对方`designai-protocol.test.mjs`：**19项通过，0失败**。使用显式临时目录复制该测试及其core/editor/protocol/registration源文件，借用本机已有TypeScript解析器；没有安装依赖到对方仓或改变源码。
- 覆盖COI基本动作、版本/并发、回执、私有scope、Provider拒绝/模拟委托、注册helper、生命周期；fixture通过不证明真实宿主接入或共享MA身份可用。
- 对方仓内17项云端协议记录已读，但本轮未重跑云端/浏览器/付费模型；也未发布组件包、登记目录或更改数据库。

## 建议实施顺序

1. 固定双方commit和包版本，先由双方填清D2/D3/D4的App/实例/源图/结果映射。
2. 对方补D1、D5/D6、D7；我方补可配置详情入口及必要的统一代理。编辑器、场景存储、CAS/幂等核心继续复用。
3. 用真实云端隔离数据完成“图片卡打开→编辑→保存回传→关闭重开”，再验证版本冲突、越权、源图已改/删、取消与迟到结果。
4. 如目标扩展为共享DA/MA，再做A1–A3及正式注册/Agent/staging验收；内部闭环结果不替代这些门槛。
