---
title: "2026-07-23 全项目生产就绪审计"
type: report
tags: [production-readiness, audit, security, reliability, release]
last_updated: 2026-07-23
status: confirmed
confidence: high
---

# 2026-07-23 全项目生产就绪审计

## 结论

当前版本**不建议直接生产发布**。

本轮没有发现正在发生的数据泄露、资金损失或全站中断，因此 P0 为 0；但已确认四类必须阻断发布的代码/安全问题，并有依赖、支付和发布快照等发布门禁尚未闭环。450 个自动化测试、项目静态检查和微信开发者工具预览均通过，但这些检查没有覆盖跨用户媒体所有权、会员降级后的客户端缓存、浏览器 DNS 二次解析、异步请求交错、真实支付和云端冷启动。

本轮只实现了用户明确要求的频道切换加载反馈；其余发现均保持只读，没有擅自修改生产业务、部署云函数或上传体验版。

## 审计范围

- 小程序端：11 个注册页面、feature/session/model、互动、资料、会员、支付与媒体恢复。
- 云函数：`digestIngest`、`digestStore`、`knowledgeFeed`、`knowledgeOps`、`membershipBilling`。
- 截图执行层：`sourcePreviewWorker` 与 `cloudrun/source-preview-renderer`。
- 发布与运维：Git 快照、CloudBase 部署清单、存储规则、运行时、依赖锁、测试、覆盖率、微信预览编译。
- 不读取 `wiki/secrets/`，不输出环境变量值、令牌、用户数据或短期签名地址。

## P1：发布前必须修复

### P1-01 用户媒体缺少对象级所有权，存在跨用户删除与审核前公开窗口

已确认两条相互增强的风险：

1. 客户端上传路径由 `hyyc/services/cloud-media.js:7-10` 生成，只包含公共前缀、时间和随机值，没有用户标识。
2. 生产 CloudBase 存储规则只按 `user-media/` 前缀公开读，写规则仅判断上传对象的 `openid` 与当前身份相等，没有约束 `resource.path` 必须属于当前用户。
3. `comment-moderation-service.js:50-56` 在审核拒绝时删除客户端提交的 File ID；`user-profile-service.js:27-31,49-71` 也只校验公共头像前缀，审核失败或换头像时会删除该 File ID。

因此，攻击者可提交同一公开前缀下其他用户的头像或评论图片 File ID，并通过审核拒绝路径触发服务端删除。即使没有触发删除，评论图和头像在审核完成前已经进入公开可读命名空间。

当前生产规则已通过 `tcb storage rules get --json` 只读核对：

```text
read:  ... || /^user-media\//.test(resource.path)
write: resource.openid==auth.openid || resource.openid==auth.uid
```

修复要求：采用私有 staging，审核通过后由服务端发布；上传记录和最终路径同时绑定 `ownerKey/openid`；所有删除操作必须查询服务端所有权后再执行；补跨用户删除、任意路径写入、审核前读取、大小/类型/配额测试。

### P1-02 资讯详情缓存可在会员降级后短时绕过重鉴权

- `features/knowledge-feed/item-session.js:4-7` 的两分钟缓存只按资讯 ID 分区。
- `features/membership/session.js:39` 的角色变化没有清理该缓存。
- `pages/feed-detail/index.js:64-82` 先展示全局列表缓存；权威请求返回 `ENTITLEMENT_REQUIRED` 或 `ITEM_NOT_FOUND` 时，只要已有缓存，就忽略拒绝并继续保留内容。

复现路径：Pro 打开超过普通 24 小时范围的详情，随后退款、到期或切换普通预览，两分钟内再次进入同一 ID。只读 mock 已复现第二次不调用后端，或后端拒绝后页面仍保留旧内容。

修复要求：缓存键纳入访问 scope/权益 revision，角色变化统一清理；权威的权限拒绝和不存在结果必须覆盖本地缓存，仅暂时性网络错误可保留已展示内容。

