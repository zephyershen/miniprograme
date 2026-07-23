---
title: "采用资讯社交动作与编辑蓝会员转化界面"
type: decision
tags: [engagement, comments, likes, favorites, sharing, membership, ui]
sources: [../sources/2026-07-18-engagement-ui-implementation.md]
date: 2026-07-18
last_updated: 2026-07-21
status: accepted
confidence: high
---

# 采用资讯社交动作与编辑蓝会员转化界面

## 背景

资讯卡和详情已出现评论、喜爱、收藏、分享四个动作，但此前只有图标，没有数据库、权限或微信分享闭环。普通用户遇到精选、30 天历史、评论等锁定能力时，也缺少与资讯页一致的解释和转化入口。用户同时把资讯页调整成更克制的蓝白编辑卡，希望其他页面跟随这套语言并移除通用渐变、发光和模板化 AI 视觉。

## 最终决定

- 评论是 Pro 能力：免费用户看到置灰入口，不能读取或发布；服务端再次校验 `comments` entitlement，客户端状态不能越权。
- 喜爱和收藏对所有真实微信用户开放。喜爱数直接加入条目的公开 `score`，作为热度排序的一部分；收藏保存标题、来源、发布时间、分类和列表缩略图的紧凑快照。
- 分享使用微信原生 `open-type="share"`，分享路径固定为 `/pages/feed-detail/index?id=...`；从资讯卡或详情分享都进入同一条资讯详情。
- 用户互动按派生 owner key 隔离，不保存原始 OpenID。评论独立存储，公共 DTO 只返回匿名展示名、内容和时间，不返回身份键。
- 锁定能力统一使用全局 `membership-prompt` 底部卡片。2026-07-21 起，三项内测刻度和“不显示价格”已被 [完整 Pro 权益通行证](2026-07-21-bounded-visual-publication-and-pro-access-pass.md) 取代：页面使用七项真实权益、服务端价格、动态折扣和一次性购买边界。
- 视觉基线改为冷白画布、深墨正文、`#1d9bf0` 编辑蓝、喜爱粉与成功绿。渐变和发光不再作为页面身份；“速览”标记继续保留。早期会员通行证刻度在 2026-07-21 的手机端视觉复核后被简约白底权益卡取代，不再保留侧轨与装饰圆环。
- 精选、专栏、简报、收藏、我的、设置、来源异常和个人消化二级页统一使用相同标题层级、实体表面、圆角、发丝线和克制阴影。

## 边界

- 当前购买能力已由微信小程序虚拟支付实现；真实扣款与退款仍需发布前双端真机验收。弹层按钮进入“我的”页完成购买，不在多个入口重复支付流程。
- 分享 payload 与详情路由已在开发者工具验证，实际发给微信好友后的接收端打开仍属于发布前真机人工验收。
- 当前管理员可预览 free/member/admin；真实第二账号的会员到期、撤销和续费矩阵仍未完成。

## 设计依据

- Apple Human Interface Guidelines 的清晰层级、一致性和平台习惯。
- Paul Robert Lloyd 的 The Week 案例中以真实内容、稳定格式和可扫读信息架构建立编辑节奏。
- Clearleft 的 evo 汽车杂志应用案例中对富媒体编辑内容和订阅关系的处理。

## 替代关系

本决策替代 `2026-07-17-luma-ui-redesign.md` 中蓝紫渐变、微光和大面积珍珠材质的具体表达；冷白画布、实体内容面、连续圆角、系统字体和控制层/内容层分离原则继续保留。

## 相关代码

- `hyyc/features/engagement/`
- `hyyc/features/membership/prompt.js`
- `hyyc/components/membership-prompt/`
- `hyyc/cloudfunctions/knowledgeFeed/repositories/feed-engagement.js`
- `hyyc/cloudfunctions/knowledgeFeed/services/feed-engagement-service.js`
- `hyyc/pages/inbox/`
- `hyyc/pages/feed-detail/`
- `hyyc/pages/cards/`
