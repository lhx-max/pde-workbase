# 文档保存与 Provider 持久化修复验收

2026-10-26。本轮范围验收通过：文档 App 的并发保护、持久化确认与原操作恢复已修复，并回写文档源码仓及共享状态包。后端继续运行于 Appwrite Functions，数据和文件继续使用私有 Appwrite 资源。正式 MA Agent 与 staging 全链路不在本次通过声明内。

## 交付与固定版本

- [可部署 Function 制品](artifacts/doc-api-recovery-20261026-34d6646a5d8c.tgz)：直接包含自包含 `main.js` 与 CommonJS package 配置，未包含验收 authority/fault wrapper。
- 业务入口 SHA256：`34d6646a5d8cd4e0d0c10ca8992bab8e88a2b4ec68e249ba2099dad6b2a855b7`。云端业务部署 `6adf100eb2849b27a6af` 与直接入口部署 `6adf10763d5a28966d86` 执行的是同一份业务字节。
- [制品清单与范围](artifacts/manifest.json)、[三路执行 SPEC 及复核要求](artifacts/specs/operations.md)、[Devin 模型与工具审计](artifacts/devin-audit.json)。组件 surface 未改；后端新增固定 vendor 包 `@ks-designai/app-cloud-state@0.1.3`，依赖和锁文件一起更新。
- Doc 源仓 `codex/app-npm-integration`，基线 `5ed788ea`；Canvas 共享包仍在当前工作分支。修复已回写本地，保留先前未提交工作；本轮未提交、推送、合 main 或改 staging。

## 修复内容

1. HTTP 一个预算覆盖 headers/body，消费或取消错误响应、未使用及迟到响应；调用方任意取消原因停止重试，写请求不自动重发。日志只保留固定类别、阶段、耗时、状态与安全 request ID。
2. 锁创建确认丢失时凭完整 owner 读回；状态写确认丢失时凭精确行身份、namespace/slot/revision/payload/updatedAt 读回。外国、缺失、畸形和迟到证据均不确认，不自动抢旧锁。
3. pending 意图保存稳定目标和输入摘要，并固定服务端独立随机 operationId（不直接使用不同协作者可能重名的请求键），业务 head/版本原子带操作标记；后续无标记变更清除旧归属。原键重放或显式 reconcile 只补原回执，不重执行业务。当前权限、资源归属和一致快照重新核验；镜像未证实则明确 unavailable。
4. 先验证 MA，再同步划分 writer lock 与 state namespace；同实例协作者共锁，回执另含 actor。legacy 与 ma-instance-v1 显式选择，不自动迁移/认领旧数据。
5. 最终补上元数据仍在途的释放屏障：路由捕获 5xx 后仍核对未确认提交。旧 head/缺行/读失败/不可证明指针返回 DOC_COMMIT_UNCERTAIN 并保留锁；原请求即使迟到，也不能覆盖释放后的下一笔。

## 验证证据

| 层 | 最终结果 | 证据 |
| --- | --- | --- |
| 干净安装 | 冻结锁、离线缓存安装通过；未安装额外运行平台 | [安装日志](artifacts/frozen-install.log) |
| Server | 255 通过 | [日志](artifacts/server-test.log) |
| Function | 70 通过，含真实 handler/runtime 的分区、故障与迟到提交回归 | [日志](artifacts/function-test.log) |
| 共享状态包 | 60 通过，类型检查与构建通过 | [日志](artifacts/shared-core-test.log) |
| Appwrite 真实业务 | 46 检查通过，含创建/原键回放、正文/图片读回、条件写、同版本并发、隔离、Provider、归档/恢复 | [结果](artifacts/result.json)、[执行 ID](artifacts/executions.ndjson) |
| Appwrite 真实确认丢失 | 15 检查通过；真实提交后在受限 wrapper 丢弃确认，日志证明故障触发，跨执行原键恢复无重复 | [结果及原响应](artifacts/fault-result.json)、[执行记录](artifacts/fault-executions.ndjson) |
| 原生产入口 | Node22 直接加载同一 main.js：健康 200，缺配置业务 503 按预期拒绝 | [记录](artifacts/entry-result.json) |
| 规范 | 68 文件/254 本地引用检查通过；Canvas 全仓 typecheck 通过 | [规范](artifacts/standards-check-final.log)、[类型](artifacts/canvas-typecheck.log) |
| 源码 guard | 包含当前源码的隔离快照 1990 文件/19 manifest 通过 | [日志](artifacts/canvas-source-guard.log) |