### P1-03 截图浏览器存在 DNS rebinding SSRF 缺口

- `cloudrun/source-preview-renderer/src/network-security.js:54-84` 在请求前解析域名并确认当时返回公网 IP。
- `cloudrun/source-preview-renderer/src/capture.js:250-253` 校验后直接 `route.continue()`，Chromium 建连时会再次解析域名，未绑定先前验证过的 IP。
- `cloudrun/source-preview-renderer/index.js:23` 的 CloudBase worker 允许直接出口。

恶意或被接管域名可首次返回公网 IP，通过校验后再向 Chromium 返回私网、链路本地或元数据地址。当前测试覆盖直接私网 DNS 和 TTL 重验，但没有覆盖浏览器二次解析。

修复要求：浏览器全部流量经过能够固定目标 IP、校验证书主机名并在重定向后重新验证的受控代理；不能依赖“先查一次 DNS、再让浏览器自行连接”。

### P1-04 当前生产快照不可复现、不可可靠回滚

- 审计时工作树有 147 个已跟踪改动和 196 个未跟踪文件；当前 `HEAD` 仍停在 2026-07-18。
- 唯一标签是旧版 `legacy-hyyc-704a88e`。
- `cloudbaserc.json:116-133` 已注册并部署 `membershipBilling`，但整个函数目录尚未跟踪。
- `membershipBilling` 没有 `package-lock.json`，`npm ci --ignore-scripts --dry-run` 失败。

影响：部署时可能漏文件，线上内容无法由某个 SHA 精确重建，紧急回滚可能丢失支付或最新资讯能力。

修复要求：先确认全部预期运行时文件，生成并审核支付函数锁文件，清理临时文件，形成干净 commit/tag；后续部署只接受并记录该 SHA。

### P1-05 已知高危依赖尚未完成升级或可达性豁免

`npm audit --omit=dev` 的当前结果：

| 包 | Critical | High | Moderate |
| --- | ---: | ---: | ---: |
| `knowledgeOps` | 2 | 6 | 4 |
| `digestIngest` | 0 | 5 | 1 |
| `digestStore` | 0 | 5 | 1 |
| `knowledgeFeed` | 0 | 5 | 1 |
| `source-preview-renderer` | 0 | 5 | 1 |
| `membershipBilling` | 无锁文件，无法确定性审计 |  |  |

`knowledgeOps` 仍带 `wx-server-sdk 3.0.4`、`request 2.88.2`、`form-data 2.3.3`；新 SDK 链也带入被标记的 `axios 0.27.2` 与 `lodash.set/unset`。`npm audit fix` 给出的降级/大版本建议不能直接套用。

修复要求：先升级 `knowledgeOps` 并回归，再按 CloudBase 官方兼容矩阵处理其余传递依赖；任何暂缓项必须记录漏洞可达性、补偿措施、负责人和到期日。

### P1-06 真实支付/退款仍是发布外部门禁

`docs/wechat-virtual-payment-membership.md` 明确记录真实支付和退款真机矩阵尚未闭环；当前 `membershipBilling` 已部署且方案处于可售配置。自动化测试覆盖签名、查单/发货和重复通知，不等于真实 Android/iOS 扣款、取消、异常恢复、回调丢失、重复发货、退款和权益重新锁定。

在获得完整真机证据前，不应开放正式收费入口。

## P2：应在首发或紧邻版本修复

