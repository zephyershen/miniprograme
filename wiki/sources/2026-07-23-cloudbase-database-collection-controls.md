# CloudBase 数据库集合创建控制与生产回读

日期：2026-07-23

## 范围

- 以现有 `docs/cloud-database-rules.json` 的 22 个 `ADMINONLY` 集合作为唯一创建合同，不另造集合清单。
- 新增集合 `plan`、`check`、`readback` 和 `apply` 发布控制。
- 本轮只运行线上 `ListTables` 回读，没有执行 `CreateTable`、修改权限、读取文档或删除资源。
- 未修改业务服务和数据库索引合同。

## 官方能力依据

腾讯云 CloudBase API `2018-06-08` 的
[CreateTable](https://cloud.tencent.com/document/product/876/127968)
支持顶层 `EnvId`、`TableName` 与 `PermissionInfo`。官方 `PermissionInfo`
结构要求 `AclTag` 和 `EnvId`，并明确列出 `ADMINONLY`。因此集合创建请求同时
携带目标环境与 `ADMINONLY`，减少创建后到数据库规则收敛前的权限窗口；数据库
规则脚本仍负责最终权限合同与回读。

## 控制边界

- 默认模式是只读 `plan`；`check` 在缺集合时退出 1；`readback` 输出 22 个合同集合的存在状态。
- apply 必须在首次远程读取前通过与目标完全一致的 `--confirm-env`。
- 写前先完整分页调用 `ListTables`，计算全部缺失合同集合，再只为这些集合发出 `CreateTable`。
- 创建路径没有 `DeleteTable`、文档查询、集合改名或未知集合修改能力。
- 未知集合只报告数量，不输出名称；合同回读只保留集合名和存在布尔值。
- TCB 原始失败响应被抑制，避免新增供应商字段绕过输出白名单。
- 并发发布若在预检后创建同一集合，只会在新的 `ListTables` 确认存在后按幂等成功处理；其他失败返回通用错误。
- 多集合创建是单调、可重试的；中途失败不会回滚或删除已存在集合。

## 生产只读结果

- 合同集合：22
- 已存在合同集合：21
- 缺失合同集合：`knowledge_user_media`
- 非合同集合：5 个，全部保留且未输出名称

上线时应先运行集合 apply 创建 `knowledge_user_media`，随后立即运行数据库规则
apply/check 确认 22 个集合均为 `ADMINONLY`，再应用必要索引和存储规则。完成
上述控制面收敛后才运行隔离的服务端媒体 canary，不依赖真实用户流量或业务
副作用创建集合。

## 验证

- 集合控制专项：9/9 通过。
- 全量 Node：515/515 通过。
- 项目检查：30 个 JSON、277 个 JavaScript、11 个页面和 0.43 MiB 客户端包通过。
- 真实 `plan` 与白名单化 `readback` 均返回 22/21 和同一缺失集合。
- 真实 `check` 正确退出 1，阻止当前漂移状态继续发布。
- 无确认 `apply` 在首次远程读取前拒绝；没有执行带确认的线上 apply。
- 差异空白检查通过。

## 敏感信息处理

普通 Wiki、测试和报告未记录数据库文档、未知集合名、用户数据、Cloud File
ID、短期签名地址、函数环境变量值、登录凭据或原始 TCB 响应。
