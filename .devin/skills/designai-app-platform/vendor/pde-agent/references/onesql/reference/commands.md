# 命令结构

```text
website-builder onesql
├── metadata
│   └── resolve
├── dataset
│   ├── inspect
│   └── query
├── credential
│   ├── create
│   ├── list
│   ├── get
│   ├── update
│   ├── rotate-secret
│   ├── verify
│   ├── transfer
│   ├── accept-transfer
│   └── delete
├── query
│   ├── upsert
│   ├── validate-batch
│   ├── list
│   ├── get
│   ├── enable
│   ├── disable
│   ├── delete
│   ├── execute
│   └── submit
├── raw-query
│   ├── execute
│   └── submit
└── job
    ├── list
    ├── get          # 别名：status
    ├── results
    ├── cancel
    └── wait
```

自动化场景优先追加 `--json`，不要解析面向人的输出或错误文案。执行前用对应层级的 `--help` 核对当前安装版本。

表元数据查询无需 Credential 或 Project ID，但 CLI 仍复用 `appwrite-cf` 登录态。`--table` 使用
`database.table`，BLEEM Catalog 默认 `internal`：

```bash
website-builder onesql metadata resolve \
  --engine BLEEM \
  --table analytics.events \
  --json
```

KwaiBI 数据集：

```bash
website-builder onesql dataset inspect \
  --credential-id <credentialId> \
  --dataset <datasetIdOrUrl> \
  --json

website-builder onesql dataset query \
  --credential-id <credentialId> \
  --dataset <datasetIdOrUrl> \
  --input @query.json \
  --json
```
