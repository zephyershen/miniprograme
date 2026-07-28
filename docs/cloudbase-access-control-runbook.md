# CloudBase 访问控制发布手册

数据库集合权限与云存储规则都由仓库内的版本化合同管理：

- `docs/cloud-database-rules.json`
- `docs/cloud-database-indexes.json`
- `docs/cloud-storage-rules.json`

脚本默认只生成计划，不会修改云环境。它们通过 Node 参数数组调用 CloudBase CLI，避免 shell 重新解释 JSON；日志只输出环境、资源和规则差异，不读取或打印登录凭据。

## 发布前检查

在 `hyyc` 目录运行：

```powershell
npm run cloudbase:rules:plan
npm run cloudbase:collections:plan
npm run cloudbase:collections:check
npm run cloudbase:collections:readback
npm run cloudbase:database:check
npm run cloudbase:indexes:plan
npm run cloudbase:indexes:check
npm run cloudbase:indexes:readback
npm run cloudbase:storage:check
npm run cloudbase:functions:plan
npm run cloudbase:functions:check
npm run cloudbase:functions:retire-plan
```

数据库/存储/函数 manifest 的 dry-run 完全离线。集合的 `plan`、`check` 与
`readback` 只读调用 TCB `ListTables`；索引的对应命令只读调用 `ListTables`
和 `DescribeTable`。两者都只输出版本化合同资源的白名单状态；集合控制只
报告未知集合数量而不输出其名称，索引控制只保留集合名、索引名、唯一性和
有序字段。它们不输出文档、索引访问统计、运行环境、凭据或请求原始响应。
规则、集合、索引和函数 `check` 发现漂移时以退出码 1 结束；这表示门禁正确
阻止继续发布，不表示脚本故障。退休函数 plan 会只读线上函数清单，且只允许
列出固定的 `digestIngest` 与 `digestStore`。

若 CloudBase CLI 不在当前 `PATH`，可设置非敏感的 `TCB_CLI_ENTRY` 与 `TCB_CLI_NODE` 文件路径。认证继续使用 CLI 自己的登录状态，不要把 SecretId、SecretKey、Token 或其他凭据写入仓库、命令参数或日志。

## 显式应用与回读

写操作必须同时给出目标环境和完全相同的确认值：

```powershell
node scripts/cloudbase-database-collections.js apply `
  --env hyyc-1gi3f5sqc5becabf `
  --confirm-env hyyc-1gi3f5sqc5becabf

node scripts/cloudbase-database-rules.js apply `
  --env hyyc-1gi3f5sqc5becabf `
  --confirm-env hyyc-1gi3f5sqc5becabf

node scripts/cloudbase-database-indexes.js apply `
  --env hyyc-1gi3f5sqc5becabf `
  --confirm-env hyyc-1gi3f5sqc5becabf

node scripts/cloudbase-storage-rules.js apply `
  --env hyyc-1gi3f5sqc5becabf `
  --confirm-env hyyc-1gi3f5sqc5becabf

node scripts/cloudbase-retired-functions.js apply `
  --env hyyc-1gi3f5sqc5becabf `
  --confirm-env hyyc-1gi3f5sqc5becabf
```

数据库脚本先读取全部集合，只修改不是 `ADMINONLY` 的集合，再分批回读。存储脚本只在当前规则与版本化合同不一致时更新为 `CUSTOM`，随后回读。两者重复执行都是幂等的；控制面尚未收敛时默认最多回读 6 次、每次间隔 5 秒。

集合脚本以现有 `docs/cloud-database-rules.json` 中列出的全部集合为唯一创建
允许列表。apply 在任何写入前完整调用 `ListTables`，只通过 TCB
`CreateTable` 创建缺失合同集合，从不调用 `DeleteTable`、读取文档、删除或
重命名未知集合。创建请求同时设置 `PermissionInfo.AclTag=ADMINONLY` 和目标
环境，缩短新集合的权限窗口；数据库规则脚本仍是权限的最终合同与回读门禁。
若并发发布刚好创建了同一集合，脚本只会在新的 `ListTables` 回读确认存在后
接受该竞态。创建是单调、可重复的；中途失败时重新运行即可继续收敛。

索引脚本采用纯增量策略：只通过 TCB `UpdateTable.CreateIndexes` 创建合同中
缺失且定义安全的索引，从不传 `DropIndexes`，也不会删除、重命名或覆盖任何
未知索引。同字段顺序、方向和唯一性一致但名称不同的现网索引会被视为等价
满足；同名不同定义会在任何写入前阻断。合同集合不存在时同样在写入前阻断，
避免部分应用。索引创建后默认最多白名单化回读 12 次、每次间隔 5 秒。

`knowledge_user_media` 必须和其他合同集合一样由集合 apply 显式创建，不得
依赖首位真实用户流量、手工控制台操作或服务端媒体副作用。集合回读确认存在、
数据库规则确认 `ADMINONLY` 且必要索引收敛后，才运行隔离的服务端媒体
canary。索引脚本本身不会创建集合或读取任何媒体记录。

