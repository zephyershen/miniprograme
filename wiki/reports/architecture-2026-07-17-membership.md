---
title: "会员与知识智能模块化复审"
type: report
tags: [architecture, modularity, membership, intelligence, performance]
sources: [sources/2026-07-17-pro-membership-implementation.md, decisions/2026-07-17-pro-membership-and-intelligence.md]
last_updated: 2026-07-17
status: confirmed
confidence: high
---

# 会员与知识智能模块化复审

## 结论

当前整体结构评为 **8.8/10**，达到用户可接受的 8 分目标。知识资讯主链路约 **9.2/10**；会员与智能骨架约 **8.7/10**。主要能力已按 feature、policy、repository、service、presenter 和运维入口分开，未来接 AI Provider 或支付适配器不需要重写资讯页面和核心查询。

## 模块图

```text
pages/
  inbox        -> knowledge-feed + membership
  curated      -> curated-feed + membership
  briefing     -> briefing + membership
  profile      -> membership + legacy personal entries

knowledgeFeed cloud function
  adapters/    -> external feed + disabled intelligence provider
  policies/    -> entitlement, curation, trigger, visual publication
  repositories/-> membership, items, day index, jobs, analysis, digests
  services/    -> query, sync, visual worker, analysis worker, digest
  presenters/  -> allowlisted public DTO

knowledgeOps cloud function
  manual membership/admin grants
  analysis seeding and operational status
```

## 得分依据

- 能力边界清楚，页面不直接知道数据库和 Provider 实现。
- 角色权限由服务端统一计算，前端只是展示；直接篡改时间、详情 ID 或简报引用不能越权。
- AI、图片和资讯同步是三条独立队列，失败不会互相阻塞。
- 列表 DTO 不携带长正文和全部原图；游标页不重复统计，移动端只追加新增数据路径。
- 运维 action 从公共函数移出，新增集合为 `ADMINONLY`，敏感身份只保存派生键。
- 168 个回归覆盖现有资讯、截图、权限、到期、错误结构、禁用 Provider、游标和页面入口。

## 剩余扣分

- Provider 仍为 disabled，真实 JSON 结构、429、超时、提示注入和质量抽查只能依赖合同与 fake provider，尚未经过真实供应商验证。
- 25,000 条规模目标已有游标与首屏统计设计，但尚未在真实 CloudBase 数据上形成可复现的 P95 报告。
- 四个新 Tab 尚需一次中端真机视觉、触控和内存性能复核。
- 支付状态机已预留边界，但汇付签约、验签、查询、退款和沙箱回放要在正式接入时单独审计。

## 下一步

1. 获得 AI API 后实现一个独立 Provider adapter，在测试环境先回填最近 30 天。
2. 分析覆盖达到 95% 且人工抽检通过后，依次开放真实精选和简报。
3. 使用 25,000 条脱敏测试数据记录首屏、翻页、响应体和函数 P95。
4. 用另一个微信账号人工授予 Pro，完成免费/会员/管理员三端真机矩阵。

