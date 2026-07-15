---
title: "知识获取平台小程序项目总览"
type: overview
tags: [overview, miniprogram, wechat, knowledge-platform, editorial-index]
sources: [sources/2026-07-13-digest-inbox-implementation.md, sources/2026-07-14-cloud-cleanup-and-deployment.md, sources/2026-07-15-wechat-e2e-and-runtime-fixes.md, sources/2026-07-15-editorial-ui-implementation.md, sources/2026-07-15-aihot-feed-integration.md]
last_updated: 2026-07-15
status: confirmed
confidence: high
---

# 知识获取平台小程序项目总览

## 一句话说明

这是一个从个人文章消化箱迁移为编辑型知识获取平台的微信小程序：当前首页以非卡片式结构展示 AI/科技图文资讯，只呈现频道、真实图片、标题、摘要、原发布方和时间；个人导入/待处理流程已从首页撤下，娱乐、社会、游戏和英语仍待各自内容源。

## 事实健康表

| 事实 | 状态 | 证据 |
| --- | --- | --- |
| AppID、云环境 ID、Git 历史和远程地址已保留 | confirmed | 项目配置、应用入口、Git 命令 |
| 旧社区、商品、任务、聊天、实名、定位、钱包、支付和图片审核代码已从活跃树移除 | confirmed | 当前文件树与重建历史 |
| 5 个页面、3 个云函数及本地测试已实现 | confirmed | 当前代码、41 个 Node 测试 |
| 旧云资源清空及 5 个新集合创建 | confirmed | 2026-07-14 CloudBase 清单与复核 |
| `digestIngest`、`digestStore` 已部署 | confirmed | 两函数部署结果与云端日志 |
| 真实 OpenID、数据库闭环和开发者工具编译 | confirmed | 2026-07-15 微信开发者工具端到端验证 |
| 编辑索引式首页与频道视觉系统 | confirmed | 2026-07-15 Moodboard 选择、当前代码和模拟器编译 |
| AI/科技精选聚合、缓存和原始来源追踪 | confirmed | 后台 20 条云端实测、首页 7 张原文封面、模拟器渲染 |
| 多来源去重、独立官方源与其他四个频道 | needs-review | 尚未实现，不得宣称为全频道实时新闻服务 |
| 真正 AI 摘要 | needs-review | 当前套餐模型调用返回 429；应用已透明使用本地临时摘要 |
| 体验版上传与 30 天验证 | needs-review | 尚未上传体验版 |

## 仓库与身份

- 当前工作仓库：`D:\miniprogram`
- 当前分支：`codex/rebuild-digest-inbox`
- 当前检出提交：`fc286a87ed672772fccb018c9012378ec04da354`
- 重建历史基线：`704a88ec1713054f78843a89570ca637ed19b06e`
- 旧版本标签：`legacy-hyyc-704a88e`
- 远程：`https://github.com/zephyershen/miniprograme.git`
- AppID：`wxcb0f641838abf6e6`
- 云环境 ID：`hyyc-1gi3f5sqc5becabf`
- 唯一项目配置：仓库根部 `project.config.json`，小程序根为 `hyyc/`

`D:\miniprogramcode\miniprogram` 是早期审计的历史路径；后续命令以当前工作仓库为准。

## 已保留但不在首页开放的迁移闭环

1. 用户首次选择 1–3 个关注方向。
2. 用户主动读取剪贴板或手动输入公开 HTTPS 文章链接。
3. `digestIngest` 校验 URL、阻止 SSRF、限制抓取大小并抽取正文。
4. 云 AI 可用时生成相关性、中文摘要和关键句；不可用时生成明确标注的本地临时摘要。
5. 用户必须丢弃或保留结论；卡片满 20 张时必须显式选择替换对象。

上述代码和云函数仍保留，但首页已撤下待处理数量、导入入口、关注方向设置提示和个人队列。当前公开体验不提供任意网页全文、自动剪贴板监听、支付、广告、会员、登录页、定位、推送或全文翻译；已接入的聚合精选仍不等同于各厂商官方源分别直连。

## 代码与数据

