# 图片 CLI 验收 — 2026-10-21

> 历史验收快照：以下为记录日期的结果和现场路径，不作为当前配置；不应重建已退役的数据目录。原始日志/会话不随源码交付，当前版本以发布清单为准。

## 交付与边界

- 图片独立包 `@ks-designai/image-card-pack@0.3.0`：声明 App 动作、配置 schema；宿主提供现有云存储及媒体执行适配器。
- HTTP CLI `@ks-designai/canvas-cli@0.1.2`：新增版本条件、幂等键及动作回执查询，包含 Agent Skill。
- 两个包均已本地打包到 `vendor/`；本批没有发布 npm、推送 Git 或部署 staging。
- 统一调用格式见 [图片动作合同](../../image-cli-contract.zh-CN.md)。正式 MA 用户认证、扣费对账和 staging 尚未验收。

## 实际云端证据

隔离画布 `image-cli-1792584795576`，不修改用户原来的“一只狗”画布。

1. 经 CLI 创建来源卡，保存并读回 prompt/model/aspect/resolution/count/references 全部配置；重复 key 返回原回执。
2. 明确调用 GPT-Image-2 一次，提示词“一只狗”，4:3、2K、1张。约51秒完成，产物 PNG 2048×1536、4,583,750 bytes。
3. 后端任务 `canvas-5d2b5ee2-71b9-e3b7-3771-8bc453fa331f` 完成，`canvasDelivery.status=delivered`；下载云端产物并检查实际图片尺寸。
4. 初次验收发现模型完成早于回填提交，已修正：回填 pending 时回执仍为 accepted；只在回填完成后报告 succeeded。恢复验收复用同一任务和幂等键，没有再次生图。
5. 将打包 CLI 安装到独立 `.tmp/image-cli-installed`，用实际安装的二进制再执行 configure、同 key 重放、云端状态读回并断言一致，见 `packed-cli-consumer.json`。

证据：`summary.json`、`generation-receipt.json`、`result.png`、`packed-cli-consumer.json`。供应商 Gemini 此前的601未解决，不能以 GPT 成功替代。

## 检查

- 服务端：51个测试文件通过、1个跳过；379项通过、1项跳过。新增 image-app 集成测试10项覆盖配置、多张、重新生成、取消、失败、越权、幂等及交付等待。
- 服务端源代码和测试 typecheck、构建通过；画布 workbench typecheck 通过。
- 独立图片仓13项测试及构建通过；CLI 独立构建、打包、离线安装与实际 API 调用通过。
- 根 guard 未通过：既有 MF React配对规则和两个未登记 mjs 兼容文件；根 typecheck 被既有 e2e extension-fixture/browser-fixture 缺失阻断。本批不宣称全仓全绿。
- Web17580实际 HTTP 返回200；IAB 页面导航持续超时/连接重置，本批未获得 CLI 验收画布的视觉截图。后端回填、云存储文件和 CLI 读回已验证，页面视觉验收仍待补。

## 复现

在本地维护云端服务与真实模型适配器已启动时，先构建服务端，再运行：

```sh
pnpm exec tsx e2e/image-cli-cloud.ts --output /绝对路径/新验收目录
```

以上只验证配置，不启动模型。显式增加 `--generate` 会产生一次真实生图请求；已有本次任务可用 `--resume image-cli-1792584795576` 查询与下载，避免新建付费任务。脚本要求任务及交付成功才退出成功。
