> 2026-10-22 当前本地图片包0.8.0补齐：`image.tool`新增crop/adjust/transform；新增image.edit.read/save及JSON工具产物读取。完整命令和MVP范围见图片仓 `docs/MVP_API.md`，本仓证据 `docs/verification/image-mvp-api-20261022/`。下文0.3/0.7记录保留历史背景；原“裁剪调色等没有CLI”的结论仅对旧版本成立。

# 图片 App：CLI / Agent 动作合同

2026-10-21，本地维护 profile 的画布内部云端闭环。图片协议由独立 `@ks-designai/image-card-pack@0.3.0` 声明；宿主注入画布云存储与现有媒体执行器。没有新增图片私有数据库或详情编辑器，也没有修改 MA 基座。

## 身份和路由

- `appId=image`。此阶段一个图片工作区对应一个画布，`image.instanceId = canvas.instanceId`，动作 `input.nodeId` 指向其中的生图来源卡或图片结果卡。
- 这是一种明确的 host-backed image workspace profile，不冒充未来图片 App 的业务资产 ID。来源卡、结果卡 ID 与 taskId 不能混用。
- 内容/配置动作走图片 App；挂载已有文件、移动、删除、连线等仍走画布动作。
- `GET /api/apps/image` 返回真实动作和严格 inputSchema，`GET /api/apps` 可发现登记。`openEditor.available=false`，不宣称详情可用。
- 共用现有项目授权、MA 验证上下文、App entitlement 和 image card grants；CLI 自报 team/user 不替代鉴权。

## 参数

`config` / `set` 都只接受以下字段；未知字段、URL/越界文件路径直接拒绝。

| 字段 | 取值 |
|---|---|
| `prompt` | 提示词，0–7500 字符；生成时提示词和参考图至少提供一个 |
| `model` | `designai-gpt-image-2`、`designai-gemini-image` |
| `aspect` | `1:1`、`16:9`、`9:16`、`4:3`、`3:4` |
| `resolution` | `2K`、`4K` |
| `count` | 整数 1–4；返回逐张 taskId / nodeId |
| `references` | 最多16个本画布的图片相对路径；空数组清空图片参考，不清空已有文本参考 |

只修改明确给出的参数。配置映射到现有 `workbenchTaskDrafts[nodeId]`，界面读取同一份值；生成结果卡无独立草稿时，从它的真实 `mediaRequest` 继承参数。

## 动作

| 动作 | 目标 | input | 语义 |
|---|---|---|---|
| `image.create` | App | `{canvasId,nodeId?,x,y,name?,config?}` | 在已有画布创建独立生图来源卡；不扣费、不自动生成 |
| `image.configure` | instance | `{nodeId,set}` | 保存配置；不启动模型 |
| `image.generate` | instance | `{nodeId,set?}` | 使用保存值和显式覆盖值，启动1–4个任务 |
| `image.regenerate` | instance | `{nodeId,set?}` | 一次明确的新生成请求；保留已有图片，新结果单独落盘 |
| `image.status` | instance，只读 | `{nodeId}` | 读配置、输出、进度、失败、取消状态 |
| `image.cancel` | instance | `{nodeId,taskId}` | 只取消属于该卡的任务；取消不承诺供应商退款 |

生成不会自动切模型或因失败自动重试。部分任务受理后另一个任务的提交失败时，回执说明失败并保留已受理 taskId，不假装多张付费请求可原子撤销。

## 回执和并发

写操作必须携带顶层 `expectedRevision` 与 `idempotency-key`。CLI 对应 `--expected-revision N --idempotency-key KEY`。先读 `apps state image` 获取版本，再写；409重读，不盲目覆盖。

同 key + 同 action/input 返回原回执；同 key + 不同内容返回409。key是1–128字符标识。回执和配置存在同一份云端画布文档中，回执字段禁止普通画布 PATCH 修改。每工作区最多256条，达到上限明确拒绝新动作，不静默遗忘付费请求的去重记录；生产长期归档需后续独立日志方案。

返回 `{requestId,data:{receiptId,status,revision,result:{nodeId,config,taskIds,nodeIds,tasks}}}`；`accepted` 只代表已受理。只有模型任务完成且后端回填提交完成后才返回 `succeeded`。冲突或交付失败返回 `failed`，原图和产物文件保留。

