# Design Canvas 后端联调权限：给项目维护者的操作说明

2026-10-22。对应 Appwrite 开发项目 `designcanvasdev20261021`，函数 `canvas-storage`，业务团队 `canvasdevtest`。对象为朱志恒（`zhuzhiheng@kuaishou.com`）。本说明不授权执行者越权，也不要求共享管理员Cookie、API key、密码或邀请secret。

## 先纠正判断范围

此前从朱志恒的CLI控制台会话访问函数/集合/桶管理接口得到401，只能证明**该会话没有该项目的后台管理权限**，不能据此判断普通用户是否能执行函数。站点协作成员、Appwrite控制台管理团队、Appwrite项目内业务团队是三层权限。

详情业务联调优先使用：用户自己的SSO项目会话 → 可执行保存函数 → 函数验证JWT与`canvasdevtest`成员 → 访问私有场景/图片。数据库和桶继续保持私有，无需先开放整个控制台或授予组织Developer角色。

## 已核实的工具

本机读取PDE Agent Skill中的appwrite-cf指南，并用公司包`@codeflicker/appwrite-cli@15.1.0-beta.30`的真实`--help`核对以下命令和参数。没有执行邀请、成员更新、函数权限更新或数据库权限更改。

- `users list --search`
- `teams create-membership --team-id --user-id --roles [roles...] --url`
- `teams list-memberships --team-id`

使用公司CLI `appwrite-cf`，不要换成官方`appwrite`命令。若未安装，可使用：

```sh
npx -y --registry=https://npm.corp.kuaishou.com/ @codeflicker/appwrite-cli@15.1.0-beta.30 --help
```

## 由项目维护者执行

在**已有该开发项目配置的目录**执行，不要`init project`重建项目，不要覆盖现有配置。以下`appwrite-cf`也可替换成上面的npx前缀。

### 1. 核对登录与目标

```sh
appwrite-cf whoami
node -p "JSON.parse(require('fs').readFileSync('appwrite-cf.config.json','utf8')).projectId"
```

第二条必须输出`designcanvasdev20261021`。未登录才执行`appwrite-cf login-ks`，使用维护者本人的SSO。不能在站点`design-canvas`或朱志恒的`grworkspace`上下文执行以下写操作。涉及资源管理前按PDE Skill在已备份/无未提交配置变更的目录同步`appwrite-cf pull all`；该命令不是替代核对目标。

### 2. 获取此项目中的真实用户ID

```sh
appwrite-cf users list --search "zhuzhiheng@kuaishou.com"
```

核对邮箱/账号后取该条记录的`$id`。**不能直接使用朱志恒的console用户ID**，也不要凭用户名拼ID。若该项目内还没有这个SSO用户，让朱志恒先打开维护者提供的、连接此开发项目的SDK开发页面完成自己的SSO登录，再重查；不要为他创建密码账户、替他登录或共享维护者会话。

### 3. 先查现有成员，再按需添加

```sh
appwrite-cf teams list-memberships --team-id canvasdevtest
```

已存在且`confirm:true`时，不再重复邀请。不存在时，由有该项目/团队管理权限的维护者执行：

```sh
appwrite-cf teams create-membership \
  --team-id canvasdevtest \
  --user-id "第2步查到的项目用户ID" \
  --roles member \
  --url "http://localhost:5178/excalidraw/embed.html?appwrite=1"
```

`--url`是邀请接受后返回的位置，不是后端地址；以上仅适用于项目已登记localhost开发平台的情况。若提示URL不允许，替换为该项目**实际已登记并实现邀请接受流程**的页面，不关闭校验、不使用任意回跳地址。CLI帮助说明Server SDK模式会直接加入、Client邀请模式可能需要本人接受；具体以实际返回和下一步读回为准。

### 4. 确认加入和函数执行范围

```sh
appwrite-cf teams list-memberships --team-id canvasdevtest
appwrite-cf functions get --function-id canvas-storage
```

核对目标用户membership的`confirm:true`。对方源码的`isMember`明确要求已确认成员；`confirm:false`只是待接受邀请，不等于联调可用。如果需要接受，交由朱志恒使用自己的会话和私有邀请流程完成，不把secret写进群聊/仓库。

函数若已有登录用户执行权限，无需扩大。如果现有execute策略不含该用户，维护者需在保留已有策略的前提下，按最小范围添加这个项目用户的执行资格；不要把函数开放给匿名，不将集合/桶改为`any`或全体用户写入，不增加无关服务scopes。

## 完成后如何验证

由朱志恒自己的SDK登录态执行一次获授权的合成图片/空场景读写，查保存版本与幂等回执，再关闭重开；只在专用测试实例中写入，不覆盖维护者已有场景。分别验证未入团队用户拒绝、保存冲突和结果回传。

这些操作通过，不要求朱志恒的管理接口也变为200。只读/写角色仍需按后续正式宿主动作授权合同实现；本次业务Team加入不等于正式MA委托已接好。

## 只有确需管理后台时，才单独开管理权限

若后续需要朱志恒部署函数或修改schema，再由维护者查询项目所属控制台组织/团队，并在确认授权范围后邀请。这个组织可能包含多个项目，不能为了一个详情联调给整个组织Developer/Owner权限。

当前CLI的`organizations`只有list/create；把本地projectId改为`console`后尝试管理命令，实测报`Admin mode is not allowed for console project`。因此本说明**不提供未经验证的“teams命令加console组织成员”写法**，也不要求修改CLI登录态来绕过。该管理需求应由项目Owner在其对应控制台成员入口或经平台确认的管理API完成。站点详情的“协作成员”已验证可用，但不能代替这里的后端管理授权。

## 新交接的范围

`新分支联调准备-20261022.md`补充的是`examples/designai/open-image.ts`及协议对齐；其0.1.0制品、MA身份、持久绑定、资源桥与回传的未完成项仍分别存在。权限开通只解决真实云端验收的访问条件，不会自动完成这些代码接缝。
