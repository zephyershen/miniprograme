// 云函数：registerUser
// 功能：在服务端统一执行“实名注册”逻辑：
// 1）根据身份证号在 userInfo 集合中查重；
// 2）如果未注册，则写入一条实名记录；
// 3）返回用于小程序本地缓存的用户对象。

const cloud = require('wx-server-sdk');

cloud.init({
  // 使用当前云环境配置
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const USER_COLLECTION = 'userInfo';

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID || wxContext.openId || '';

  // 前端通过 event.form 传入实名表单字段
  const form = (event && event.form) || {};

  const idNumber = form.idNumber;
  const name = form.name;
  const community = form.community;
  const building = form.building;
  const door = form.door;

  if (!idNumber || !name || !community || !building || !door) {
    return {
      ok: false,
      code: 'INVALID_PARAM',
      msg: '缺少必要参数'
    };
  }

  try {
    // 使用事务保证“查重 + 写入”流程在高并发下也尽量保持一致性
    const result = await db.runTransaction(async (transaction) => {
      const coll = transaction.collection(USER_COLLECTION);

      // 1）同一个身份证号只允许一条记录
      const queryRes = await coll
        .where({ idNumber })
        .limit(1)
        .get();

      const list = (queryRes && queryRes.data) || [];
      if (list.length > 0) {
        const user = list[0] || {};
        // 已存在用户：返回 exists 标记，前端用来弹出提示
        return {
          ok: false,
          code: 'ID_EXISTS',
          msg: '该身份证号已注册',
          exists: true,
          user: {
            _id: user._id || '',
            _openid: user._openid || '',
            name: user.name || '',
            idNumber: user.idNumber || ''
          }
        };
      }

      const now = new Date();

      const dataToAdd = {
        ...form,
        realname: true,
        verified: true,
        createdAt: now
      };

      // 为了兼容登录流程中通过 _openid 查询 userInfo，这里手动写入 _openid
      if (openid) {
        dataToAdd._openid = openid;
      }

      const addRes = await coll.add({
        data: dataToAdd
      });

      const newId = (addRes && addRes._id) || '';

      // 前端本地缓存用的用户对象：带上 id / _id
      const userForClient = {
        ...dataToAdd,
        _id: newId,
        id: newId
      };

      return {
        ok: true,
        id: newId,
        user: userForClient
      };
    });

    return result;
  } catch (err) {
    console.error('registerUser 事务失败', err);
    return {
      ok: false,
      code: err && err.errCode ? String(err.errCode) : 'TRANSACTION_ERROR',
      msg: err && err.errMsg ? err.errMsg : '注册失败，请稍后重试'
    };
  }
};

