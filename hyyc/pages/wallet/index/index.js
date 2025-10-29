const { walletFlows, user } = require('../../../utils/mock');
const { formatMoney } = require('../../../utils/format');

Page({
  data: { balance: '0.00', flows: [] },
  onShow(){
    this.setData({ balance: formatMoney(user.balance), flows: walletFlows.map(i=>({ ...i, amount: formatMoney(i.amount) })) });
  },
  gotoProfile(){ wx.navigateBack({ fail: ()=> wx.switchTab({ url: '/pages/profile/index/index' })}); }
});
