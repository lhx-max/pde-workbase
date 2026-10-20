# Canvas Workspace 网页采集扩展

从上游 `319e5eee` 保留选区/原图浮层、空间选择、手工元数据、YAML、保存后的资产检查器与右键入口。保存进入独立应用的内置本地资产库；不需要原应用的账号、团队、进程或数据目录。

## 构建与安装

在独立仓库根目录使用 Node 24、pnpm 10.33.2；构建还需要系统 `zip`（macOS/Linux 基线，Windows native 未验证）：

```sh
pnpm --filter @canvas/desktop build
# 仅重建两个扩展的资源：
pnpm --filter @canvas/desktop build:extension
```

构建产物（忽略、不提交）：

```text
apps/desktop/dist/browser-extension.zip
apps/desktop/dist/pinterest-auth-extension/
```

1. 在独立桌面应用的浏览器设置中点击「安装扩展」。
2. 在原生对话框中明确同意启用本次应用会话的外部采集。
3. 用原生 Save As 导出 ZIP，解压；到 `chrome://extensions` 或 `edge://extensions` 开启开发者模式并「加载已解压的扩展程序」。
4. 选择解压目录，确认扩展 ID 为 `filiogdhdejjikcnhfgdclfcnflecgpd`。
5. 扩展重新构建后，需要重新导出/解压、重新加载扩展并刷新网页。没有自动刷新承诺。

导出成功**不等于扩展已安装或已连接**。连接状态来自扩展心跳；此采集扩展的安装流程不会自动修改浏览器配置文件或注册 Native Messaging。应用退出、主文档刷新或清理浏览数据后需要重新明确启用采集。

## 支持的操作

- 网页选区：保留文本，按用户选择的空间保存为文本资产。
- 原图：传输并保存原始字节，不把图片包成 JSON，不自动抓取其他图片。
- 元数据/YAML：与应用使用同一解析器、同一资产库 API；空间列表和标签来自应用上下文。
- 保存后检查器：只操作此次捕获产生的资产，允许读取/修改信息与已有 Prompt。
- AI 补全默认关闭。未配置分析适配器时，显式分析/生成返回不可用，不伪造生成结果；手工保存及读取元数据不依赖分析服务。

外部扩展只支持选区和原图。应用内浏览器另有截图、资源面板与页面归档；不要把外部扩展描述为整站下载器。浏览器禁止注入的内置页面和扩展商店不提供浮层。

## 隔离与授权

- 使用独立公钥派生的扩展身份、独立 Native Messaging 名称和 `18373–18382` 发现端口，不回退到原应用的消费者。
- 实际采集连接使用原有 loopback discovery 协议，绑定 `127.0.0.1`；校验 Host、扩展身份请求头和 Origin。页面 Origin、其他扩展 Origin、缺失身份头均被拒绝。
- 发现状态不会消耗凭证；每次提交重新领取有时限的一次性令牌，旧的未使用接收器会被替换。
- 桌面接收器限制类型/大小；内容脚本不持有令牌；保存结果需由当前受信任主文档的真实资产库请求确认。
- 资产检查器会话只绑定已保存资产，30 分钟过期，拒绝删除或任意资产 ID 置换；停止/主文档更换会撤销会话。
- 采集扩展不读取 cookies/history/clipboard。旧版 Native Messaging 备用客户端保留独立名称，但本流程不安装对应 relay；正常连接不依赖它。

Pinterest 会话接续属于**另外的扩展**：仅 macOS、非 packaged 开发运行时开放。必须先在原生界面确认连接器安装与接续，再写独立 Native Messaging 注册项；只导入 Pinterest cookie，失败或导航取消会回滚。自动化测试仅用临时模拟目录和合成 cookie，不读取/修改真实浏览器配置。

## CLI 与验证边界

资产保存、元数据和偏好沿用独立应用的统一 HTTP/CLI；原生 Save As、扩展安装同意与浏览器登录接续需要 GUI 中的人类确认，不提供跳过授权的通用 native invoke。

单元/协议测试覆盖包身份、来源边界、一次性令牌、资产会话范围、合成 Native Messaging、cookie 回滚及停止/导航失效。真实 Chrome/Edge 安装、Pinterest 在线登录、原生 Save As 的可见行为仍需人工或获准的桌面 E2E 验证。
