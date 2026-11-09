# 四 App 本地联调与全功能验收

状态：进行中。用户明确要求 Root 建目标、监管 Devin SWE2，范围包含四个 App 全部实际功能，重点后端/CLI，浏览器 App 不纳入。保留当前源码和运行数据；不改外部宿主/SDK，不合 main，不部署生产。

## 工作清单

| 功能域 | 本轮已验证 | 待补 |
| --- | --- | --- |
| 生图执行/回填 | 两个真实模型出图、幂等重放、文件下载解码 | 逐用户授权、真实 Agent 生成、异常/恢复及所有图片工具 |
| MA/权限 | 四 Provider 经原 dispatcher 读取、关联/租户/未知动作拒绝 | 正式 MA 存储门、同实例成员与跨实例、撤权和私有文件完整矩阵 |
| Canvas 后端 | 当前 629 通过、1 跳过；类型检查 | 38支持动作真实CLI和Root逐状态读回通过；1声明不可用 |
| Doc 后端 | 当前191通过 | 附件/导出/并发/恢复各 CLI 路径实测 |
| Sketch 后端 | 当前61通过；修正 CLI 同实例成员 fixture 后真实 Appwrite 28项通过 | 其他导出/图片/前端交互闭环 |
| 权威存储 | Canvas/Doc 真实 Appwrite恢复74项、48个本次资源清理成功 | 区分 fixture MA和真实业务身份；当前拼装页面仍用隔离本地数据 |
| 前端组件 | 发现模型菜单 SVG无尺寸导致宿主放大，源码补明确16px | 已安装新包并实际旋转/生图/刷新；其余UI仍逐项补验 |

执行目录 `/private/tmp/ma-backend-spike-20261022/`：三个独立 Devin 进程（canvas-image/doc/sketch），固定 swe-2-high，无子代理、无真实凭据、源码只读，分别产出 report.json/补丁提案；Root负责应用及运行复验。当前账户 models list 明确该模型 Free。完成报告必须复查实际 export 模型及可复现产物，不能采信执行者口头完成。

本轮模型与 Agent 分级证据：[验收记录](verification/ma-models-local-20261022/README.md)。前次四 App 拼装证据：[记录](verification/ma-four-app-local-20261022/README.md)。旧完成报告是历史基线，不替代本次用户扩大的全功能验收。

本轮后端修复与最新证据：[后端专项验收](verification/ma-backend-local-20261022/README.md)。两个真实模型已接通，API各一次，页面Gemini另一次成功；共3次实际成功生成。Appwrite恢复复跑74项、Sketch私有schema+独立CLI28项，CLI专项持续收口。失败卡删除经真实鼠标点击和规范服务读回通过（语义自动化点击不足以判产品缺陷）；原MA规则预读取与真实Agent总结已验，自主工具调用仍未证明。不要把本地联调记录升级成正式MA/云端验收结论。

最新检查点：69动作CLI列均有分层证据（67正向、1声明不可用、1镜像未配置拒绝）；图片CLI异步18项由Root修正Devin同步子进程阻塞后独立复跑，0真实供应商调用。页面Word/MD/TXT导出、草图PNG导出、3次真实模型请求及5图读回已验。下一段重点是独立隔离入口的真实Appwrite页面闭环与剩余UI；原18582及数据不覆盖。原宿主当前Agent工具桥边界详见 docs/ma-owner-contract-gaps-20261022.md。目标仍active，不宣称全部功能/正式MA已完成。
