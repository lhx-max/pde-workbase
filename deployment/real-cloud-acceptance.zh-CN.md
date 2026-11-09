# 四 App 真实私有存储验收复现

本检查使用实际 Appwrite 私有资源，MA 为明确的本地协议 fixture。Canvas/Doc/Sketch 运行固定 Linux amd64 生产配置镜像；Image 使用已安装同版本包的 Node 24 本地维护入口，精确绑定 127.0.0.1。它不验证正式生产 API Key、MA 目录/用户、模型 broker 或 Agent 工具桥，不部署 staging。

## 准备

1. 按 [当前部署交付](DELIVERY-20261023.md) 导入基线和增量镜像，核对 image ID；本机准备 Node 24、pnpm 10.33.2 和本仓依赖。
2. 由资源负责人使用 [初始化工具](private-storage-bootstrap.zh-CN.md) 创建四套新的独立 `canvas_accept_*`、`doc_accept_*`、`sketch_accept_*`、`image_accept_*` 数据库与桶。不得指向开发业务库、正式库或旧桶；验收不自动重置或删除数据。
3. 将同一冻结 Image npm 包安装在独立消费目录。取得 `dist/app-backend/serve.js` 的 SHA256，并与交付的 image-runtime-inputs.json 中同名键核对。原生依赖按当前机器平台安装，不使用源码软链。
4. 资源负责人在本机提供已获准的非生产维护会话文件；文件不进入仓库、制品、容器、浏览器或执行 Agent。维护身份只在宿主适配器和本地 Image 服务内使用，不能用于生产部署。三容器仅取得单次随机测试通道凭据；模拟 SSO 也每次随机生成。

## 显式配置与执行

在仓库外保存权限 600 的配置，例如：

```json
{
  "profile": "owned-private-acceptance-only",
  "allowTestBusinessWrites": true,
  "prefsFile": "/absolute/private/appwrite-console-prefs.json",
  "nativeImageEntry": "/absolute/consumer/node_modules/@ks-designai/image-card-pack/dist/app-backend/serve.js",
  "nativeImageEntrySha256": "REPLACE_WITH_THE_ACTUAL_64_CHARACTER_SHA256",
  "resources": {
    "canvas": {"databaseId":"canvas_accept_run01","bucketId":"canvas_accept_assets_run01","namespace":"accept-canvas-run01"},
    "doc": {"databaseId":"doc_accept_run01","bucketId":"doc_accept_assets_run01","namespace":"accept-doc-run01"},
    "sketch": {"databaseId":"sketch_accept_run01","bucketId":"sketch_accept_assets_run01"},
    "image": {"databaseId":"image_accept_run01","bucketId":"image_accept_assets_run01","namespace":"accept-image-run01"}
  }
}
```

占位值必须替换为本次已批准且实际初始化的资源。该运维验收入口固定用于公司 grworkspace 非生产项目；生产身份不通过本入口模拟。

```sh
pnpm exec tsx e2e/four-private-containers.ts \
  --manifest /absolute/release/manifest.json \
  --owned-cloud /absolute/private/acceptance-config.json \
  --output /absolute/evidence/real-cloud-result.json
```

不传 owned-cloud 时仍是四个实际生产配置容器、HTTPS 协议 fixture 的独立验收。两种结果分别保留，不能将前者混称为四生产身份真实云端通过。

## 结果与清理

报告包含精确镜像 ID、实际平台/Node/用户/模式、业务主键与哈希、拒绝/撤权、持久回执和重启结果。实际云端覆盖四 App 的写读、CPU 任务、画布引用/认证预览、跨实例隔离、原请求重放及锁释放；供给方派发为零。计数仅覆盖宿主适配器捕获的请求，原生 Image 直连云端请求未计入，不当作总流量。

检查只允许新测试资源内的文档/文件操作；schema 复核的传输层强制只读。新文件私有化 PUT 仅允许空授权，不能用此入口改账户、组织、schema 或旧库。生产 Image 拒绝非私有文件的行为保留；维护上传由其已有的明确维护合同处理，不修改响应伪造私有。

仅停止/移除本轮标识明确的容器和原生子进程；原运行服务、镜像、卷、业务资源与验收数据保留。重复运行生成新的测试作用域和画布 ID，避免覆盖上一轮对象。异常、超时与首轮失败证据保留，不能删数据以获得通过。正式环境仍需以其实际运行身份和已授权用户另验。

