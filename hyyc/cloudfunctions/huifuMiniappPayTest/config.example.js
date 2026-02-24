// Huifu (斗拱) 聚合正扫 - 微信小程序支付配置
//
// 使用方式：
// 1) 复制本文件为 config.local.js（不要提交私钥）
// 2) 填写下面参数
//
// 也支持用云函数环境变量覆盖：
// - HUIFU_API_HOST (默认 api.huifu.com)
// - HUIFU_JSPAY_PATH (默认 /v3/trade/payment/jspay)
// - HUIFU_SYS_ID
// - HUIFU_PRODUCT_ID
// - HUIFU_HUIFU_ID
// - HUIFU_SUB_APPID
// - HUIFU_PRIVATE_KEY   (Base64 私钥内容，或 PEM 文本)
// - HUIFU_PRIVATE_KEY_PATH (默认 ./cert/huifu_private_key.pem)

module.exports = {
  // 公共参数：系统号/产品号
  sysId: '6666000123120000',
  productId: 'MCS',

  // 请求参数：商户号（huifu_id）
  huifuId: '6666000123123123',

  // 微信小程序 appid（用于 wx_data.sub_appid；有些模式必须传 sub_appid+sub_openid）
  subAppid: 'wx1234567890abcdef',

  // 私钥（建议放文件；也可以直接把 Base64 私钥字符串/PEM 粘贴到这里）
  // privateKey: 'base64...',
  privateKeyPath: './cert/huifu_private_key.pem'
};
