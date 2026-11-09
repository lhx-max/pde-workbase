# 图片 App：画布侧接入

2026-10-21复核：详情模式接入前的画布侧 MVP 已具备组件注册、预览与资源交互、实际 GPT 生图、云端保存/回填和图片 CLI 动作。独立本地仓库为 `designai-app-image`，当前本地安装包为 `@ks-designai/image-card-pack@0.3.0`，CLI 为 `@ks-designai/canvas-cli@0.1.2`；本批未发布 npm 或推送 Git。动作合同和当前验收边界见 [图片 CLI 合同](image-cli-contract.zh-CN.md) 与 [验收记录](verification/image-cli-20261021/README.md)。下文打开合同保持有效，历史验收版本不代表当前安装版本。

## 已接入

图片包的纯 `/server` 元数据通过 `apps/server/src/card-packs.ts` 注册，能力清单可发现 `packId=image`、`kind=image`、`editorApp=image`。画布从 `vendor/` 的实际 tarball 安装，不引用相邻仓源码或软链。前端从包的 `/react` 入口内嵌 `ImageCanvasCard` 和 `ImageModeEntry`，服务端从 `/server` 读取元数据。组件源码留在独立图片仓库，画布注入图片预览、状态、原有工具和按钮 chrome；没有搬入图片 App 全部业务，也没有重复创建自定义图片卡。当前展示框和入口已由图片包提供，原有裁剪/调色工具仍由画布注入，尚未整体抽到图片仓库。

创建仍走 `image.attach`；替换、选择、变换及复制/删除/撤销仍走原有画布合同。图片保留在 `workbenchImages`，不是普通文字节点。

图片卡提供“进入图片模式”按钮。宿主配置 `CanvasUiHost.openImageApp(target)` 后，画布先保存，再通过既有 `open-editor` 路由按权限解析同一图片，交付公开的 `CanvasImageEditorTarget`：画布 ID、节点 ID、文件相对路径、画布版本、名称、尺寸和已登记 App endpoint。这个打开动作不创建图片 App 业务实例，不写图片 App 数据。

未接宿主回调、App 未登记、权限不足、图片未完成、保存失败和画布切换均明确失败并保留图片。回调动态接入或替换后使用最新宿主。

## 后续开发者接手

图片 App 的独立 Appwrite 业务后端、资产/版本、详情模式及其结果回传由图片 App 开发者实现，入口见其 `docs/APP_CONTRACT.md`。目前画布内的图片存储和生图回填使用宿主注入的云端适配器；登记的 `image` 是显式的画布图片工作区 profile，不冒充完整详情 App。详情后端可用后登记真实入口，并由宿主实现导航回调；路径不是全局资产 ID，画布 revision 不是图片 App 内容版本。

画布 surface 本地构建版本为 `0.1.3`，尚未发布；完整画布服务 `http://127.0.0.1:17580/` 已加载本地图片组件包，Canvas API `17462` 已读回图片卡包关联；已有 MA 页面不会自动升级。正式 MA/Provider/staging 不属于本轮验收。

## 验证

- 服务端 `image-editor-handoff.test.ts`：真实 HTTP 权限、登记、原生图片解析、未完成图片和只读性。
- 画布 `image-app.test.ts`：保存失败、错误目标、切换画布、未配置和登记失败时不打开。
- 独立图片包：类型、注册合同测试、构建和打包。
- 浏览器证据见 [验收记录](verification/image-app-handoff/README.md)。测试接收器仅观察真实卡片打开事件，不实现图片 App 业务。

## 两模型生成与云端存储追加

本轮已追加GPT-Image-2/Gemini执行器，实际完整画布调用后将图片、索引、卡片和任务摘要写入Appwrite；当前采用显式维护者云端开发配置，执行仍在本机。详见 [真实生图与云端读回](verification/image-generation-cloud/README.md)，不等同正式MA逐用户授权、staging或租户隔离已验收。
