module.exports = {
  knowledgeMemberPurchasesEnabled: false,
  wechatVirtualPayEnabled: true,
  wechatVirtualPayReleaseApproved: false,
  wechatVirtualPayEnvironment: 1,
  wechatVirtualPayOfferId: '虚拟支付后台显示的 offerId',
  wechatVirtualPayAppKey: '仅放入云函数环境变量或未提交的 config.local.js',
  wechatVirtualPayProductId: '已发布的 30 天会员道具 ID',
  wechatMiniProgramAppId: 'wxcb0f641838abf6e6',
  wechatMiniProgramAppSecret: '仅放入云函数环境变量或未提交的 config.local.js',
  wechatVirtualPayApiBaseUrl: 'https://api.weixin.qq.com',
  wechatVirtualPayTimeoutMs: 5000,
  wechatVirtualPayPro30dPriceCents: 590,
  wechatVirtualPayPro30dGoodsPriceCents: 590,
  wechatVirtualPayPro30dCompareAtPriceCents: 1090,
  wechatMessagePushToken: '微信公众平台消息推送配置中的 Token',
  wechatMessagePushEncodingAesKey: '微信公众平台消息推送配置中的 43 位 EncodingAESKey'
};
