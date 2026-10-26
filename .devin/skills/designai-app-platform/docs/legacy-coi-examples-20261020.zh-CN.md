# 历史 COI 开发资料（2026-10-20）

仅用于追溯旧实现和迁移背景，不属于新App开发步骤。以下无基线写入、旧注册方式及当日状态不得复制为当前交付；当前合同见 [API与实现规范](app-development-spec.zh-CN.md) 和 [白皮书](app-development-handbook.zh-CN.md)。

## 十一、doc 历史核对状态（2026-10-20，不作当前合规证明）

下表仅保留当日范围；其中旧 P 引用与当前 §4.2 编号不完全对应，查接口用当前 P1–P24 表。正文并发已被 2026-10-21 增补合同替换；实际状态/限制见仓库运行证据。

| 项 | 合同条目 | 状态 |
|---|---|---|
| 响应包 `requestId` | 命名与包格式 | ✅ 全端点实现 |
| `/actions/` 路由（doc.list/read/write/open） | P6/P13 | ✅ 实现 + 幂等重放实测 |
| 回执查询 | P14 | ✅ 实现（会话级，重启清空——已在 manifest 标注） |
| `/events` | P18（二期） | manifest 如实标 `available:false` |
| `/snapshots` | P20（二期） | 如实标 `available:false` |
| 正文并发 | P16 | 旧“最后写赢”已废止；按正文增补合同版本/基线、428/409 验收 |
| open-editor 会话存内存 | P4 | 一期接受，重启即丢已写明 |

> doc 是参考实现，不宣称“必须项100%/全合规”；独立安装、生产身份、Provider 竞争窗口、重启幂等及正式 MA 接入仍分别验收。

---

## 附录 A：历史本地 API 样例（不可直接用于当前交付）

以下保留 2026-10-20 本地调用样例，不是当前通用可复制模板或全量验收。P 编号以 §4.2 为准；正文版本以前述增补为准；注册 endpoint 应为具体协议根（doc 为 `/api/apps/doc`），不能将裸 origin 与协议根混用。

### A.1 自注册（P2）

App 启动时：

```bash
curl -X POST http://<画布>/api/apps/register \
  -H 'content-type: application/json' \
  -d '{"appId":"doc","name":"文档编辑器","endpoint":"http://127.0.0.1:19000","webUrl":"http://127.0.0.1:19001","description":"Document editor App"}'
```

之后 `GET <画布>/api/apps` 返回：

```json
{ "requestId": "req_...", "data": { "apps": [
  { "appId": "doc", "name": "文档编辑器", "endpoint": "http://127.0.0.1:19000",
    "webUrl": "http://127.0.0.1:19001",
    "description": "...", "status": "active", "registeredAt": "2026-10-20T09:11:54.070Z" }
] } }
```

### A.2 能力清单（P3）

```bash
curl http://127.0.0.1:19000/api/apps/doc
```

```json
{
  "appId": "doc", "name": "文档编辑器", "version": "0.1.0",
  "editorKinds": ["text"],
  "actions": [
    { "actionId": "doc.list",  "mode": "app",      "async": false },
    { "actionId": "doc.read",  "mode": "instance", "async": false },
    { "actionId": "doc.write", "mode": "instance", "async": false },
    { "actionId": "doc.open",  "mode": "instance", "async": false }
  ]
}
```

### A.3 卡 → App 解析（画布侧）

```bash
curl -X POST "http://<画布>/api/apps/canvas/instances/<instanceId>/open-editor" \
  -H 'content-type: application/json' -d '{"nodeId":"t1"}'
```

```json
{ "requestId": "req_...", "data": {
  "appId": "doc", "endpoint": "http://127.0.0.1:19000",
  "nodeId": "t1", "kind": "text",
  "filePath": "sources/text/t1-op-61249b73c0ff4c20.md" } }
```

App 未装时：`404 { "error": { "code": "APP_NOT_INSTALLED", ... } }`，不静默失败。

### A.4 App 侧收打开请求（P4）

