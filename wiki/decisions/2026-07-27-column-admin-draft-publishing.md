---
title: "会员专栏采用管理员草稿与发布快照"
type: decision
tags: [column, membership, admin, cloudbase, publishing, media]
last_updated: 2026-07-27
status: accepted
confidence: high
---

# 会员专栏采用管理员草稿与发布快照

## 背景

会员专栏正文原先全部随 `knowledgeFeed` 云函数代码发布。增加、修改、排序或下架
基础课和动手课都需要改代码、重新部署并提交小程序审核，不适合持续运营。

## 选项

1. 继续维护代码内正文：回退最简单，但每次内容变更都需要工程发布。
2. 建设独立网页 CMS：操作空间大，但首期会增加新的登录、部署和权限边界。
3. 在小程序内建设真实管理员专用的结构化后台，并由 CloudBase 保存草稿和发布
   快照。

## 决定

采用第三种方案：

- 现有 24 节基础课和 6 节动手课继续作为代码内安全基线；数据库覆盖记录可以修改、
  重排或下架基线，也可以保存新内容。覆盖集合读取失败时，公共目录回退到内置基线。
- `knowledge_column_entries` 分开保存 `draft` 与 `published` 快照。保存草稿只递增
  编辑版本；发布事务复制完整草稿、递增发布 revision；会员接口只读发布快照。
- 管理 action 每次都从当前微信上下文重新解析身份，并要求
  `viewer.isActualAdmin === true`。真实管理员处于 free/member 角色预览时仍保留管理
  权限，页面隐藏不作为安全边界。
- 保存、发布和下架携带 `expectedVersion` 与幂等操作 ID；并发覆盖返回
  `VERSION_CONFLICT`。
- `knowledge_column_media` 保存管理员图片的内容归属和生命周期。图片逐张上传、没有
  人为张数上限，短期地址每 50 张签发；发布快照仍引用的图片不能删除，未引用图片
  延迟清理且只有云存储确认删除后才移除数据库记录。
- 首期只提供小程序内结构化编辑，不建设独立网页后台、自由富文本或定时发布。

## 影响

- 首次仍需创建并锁定两个集合和索引、部署兼容静态回退的云函数，再上传含管理页面
  的小程序并经过审核。该版本上线后，日常专栏内容发布不再需要重新发版。
- 公共 `columnHome`、`columnLesson`、`columnPractical` 合同和 Pro 服务端重鉴权
  保持不变；普通用户仍只获得标题目录。
- 内置基线不能从代码删除，它同时承担空数据库和覆盖读取失败时的安全回退。

## 状态与来源

- 日期：2026-07-27
- 状态：accepted；生产集合、索引和 `knowledgeFeed` 已部署，开发预览已编译；微信
  审核版本和真实管理员发布 canary 尚未完成。
- 证据：[会员专栏管理员发布系统实现与后台部署](../sources/2026-07-27-column-admin-publishing-implementation.md)
