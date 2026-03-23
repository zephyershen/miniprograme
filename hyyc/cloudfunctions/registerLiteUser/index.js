const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

const USER_COLLECTION = 'userInfo';
const USER_COMMUNITY_COLLECTION = 'user_community';
const LEGAL_COLLECTION = 'legal_docs';
const WALLET_COLLECTION = 'wallets';
const BUILD_TAG = 'registerLiteUser@2026-03-20.1';

function pickStr(...vals) {
  for (const v of vals) {
    const s = String(v == null ? '' : v).trim();
    if (s) return s;
  }
  return '';
}

function getAllowedCommunities() {
  const raw = pickStr(process.env.ALLOWED_COMMUNITIES);
  const list = raw
    ? raw.split(',').map((item) => pickStr(item)).filter(Boolean)
    : [];
  return list.length ? list : ['花语云萃'];
}

function toTs(v) {
  if (!v) return 0;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const matched = v.match(/^(\d{4}-\d{2}-\d{2})(?:-v(\d+))?/);
    if (matched) {
      const ts = Date.parse(matched[1]);
      if (!Number.isNaN(ts)) return ts + (matched[2] ? Number(matched[2]) : 0);
    }
    const ts = Date.parse(v);
    return Number.isNaN(ts) ? 0 : ts;
  }
  if (v && typeof v.getTime === 'function') return v.getTime();
  return 0;
}

function docTs(doc = {}) {
  return Math.max(
    toTs(doc.updatedAt),
    toTs(doc.effectiveAt),
    toTs(doc.createdAt),
    toTs(doc.effectiveDate),
    toTs(doc.version)
  );
}

function pickLatest(list = []) {
  let best = null;
  let bestTs = -1;
  (Array.isArray(list) ? list : []).forEach((item) => {
    if (!item) return;
    const ts = docTs(item);
    if (ts > bestTs) {
      best = item;
      bestTs = ts;
    }
  });
  return best || ((Array.isArray(list) ? list : [])[0] || null);
}

async function ensureCollectionExists(name) {
  try {
    if (db && typeof db.createCollection === 'function') {
      await db.createCollection(String(name || '').trim());
    }
  } catch (err) {
    // ignore
  }
}

async function getActiveLegalDoc(transaction, type) {
  const activeRes = await transaction.collection(LEGAL_COLLECTION).where({ type, status: 'active' }).limit(20).get();
  const activeList = (activeRes && activeRes.data) || [];
  if (activeList.length) return pickLatest(activeList);

  const res = await transaction.collection(LEGAL_COLLECTION).where({ type }).limit(20).get();
  const list = (res && res.data) || [];
  return pickLatest(list);
}

function buildPrimaryWalletDoc(openid = '', now = new Date()) {
  return {
    _openid: pickStr(openid),
    balance: 0,
    incomeTotal: 0,
    expenseTotal: 0,
    createdAt: now,
    updatedAt: now,
    walletRole: 'primary',
    isPrimary: true,
    shadowedWalletIds: [],
  };
}

