---
title: "会员专栏管理员发布系统实现与后台部署"
type: source
tags: [column, admin, cloudbase, publishing, testing]
observed_at: 2026-07-27
status: backend-deployed-preview-built
confidence: high
---

# 会员专栏管理员发布系统实现与后台部署

## 实现结论

当前工作树已经完成小程序内的会员专栏管理端、CloudBase 草稿/发布快照服务和媒体
生命周期合同。真实管理员可在“我的”进入列表，创建或编辑基础课和动手课，
保存草稿、预览、排序、发布、重新发布与下架；普通用户和会员不能调用管理 action。

## 代码边界

- `cloudfunctions/knowledgeFeed/content/column-entry-contract.js` 把现有 30 节内容投影为
  内置基线，并统一规范两类结构化正文、排序、关联内容和图片引用。
- `repositories/column-entry.js` 与 `column-media.js` 分别处理带版本的事务写入和不限
  固定张数的媒体分页；`column-catalog-service.js` 合并基线与覆盖并每 50 张签发
  临时地址。
- `column-admin-service.js` 集中执行真实管理员授权、幂等版本检查、发布快照、跨内容
  图片归属验证和孤儿清理；公共 `column-content-service.js` 只读取发布快照。
- `features/column-admin/`、`pages/column-admin/` 和 `pages/column-editor/` 提供客户端
  API、表单模型、媒体上传、管理目录和结构化编辑；阅读器支持真实管理员草稿预览。
- 数据库合同新增 `knowledge_column_entries`、`knowledge_column_media`，两者均为
  `ADMINONLY`；合同总数从 26 增为 28，索引总数从 44 增为 47。

## 安全与兼容验证

- 覆盖了真实管理员处于 free 角色预览仍可管理，普通用户/会员被拒绝。
- 覆盖了草稿不可见、发布后原子可见、继续编辑不改变线上快照、下架后目录和详情
  都不可见，以及内置课程可被覆盖下架。
- 覆盖了并发版本冲突、跨内容图片注入拒绝、临时地址失败仍保留管理员图片引用、
  未确认云存储删除时不删除数据库记录。
- 使用 121 张图片验证没有截断，临时地址按 `50 + 50 + 21` 分批签发；阅读器只挂载
  当前图片及相邻图片。
- `npm.cmd run verify` 完整通过：719/719 Node 测试、覆盖率门槛、35 个 JSON、
  327 个 JavaScript、15 个注册页面、28 个 ADMINONLY 集合、47 个索引和生产依赖
  审计均通过。`git diff --check` 通过。
- 微信开发者工具 CLI 已登录，`auto`、`open` 与 `preview` 对当前项目成功；最新开发
  预览包为 582,442 bytes。

## 生产修复与部署

- 用户首次打开管理页时看到 0 条内容和 `INVALID_REQUEST / 不支持的操作`。根因是
  新管理页面已在本地运行，但生产 `knowledgeFeed` 仍是没有管理 action 的旧源码，
  且两个新集合和三个索引尚未创建。
- 2026-07-27 已按增量合同创建并回读
  `knowledge_column_entries`、`knowledge_column_media`，生产集合从 26 收敛为 28；
  三个索引应用后合同从 44 收敛为 47。原有 5 个非合同集合被保留。
- 新版 `knowledgeFeed` 已 code-only 部署。无微信上下文调用 `columnAdminList` 返回
  `AUTH_REQUIRED` 而非 `INVALID_REQUEST`，证明新路由已生效且服务端鉴权仍关闭匿名
  访问；函数 manifest、集合与索引三项生产回读均为 converged。
- 管理页面去掉英文和“内置基线”等开发术语，统一使用会员端的“基础课 / 动手课”；
  未部署后台的旧错误也会转换为可行动说明，不再直接展示“不支持的操作”。

## 剩余发布边界

生产数据库和云函数已经部署，但含新管理页面与修正文案的小程序版本仍未上传审核或
正式发布，也未用真实管理员完成生产数据写入。下一步只剩微信版本上传/审核，以及
“读取 24+6 基线 → 草稿 → 多图预览 → 发布 → Pro/普通双态 → 下架”的真机 canary。