| 编号 | 问题 | 影响与证据 |
| --- | --- | --- |
| P2-01 | 日期懒加载旧响应污染新频道 | `pages/inbox/index.js:397-445` 没有校验 `feedRequestId`、频道、排序和筛选快照；慢响应可混入新列表，也可能重新带回旧权限范围数据。 |
| P2-02 | 趋势案例兼容路由打开错误内容 | `trend-detail/index.js:100` 传 `type=case`，`column-reader/index.js:34` 却把所有非 `practical` 类型改成 `lesson`。已注册、可分享的兼容路由会请求错误 action。 |
| P2-03 | 下拉刷新失败清空可用内容 | `pages/inbox/index.js:131-192` 在刷新前清空列表，失败时不恢复旧内容；弱网会把可读页面变成错误空页。 |
| P2-04 | 详情水合可覆盖刚完成的互动 | 初始权威详情请求晚于喜欢/收藏/评论请求返回时，`showItem` 会用旧 engagement 快照覆盖已确认状态。 |
| P2-05 | 资料保存有重复提交和双返回窗口 | `profile-edit/index.js:50` 成功后延迟返回，但 `finally` 立即解除 `saving`，用户可在 320ms 内再次保存或先手动返回。 |
| P2-06 | AIGCLINK 租约未保护实际写入 | `aigclink-sync-service.js:49` 获取两分钟租约，但后续状态写和撤回没有携带租约 generation；旧 worker 可在新 worker 接管后覆盖新快照。 |
| P2-07 | AI 预算结算失败遗留预留额度 | `digestIngest/index.js:198` 先预留；模型成功后若结算事务失败，没有可恢复 reservation 或补偿释放。 |
| P2-08 | 同 URL 并发提交重复支付 AI 成本 | 首次去重不在事务内，幂等写发生在抓取和 AI 之后；最终可能只有一条任务，但产生多次模型调用。 |
| P2-09 | 终态视觉任务遗留 staged 文件 | 任务达到最大重试转为 `blocked` 后不再可认领，`stagedFileIds` 没有清理路径，长期产生孤儿存储成本。 |
| P2-10 | 终身统计在 100 天后静默截断 | `digestStore/index.js:45,117` 只读最多 100 条 `daily_stats`，无稳定排序与分页。 |
| P2-11 | 云端 Chromium 与 Playwright 版本不一致 | Sparticuz Chromium 为 138，`playwright-core 1.54.1` 元数据期望 Chromium 139；`browser-runtime.js` 函数覆盖率为 0%，没有真实冷启动测试。 |
| P2-12 | 开发、预览和生产使用同一固定云环境 | `config/constants.js`、`app.js` 与 `cloudbaserc.json` 指向同一环境；本地预览可能写入生产互动、资料、任务或订单。 |
| P2-13 | 已退休函数仍在线部署 | 前端和测试把 digest/settings 定义为 retired，但 `digestIngest`、`digestStore` 仍在部署清单与线上，约 1,309 行旧代码继续扩大调用面和依赖攻击面。 |
| P2-14 | 发布门禁不完整 | 无 CI、无统一 `verify`、无覆盖率阈值；本地 Node 24 与云端 Node 18/20 漂移；57 个环境变量中 41 个没有非敏感合同；ACL、规则、索引没有可复现发布与只读验收。 |
| P2-15 | 未知错误对象可能把敏感上下文写入日志 | 多处直接 `console.error(error)`；上游请求配置、授权头、URL 查询参数可能进入云日志，应改为字段白名单和递归脱敏。 |

## P3：结构与维护债务

- `pages/inbox/index.js` 651 行、WXML 326 行、WXSS 740 行；三份资讯卡片标记高度重复，应在正确性修复后提取共享 `feed-card` 组件。
- `pages/digest`、`pages/settings`、`features/digest/*` 仍留在小程序根；多个旧 feed service、`sync-cycle-service`、`weeklyColumn` 和无消费者的 `memberPurchases` 旗标仅由测试或休眠路径引用。
- `packy-intelligence-provider.js` 直接读取完整 `response.text()`，没有响应字节上限。
- Cloud Run 镜像只复制 `src`，但包同时安装 CloudBase worker SDK、`playwright` 与 `playwright-core`，运行时依赖面可拆分。
- README、总览和发布清单曾长期落后于当前函数数、测试数、权益窗口和截图并发；应由验证脚本生成关键事实。
- `.codex-tmp/` 未被忽略，Docker 基础镜像只锁 tag、未锁 digest。

## 加载交互变更

