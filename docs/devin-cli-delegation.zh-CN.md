# Codex 主控与 Devin SWE-2 执行协作

2026-10-21 用户授权：可以同时调用多个本地Devin CLI，但只用免费SWE-2；Codex负责规划、战略判断与验收，Devin按清晰执行单实施。最初只验证协作方式；2026-10-23 已用于四 App 的限定实现与真实 CLI 执行，实际验收见文末。

## 已核对的本机能力

- 入口：`/Users/zhuzhiheng/.local/bin/devin`；当前Codex shell的PATH未包含该目录，直接使用绝对路径，不需修改全局配置。
- CLI版本：`3000.11.92 (7f4e64980e22)`；已登录，可非交互执行。
- 当前账户模型清单将`swe-2-high`、`swe-2-medium`、`swe-2-max`标为Free；同名Lightning变体收费。派发固定`swe-2-high`，不使用模糊`swe`、Adaptive、Fusion或Lightning；不可用就报告阻塞，不切其他模型。免费状态是当次账户清单，不作永久价格承诺。
- `--prompt-file`读执行单，`-p`非交互执行，`--export`导出ATIF工具与模型记录，`--resume <sessionId>`可恢复指定任务。不要用无ID的continue恢复，以免串任务。
- 单独`--config`设置`subagents_enabled:false`，本轮export确认子代理工具未暴露；不改用户全局设置。避免Smart模式引入其他模型判断。
- `--sandbox`是进程隔离辅助，不等于所有工具都受精确文件白名单约束。当前实测即使传auto，导出也显示Autonomous；按真实配置和调用记录核验，不仅看命令文字。

