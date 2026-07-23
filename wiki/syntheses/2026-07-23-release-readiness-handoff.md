---
title: "上线前接手清单、CI 边界与剩余风险"
type: synthesis
tags: [release, handoff, ci, wechat, security, production-readiness]
date: 2026-07-23
last_updated: 2026-07-23
status: confirmed
confidence: high
sources:
  - ../sources/2026-07-23-production-release-candidate.md
  - ../reports/production-readiness-audit-2026-07-23.md
---

# 上线前接手清单、CI 边界与剩余风险

> 新会话先读本页，再读 [项目总览](../overview.md) 和
> [生产发布候选](../sources/2026-07-23-production-release-candidate.md)。

## 一句话结论

免费资讯首发的代码与 CloudBase 控制面没有未受控的 P0/P1，但还不能宣称
“旧问题全部彻底清零”或“CI 通过就肯定能上线”。当前明确剩余一项 P2
日志脱敏整改、依赖风险复审期限、真机与微信后台发布步骤；支付必须继续关闭，
直到真实扣款、退款和权益重锁验收完成。

## 当前版本锚点

- 微信体验版 `1.0.0` 基于
  `1bf9fb8cc7bf01ba54108ca089e02b621b400cda`，包体 397,154 bytes。
- 当前分支 `codex/rebuild-digest-inbox` 的业务代码与 CI 复核锚点为
  `e2ef82535dce1799ed24d5069c8b59b5cd8131cc`；写入本交接记录前，本地与远端
  均位于该提交且工作树干净，之后只新增 Wiki 交接记录。
- `1bf9fb8..e2ef825` 没有小程序页面、feature、service 或正式云函数运行代码
  差异；后续仅涉及 CI、审计脚本与测试、风险登记、Wiki，以及同时被小程序
  打包和 `sourcePreviewWorker` 部署忽略的 Dockerfile 安装参数。
- `project.config.json` 在两个提交中的 Git blob 相同；四个正式云函数入口文件
  与线上 `CodeInfo` 逐字节一致，线上 4/4 函数为 Active/Available，九个触发器
  与合同匹配。因此当前不需要重传体验版或重部署云函数。
- 源码同源不等于已上传版本自动更新：本交接记录之后的本地源码已允许新构建的
  `develop`/`trial` 与 `release` 一样发起全部已登记写请求，服务端身份、内容、
  对象所有权和支付配置校验保持不变。现有体验版 `1.0.0` 仍基于旧提交，重新上传
  后才能用体验版验证真实写链路；测试写入会落到同一生产云环境，必须清理或还原。

## GitHub CI 能证明什么

- 最终成功运行：
  `https://github.com/zephyershen/miniprograme/actions/runs/29993042601`，
  对应 `e2ef825`，10/10 作业通过。
- CI 在全新 Linux runner 上覆盖 Node 18.15、20.19、24.14，重新安装五份
  生产锁文件，执行静态合同、526 项测试、覆盖率、依赖风险门禁，以及
  CloudBase/Docker 两种 Chromium 冷启动。
- 工作流权限只有 `contents: read`，不上传微信版本，也不部署 CloudBase。
- CI 全绿证明该 SHA 可复现、已覆盖逻辑没有回归、锁文件可安装、已登记风险
  没有漂移；它不能证明微信审核、Android/iOS 真机、生产网络与并发、上游网站、
  CloudBase 持续可用性或真实支付一定正常。

## 旧审计关闭状态

| 旧审计范围 | 当前结论 |
| --- | --- |
| P1-01 用户媒体所有权与公开读取 | 已修复；客户端直写关闭、服务端 owner 绑定和跨身份不可见 canary 通过 |
| P1-02 会员降级缓存 | 已修复；详情按权益 scope/revision 分区并权威重验 |
| P1-03 DNS rebinding SSRF | 已修复；浏览器 CONNECT 固定到已验证 IP，真实 X canary 通过 |
| P1-04 不可复现发布与支付函数无 lockfile | 已修复；发布 SHA、tag、五份 lockfile 和生产回读齐全 |
| P1-05 critical/high 依赖 | 旧 critical 链已移除；当前为精确登记的 CloudBase 传递依赖受控风险，不是零漏洞 |
| P1-06 真实支付/退款 | 对免费资讯首发以 `available=false` 中和；开启销售前仍是阻断项 |
| P2-01 至 P2-14 | 已修复、退休旧路径或通过环境门禁中和，相关专项测试通过 |
| P2-15 敏感日志 | 大部分已修复，但截图执行层仍有原始 `error.message` 日志，尚未完全闭环 |

