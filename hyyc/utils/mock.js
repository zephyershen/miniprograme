// 本文件仅用于 UI 联调的假数据
const tasks = [
  {
    id: 't1',
    title: '帮忙取快递',
    amount: 8.8,
    deadline: Date.now() + 86400000,
    community: '花语云萃11栋',
    address: '3栋 门口快递柜',
    building: '3栋',
    desc: '中通 2 个包裹，麻烦尽快~',
    images: [],
    owner: { id: 'u1', name: '王阿姨' },
    status: 'posted'
  },
  {
    id: 't2',
    title: '临时浇花',
    amount: 20,
    deadline: Date.now() + 2 * 86400000,
    community: '花语云萃23栋',
    address: '5栋 1202',
    building: '5栋',
    desc: '阳台 6 盆花浇水一次',
    images: [],
    owner: { id: 'u2', name: '李先生' },
    status: 'posted'
  }
];

const user = {
  id: 'me', name: '我', realname: true, community: '花语云萃', building: '3栋', door: '701', balance: 58.8
};

const walletFlows = [
  { id: 'f1', type: 'in', title: '完成任务#t100', amount: 12.5, time: Date.now() - 3600000 },
  { id: 'f2', type: 'out', title: '提现申请', amount: 20, time: Date.now() - 7200000 }
];

module.exports = { tasks, user, walletFlows };
