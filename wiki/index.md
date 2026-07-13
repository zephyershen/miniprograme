---
title: "别收藏了小程序 Wiki 导航"
type: index
tags: [index, miniprogram, digest-inbox]
last_updated: 2026-07-13
status: confirmed
confidence: high
---

# 别收藏了小程序 Wiki 导航

## 项目入口

- [项目总览](overview.md) — 当前产品、代码状态、验证结果和待完成的外部操作
- [微信小程序实体](entities/WeChatMiniProgram.md) — AppID、云环境、仓库和部署边界
- [里程碑时间线](timeline.md) — 从旧项目审计到首版本地重建

## 关键决策

- [保留项目身份、移除旧业务](decisions/2026-07-13-rebuild-product.md) — 旧项目重建边界
- [“别收藏了”首版产品与技术边界](decisions/2026-07-13-digest-inbox-v1.md) — 当前已接受并已在本地实现的方案

## 证据

- [旧代码与仓库审计](sources/2026-07-13-code-and-repository-audit.md) — 重建前的历史快照，现已被新实现替代
- [首版本地实现审计](sources/2026-07-13-digest-inbox-implementation.md) — 当前文件、Git 与测试证据

## 当前模块

- 小程序页面：待消化、消化详情、结论卡、设置
- 云函数：`digestIngest`、`digestStore`
- 数据：待处理队列最多 5 条、结论卡最多 20 张、AI 月度硬上限 10 元

## 当前风险与下一入口

- 本地实现和测试已完成，但尚未使用微信开发者工具编译、部署或上传体验版。
- 旧云环境中的数据、存储、函数、触发器和密钥尚未在线核验或清空；先读 [云资源清理说明](../docs/cloud-cleanup.md)。
- 外层旧 `.git` 因当前 Windows 工作区占用尚未归档；正式仓库必须使用 `D:\miniprogramcode\miniprogram`。
- 接手开发先读 [项目总览](overview.md)，准备部署再读 [README](../README.md)。