function normalizeUserForCache(user = {}) {
  const source = user && typeof user === 'object' ? user : {};
  const id = pickStr(source._id, source.id);
  return {
    ...source,
    id: id || source.id || '',
    _id: id || source._id || '',
  };
}

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext();
  const openid = pickStr(OPENID);
  const agree = !!event.agree;
  const avatarFileID = pickStr(event.avatarFileID);
  const form = event && typeof event.form === 'object' ? event.form : {};
  const phone = pickStr(form.phone);
  const community = pickStr(form.community);
  const nickname = pickStr(form.nickname);

  try {
    if (!agree) {
      return { ok: false, code: 'AGREEMENT_REQUIRED', msg: '请先阅读并同意用户协议和隐私政策', buildTag: BUILD_TAG };
    }
    if (!openid) {
      return { ok: false, code: 'NO_OPENID', msg: '获取用户身份失败', buildTag: BUILD_TAG };
    }
    if (!phone || !community) {
      return { ok: false, code: 'INVALID_PARAM', msg: '请先补全基础注册信息', buildTag: BUILD_TAG };
    }

    const allowed = getAllowedCommunities();
    if (allowed.indexOf(community) < 0) {
      return {
        ok: false,
        code: 'COMMUNITY_NOT_ALLOWED',
        msg: '账号仅限合作小区业主/住户使用，请联系物业或管理员开通',
        buildTag: BUILD_TAG,
      };
    }

    await ensureCollectionExists(WALLET_COLLECTION);

    const txRes = await db.runTransaction(async (transaction) => {
      const userColl = transaction.collection(USER_COLLECTION);
      const userRes = await userColl.where({ _openid: openid }).limit(2).get();
      const userList = (userRes && userRes.data) || [];
      if (userList.length > 1) {
        return { ok: false, code: 'DUPLICATE_USER', msg: '当前账号存在多条记录，请联系管理员处理' };
      }

      const existing = userList[0] || null;
      if (existing && (existing.realname === true || existing.verified === true)) {
        return {
          ok: true,
          alreadyRealname: true,
          id: pickStr(existing._id, existing.id),
          user: normalizeUserForCache(existing),
        };
      }

      const now = new Date();
      const userAgreement = await getActiveLegalDoc(transaction, 'user_agreement');
      const privacyPolicy = await getActiveLegalDoc(transaction, 'privacy_policy');
      if (!userAgreement || !privacyPolicy) {
        return { ok: false, code: 'LEGAL_DOC_MISSING', msg: '协议未配置，请联系管理员' };
      }

      const legalAcceptance = {
        acceptedAt: now,
        userAgreement: {
          docId: userAgreement._id || '',
          title: userAgreement.title || '',
          version: userAgreement.version || '',
          hash: userAgreement.hash || '',
        },
        privacyPolicy: {
          docId: privacyPolicy._id || '',
          title: privacyPolicy.title || '',
          version: privacyPolicy.version || '',
          hash: privacyPolicy.hash || '',
        }
      };

      const baseData = {
        community,
        phone,
        nickname: pickStr(nickname, existing && existing.nickname),
        avatarFileID: pickStr(avatarFileID, existing && existing.avatarFileID),
        legalAcceptance,
        registerStage: 'lite',
        realname: false,
        verified: false,
        updatedAt: now,
      };

      let userId = '';
      let user = null;
      if (existing && existing._id) {
        userId = existing._id;
        const updateData = {
          ...baseData,
          liteRegisteredAt: existing.liteRegisteredAt || existing.createdAt || now,
        };
        await userColl.doc(userId).update({ data: updateData });
        user = normalizeUserForCache({
          ...existing,
          ...updateData,
          _id: userId,
          id: pickStr(existing.id, userId) || userId,
        });
      } else {
        const createData = {
          ...baseData,
          _openid: openid,
          createdAt: now,
          liteRegisteredAt: now,
        };
        const addRes = await userColl.add({ data: createData });
        userId = pickStr(addRes && addRes._id);
        user = normalizeUserForCache({
          ...createData,
          _id: userId,
          id: userId,
        });
      }

      const ucColl = transaction.collection(USER_COMMUNITY_COLLECTION);
      const ucRes = await ucColl.where({ _id: openid }).limit(1).get();
      const ucList = (ucRes && ucRes.data) || [];
      if (ucList.length) {
        await ucColl.doc(openid).update({
          data: { community, updatedAt: now }
        });
      } else {
        await ucColl.add({
          data: { _id: openid, community, updatedAt: now, createdAt: now }
        });
      }

      const walletColl = transaction.collection(WALLET_COLLECTION);
      const walletRes = await walletColl.where({ _openid: openid }).limit(5).get();
      const walletList = (walletRes && walletRes.data) || [];
      if (!walletList.length) {
        await walletColl.doc(openid).set({
          data: buildPrimaryWalletDoc(openid, now)
        });
      }

      return { ok: true, id: userId, user };
    });

    if (!txRes || txRes.ok !== true) {
      return { ...(txRes || {}), buildTag: BUILD_TAG };
    }

    if (txRes.id) {
      try {
        await db.collection(USER_COLLECTION).doc(txRes.id).update({
          data: { id: txRes.id }
        });
      } catch (err) {
        console.error('回写 userInfo.id 失败', err);
      }
    }

    return {
      ok: true,
      alreadyRealname: !!txRes.alreadyRealname,
      id: txRes.id,
      user: normalizeUserForCache(txRes.user),
      buildTag: BUILD_TAG,
    };
  } catch (err) {
    console.error('registerLiteUser 失败', err);
    return {
      ok: false,
      code: err && err.errCode ? String(err.errCode) : 'REGISTER_LITE_ERROR',
      msg: err && err.errMsg ? err.errMsg : '基础注册失败，请稍后重试',
      buildTag: BUILD_TAG,
    };
  }
};
