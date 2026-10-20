# Pinterest 会话接续 — 独立开发实验

从上游 `319e5eee` 恢复，使用独立扩展身份 `acgnbiifgajbjpcjfaodlmpekhhdjmfm` 与 Native Messaging 宿主 `com.canvas_workspace.pinterest_auth`。不共享原应用的配对状态。

**仅支持 macOS 的非打包开发运行时。** 其他平台和打包发行版明确返回不支持。这不是已经验证的正式登录功能。

## 构建与人工安装

在独立工作区使用 Node 24 和 pnpm 10.33.2：

```sh
pnpm --filter @canvas/desktop build
```

解压式连接器的构建输出为：

```text
apps/desktop/dist/pinterest-auth-extension/
```

在内置浏览器中打开 Pinterest，使用登录连接入口并按原生同意对话框操作。安装流程会打开 HTTPS 默认浏览器的扩展设置和生成的连接器目录。**只有明确同意后**，应用才会注册独立命名的 Native Messaging 宿主；不会静默安装扩展，也不会替你切换浏览器。不支持的默认浏览器仅提供普通 Pinterest 跳转，不会接回会话。

## 权限、归属与撤销

- 连接器需要用户明确授予可选的 Pinterest 站点权限。
- 配对令牌保存在会话存储中，仅能使用一次并有过期时间。
- 只有 Pinterest Cookie 会经过本机接收器；不读取或传输 Google Cookie、浏览器配置或任意文件。
- 宿主检查当前窗口拥有的存活浏览器页面，页面导航时取消接续；导入失败或取消时恢复已修改的条目，不清空无关存储。
- 退出／停止或过期会撤销配对。Cookie 内容和配对密钥不得写入日志、剪贴板或传给外部浏览器的 URL。

## 验证边界

自动化检查使用合成 Cookie 和临时模拟的 Native Messaging 注册目录，不会安装到真实浏览器配置，也不会读取或修改真实配置。

原生对话框可见效果、实际 Chrome／Edge 安装、Google／Pinterest 平台许可及真实账号会话接回，仍是单独的人工／获准端到端验证工作。**完整原生同意复测必须另行获得授权，不能由单元测试替代，也不应在未经确认时启动真实安装或登录流程。** 不能把上游历史人工验证记录当成本独立发行版的验证结果。
