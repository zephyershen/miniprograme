// 计算两点之间距离（米），GCJ-02 近似可用
function distanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000; // 地球半径（米）
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  // 避免使用 `**`（部分基础库/运行环境对指数运算支持不一致）
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const a = sinLat * sinLat + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * sinLon * sinLon;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

module.exports = { distanceMeters };