```bash
curl -X POST http://127.0.0.1:19000/api/apps/doc/open-editor \
  -H 'content-type: application/json' \
  -d '{"nodeId":"t1","filePath":"sources/text/t1.md","canvasId":"canvas-xxx"}'
```

```json
{ "data": { "appId": "doc", "nodeId": "t1",
  "filePath": "sources/text/t1.md", "canvasId": "canvas-xxx",
  "openUrl": "http://127.0.0.1:19001/?nodeId=t1&filePath=sources%2Ftext%2Ft1.md&canvasId=canvas-xxx" } }
```

### A.5 历史文件通道（P16 / P17；无版本写示例不可用于现有正文）

写（经 App 后端转发，也可以直连画布同形端点）：

```bash
curl -X PUT "http://127.0.0.1:19000/api/apps/doc/canvas/<instanceId>/files?path=sources/text/t1.md" \
  -H 'content-type: application/json' -d '{"content":"# 标题\n\n正文"}'
```

```json
{ "requestId": "req_...", "data": { "path": "sources/text/t1.md", "status": "written" } }
```

读：

```bash
curl "http://<画布>/api/apps/canvas/instances/<instanceId>/files?path=sources/text/t1.md"
```

```json
{ "requestId": "req_...", "data": { "content": "# 标题\n\n正文" } }
```

### A.6 实例状态（P7）

```bash
curl http://127.0.0.1:19000/api/apps/doc/instances/<docId>/state
```

```json
{ "data": { "instanceId": "d-abc123", "meta": { "id": "d-abc123", "name": "...",
  "path": "documents/d-abc123.md", "size": 128, "updatedAt": "..." }, "content": "# ..." } }
```

### A.7 批量操作（P12，写操作正形）

```bash
curl -X POST "http://<host>/api/apps/<appId>/instances/<id>/operations" \
  -H 'content-type: application/json' \
  -d '{"operationId":"op-<uuid>","baseRevision":1792492885801,
       "operations":[{"type":"node.create","node":{"id":"brief","kind":"text","title":"需求","x":0,"y":0}},
                     {"type":"node.update","nodeId":"result","set":{"text":"方案初稿"}}]}'
```

```json
{ "requestId": "req_...", "data": {
  "receipt": { "operationId": "op-<uuid>", "status": "applied",
               "baseRevision": 1792492885801, "revision": 1792493393642,
               "nodeIds": ["brief"], "createdAt": "..." },
  "revision": 1792493393642, "state": { ... }, "replayed": false } }
```

`baseRevision` 冲突回 `409`；同 `operationId` 重发返回原回执 `replayed:true`，不重复执行。

单操作糖（P13）同语义、批次为 1：

```bash
curl -X POST "http://<host>/api/apps/<appId>/instances/<id>/actions/node.update" \
  -H 'content-type: application/json' -H 'idempotency-key: op-<uuid>' \
  -d '{"input":{"nodeId":"result","set":{"text":"方案初稿"}},"expectedRevision":1792492885801}'
```

### A.8 错误包

```json
{ "error": { "code": "DOC_INVALID_PATH", "message": "Expected a .md or .mdx path",
  "retryable": false }, "requestId": "req_..." }
```

权限未接入（P19 的历史诚实桩；不提供实际业务授权）：

```json
HTTP 501
{ "available": false, "provider": "wangyihan", "configured": false,
  "reason": "团队权限 API 地址与返回格式尚未提供，权限接线保留未启用" }
```

### A.9 变化订阅（事件流形状，P18）

```
GET /api/apps/canvas/instances/<id>/events?after=<eventCursor>

event: ready
data: {"instanceId":"canvas-xxx","cursor":"0","resync":false}

event: card.created
data: {"type":"card.created","instanceId":"canvas-xxx","nodeId":"t2",
       "kind":"text","title":"...","revision":1792493393642,"cursor":"1792493393642"}
```

`resync:true` = 游标掉出缓冲，先重读 state 再连。
