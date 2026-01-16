const { walletFlows, user } = require('../../../utils/mock');
const { formatMoney } = require('../../../utils/format');

Page({
  data: { balance: '0.00', flows: [], isLoading: true },
  onShow(){
    this.setData({ isLoading: true });
    setTimeout(() => {
      this.setData({ balance: formatMoney(user.balance), flows: walletFlows.map(i=>({ ...i, amount: formatMoney(i.amount) })), isLoading: false });
    }, 700);
  },
  gotoProfile(){ wx.navigateBack({ fail: ()=> wx.switchTab({ url: '/pages/profile/index/index' })}); }
});