原工作区全量 guard 未通过：已有未跟踪验收快照/生成 JS 含绝对导入或未登记兼容入口；[原始输出](artifacts/canvas-guard.log)。未删除这些资料或放宽 guard 来消除报错。

385 项本地测试不是 383 次真实业务；61 项云端业务/故障检查与 2 项直接入口检查分开记录。并发检查要求仅一次提交，另一笔允许明确冲突或忙碌拒绝；不宣称并发请求全部 200。MA authority 是明确的隔离合同 fixture，存储与平台动态函数身份是真实 Appwrite。

主控复核曾实际复现并修正：任意 abort reason 的误重试、迟到 body 未释放、binder 跨身份复用、锁读回超预算认领、旧操作标记残留/旧终态误确认、快照变更、已完成回执的当前归属、元数据迟到提交释放风险。红绿证据：[状态归属](artifacts/root-adversarial-state-red.log)、[回执归属](artifacts/root-adversarial-receipt-red.log)、[迟到提交红](artifacts/late-commit-root-red.log)/[绿](artifacts/late-commit-root-green.log)。早期云验收脚本曾把 `data.receipt` 误读成 `data`，已修正；通过数字仅来自最终制品复验。

## 部署要求与边界

- schema 先增加 documents 的 optional `lastOperationId(220)` / `lastOperationFingerprint(80)`，等待可用；既有 providerRevision、MA 归属字段和私有 ACL 仍需满足。引导脚本默认 dry-run，使用正常服务身份，不开放公共写入。
- 现存环境默认 legacy。新布局需停旧 writer、盘点/核对状态、显式切换；每个授权实例需 provision manifest 或显式初始化。禁止只分锁却共写状态，禁止并行跑旧/新布局。
- 配置真实 MA authority、调用身份与实例写授权。实际 MA Agent 的发现、可信身份转发、正式实例以及 staging 宿主路由仍需独立验收；本轮未修改 MA 后端/SDK/调度，不把 fixture 当正式 Agent 成功。
- 独立旧壳无 key 请求、图片上传的未知回执、镜像投递、无证据旧 pending/旧锁自动接管不在本轮通过范围。首个 manifest 创建未知仍保守失败。暂时无法确认的提交可以拒绝服务；不承诺网络永不超时。
- 详细部署与 API 合同见 Doc 仓 `docs/doc-save-recovery-20261026.md`。本轮规范同步了同域锁/状态、精确提交证据、标记清理和 HTTP 生命周期要求；业务修复不固化为所有 App 必须复制的算法。

## 云端清理

验收项目 `grworkspace`，新隔离库 `doc_recovery_accept_20261026`、专用私有桶 `doc_recovery_assets_20261026`。两个临时函数均关闭；业务验收函数剩余锁为 0，未删除任何原有锁，数据保留供审计，所有新资源仍私有；[清理读回](artifacts/cleanup.json)。既有生产资源、MA mavapi、main、release_staging 与流水线未被本轮覆盖。

## 独立复核与最终补验

追加一名免费 SWE2 只读复核；[原报告](artifacts/late-review-REPORT.md) 经 [Root 处置](artifacts/late-review-ROOT-ADJUDICATION.md) 逐条判断。镜像指针变更已清除旧归属；对未确认释放不能按“进程停了”直接删除/复用旧锁槽，按停写、确认业务及state、隔离旧物理运行集合的受控人工流程处理，不提供自动原位接管。

Root另实际复现并修复跨协作者相同 key/input 的误归属，[红](artifacts/operation-identity-root-red.log)/[绿](artifacts/operation-identity-root-green.log)；操作 ID 由服务端独立生成，原 key 回放保持不变。真实 Appwrite 增加归档恢复提交后丢确认、清空 optional string 字段及原键恢复，15项故障检查均通过。
