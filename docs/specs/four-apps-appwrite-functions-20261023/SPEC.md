# 四 App Appwrite Functions 接入与交付 SPEC

日期：2026-10-23。状态：实施中，非验收结论。最终架构由用户明确：App 业务计算运行于 Appwrite Functions，权威数据与文件保存在 Appwrite；DA 容器只部署 npm React 宿主与必要的受限代理。四 App 使用各自资源，不混用生图与画布桶。

## 1. 已验证事实与基线

- grworkspace/canvas-coi@6ad6e13c3156201f4c69、doc-api@6ad7411db8beaf415a21、sketch-api@6ad73063a48ff7209caa 均实际返回能力200；文档列表200、草图列表200、画布空状态读取200。不是全功能写验收。
- 生图 editor 已有 designcanvasdev20261021/canvas-storage，历史末次记录部署6ad8db8a304e47e09e0f；保存/图片/版本/协议有历史证据，本次账号管理读取受限，当前部署未复验。
- 当前宿主 image-card-pack0.9.6 挂 createIndependentImageMaApp，与原 editor 函数是不同协议。独立后端任务/资源/回执能力必须保留，不能借用历史editor证明已接通。
- 后续Canvas/Doc partial改动不能部署覆盖已有业务。不能盲目回退所有后续鉴权、存储、租户、幂等修复。
- 冻结实施基线：/private/tmp/four-app-one-container-20261023/{canvas,doc,sketch,image}；宿主 /private/tmp/da-four-apps-staging-20261023，feature分支。原Desktop各仓保留现有改动。
- 真实调研证据：artifacts/research/20261023-four-app-appwrite-facts/。

## 2. 出口与责任

四个独立 Devin SWE2 执行单元分别负责 Canvas、Doc、Sketch、Image。Root负责共享Function传输合同、DA代理切换、打包集成、真实云端验收、发布与汇报。各代理只能修改分配的快照目录；不修改宿主、其他App、外部SDK、共享原仓或线上资源。禁止Git reset/clean、main合并、push、云端配置/部署/ACL修改。新源码/工具/测试用TypeScript；现有构建mjs兼容文件允许必要维护，不新增JS源。

每项交付必须包含：实现、路由差异表、构建制品、实际测试日志、剩余缺口、复现命令。所有“通过”标记附具体证据，不把mock当线上。

## 3. Appwrite运行与共享传输合同 v1

函数导出Appwrite handler。使用平台注入的运行身份：优先受平台保护的 req.headers['x-appwrite-key']，兼容 APPWRITE_FUNCTION_API_KEY；endpoint/project优先平台APPWRITE_FUNCTION_API_ENDPOINT/PROJECT_ID。不能从业务body、浏览器header或宿主环境继承管理Cookie/API Key。仅运行平台header区可提供内部key；合成测试通过显式注入替身。

标准HTTP请求原生映射method/path/query/headers/body。JSON按原文传递。二进制通过受限包装：content-type=application/vnd.designai.function-request+json，body={version:1,bodyEncoding:'base64',contentType:<原始媒体类型>,body:<base64>}。只有此媒体类型触发解码；严校结构、编码、大小，禁止从包装中覆盖method/path/headers/身份。协议包装不能替换业务作用域或绕过原鉴权。

二进制响应统一为JSON包装（HTTP原状态保留）：{functionTransport:'designai.function-http/v1',bodyEncoding:'base64',body:<base64>,headers:{'content-type':...,etag?:...,'content-range'?:...,'accept-ranges'?:...}}。JSON业务响应不包。仅固定响应头允许通过，不透传Set-Cookie/Location/CORS/内部header。未知或畸形包装拒绝；不能返回空字节200。

调用者MA SSO Bearer、tenant、applicationInstanceId、Idempotency-Key、If-Match按原合同传递；App函数再次验证真实MA身份和实例绑定。不得信任actor、自报userId或测试fixture。沿用项目/实例目录，不能新增一套MA真源。无写授权默认只读；不得将公开桶权限当作授权修复。

函数每次执行可复用既有纯业务服务/Express路由；若采用函数内局部HTTP桥，须只在执行期间监听随机loopback端口并在所有退出路径close，不能驻留DA容器、spawn CLI或把业务转发到外部常驻服务。不得依赖cwd、持久本地文件、跨调用内存队列或进程常驻完成持久任务。临时目录必须唯一、显式且可丢弃。

现有单写者云状态必须适配函数并发：每次执行获取有所有权验证的云锁、加载最新状态、等待持久化完成后释放，只释放自己的锁；竞争拒绝可重试，不覆盖现有锁。超时/结果不确定不得自动删锁或重放付费调用。若现有生命周期无法在函数安全运行，写出具体缺口并实现必要适配，不能通过设置local-test/关鉴权/假ready掩盖。

Appwrite平台实际运行时以list-runtimes/构建运行证据为准，目前已有函数node-22。不能声称node24专用代码在node22已验；native依赖在平台Linux安装/构建，禁止携带macOS二进制。endpoint/key缺失应给安全明确错误，不泄密。

## 4. 四 App 功能范围

