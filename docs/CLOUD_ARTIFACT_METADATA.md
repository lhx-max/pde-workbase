# 云端产物元数据（CloudArtifactMetadata）

`apps/server/src/storage/cloud-artifact-metadata.ts` 为云端文件路由恢复 `artifact: true` 发布能力，**不使用** `.artifact.json` 本地旁车文件：产物清单（manifest）作为类型受控的业务元数据存进 `JsonStatePort` 的每项目槽位。文件字节与头索引仍归 `CloudProjectFiles`（`canvas_files` 行 + 不可变 blob）；本模块只记录「路径 + 内容修订 → 清单」。

## 存储模型

- 槽位：`artifacts:<sha256(projectId)>`，文档版本 `version: 1`，形如 `{version, projectId, entries}`。
- `entries[path] = {revision, manifest}`：`revision` 是写入时规范头字节的完整 sha256；`manifest` 是经 `validateArtifactManifestInput` 消毒后的固定字段集（`version/kind/title/entry/renderer/status/exports/primary/supportingFiles/createdAt/updatedAt/sourceSkillId/designSystemId/metadata`），调用方混入的未知顶层字段（含疑似密钥字段）在消毒时被丢弃，不落库。
- 容量硬上限：≤256 条 entry 且序列化 UTF-8 ≤ 1 MiB。超限返回 413 `CLOUD_ARTIFACT_METADATA_LIMIT`，不截断、不淘汰。
- 存储态严格校验：未知顶层/entry 字段、非规范化或内部（`.file-versions`/`.bezierdesign/.file-versions`）路径键、非法 revision、manifest 校验失败或 `manifest.entry` 与键不一致、超额文档，一律 503 `CLOUD_ARTIFACT_METADATA_CORRUPT`，不重置不绕过。重校验存储 manifest 使用 `preserveUpdatedAt: true`，不改写时间戳。

## 发布守卫

`prepareCloudArtifact({path, content: Uint8Array, artifact?, artifactManifest?, priorSiblings?, stubGuardConfig?})` 在任何落库**之前**执行，返回消毒后的 manifest 或 `null`（普通文件）：

- `artifact: true` 走既有 `resolveCreateArtifactManifest`（显式 manifest 优先；`.html/.htm/.md/.svg` 可按 legacy 规则推断；推断不出抛 `ARTIFACT_MANIFEST_REQUIRED`）。
- 显式 `artifactManifest` 为 null/undefined → 普通文件返回 `null`；非 null → `validateArtifactManifestInput` 校验，非法即 400 `BAD_REQUEST`（`artifact:true` 路径下为 `ARTIFACT_MANIFEST_INVALID`）。
- 守卫按**实际发布的产物 kind**判定，与请求 MIME/扩展名无关：kind ∈ {html, deck} 时先用 `TextDecoder('utf-8', {fatal:true})` 严格解码（非 UTF-8 直接 400），再执行 `assertArtifactPublicationAllowed` 占位符检查（命中 → 400 `ARTIFACT_PUBLICATION_BLOCKED`）。
- 桩件守卫（stub guard）沿用同一判定函数 `classifyArtifactStubGuard`：`metadata.identifier` 非空且 kind ∈ {html, deck} 时，由调用方从云端清单/元数据推导同目录 `{name,size}` 先验兄弟作为 `priorSiblings` 传入；本模块不读盘。reject → 400 `ARTIFACT_REGRESSION`；warn 与本地路径一致打 `console.warn` 后放行。
- `manifest.entry` 必须等于实际文件路径；`entry` 字段经支持路径校验（拒绝绝对路径、空段、遍历）。

## API 与调用方契约

`new CloudArtifactMetadata(state: JsonStatePort)`：缺 port 直接抛错（不可用，无本地/内存回退）。授权由调用方（路由）在进入前完成；本模块不接受任何 actor 字段。

