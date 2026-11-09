# 四 App staging 部署前复验 SPEC

本轮目标：不再以缺配置503或内存Appwrite替身作为业务出口；在私有隔离资源上，经真实Appwrite Functions执行完整业务请求，确认创建/读取/条件写/重放/归档/附件字节/跨执行恢复。发现实现问题先修再复测。不得修改已有线上函数、旧库/桶ACL、宿主SDK或一寒代码；不迁移用户数据。

分层结果必须分别记录：真实云函数执行、真实数据库/文件、MA协议授权夹具、正式MA、真实模型、浏览器与staging。夹具不得标为正式身份联调通过。平台owner-only执行授权与App业务授权分开报告。

## 固定范围

四个Devin CLI SWE2执行单元仅编写各App的复验场景，Root负责资源预置、平台部署、运行、验收和修复整合。代理无云端/网络操作、密钥/会话读取、Git修改或依赖安装权限。不覆盖已有源码；输出到各自专用任务目录。

真实资源由Root用已有私有预置工具先plan/inspect再apply：grworkspace项目，数据库 `<app>_app_fnaccept_20261023`，桶 `<app>_assets_fnaccept_20261023`，runtime集合app_runtime_state；Canvas/Doc/Image namespace=`<app>-fnaccept-20261023-v1`，Sketch只用runtime写锁集合。字段/索引/manifest须就绪后才执行业务。保持documentSecurity/fileSecurity及空广泛授权。

生产业务handler使用已封存的相同代码；验收专用wrapper仅通过已存在的工厂/env/fetch端口提供明确MA协议夹具。所有Appwrite存储请求使用平台每次注入的运行身份，真实访问私有云资源，不模拟响应、不部署维护Cookie、不存调用方SSO。

夹具仅截获固定 `https://ma-fixture.invalid/api/ma-v/v1/` 的/me与实例读取，其余存储请求真实发往Appwrite。验收函数仅当前operator可执行，不能作为正式对外服务。profile=a/b/reader/revoked/none；a与b为不同team/biz/applicationInstance/provider范围，reader与a同范围但无写授权，revoked一律拒绝。固定标明这些是授权合同夹具而非正式MA。

## 场景执行接口

每个App输出scenario.ts，导出`actions: string[]`（实际写动作列表）、`run(invoke): Promise<Result>`。invoke参数 `{method,path,body?,headers?,profile?:'a'|'b'|'reader'|'revoked'|'none'}`，body为JSON对象或文本；二进制上传沿用已实现v1包装。返回 `{status,body,headers}`；二进制Function响应包装由Root解码为`bytes`。

每次invoke对应一个真实平台execution；同实例执行后重建/再次读取不得只依赖进程内变量。失败立即抛出含动作/期望/实际的安全错误，不打印凭据。写入输入为固定测试文本/生成的图片，资源ID由真正返回解析，不猜ID。结果包含测试名、实际状态、业务ID/版本/稳定操作ID及文件hash。

共同场景：create→read→write→fresh-read；同key同输入重放、同key异输入冲突；旧revision拒绝；无身份、reader写、跨实例/tenant读写、撤权拒绝；同revision并发至多一次提交（繁忙拒绝可记录但不能冒充409）；archive后可见性与晚到写拒绝。尽量验证HTTP/API、Provider、回执和CLI公开语义同一数据。接口不支持的内容如实列明，不虚构字段。

Canvas增加实际operation、文件上传下载hash、布局/资源引用；Doc增加正文/图片、open-editor跨execution恢复；Sketch增加场景版本、图片/导出字节、Provider条件写；Image增加独立workspace/assets/jobs、实际本地图片变换经云函数执行/落桶/readback、输出解码尺寸、replay不二次执行。外部模型/DesignAI凭据缺失应明确不可用，不允许假token或付费调用。

## Root收尾

逐请求保留executionId、请求摘要、业务status、JSON/文件hash及资源策略读回；不保存token/cookie/key。独立重读实际文件/数据库与锁，检查无未处理后台任务或未知锁。发布物与验收部署哈希对应；真实UI/MA/模型仍需各自证据，不以本轮存储成功补记通过。

最后给出staging前清单：已通过、已修复并复验、外部缺口、可否进入部署。源代码可部署、候选运行和staging上线分别陈述。
