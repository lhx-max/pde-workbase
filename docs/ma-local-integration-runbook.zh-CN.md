# 四 App 本地联调复现

本轮入口：[MA 本地模拟目录](http://127.0.0.1:18582/?session=s_b9c4575a1ba14c66bb0080b3d2e6ea)。原宿主 `/private/tmp/da-ma` 的源码、SDK、菜单和Agent调度未修改。18582只用于单机隔离验收，不可作为共享或线上部署入口。

## 启动

先使用 Node 24 / pnpm 10.33.2。检查端口的实际进程；已有进程则复用，不能为腾端口终止不明进程。三个业务端口为19463（画布/图片）、19464（文档）、19465（草图）；原宿主18580，模拟目录18582。

原宿主在它自己的目录按现有 tools-dev 启动：

```sh
cd /private/tmp/da-ma
NODE_OPTIONS="${NODE_OPTIONS:-} --max-old-space-size=8192" \
  pnpm tools-dev start web --daemon-port 18460 --web-port 18580 --json
```

在画布仓，分别在两个终端启动真实 App 服务和显式模拟目录：

```sh
cd /Users/zhuzhiheng/Desktop/canvas-workspace
pnpm exec tsx e2e/ma-local-services.ts --local-test \
  --data-dir /Users/zhuzhiheng/Desktop/canvas-workspace/.tmp/ma-four-apps-20261022/data \
  --doc-source /Users/zhuzhiheng/Desktop/designai-app-doc \
  --sketch-source /Users/zhuzhiheng/Desktop/designai-app-sketch \
  --single-user-image-url http://127.0.0.1:17465 \
  --image-token-file /Users/zhuzhiheng/Desktop/canvas-workspace/.tmp/image-generation-local/adapter-token
```

```sh
cd /Users/zhuzhiheng/Desktop/canvas-workspace
pnpm exec tsx scripts/ma-registration-simulator.ts \
  --data-dir /Users/zhuzhiheng/Desktop/canvas-workspace/.tmp/ma-four-apps-20261022/directory \
  --port 18582 --canvas-port 19463 --doc-port 19464 --sketch-port 19465 \
  --manifest-dir /Users/zhuzhiheng/Desktop/canvas-workspace/docs/verification/ma-four-app-local-20261022/manifests
```

生图17465是维护者原先已运行的设备授权服务；凭据只从私有文件读到服务端，不能复制进浏览器、URL或报告。必须确认原服务授权 ready 且模型已配置。服务未启动或授权过期时，按生图仓自己的启动/授权流程恢复，不伪造状态。不使用生图时可同时省略两个image参数，此时生成应明确不可用。

Kit已安装本地候选包 `ks-designai-canvas-surface-0.1.4.84a57c9c7d1d.tgz`；SHA见 `verification/ma-backend-local-20261022/delivery-url-package.json`。切包后重启原开发宿主并完整刷新。不要以跨仓源码软链替代交付包。

## 无模型调用的可重复验收

服务启动后，在画布仓运行：

```sh
pnpm exec tsx e2e/ma-cli-isolated-acceptance.ts --local-test \
  --output-dir /private/tmp/ma-cli-next-verification
```

脚本仅访问loopback19464/19465，每次创建唯一测试tenant和自己的文档/草图，执行真实CLI子进程，最后逻辑归档。输出目录内保存输入及result.json；22项断言含bind映射持久化/幂等、PNG上传下载及解码、无效输入拒绝、镜像未配置拒绝且正文/版本不变、归档读回。它不调用模型、不读取用户实例，不将本地映射返回unbound当作Canvas同步通过。

全量Canvas CLI的本轮52条记录和逐状态断言见 `verification/ma-backend-local-20261022/canvas-cli-root-state-result.json`、`canvas-cli-root-readback-checks.json`；对应脚本存档为 `canvas-cli-verify.ts.txt`，使用显式source-dir与output启动自己的临时Canvas服务，不连接用户工作区。运行前将存档复制到显式临时工作目录，按文件头说明以Node24及本仓tsx执行。脚本内部断言与Root逐状态复核分别记录，不能只看进程退出值。

页面验收应实际操作并刷新读回：文档编辑保存；草图编辑保存、导出；画布图片解码；图片旋转、保存和生图回填。生成测试会真实调用企业模型，只在需要证明该链路时执行；不要用重复点击或无界重试代替查询已有任务。

## 当前结论与边界

- GPT-Image-2和Gemini真实出图均通过；页面实际Gemini生成/回填/刷新及规范PNG解码通过。此轮成功模型调用共3次；另一次请求在地址校验阶段失败，没有走到模型执行。
- CLI与后端专项详见[证据报告](verification/ma-backend-local-20261022/README.md)，逐动作状态见[69动作矩阵](ma-four-app-action-matrix-20261022.md)。声明不可用的动作不算已实现。
- 当前拼装页的身份、目录和存储都是显式隔离测试。真实Appwrite恢复/私有schema/CLI另有独立证据，不代表当前页面已经使用云端权威数据。
- 原宿主规则选择读取动作，Provider实际读取，真实Agent接收结果并总结，已验；LLM自主选择及多步工具调用尚未证明。正式MA登记存储门、逐用户模型授权、生产IAM、完整图片editor和staging继续单列。
- 平台禁止删除数据库/集合：本轮空私有测试库 `skpriv-20261022-dfbdd1ae` 及两个空集合仍在，行/锁/文件已清、桶已删。不得绕过平台删除保护。
- 未更换六仓HEAD/分支，未提交/推送/合并/部署。用户原有未提交文件保留；详见preservation-final.json。
