---
title: "互动可靠性、资料评论与原图附件实施证据"
type: source
tags: [cloudbase, engagement, comments, profile, media, verification]
last_updated: 2026-07-19
status: confirmed
confidence: high
---

# 互动可靠性、资料评论与原图附件实施证据

## 故障证据

- 2026-07-19 08:39–08:41 的生产 `knowledgeFeed` 日志中，四次公开互动失败均为 `-501001 ResourceUnavailable.TransactionBusy`；旧 repository 在同一事务内用 `Promise.all` 并发读取互动与资讯文档。
- 新客户端此前等待云函数完成后才变色，且列表用一个全局 busy 锁串行所有互动，因此 0.5–1 秒云端往返会直接变成点击延迟。
- 2026-07-19 新资讯无图任务实际进入视觉队列，但多个原文预览请求连续返回 `PREVIEW_HTTP_422`。公开规则会保留真实文字卡，不生成与原文无关的假图。

## 实施

- 喜爱/收藏改为乐观状态、目标状态请求、失败回滚；新增 `features/engagement/latest-target-sync.js` 串行同步最新用户意图，快速反向点击无需等待前一次网络请求。服务端事务顺序读取并对冲突做 3 次有界退避。
- 评论用稳定 mutation id 幂等写入，支持文字为空但包含图片；每条最多 3 张原图。
- 新增独立 `comment-sheet` 组件、共享 `cloud-media`、`features/user-profile`、资料编辑页及云端 profile service/repository。
- 评论公开视图含昵称、头像、首字和附件，不含派生身份键；资料修改后旧评论会显示新资料。
- 后续移动端反馈显示原生键盘只上推 `textarea`、未上推其下方工具栏。组件改为监听键盘高度并整体移动输入坞，详情页用 `page-meta` 锁底层页面；表情扩为 64 个八列网格，发送按钮固定 96rpx，图片入口改用 Lucide 标准 `image` 图标。
- 首页导航只保留全部、精选、AI 前沿和科技；娱乐、社会、游戏和英语的分类规则继续保留，待内容源接入后再恢复入口。

## 云端与自动化核验

- `knowledgeFeed` 于 2026-07-19 重新部署成功；`knowledge_user_profiles` 创建后由官方 ACL 接口复核为 `ADMINONLY`。
- 部署后真实微信上下文完成喜爱与收藏开启/还原；四次事务写入约 504–569ms，自动化含桥接往返约 1.1 秒，但 UI 已在等待前本地更新。09:28–09:32 日志中 `TransactionBusy=0`、公共临时失败提示为 0，测试状态已还原。
- 评论组件自动化确认：未聚焦时 `composerExpanded=false` 且无发送按钮；聚焦后为 true 且发送按钮存在；“PRO”标签不存在；资料编辑页可渲染，空资料接口正常返回。
- 188/188 Node 测试、31 JSON/175 JavaScript/11 页面项目检查与 `git diff --check` 通过。
- 微信开发者工具自动化确认：导航 key 为 `all/featured/ai/tech`；模拟 336px 键盘后输入坞样式为 `bottom:336px`，发送按钮实际宽 49px（当前模拟器换算为 96rpx）；表情单元 64 个；页面样式为 `overflow: hidden`；评论列表视口 284px、内容 1194px，可独立滚动到 260px。
- 详情页自动化确认：喜欢两次快速反向点击在 29ms 内完成本地变化，收藏为 16ms；两者最终还原并与云端状态一致。动作文案恒为“评论/喜欢/收藏/分享”；发送按钮与输入工具行右边缘的实测间距为 0px。

## 验证边界

- 自动化没有替用户选择或保存虚构头像昵称，也没有访问其真实相册。
- `chooseAvatar`、`type="nickname"`、不同系统输入法的真实键盘动画、相册原图与好友接收分享仍需用户在真实手机验收。
- 普通 Wiki 不记录昵称、头像、OpenID、owner key、令牌或自动化会话。
