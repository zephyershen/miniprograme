---
title: "生产发布候选部署与微信体验版上传"
type: source
tags: [release, production, cloudbase, wechat, verification]
date: 2026-07-23
last_updated: 2026-07-23
status: confirmed
confidence: high
---

# 生产发布候选部署与微信体验版上传

## 可复现发布快照

- 发布提交为 `1bf9fb8cc7bf01ba54108ca089e02b621b400cda`，分支为
  `codex/rebuild-digest-inbox`，标签为 `release-candidate-2026-07-23`；
  分支和标签均已推送。
- 本地 `npm run verify` 完整通过：515/515 个 Node 测试，覆盖率
  Lines 79.20%、Branches 68.86%、Functions 76.44%；项目检查覆盖
  30 个 JSON、277 个 JavaScript、11 个页面和 0.43 MiB 客户端源码。
- 同一提交的 GitHub Actions 10/10 作业通过，覆盖 Node 18.15、20.19、
  24.14、覆盖率/依赖风险门禁、五个生产依赖锁安装及渲染器浏览器冷启动。
  工作流随后升级到基于 Node 24 的 `actions/checkout@v5` 与
  `actions/setup-node@v5`，消除旧 Node 20 action 运行时弃用告警。

## 生产控制面

- 显式创建了唯一缺失的 `knowledge_user_media` 集合。最终回读为 22/22
  合同集合存在并全部 `ADMINONLY`；5 个非合同集合只计数保留，没有删除、
  重命名或读取其文档。
- 11 个缺失索引以纯增量方式创建。最终回读为 34/34 合同索引收敛，
  线上共观察到 56 个索引（含内置索引），没有冲突或删除。
- 云存储已收紧为仅公开四类知识媒体，客户端写入恒为拒绝；用户头像和评论
  图片只能经服务端 staging、审核、发布和绑定链路读取。
- `knowledgeFeed`、`knowledgeOps`、`membershipBilling` 和
  `sourcePreviewWorker` 从同一提交仅更新代码，原有环境变量、运行时、资源
  配置和触发器未被覆盖。白名单回读确认四个正式函数全部可用，九个触发器
  精确匹配。
- 已退休的 `digestIngest` 与 `digestStore` 在正式函数冒烟通过后删除，
  最终函数清单精确为四个正式函数。两份旧实现仍可从 Git 历史恢复，不再占用
  生产入口。

## 生产冒烟

- GitHub 开源库返回 1,728 条全部历史记录、528 个 AIGCLINK 原生标签，
  `coverage=aigclink-all`、`stale=false`，应用筛选为不限时间且不使用
  AIHOT 公司/方向条件；首条来源为“GitHub 开源库”并配置 GitHub 头像。
- 截图函数真实生成并审核通过 1 张 X 页面 JPEG，目标匹配正确；测试对象随后
  按精确路径删除。
- 隔离用户媒体 canary 验证了 PNG 完整解码重编码、记录持久化、服务端读取、
  未绑定文件对另一身份不可见以及文件/记录立即清理。诊断阶段的 3 条 canary
  记录和最终 canary 均已删除，临时函数也已删除。
- 会员方案端点可用但 `available=false`，正式购买门禁继续关闭；因此资讯版
  首发不会误开真实扣款。正式销售仍需双端真机支付、退款与权益重锁矩阵。
- 项目没有用户上传次数或累计容量配额。6MB 仅是单次云函数请求体硬边界；
  头像 1 MiB、评论图片 3 MiB 是单文件安全限制，转 Base64 后仍分别约
  1.4 MiB 和 4.2 MiB。

## 微信发布候选

- 微信开发者工具以仓库根 `project.config.json` 打包，实际小程序包为
  397,154 bytes（387.8 KB）。
- 版本 `1.0.0` 已通过 CLI 上传为微信体验版代码，描述绑定发布提交
  `1bf9fb8`。上传不是提交审核或正式发布；名称/类目/隐私声明、真机验收、
  审核提交和最终发布仍需小程序管理员在微信后台完成。

## 安全边界

- 普通 Wiki 没有记录 CloudBase 登录凭据、环境变量值、用户标识、Cloud File
  ID、短期签名地址或支付密钥。
- 白名单控制形成前曾有生产环境变量值只出现在本地工具输出中，未写入仓库或
  Wiki。公开发布前仍应按最小风险原则轮换相关第三方、微信与维护类凭据。
