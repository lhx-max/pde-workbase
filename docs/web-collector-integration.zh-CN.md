# 网页采集 App 接入（2026-10-21）

用户确认暂不继续完整浏览器内核，把文字/图片浮层与页面资源面板合成一个 MV3 扩展。采集发生在用户自己的 Chrome 页面；画布内挂载 `@ks-designai/browser-surface@0.2.1` 的 `CollectorAppSurface`，不生成浏览器画布卡片，不用 iframe 浏览外部站点。

- 实现真源：独立 `designai-app-browser` 仓库 `apps/collector-extension`、`apps/server/src/collector`、`apps/web/src/CollectorAppSurface.tsx`。
- 交付为两个安装物：React npm组件包 + Chrome扩展ZIP。画布目前使用本地vendor 0.2.1 tarball，未宣称npm远端发布。
- 扩展下载：本画布 `/downloads/web-collector-extension-0.1.0.zip`。浏览器中的开发模式加载解压目录；当前机器已按用户确认安装并实测。
- 后端数据：Browser App自己的Appwrite `browser_app_dev/browser_assets_v2`；画布服务不接管采集文件。扩展不拿Appwrite管理凭据，只拿项目所有者生成的限时采集授权，浏览器重启/扩展重新加载后重连。
- 正常组件请求经过现有 `/api/browser-app` 代理；扩展使用连接码中Browser API的公开地址直连采集专用接口。不要给该代理整体放开扩展跨域访问。
- 部署要求：Browser API配置稳定的 `BROWSER_COLLECTOR_SIGNING_KEY`、HTTPS `BROWSER_COLLECTOR_PUBLIC_BASE_URL` 和已有MA权威身份适配。不得把维护者调试身份当正式鉴权；不得修改一涵基座或放宽Appwrite函数权限来伪造接入。

## 实际验收

Chrome扩展真实完成：连接当前项目→扫描PNG和SVG→勾选批量保存；划词浮层→确认保存；图片浮层→确认保存。四条手势产物直接从Appwrite下载核验SHA256通过。画布采集App显示6条（另含2条API验收），并成功预览真实划词文字。换空缓存目录重启Browser API后依旧可读回。未连接保存明确失败。

当前是 **本机API + 真实Appwrite + 真实Chrome扩展 + 画布组件** 的开发闭环。API线上部署、正式MA登记、真实MA Agent调用仍是后续独立验收。完整证据在浏览器仓库 `docs/verification/collector-cloud/`。
