# Canvas / Doc 真实浏览器验收

**状态：尚未全部通过。** 当前最新生产构建的完整真实UI链前7组通过，但“复制卡后立即编辑”仍未保存，末尾刷新用例因fail-fast未执行。原失败保留，不用等待后编辑的通过结果替代。

## 环境与隔离

- Chrome 155.0.8059.85，Playwright，Node 24.15.0，pnpm 10.33.2。
- workbench声明构建后，Next 16.2.6生产构建至独立`CANVAS_WEB_BUILD_DIR=.tmp/doc-sync-20261021-1346`，均成功：[最新构建原始日志](<final-build-2.log>)。
- Canvas API、Doc API、Next分别独立子进程，随机127.0.0.1端口；全部使用mkdtemp合成数据根。
- 最近完整验收URL：Canvas Web `http://127.0.0.1:62814/?projectId=browser-p`；Canvas API `http://127.0.0.1:62827`；Doc `http://127.0.0.1:62831/?doc=合成正文-75abcd88`。**测试结束均关闭，URL仅作历史证据。**
- 测试agent未改产品source，未操作现有服务、真实data、保留端口或DSH GUI。每轮临时进程/数据根均已清理；清理前验证绝对路径和mkdtemp前缀。

## 最新完整真实UI链

[原始日志](<final-attempt-2.log>) · [原始错误/结果](<final-attempt-2-result.json>) · [完整HTTP写入时间线](<final-attempt-2-traffic.json>)

| 检查 | 结果 |
|---|---|
| 从画布卡点击详情，打开既有canonical doc，不覆盖正文 | 通过 |
| 独立doc UI编辑自动保存，画布内嵌doc实时更新，node.text一致 | 通过 |
| 画布内嵌doc UI编辑自动保存，独立doc实时更新 | 通过 |
| 独立doc刷新持久，Canvas保持挂载不刷新以保留旧广播触发条件 | 通过 |
| 临时延迟一页真实doc.write制造冲突；409可见，local draft保留，remote正文可展开 | 通过 |
| 明确点击采用当前草稿，两个入口保持解决后的正文，不再回滚旧稿 | 通过 |
| HTTP创建独立资产新副本；浏览器编辑、刷新持久、原件和原入口不变 | 通过 |
| 画布原卡富文本编辑同步到doc | 通过（属于下一组前半） |
| 点击UI复制文本后立即编辑副本：新node/new doc/new path，但新正文未保存 | **失败** |
| 末尾刷新验证app页签、原正文及副本正文一起保留 | 未执行（上一项fail-fast） |

## 浏览器发现与修复状态

### 1. appTabs元数据刷新丢失：已修复并早前真实复验通过

修复前刷新后仅剩原始`app:doc:...`页签名、正文空白，无pageerror或HTTP4xx。父修server tabs路由遗漏appTabs后，重启临时API已验证恢复。

[修复前截图](<reload-bug-canvas.png>) · [结果](<reload-bug-result.json>) · [日志](<reload-bug-run.log>)

### 2. 旧镜像广播回写覆盖冲突解决正文：最新无中途刷新链已通过

修复前，resolve保存LOCAL CONFLICT成功后，hidden canvas主动POST node.update旧EMBEDDED正文，以最新expectedState成功回滚canonical doc。

