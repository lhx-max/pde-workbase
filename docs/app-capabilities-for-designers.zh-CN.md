# MVP 版本能力清单

更新：2026 年 10 月 22 日。

## 快速预览

### ① 功能清单

| App | 支持的功能 |
| --- | --- |
| **画布** | 卡片创建与编辑、移动缩放、复制删除、连线、分组、对齐排版、图片裁剪与旋转、图片替换、分镜编辑、文件管理与版本恢复 |
| **文档** | 文字编写、基础排版、图文内容、自动保存、复制文档、改名、归档恢复、从画布进入编辑、导出 Markdown／TXT |
| **草图** | 自由绘图、图形与文字、页面线框、流程图、起始样式、图片插入、自动保存、复制草图、关联画布、导出 PNG |
| **生图** | 文生图、参考图生图、提示词设置、模型选择、比例与清晰度设置、多张生成、再生成、进度查看、取消任务、结果回到画布；[画布与图片设计功能参考 ↗](https://docs.corp.kuaishou.com/d/home/fcAAffQT4sPzZxnHAeuAFf0d0) |

生图需开通模型权限。图片裁剪、旋转由画布提供。

### ② 接口清单

| App | 对外提供的接口能力 | 代表接口／动作 |
| --- | --- | --- |
| **画布** | 创建与读取画布；批量修改卡片、连线、分组和布局；上传下载文件、管理文件版本 | `canvas.create`；`GET /api/apps/canvas/instances/{canvasId}/state`；`POST /api/apps/canvas/instances/{canvasId}/operations` |
| **文档** | 创建、读取、写入、复制、归档和恢复文档；保存附件；导出文字稿 | `doc.create`、`doc.read`、`doc.write`、`doc.copy`；`POST /api/documents/export` |
| **草图** | 创建、读取、保存图形数据；关联画布；保存与下载编辑器导出的图片 | `sketch.create`、`sketch.read`、`sketch.write`、`sketch.bind`、`sketch.export-image` |
| **生图** | 保存生成设置、提交生成任务、再生成、查询状态、取消任务和读取结果 | `image.configure`、`image.generate`、`image.regenerate`、`image.status`、`image.cancel` |

### 接口说明

- 请求方式：`GET` 读取，`POST` 执行，`PUT` 更新，`DELETE` 删除或归档。
- `{canvasId}`、`{docId}`、`{sketchId}` 分别为画布、文档、草图编号。
- 接口路径需拼接部署环境的服务地址。
- 动作调用示例：`POST /api/apps/doc/instances/{docId}/actions/doc.write`。

## 1. 画布 App

### 1.1 画布管理

| 能力 | API 入口 | 用途／返回内容 |
| --- | --- | --- |
| 查看支持的能力 | `GET /api/apps/canvas` | 返回可用卡片类型、动作和参数说明，判断当前能做哪些操作 |
| 查看画布列表 | `GET /api/apps/canvas/instances` | 返回当前有权访问的画布 |
| 新建画布 | `POST /api/apps/canvas/actions/canvas.create` | 传入名称，创建画布并返回编号 |
| 读取整张画布 | `GET /api/apps/canvas/instances/{canvasId}/state` | 返回卡片、位置、连线和当前版本，供程序理解画面 |
| 读取画布摘要 | `GET /api/apps/canvas/instances/{canvasId}/context` | 返回画布内容摘要 |
| 读取当前版本 | `GET /api/apps/canvas/instances/{canvasId}/revision` | 判断修改前后的画布是否发生变化 |
| 读取一张卡 | `GET /api/apps/canvas/instances/{canvasId}/nodes/{nodeId}` | 返回指定卡片的内容及信息 |
| 查看卡片历史 | `GET /api/apps/canvas/instances/{canvasId}/nodes/{nodeId}/history` | 查看该卡片记录过的变化 |
| 修改画布名称 | `POST /api/apps/canvas/instances/{canvasId}/actions/canvas.rename` | 修改整张画布的名称 |
| 删除画布 | `POST /api/apps/canvas/instances/{canvasId}/actions/canvas.delete` | 删除指定画布 |
| 打开卡片编辑器 | `POST /api/apps/canvas/instances/{canvasId}/open-editor` | 给卡片编号，解析其对应的文档／草图等编辑目标；目标编辑器须已接入 |
| 查询卡片关联 | `GET /api/apps/canvas/instances/{canvasId}/bindings` | 查询卡片关联的文档或草图 |
| 监听画布变化 | `GET /api/apps/canvas/instances/{canvasId}/events` | 持续接收卡片新增、修改、删除等通知，供界面刷新 |

### 1.2 卡片操作

这些能力共用一个批量入口：

`POST /api/apps/canvas/instances/{canvasId}/operations`

一次可以提交 1—100 个操作，例如“建三张卡 → 排成一行 → 加连线”。单个操作也可使用 `POST /api/apps/canvas/instances/{canvasId}/actions/{动作名}`。

| 能力 | 操作名 | 用途 |
| --- | --- | --- |
| 创建卡片 | `node.create` | 创建文字、分镜、视频及已安装的业务卡；图片和草图使用专用动作 |
| 修改文字 | `node.update` | 修改文字卡内容等允许修改的字段；已绑定文档的长正文优先用文档 App 修改 |
| 卡片基础管理 | `node.rename`、`node.move`、`node.resize` | 改标题、移动位置、调整尺寸 |
| 复制和删除卡片 | `node.duplicate`、`node.delete` | 复制一张卡，或删除指定卡 |
| 建立和移除连线 | `edge.connect`、`edge.disconnect` | 建立或移除卡片关系；适用卡种以能力声明为准 |
| 创建与管理分组 | `group.create`、`group.rename`、`group.add`、`group.remove`、`group.dissolve` | 将多张卡组成一组、改组名、加入／移出成员、解散分组 |
| 移动整个分组 | `group.move` | 保留组内关系，整体移动 |
| 自动排列 | `layout.arrange` | 按规则对齐、横排、竖排、均匀分布、网格或流程排列 |
| 放入／替换图片 | `image.attach`、`image.replace`、`image.select` | 插入、替换图片或选择已有结果 |
| 裁剪／旋转图片 | `image.transform` | 对指定图片做裁剪或旋转 |
| 创建／更新草图卡 | `sketch.create`、`sketch.update` | 在画布中放入草图或更新关联草图；深度编辑由草图 App 负责 |
| 创建网页／演示内容卡 | `document.create` | 创建 HTML 或演示内容卡片 |
| 跟踪／选择网页结果 | `document.begin`、`document.select` | 记录待交付结果，或切换已有文件 |
| 配置／使用视频 | `video.configure`、`video.attach`、`video.select` | 保存视频设置、关联文件或选择已有结果；视频生成需另行接入模型 |
| 编辑分镜 | `storyboard.shot.add`、`storyboard.shot.update`、`storyboard.shot.delete` | 增加、修改、删除镜头，填写描述、时长、景别、运镜、对白等 |
| 整理分镜 | `storyboard.shot.move`、`storyboard.shot.duplicate`、`storyboard.shot.references` | 调整镜头顺序、复制镜头、关联角色和场景参考 |
| 撤销操作 | `operation.undo` | 按操作记录撤销一次已执行的修改，是否可撤销由服务检查 |

### 1.3 文件与交付接口

| 能力 | API 入口 | 用途／返回内容 |
| --- | --- | --- |
| 列出文件 | `GET /api/projects/{canvasId}/files` | 返回画布项目中的文件，方便找素材和结果 |
| 上传文件 | `POST /api/projects/{canvasId}/files` | 上传文件，返回文件信息；放到画布还需相应建卡动作 |
| 搜索文件 | `GET /api/projects/{canvasId}/search` | 根据查询条件查找项目内容 |
| 管理文件夹 | `GET /api/projects/{canvasId}/folders`；`POST /api/projects/{canvasId}/folders`；`DELETE /api/projects/{canvasId}/folders` | 查询、创建或删除文件夹；删除范围受服务限制 |
| 下载文件 | `GET /api/projects/{canvasId}/files/{path}` | 取得原始文件内容，如图片、文字或已生成文件 |
| 文件改名 | `POST /api/projects/{canvasId}/files/rename` | 修改指定文件的名称 |
| 删除文件 | `DELETE /api/projects/{canvasId}/files/{path}` | 删除指定文件，受权限及资源归属限制 |
| 读写关联文字文件 | `GET /api/apps/canvas/instances/{canvasId}/files?path=…`；`PUT /api/apps/canvas/instances/{canvasId}/files?path=…` | 读取或更新有权限的文字文件；不能借此覆盖其他 App 管理的内容 |
| 查看／保存文件版本 | `GET /api/projects/{canvasId}/files/{path}/versions`；`POST /api/projects/{canvasId}/files/{path}/versions` | 查看版本，或为受支持文件保存一个版本及说明 |
| 恢复文件版本 | `POST /api/projects/{canvasId}/files/{path}/versions/{versionId}/restore` | 恢复指定文件的历史版本 |
| 打包下载 | `GET /api/projects/{canvasId}/archive` | 打包下载项目文件 |

**暂不支持：** 整张画布复制、整画布历史快照恢复、一键导出完整 PPT／PDF。

## 2. 文档 App

### 2.1 文档动作接口

- 列表和创建：`POST /api/apps/doc/actions/{动作名}`。
- 操作已有文档：`POST /api/apps/doc/instances/{docId}/actions/{动作名}`。

| 能力 | 动作名 | 输入 | 输出／效果 |
| --- | --- | --- | --- |
| 查文档列表 | `doc.list` | 当前访问范围 | 返回可访问文档 |
| 新建文档 | `doc.create` | 名称、可选初始正文；需要时附画布关联 | 创建文档，返回文档编号和信息 |
| 读文档 | `doc.read` | 文档编号 | 返回正文、标题和当前版本 |
| 写正文 | `doc.write` | 新正文和修改前的版本／内容 | 保存正文；版本冲突时返回提示 |
| 打开文档 | `doc.open` | 文档编号 | 返回编辑页面地址 |
| 文档改名 | `doc.rename` | 新名称 | 更新文档名称 |
| 复制文档 | `doc.copy` | 原文档编号、可选新名称 | 创建独立副本 |
| 归档文档 | `doc.archive` | 文档编号 | 保留内容、停止继续编辑，并处理原画布关联 |
| 恢复文档 | `doc.restore` | 已归档文档编号 | 恢复文档；画布关联需重新建立 |
| 重试同步到画布 | `doc.retryMirror` | 文档编号 | 重试同步未送达画布的更新；需配置同步服务，冲突时返回提示 |

### 2.2 正文、图片和导出接口

| 能力 | API 入口 | 用途／返回内容 |
| --- | --- | --- |
| 读取文档状态 | `GET /api/apps/doc/instances/{docId}/state` | 一次获取文档内容与保存状态所需信息 |
| 直接读取正文 | `GET /api/documents/{docId}/file` | 返回文字内容，供其他工具继续处理 |
| 直接保存正文 | `PUT /api/documents/{docId}/file` | 更新正文，同样需要版本保护 |
| 上传文档图片 | `POST /api/documents/{docId}/images` | 给图片名称和内容，保存为该文档的图片附件 |
| 读取文档图片 | `GET /api/documents/{docId}/images/{fileId}` | 返回有权限读取的图片，用于文档展示 |
| 导出文字稿 | `POST /api/documents/export` | 传入正文及 md／txt 格式，返回可下载文件 |
| 从画布打开文档 | `POST /api/apps/doc/open-editor` | 根据卡片关联找到对应文档的编辑入口 |
| 查询执行结果 | `GET /api/apps/doc/instances/{docId}/action-receipts/{receiptId}` | 查询一次操作的保存结果；避免超时后重复执行 |

**使用限制：** 正文由调用方提供；Word 导出 API、批注、审阅修订、多人同时编辑及完整 Word 排版暂不支持。

## 3. 草图 App

### 3.1 草图动作接口

- 列表和创建：`POST /api/apps/sketch/actions/{动作名}`。
- 操作已有草图：`POST /api/apps/sketch/instances/{sketchId}/actions/{动作名}`。

| 能力 | 动作名 | 输入 | 输出／效果 |
| --- | --- | --- | --- |
| 查草图列表 | `sketch.list` | 当前访问范围 | 返回可访问草图 |
| 新建草图 | `sketch.create` | 名称、可选初始画面数据 | 创建草图，返回编号 |
| 读取草图 | `sketch.read` | 草图编号 | 返回图形、位置、文字、图片等画面数据及版本 |
| 保存草图 | `sketch.write` | 更新后的画面数据、修改前版本 | 保存画面；冲突时拒绝覆盖 |
| 打开草图 | `sketch.open` | 草图编号 | 返回可继续编辑的页面地址 |
| 绑定画布 | `sketch.bind` | 草图编号、目标画布和卡片关联 | 将已有草图关联到画布卡片 |
| 草图改名 | `sketch.rename` | 新名称 | 更新草图名称 |
| 复制草图 | `sketch.copy` | 原草图编号、可选新名称 | 创建独立副本，不继承原卡片关联 |
| 归档草图 | `sketch.archive` | 草图编号 | 保留画面并停止编辑，处理原关联 |
| 恢复草图 | `sketch.restore` | 已归档草图编号 | 恢复草图；画布关联需按实际需要重新建立 |
| 保存导出图片 | `sketch.export-image` | 编辑器已导出的图片内容、文件名 | 保存图片，返回文件信息／下载地址 |

### 3.2 草图文件与下载接口

| 能力 | API 入口 | 用途／返回内容 |
| --- | --- | --- |
| 读取草图状态 | `GET /api/apps/sketch/instances/{sketchId}/state` | 返回画面和版本，供界面或其他工具使用 |
| 查看当前版本 | `GET /api/apps/sketch/instances/{sketchId}/revision` | 判断草图是否已被修改 |
| 读取／保存源文件 | `GET /api/sketches/{sketchId}/file`；`PUT /api/sketches/{sketchId}/file` | 读取或保存可以继续编辑的图形布局数据 |
| 保存导出图片（另一入口） | `POST /api/sketches/{sketchId}/export-image` | 保存编辑器生成的图片，与 `sketch.export-image` 动作功能一致 |
| 下载导出图片 | `GET /api/sketches/{sketchId}/exports/{fileName}` | 在权限允许时下载之前保存的导出图 |
| 从画布打开草图 | `POST /api/apps/sketch/open-editor` | 根据关联定位同一份草图 |
| 查询执行结果 | `GET /api/apps/sketch/instances/{sketchId}/action-receipts/{receiptId}` | 查保存或其他动作是否完成 |

**使用限制：** 导出图片需先由编辑器渲染，再通过接口保存；不支持服务端直接将草图渲染为 PNG。AI 绘图需由调用方生成图形布局数据。

## 4. 生图 App

**功能参考：** [Image Design Tool - 功能](https://docs.corp.kuaishou.com/d/home/fcAAffQT4sPzZxnHAeuAFf0d0)。参考文档包含扩展功能，当前支持范围以本清单为准。

生图在画布内使用：`{canvasId}` 为画布编号，`nodeId` 为生图卡片编号。

### 4.1 图片动作接口

- 创建生图卡：`POST /api/apps/image/actions/image.create`。
- 操作已有生图卡：`POST /api/apps/image/instances/{canvasId}/actions/{动作名}`。

| 能力 | 动作名 | 输入 | 输出／效果 |
| --- | --- | --- | --- |
| 创建生图卡 | `image.create` | 画布编号、位置、可选名称和设置 | 创建生图卡片 |
| 保存生图设置 | `image.configure` | 卡片编号、提示词／模型／比例等设置 | 保存设置，供下一次生成使用 |
| 提交生图 | `image.generate` | 卡片编号、可选本次调整 | 提交任务，返回任务编号和状态；成功后图片保存并回到画布 |
| 再生成一版 | `image.regenerate` | 卡片编号、可选新设置 | 发起新一轮生成，保留已有图片结果 |
| 查进度和结果 | `image.status` | 卡片编号 | 返回设置、任务状态、成功输出和错误信息 |
| 取消生成 | `image.cancel` | 卡片编号、任务编号 | 请求取消任务；最终状态及费用以模型平台为准 |

可设置的内容：

| 设置 | 当前范围 |
| --- | --- |
| 画面描述 | 提示词；也可配合参考图使用 |
| 参考图 | 最多16张已获授权的画布内图片，不接受任意外部链接 |
| 模型 | GPT 生图；Gemini 生图暂不保证稳定可用 |
| 画面比例 | 1:1、16:9、9:16、4:3、3:4 |
| 清晰度 | 2K、4K选项；实际结果受模型影响 |
| 张数 | 1—4张，每张分别提交任务；费用与可用范围以模型平台为准 |

### 4.2 发现能力和查询结果的接口

| 能力 | API 入口 | 用途／返回内容 |
| --- | --- | --- |
| 查看图片能力 | `GET /api/apps/image` | 返回图片动作、设置范围和参数说明 |
| 查看当前模型目录 | `GET /api/media/models` | 返回已配置模型及信息；使用需账号授权 |
| 查看图片工作区 | `GET /api/apps/image/instances/{canvasId}/state` | 返回生图卡的设置和结果信息 |
| 查询执行结果 | `GET /api/apps/image/instances/{canvasId}/action-receipts/{receiptId}` | 查某次请求是否受理或完成，避免重复生图 |
| 下载成功结果 | `GET /api/projects/{canvasId}/files/{path}` | 下载已成功保存的图片；路径从任务结果中取得 |

**使用限制：** 生图为异步任务，提交后需查询完成状态；需先开通模型权限。独立图片详情编辑器及通用图片编辑 API 暂不支持，裁剪／旋转使用画布接口。

## 5. 典型使用场景

| 想完成的任务 | 可组合的调用 | 得到什么 |
| --- | --- | --- |
| 批量搭建方案板 | `canvas.create` → `node.create`／`image.attach` → `layout.arrange` → 读取画布 | 有内容、有排布、可继续编辑的方案板 |
| 保存一份创意简报 | `doc.create` → `doc.write` → `doc.read` | 可继续编辑的文档；正文由调用方提供 |
| 将流程草图用于评审 | `sketch.create` → `sketch.write` → 在编辑器出图 → `sketch.export-image` | 可编辑草图和已保存的评审图片 |
| 生成几版视觉方向 | `image.create` → `image.configure` → `image.generate` → `image.status` | 任务记录、生成图片及画布结果 |
| 修改已有方案 | 先读取画布／文档／草图 → 提交带版本的修改 → 查询结果 | 保留原对象，确认修改已保存，避免覆盖新内容 |

## 6. 平台接入接口

平台标准动作入口：

`POST /open-platform/v1/instances/{providerInstanceId}/actions/{actionId}`

画布、文档、草图提供动作适配；文档、草图可通过 `GET /open-platform/v1/instances/{providerInstanceId}` 读取快照。生图使用画布内的图片接口。

DA／MA 的正式联调及部署状态需按接入环境单独确认。调用时需校验权限，修改已有内容需携带版本；请求超时后先查询执行结果，再决定是否重试。
