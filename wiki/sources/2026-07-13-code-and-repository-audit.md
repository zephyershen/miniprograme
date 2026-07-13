---
title: "2026-07-13 旧小程序代码与仓库审计"
type: source
tags: [audit, git, miniprogram, historical]
sources: []
last_updated: 2026-07-13
status: superseded
confidence: high
---

# 2026-07-13 旧小程序代码与仓库审计

## Provenance

- Source path / origin: `D:\miniprogramcode` 本地文件和 Git 元数据
- Date observed: 2026-07-13
- Scope: 重建前的外层仓库与 `miniprogram\hyyc` 代码
- Status: superseded by the canonical inner repository and v1 implementation
- Confidence: high for the historical snapshot

## 历史证据

- 外层仓库当时位于 `D:\miniprogramcode`，分支 `my-work`，HEAD 为 `5b31689`。
- 外层仓库看到约 683 个旧文件删除，`miniprogram/` 整体未跟踪，说明发生了目录漂移。
- 内层 `D:\miniprogramcode\miniprogram` 是另一份干净且更新的仓库，HEAD 为 `704a88e`，远程相同。
- 旧项目包含 18 个页面路由、19 个云函数，以及任务、商品、聊天、实名、支付、分账、定位和图片审核能力。
- AppID 为 `wxcb0f641838abf6e6`，云环境 ID 为 `hyyc-1gi3f5sqc5becabf`。
- 当时只完成静态语法和文件完整性检查，未验证云端真实状态。

## 已被替代的结论

- 正式仓库现已确定为 `D:\miniprogramcode\miniprogram`，不是外层仓库。
- 旧业务代码已从当前活跃树移除，并保留在 `legacy-hyyc-704a88e` 标签和 Git 历史中。
- 当前实现证据见 [首版本地实现审计](2026-07-13-digest-inbox-implementation.md)。

## 仍然有效的警示

删除本地代码不等于清空云端资源。旧数据库、存储、函数、触发器和环境变量仍必须在有权限的环境中单独盘点并确认清理。
