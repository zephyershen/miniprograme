// 合作小区配置（地理围栏）
// 说明：坐标使用 GCJ-02（微信 getLocation 默认）
//
// 这里放在 auth 分包下，避免“仅注册页使用的小区围栏配置”进入主包。

const LIST = [
  {
    key: 'hyyc',
    name: '花语云萃',
    provinceName: '江苏省',
    cityName: '苏州市',
    districtName: '相城区',
    provId: '320000',
    areaId: '320500',
    districtId: '320507',
    center: { lat: 31.37973700000001, lng: 120.64747499999999 },
    // 按公开地址、道路边界和项目占地做保守放宽，减少楼栋边缘和 GPS 漂移误判。
    radiusMeters: 420
  }
];

function pickStr(v) {
  return String(v == null ? '' : v).trim();
}

function getByKey(key) {
  const k = pickStr(key);
  if (!k) return null;
  return LIST.find((c) => c && c.key === k) || null;
}

function getByName(name) {
  const n = pickStr(name);
  if (!n) return null;
  return LIST.find((c) => c && c.name === n) || null;
}

module.exports = {
  list: LIST,
  defaultKey: (LIST[0] && LIST[0].key) || '',
  getByKey,
  getByName
};
