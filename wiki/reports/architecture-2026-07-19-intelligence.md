---
title: "2026-07-19 Packy/Grok 知识智能模块化复审"
type: report
tags: [architecture, modularity, intelligence, packyapi, grok, cloudbase]
sources: [../sources/2026-07-19-packy-grok-intelligence.md, ../decisions/2026-07-17-pro-membership-and-intelligence.md]
last_updated: 2026-07-19
status: confirmed
confidence: high
---

# 2026-07-19 Packy/Grok 知识智能模块化复审

## 结论

按 modular-code-architect 的边界、可替换性、测试性、可靠性和演进成本审查，本轮知识智能范围评分为 **9.2/10**，项目整体维持约 **9.0/10**。外部传输、结构合同、编辑评分、队列编排、持久化与公开读取没有互相混入；PackyAPI 未来可替换而不需要改页面或评分策略。

## 分项

| 维度 | 分数 | 结论 |
| --- | ---: | --- |
| 模块边界 | 9.5 | adapter / contract / policy / repository / service / router 职责清晰 |
| 可替换性 | 9.4 | provider factory 与 disabled provider 保留，模型和端点由环境配置 |
| 测试性 | 9.4 | fetch、时钟、owner、repository 均可注入；单条、合批、限流和简报有测试 |
| 可靠性 | 9.1 | 严格 schema、引用白名单、租约、幂等键、退避和 stale 校验完整 |
| 成本控制 | 8.8 | 低推理、五条合批、10 分钟节流、每日 48 条上限和 usage 汇总已实现 |
| 发布安全 | 8.0 | 公开开关安全关闭，但管理员人工审核/修订工作流尚未实现 |

## 符合标准的部分

- `knowledgeFeed/index.js` 只装配 provider、worker、digest service，不包含 API 协议细节。
- JSON Schema 和归一化独立于 HTTP adapter，可被其他 OpenAI Responses 兼容提供方复用。
- 编辑评分仍由确定性 policy 负责，模型只返回可解释信号，避免模型直接决定会员内容。
- 分析任务用输入哈希与策略版本幂等；热度、喜欢数或旧上游 selected 变化不会无意义重跑。
- 合批在 service 层领取多个任务、在 provider 层一次推理、在 repository 层逐条事务发布；某条过期不会污染其他条目。
- 简报只接受候选集合中的来源 ID，并保存引用快照；生成开关和公开读取开关分离。
- 密钥未进入仓库，`docs/packyapi.txt` 已加入 `.gitignore`。

## 尚未达到公开标准的部分

1. 缺少管理员审核队列、人工修订、驳回原因、发布者和审核时间；这是开启精选/简报前的硬条件。
2. `costUsdTicks` 的货币换算没有供应商正式合同，当前只能做原始单位统计和条目日上限，不能宣称美元硬预算。
3. 最近 30 天覆盖仅 4/2,363；2,406 条历史任务仍待处理，不应为追覆盖率直接放开自动消费。
4. 简报生成合同和本地编排已验证，但生产真实简报尚未试跑；公开开关必须继续关闭。
5. 真实第二账号会员生命周期、体验版和内容合规流程仍未完成。

## 下一步

先增加人工审核状态与运维预览，再由用户给出可接受的月预算；据此决定每日条目上限和回填速度。覆盖达到 95% 后抽检至少 50 条，确认精选误收率和来源理由，再分别开启生成与公开读取，不能一次性打开全部开关。
