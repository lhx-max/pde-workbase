# 四 App 后端/CLI 监管与复验 · 2026-10-22

> 历史验收快照：以下为记录日期的结果和现场路径，不作为当前配置；不应重建已退役的数据目录。原始日志/会话不随源码交付，当前版本以发布清单为准。

本批进行中；不代表69动作、全部UI、正式MA/Agent或staging全部通过。Devin只用swe-2-high，导出模型审计没有其他模型或子代理；Root独立复现后修复。原始执行目录 `/private/tmp/ma-backend-spike-20261022/`。只修改App自有代码/脚本，不修改宿主/SDK、分支、Git index或部署。

## 已确认并修复

| 问题 | 修改及真实依据 |
| --- | --- |
| Sketch新私有库缺MA归属三列、写锁集合及配置 | Devin隔离实现，Root修正测试基线和helper位置；新建真实私有Appwrite库，三字段可用、写锁可用、第二写者拒绝、独立安装CLI28项通过 |
| Sketch开发入口实际全网卡监听，日志却称loopback | Root对实际进程 lsof 复现 `*:19983`；改非生产默认127.0.0.1后实际监听127.0.0.1:19983；只终止本次探针 |
| Sketch临时无键回执无限累积 | 新增64条限额；只淘汰无键回执，带幂等键回执保留避免重复执行；70次真实HTTP mutation回归先红后绿 |
| Canvas只读成员无法POST等待媒体任务 | 只对两条精确media wait路由按read授权；GET/等待可读，取消/重试/其他wait后缀仍403；先红403后绿 |
| Doc无业务空间声明对legacy biz资源的通配 | 资源/actor bizId双侧严格匹配，镜像队列同步修复；无biz不代表能访问任意biz，完整MA元组检查保留 |
| Doc Provider原始类型input触发500 | 解析期拒绝null/字符串/数字/布尔/数组；现场旧进程确认500 DOC_INTERNAL，单测及重启后真实HTTP复验400 BAD_REQUEST通过 |
| Doc metadata PATCH缺单写者要求 | rename/archive/绑定镜像PATCH补相同闸口；默认构造不再允许绕过该要求，正常单写者与幂等正文不变 |

Root最终测试：Canvas629通过/1跳过（未注入真实云凭据的旧live suite），Doc191通过，Sketch61通过，三服务类型检查通过。Canvas Web514、Workbench262、Image142、Kit21和Canvas surface4为本轮对应表面通过结果；单测不代替UI/CLI/云端逐项验收。

CLI生命周期真实子进程覆盖文档/草图创建、列举、读、写、打开、改名、复制、归档、恢复及恢复后读回，均使用独立本地测试tenant，不冒充云端或MA生产身份。云端证据与本地拼装页面分开。

## 清理限制

`fresh-private-schema.json` 的功能检查全部通过，但整体passed=false：平台对删除数据库、集合返回403 general_api_disabled，明确禁止删除。私有测试库 `skpriv-20261022-dfbdd1ae` 及两个空私有集合保留；所有测试行/写锁/文件已清，桶已删除，没有绕过平台保护。需要平台管理员处理空库时可据此ID定位。不能把functionalPassed:true改写为完整清理成功。

## 未完成

- 运行服务已重启加载修复；Doc真实HTTP400、四Provider dispatcher复验及Canvas/Doc真实Appwrite恢复74项/48项清理再次通过。
- 69公开动作的剩余CLI/真实存储/UI矩阵、完整生图editor与各工具交互、同页多实例异步隔离。
- 原MA真实登记存储门、逐用户模型授权、LLM自主多步工具调用、生产/staging仍单列，不以本地fixture替代。

## 后续实际页面与CLI复验

