---
title: "评论回复持久化与消息左滑删除修复证据"
type: source
tags: [comments, messages, cloudbase, wechat-devtools, production-validation]
observed_at: 2026-07-25
status: confirmed
confidence: high
---

# 评论回复持久化与消息左滑删除修复证据

## 结论

评论“刚发送时嵌套、退出后重进变为根评论”的直接原因不是展示组件，而是
`cloudfunctions/knowledgeFeed/index.js` 的 `addComment` action 没有把客户端提交的
`replyToCommentId` 转发给服务层。当前会话里的乐观评论仍带回复目标，所以发送瞬间
位置正确；云端记录却按根评论保存，重新读取后无法恢复层级。

消息左滑删除显示“不支持的操作”的原因是客户端已调用 `deleteMessage`，但当时线上
`knowledgeFeed` 仍是旧代码。部署前下载的线上源码既没有 `deleteMessage`，也没有
缺失根评论补齐逻辑。

## 修复

- `knowledgeFeed/addComment` 现在显式转发 `replyToCommentId`；服务层继续校验直接回复
  目标并持久化 `parentCommentId`、`replyToCommentId` 和根线程关系。
- 评论分页若先返回回复，会按同一资讯补齐仍公开可见的根评论；客户端统一构建两级
  线程，并在稀疏服务端响应替换乐观回复时保留回复上下文。
- “评论互动”和“系统通知”共用左滑删除；云端按当前所有者删除消息，客户端乐观移除、
  失败回滚，并同步分类数、未读数和查看者隔离缓存。
- 新增入口契约回归，防止 `replyToCommentId` 再次在路由层丢失。

## 生产与开发者工具验证

- 仅更新 `knowledgeFeed` 函数代码；函数恢复 `Active / Available`，四函数 manifest
  回读为 0 漂移。
- 部署后重新下载线上函数，`index.js`、评论/消息 repository 和对应 service 共五个
  关键文件的 SHA-256 均与本地工作树一致。
- 已登录微信开发者工具中加载 14 条消息；水平手势能打开删除区。使用不存在的消息
  ID 调用线上删除 action 返回成功且消息数保持 14，验证路由可用且没有删除真实消息。
- 在当前用户自己的根评论下临时创建一条测试回复：创建响应中的根关系与回复目标均
  正确；第一次进入详情和退出后第二次进入详情，测试回复都能从云端读取、保留父级，
  并分组到同一根评论线程。验证结束后测试回复删除成功。
- 全量 `npm.cmd test` 为 701/701；`npm.cmd run check` 通过 33 个 JSON、316 个
  JavaScript、13 个页面。

## 历史数据边界

在入口修复部署前已被保存为根评论的旧回复没有持久化父评论标识，无法仅凭当前评论
文档可靠推断原回复目标，因此不做启发式生产数据迁移。修复部署后的新回复会稳定保留
两级结构；需要恢复的旧回复应由用户删除后重新发送。

## 发布边界

`knowledgeFeed` 已从当前本地工作树做 code-only 生产更新并完成源码回读；本次没有
上传新的微信体验版、提交审核或正式发布，也没有创建 Git 提交。生产函数因此暂时领先
于最后一个 Git 代码锚点，后续提交时应包含本次评论与消息修复以恢复可追溯性。
