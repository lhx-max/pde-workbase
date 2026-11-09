# 云端恢复收口 · 2026-10-22

四路 Devin CLI 均完成执行，仅使用 `swe-2-high`；主控复核后修正了严格 JSON 投影、凭据过滤、失败后缓存访问、跨域回执测试、重复响应和测试清理问题。Devin 报告不作为验收依据。

本轮画布/文档完成：业务绑定、App 治理、审计、文档同步意图、应用清单、项目事件、素材库、图片任务去重/恢复、文档 COI/Provider 回执及镜像 outbox 改由 Appwrite 版本化业务记录持久化。素材字节独立进入 Storage；不备份整个目录或 SQLite 文件。

证据：[验收目录](verification/cloud-recovery-20261021/README.md)。真实 Appwrite 33 项恢复检查通过，旧测试临时目录删除后重建服务；同键请求不重复生图，运行中任务变为 interrupted，不自动重新调用模型。所有测试资源清理通过。

边界：单写者/单副本，尚无分布式 CAS；每个状态槽上限 1 MiB，审计最多 4096 条，素材库工作集上限 256 MiB，超过明确失败、不截断。云媒体仅支持 image，video/audio 明确不可用。文档普通 REST 不宣称具有跨重启幂等回执；回执覆盖 COI/Provider 变更。画布生命周期回执、正式 MA 权限映射/撤销、Agent 实际调用、staging 和生产仍需单独验收。本轮 MA 身份、模型和镜像传输均为隔离 fixture，不是在线 MA 通过证明。

## 初始化与运行

先按服务身份 provision 私有 `app_runtime_state` 集合，再显式初始化一个唯一命名空间：

```sh
pnpm exec tsx scripts/provision-app-runtime-state.ts --database canvas_app_dev --collection app_runtime_state --namespace <explicit-namespace> --apply --output /absolute/report.json
```

凭据由已有环境配置提供；本机维护者可额外指定 `--prefs /absolute/prefs.json`，仅限开发数据库。不要将维护会话用于共享环境。

画布云 CLI 需 `APPWRITE_RUNTIME_COLLECTION=app_runtime_state`、`CANVAS_RUNTIME_NAMESPACE=<initialized-namespace>`、`CANVAS_APPWRITE_SINGLE_WRITER=true`、`CANVAS_REPLICAS=1`。文档对应 `DOC_RUNTIME_NAMESPACE`、`DOC_APPWRITE_SINGLE_WRITER=true`、`DOC_REPLICAS=1`。应用启动不自动创建集合或命名空间，缺失立即不可用。`run-image-cloud-dev.ts` 另需显式 `--runtime-namespace`。

真实探针复现：

```sh
pnpm exec tsx e2e/cloud-runtime-recovery.ts --prefs /absolute/prefs.json --doc-repo /absolute/designai-app-doc --output /absolute/recovery.json
```

探针创建独立测试 namespace/team/资源并清理；不读取或重建已弃用的桌面 canvas-data。`--doc-repo` 仅是跨仓测试源码入口，不是生产依赖。
