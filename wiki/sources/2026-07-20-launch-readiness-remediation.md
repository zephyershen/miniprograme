---
title: "历史内容补审、资讯同步恢复与虚拟支付通知上线证据"
type: source
tags: [launch-readiness, moderation, feed-sync, virtual-payment, refund, production]
last_updated: 2026-07-20
status: confirmed
confidence: high
---

# 历史内容补审、资讯同步恢复与虚拟支付通知上线证据

## 结论

- 生产环境中缺少审核结果的历史公开内容已完成有界、幂等补审：2 条评论和 1 份用户资料均获准公开；复核查询中“公开但无审核结果”的评论为 0，“完整但无审核结果”的资料为 0。补审没有删除评论文字、昵称、头像或评论附件。
- 资讯源连续失败的根因是缓存文档从 CloudBase 读取后携带 `_id`，整文档事务覆盖时又把 `_id` 写回固定文档，触发数据库拒绝更新保留字段；写入边界剥离 `_id` 后，生产失败计数从 747 恢复为 0，观测指纹与应用指纹一致，连续定时任务先记录 `updated`、下一轮记录 `unchanged`。
- 微信虚拟支付现网方案使用道具 `pro_30d`，远程 `plans` 返回 `available=true`、590 分成交价和 1090 分划线道具价。产品负责人确认微信后台已开启 IAP；该后台状态没有通过代码侧接口重复读取。
- `membershipBilling` 已部署微信安全模式消息处理：支持 GET 地址验证、iOS 退款询问和退款通知，校验消息签名、AES 密文、AppID、订单身份、商品、数量和金额，并在官方查单确认退款后幂等回收对应 30 天权益。
- 生产订单表已增加支付交易号、渠道订单号和微信支付交易号三个稀疏索引，供退款通知以受限条件定位订单。

## 生产操作与验证

1. `knowledgeFeed` 的维护入口按最多 25 条一批领取缺审内容；领取、审核和最终状态提交均带租约与尝试 ID，重入不会重复计数或重复公开。
2. 首轮历史补审由 CloudBase 主模型超时后自动转 Packy 兜底，2 条评论和 1 份资料均返回允许；再次执行显示所有目标已处理，未留下 pending 或 rejected 项。
3. `knowledgeFeed`、`knowledgeOps` 与 `membershipBilling` 重新部署完成；五个云函数最终均为 Deployment completed。
4. 资讯源修复部署后，生产缓存的 `sourcePollFailures=0`、`sourceNextPollAt=null`、`sourceLastErrorCode` 为空，`sourceObservedFingerprint` 与 `sourceAppliedFingerprint` 完全一致；全量条目存储同轮完成 1 条新增和 2 条撤回。
5. 全量回归为 265/265 个 Node 测试通过；项目检查覆盖 33 个 JSON、223 个 JavaScript 和 9 个活跃页面；`git diff --check` 通过。

## 仍需在真实支付联调中完成

- 微信后台“开发管理 → 消息推送配置”和 `membershipBilling` 必须配置同一组 Token 与 EncodingAESKey，数据格式选择 JSON、加密方式选择安全模式，地址使用现有 `/hyyc/membership/notify` 路由。
- 当前 `WECHAT_MESSAGE_PUSH_TOKEN` 与 `WECHAT_MESSAGE_PUSH_ENCODING_AES_KEY` 尚未写入生产环境；因此未带配置的地址探测返回 HTTP 503，这是防止未验签通知进入业务的安全关闭状态。
- 配置后用真实 Android 与 iOS 分别验证支付成功、取消、异常退出恢复、重复查单、发货确认、iOS 退款询问、退款通知和退款后权益重新锁定。当前生产订单数仍为 0，不能把代码回归等同于真实扣款验收。

除上述真实支付联调，以及小程序备案变更、账号资料/类目/隐私配置、体验版与微信审核发布外，本轮没有发现新的首发硬阻塞项。其他频道、多来源和资源曲线观察属于上线后扩展或运维事项。

## 敏感信息处理

本轮只读取配置是否存在、商品 ID 是否匹配及非敏感方案状态；AppSecret、AppKey、消息 Token、EncodingAESKey、维护令牌、OpenID、昵称、头像和评论内容均未写入普通 Wiki、代码输出或用户回复。