函数 manifest 脚本本身永远只读：它要求线上清单精确等于 `cloudbaserc.json` 的四个函数，并逐个白名单化回读 runtime、handler、超时、内存、依赖安装、描述、可用状态以及完整定时触发器。它不会输出函数环境变量、源码、函数 ID 或日志信息。

退休脚本只允许删除代码内固定的两个历史函数；若四个正式函数有任何缺失，或线上出现允许列表之外的额外函数，脚本拒绝删除。删除后必须回读到精确四函数 manifest。仓库故意不提供“部署并删除全部”的组合命令，避免部署失败后仍继续做破坏性清理。

可用 `--json` 生成适合保存到发布证据中的结构化结果。不要把 CloudBase CLI 的本地登录文件加入发布制品。

## 安全发布顺序

1. 从一个已提交且已打标签的 Git SHA 运行本地 `npm run verify`。
2. 从该 SHA 单独部署 `cloudbaserc.json` 的四个正式函数；部署命令不由本手册脚本自动触发。
3. 运行 `cloudbase:functions:check -- --json`，确认四个正式函数的配置与触发器已正确回读；此时历史函数尚在会造成唯一允许的清单差异。
4. 完成服务端正向冒烟，再运行退休 plan；确认只列出两个固定历史函数后，显式执行退休 apply。
5. 再运行函数 check，线上清单必须精确为四个函数且配置全部收敛。
6. 运行集合 plan/check 保存变更前差异，再执行带环境确认的集合 apply；
   readback 必须确认版本化合同中的全部集合都存在。
7. 立即运行数据库规则 check/apply/check，确认所有合同集合均为
   `ADMINONLY`。
8. 运行索引和存储的 `check`，保存变更前差异，再逐项执行带环境确认的
   索引与存储规则 `apply`；只有脚本回报
   `applied-and-verified` 或 `already-converged` 才继续。
9. 完成隔离的服务端媒体 canary，确认未绑定媒体不会公开给客户端。
10. 再运行全部 check、集合 readback 与索引 readback `--json`，保存变更后
    白名单化回读。
11. 用正式小程序验证：允许的知识媒体可读，用户媒体只能经服务端签名读取，
    任意客户端直写被拒绝。

不要把旧的不安全规则作为自动回滚目标。确需回滚时，先审阅并检出一个已知安全的合同版本，再运行同一套 `apply + check` 流程。

### 阅读进度与搜索的增量发布

当发布包含 `knowledge_column_progress`、搜索索引和 `feedSearch` 时，必须先完成
新增数据合同，再部署会读取这些合同的函数：

1. 从同一个已提交 SHA 运行完整 `npm run verify`。
2. 执行集合 `plan/apply/readback`，随后执行数据库规则 `check/apply/check`，确认
   `knowledge_column_progress` 存在且为 `ADMINONLY`。
3. 执行索引 `plan/apply/readback`，确认三个进度/搜索索引全部收敛。
4. 从同一个已提交 SHA 部署并回读 `knowledgeFeed` 与 `knowledgeOps`：
   `knowledgeFeed` 承载检索和独立回填触发器，`knowledgeOps.status` 承载可观测的
   `searchBackfill` 状态。新版公共搜索在存量 token 回填完成前会返回
   `SEARCH_UNAVAILABLE`，不得绕过该门禁，也不能只部署其中一个函数。
5. 部署后由独立的 `knowledge-feed-search-token-backfill` 定时器每分钟自动推进一个
   有界批次；它与来源同步使用不同云函数调用预算。维护令牌 action 仅用于人工加速
   或故障恢复。中断后定时器或手动调用都会从持久化游标继续，不要从客户端传入或
   伪造扫描游标。
6. 用维护令牌调用 `knowledgeOps.status`，读取 `searchBackfill`：扫描期间
   `phase=scanning`；主扫描完成且索引可用时 `ready=true` 并有非空 `completedAt`。
   `phase=blocked` 表示有稳定失败的单条文档已在五次失败后隔离，主游标不会被它
   永久卡住；`failures` 只返回文档 ID、次数、安全错误码和时间，不返回正文或原始
   错误。独立定时器会继续重试隔离条目。上传前应优先修复到 `blockedCount=0`；
   若明确接受少量已登记漏项，必须把 ID、错误码和处置人写入发布记录，不能把
   `ready=true` 误写成“零失败”。
7. 搜索入口在回填期间保持可见，查询会明确显示“搜索索引正在准备”；这不代表后端
   已可发布。只有第 6 步门禁满足后，才分别用免费、Pro 和真实管理员做全站关键词
   canary，核对官方动态、资讯、推文、完整 GitHub 库、会员专栏和 Pro 简报，以及
   24 小时、30 天和全部归档的权限范围，再上传小程序版本。

后续升级分词算法时，不能直接复用当前 token 字段并提高版本号。先增加 vNext token
字段和并行索引，部署双写，完成全量回填后再切换查询与 readiness；稳定观察后才删除
旧字段和索引。搜索 token 迁移不得更新内容/视觉 `contentHash`。
