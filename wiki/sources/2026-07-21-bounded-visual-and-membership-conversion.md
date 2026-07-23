---
title: "四分钟等图、动态简报标题与 Pro 权益通行证实施证据"
type: source
tags: [knowledge-feed, visual-publication, membership, briefing, wechat-devtools, cloudbase]
date: 2026-07-21
last_updated: 2026-07-21
status: verified
confidence: high
---

# 四分钟等图、动态简报标题与 Pro 权益通行证实施证据

## 根因与实现

- 旧行为是资讯条目先公开文字，视觉 worker 约两分钟后回填图片；这解释了用户观察到的“文字先出来、图片后来补进来”。
- 新条目缺图时由条目仓储写入短暂 hold，配置为四分钟；视觉成功、首次明确失败和到期释放分别记录 `visual-ready`、`visual-failed`、`grace-expired`。
- 生产数据库只读执行了普通列表、精选重要度排序、频道/主题组合和 count 四类带“不等于 true”条件的查询，均无索引错误，旧无字段文档正常命中。
- 简报模型在规范化和主题筛选后重新计算核心事项数量，不信任旧缓存中的标题。

## 权益与界面

- 会员模型审计确认七项 Pro 能力；普通用户的喜欢、收藏动作和分享未被写成付费权益，第三方费用边界明确。
- “我的”页与全局 `membership-prompt` 共用权益和计价模型；精选深链补入统一拦截路径。
- 微信开发者工具实际读取当前 590/1090 分方案，页面显示 `¥5.9`、`¥10.9`、`5.4 折` 和 `立省 ¥5`。
- 管理员真实身份先切换到普通用户预览，从资讯页点击“精选”后实际得到 `curatedFeed:false` 并打开权益卡；完成截图后恢复原 Pro 预览状态。
- 弹层首屏显示当前权益、前三项与固定购买按钮；滚动到底可见全部七项权益和第三方费用说明。“我的”页分别验证普通用户购买态与 Pro 已解锁态。
- 简报真实日视图有五条核心事项，页面显示“先看这5件事”。

## 自动验证

- 全量 Node 测试：314/314。
- 会员、支付与计价专项：39/39。
- 图片发布定向测试：41/41。
- 项目检查：35 个 JSON、235 个 JavaScript、11 个页面。
- `git diff --check`：通过，仅有既有行尾转换提示。

## 线上验证

- `knowledgeFeed` 云函数重新部署后状态为完成。
- 生产事件调用 `InvokeResult=0`，约 988ms 返回真实最新资讯、图片字段、筛选矩阵和会员权限；没有新增查询或索引错误。
- 本轮未上传客户端、未创建订单、未触发支付，也未提交微信审核。

## 视觉证据

- `C:\Users\shenz\.codex\visualizations\2026\07\20\019f8062-9170-7c70-ab5d-5b4d1dc3852c\profile-free-pro-pass.png`
- `C:\Users\shenz\.codex\visualizations\2026\07\20\019f8062-9170-7c70-ab5d-5b4d1dc3852c\profile-pro-pass.png`
- `C:\Users\shenz\.codex\visualizations\2026\07\20\019f8062-9170-7c70-ab5d-5b4d1dc3852c\membership-prompt-free-click.png`
- `C:\Users\shenz\.codex\visualizations\2026\07\20\019f8062-9170-7c70-ab5d-5b4d1dc3852c\membership-prompt-benefits-bottom.png`
- `C:\Users\shenz\.codex\visualizations\2026\07\20\019f8062-9170-7c70-ab5d-5b4d1dc3852c\briefing-count.png`

## 安全边界

普通 Wiki 不记录 API 密钥、维护令牌、支付凭据、OpenID 或用户资料。云函数详情可能回显环境变量，后续部署核验优先使用部署状态与受限事件调用，不把详情输出复制到文档或回复。
