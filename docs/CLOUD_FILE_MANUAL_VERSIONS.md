# 云端文件手动版本快照（Manual File Versions）

`apps/server/src/storage/cloud-project-files.ts` 的 `createVersion(projectId, path, options)` 恢复本地 `POST /api/projects/:id/files/:path/versions` 的手动 HTML 快照能力，**不引入** `.file-versions` 本地目录，也不新建头表：快照只是既有类型化不可变版本历史（`JsonStatePort` 槽位 `file-versions:<sha256(projectId)>`）里新增的一条记录，指向与当前头**同一个**不可变 blob（fileId/sha256）。

## 语义对齐本地面（`apps/server/src/routes/files.ts` POST versions）

- 只对 `.html`/`.htm` 生效；非 HTML 返回 400，缺头返回 404，顺序与本地一致（先存在性后类型）。
- 快照对象始终是**当前头字节**：在服务锁内重查 `canvas_files` 头行，先 `downloadVerified` 校验 size/sha256 再允许历史引用；不落任何本地文件、不改写 latest 头。
- `expectedRevision` 为**可选**基线（与写入的强制基线不同）：提供且失配 → 409 `CANVAS_CONFLICT`；缺失不报错——快照不覆盖字节。
- 字段契约：`label`（≤200 字符，去空白，空串视为未提供）、`prompt`（≤4096 字符，去空白，空白视为 null）、`source` ∈ `ai|manual|restore`（缺省 `manual`）、`promptSource` ∈ `message|project|manual|restore`、`parentVersionId`（必须匹配 `v-[a-f0-9]{32}` 且**已存在于同一路径历史**，跨文件 id 一律 404，不落任何状态）。
- `promptSource` 推断与本地路由一致：显式 prompt → `manual`；`source=manual` → `manual`；`source=restore` → `restore`；`source=ai` 且无 prompt → 缺省不写。
- 显式快照**不参与**内容去重：即便字节与既有版本相同也追加新条目并保留请求的 label（与本地 `createVersion` 语义一致）；而 `versions()`/写路径对头记录仍按 (fileId, sha256, size) 幂等去重，快照条目天然满足该去重键，不会被重复登记。
- 所有元数据校验先于任何状态写：未知选项字段、超限 label/prompt、非法枚举或 parent id 一律 400 `CANVAS_INVALID_INPUT`；父版本不存在于同路径历史 → 404 `CANVAS_NOT_FOUND`。
- 持久化：`saveHistory` 仍受序列化文档 ≤1 MiB 硬上限约束（超限 413 `CANVAS_FILES_HISTORY_LIMIT`，不截断），`state.write` 后 `await state.flush()` 才返回；flush 失败即失败，绝不假成功。

## 历史文档兼容与严格性

- `HISTORY_ENTRY_FIELDS` 白名单新增 `label`、`prompt`、`promptSource` 三个可选字段；旧文档（无这些字段）原样有效。
- `source` 存储枚举扩展为 `ai|manual|restore`（此前仅 `manual|restore`），老数据仍然合法。
- 存储态严格校验：未知字段、非字符串/超限 label、非字符串或超限 prompt、非法 source/promptSource、非法 parentVersionId 一律 503 `CANVAS_FILES_HISTORY_CORRUPT`，不重置不绕过。

## 读 / 恢复 / 改名的元数据透传

- `toVersionDto` 不再硬编码：`label` 优先输出存储的请求值，缺省回退 `Version N`；`source=restore` 且未存 label 时回退 `Version N · restored from vM`（M 为父版本在本路径历史中的位次号，与本地 `nextLabel` 等价）；`prompt` 输出实值或 null，`promptSource`/`parentVersionId`/`restoreFromVersionId` 按实有输出。
- `readVersion`/`versions()`/`rename()` 原样携带新字段；rename 整段迁移条目，label/provenance 不丢。

## 路由

`POST /api/projects/:id/files/:path/versions` 注册在 GET 版本列表之后、写授权（`authorize(mode:'write')`）之后依次执行：规范化路径 → sketch 归属守卫 → doc 镜像写守卫 → 请求体白名单（`expectedRevision/label/prompt/source/promptSource/parentVersionId`，未知键 400）→ `createVersion`。返回真实 `{version}` DTO（`CreateProjectFileVersionResponse` 形状，`version` 为位次序号、`current` 反映最新）。路由层移除了原有的 `POST .../versions` `CLOUD_FILE_OPERATION_UNAVAILABLE` 哨兵，未实现面不再兜底到本地。

## 范围与验证

- 不做：版本内容写盘、origin/artifact 元数据、批次归档/内部态/powered 面（仍旧哨兵）、非 HTML 文件快照。
- 证据：`tsc -p tsconfig.json --noEmit` 与 `tsc -p tsconfig.tests.json --noEmit` 通过；`vitest run tests/cloud-project-files.test.ts tests/cloud-project-file-routes.test.ts` 45 项通过、`tests/cloud-project-file-views.test.ts` 11 项通过。Node 24（`~/.nvm/versions/node/v24.19.0`）执行。全部为内存 fake client/port 的单元级验证，未触真实 Appwrite。
