---
title: "生产基础设施、斗拱模式与会员定价复核"
type: source
tags: [infrastructure, cloudbase, huifu, pricing, membership]
last_updated: 2026-07-19
status: confirmed
confidence: high
---

# 生产基础设施、斗拱模式与会员定价复核

## 结论

- 斗拱文档中的“间联模式”是支付通道关系，不是公网服务器之间的网络连接。商户绑定公司银行账户只说明结算主体与到账账户，不能单独判断直连或间联。
- 斗拱官方小程序支付文档明确：商户业务开通时配置了 `wx_zl_conf` 才属于微信直连，否则属于间联。直连请求使用商户 AppID 下的 `openid`；间联/子商户场景使用 `sub_appid + sub_openid`。当前项目默认 `sub` 仅是安全占位，必须按斗拱后台的实际业务开通结果确认后再启用真实扣款。
- 当前产品适合“标价 ¥19.9/30 天，冷启动首购 ¥9.9/30 天”。现有支付实现是一笔购买增加 30 天权益，不是自动续费；若暂不增加优惠规则，可先全量使用 ¥9.9 做首批验证，再将新订单价格切换为 ¥19.9。

## 公网服务器只读检查

检查时间：2026-07-19 21:01（Asia/Shanghai）。未写入配置、未重启服务、未输出地址或凭据。

- Ubuntu 24.04.3 LTS，2 vCPU，1,967 MB 内存，1,197 MB 可用，交换分区使用 144 MB。
- 根盘约 40.2 GB，使用 36%，可用约 24.8 GB。
- `source-preview.service`、`nginx.service`、`mihomo.service` 均为 active；原文截图服务健康检查返回 `ok/configured`，累计重启次数为 0。
- 截图服务当前内存约 350 MiB、历史峰值约 659 MiB、cgroup 上限约 1.27 GiB；服务目录约 506 MB，Nginx 日志约 3.2 MB。
- 最近 30 天错误主要是上游 404/403/401 和页面/截图超时，没有形成服务重启。该服务器执行外部网页截图，负载主要随新增资讯与补图数量增长，不随每个阅读用户线性增长。

## CloudBase 只读检查

- 环境 `hyyc-1gi3f5sqc5becabf` 为标准版、预付费、状态正常，当前有效期到 2027-01-14；未开启超限按量。官方当前标准版价格为 ¥199/月。
- 五个 Node.js 18.15 云函数均部署完成：`digestIngest`、`digestStore`、`knowledgeFeed`、`knowledgeOps`、`membershipBilling`。
- 当前数据：3,629 条资讯、2,105 条 ready 分析、2,502 个 completed 分析任务、0 pending/retry/leased/blocked、102 条公开精选、3 份已发布简报、2 条评论、9 条互动、1 个资料账号、0 个有效付费会员。
- 云存储共 8,688 个对象，约 694,129,829 bytes（约 662 MiB）。
- `membershipBilling` 当前仍返回 `available:false`、售价为 0；没有真实扣款。正式收费前仍需配置斗拱模式、商户/产品标识、密钥和实际售价。

## 定价依据

- 腾讯云标准版形成已知 ¥199/月固定成本；公网服务器实际账单、斗拱费率和 Packy 供应商正式换算合同尚未确认，不能伪造精确总成本。
- 自动分析、精选与简报对全站资讯只处理一次，模型成本由全体用户共享，新增一个阅读用户不会重新分析同一条资讯；用户增长主要增加 CloudBase 请求、下行流量和评论审核。
- 知乎盐选当前单月 ¥25、连续包月续费 ¥19，首月促销可低至 ¥9；AI Insight Pro 为 ¥99/季度。当前小程序仍处于冷启动，内容覆盖集中在 AI/科技，其他四个频道关闭，且没有自动续费，直接定到 ¥29.9 以上会明显提高首次付费阻力。
- 建议首批 100～300 个付费用户或前 30 天使用 ¥9.9；完成支付、到期、退款和真机闭环并积累稳定简报后，新购恢复 ¥19.9。后续若增加全年方案，可评估 ¥168～198/年，但不应在真实留存数据出现前一次性承诺长期低价。

## 公开资料

- 斗拱小程序支付：<https://paas.huifu.com/open/doc/api/#/smzf/api_jhzs?id=miniwx>
- 斗拱商户业务开通：<https://paas.huifu.com/open/doc/api/#/shgl/shywkt/api_shjj_shywkt_kyc>
- 腾讯云 CloudBase 定价：<https://buy.cloud.tencent.com/price/tcb/overview>
- 知乎盐选会员：<https://www.zhihu.com/xen/market/vip-privileges>
- AI Insight Pro：<https://www.ai-insight.org/pro?from=news_paywall&news=12398>

## 敏感信息处理

服务器地址、SSH 端口、密码、CloudBase 登录凭据、斗拱密钥、OpenID 与用户资料均未写入普通 Wiki；本页只记录资源规格、计数、状态和公开文档结论。
