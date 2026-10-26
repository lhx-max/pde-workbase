# Appwrite Permissions 权限系统完整指南

> **基于 Appwrite 1.8.x** | 作者：fengzhiliang | 更新：2026-04-13

本文档详细介绍 Appwrite 权限系统的核心概念、使用方法和最佳实践。

---

## 目录

1. [权限系统概述](#一权限系统概述)
2. [权限类型（Permission Types）](#二权限类型permission-types)
3. [角色（Roles）](#三角色roles)
4. [默认权限行为](#四默认权限行为)
5. [服务端集成](#五服务端集成)
6. [实战示例](#六实战示例)
7. [快手内部最佳实践](#七快手内部最佳实践)
8. [常见问题与陷阱](#八常见问题与陷阱)

---

## 一、权限系统概述

Appwrite 的权限机制提供了一种简单而灵活的方式来管理用户、团队或角色对项目资源（如数据库文档、文件）的访问控制。

### 核心特性

- ✅ **细粒度控制**：可以精确控制到单个文档或文件
- ✅ **多维度授权**：支持用户、团队、角色、认证状态等多种维度
- ✅ **权限继承**：支持 Table 级别和 Document 级别的权限配置
- ✅ **灵活组合**：同一资源可以设置多个权限规则

### 权限的 4 种操作类型

| 操作类型 | 说明 | 适用场景 |
|---------|------|---------|
| **`read`** | 读取权限 | 查看文档内容、下载文件 |
| **`create`** | 创建权限 | 在 collection 中新建文档 |
| **`update`** | 更新权限 | 修改已有文档或文件 |
| **`delete`** | 删除权限 | 删除文档或文件 |

### 可授权的资源类型

- **Database**（数据库）
- **Table/Collection**（表/集合）
- **Row/Document**（行/文档）
- **Bucket**（存储桶）
- **File**（文件）

---

## 二、权限类型（Permission Types）

在 SDK 中，通过 `Permission` 类来定义权限：

```typescript
import { Permission, Role } from '@codeflicker/appwrite'

// 4 种权限类型
Permission.read(Role.any())       // 读取权限
Permission.create(Role.users())   // 创建权限
Permission.update(Role.users())   // 更新权限
Permission.delete(Role.user("USER_ID"))  // 删除权限
```

### 权限的字符串格式

在 CLI 或配置文件中，权限以字符串形式表示：

```bash
# 格式：操作类型("角色")
"read(\"any\")"                    # 任何人可读
"create(\"users\")"                # 已登录用户可创建
"update(\"user:USER_ID\")"         # 特定用户可更新
"delete(\"team:TEAM_ID/owner\")"   # 特定团队的 owner 角色可删除
```

---

## 三、角色（Roles）

`Role` 类定义了谁可以执行操作。

### 基础角色

| 角色方法 | 字符串格式 | 说明 |
|---------|-----------|------|
| `Role.any()` | `"any"` | **任何人**（包括未登录用户） |
| `Role.users()` | `"users"` | **所有已登录用户** |
| `Role.guests()` | `"guests"` | **仅未登录用户**（游客） |

```typescript
// 示例：公开可读，登录用户可创建
[
  Permission.read(Role.any()),      // 任何人可读
  Permission.create(Role.users()),  // 登录用户可创建
]
```

### 特定用户

| 角色方法 | 字符串格式 | 说明 |
|---------|-----------|------|
| `Role.user(userId)` | `"user:USER_ID"` | 特定用户 ID |
| `Role.user(userId, "verified")` | `"user:USER_ID/verified"` | 已验证的特定用户 |
| `Role.user(userId, "unverified")` | `"user:USER_ID/unverified"` | 未验证的特定用户 |

```typescript
// 示例：只有特定用户可以删除
Permission.delete(Role.user("5c1f88b42259e"))
```

### 团队权限

| 角色方法 | 字符串格式 | 说明 |
|---------|-----------|------|
| `Role.team(teamId)` | `"team:TEAM_ID"` | 团队所有成员 |
| `Role.team(teamId, "owner")` | `"team:TEAM_ID/owner"` | 团队中的 owner 角色 |
| `Role.team(teamId, "admin")` | `"team:TEAM_ID/admin"` | 团队中的 admin 角色 |

```typescript
// 示例：团队成员可读，owner 可删除
[
  Permission.read(Role.team("marketing")),
  Permission.delete(Role.team("marketing", "owner")),
]
```

### 标签（Label）权限

基于用户标签的权限控制：

| 角色方法 | 字符串格式 | 说明 |
|---------|-----------|------|
| `Role.label(label)` | `"label:LABEL_NAME"` | 拥有特定标签的用户 |

```typescript
// 示例：只有 VIP 用户可以访问
Permission.read(Role.label("vip"))
```

---

## 四、默认权限行为

### 使用 Server SDK 创建资源

```javascript
// ❌ 没有显式权限 = 默认为空 = 无人可访问
await databases.createDocument(
  'db_id',
  'collection_id',
  'unique()',
  { name: 'Test' }
  // 未传 permissions 参数
);
// 结果：无人可以访问此文档（除了使用 API Key 的服务端）
```

### 使用 Client SDK 创建资源

```javascript
// ✅ 没有显式权限 = 创建者默认获得 read, update, delete 权限
await databases.createDocument(
  'db_id',
  'collection_id',
  'unique()',
  { name: 'Test' }
  // 未传 permissions 参数
);
// 结果：创建者可以读、更新、删除此文档
```

### 最佳实践

**总是显式设置权限，避免依赖默认行为！**

```typescript
// ✅ 推荐：显式设置权限
await databases.createDocument(
  'db_id',
  'collection_id',
  'unique()',
  { name: 'Test' },
  [
    Permission.read(Role.any()),
    Permission.update(Role.user(currentUserId)),
    Permission.delete(Role.user(currentUserId)),
  ]
);
```

---

## 五、服务端集成

### Server SDK 的特权

使用 Server SDK + API Key，可以**绕过所有权限检查**，访问任何资源。

```javascript
// 服务端代码（node-appwrite）
import { Client, Databases } from 'node-appwrite';

const client = new Client()
  .setEndpoint(process.env.APPWRITE_FUNCTION_API_ENDPOINT)
  .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID)
  .setKey(process.env.APPWRITE_API_KEY);  // 🔑 API Key 赋予特权

const databases = new Databases(client);

// ✅ 可以访问任何文档，不受权限限制（前提是 API Key 有对应的 scopes）
const docs = await databases.listDocuments('db_id', 'collection_id');
```

### 使用场景

1. **跨用户数据共享**：用户 A 想分享文档给用户 B（A 不在 B 的团队）
2. **管理员操作**：批量修改所有用户的数据
3. **系统级操作**：定时任务清理过期数据

### 注意事项

⚠️ **API Key 的 scopes 必须包含对应的操作权限**：

```json
// appwrite-cf.config.json
{
  "functions": [{
    "scopes": [
      "documents.read",   // 才能读取文档
      "documents.write"   // 才能写入文档
    ]
  }]
}
```

---

## 六、实战示例

### 示例 1：基础权限配置

**需求**：创建一个文档，任何人可读，writers 团队可编辑，管理员和特定用户可删除。

```typescript
import { Databases, Permission, Role, ID } from '@codeflicker/appwrite'

const databases = new Databases(client)

await databases.createDocument(
  'movie_db',
  'actors',
  ID.unique(),
  { actorName: 'Chris Evans', height: 183 },
  [
    Permission.read(Role.any()),                     // 任何人可查看
    Permission.update(Role.team("writers")),         // writers 团队可编辑
    Permission.update(Role.team("admin")),           // admin 团队可编辑
    Permission.delete(Role.user("5c1f88b42259e")),   // 特定用户可删除
    Permission.delete(Role.team("admin"))            // admin 团队可删除
  ]
)
```

**权限矩阵**：

| 角色 | 读取 | 创建 | 更新 | 删除 |
|------|-----|------|------|------|
| 任何人（any） | ✅ | ❌ | ❌ | ❌ |
| writers 团队 | ✅ | ❌ | ✅ | ❌ |
| admin 团队 | ✅ | ❌ | ✅ | ✅ |
| 用户 5c1f88b42259e | ✅ | ❌ | ❌ | ✅ |

---

### 示例 2：团队角色权限

**需求**：只有特定团队成员可读，只有团队 owner 可编辑和删除。

```typescript
await databases.createDocument(
  'project_db',
  'confidential',
  ID.unique(),
  { content: 'Top Secret' },
  [
    Permission.read(Role.team("5c1f88b87435e")),              // 团队成员可读
    Permission.update(Role.team("5c1f88b87435e", "owner")),   // owner 可更新
    Permission.delete(Role.team("5c1f88b87435e", "owner"))    // owner 可删除
  ]
)
```

---

### 示例 3：私有文档（只有创建者可访问）

这是一个非常常见的需求：每个用户只能访问自己创建的文档。

#### 第一步：配置 Table 权限

```bash
# CLI 创建 collection 时配置
appwrite-cf databases create-collection \
  --database-id "user_data_db" \
  --collection-id "private_notes" \
  --name "Private Notes" \
  --permissions "create(\"users\")" \    # ✅ 只授予 create 权限
  --document-security true               # ✅ 启用文档级权限
```

**关键配置**：
- ✅ **启用 documentSecurity**：允许文档有独立的权限
- ✅ **只授予 create 权限**：用户可以创建文档
- ❌ **不授予 read/update/delete**：防止用户访问所有文档

#### 第二步：创建文档时设置权限

```typescript
// 前端代码
import { Databases, Permission, Role, ID } from '@codeflicker/appwrite'

const databases = new Databases(client)
const userId = account.get().$id  // 当前用户 ID

await databases.createDocument(
  'user_data_db',
  'private_notes',
  ID.unique(),
  { title: 'My Secret', content: '...' },
  [
    Permission.read(Role.user(userId)),     // 只有创建者可读
    Permission.update(Role.user(userId)),   // 只有创建者可更新
    Permission.delete(Role.user(userId))    // 只有创建者可删除
  ]
)
```

**工作流程**：
1. Table 级别的 `create("users")` 允许用户创建新文档
2. 文档创建时，设置权限为只有创建者可访问
3. 其他用户尝试读取会被拒绝（因为文档权限不包含他们）

---

### 示例 4：分享机制

**需求**：用户创建私有文档后，可以分享给特定用户。

```typescript
// 1. 创建私有文档
const doc = await databases.createDocument(
  'user_data_db',
  'shared_docs',
  ID.unique(),
  { title: 'My Document', content: '...' },
  [
    Permission.read(Role.user(ownerId)),
    Permission.update(Role.user(ownerId)),
    Permission.delete(Role.user(ownerId)),
  ]
)

// 2. 分享给其他用户（通过云函数或 updateDocument）
await databases.updateDocument(
  'user_data_db',
  'shared_docs',
  doc.$id,
  {},  // 不修改数据
  [
    // 保留原有权限
    Permission.read(Role.user(ownerId)),
    Permission.update(Role.user(ownerId)),
    Permission.delete(Role.user(ownerId)),
    // 添加新的分享权限
    Permission.read(Role.user(sharedUserId))  // 👈 分享给特定用户
  ]
)
```

⚠️ **注意**：如果要分享给不在自己团队的用户，需要通过云函数（Server SDK）来实现。

---

### 示例 5：基于标签的 VIP 功能

**需求**：只有 VIP 用户可以访问高级内容。

```typescript
// 1. 给用户添加 VIP 标签（通过云函数或管理后台）
await users.updateLabels(userId, ['vip'])

// 2. 创建只有 VIP 可访问的文档
await databases.createDocument(
  'content_db',
  'premium_content',
  ID.unique(),
  { title: 'VIP Exclusive', content: '...' },
  [
    Permission.read(Role.label("vip")),  // 只有带 vip 标签的用户可读
  ]
)
```

---

## 七、快手内部最佳实践

### 1. Collection 权限配置模板

```bash
# 公开只读数据（如商品列表）
appwrite-cf databases create-collection \
  --database-id "shop_db" \
  --collection-id "products" \
  --name "Products" \
  --permissions "read(\"any\")" \
  --document-security false

# 用户私有数据（如购物车）
appwrite-cf databases create-collection \
  --database-id "shop_db" \
  --collection-id "carts" \
  --name "Shopping Carts" \
  --permissions "create(\"users\")" \
  --document-security true

# 团队协作数据（如项目文档）
appwrite-cf databases create-collection \
  --database-id "workspace_db" \
  --collection-id "projects" \
  --name "Projects" \
  --permissions "create(\"team:company\")" "read(\"team:company\")" \
  --document-security true
```

### 2. 权限检查清单

创建 Collection 前，问自己 3 个问题：

1. **谁可以创建数据？**
   - 所有登录用户？ → `"create(\"users\")"`
   - 特定团队？ → `"create(\"team:TEAM_ID\")"`
   - 无限制？ → `"create(\"any\")"` ⚠️ 慎用

2. **谁可以查看所有数据？**
   - 任何人？ → `"read(\"any\")"`
   - 只有创建者？ → 不设置 table 级别的 read 权限，在 document 级别设置

3. **是否需要文档级权限？**
   - 每个文档有不同的访问权限？ → `--document-security true`
   - 所有文档权限一致？ → `--document-security false`

### 3. 云函数权限管理

```javascript
// ✅ 推荐：根据业务逻辑动态设置权限
export default async ({ req, res, log }) => {
  const userId = req.headers['x-appwrite-user-id']
  const isAdmin = await checkIfAdmin(userId)  // 自定义的管理员检查
  
  const permissions = [
    Permission.read(Role.any()),
    Permission.update(Role.user(userId)),
  ]
  
  // 只有管理员可以删除
  if (isAdmin) {
    permissions.push(Permission.delete(Role.user(userId)))
  }
  
  await databases.createDocument('db', 'col', ID.unique(), data, permissions)
  
  return res.json({ success: true })
}
```

### 4. 权限字符串生成工具

```typescript
// 工具函数：简化权限配置
class PermissionHelper {
  // 生成私有文档权限
  static privateDocument(userId: string) {
    return [
      `read("user:${userId}")`,
      `update("user:${userId}")`,
      `delete("user:${userId}")`
    ]
  }
  
  // 生成公开只读权限
  static publicReadOnly() {
    return [`read("any")`]
  }
  
  // 生成团队协作权限
  static teamCollaboration(teamId: string) {
    return [
      `read("team:${teamId}")`,
      `create("team:${teamId}")`,
      `update("team:${teamId}")`,
      `delete("team:${teamId}/owner")`  // 只有 owner 可删除
    ]
  }
}

// 使用示例
await databases.createDocument(
  'db',
  'col',
  ID.unique(),
  data,
  PermissionHelper.privateDocument(currentUserId)
)
```

---

## 八、常见问题与陷阱

### 问题 1：设置了权限但仍然报 401 未授权

**可能原因**：

1. ❌ **documentSecurity 设置错误**
   ```bash
   # 错误：启用了 documentSecurity，但文档没有设置权限
   --document-security true
   # 创建文档时未传 permissions 参数
   ```
   
   **解决方案**：
   ```typescript
   // 要么关闭 documentSecurity
   --document-security false
   
   // 要么在创建文档时显式设置权限
   await databases.createDocument(..., permissions)
   ```

2. ❌ **权限字符串格式错误**
   ```typescript
   // 错误
   "read(users)"        // ❌ 缺少引号
   "read('users')"      // ❌ 使用了单引号
   "read(\"user:123)"   // ❌ 缺少结束引号
   
   // 正确
   "read(\"users\")"    // ✅
   ```

3. ❌ **用户不在指定的团队中**
   ```typescript
   Permission.read(Role.team("marketing"))
   // 但当前用户不是 marketing 团队成员
   ```

### 问题 2：Table 权限 vs Document 权限的优先级

**规则**：
- 如果 `documentSecurity: false`，只看 table 级别权限
- 如果 `documentSecurity: true`，document 级别权限**覆盖** table 级别权限

```bash
# Collection 配置
--permissions "read(\"any\")"
--document-security true

# 创建文档
permissions: [Permission.read(Role.user("123"))]

# 结果：只有用户 123 可读（document 权限覆盖了 table 的 any）
```

### 问题 3：无法分享给其他团队的成员

**原因**：Client SDK 只能授予自己拥有的权限。

**解决方案**：使用云函数（Server SDK）

```javascript
// 云函数代码
export default async ({ req, res }) => {
  const { documentId, targetUserId } = JSON.parse(req.body)
  
  // 使用 API Key，绕过权限检查
  const client = new Client()
    .setEndpoint(process.env.APPWRITE_FUNCTION_API_ENDPOINT)
    .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID)
    .setKey(process.env.APPWRITE_API_KEY)  // 🔑 特权
  
  const databases = new Databases(client)
  
  // 获取现有文档
  const doc = await databases.getDocument('db', 'col', documentId)
  
  // 添加新的分享权限
  const newPermissions = [
    ...doc.$permissions,
    `read("user:${targetUserId}")`
  ]
  
  await databases.updateDocument('db', 'col', documentId, {}, newPermissions)
  
  return res.json({ success: true })
}
```

### 问题 4：权限设置过于宽松的安全风险

```typescript
// ❌ 危险：允许任何人删除
Permission.delete(Role.any())

// ❌ 危险：允许未登录用户创建
Permission.create(Role.guests())

// ✅ 推荐：最小权限原则
Permission.delete(Role.team("admin"))  // 只有管理员可删除
Permission.create(Role.users())        // 只有登录用户可创建
```

### 问题 5：云函数中忘记设置 API Key scopes

```json
// ❌ 错误：scopes 为空
{
  "functions": [{
    "scopes": []
  }]
}

// 云函数代码
await databases.listDocuments(...)  // ❌ 报错：API Key 没有 documents.read scope

// ✅ 正确：配置必要的 scopes
{
  "functions": [{
    "scopes": ["documents.read", "documents.write"]
  }]
}
```

---

## 快速参考

### 常用权限模式

| 场景 | Collection 配置 | Document 权限 |
|------|----------------|---------------|
| **公开只读** | `read("any")`, `documentSecurity: false` | 无需设置 |
| **用户私有** | `create("users")`, `documentSecurity: true` | `read/update/delete("user:USER_ID")` |
| **团队协作** | `create/read("team:ID")`, `documentSecurity: true` | `update/delete("team:ID/owner")` |
| **VIP 专属** | `documentSecurity: false` | 无需设置 |
| **分享机制** | `create("users")`, `documentSecurity: true` | 动态添加 `read("user:SHARED_ID")` |

### 权限字符串速查

```typescript
// 基础角色
"read(\"any\")"              // 任何人
"create(\"users\")"          // 所有登录用户
"delete(\"guests\")"         // 未登录用户

// 特定用户
"read(\"user:USER_ID\")"     // 特定用户
"update(\"user:USER_ID/verified\")"  // 已验证用户

// 团队权限
"read(\"team:TEAM_ID\")"     // 团队成员
"delete(\"team:TEAM_ID/owner\")"     // 团队 owner

// 标签权限
"read(\"label:vip\")"        // VIP 用户
```

---

## 参考资料

- [Appwrite Permissions 官方文档](https://appwrite.io/docs/advanced/platform/permissions)
- [Appwrite Permission Roles 参考](https://appwrite.io/docs/advanced/platform/permissions#permission-roles)
- [快手内部 Cloud Function 使用指南](./fucntions.md)
- [快手内部 appwrite-cf CLI 文档](../entrypoint.md)
