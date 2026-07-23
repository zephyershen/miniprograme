---
title: "评论采用主动资料身份与原图附件，资讯互动使用乐观目标状态"
type: decision
tags: [engagement, comments, profile, media, optimistic-ui, cloudbase]
last_updated: 2026-07-19
status: accepted
confidence: high
---

# 评论采用主动资料身份与原图附件，资讯互动使用乐观目标状态

## 决策

- 喜爱与收藏点击后先在本地更新，再以明确的目标状态提交云端；失败才回滚。连续点击不锁住前端，由共享同步器串行提交“最新目标状态”，避免旧响应覆盖新意图。服务端不再把请求解释为盲目 toggle，因此网络重试不会重复反转。
- 详情操作文案始终保持“喜欢”与“收藏”，只通过图标填充状态反馈结果；不显示“已喜欢”或“已收藏”的成功 Toast。
- 互动事务固定顺序读取用户状态与资讯条目，并仅对 `TransactionBusy` 做有界短重试。评论使用客户端 mutation id 派生稳定文档 ID，重试不会重复计数。
- 评论保持 Pro/管理员权益。输入框未聚焦时只显示紧凑输入面；聚焦后才显示图片、表情、字数和发送按钮。
- 评论输入不再只让原生 `textarea` 自动上推；组件监听键盘高度并把输入框、图片、表情、字数和发送按钮作为整体停靠在键盘顶部。详情页打开评论时通过 `page-meta` 锁住底层页面，评论 `scroll-view` 保持独立滚动。
- 表情入口使用 64 个常用表情的八列滚动网格；发送按钮固定为 96rpx 并占据输入工具行的最右列；图片入口使用 Lucide `image` 的标准轮廓，不再维护难以辨认的手绘 CSS 图形。
- 评论支持最多 3 张、单张不超过 10MB 的手机原图。原文件上传到 CloudBase，评论内点击通过 `wx.previewImage` 查看高清原图。
- 发布前用户必须主动确认头像和昵称；使用微信 `chooseAvatar` 与 `input type="nickname"`，不调用已不适合当前隐私模型的自动资料抓取。资料可在“我的”随时修改，历史评论按作者键动态关联最新公开资料。
- `knowledge_user_profiles` 只保存派生 owner key、用户主动确认的昵称与云头像文件 ID，集合为 `ADMINONLY`；公开评论 DTO 不返回 owner key。

## 模块边界

- `components/comment-sheet` 独立拥有评论列表、输入、表情、图片选择、上传、预览和资料补全导航。
- `features/engagement/composer-model` 拥有表情清单和键盘输入坞几何；组件只接收键盘事件并应用展示状态，便于无微信运行时的边界测试。
- `features/user-profile` 拥有资料 API、模型、会话和头像上传；`services/cloud-media` 是头像与评论附件共享的云文件边界。
- 云端 `user-profile-service/repository` 管理资料；`feed-engagement-service/repository` 管理权限、公开视图、幂等和事务。

## 替代关系

本决策替代 2026-07-18 互动决策中“匿名、纯文字评论”的实现细节；评论会员权限、喜爱计入热度、紧凑收藏和微信分享路径继续有效。

## 尚未完成

- 微信头像选择、系统相册、真机键盘位置和好友接收分享卡只能在真实手机完成最终人工验收。
- 面向公开大规模用户开放图片评论前，需要接入并验证用户内容审核流程；当前仍是会员内测能力。
