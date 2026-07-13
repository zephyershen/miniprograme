# 旧云资源清单

来源：旧版提交 `704a88e` 的本地代码。该清单不代表线上实际部署状态。

## 旧云函数（待从目标环境删除）

- `adminLogin`
- `checkUserByIdNumber`
- `deleteTaskWithMessages`
- `exchangePhoneNumber`
- `goodsPurchase`
- `huifuIndvOpenForMe`
- `huifuMiniappPay`
- `huifuPayNotify`
- `imageAuditCallback`
- `imageAuditStart`
- `login`
- `markMessagesReadByOwner`
- `markMessagesReadByPeer`
- `registerUserByIdCard`
- `taskAccept`
- `taskCreate`
- `taskPaySuccess`
- `taskSubmit`
- `walletWithdraw`

## 旧敏感配置名称（只删除值，不记录值）

- `COS_SECRET_ID`
- `COS_SECRET_KEY`
- `TENCENT_SECRET_ID`
- `TENCENT_SECRET_KEY`
- `HUIFU_PRIVATE_KEY`

## 仍需从控制台补齐

- [ ] 线上实际云函数与触发器
- [ ] 数据库集合、记录数量与索引
- [ ] 云存储文件数量、前缀与容量
- [ ] 环境变量名称
- [ ] 当前套餐与资源点
- [ ] 已启用 AI 模型