- `set(projectId, path, revision, manifest)`：写入 `{revision, manifest}`，`state.write` 后 `await state.flush()` 才返回；flush 失败即写入失败，不报告成功。所有校验/容量检查在 `state.write` 之前完成，失败不改动槽位。项目内变更经单键队列串行化。
- `get(projectId, path, revision)`：`revision` 与存储值一致才返回 manifest 深拷贝；否则返回 `null`——**绝不**给已变更字节回吐旧产物标题。
- `rename(projectId, from, to, currentRevision)`：移动既有元数据**并改写全槽位所有 manifest 对该文件的引用**，对应本地 rename 里 `updateArtifactManifestRefsForRename` 的行为。`to` 已有条目 → 409 `CANVAS_CONFLICT`；manifest kind 与新扩展名不兼容（如 html/deck → 非 `.html/.htm`、markdown-document → 非 `.md`、svg → 非 `.svg`）或任一结果 manifest 重校验失败 → 400，均先于任何变更。`currentRevision` 必须是 rename 前的头 sha256；存储 revision 不匹配说明 manifest 描述的是已被覆盖的字节，此时只丢弃该陈旧自身标记（绝不挂到目标路径的错误字节上），其他 manifest 的引用仍照常改写。`from` 无条目不再是空操作——被改名文件可能只是普通 supporting 文件，其他 manifest 的引用照样更新；只有整份文档确实无变化时才不写不 flush。
  - 引用改写算法原样移植自本地 `.artifact.json` 旁车路径（`apps/server/src/artifacts/manifest-rename.ts`，源自 projects.ts 的 `rewriteArtifactManifestRenameRefs`/`rewriteManifestRefForRename`）：`entry`/`primary` 先按项目根路径匹配，再按 owner 目录相对匹配，最后按字面量匹配；`supportingFiles` 走 owner 相对 + 字面量两级。被移动产物自身 manifest 以**目标路径**为 owner 解析引用（本地管线先移旁车文件再做全局 pass 的等价语义）；其他 manifest 的 `entry` 始终钉在自己的槽位键上。外部 URL、query、fragment、绝对路径、空 ref 一律不改写；`..` 归一化语义与旧实现完全一致，不新增遍历处理。
  - 只改写 manifest 引用字段，**不触碰任何文件字节**（不重写 HTML body 引用），与本地路径对文件内容的处理一致。
  - rename 不改 revision：文件字节未变，每条 manifest 仍绑定原来的头 sha256。
  - 每个结果 manifest 先过 `validateArtifactManifestInput` 再 `cloneJson` 落槽（校验器会补出 undefined 可选字段，严格 JsonStatePort 编解码会拒绝）；全部校验完成后才允许 `state.write`，容量上限失败返回 413 且不写任何状态。
- `preflightRename(projectId, from, to, revision)`：在规范头移动**之前**预检，与 `rename` 跑完全同一条计算与校验管线（同一个 `stagedRenameDocument`）：目标冲突 409、kind/扩展名不兼容 400、所有跨条目引用改写与结果 manifest 重校验、结果文档容量上界。通过即代表该文档上的元数据更新不会失败；只读不写，不 stage 任何状态。
- `remove(projectId, path)`：删除既有条目并 flush；无条目为空操作（不写不 flush）。

## 顺序与失败缺口（如实说明）

跨系统**无原子性**：文件头（`CloudProjectFiles`）与本元数据槽是两个持久化目标。约定顺序一律「先头后元数据」：

- 写入：头写入成功（拿到返回 revision）后再 `set`；`set` 失败 → 文件存在但无产物标记，前端按普通文件展示，不产生「幽灵产物」。
- 重命名：头 rename 成功后再 `rename`；元数据 rename 失败 → 清单留在旧路径（对新头不可见，也不会因 revision 匹配而误挂到无关字节）。
- 删除：头删除后 `remove`；`remove` 失败 → 遗留孤儿条目，因无对应头而不可见。

反方向（先元数据后头）不在此实现范围内；并发写者在头写入与 `set` 之间改头会使存入 revision 失配，`get` 返回 null 即安全降级为普通文件。

## 范围与验证

- 不做：文件头读写/rename/delete、路由接线（Root 负责接入）、actor/鉴权、`decorate(files)` 装饰、文件字节层面的引用改写（manifest 引用已覆盖，HTML body 等内容不改）。
- 状态口缺失/不可用即显式失败；不静默落本地、不宣称真实 Appwrite/MA 验收。
- 证据：`pnpm typecheck`（tsconfig + tsconfig.tests）通过；`node node_modules/vitest/vitest.mjs run tests/cloud-artifact-metadata.test.ts tests/artifact-manifest-rename.test.ts` 60 项通过（内存 JsonStatePort、守卫先于变更、revision 失配、作用域隔离、rename/remove、腐坏存储拒绝、容量不淘汰、无本地文件、flush 失败不算成功、跨 manifest 引用改写、preflight 镜像校验不落盘、改名溢出 413 拒写、AppwriteJsonState 严格编解码多条目改名往返）。Node 24（node@24）环境执行。
