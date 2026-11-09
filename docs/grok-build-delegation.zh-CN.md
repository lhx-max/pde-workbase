# Codex 主控与 Grok Build 执行协作

2026-10-21。本机入口 `/Users/zhuzhiheng/.grok/bin/grok`，实查版本1.0.54。CLI和本地说明是真源；更新版本后重查 `--help`。这是新建或按明确sessionId恢复的独立CLI会话，不代表操控已打开的GUI会话。

## 分工

Codex负责目标、方案、接口合同、任务拆分、差异审查和最终验收。Grok接有明确输入、有限改动面和客观验收条件的小任务。直接脚本可完成的批量替换、统计或测试运行优先直接脚本，不为省额度额外引入一次模型调用。

适合派：已确定改法的单模块修补；按给定用例补测试；按固定合同补DTO/适配器；带行号的只读检查；证据整理。不直接派：决定架构/权限模型、无边界探索、线上权限/部署/删除、控制别的开发对话。必要决策由主控先做完。

默认一个执行者、一次一个小任务。需要不同任务并行时，先划清文件所有权。此仓有并行开发和未提交内容，不能让执行者覆盖共享工作区；隔离副本/工作树必须包含任务所需的当前改动，不能默认干净HEAD就是当前版本。主控核对输入版本后才应用回传patch，不用整目录覆盖。

## 每个任务的 spec

```text
任务ID：<稳定ID>
目标：<一个可验证结果>
背景：<必要概念、实际入口、当前行为；不要转发整段聊天>
固定规则：先读目标仓AGENTS.md和本任务适用的既有Skill；说明实际可用工具。
输入基线：<分支/commit、任务相关未提交改动、输入文件或摘录>
允许修改：<精确文件清单>
禁止修改：<共享文件/宿主/发布配置等与本任务有关的边界>
实现要求：
1. <精确接口/字段/错误码/处理步骤>
2. <失败行为、兼容要求；拿不准的点停在blocked，不能自行改合同>
验收：<可客观判断的结果、必须覆盖的失败路径>
检查命令：<主控确认存在的命令、cwd、Node24路径等>
交付：<patch/产物路径> + 指定JSON报告
停止条件：缺输入、接口冲突、越出允许文件、工具拒绝、达到轮数上限。
禁止自行提交/推送/发布；已有授权之外的动作回报主控。
```

报告字段建议：taskId、status(done/blocked)、changedFiles、commands、verification、blocker。`verification`应给真实命令结果或读回，不写“应该正常”。收到done不代表主控验收通过。

## 已核对的调用方式

只读文件任务：

```sh
/Users/zhuzhiheng/.grok/bin/grok \
  --cwd /absolute/path/to/isolated-task \
  --sandbox strict \
  --no-subagents --disable-web-search \
  --tools read_file --permission-mode dontAsk \
  --max-turns 3 --verbatim --output-format json \
  --prompt-file /absolute/path/to/spec.md > result.json
```

固定编辑任务实测成功的是 `--tools read_file,search_replace --permission-mode dontAsk`，加 `--allow 'Read(/absolute/task/target.txt)' --allow 'Edit(/absolute/task/target.txt)'`；每个允许文件单独列明，保留隔离目录和轮数上限。本轮只设acceptEdits仍被工具许可拦住，stopReason是cancelled，文件没有改；加精确许可后才完成。不要用成功退出码推断编辑已执行。strict限制文件访问和子进程网络；需要依赖/测试时由主控在已准备环境运行，或另行明确任务所需的工具和sandbox配置，不能把打开shell当成精确文件授权。工具名写错可能只警告而不是退出，必须看stderr/实际工具记录，不能只凭allowlist字符串推断隔离已经成立。

`--tools ''`可用于只处理主控提供的文本，不读仓库。禁用子代理和网页搜索减少额外扩散；不使用全局always-approve。`--max-turns`是轮数限制，不等于费用或token硬预算。

stdout外层是CLI结果对象。优先读取 `structuredOutput`，而不是把整个stdout当业务JSON。只写“请只返回JSON”不足以阻止它在text里夹说明；本轮实际遇到过，`--json-schema '<JSON Schema>'` 的结构化提取和恢复回传字段已验证。但也有一次执行任务直接回blocked而不调用工具，不能仅凭格式合法算执行通过。执行报告可从text读取，业务是否成立仍查文件/测试；需要严格下游JSON时再用Schema约束并校验structuredOutput。读取stopReason，检查blocked/上限/中断；usage、modelUsage可以记录消耗。CLI的成功退出不等于任务完成。

恢复已有任务只用保存的 `--resume <sessionId>`。`--session-id`是新会话标识，不是恢复开关；不使用容易串到其他任务的无ID `--continue`。恢复时不加 `--restore-code`，避免对话恢复变成代码回滚。

工具证据可用 `grok export <sessionId> <new-output.md>` 获取；用 `grok usage <sessionId>`查该任务用量。主控仍重新检查diff、允许文件、业务结果，并运行针对性的测试/实际读回。执行者跑过测试只是回传证据之一。

## 本轮验证

结果在本仓忽略目录 `.tmp/grok-delegation-probe/`：

- 提供确定事实→按Schema提取四个验收状态：主控逐项校验通过。
- strict隔离目录内实际读取package.json：导出的工具记录确认Read调用，name/version/private/React peer与源文件一致。
- 固定单行编辑任务：主控逐字读回通过，另一份输入文件不变；中间的未执行与被许可拦截均如实保留。未修改真实业务源码。

这证明可作为受限执行者被调用，不证明其能独立完成整个业务或减少所有任务的总token。实际节省取决于：任务是否足够独立、spec是否简短准确、主控是否只回收必要产物，而不是重新读完全部执行过程。

公开的无凭据验证摘要见 [verification/grok-build-delegation/verification.json](verification/grok-build-delegation/verification.json)。原始CLI报告及工具转录保留在忽略目录，不作为源代码提交。
