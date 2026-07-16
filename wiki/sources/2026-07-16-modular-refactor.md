---
title: "知识资讯主链路模块化重构与回归证据"
type: source
tags: [architecture, refactor, knowledge-feed, regression]
sources: [../../hyyc/features, ../../hyyc/services, ../../hyyc/cloudfunctions/knowledgeFeed, ../../hyyc/tests]
last_updated: 2026-07-16
status: confirmed
confidence: high
---

# 知识资讯主链路模块化重构与回归证据

## Provenance

- Source path / origin: 当前仓库代码、Node 测试、项目检查、CloudBase 部署与线上函数调用
- Date observed: 2026-07-16
- Scope: 小程序知识资讯页面、公共云函数传输、`knowledgeFeed` 外部源/缓存/查询/封面边界
- Status: confirmed
- Confidence: high

## 结构变化

- 小程序端以 `features/knowledge-feed/` 集中频道、配置、筛选、阅读、列表模型、详情模型和 API；`pages/inbox/index.js` 只保留请求编排、并发请求序号、分页状态和用户事件。
- 保留的个人消化功能移动到 `features/digest/`；所有小程序云函数调用共享 `services/cloud-functions.js` 的错误和响应契约。
- `knowledgeFeed` 云函数新增外部源 adapter、缓存 repository、查询/封面 service 和公开 presenter；`index.js` 只装配依赖并按 action 路由。
- 删除未在 `app.json` 注册、引用不存在 `utils/userIdentity` 且属于旧社区业务的 `pages/guide/`、`utils/accessGate.js` 和 `utils/guide.js`。
- `knowledgeFeed` 显式增加 `ws@8.21.0` 运行依赖；重新部署后的冷启动日志不再出现缺少 WebSocket 依赖提示。
- 首次提交后的微信开发者工具编译暴露 Node 测试未覆盖的模块收包差异：`...require('./api')` 聚合和页面入口无扩展名相对引用会触发 `module ... is not defined`。客户端已改为具体模块直引，并为所有运行时相对 `require` 补齐 `.js` 扩展名。

## 行为保持

- 页面路由、WXML/WXSS、首页频道、筛选、最新/热度排序、8 条分页、详情、原文动作和保留的个人消化接口均未改变。
- `knowledgeFeed` action 继续为 `feed`、`item`、`registerCovers`、`hydrateCover`、`hydrateCovers`；公开成功/失败包仍为 `{ ok, data }` 或 `{ ok, error }`。
- 公开 presenter 继续剔除 `permalink`、attribution、封面检查状态等内部字段；维护 action 继续拒绝带微信 OpenID 的用户上下文。

## 验证结果

- `npm test`：66/66 通过，新增列表模型、页面入口 require、缓存命中、stale 回退、无缓存失败、外部源分页与维护权限测试。
- `npm run check`：19 个 JSON、63 个 JavaScript、6 个正式页面通过，并新增禁止 `...require(...)` 与客户端无扩展名相对引用的兼容性规则。
- `git diff --check`：通过。
- 微信开发者工具重新执行普通编译后，首页实际加载 106 条资讯，资讯详情正常打开；原先重复出现的模块未定义错误清空，控制台仅保留开发者工具自身的基础库与 SharedArrayBuffer 提示。
- `knowledgeFeed` 重新部署成功。线上“最新 + 近 7 天”返回 105 条中的前 3 条并保持时间倒序；“热度 + 24 小时”先筛为 19 条，首 3 条热度为 82、78、78。
- 线上有效详情返回完整公开 DTO 和 3 条相关阅读；非法 ID 返回稳定的 `ITEM_NOT_FOUND / 这条资讯不存在`。

## 评审结论

- 知识资讯主链路达到实用的约 9/10 模块化目标：所有权清楚、依赖方向可解释、真实外部边界已隔离、入口变薄且关键契约有测试。
- 整体仓库仍保留两个较大的旧摘要云函数入口；它们已退出首页且本轮没有需求，继续拆分收益低于回归风险，标记为后续按需迁移而不是当前阻塞项。
- 本次事故修正了“Node 页面入口 smoke test 足以覆盖微信运行时 import”的错误假设；以后模块边界重构必须同时通过 Node 测试、项目检查和真实微信编译。