## 当前明确剩余项

### 1. 截图服务日志脱敏

以下位置仍记录原始 `error.message`：

- `hyyc/cloudrun/source-preview-renderer/index.js:224-227`
- `hyyc/cloudrun/source-preview-renderer/src/server.js:83`
- `hyyc/cloudrun/source-preview-renderer/src/ws-proxy-bridge.js:92`
- `hyyc/cloudrun/source-preview-renderer/src/fixed-ip-proxy.js:100-103`

Playwright、WebSocket 或代理错误消息可能包含来源 URL/查询参数。当前已经不记录
完整 error、request、header 或 config，风险显著低于旧审计状态，但仍应增加
统一白名单/递归脱敏，补测试，重部署 `sourcePreviewWorker` 并用失败 canary
确认日志不含 URL 查询参数后，才能把 P2-15 标记为完全关闭。

### 2. 依赖风险复审

五份生产锁文件当前显式审计通过，但仍有 6 个 CloudBase 传递依赖风险包和
26 个 npm advisory source 被精确接受到 `2026-08-06`。新增公告、严重度提升、
包根/版本/依赖路径变化或到期都会使 CI 失败。到期前必须升级可升级依赖或重新
审查风险登记；不得把当前结论描述成“零漏洞”。

### 3. 免费资讯首发的人工步骤

- 轮换发布控制形成前可能出现在本地只读工具输出中的相关第三方、微信和维护类
  凭据；普通 Wiki 不保存实际值。
- 在 iOS/Android 真机覆盖普通/Pro 读取、GitHub 标签筛选与频道转圈、无图列表/
  详情、头像选择、相册原图、键盘、分享接收、前后台切换和弱网恢复。
- 在微信后台完成名称、备案、服务类目、隐私声明与 UGC 说明确认，然后提交审核
  和正式发布；扫码、验证码及最终提交必须由管理员完成。

### 4. 付费功能继续关闭

生产 `plans.available=false`。签名、查单、发货、退款通知和幂等回收已有自动
测试，但 Android/iOS 真实扣款、取消、异常恢复、重复查单、退款和退款/到期后
权益重锁尚未完成。免费资讯版可在保持销售关闭时发布；任何开售动作前必须完成
完整真机支付矩阵。

### 5. 6MB 不是用户配额

项目没有用户上传次数或累计容量配额。6MB 是单次云函数请求体技术边界；头像
1 MiB、评论图片 3 MiB 是为了让 Base64 后仍低于该边界的单文件安全限制。移除
这个边界不会取消腾讯平台限制，只会让超大请求在运行时不可预测地失败。

## 新会话建议顺序

1. 先读本页、`wiki/overview.md`、生产发布候选和旧审计的 superseded 说明。
2. 优先修复截图执行层日志脱敏并补专项测试。
3. 运行 `npm run verify`、`npm run audit:production` 和 `git diff --check`。
4. 只重部署 `sourcePreviewWorker`，执行成功与失败 canary，确认功能与日志安全，
   再更新本页、总览和发布记录。
5. 保持支付关闭，完成凭据轮换、真机矩阵与微信后台发布步骤。

## 本轮复核证据

- 旧问题映射专项测试：176/176 通过。
- 当前依赖审计：
  `Audited 5 production packages; 6 vulnerable packages and 26 advisory sources remain explicitly reviewed until 2026-08-06.`
- 最终本地门禁：526/526；覆盖率 Lines 79.34%、Branches 68.84%、
  Functions 76.55%。
- 本轮仅复核并维护 Wiki；交接记录会作为 Wiki-only 本地提交保存，没有修改
  业务代码、重新上传体验版或变更生产资源。