Canvas：保留最新画布状态/operations/receipts/卡片/文件/资源引用/Provider/租户合同；图像业务仍归Image。CLI和surface调用同一业务。当前原函数已有基本actions，必须与最新路由逐项比较。
Doc：正文、元数据、版本条件、幂等回执、图片字节、Provider、open-editor、镜像投递/恢复和归档均按已实现合同保留。不能退化到仅REST正文保存。
Sketch：场景JSON/图片导出/版本/回执/Provider/open-editor/绑定与租户隔离保留；关闭已知partial协议缺口。
Image：明确复用已有editor/canvas-storage实现的位置；新增独立workspace/assets/jobs/receipts/模型与已接DesignAI工具必须有Appwrite Functions运行入口，不用旧editor已验收掩盖新能力缺失。保存必须进Image独立桶，Canvas仅引用/预览。模型凭据逐调用者授权，不借用维护Cookie、不拿MA JWT当模型token。
Image异步任务：必须在函数返回后仍有平台可执行的持久任务机制，或显式有界执行并在返回前确认完整结果。不能submit后靠进程内queue继续跑，也不能为了关停把成功任务一律改成interrupted。持久job+supplierCheckpoint+幂等键防止重复费用；失败/取消/超时/部分结果/重启恢复必须有测试。不自动迁移或删除历史editor项目数据。

## 5. 部署与兼容

交付每App的函数源码入口、平台构建脚本、manifest（functionId、public routing、scopes名、env名、资源ID、版本/哈希）、路由合同及回滚说明。配置中无密钥、Cookie、个人路径或模拟正式App ID。部署脚本不默认修改既有execute/scopes/ACL，不隐藏失败，不用 || true 掩盖失败，保留旧deployment。

Root维护Appwrite-aware同源BFF：固定项目/函数目的地，保留method/path/idempotency/状态与二进制，无任意URL代理、不转发ambientCookie/内部key；校验MA实例后再调用。外层execution 201不等于业务成功，必须解析responseStatusCode/responseBody，错误不改200。取消/超时不自动重试写入。

DA不再启动四App常驻子进程，不打包后端CLI为生产依赖。前端版本保持可安装固定制品；必要的surface transport适配只在所属App公开接口实现。

## 6. 验收矩阵

A 源码与路由：能力清单逐项对应实现；不残留全业务501；legacy已存在数据兼容。
B 本地handler：真实handler执行JSON和二进制读写；成功、未知路由、缺身份、伪actor、跨tenant/biz/instance、撤权、缺写授权、错误status、超限。
C 持久化：同请求重放不新增版本/模型费用；同key不同输入拒绝；旧revision拒绝；并发仅一个提交；跨execution重建读取一致；文件哈希一致、缺资源拒绝、异常不删他人锁。
D 生命周期：无驻留子进程/未关listener、无仅内存权威状态、所有成功返回前durability确认、后台任务具平台生命周期。
E 包与运行时：独立函数包可构建加载、React-free、无原仓绝对依赖/密钥/macOSnative；目标Node实际验。
F 云端：Root在隔离资源上实际部署并执行读写/图片/refresh等，再对齐MA。App源码本地完成与云端验收分别记录。

代理交付使用 docs/verification/appwrite-functions-20261023/RESULT.md 与 result.json，逐项明确 passed/failed/not_run；所有结果可复现。Root独立复核再称完成。

## Root复核补充

2026-10-23 已发现草图surface使用响应头 x-content-revision 与 x-sketch-draft-scope；Function与宿主必须保留这两个已发布业务头。last-modified亦可保留；content-length由返回真实字节重新计算，不透传包装长度。现有四项响应头列表据此增补，不扩大到任意内部头。

禁止Function生产维护Cookie回退、错误原文/堆栈泄露、成功返回后才确认持久化、吞掉flush或锁释放错误。提交结果不确定时关闭临时资源但保留锁，防止后续写入与迟到提交竞争。各代理交付需测试这些失败路径。


## 平台实测与补充验收（2026-10-23）

- 隔离探针已证明内部平台为 Node 22.22.0/Linux x64，支持 node:sqlite，平台通过请求头注入执行级密钥；使用该身份读取私有桶元数据200。不需要为此在DA容器复制四套静态存储密钥。
- 函数入口必须返回平台 res.json/res.text 的实际返回值。只调用 res.json 后 return void 会被内部运行时判定为未响应；本地替身须用不透明响应对象验证返回值，不能仅观察回调副作用。
- 生图本轮唯一支持有界同步执行 profile：任务在提交执行返回前落定，拒绝未提供可信签名与实时MA复核的worker配置。不得用每次执行不同的运行密钥签发跨执行令牌。未知调度结果不得自动改为同步重跑。
- 文档open-editor记录属于跨执行恢复信息，使用Appwrite状态端口持久化；重新打开时校验实时文档范围、归档与绑定，不保留仅内存Map作为云端权威。
- schema/索引/ACL由显式provisioning负责。生产执行只申请所需documents/files读写与collections/buckets元数据读取scope；部署脚本默认只打包，不暗中开放execute、改ACL或激活旧资源。

隔离候选函数的构建/启动检查与真实MA授权下的业务读写、跨App互联、模型工作流和staging产品验收分别登记；配置缺失时的503只证明拒绝正确，不能算业务成功。
