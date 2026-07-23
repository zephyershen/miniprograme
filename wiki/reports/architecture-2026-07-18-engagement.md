---
title: "资讯互动与编辑蓝 UI 模块化复审"
type: report
tags: [architecture, modularity, engagement, membership, ui]
sources: [../sources/2026-07-18-engagement-ui-implementation.md, ../decisions/2026-07-16-modular-architecture.md]
last_updated: 2026-07-18
status: confirmed
confidence: high
---

# 资讯互动与编辑蓝 UI 模块化复审

## 结论

本轮受影响范围评为 **9.2/10**，新增互动能力本身约 **9.4/10**，当前项目整体约 **9.0/10**。它符合既定“页面编排、feature 负责客户端能力、repository 负责持久化、service 负责用例与权限、component 负责复用视觉”的标准。

## 模块路径

```text
pages/inbox + pages/feed-detail + pages/cards
  -> features/engagement/api + model + session
  -> services/cloud-functions
  -> knowledgeFeed action router
  -> services/feed-engagement-service
  -> repositories/feed-engagement
  -> ADMINONLY engagement/comment collections

locked pages
  -> features/membership/prompt
  -> components/membership-prompt
```

## 采用项

- 页面没有直接访问数据库，也没有自己推断服务端会员权限。
- 喜爱、收藏和评论的事务一致性归仓储所有；评论门禁、校验、匿名展示和收藏历史例外归服务所有。
- 客户端 API、显示格式和跨页面状态分别独立；收藏页面复用相同 API，没有复制云函数调用代码。
- 会员转化卡是全局组件，精选、评论、历史、专栏和简报只传 feature key。
- 资讯源热度与用户喜爱分开保存为 `baseScore` 和 `likeCount`，同步与互动不会互相覆盖。
- 新集合保持服务端专用，公开 DTO 不返回 owner key 或评论 author key。
- 185 个回归、项目检查、CLI 预览和真实微信上下文往返共同覆盖行为。

## 扣分与暂缓

- `pages/inbox/index.js` 约 415 行、`pages/feed-detail/index.js` 约 301 行；虽然主要内容是生命周期、分页、弹层和事件编排，但已接近再次抽取页面控制器的阈值。当前互动规则已在 feature 中，继续为了行数拆分会增加状态跳转，暂不做无行为收益的抽象。
- 评论当前只提供发布和列表，没有删除、举报、审核队列与分页游标。需求尚未要求这些能力，不提前建立通用社交系统。
- 收藏列表上限为 100 条并由内存排序；当前“简略收藏”规模足够。达到真实规模证据后再改为数据库排序游标。
- 实际微信好友接收、第二真实账号会员生命周期和双机视觉仍需人工验证。

## 评审方式

当前任务规则不允许启动子代理，因此未执行独立多代理复审；本报告由主代理按同一模块化 rubric 完成静态边界检查、测试、模拟器与真实云端往返验证。
