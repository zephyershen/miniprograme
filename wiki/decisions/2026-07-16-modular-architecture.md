---
title: "知识平台按能力与依赖边界组织代码"
type: decision
tags: [architecture, modularity, knowledge-feed, cloudbase]
date: 2026-07-16
last_updated: 2026-07-16
status: accepted
confidence: high
---

# 知识平台按能力与依赖边界组织代码

## 背景

资讯首页和 `knowledgeFeed` 云函数在连续增加筛选、分页、排序、详情与封面维护后，页面入口和云函数入口同时承担展示转换、状态、外部请求、数据库、缓存与公开字段映射。继续追加来源或频道会让一次改动横跨多个无明确所有权的 `utils` 和入口文件。

## 选项

1. 继续在现有页面、`utils` 和云函数 `index.js` 中追加逻辑：短期文件少，但变更点分散且外部源会渗透到产品规则。
2. 引入大型框架、类层级和完整依赖注入容器：边界形式完整，但不符合微信原生小程序和当前团队规模。
3. 使用普通 CommonJS 模块，按产品能力组织小程序代码，并在云函数内部建立 adapter、repository、service、presenter 四个真实边界。

## 最终决定

采用选项 3，并保持微信框架规定的 `pages/` 和云函数入口：

- `pages/` 只编排生命周期、事件、加载状态和导航。
- `features/knowledge-feed/` 拥有资讯频道、筛选、排序、列表/详情模型和客户端 API；`features/digest/` 拥有保留的个人消化能力。
- 小程序端公共 CloudBase 传输只放在 `services/cloud-functions.js`。
- `knowledgeFeed/adapters/` 只认识外部内容源；`repositories/` 只认识缓存集合；`services/` 组织用例与降级；`presenters/` 定义公开 DTO；入口只做依赖装配和 action 路由。
- 新来源先适配成统一资讯条目，再进入缓存和查询服务；页面、筛选、分页和公开 DTO 不感知供应商请求协议。
- 微信小程序运行时代码的相对 `require` 必须显式包含 `.js` 扩展名；页面直接引用具体 feature 模块，不使用 `...require(...)` 形式的聚合导出。Node 页面入口测试继续保留，但不能替代微信开发者工具编译验证。

## 为什么这样定

- 下一步最可能发生的是增加厂商官方源和娱乐、社会、游戏、英语来源，adapter 是真实变化边界。
- CommonJS 工厂函数兼容现有 Node.js 18 云函数和微信原生运行时，不需要引入构建框架。
- 服务可注入仓储、来源和时钟，能直接测试缓存命中、stale 降级和错误契约。
- 保留当次重构时的 action 与页面路由，重构本身不改变用户行为或公开接口。superseded 2026-07-16：后续视觉发布门禁决策主动将公开 `knowledgeFeed` action 收敛为 `feed`、`item`，维护改走平台定时内部链路。

## 影响

- 新页面能力不再直接进入 `utils`；只有两个以上能力真正复用的传输逻辑才放到公共 `services/`。
- `knowledgeFeed/index.js` 从 381 行降为约 40 行，首页脚本从 276 行降为约 160 行。
- 未注册且依赖已删除旧用户模块的社区实名引导页被移除；它不属于当前 6 个正式页面，也没有可达入口。
- `digestIngest` 和 `digestStore` 是已退出首页的保留闭环，本轮不做高风险大拆；未来只有在重新启用或新增需求时按相同方式逐片迁移。
- `npm run check` 增加微信运行时模块引用规则，防止无扩展名相对引用或 `...require(...)` 聚合再次进入客户端代码。

## 状态

accepted

## 日期和来源

- 日期：2026-07-16
- 来源：用户指定的 modular-code-architect 规范、当前代码审查、本地测试和 CloudBase 回归验证

## 相关代码 / 页面

- `hyyc/features/knowledge-feed/`
- `hyyc/features/digest/`
- `hyyc/services/cloud-functions.js`
- `hyyc/cloudfunctions/knowledgeFeed/adapters/`
- `hyyc/cloudfunctions/knowledgeFeed/repositories/`
- `hyyc/cloudfunctions/knowledgeFeed/services/`
- `hyyc/cloudfunctions/knowledgeFeed/presenters/`
