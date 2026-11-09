# 执行状态

2026-10-23：四 App Functions 改造与本地验收完成；真实 MA 业务/互联与 staging 尚未验收。

| 执行单元 | 结果 | Root 独立重跑证据 |
| --- | --- | --- |
| Canvas / Devin SWE2 | 真实画布服务复用、私有存储预检、执行级锁与恢复、安全传输、可上传部署闭包 | 函数25项、服务端671项通过；1项真实云服务用例因未配置跳过 |
| Doc / Devin SWE2 | 完整业务函数、持久回执/outbox、私有存储、跨执行open-editor恢复与实时复核 | 函数26项、服务端213项通过 |
| Sketch / Devin SWE2 | 完整业务函数、私有存储、并发互斥、版本/回执/Provider与二进制 | 服务端93项通过 |
| Image / Devin SWE2 | 独立桶、完整workspace/assets/jobs、逐调用者授权端口、有界inline、返回值合同修复 | 全量327项通过，含函数18项 |
| Root / 宿主 | 移除容器内App常驻进程；改用固定目的地Functions代理，保留状态与资源头 | MA后端394项、代理31项、构建/类型/guard/制品检查通过 |

四 App 测试合计1355项通过，1项跳过；不是1355项真实云端业务验收。回写后的真实开发目录另行重跑函数测试、类型与构建通过。Canvas锁文件保留其他并发改动，只合函数importer和缺失依赖快照；冻结安装通过。

真实平台探针：Node22.22.0/Linux x64/sqlite可用，执行头注入运行密钥，私有桶元数据200。四个owner-only隔离候选Function均构建ready并实际执行；配置缺失时安全503（Doc/Sketch健康200）。Image初次因未返回平台响应对象500，修复后部署6adb1f34c245c4cf05df复验503符合预期；并非业务成功。

宿主本地提交d02cebb61，生图本地提交632bfcd。Canvas/Doc/Sketch修复已安全回写对应开发目录。未更新main、一寒分支或release_staging，未发布staging。没有更改已有线上函数、数据、桶ACL或execute权限。

完整交付及外部缺口：../../verification/four-app-appwrite-functions-20261023/README.md；不可将候选启动/本地替身当作正式MA、模型、跨App读写或线上部署验收。
