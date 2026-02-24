// 合作小区配置（地理围栏）
// 说明：坐标使用 GCJ-02（微信 getLocation 默认）
//
// - 前端用于：注册页的小区选择 + 定位围栏校验
// - 后端（云函数）仍必须做“允许小区名单”校验，避免仅靠前端限制被绕过

const LIST = [
  {
    key: 'hyyc',
    name: '花语云萃',
    // 小区中心点坐标：苏州市相城区中铁建·花语云萃
    // 你提供的经纬度是 "120.64747499999999,31.37973700000001"
    // 注意：lat 是纬度（31.x），lng 是经度（120.x）
    center: { lat: 31.37973700000001, lng: 120.64747499999999 },
    // 半径（米）：根据四个边界点粗算后加余量（GPS 漂移/边缘楼栋）
    radiusMeters: 220
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