- 页面：`pages/inbox/index`（纯资讯首页）、`pages/feed-detail/index`（公共资讯详情）；`pages/digest/index`、`pages/cards/index`、`pages/settings/index` 仍在代码中，但首页不再提供个人导入/待处理入口。
- 首页频道：精选、AI 前沿、科技、娱乐、社会、游戏、英语；当前聚合源覆盖前两类，其他频道保留真实空状态。
- 视觉基线：`styles/editorial-tokens.wxss`，以米白纸张、黑色排版、细线和单一频道色建立层级。
- 云函数：`hyyc/cloudfunctions/digestIngest`、`hyyc/cloudfunctions/digestStore`、`hyyc/cloudfunctions/knowledgeFeed`
- 集合：`digest_queue`、`conclusion_cards`、`user_state`、`daily_stats`、`usage_monthly`、`knowledge_feed_cache`
- 公共资讯缓存 15 分钟并使用 ETag；原文封面经安全校验后写入 `knowledge-covers/aihot/`，当前 7 个对象。首页只显示这 7 条有真实图片的资讯，不生成几何替代图。
- 用户界面不显示 AI HOT、API、缓存、规范链接等接入实现，只显示资讯的原始发布方和原文链接。
- 身份只取自云函数上下文；数据库使用 OpenID 的 SHA-256 派生值，不保存原始 OpenID。
- 原始正文只在函数内存中参与处理，不写数据库或云存储。
- 降级结果携带 `processingMode: local_fallback`，前端明确提示其不是 AI 翻译或相关性判断。
- 不保存昵称、手机号、位置、实名资料、支付信息或全文。

## 安全与成本

- 只接受默认 443 端口的 HTTPS；拒绝凭据、内网、保留 IP 和微信公众平台文章。
- DNS 解析后绑定已校验的公网 IP 建立 HTTPS 连接，并在每次重定向后重新校验。
- 最多 3 次重定向、响应最大 2MB、正文最多 12,000 字符。
- 当前 AI 提供方为 `hunyuan-v3`，模型为 `hy3-preview`；可通过环境变量切换。
- AI 调用前事务预留预算，成功后结算实际 Token 成本；每月 10 元硬上限。
- AI 额度错误会释放预算预留并进入本地临时摘要，不产生伪造的 AI 用量记录。
- 腾讯云自动化凭据仅保存在被 Git 忽略且受本机 ACL 限制的 `wiki/secrets/`，普通 Wiki 不含实际值。

## 本地验证

- `npm test`：41/41 通过。
- `npm run check`：19 个 JSON、43 个 JavaScript、5 个页面通过结构与语法检查。
- `git diff --check`：通过。
- 微信开发者工具已编译并成功渲染收敛后的纯资讯首页：精选 7、AI 前沿 3、科技 4。

## 云端与端到端状态

- 旧业务的 41 个函数、24 个集合、2,456 条文档、217 个存储对象和 `adminportal/` 已清理。
- 环境级空存储桶、平台认证文件、AppID 关联和标准版套餐被保留。
- 6 个当前集合均为 `ADMINONLY`；其中 5 个个人业务集合无测试记录，`knowledge_feed_cache` 保存公共资讯缓存。
- 三个 Node.js 18.15 云函数已部署；`knowledgeFeed` 已通过真实聚合数据、缓存和详情读取验证，其公开返回已移除聚合平台页面、归因和平台标识字段。
- 真实微信上下文已验证：保存偏好 → 导入文章 → 生成临时摘要 → 保留结论卡 → 统计更新 → 清除个人数据。
- 环境“超限按量”关闭；未自动开启新的 AI 付费方案。

详细证据见 [微信端到端验证与运行时修复](sources/2026-07-15-wechat-e2e-and-runtime-fixes.md)。

## 尚未完成的外部操作

1. 为娱乐、社会、游戏和英语分别选择内容源，并实现跨来源去重、优先级和审核机制。
2. 在 AI HOT 之外分别接入重点厂商官方源，避免把聚合源误标为官方直连。
3. 用户决定是否开通资源点/成长套餐或配置自有模型，以启用真正 AI 摘要、翻译和相关性判断。
4. 在微信开发者工具中预览并上传体验版，不直接提交公开审核。
5. 根据新的知识平台目标重写 30 天验证指标。

## 已被替代的旧结论

- “正式 Git 根是 `D:\miniprogramcode`、当前分支为 `my-work`”已被当前工作仓库和重建分支替代。
- “产品方向未确定”已被 [“别收藏了”首版决策](decisions/2026-07-13-digest-inbox-v1.md) 替代。
- “产品不提供资讯流”已被 [编辑索引式知识平台首页决策](decisions/2026-07-15-editorial-knowledge-platform-ui.md) 替代；旧摘要闭环继续作为迁移基础。
- “真实微信身份和数据库闭环未验证”已在 2026-07-15 被端到端结果替代。
- “AI 失败不入队”已被 [透明临时摘要决策](decisions/2026-07-15-ai-quota-fallback.md) 替代。