[修复前网络证据](<no-reload-rollback-traffic.json#L282-L368>) · [修复前结果](<no-reload-rollback-result.json>)。最新完整链不在中途刷新Canvas，该回归已消失。

### 3. 复制卡路径重新alias：服务端已保护，前端仍发送旧path

修复前，node.duplicate先返回新path，随后前端自动PATCH副本为原卡path，服务接受。现在server的200响应保住新path，但前端仍发送该旧alias PATCH。

[最初错误网络证据](<card-copy-alias-traffic.json#L482-L512>) · [最初截图](<card-copy-alias-canvas.png>)。

最新：[前端旧path PATCH与服务端保护响应](<final-attempt-2-traffic.json#L450-L464>)。

### 4. 复制后立即编辑新稿仅存在DOM：最新构建仍失败

不是单纯Playwright fill问题：还使用真实click → Meta+A → keyboard.insertText，捕获正确副本nodeId的`inputType=insertText`。

- **立即输入**：focused 1.5s/6s与blur后1.5s，DOM仍新稿，但服务node.text和doc.content均旧稿，没有对应新正文保存HTTP。
- **等待receipt成功 + 预先blur + 1.2s再输入**：旧构建中focused1.5s已保存，原件和路径隔离正确，**不是必须blur后才能保存**。
- 最新第二次构建仍重现立即输入失败；不把等待场景当作原回归通过。

[旧构建立即输入快照](<old-build-keyboard-immediate/snapshots.json>) · [旧构建等待后输入快照](<old-build-keyboard-settled/snapshots.json>) · [最新构建立即输入快照](<new-build-keyboard-immediate/snapshots.json>) · [最新输入截图](<new-build-keyboard-immediate/focused-after-keys.png>) · [最新输入日志](<new-build-keyboard-immediate/new-build-run.log>)。

## 原始错误收集

所有运行中pageerror、requestfailed、HTTP >=400响应均写入各轮result JSON；最新脚本另以phase标记teardown。冲突实验doc.write 409为预期，不隐藏。刷新/关闭SSE产生ERR_ABORTED也保留。未捕获产品pageerror。

临时诊断第一次snapshot曾遇到Playwright序列化外层局部变量`document2`的harness错误，随后改为window.document重跑；它不是产品pageerror。最初纯HTTP worker缺allowedOrigins导致的Origin 403也已作为fixture错误归因，不视作产品权限缺陷。

## 只读真实React运行态定位（14:44）

[精简阶段对照](<copy-cow-runtime-fiber/summary.json>) · [输入后完整fiber](<copy-cow-runtime-fiber/fiber-after-input.json>) · [receipt时fiber](<copy-cow-runtime-fiber/fiber-receipt-response.json>) · [最终fiber](<copy-cow-runtime-fiber/fiber-final.json>) · [实际浏览器loaded scripts](<copy-cow-runtime-fiber/loaded-scripts.json>) · [原始日志与PATCH调用栈](<copy-cow-runtime-fiber/run-restored.log>)。

- 只读遍历真实React `root.current`，不修改state、不调用回调；临时包装fetch只记录原body、调用栈和当时fiber，然后原样发请求。
- 确认浏览器实际加载`04zbx338wkrnv.js`，内容含`acknowledgeOperations`，排除误用旧包。
- **新稿确实进入TipTap和全部React层**：输入后copy编辑器`isInitialized=true/isDestroyed=false/editorDoc=KEYBOARD…`，MarkdownWordDocument props、provider state/stateRef、pending、Flow basicNodes全部已有新稿。因此不是假contenteditable或编辑器回调未准备好。
- pending v3的新稿path是本地copy-on-write生成的第三条临时路径`.../<copyId>.md`，其base仍是source旧path；receipt返回canonical `.../<copyId>-op-<hash>.md`，corrections只包含source旧path。
- receipt快照已有saveErrorRef Error/conflictRetries=1；随后旧batch重试发送原正文旧alias PATCH。最终dirtyVersions=3、savedVersions=2，但pending已经空，provider/Flow恢复旧正文；TipTap仍保留新稿。定位为**receipt前真实COW路径与canonical rebase冲突及旧batch重试吞掉更高版本草稿**，已交修复agent按真实路径补回归。
- 依赖曾被另一外部pnpm install任务移除，依照父指示暂停到恢复；未安装/替换依赖。恢复后沿用Node24.15.0/pnpm10.33.2及同已知build，成功捕获上述证据。
- 只读instrumentation曾有`__name`注入helper和undefined deps数组的harness错误，均已修正；旧日志保留在同目录，不归因产品。成功捕获这一轮临时进程和数据根已清理。

## 结论

双入口共享正文、并发冲突保留/解决、独立资产新副本主编辑链已有真实UI证据。**复制卡立即编辑仍有未保存风险，因此目前不作全量验收通过结论。** 等父完成进一步修复后继续同原始快速输入链，并执行末尾刷新检查。
