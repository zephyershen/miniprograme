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
const LEGAL_COLLECTION = 'legal_docs';

function toTs(v) {
  if (!v) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const m = v.match(/^(\d{4}-\d{2}-\d{2})(?:-v(\d+))?/);
    if (m) {
      const t = Date.parse(m[1]);
      if (!Number.isNaN(t)) return t + (m[2] ? Number(m[2]) : 0);
    }
    const t = Date.parse(v);
    if (!Number.isNaN(t)) return t;
    return 0;
  }
  if (v && typeof v.getTime === 'function') return v.getTime();
  return 0;
}

function docTs(doc) {
  const d = doc || {};
  return Math.max(
    toTs(d.updatedAt),
    toTs(d.effectiveAt),
    toTs(d.createdAt),
    toTs(d.effectiveDate),
    toTs(d.version)
  );
}

function pickLatest(list) {
  let best = null;
  let bestTs = -1;
  const arr = list || [];
  for (let i = 0; i < arr.length; i++) {
    const item = arr[i];
    if (!item) continue;
    const ts = docTs(item);
    if (ts > bestTs) {
      best = item;
      bestTs = ts;
    }
  }
  return best || arr[0] || null;
}

async function getActiveLegalDoc(transaction, type) {
  const res = await transaction.collection(LEGAL_COLLECTION)
    .where({ type })
    .limit(20)
    .get();
  const list = (res && res.data) || [];
  const activeList = list.filter(d => d && d.status === 'active');
  return activeList.length ? pickLatest(activeList) : pickLatest(list);
}

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID || wxContext.openId || '';

  if (!openid) {
    return {
      ok: false,
      code: 'NO_OPENID',
      msg: '获取用户身份失败'
    };
  }

  // 必须同意协议后才允许注册（前端也会拦一次，这里再做兜底）
  const agree = !!(event && event.agree);
  if (!agree) {
    return {
      ok: false,
      code: 'AGREEMENT_REQUIRED',
      msg: '请先阅读并同意用户协议和隐私政策'
    };
  }

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

      // 0）同一个微信（openid）只允许一条实名记录
      const openidRes = await coll
        .where({ _openid: openid })
        .limit(1)
        .get();

      const openidList = (openidRes && openidRes.data) || [];
      if (openidList.length > 0) {
        const user = openidList[0] || {};
        return {
          ok: false,
          code: 'OPENID_EXISTS',
          msg: '该微信已注册',
          exists: true,
          user: {
            _id: user._id || '',
            _openid: user._openid || '',
            name: user.name || '',
            idNumber: user.idNumber || ''
          }
        };
      }

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

      // 读取当前生效的协议版本（只保存元信息，不把全文写进 userInfo）
      const userAgreement = await getActiveLegalDoc(transaction, 'user_agreement');
      const privacyPolicy = await getActiveLegalDoc(transaction, 'privacy_policy');

      if (!userAgreement || !privacyPolicy) {
        return {
          ok: false,
          code: 'LEGAL_DOC_MISSING',
          msg: '协议未配置，请联系管理员'
        };
      }

      const legalAcceptance = {
        acceptedAt: now,
        userAgreement: {
          docId: userAgreement._id || '',
          title: userAgreement.title || '',
          version: userAgreement.version || '',
          hash: userAgreement.hash || ''
        },
        privacyPolicy: {
          docId: privacyPolicy._id || '',
          title: privacyPolicy.title || '',
          version: privacyPolicy.version || '',
          hash: privacyPolicy.hash || ''
        }
      };

      const dataToAdd = {
        ...form,
        realname: true,
        verified: true,
        legalAcceptance,
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