频道切换现在只在内容区中央显示一个纯圆形转圈，不在顶部频道增加任何状态，也没有可见的“加载中”文字：

- 状态：`features/knowledge-feed/list-model.js:508`
- 切换与清理：`pages/inbox/index.js:135-202,344-363`
- 内容区标记：`pages/inbox/index.wxml:10-12`
- 动画：`pages/inbox/index.wxss:193-210`
- 专项测试：`tests/inbox-channel-loading.test.js`

初次进入仍保留原骨架屏；频道切换使用中央转圈；成功、失败或最新请求结束后统一清理状态。连续快速切换继续由 `feedRequestId` 保证旧首页请求不覆盖新首页请求。

## 验证证据

| 验证 | 结果 |
| --- | --- |
| 频道转圈专项测试 | 2/2 通过 |
| 全量 Node 测试 | 450/450 通过 |
| 项目检查 | 35 JSON、271 JavaScript、11 页面通过 |
| 实验覆盖率 | Lines 77.72%、Branches 70.07%、Functions 73.63% |
| `git diff --check` | 通过 |
| 微信开发者工具 CLI 登录 | 通过 |
| 微信开发者工具真实 preview 编译 | 通过，包约 371.1 KB |
| CloudBase 函数只读清单 | 6 个均为 `Deployment completed`；截图函数 Node 20.19，其余 Node 18.15 |
| CloudBase 存储规则只读核对 | 已确认生产规则公开 `user-media/` 且写入未绑定路径 |
| 依赖审计 | 结果见 P1-05；支付函数因无 lockfile 无法审计 |
| 已跟踪高置信密钥字面量扫描 | 0 |

生产函数错误日志查询返回 CloudBase `ResourceUnavailable`，因此本轮没有把“最近 24 小时无错误”作为结论。

## 评分

| 维度 | 分数 | 说明 |
| --- | ---: | --- |
| 客户端模块化 | 8.4/10 | feature 边界清楚，但首页编排过重，权限缓存和异步 generation 未统一 |
| 后端模块化 | 7.3/10 | service/repository/adapter 基础较好，但所有权、租约、预算补偿和遗留并行实现破坏边界 |
| 测试体系 | 7.0/10 | 数量充足、纯逻辑覆盖好，真实跨层与异步交错不足 |
| 依赖健康 | 4.0/10 | 多个高危/严重告警，支付函数无锁文件 |
| 安全配置 | 4.0/10 | 已确认媒体所有权与 SSRF 边界缺口 |
| 发布可复现性 | 2.0/10 | 当前版本没有可部署、可回滚的 Git 快照 |

代码模块化尚未达到实用 9/10；更重要的是生产发布门禁当前为 **Fail**。

## 修复顺序

1. 冻结并提交可复现快照，补 `membershipBilling/package-lock.json`，建立 staging 和统一 `verify`。
2. 修复用户媒体 staging、路径/所有权和所有服务端删除校验，并更新生产规则。
3. 修复资讯详情权限缓存与权威拒绝覆盖，补角色降级集成测试。
4. 收紧截图出口，消除 DNS rebinding，完成实际 Chromium 冷启动冒烟。
5. 升级/处置依赖告警，完成真实支付/退款矩阵。
6. 修复所有 P2 异步竞态、租约、预算、幂等、清理和分页统计。
7. 正确性稳定后再提取卡片组件、删除退休路径和拆分运行时依赖。

## 尚未验证

- Android/iOS 真机支付、退款、相册原图、键盘、分享接收和会员降级。
- 真实弱网下 CloudBase 请求交错、长时间后台恢复和多角色同时操作。
- 当前线上数据库 ACL、复合索引、备份、告警和触发器的完整一致性。
- `sourcePreviewWorker` 在 Node 20.19 的全新实例冷启动、真实浏览器启动与版本兼容。
- 已知依赖告警在当前业务参数下的实际可利用路径。
- 最近 24 小时生产函数错误率；日志 API 本轮不可用。
