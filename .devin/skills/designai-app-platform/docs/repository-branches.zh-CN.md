# 仓库分支用途

资料快照日期：2026-10-23，来自当日仓库核对与交付说明。该表用于找代码；执行前向维护者确认兼容基线，并重新核对远端 commit、实际包版本和部署环境，不以分支名判定已上线。资源与负责人见[资源目录](platform-resource-catalog.zh-CN.md)。

| 仓库 | 分支 | 用途与边界 |
| --- | --- | --- |
| designai-app-canvas | [main](https://kdev.corp.kuaishou.com/git/design/designai-app-canvas/-/files?repoId=647299&repoName=designai-app-canvas&branchName=main) | 当前集成主线，已合入本轮独立生图接入与工具消费适配 |
| designai-app-canvas | [feat/zhuzhiheng-card-pack-base](https://kdev.corp.kuaishou.com/git/design/designai-app-canvas/-/files?repoId=647299&repoName=designai-app-canvas&branchName=feat%2Fzhuzhiheng-card-pack-base) | 早期卡包开发基线，阅读旧材料时会遇到；新任务先与当前 main 核对差异 |
| designai-app-doc | [codex/app-acceptance-20261021](https://kdev.corp.kuaishou.com/git/design/designai-app-doc/-/files?repoId=647337&repoName=designai-app-doc&branchName=codex%2Fapp-acceptance-20261021) | 已推送的云端恢复、权限与交付联调验收线 |
| designai-app-doc | [main](https://kdev.corp.kuaishou.com/git/design/designai-app-doc/-/files?repoId=647337&repoName=designai-app-doc&branchName=main) | 较早的文档编辑器主线，尚未包含上述验收线的全部改动 |
| designai-app-sketch | [codex/app-acceptance-20261021](https://kdev.corp.kuaishou.com/git/design/designai-app-sketch/-/files?repoId=647314&repoName=designai-app-sketch&branchName=codex%2Fapp-acceptance-20261021) | 已推送的场景云存储、权限与交付联调验收线 |
| designai-app-sketch | [main](https://kdev.corp.kuaishou.com/git/design/designai-app-sketch/-/files?repoId=647314&repoName=designai-app-sketch&branchName=main) | 早期拆分与 open-editor 接入主线，尚未包含上述全部验收改动 |
| designai-app-image | [feat/zhuzhiheng-independent-image-workflow-20261023](https://kdev.corp.kuaishou.com/git/design/designai-app-image/-/files?repoId=647896&repoName=designai-app-image&branchName=feat%2Fzhuzhiheng-independent-image-workflow-20261023) | 本轮独立后端、私有桶与 0.9.3 工具包的集成来源 |
| designai-app-image | [workflow-image-three-tools-20261023](https://kdev.corp.kuaishou.com/git/design/designai-app-image/-/files?repoId=647896&repoName=designai-app-image&branchName=workflow-image-three-tools-20261023) | 李鹏的工具与界面更新来源；完整 editor 与独立后端仍须区分 |
| designai-app-image | [main](https://kdev.corp.kuaishou.com/git/design/designai-app-image/-/files?repoId=647896&repoName=designai-app-image&branchName=main) | 较早的 MVP 主线，不能替代上述本轮集成分支 |
| design-ai-client | [yihan-dev-ma](https://kdev.corp.kuaishou.com/git/design/design-ai-client/-/files?repoId=633849&repoName=design-ai-client&branchName=yihan-dev-ma) | 本轮 DA/MA 宿主合同与组件接入的对照分支 |
| design-ai-client | [release_staging](https://kdev.corp.kuaishou.com/git/design/design-ai-client/-/files?repoId=633849&repoName=design-ai-client&branchName=release_staging) | 既有 DA 云端测试部署线；与 MA 接入分支分开，发布前核对实际内容 |
| design-agent-plugin-kit | [master](https://kdev.corp.kuaishou.com/git/design/design-agent-plugin-kit/-/files?repoId=647255&repoName=design-agent-plugin-kit&branchName=master) | 官方示范、SDK 与 Preview 的参考分支，用于学习和验证接法 |
| designai-app-browser | [feat/split-browser](https://kdev.corp.kuaishou.com/git/design/designai-app-browser/-/files?repoId=647315&repoName=designai-app-browser&branchName=feat%2Fsplit-browser) | 浏览器独立拆分与采集能力开发线，本轮核心四 App 之外 |
| designai-app-browser | [main](https://kdev.corp.kuaishou.com/git/design/designai-app-browser/-/files?repoId=647315&repoName=designai-app-browser&branchName=main) | 较早的初始化主线；开发内容主要在上述功能分支 |