- 图片Worker在MA重打包后原先启动失败。App自有构建将Worker内联，不改宿主或生图SDK；真实页面旋转、预览、保存、刷新及规范文件下载成功，112×672，逐像素对比最大差0。
- 页面生图提交错误地传入浏览器资源桥地址，后端正确拒绝 DELIVERY_TARGET_INVALID。新请求在持久化outbox前组装规范项目文件URL；旧outbox重放保持原请求不变。新增回归先红后绿，Workbench262项通过、类型检查通过。
- 修复后的页面实际调用Gemini，任务 canvas-6417d542-c437-450c-a094-831e5682ed18 在38秒后done/delivered；规范PNG为2048×2048、5,381,931字节，完整解码及刷新图片保留，见ui-generation-readback.json和ui-real-generation-after-refresh.png。全轮实际成功模型请求3次：GPT一次、Gemini两次；另有一次地址校验失败发生在模型执行前。
- 最新安装包 ks-designai-canvas-surface-0.1.4.84a57c9c7d1d.tgz，内容哈希见delivery-url-package.json。Canvas surface4项与最终guard通过。
- Canvas39动作：38条支持动作经真实CLI及Root逐状态读回验证；canvas.duplicate明确声明不可用且501，52条检查记录，不能将其计作功能实现。
- 图片真实Appwrite维护入口的CLI配置/状态/CPU裁剪/编辑状态读写及幂等13项通过；裁剪32×24，编辑版本1；本组没有模型生成，独立项目已逻辑归档。
- 草图bind/export-image和文档retryMirror补验由Devin执行，Root另建隔离tenant复跑22/22。bind仅记录本地映射，返回unbound；export-image证明客户端PNG上传/存储/下载/解码，不能称后端渲染；doc.retryMirror明确未配置，CLI非零退出且正文/版本不变。
- 自动化语义点击删除未生效后，改用截图定位的真实鼠标点击删除本次失败测试卡成功；规范服务读回仅该节点消失，剩余5图保留。未确认产品缺陷，不据此改代码；失败任务错误记录保留。

复现：按本地联调说明启动服务，在本仓执行 e2e/ma-cli-isolated-acceptance.ts --local-test --output-dir /absolute/evidence-dir。remaining-cli-verify-root.ts.txt仅为原始执行存档，固定了当次目录；后续重复执行使用已维护脚本。它只新建唯一tenant资源并最终归档，不能针对生产或真实MA身份运行。

## 文档页面实际导出

从原MA页面内文档App分别点击下载Word/Markdown/TXT，实际浏览器下载3个文件。Word为有效DOCX ZIP，document.xml含标题和完整正文；MD/TXT正文读回一致。见ui-document-export-readback.json及3份文件。这里只验实际导出与语义内容，不冒称Office排版视觉验收。

维护的可重复CLI脚本为 e2e/ma-cli-isolated-acceptance.ts，Root再次运行22/22，独立TypeScript检查通过。启动、参数及层级边界详见 docs/ma-local-integration-runbook.zh-CN.md。

草图页面重复点击“导出为图片”后，规范服务下载PNG672×112并完整解码成功，见sketch-ui-repeat.json。三个后端package-scoped build通过；本轮新CLI脚本类型检查与最终guard通过。规范复盘补充的是现有合同的具体验收点，见 docs/app-development-standards-audit.zh-CN.md §9。

## 异步图片CLI监管收尾

Devin初版在同一进程启动HTTP服务却使用spawnSync调用CLI，造成事件循环阻塞；该轮0断言且失败，原结果保留，未采信。Root改用异步execFile，独立启动隔离服务复跑18项：生成/PNG读回、幂等不重复调度、重生成保留旧输出、非所属卡取消拒绝、owner取消/abort/终态，以及取消后同来源可再次生成并交付，服务和监听器均正常关闭。这里媒体执行器是有意受控fixture，4次fixture dispatch、0真实供应商调用，绝不计入3次真实出图。

69公开动作的CLI列现都有分层证据：67条具有正向记录、canvas.duplicate声明不可用/501、doc.retryMirror仅未配置拒绝。存储/身份/执行器层级见cli-coverage-summary.json；不因此把其余UI或MA/云端列改成PASS。