网络结果不确定时，先 `apps receipt image --instance CANVAS_ID --id KEY`，不得换新 key 重发。现有执行器任务日志丢失时，不允许依据缺失记录再次付费调用；云端已知任务继续作为查证依据。

## CLI 示例

以下使用本次构建的 `@ks-designai/canvas-cli@0.1.2`；本次只本地打包，未上传 registry。

```sh
export CANVAS_SERVER_URL=http://127.0.0.1:17462
canvas-cli apps list
canvas-cli request GET /api/apps/image
canvas-cli apps state image --instance CANVAS_ID
```

`configure.json`：

```json
{"nodeId":"CARD_ID","set":{"prompt":"一只狗","model":"designai-gpt-image-2","aspect":"4:3","resolution":"2K","count":1}}
```

```sh
canvas-cli apps call image image.configure --instance CANVAS_ID --body-file configure.json --expected-revision CURRENT_REVISION --idempotency-key configure-001
```

重新读取版本。`generate.json` 为 `{"nodeId":"CARD_ID"}`，也可带 `set` 同时改提示词等参数：

```sh
canvas-cli apps call image image.generate --instance CANVAS_ID --body-file generate.json --expected-revision NEW_REVISION --idempotency-key generate-001
canvas-cli apps receipt image --instance CANVAS_ID --id generate-001
canvas-cli apps call image image.status --instance CANVAS_ID --body-file generate.json
```

## 验收

[运行证据](verification/image-cli-20261021/README.md)。隔离云端画布实际验证全部基础配置保存和读回、幂等重放；一次 GPT-Image-2 实际生成 2048×1536 PNG，并经过云存储下载和画布回填。多张、重新生成、取消、失败与越权由隔离 HTTP 集成测试验证，不把测试模型当成真实供应商成功。

MA 正式用户授权、扣费对账、staging 和长周期执行日志归档仍需单独验收；Gemini此前返回601不因本次 CLI 接通而宣称修复。


## 图片工具动作（2026-10-22，本地0.5.0迁移中）

`image.tool` 为已有图片创建一个新的工具结果，原图和原有生图草稿保留。0.7.0宿主支持单图PNG、矢量SVG和重排多图交付，`nodeId`对应已有图片或有完成图片的visual卡；source路径由服务端解析，客户端不能指定其他节点的源路径。`params`按manifest中每个kind的严格schema填写。

```json
{
  "nodeId": "已有图片节点ID",
  "kind": "multi-angle",
  "params": { "mode": "camera", "rotation": 45, "tilt": 0, "zoom": 50 },
  "model": "designai-gpt-image-2"
}
```

沿用`apps call image image.tool --instance <canvasId> --body-file <工具输入JSON> --expected-revision <读取版本> --idempotency-key <唯一键>`。回执给taskIds和新nodeIds；查询回执并确认任务done及canvasDelivery delivered，不能仅凭accepted判断完成。相同key同输入重放不再次提交供应商。

可执行的模型处理代码包括relight/multi-angle/precision-edit/expand/erase/mockup-fuse；upscale需要显式GPU服务配置；remove-background等待企业透明PNG接口合同。vectorize已接通实际VTracer SVG；reflow已支持完整多图保存、独立节点回填及恢复。layering/OCR仍需外部Provider和编辑结果接入；mockup-surface是JSON-only产物，当前图片任务适配器明确返回不可用。参数示例和可用性不代表全部工具已有完整原版UI、真实GPU已通或正式MA/staging验收通过。详细迁移清单在图片仓库`docs/BACKEND_TOOLS.md`。


0.7.0工具能力状态：读`GET /api/apps/image/instances/<canvasId>/tools`，区分manifest声明与服务已配置。SVG/重排回执中，完整结果清单位于任务`file.outputs`；`nodeIds`包含主要交付目标，不以它的数量判断批次是否完整。所有结果可在图片App状态与画布资源索引读回。重排`params.targets`填资源位名称或`{width,height}`数组，不传原上游UI的`resourceSlot`对象；点选修改使用`point:{x,y}`，消除只传mask项目路径，扩图只传targetCanvas/sourcePlacement。

裁剪、调色、旋转、手动样机等原版浏览器工具不因此变成已提供对应服务端CLI动作；CLI/API只宣称manifest实际公布的动作。真实MA调用、staging、外部GPU等另验。最新接线证据见`docs/verification/image-ui-completion-20261022/README.md`。