官方参考：[CLI参数](https://docs.devin.ai/cli/reference/commands)、[配置](https://docs.devin.ai/cli/reference/configuration/config-file)、[权限](https://docs.devin.ai/cli/reference/permissions)。版本变化后重查本机help。

## 分工与派发门槛

Codex先完成接口与方案决策，把实现拆成边界清楚、可独立验收的任务；Devin负责按单执行并提供文件/命令证据。Devin的done只代表提交验收，主控重新检查后才能对外报完成。

适合派：固定合同的包装层/DTO/manifest实现、已确定改法的局部修复、给定失败用例的测试、有限文件的资料提取。不把“自行搞定整个App接入”作为执行单；身份模型、业务归属、部署策略、跨App接口和范围变更由Codex决定。

并行按文件所有权划分，不按“有四个App所以直接开四个”机械分配。当前多个仓有大量未提交改动：先记录输入commit与任务相关dirty文件，把本次真实基线放进独立副本/工作树；不能只从旧HEAD建工作树就当最新代码。共享registry、锁文件、协议类型、部署配置由主控串行整合。依赖另一任务的输入未定时，不派发依赖它的实现。

执行单中先要求读实际AGENTS.md、适用Skill和任务规范。隔离副本中保留适用规则及必要上下文；不要因换目录让规则失效，也不要让执行者扫描无关私人资料。

## 每个执行任务的 spec

```text
任务ID：<唯一ID>
唯一目标：<具体结果，不让执行者重新选择架构>
背景与规则：<所属App、必须读的AGENTS/Skill/规范>
输入基线：<commit、相关未提交改动摘要、准确文件入口>
允许修改：<精确文件清单>
禁止修改：<共享接口/锁文件/宿主/SDK等本次边界>
执行步骤：
1. <确定的接口、字段、错误和兼容要求>
2. <具体修改及必须保留的行为>
3. <检查和读回>
成功标准：<真实输出；正常与失败路径>
检查命令：<已确认存在的命令、cwd、Node24、依赖前提>
停止条件：缺输入、越界、接口冲突、权限拒绝、达到任务时限。
交付：patch + JSON报告，列taskId/status/changedFiles/commands/
      verification/blocker；不能把“应该成功”作为证据。
模型：仅swe-2-high；不再派子代理、不切模型、不自行扩大任务。
未经本单授权，不提交/推送/发布、不写真实云数据、不操作其他开发会话。
```

如果任务必须调用云端或供应商，主控先明确专用测试资产、认证注入、费用范围和清理方式；不默认把维护者凭据交给执行者。普通包级测试可交执行者按已限定命令运行，关键浏览器/真实身份/云端读回仍由具备能力的执行者完成并由主控核验。

## 调用与回收

本轮验证的命令形状（路径与配置按任务生成）：

```sh
cd /absolute/isolated-task
/Users/zhuzhiheng/.local/bin/devin \
  --model swe-2-high \
  --config /absolute/task-config.json \
  --permission-mode auto --sandbox \
  --respect-workspace-trust false \
  --export /absolute/conversation.json \
  --prompt-file /absolute/SPEC.md -p
```

`--respect-workspace-trust false`仅用于主控已创建并核对的任务副本，本轮为合成输入；不据此修改用户全局信任设置。配置保留AGENTS读取、关闭不需要的配置导入、禁用子代理和署名，按任务指定Read/Write/Exec权限。普通Read可能默认自动批准，allow列表不是排他白名单；进程sandbox也不涵盖所有直接文件工具。不能只写一个allow就宣称无法越界，隔离副本不应含不需要的秘密或业务资产。

探针禁用了exec与MCP，实际没有网页工具调用；本轮没有做越界攻击测试，不宣称网络或所有文件读写已被物理隔绝。真实开发任务按所需能力核准权限，再检查执行轨迹与产物。

每个进程独立cwd、spec、config、导出和日志；外部控制器设任务时限，超时仅终止该任务，不能使用全局pkill。CLI无已确认的轮数限制参数，不虚构`--max-turns`。重试先检查已有patch和副作用，避免重复执行；恢复只用保存的sessionId，并再次显式指定SWE-2。

主控回收时核对：实际模型、子代理调用、退出/中断状态、所有改动文件、diff与允许范围、真实输出/失败路径，再跑适用检查。应用patch前比较目标文件基线；目标若已被其他会话修改，重新合并，不能整目录覆盖。

## 本轮实测证据与边界

两路同时启动，使用独立合成目录；读取提取任务约26秒，单字段编辑任务约27秒。导出记录中agent模型为SWE-2 High、各步模型为`swe-2-high`，均无子代理工具；执行轨迹只有read/write/edit。主控另行读回：字段值符合要求，两个sentinel文件未变，目录没有额外业务文件。

原始spec、配置、工具导出和结果在 `/private/tmp/devin-swe2-probe-20261021/`；摘要为 `verification.json`。该路径是临时证据，不是业务依赖。它证明本地非交互调用、两进程并行、文件执行与回收可用，不证明四路真实App实现已完成、执行者不会犯错或任何任务都能节省总成本。


## 2026-10-23：实际执行后的回收要求

Devin SWE2 已执行 Doc/Sketch Provider 生命周期修复和四 App 已安装 CLI；Root 独立复现、核验改动、默认测试和实际云端读回。证据分别在 verification/provider-lifecycle-20261023 与 verification/four-app-agent-cli-20261023。后续同页多实例夹具另有独立记录，不将合成 Provider 当真实云端。

- 执行单明确写出 **报告绝对路径**，不能只写“本任务目录”。允许写入清单不等于进程沙箱必然允许落盘；报告被拒绝时保留导出/源文件，Root 核验实际交付，不切 dangerous 或扩大权限。
- 先实现再可选补充检索；限定已知入口和检查命令，避免反复寻找相同模式。没有源码/结果不能把 exit 0 当完成。
- 自定义 test include 可能漏掉默认套件；区分 worker 子集与 Root 默认运行。生命周期修复中 Sketch worker 59 项，Root 默认 64 项，不能互换口径。
- 新 UI fixture 仍须用实际 tarball 启动和浏览器操作；类型通过不能证明 CSS 尺寸、同页隔离或迟到响应正确。
- 关闭验收服务时检查最终退出与写锁释放，不能仅统计容器 removed。非预期退出、残留锁或未确认释放必须使验收失败；不自动抢占锁或修改旧业务数据。


2026-10-23最终后端修复由两个实际SWE2 CLI任务执行，38/42步，修改范围按文件分离。Root复核关停异常转交、4.5MB响应完整性与持久格式升级后的作用域测试；执行默认Doc server213项和最终固定镜像50项/真实私有云51项。执行者中途报告的在途测试失败由Root整体验收处理，不直接作为当前仓库结论；原始导出与维护凭据在交付包外。
