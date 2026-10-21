# 默认登录用户只读：云端配置与实测

日期：2026-10-21。目标 Appwrite 项目 `grworkspace`。按用户最新要求，**普通已登录用户默认可读，无需逐人申请；匿名不可读；写入只给维护者/服务身份**。

## 实际配置

- `canvas_app_dev` 的6个集合、`doc_app_dev/documents`，以及 `canvas_assets_v2` / `doc_assets_v2`：保留 `read("users")`，移除普通users的create/update/delete；读写仅显式维护身份。
- 当前显式维护/写入身份为本次已验证登录用户 `6a7144262b2aae180614`。动态服务API key按原scope运行，未发布/替换函数代码；后续增加服务身份须显式更新白名单，不能发维护者凭据给开发者。
- `canvas-coi` / `doc-api` 的执行者从 `users` 收敛到显式writer，防止普通读者借带写scope的函数改库。读者查看数据走自身会话的Appwrite只读API；原写函数不是默认读者通用调用口。
- 不打开单行/单文件额外授权，保留现有security=false；不改业务字段、索引、文件内容或其他App的函数/库/桶。
- 配置读回见 [after.json](after.json)。变更前备份保留在本机 `.runtime/developer-access-20261021/before.json`（原始宽权限）与 `.runtime/developer-access-default-read-20261021/before.json`（调整默认读范围前）。

“users”表示此Appwrite数据项目的已登录用户，不表示互联网匿名用户，也不等于“只允许公司邮箱”：账号准入/SSO另由平台管理。维护者/管理员仍能修改配置和数据；这不是对项目管理员的权限封禁。

## 验证

[reader-verification.json](reader-verification.json) 通过25项：临时普通账户真实登录并核对身份；两个库可读、匿名拒绝、create/update/delete拒绝；两个桶文件可读、匿名拒绝、上传/改名/删除拒绝；两条写函数执行拒绝。读者从未使用管理员key或维护者cookie。

校验实际修改时提交不同revision/名称，确认401/403；平台对完全相同内容的空操作可能返回200，不能只靠空操作判断写权限。共享业务数据未参与写入验证；测试只由维护者创建独立标识的临时记录/文件，读者尝试修改这些测试目标。

[cleanup.json](cleanup.json) 记录所有专用记录/文件已删除，测试账户已禁用、会话已撤销。维护者创建/读回/清理测试记录与文件成功；没有以“ACL写入成功”代替独立普通账号验证。

维护者经原CLI调用 `canvas-coi GET /api/apps/canvas`、`doc-api GET /api/apps/doc` 均为 completed / HTTP200，确认执行权限没有把维护者也挡住；这不额外宣称所有云端写业务已验收。

本仓策略单元测试5项、服务端全包341项通过（另1项跳过），工具和服务端类型检查通过；两仓provision/部署shell语法及缺writer时提前拒绝检查通过。全仓guard仍有既有MF React配对和两个`.mjs`登记问题；全仓typecheck仍被e2e缺失extension-fixture/browser-fixture阻塞。本任务不处理这些无关项，不声称全仓全绿。

## 工具与回滚

- [策略](../../../apps/server/src/storage/developer-access-policy.ts) 与 [测试](../../../apps/server/tests/developer-access-policy.test.ts)。
- [配置工具](../../../scripts/configure-developer-readonly.ts) 默认audit，明确config-dir、backup-dir、cli路径和writer；仅针对这两个库/桶和两个函数。apply独占备份文件、变更后读回，失败保留部分状态不自动恢复宽授权。restore只能使用对应可信备份，恢复原宽权限会重新允许写，须明确维护者授权。
- [真实账号验证工具](../../../scripts/verify-developer-readonly.ts) 会创建/禁用专用测试账号与临时数据，不作为开发者日常读命令；只有维护者在明确测试范围执行。
- 两仓初始化与函数部署脚本已要求显式 `APPWRITE_SERVICE_WRITER_IDS`（逗号分隔用户ID），默认不给users写或执行写函数。仅修改这些脚本不会迁移既有ACL，已有云配置由本次工具完成。

维护者日后只读核对当前ACL的命令（所有占位符换成当前机器实际值，输出目录用新的绝对路径）：

```sh
pnpm exec tsx scripts/configure-developer-readonly.ts --mode audit \
  --config-dir '<含grworkspace配置且CLI已登录的目录>' \
  --backup-dir '<本次审计输出绝对目录>' \
  --cli '<已安装appwrite-cli/dist/cli.cjs的绝对路径>' \
  --writer '<已验证维护者或服务userId>'
```

audit不改云端；apply需要独立新备份目录，不能覆盖旧before.json。开发者日常查看不执行本管理工具，而使用自己的普通会话读数据API。

## 范围限制

这次验收的是Appwrite这两套数据资源与两条写函数的普通用户边界；不是整个项目所有管理员/API key/其他App代码的渗透测试，也不为现有通用业务token增加reader角色。开发者不得取得这些writer凭据。HTTP业务代理的精细团队/实例授权、正式MA工具调用与staging仍按各自合同另验。
