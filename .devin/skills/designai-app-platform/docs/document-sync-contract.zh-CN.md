# 正文双入口编辑与资产复制增补合同

版本日期：2026-10-21。适用于 doc 与文字卡；不是要求所有 App 共用纯文本合并器。与旧示例的无版本正文写/共享可编辑路径冲突时，以本合同为准。

## 1. 数据归属

已绑定正文以 App 自有存储为权威。画布状态/文件是可编辑镜像，卡片保存产生正文更新意图，不是另一份互相盲覆盖的真相。打开详情不写正文、不重新发送缓存卡片文字。

唯一绑定域：`teamId + mirrorCanvasId + nodeId`。宿主索引每个 canvas/node/app 最多一个 active App instance。正文名称与卡片标题不要求同步。

## 2. Doc 正文快照与条件写

```ts
// 文档版本是正文 UTF-8 SHA256 lowercase hex，不是画布 number revision。
type Snapshot = { meta: DocMeta; content: string; revision: string };
type Write = {
  content: string;
  baseContent?: string;
  expectedRevision?: string;
  mirrorRevision?: number;       // 只有 canvas-origin 写携带
  mirrorBaseContent?: string;    // 此画布版本已经提交的原始正文 C
};
type Saved = Snapshot & { merged: boolean; mirror: MirrorStatus };
```

- 建议同时传基线和 hash；两者同时存在必须匹配。
- 读/比较/三方合并/提交在同一个文档写临界区内完成。
- 没有前提的既有正文变更428；重叠/过大/不可靠合并409，带 currentContent/currentRevision/baseContent/draftContent/expectedRevision，不改正文。
- 原始文本 PUT 用 If-Match；GET提供 ETag。成功后采用服务端规范正文与版本，不能仅把提交稿标为已保存。
- 正文保存与镜像送达分别报告。200＋pending/conflict/unavailable 不等于镜像成功。

## 3. Canvas 镜像条件写

GET instance files 返回同锁下 `{content, revision:number, path}`。

Doc-origin PUT 携带 `{content,expectedRevision,baseContent,nodeId,docId,documentRevision,sourceRevision?}`；最后一个字段只保护来自特定画布提交的写。调用者必须拥有当前团队、App与画布权限，目标须匹配 active binding。

普通 doc-origin 必须同时满足画布版本及共同正文基线（或内容已相同）；不得获取新画布 revision 后抹掉独立未同步编辑。目标旧路径存在历史共享时按卡片分叉并返回实际路径，调用者必须更新 mirrorPath。binding 更新用独立正文读取验证目标，不回调正在持有投递锁的 doc state，避免跨服务循环等待。

## 4. 持久任务与确认

- Canvas：intent 落盘在 state commit 前；HTTP 在锁外；外发前确认提交的 node/content/revision。旧 callback、旧确认和旧revision不得替换新 intent。
- Doc：持久镜像队列保留共同基线、正文 hash、actual actor、状态；离线连续写合并为最新内容但不丢原共同基线。
- canvas C 被 doc 合并为 M 时，镜像基线是 C；不能变回 A。B在途时有新C，也不能把未被C编辑器看到的 merged M当C的基线。
- 当前授权用户才能确认重试；持久化 actor ID不是认证凭据，禁止存 token、冒充创建者或沿用旧actor替新正文重放。
- 正文和 outbox 非分布式原子提交。版本不一致要对账、取消旧synced，未知基线不猜测覆盖。

## 5. 前端

保留脏草稿、显示远端；保存期间继续输入不被旧响应覆盖。冲突重试沿用原基线；显式覆盖/采用远端需确认，并校验双方观测版本。

镜像确认是远端状态，不是新的用户修改。宿主不得把 doc onSaved 包装成 Date.now 的本地文字事件再写回；由画布服务端状态订阅更新预览。确需发送的本地文字事件应带 projectId、一次消费，setter变化/StrictMode不能重放旧通知。

App tab 持久化必须包含 appTabs 描述及 target/node/mirror 信息，不能只保存 tab ID。

## 6. 资产使用与生命周期

用户已明确选择复制：授权读取来源后创建独立身份、文件及绑定；不采用共享可编辑文档引用。重复导入不复用 uses/file 指向的旧可编辑文件。显式指定已占路径应冲突，不覆盖。

UI复制卡即使optimistic数据暂有源路径，服务端receipt确认的新路径不能被迟到整数组PATCH改回；客户端保持规范路径、后端防重新别名。

`doc.copy`去掉来源node/mirror/archive，归属当前调用者团队；`doc.restore`显式恢复且清除旧绑定；删卡仅归档绑定。解绑需nodeId/appId/appInstanceId条件，不能让迟到的旧文档归档通知撤销新绑定。

## 7. 部署限制

支持每个存储根单写服务实例＋多编辑客户端，不是跨服务进程的锁。Appwrite未实现真CAS，变更默认拒绝；显式single-writer部署约定不能宣传为分布式安全。正文队列间崩溃间隙、首次未知基线、回执持久化和生产身份provider仍要独立验收。

发布应成套更新 doc后端、canvas适配器和doc-surface；旧客户端428失败应明确提示升级，不能通过去掉前提恢复盲写。最新实测证据见 [运行记录](<../../../../docs/runtime-verification.md>)，边界见 [责任与状态报告](<../../../../docs/canvas-doc-relationship-and-status.zh-CN.md>)。
