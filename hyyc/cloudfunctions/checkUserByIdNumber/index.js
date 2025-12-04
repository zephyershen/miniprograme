// 云函数：checkUserByIdNumber
// 作用：在服务端（拥有管理员权限的环境）根据身份证号查询 userInfo 集合，
//      判断是否已经存在实名记录。这样即便小程序端因为权限看不到别人的数据，
//      也可以在这里做“身份证唯一”校验。

const cloud = require('wx-server-sdk');

// 使用当前环境的云开发配置，无需额外传 env
cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const db = cloud.database();
const USER_COLLECTION = 'userInfo';

exports.main = async (event, context) => {
  const idNumber = event && event.idNumber;

  if (!idNumber) {
    // 参数不完整，直接返回错误
    return {
      ok: false,
      code: 'INVALID_PARAM',
      msg: '缺少身份证号',
    };
  }

  try {
    // 这里只按身份证号查重：一个身份证号只允许一条实名记录
    const res = await db
      .collection(USER_COLLECTION)
      .where({ idNumber })
      .limit(1)
      .get();

    const list = (res && res.data) || [];
    if (!list.length) {
      // 没有任何记录，说明可以注册
      return {
        ok: true,
        exists: false,
      };
    }

    const user = list[0] || {};
    // 为了避免泄露过多隐私，这里只返回最必要的字段
    return {
      ok: true,
      exists: true,
      user: {
        _id: user._id || '',
        _openid: user._openid || '',
        name: user.name || '',
        idNumber: user.idNumber || '',
      },
    };
  } catch (err) {
    console.error('checkUserByIdNumber 查询失败', err);
    return {
      ok: false,
      code: err && err.errCode ? String(err.errCode) : 'QUERY_ERROR',
      msg: err && err.errMsg ? err.errMsg : '查询失败',
    };
  }
};

