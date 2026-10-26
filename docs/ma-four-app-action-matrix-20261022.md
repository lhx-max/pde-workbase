# 四 App 公开动作验收矩阵

依据本轮正在运行服务的 manifest 生成。状态未逐项核对前保持 pending；单测总数不能自动将每项改成 pass。CLI、HTTP、UI、MA/Agent 是不同列。

| App | 动作 | HTTP/存储 | CLI | UI | MA/Agent |
| --- | --- | --- | --- | --- | --- |
| canvas | canvas.create | Root逐动作读回 PASS（isolated local-test） | 真实CLI进程 PASS | pending | pending |
| canvas | canvas.rename | Root逐动作读回 PASS（isolated local-test） | 真实CLI进程 PASS | pending | pending |
| canvas | canvas.delete | Root逐动作读回 PASS（isolated local-test） | 真实CLI进程 PASS | pending | pending |
| canvas | canvas.duplicate | 声明不可用，501已验 | 501拒绝已验 | pending | pending |
| canvas | group.create | Root逐动作读回 PASS（isolated local-test） | 真实CLI进程 PASS | pending | pending |
| canvas | group.rename | Root逐动作读回 PASS（isolated local-test） | 真实CLI进程 PASS | pending | pending |
| canvas | group.add | Root逐动作读回 PASS（isolated local-test） | 真实CLI进程 PASS | pending | pending |
| canvas | group.remove | Root逐动作读回 PASS（isolated local-test） | 真实CLI进程 PASS | pending | pending |
| canvas | group.dissolve | Root逐动作读回 PASS（isolated local-test） | 真实CLI进程 PASS | pending | pending |
| canvas | group.move | Root逐动作读回 PASS（isolated local-test） | 真实CLI进程 PASS | pending | pending |
| canvas | layout.arrange | Root逐动作读回 PASS（isolated local-test） | 真实CLI进程 PASS | pending | pending |
| canvas | document.create | Root逐动作读回 PASS（isolated local-test） | 真实CLI进程 PASS | pending | pending |
| canvas | document.begin | Root逐动作读回 PASS（isolated local-test） | 真实CLI进程 PASS | pending | pending |
| canvas | document.select | Root逐动作读回 PASS（isolated local-test） | 真实CLI进程 PASS | pending | pending |
| canvas | image.attach | Root逐动作读回 PASS（isolated local-test） | 真实CLI进程 PASS | pending | pending |
| canvas | image.replace | Root逐动作读回 PASS（isolated local-test） | 真实CLI进程 PASS | pending | pending |
| canvas | image.transform | Root逐动作读回 PASS（isolated local-test） | 真实CLI进程 PASS | pending | pending |
| canvas | image.select | Root逐动作读回 PASS（isolated local-test） | 真实CLI进程 PASS | pending | pending |
| canvas | node.create | Root逐动作读回 PASS（isolated local-test） | 真实CLI进程 PASS | pending | pending |
| canvas | node.update | Root逐动作读回 PASS（isolated local-test） | 真实CLI进程 PASS | pending | pending |
| canvas | node.rename | Root逐动作读回 PASS（isolated local-test） | 真实CLI进程 PASS | pending | pending |
| canvas | node.resize | Root逐动作读回 PASS（isolated local-test） | 真实CLI进程 PASS | pending | pending |
| canvas | sketch.create | Root逐动作读回 PASS（isolated local-test） | 真实CLI进程 PASS | pending | pending |
| canvas | sketch.update | Root逐动作读回 PASS（isolated local-test） | 真实CLI进程 PASS | pending | pending |
| canvas | storyboard.shot.add | Root逐动作读回 PASS（isolated local-test） | 真实CLI进程 PASS | pending | pending |
| canvas | storyboard.shot.update | Root逐动作读回 PASS（isolated local-test） | 真实CLI进程 PASS | pending | pending |
| canvas | storyboard.shot.references | Root逐动作读回 PASS（isolated local-test） | 真实CLI进程 PASS | pending | pending |
| canvas | storyboard.shot.move | Root逐动作读回 PASS（isolated local-test） | 真实CLI进程 PASS | pending | pending |
| canvas | storyboard.shot.delete | Root逐动作读回 PASS（isolated local-test） | 真实CLI进程 PASS | pending | pending |
| canvas | storyboard.shot.duplicate | Root逐动作读回 PASS（isolated local-test） | 真实CLI进程 PASS | pending | pending |
| canvas | video.configure | Root逐动作读回 PASS（isolated local-test） | 真实CLI进程 PASS | pending | pending |
| canvas | video.attach | Root逐动作读回 PASS（isolated local-test） | 真实CLI进程 PASS | pending | pending |
| canvas | video.select | Root逐动作读回 PASS（isolated local-test） | 真实CLI进程 PASS | pending | pending |
| canvas | node.move | Root逐动作读回 PASS（isolated local-test） | 真实CLI进程 PASS | pending | pending |
| canvas | node.duplicate | Root逐动作读回 PASS（isolated local-test） | 真实CLI进程 PASS | pending | pending |
| canvas | node.delete | Root逐动作读回 PASS（isolated local-test） | 真实CLI进程 PASS | pending | pending |
| canvas | edge.connect | Root逐动作读回 PASS（isolated local-test） | 真实CLI进程 PASS | pending | pending |
| canvas | edge.disconnect | Root逐动作读回 PASS（isolated local-test） | 真实CLI进程 PASS | pending | pending |
| canvas | operation.undo | Root逐动作读回 PASS（isolated local-test） | 真实CLI进程 PASS | pending | pending |
| image | image.create | 真实Appwrite维护入口 PASS；非正式MA身份 | 真实CLI进程 PASS（CPU/编辑/配置，无新模型） | 结果已渲染 | 宿主读取后MA总结 |
| image | image.configure | 真实Appwrite维护入口 PASS；非正式MA身份 | 真实CLI进程 PASS（CPU/编辑/配置，无新模型） | pending | pending |
| image | image.generate | 两模型真实done/幂等；另一次页面Gemini成功 | 真实CLI进程 PASS；受控媒体执行器，0供应商调用 | 页面实际提交/回填/刷新 PASS，2048×2048 | 自主生成待验 |
| image | image.regenerate | 受控执行器：新任务/输出保留/取消后可再生成 PASS；真实供应商重生成待验 | 真实CLI进程 PASS；受控媒体执行器，0供应商调用 | pending | pending |
| image | image.tool | 真实Appwrite维护入口 PASS；非正式MA身份 | 真实CLI进程 PASS（CPU/编辑/配置，无新模型） | 旋转预览/保存/刷新/逐像素 PASS；其他工具待验 | pending |
| image | image.edit.read | 真实Appwrite维护入口 PASS；非正式MA身份 | 真实CLI进程 PASS（CPU/编辑/配置，无新模型） | pending | pending |
| image | image.edit.save | 真实Appwrite维护入口 PASS；非正式MA身份 | 真实CLI进程 PASS（CPU/编辑/配置，无新模型） | pending | pending |
| image | image.status | 真实Appwrite维护入口 PASS；非正式MA身份 | 真实CLI进程 PASS（CPU/编辑/配置，无新模型） | pending | pending |
| image | image.cancel | 受控执行器：错误卡拒绝/owner取消/abort/终态/再次生成 PASS；真实供应商取消待验 | 真实CLI进程 PASS；受控媒体执行器，0供应商调用 | pending | pending |
| doc | doc.list | 真实HTTP生命周期 PASS（隔离local-test） | 真实CLI进程 PASS（源码入口） | pending | pending |
| doc | doc.create | 真实HTTP生命周期 PASS（隔离local-test） | 真实CLI进程 PASS（源码入口） | pending | pending |
| doc | doc.read | 真实HTTP生命周期 PASS（隔离local-test） | 真实CLI进程 PASS（源码入口） | 正文刷新PASS | 原dispatcher读取PASS |
| doc | doc.write | 真实HTTP生命周期 PASS（隔离local-test） | 真实CLI进程 PASS（源码入口） | 正文保存PASS | 自主写入待验 |
| doc | doc.open | 真实HTTP生命周期 PASS（隔离local-test） | 真实CLI进程 PASS（源码入口） | pending | pending |
| doc | doc.rename | 真实HTTP生命周期 PASS（隔离local-test） | 真实CLI进程 PASS（源码入口） | pending | pending |
| doc | doc.archive | 真实HTTP生命周期 PASS（隔离local-test） | 真实CLI进程 PASS（源码入口） | pending | pending |
| doc | doc.copy | 真实HTTP生命周期 PASS（隔离local-test） | 真实CLI进程 PASS（源码入口） | pending | pending |
| doc | doc.restore | 真实HTTP生命周期 PASS（隔离local-test） | 真实CLI进程 PASS（源码入口） | pending | pending |
| doc | doc.retryMirror | 未配置队列，明确不可用；正文/版本不变 | CLI非零及错误码拒绝 PASS（正向待配置） | pending | pending |
| sketch | sketch.list | 真实HTTP生命周期 PASS（隔离local-test） | 真实CLI进程 PASS（源码入口） | pending | pending |
| sketch | sketch.create | 真实HTTP生命周期 PASS（隔离local-test） | 真实CLI进程 PASS（源码入口） | 前轮创建流程图 | pending |
| sketch | sketch.bind | 本地映射unbound已验 | Root真实CLI独立复跑 PASS | pending | pending |
| sketch | sketch.read | 真实HTTP生命周期 PASS（隔离local-test） | 真实CLI进程 PASS（源码入口） | 保存重开 | 原dispatcher读取PASS |
| sketch | sketch.write | 真实HTTP生命周期 PASS（隔离local-test） | 真实CLI进程 PASS（源码入口） | 前轮编辑保存 | 自主写入待验 |
| sketch | sketch.open | 真实HTTP生命周期 PASS（隔离local-test） | 真实CLI进程 PASS（源码入口） | pending | pending |
| sketch | sketch.rename | 真实HTTP生命周期 PASS（隔离local-test） | 真实CLI进程 PASS（源码入口） | pending | pending |
| sketch | sketch.archive | 真实HTTP生命周期 PASS（隔离local-test） | 真实CLI进程 PASS（源码入口） | pending | pending |
| sketch | sketch.copy | 真实HTTP生命周期 PASS（隔离local-test） | 真实CLI进程 PASS（源码入口） | pending | pending |
| sketch | sketch.restore | 真实HTTP生命周期 PASS（隔离local-test） | 真实CLI进程 PASS（源码入口） | pending | pending |
| sketch | sketch.export-image | 真实PNG存储/下载/解码 PASS（客户端供图） | Root真实CLI独立复跑 PASS | pending | pending |