## 外部 CLI Agent 与同作用域恢复

需要由执行 Agent 操作已安装 CLI 时，在 owned-cloud 模式追加 `--agent-handoff /absolute/private/handoff.json`。完成初始业务与重启检查后，服务保持最多 15 分钟；描述只记录测试端点、实例、受限动作和一次性模拟身份文件位置。维护会话与配置仍由 Root 持有，不交给 Agent。Root 核验实际产物后，才向描述中的 rootCompletionFile 写入 `{"rootReviewed":true,"passed":true}`。超时、SIGINT 或 SIGTERM 清理本轮服务，保留报告与云端数据。

需要在完全停服后继续复核时，使用同一 owned-cloud 配置并同时传入 `--resume-agent-handoff /absolute/private/previous-handoff.json` 和新的 `--agent-handoff /absolute/private/resumed-handoff.json`。仅恢复隔离 fixture-team 作用域及原四实例；不创建或覆盖业务数据，模拟凭据重新生成。固定版本重启后实例可读是恢复条件，Root 仍须另核内容、回执、文件字节与失败路径。不得将恢复检查数量与新建业务检查相加宣称所有门通过。

实际记录见 [四 App 外部 CLI Agent 复核](../docs/verification/four-app-agent-cli-20261023/README.md)。外部执行 Agent 通过 CLI 不等于 MA 远端模型已获得工具发现与调用通道。

## Provider 生命周期与页面恢复补验

追加 `--lifecycle` 覆盖 Doc/Sketch 规范 Provider 的创建、重命名、独立复制、归档原键回放、恢复原键回放、活动恢复无变更、普通画布绑定清除、私有导出拒绝与完整停服后的同入口读取。归档读取按各App既有profile：已知业务ID完整授权审读保留；Doc Provider保留审读，Sketch规范绑定查找不发现归档资源；归档写入拒绝；失败原件保留，不自动认领同作用域副本。

由 Root 操作实际 UI 时，用 `--review-handoff /absolute/private/review.json` 代替 `--agent-handoff`；这只提供明确的本地 UI 协议身份，不是 Agent 或正式 MA 验收。两者不能同时使用。需要同状态复核可配合 `--resume-agent-handoff`；分别保留新建验收和恢复检查数量。

将最终 Doc/Sketch tarball 安装到独立 Node 24 消费目录，运行：

```sh
pnpm exec tsx e2e/ui/doc-sketch-cloud-ma-fixture.ts \
  --handoff /absolute/private/review.json \
  --consumer /absolute/installed-consumer \
  --output /absolute/evidence/ui.json --drop-doc-write-once
```

该入口仅绑定 loopback，只允许本轮已验证规范实例的 read/write，单次模拟身份保留服务端。首次文档提交已到后端成功后故意丢失响应；须人工点击原请求重试，核对相同输入/版本/键只改变一次业务内容，错误与暂停解除，下一次编辑可自动保存。草图实际创建图形、保存、刷新，核对页面图形与云端元素，不能只看“已保存”。宿主提供明确外部尺寸，App 包装层管理内部 flex 布局；夹具样式不得污染内层 section。

Root 只有在独立读回与页面均通过时才写完成标记；失败写 `passed:false`，保存截图、跟踪与报告。UI 截图和 trace 不含凭据；维护会话、配置、handoff 凭据及完整 Agent transcript 不进入制品。

## 最终关停与负向检查

验收脚本使用30秒正常关闭窗口，记录每个自建容器最终退出码/OOM状态，并在关闭网关之前再次检查四App写锁。容器移除数不代表锁释放；退出137、未确认停止或残留锁会使整体失败。禁止自动删除他人/未知锁、按TTL抢占或清库重试。明确属于已停止自建隔离测试的恢复，须独立核对owner、容器终态、规范业务字节及版本，并留快照和操作证据。

`--simulate-unclean-stop`仅用于无真实云端的协议夹具：在已完成业务检查后SIGKILL本次自建Doc容器，预期报告failed并捕获退出137/残留fixture锁。该参数与owned-cloud、handoff或production同时使用时在加载配置/启动服务之前拒绝；不得用于真实数据。
