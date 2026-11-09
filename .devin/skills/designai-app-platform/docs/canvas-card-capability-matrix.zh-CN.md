# 画布核心卡能力矩阵

2026-10-20 用画布自己的保存链路实测：建卡、做动作、再把保存结果读回来。这不是在浏览器里逐个点击。读回还在，才算支持。引擎明确拒绝的，标不适用。这一轮没有「做了但没生效」或「该成功却失败」的待补项。

能力接口 `GET /api/apps/canvas` 的 `cardCapabilities` 与本表是同一份结果。测试在 `apps/server/tests/card-capability-matrix.test.ts`，改了动作语义却没改这张表，测试会失败。

## 怎么建

| 卡 | 建卡动作 | 存下来的样子 |
| --- | --- | --- |
| 文字 | `node.create`，kind 为 text | 普通节点 |
| 图片 | `image.attach` | 不在普通节点里，在图片列表。不要用 `node.create` 造图片 |
| 草图 | `sketch.create` | 普通节点，kind 为 sketch |
| 分镜 | `node.create`，kind 为 storyboard | 自带一镜，镜头 id 是「卡片 id-shot-0」 |
| 视频 | `node.create`，kind 为 video | 普通节点，kind 为 video |
| 网页 | `document.create`，format 为 html | kind 为 page，artifactFormat 为 html |
| PPT | `document.create`，format 为 presentation | kind 仍是 page，用 artifactFormat=presentation 和网页分开 |

七种建完再读，卡片都还在。

## 动作

| 动作 | 文字 | 图片 | 草图 | 分镜 | 视频 | 网页 | PPT |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `node.update` | 支持 | 不适用 | 不适用 | 不适用 | 不适用 | 支持 | 支持 |
| `node.rename` | 支持 | 支持 | 支持 | 支持 | 支持 | 支持 | 支持 |
| `node.resize` | 支持 | 支持 | 支持 | 支持 | 支持 | 支持 | 支持 |
| `node.move` | 支持 | 支持 | 支持 | 支持 | 支持 | 支持 | 支持 |
| `node.duplicate` | 支持 | 支持 | 支持 | 支持 | 支持 | 支持 | 支持 |
| `node.delete` | 支持 | 支持 | 支持 | 支持 | 支持 | 支持 | 支持 |
| `operation.undo` | 支持 | 支持 | 支持 | 支持 | 支持 | 支持 | 支持 |
| `image.replace` | 不适用 | 支持 | 不适用 | 不适用 | 不适用 | 不适用 | 不适用 |
| `image.transform` | 不适用 | 支持 | 不适用 | 不适用 | 不适用 | 不适用 | 不适用 |
| `image.select` | 不适用 | 支持 | 不适用 | 不适用 | 不适用 | 不适用 | 不适用 |
| `sketch.update` | 不适用 | 不适用 | 支持 | 不适用 | 不适用 | 不适用 | 不适用 |
| `document.begin` | 不适用 | 不适用 | 不适用 | 不适用 | 不适用 | 支持 | 支持 |
| `document.select` | 不适用 | 不适用 | 不适用 | 不适用 | 不适用 | 支持 | 支持 |
| `storyboard.shot.add` | 不适用 | 不适用 | 不适用 | 支持 | 不适用 | 不适用 | 不适用 |
| `storyboard.shot.update` | 不适用 | 不适用 | 不适用 | 支持 | 不适用 | 不适用 | 不适用 |
| `storyboard.shot.references` | 不适用 | 不适用 | 不适用 | 支持 | 不适用 | 不适用 | 不适用 |
| `storyboard.shot.move` | 不适用 | 不适用 | 不适用 | 支持 | 不适用 | 不适用 | 不适用 |
| `storyboard.shot.delete` | 不适用 | 不适用 | 不适用 | 支持 | 不适用 | 不适用 | 不适用 |
| `storyboard.shot.duplicate` | 不适用 | 不适用 | 不适用 | 支持 | 不适用 | 不适用 | 不适用 |
| `video.configure` | 不适用 | 不适用 | 不适用 | 不适用 | 支持 | 不适用 | 不适用 |
| `video.attach` | 不适用 | 不适用 | 不适用 | 不适用 | 支持 | 不适用 | 不适用 |
| `video.select` | 不适用 | 不适用 | 不适用 | 不适用 | 支持 | 不适用 | 不适用 |
| `edge.connect` | 支持 | 支持 | 不适用 | 不适用 | 不适用 | 支持 | 支持 |
| `edge.disconnect` | 支持 | 支持 | 不适用 | 不适用 | 不适用 | 支持 | 支持 |
| `group.create` | 支持 | 支持 | 支持 | 支持 | 支持 | 支持 | 支持 |
| `group.rename` | 支持 | 支持 | 支持 | 支持 | 支持 | 支持 | 支持 |
| `group.add` | 支持 | 支持 | 支持 | 支持 | 支持 | 支持 | 支持 |
| `group.remove` | 支持 | 支持 | 支持 | 支持 | 支持 | 支持 | 支持 |
| `group.dissolve` | 支持 | 支持 | 支持 | 支持 | 支持 | 支持 | 支持 |
| `group.move` | 支持 | 支持 | 支持 | 支持 | 支持 | 支持 | 支持 |
| `layout.arrange` | 支持 | 支持 | 支持 | 支持 | 支持 | 支持 | 支持 |

## 读这张表时别踩的坑

- 改卡片里的文字，走 `node.update`。它只对文字、网页、PPT 成立。图片用 `image.replace` / `image.transform` / `image.select`，草图用 `sketch.update`。
- 网页和 PPT 的动作完全一样。数据里都是 page，靠 artifactFormat 区分。
- 移动、改名、改大小、复制、删除、撤销，七种都可以。撤销的前提是上一笔动作成功。
- 分组和排列，七种都可以。
- 连线只对文字、图片、网页、PPT 成立。草图、分镜、视频当前会被拒绝。这是现在的引擎行为，不是漏测。要让这三种也能连线，得另改产品，这次没有改。
- 分镜的镜头动作要打在分镜卡上，shotId 用已有镜头。删镜头前至少留一镜，表里的「支持」是先加一镜再删掉新镜。
- 视频的 `video.select` 要先有 `video.attach` 产生的结果。
