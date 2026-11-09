# 快手内部 Appwrite Cloud Function 完整使用指南

> **基于 Appwrite 1.8.x** | 作者：fengzhiliang | 更新：2026-04-13

本文档结合官方 API 文档和实践踩坑经验，提供快手内部 Appwrite 云函数的完整使用说明。

---

## 目录

1. [数据库选型](#一数据库选型)
2. [Collection 权限配置](#二collection-权限配置)
3. [云函数 API Key 使用](#三云函数-api-key-使用)
4. [SDK 版本](#四sdk-版本)
5. [云函数标准写法模板](#五云函数标准写法模板)
6. [前端调用云函数](#六前端调用云函数)
7. [调试排查技巧](#七调试排查技巧)
8. [常见报错速查](#八常见报错速查)
9. [云函数配置参数详解](#九云函数配置参数详解)
10. [环境变量管理](#十环境变量管理)
11. [执行权限与触发方式](#十一执行权限与触发方式)

---

## 一、数据库选型

**❌ 不要用 TablesDB**，即使 `appwrite-cf databases create` 有时会创建 `type: "tablesdb"`：

```bash
# ❌ 会创建 tablesdb 类型（云函数无法用 API Key 读取）
appwrite-cf tables-db create --database-id "xxx" --name "xxx"

# ✅ 用标准 databases（type: legacy）
appwrite-cf databases create --database-id "xxx" --name "xxx"
```

云函数用 `node-appwrite` 的 `TablesDB.listRows` 调用 tablesdb，无论 API Key 是否有 `rows.read` scope，都会报 `not authorized`。改用 legacy collection + `Databases.listDocuments` 才能正常工作。

---

## 二、Collection 权限配置

创建 collection 时必须：
1. `read("any")` —— 允许任意来源读取
2. **`documentSecurity: false`** —— 关闭文档级权限，否则 collection 的 `read("any")` 会被单个 document 的权限覆盖

```bash
appwrite-cf databases create-collection \
  --database-id "food_db" \
  --collection-id "foods" \
  --name "Foods" \
  --permissions "create(\"users\")" "read(\"any\")" "update(\"users\")" "delete(\"users\")" \
  --document-security false   # ← 关键！
```

---

## 三、云函数 API Key 使用

**API Key 的 scope 在 CLI push 时会被覆盖**，要把服务端已有的 scopes 同步到 `appwrite-cf.config.json`：

```json
// appwrite-cf.config.json 中的 function 配置
"scopes": [
  "documents.read", "documents.write",
  "rows.read", "rows.write",
  "execution.read", "execution.write"
]
```

否则每次 `push-cf function` 会清空服务端 scopes，导致 API Key 失效。

**云函数内的 key 选择**（按优先级）：

```javascript
// ✅ 对于 read("any") 的 collection，完全不需要 key
const client = new Client()
  .setEndpoint(process.env.APPWRITE_FUNCTION_API_ENDPOINT)
  .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID);
// 不调用 .setKey()，直接匿名读取

// 如果需要写操作，才加 key
const apiKey = process.env.APPWRITE_FUNCTION_API_KEY || process.env.APPWRITE_API_KEY;
client.setKey(apiKey);
```

> `APPWRITE_FUNCTION_API_KEY` 是运行时内置变量，优先于手动配置的 `APPWRITE_API_KEY`。  
> CLI 查看变量时 `"value": ""` 是 secret 的正常隐藏显示，不代表值为空。

---

## 四、SDK 版本

服务器是 Appwrite 1.8.1，`node-appwrite` 最新版会提示版本不匹配（但不是报错根因）：

```json
// functions/xxx/package.json
{
  "type": "module",
  "dependencies": {
    "node-appwrite": "^18.0.0"
  }
}
```

安装时使用快手内部 npm 源：

```bash
npm install --registry https://npm.corp.kuaishou.com
```

---

## 五、云函数标准写法模板

```javascript
import { Client, Databases, Query } from 'node-appwrite';

export default async ({ req, res, log, error }) => {
  // ✅ userId 由 Appwrite 服务端自动注入到 headers，客户端无法伪造
  // ❌ 不要用 req.body.userId，客户端可以随意伪造
  const userId    = req.headers['x-appwrite-user-id']    ?? '';
  const userEmail = req.headers['x-appwrite-user-email'] ?? '';
  const userName  = req.headers['x-appwrite-user-name']  ?? '';

  log(`Request from user: ${userId}`);

  try {
    const client = new Client()
      .setEndpoint(process.env.APPWRITE_FUNCTION_API_ENDPOINT)
      .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID)
      .setKey(process.env.APPWRITE_FUNCTION_API_KEY || process.env.APPWRITE_API_KEY);

    const databases = new Databases(client);
    const result = await databases.listDocuments('db_id', 'collection_id', [
      Query.limit(100),
    ]);

    return res.json({ data: result.documents });
  } catch (err) {
    error(err.message);
    return res.json({ error: err.message }, 500);
  }
};
```

---

## 六、前端调用云函数

```typescript
import { Functions } from '@codeflicker/appwrite'

const functions = new Functions(client)
const response = await functions.createExecution({
  functionId: 'your-function-id',
  body: JSON.stringify({}),   // ✅ 不需要传 userId，服务端自动注入
  async: false,
  xpath: '/',
  method: 'POST',
  // ❌ 不要传 headers: { 'x-appwrite-xxx': ... }，会报 Invalid headers 错误
})

const result = JSON.parse(response.responseBody)
```

---

## 七、调试排查技巧

```bash
# 查最新执行日志（默认按升序，需自己排序找最新的）
appwrite-cf functions list-executions --function-id "xxx" 2>&1 | python3 -c "
import sys, json
data = sys.stdin.read()
obj = json.loads(data[data.find('{'):])
execs = sorted(obj['executions'], key=lambda x: x['\$createdAt'], reverse=True)
for e in execs[:3]:
    print(e['\$createdAt'], e.get('logs','')[:200], e.get('errors','')[:200])
"

# 查单次执行详情（从 Network 面板拿 execution id）
appwrite-cf functions get-execution --function-id "xxx" --execution-id "yyy"

# 验证字段是否就绪（processing -> available）
appwrite-cf databases get-attribute --database-id "xxx" --collection-id "yyy" --key "name" | grep status

# 查看数据库类型（legacy 才能用 Databases API）
appwrite-cf databases list | grep '"type"'
```

---

## 八、常见报错速查

| 报错信息 | 原因 | 解决方案 |
|---------|------|---------|
| `not authorized` | 1. 用了 TablesDB 但 API Key 无 `rows.read`<br>2. collection `documentSecurity: true` 且 document 无 `read("any")` | 改用 legacy Databases + 关闭 documentSecurity |
| `Invalid headers: cannot start with "x-appwrite"` | 前端 createExecution 传了 `x-appwrite-*` header | 改从 body 传 userId |
| `package subpath not defined` | 用了 `@codeflicker/appwrite/node` 不存在的子路径 | 改用 `node-appwrite` |
| `SDK built for 1.9.0, server is 1.8.1` | SDK 版本过高 | 降级到 `node-appwrite@18.0.0` |
| `No foods found` 但数据库有数据 | collection 刚重建，数据在旧 DB | 向新 collection 重新添加数据 |

---

## 九、云函数配置参数详解

基于 [Appwrite 1.8.x Functions API](https://appwrite.io/docs/references/1.8.x/server-rest/functions#create)，云函数支持以下核心配置参数：

### 创建/更新函数的关键参数

```json
{
  "functionId": "unique()",           // 函数 ID（必填）
  "name": "My Function",              // 函数名称（必填，最多 128 字符）
  "runtime": "node-18.0",             // 运行时环境（必填）
  "execute": ["any"],                 // 执行权限数组（最多 100 个角色）
  "events": [],                       // 触发事件列表（最多 100 个）
  "schedule": "",                     // CRON 定时任务语法
  "timeout": 15,                      // 超时时间（秒）
  "enabled": true,                    // 是否启用
  "logging": true,                    // 是否记录日志（禁用可提升性能）
  "entrypoint": "src/main.js",        // 入口文件路径
  "commands": "npm install",          // 构建命令
  "scopes": [                         // API Key 的权限范围（最多 100 个）
    "documents.read",
    "documents.write"
  ]
}
```

### 关键参数说明

#### 1. **runtime** - 运行时环境

快手内部服务器为 Appwrite 1.8.1，推荐使用：
- `node-18.0`（推荐）
- `node-16.0`
- `node-14.5`

查看所有可用运行时：
```bash
appwrite-cf functions list-runtimes
```

#### 2. **execute** - 执行权限

控制谁可以调用这个云函数：

```javascript
// 允许任何人（包括未登录用户）
"execute": ["any"]

// 仅允许已登录用户
"execute": ["users"]

// 仅允许特定用户
"execute": ["user:USER_ID"]

// 仅允许特定团队成员
"execute": ["team:TEAM_ID"]

// 组合权限
"execute": ["users", "team:admin"]
```

> ⚠️ **重要**：如果 `execute` 为空数组，前端用户将无法调用，只有服务端 API Key 可以调用。

#### 3. **events** - 事件触发

云函数可以响应 Appwrite 系统事件：

```javascript
"events": [
  "databases.*.collections.*.documents.*.create",  // 文档创建时触发
  "databases.*.collections.*.documents.*.update",  // 文档更新时触发
  "databases.*.collections.*.documents.*.delete",  // 文档删除时触发
  "users.*.create",                                // 用户注册时触发
  "users.*.sessions.*.create",                     // 用户登录时触发
]
```

**通配符规则**：
- `*` - 匹配任意值
- `databases.food_db.collections.foods.documents.*.create` - 只监听特定 collection

#### 4. **schedule** - 定时任务

使用 CRON 语法设置定时执行：

```javascript
"schedule": "0 0 * * *"      // 每天凌晨执行
"schedule": "*/5 * * * *"    // 每 5 分钟执行
"schedule": "0 9 * * 1"      // 每周一 9:00 执行
```

#### 5. **timeout** - 超时时间

最大执行时间（秒），超时后函数会被强制终止。

- 默认：15 秒
- 最大值：取决于服务器配置（通常为 900 秒，即 15 分钟）

```javascript
"timeout": 30  // 30 秒超时
```

#### 6. **logging** - 日志记录

```javascript
"logging": true   // 记录完整日志（默认）
"logging": false  // 禁用日志，提升性能（适用于高频调用场景）
```

> ⚠️ 禁用日志后，执行记录中不会包含 `logs` 和 `errors` 字段。

#### 7. **scopes** - API Key 权限

⚠️ **超级重要**：每次 `push-cf function` 会用本地配置覆盖服务端！

```json
// appwrite-cf.config.json
{
  "functions": [
    {
      "$id": "my-function",
      "scopes": [
        "documents.read",      // 读取文档
        "documents.write",     // 写入文档
        "collections.read",    // 读取 collection 结构
        "execution.read",      // 读取执行记录
        "execution.write"      // 创建执行
      ]
    }
  ]
}
```

**完整 scopes 列表**：
- `documents.read` / `documents.write`
- `collections.read` / `collections.write`
- `databases.read` / `databases.write`
- `users.read` / `users.write`
- `teams.read` / `teams.write`
- `storage.read` / `storage.write`
- `execution.read` / `execution.write`

---

## 十、环境变量管理

云函数支持环境变量，可在运行时通过 `process.env` 访问。

### 创建环境变量

```bash
# 创建普通变量
appwrite-cf functions create-variable \
  --function-id "my-function" \
  --key "API_BASE_URL" \
  --value "https://api.example.com"

# 创建敏感变量（secret）
appwrite-cf functions create-variable \
  --function-id "my-function" \
  --key "API_SECRET" \
  --value "my-secret-key" \
  --secret true
```

### 查看环境变量

```bash
# 列出所有变量
appwrite-cf functions list-variables --function-id "my-function"

# 查看单个变量
appwrite-cf functions get-variable \
  --function-id "my-function" \
  --variable-id "VARIABLE_ID"
```

> ⚠️ **注意**：`secret: true` 的变量，CLI 查看时显示 `"value": ""`，这是正常的安全隐藏，实际值在云函数运行时可用。

### 更新环境变量

```bash
appwrite-cf functions update-variable \
  --function-id "my-function" \
  --variable-id "VARIABLE_ID" \
  --key "API_BASE_URL" \
  --value "https://new-api.example.com"
```

### 删除环境变量

```bash
appwrite-cf functions delete-variable \
  --function-id "my-function" \
  --variable-id "VARIABLE_ID"
```

### 在云函数中使用环境变量

```javascript
export default async ({ req, res, log, error }) => {
  // 读取自定义环境变量
  const apiUrl = process.env.API_BASE_URL;
  const apiSecret = process.env.API_SECRET;

  // 系统内置环境变量
  const endpoint = process.env.APPWRITE_FUNCTION_API_ENDPOINT;
  const projectId = process.env.APPWRITE_FUNCTION_PROJECT_ID;
  const apiKey = process.env.APPWRITE_FUNCTION_API_KEY;
  
  log(`Using API: ${apiUrl}`);
  
  // 使用环境变量
  const response = await fetch(`${apiUrl}/data`, {
    headers: { 'Authorization': `Bearer ${apiSecret}` }
  });
  
  return res.json({ data: await response.json() });
};
```

### 系统内置环境变量

云函数运行时自动注入以下环境变量：

| 变量名 | 说明 |
|--------|------|
| `APPWRITE_FUNCTION_ID` | 当前函数 ID |
| `APPWRITE_FUNCTION_NAME` | 当前函数名称 |
| `APPWRITE_FUNCTION_DEPLOYMENT` | 当前部署 ID |
| `APPWRITE_FUNCTION_PROJECT_ID` | 项目 ID |
| `APPWRITE_FUNCTION_API_ENDPOINT` | Appwrite API 端点 |
| `APPWRITE_FUNCTION_API_KEY` | 🔑 自动生成的 API Key（带 scopes 权限，推荐使用） |
| `APPWRITE_API_KEY` | 🔑 默认的 API Key（向后兼容，与 `APPWRITE_FUNCTION_API_KEY` 相同） |
| `APPWRITE_FUNCTION_RUNTIME_NAME` | 运行时名称（如 `Node.js`） |
| `APPWRITE_FUNCTION_RUNTIME_VERSION` | 运行时版本（如 `18.0`） |

**API Key 使用说明**：
- ✅ **推荐使用** `APPWRITE_FUNCTION_API_KEY`：这是云函数专用的 API Key，权限范围由配置文件中的 `scopes` 字段控制
- ✅ **兼容性备选** `APPWRITE_API_KEY`：向后兼容的默认 API Key，与 `APPWRITE_FUNCTION_API_KEY` 值相同
- 💡 **最佳实践**：代码中使用 `process.env.APPWRITE_FUNCTION_API_KEY || process.env.APPWRITE_API_KEY` 确保兼容性

```javascript
// 推荐写法（向后兼容）
const apiKey = process.env.APPWRITE_FUNCTION_API_KEY || process.env.APPWRITE_API_KEY;
client.setKey(apiKey);
```

---

## 十一、执行权限与触发方式

### 触发方式对比

| 触发方式 | 使用场景 | 权限检查 | 用户上下文 |
|---------|---------|---------|----------|
| **手动调用**（前端/SDK） | 用户主动触发的操作 | 检查 `execute` 权限 | ✅ 有（`x-appwrite-user-id` 等） |
| **事件触发**（events） | 数据变更自动触发 | ❌ 不检查（系统触发） | ❌ 无 |
| **定时任务**（schedule） | 定期执行的任务 | ❌ 不检查（系统触发） | ❌ 无 |
| **API Key 调用** | 服务端集成 | ❌ 不检查（服务端） | ❌ 无 |

### 手动调用 - 前端 SDK

```typescript
import { Functions } from '@codeflicker/appwrite'

const functions = new Functions(client)

// 同步执行（等待结果）
const response = await functions.createExecution({
  functionId: 'my-function',
  body: JSON.stringify({ userId: 123 }),
  async: false,          // 同步执行
  method: 'POST',
  xpath: '/api/users',   // 路径（可选）
})

const result = JSON.parse(response.responseBody)

// 异步执行（后台运行）
await functions.createExecution({
  functionId: 'my-function',
  body: JSON.stringify({ task: 'process' }),
  async: true,           // 后台执行，立即返回
})
```

**关键参数**：
- `async: false` - 同步执行，等待函数返回（最多等待 `timeout` 秒）
- `async: true` - 异步执行，立即返回 execution ID，函数在后台运行
- `xpath` - HTTP 路径，可在函数中通过 `req.path` 获取
- `method` - HTTP 方法，可在函数中通过 `req.method` 获取

### 事件触发 - 自动执行

在 `appwrite-cf.config.json` 中配置：

```json
{
  "functions": [
    {
      "$id": "notify-on-user-create",
      "name": "新用户通知",
      "events": [
        "users.*.create"
      ],
      "execute": []  // 事件触发不需要 execute 权限
    }
  ]
}
```

函数中可以从 `req.body` 获取事件数据：

```javascript
export default async ({ req, res, log }) => {
  // 事件触发时，req.body 包含触发事件的完整数据
  const eventData = JSON.parse(req.body || '{}');
  
  log(`Event: ${eventData.$id}`);
  log(`User created: ${eventData.name}`);
  
  // 发送通知...
  
  return res.json({ success: true });
};
```

### 定时任务 - CRON

```json
{
  "functions": [
    {
      "$id": "daily-report",
      "name": "每日报告",
      "schedule": "0 9 * * *",  // 每天 9:00 执行
      "execute": []  // 定时任务不需要 execute 权限
    }
  ]
}
```

### 执行权限最佳实践

```json
// ✅ 推荐：根据业务需求精确控制
{
  "execute": ["users"]          // 仅登录用户可调用
}

// ✅ 公开 API（如查询商品列表）
{
  "execute": ["any"]            // 任何人都可调用
}

// ✅ 管理员操作
{
  "execute": ["team:admin"]     // 仅 admin 团队成员
}

// ❌ 不推荐：完全不设权限
{
  "execute": []                 // 前端无法调用，只能事件/定时/API Key 触发
}
```

---

## 参考资料

- [Appwrite 1.8.x Functions API 官方文档](https://appwrite.io/docs/references/1.8.x/server-rest/functions)
- [Appwrite Cloud Functions 教程](https://appwrite.io/docs/products/functions)
- [快手内部 appwrite-cf CLI 文档](../entrypoint.md)
