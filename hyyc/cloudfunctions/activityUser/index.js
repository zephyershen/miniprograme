const cloud = require('wx-server-sdk');
const crypto = require('crypto');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

const BUILD_TAG = 'activityUser@2026-03-19.8';
const USER_COLLECTION = 'userInfo';
const CAMPAIGN_COLLECTION = 'activity_campaigns';
const DRAW_COLLECTION = 'activity_draw_records';
const PAYOUT_COLLECTION = 'activity_payout_logs';
const PLATFORM_ADMIN_OPENID = 'o9-tA3ea7rJR2XSlTuLlJlTbLeNI';
const CHINA_TIME_OFFSET_MS = 8 * 60 * 60 * 1000;
const HOME_WINNER_FEED_LIMIT = 8;
const AUTO_CREATE_COLLECTIONS = process.env.ACTIVITY_AUTO_CREATE_COLLECTIONS === '1';

function pickStr(...vals) {
  for (const v of vals) {
    const s = typeof v === 'string' ? v : (v == null ? '' : String(v));
    if (s && s.trim()) return s.trim();
  }
  return '';
}

function clampInt(v, fallback = 0, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function parseChinaLocalDateTimeMs(raw = '') {
  const text = pickStr(raw);
  if (!text || /(?:Z|[+-]\d{2}:\d{2})$/i.test(text)) return NaN;
  const matched = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!matched) return NaN;
  const year = Number(matched[1]);
  const month = Number(matched[2]) - 1;
  const day = Number(matched[3]);
  const hour = Number(matched[4] || 0);
  const minute = Number(matched[5] || 0);
  const second = Number(matched[6] || 0);
  return Date.UTC(year, month, day, hour - 8, minute, second);
}

function toDateMs(v) {
  if (!v) return 0;
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (v && typeof v === 'object' && Number.isFinite(v.$date)) return Number(v.$date);
  const raw = pickStr(v);
  const cnTs = parseChinaLocalDateTimeMs(raw);
  const ts = Number.isFinite(cnTs) ? cnTs : Date.parse(raw);
  return Number.isFinite(ts) ? ts : 0;
}

function formatMoneyFen(fen = 0) {
  const amountFen = Math.round(Number(fen) || 0);
  return (amountFen / 100).toFixed(2);
}

function formatDateTime(v) {
  const ts = toDateMs(v);
  if (!ts) return '';
  const d = new Date(ts + CHINA_TIME_OFFSET_MS);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mi = String(d.getUTCMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

function md5(text = '') {
  return crypto.createHash('md5').update(String(text || '')).digest('hex');
}

function getDrawRecordId(campaignId = '', openid = '') {
  return `draw_${md5(`${pickStr(campaignId)}:${pickStr(openid)}`)}`;
}

function getStatusText(status = '') {
  const map = {
    draft: '草稿',
    scheduled: '参与中',
    open: '开奖中',
    finished: '已结束',
    finished_partial: '部分结束',
    offline: '已下线',
    cancelled: '已作废',
  };
  return map[pickStr(status)] || '未知';
}

function getPayoutStatusText(status = '') {
  const map = {
    none: '',
    pending: '待发放',
    processing: '发放中',
    success: '已到账',
    failed: '发放失败',
  };
  return map[pickStr(status)] || '';
}

function computeEffectiveStatus(campaign = {}, nowMs = Date.now()) {
  const current = pickStr(campaign.status, 'draft');
  if (!campaign || !campaign._id) return current;
  if (['offline', 'cancelled', 'finished', 'finished_partial'].includes(current)) return current;
  if (current === 'draft') return 'draft';

  const progress = campaign.progress && typeof campaign.progress === 'object' ? campaign.progress : {};
  const drawAtMs = toDateMs(campaign.drawAt || campaign.endAt || campaign.openAt);
  if (progress.revealCompleted === true || toDateMs(progress.revealedAt) || toDateMs(campaign.revealedAt)) {
    return Number(progress.winCount || 0) < Number(campaign.winnerCount || 0) ? 'finished_partial' : 'finished';
  }
  if (drawAtMs && nowMs >= drawAtMs) return 'open';
  return 'scheduled';
}

function buildCampaignView(campaign = {}) {
  const progress = campaign.progress && typeof campaign.progress === 'object' ? campaign.progress : {};
  const effectiveStatus = computeEffectiveStatus(campaign);
  return {
    ...campaign,
    id: pickStr(campaign._id, campaign.id),
    effectiveStatus,
    statusText: getStatusText(effectiveStatus),
    totalAmountText: formatMoneyFen(campaign.totalAmountFen || 0),
    remainingAmountText: formatMoneyFen(progress.remainingAmountFen || 0),
    drawAtText: formatDateTime(campaign.drawAt || campaign.endAt || campaign.openAt),
    openAtText: formatDateTime(campaign.openAt),
    endAtText: formatDateTime(campaign.endAt),
    countdownMs: Math.max(0, toDateMs(campaign.drawAt || campaign.endAt || campaign.openAt) - Date.now()),
  };
}

function buildRecordView(doc = {}) {
  if (!doc || !doc._id) return null;
  const result = pickStr(doc.result);
  return {
    ...doc,
    id: pickStr(doc._id),
    amountText: formatMoneyFen(doc.amountFen || 0),
    payoutStatusText: getPayoutStatusText(doc.payoutStatus),
    drawAtText: formatDateTime(doc.drawAt),
    joinAtText: formatDateTime(doc.joinAt || doc.createdAt),
    resultTextResolved: pickStr(
      doc.resultText,
      result === 'pending'
        ? '已参与，等待开奖'
        : (
      result === 'win'
        ? `恭喜中奖 ¥${formatMoneyFen(doc.amountFen || 0)}`
        : '这次没有拆到奖金，下次活动见'
        )
    ),
  };
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

async function getUserByOpenid(openid = '') {
  const ownerOpenid = pickStr(openid);
  if (!ownerOpenid) return null;
  const res = await db.collection(USER_COLLECTION).where({ _openid: ownerOpenid }).limit(1).get();
  const list = (res && res.data) || [];
  return list[0] || null;
}

async function getDocById(collectionName = '', docId = '') {
  const name = pickStr(collectionName);
  const id = pickStr(docId);
  if (!name || !id) return null;
  try {
    const res = await db.collection(name).doc(id).get();
    return (res && res.data) || null;
  } catch (err) {
    return null;
  }
}

async function getDrawRecordByCampaignAndOpenid(campaignId = '', openid = '') {
  const targetCampaignId = pickStr(campaignId);
  const ownerOpenid = pickStr(openid);
  if (!targetCampaignId || !ownerOpenid) return null;
  return getDocById(DRAW_COLLECTION, getDrawRecordId(targetCampaignId, ownerOpenid));
}

function buildUserSnapshot(user = {}) {
  return {
    nickname: pickStr(user.nickname, user.name, '住户'),
    community: pickStr(user.community),
    building: pickStr(user.building),
    door: pickStr(user.door),
    avatarFileID: pickStr(user.avatarFileID),
  };
}

function validateReadyUser(user = {}) {
  if (!user || !user._id) return '未找到用户信息，请重新登录后重试';
  if (!user.realname) return '请先完成实名注册';
  if (pickStr(user._openid) === PLATFORM_ADMIN_OPENID) return '管理员账号不能参与活动';
  if (pickStr(user.huifu_open_status) !== 'success' || pickStr(user.user_busi_status) !== 'success') {
    return '当前账号收款未就绪，暂时无法参与活动';
  }
  return '';
}

async function maybePersistCampaignStatus(campaign = {}) {
  const effectiveStatus = computeEffectiveStatus(campaign);
  const current = pickStr(campaign.status);
  if (!campaign || !campaign._id || current === effectiveStatus) return effectiveStatus;
  if (['offline', 'cancelled', 'finished', 'finished_partial'].includes(current)) return current;
  const patch = {
    status: effectiveStatus,
    updatedAt: new Date(),
  };
  if (['finished', 'finished_partial'].includes(effectiveStatus)) patch.finishedAt = new Date();
  await db.collection(CAMPAIGN_COLLECTION).doc(campaign._id).update({ data: patch }).catch(() => null);
  return effectiveStatus;
}

function pickCurrentCampaign(campaigns = []) {
  const list = (Array.isArray(campaigns) ? campaigns : []).map(item => buildCampaignView(item));
  if (!list.length) return null;
  const open = list
    .filter(item => item.effectiveStatus === 'open')
    .sort((a, b) => toDateMs(a.drawAt || a.endAt || a.openAt) - toDateMs(b.drawAt || b.endAt || b.openAt));
  if (open.length) return open[0];
  const scheduled = list
    .filter(item => item.effectiveStatus === 'scheduled')
    .sort((a, b) => toDateMs(a.drawAt || a.endAt || a.openAt) - toDateMs(b.drawAt || b.endAt || b.openAt));
  if (scheduled.length) return scheduled[0];
  const recent = list
    .filter(item => ['finished', 'finished_partial'].includes(item.effectiveStatus))
    .sort((a, b) => toDateMs(b.finishedAt || b.updatedAt || b.drawAt || b.openAt) - toDateMs(a.finishedAt || a.updatedAt || a.drawAt || a.openAt));
  return recent[0] || null;
}

async function loadCandidateCampaigns(limit = 20) {
  const res = await db.collection(CAMPAIGN_COLLECTION)
    .where({
      status: _.in(['scheduled', 'open', 'finished', 'finished_partial'])
    })
    .field({
      _id: true,
      title: true,
      subtitle: true,
      description: true,
      totalAmountFen: true,
      winnerCount: true,
      amountMode: true,
      amountConfig: true,
      coverTheme: true,
      drawAt: true,
      endAt: true,
      openAt: true,
      progress: true,
      status: true,
      updatedAt: true,
      finishedAt: true,
      revealedAt: true,
      revealStatus: true,
      revealStartedAt: true,
      isDeleted: true,
    })
    .orderBy('updatedAt', 'desc')
    .limit(limit)
    .get();
  return ((res && res.data) || []).filter(item => item && item.isDeleted !== true);
}

async function createWinnerFeed(campaignId = '', limit = 20) {
  const targetCampaignId = pickStr(campaignId);
  if (!targetCampaignId) return [];
  const res = await db.collection(DRAW_COLLECTION)
    .where({ campaignId: targetCampaignId, result: 'win' })
    .field({
      _id: true,
      userSnapshot: true,
      amountFen: true,
      drawAt: true,
    })
    .orderBy('drawAt', 'desc')
    .limit(limit)
    .get();
  return ((res && res.data) || []).map(item => ({
    id: item._id,
    nickname: pickStr(item.userSnapshot && item.userSnapshot.nickname, '住户'),
    building: pickStr(item.userSnapshot && item.userSnapshot.building),
    amountText: formatMoneyFen(item.amountFen || 0),
    drawAtText: formatDateTime(item.drawAt),
  }));
}

function shouldLoadWinnerFeed(campaign = {}) {
  const effectiveStatus = pickStr(campaign.effectiveStatus, computeEffectiveStatus(campaign));
  return ['open', 'finished', 'finished_partial'].includes(effectiveStatus);
}

async function loadHistoryCampaigns(limit = 10, excludeCampaignId = '') {
  const safeLimit = clampInt(limit, 10, 0, 30);
  if (safeLimit <= 0) return [];
  const fetchLimit = Math.min(40, safeLimit + 8);
  const res = await db.collection(CAMPAIGN_COLLECTION)
    .where({
      status: _.in(['finished', 'finished_partial'])
    })
    .field({
      _id: true,
      title: true,
      subtitle: true,
      totalAmountFen: true,
      winnerCount: true,
      coverTheme: true,
      drawAt: true,
      endAt: true,
      openAt: true,
      progress: true,
      status: true,
      updatedAt: true,
      finishedAt: true,
      isDeleted: true,
    })
    .orderBy('updatedAt', 'desc')
    .limit(fetchLimit)
    .get();
  return ((res && res.data) || [])
    .filter(item => item && item.isDeleted !== true && pickStr(item._id) !== pickStr(excludeCampaignId))
    .map(item => buildCampaignView(item))
    .sort((a, b) => toDateMs(b.finishedAt || b.updatedAt || b.openAt) - toDateMs(a.finishedAt || a.updatedAt || a.openAt))
    .slice(0, safeLimit);
}

async function buildHomePayload(openid = '', historyLimit = 12) {
  const campaigns = await loadCandidateCampaigns(20);
  const currentCampaign = pickCurrentCampaign(campaigns);
  if (!currentCampaign) {
    return {
      campaign: null,
      myRecord: null,
      winnerFeed: [],
      historyItems: await loadHistoryCampaigns(historyLimit),
    };
  }

  await maybePersistCampaignStatus(currentCampaign);
  const campaignView = buildCampaignView(currentCampaign);
  const [myRecord, winnerFeed, historyItems] = await Promise.all([
    getDrawRecordByCampaignAndOpenid(currentCampaign._id, openid),
    shouldLoadWinnerFeed(campaignView) ? createWinnerFeed(currentCampaign._id, HOME_WINNER_FEED_LIMIT) : Promise.resolve([]),
    loadHistoryCampaigns(historyLimit, currentCampaign._id),
  ]);
  return {
    campaign: campaignView,
    myRecord: buildRecordView(myRecord),
    winnerFeed,
    historyItems,
  };
}

exports.main = async (event = {}) => {
  if (AUTO_CREATE_COLLECTIONS) {
    await Promise.all([
      ensureCollectionExists(CAMPAIGN_COLLECTION),
      ensureCollectionExists(DRAW_COLLECTION),
      ensureCollectionExists(PAYOUT_COLLECTION),
    ]);
  }

  const { OPENID } = cloud.getWXContext();
  const action = pickStr(event.action, 'get_activity_home');

  if (!OPENID) {
    return { ok: false, err: { code: 'NO_OPENID', msg: '获取用户身份失败' }, buildTag: BUILD_TAG };
  }

  const user = await getUserByOpenid(OPENID);
  if (!user || !user._id) {
    return { ok: false, err: { code: 'USER_NOT_FOUND', msg: '未找到用户信息，请重新登录后重试' }, buildTag: BUILD_TAG };
  }

  console.log('[activityUser] invoke', JSON.stringify({
    action,
    buildTag: BUILD_TAG,
    openid: OPENID,
  }));

  if (action === 'get_activity_home') {
    const payload = await buildHomePayload(OPENID, clampInt(event.historyLimit, 12, 0, 30));
    return {
      ok: true,
      campaign: payload.campaign,
      myRecord: payload.myRecord,
      winnerFeed: payload.winnerFeed,
      historyItems: payload.historyItems,
      buildTag: BUILD_TAG,
    };
  }

  if (action === 'get_current_campaign') {
    const payload = await buildHomePayload(OPENID, 0);
    return {
      ok: true,
      campaign: payload.campaign,
      myRecord: payload.myRecord,
      winnerFeed: payload.winnerFeed,
      buildTag: BUILD_TAG,
    };
  }

  if (action === 'get_campaign_detail') {
    const campaignId = pickStr(event.campaignId);
    const campaign = await getDocById(CAMPAIGN_COLLECTION, campaignId);
    if (!campaign || campaign.isDeleted === true) return { ok: false, err: { code: 'CAMPAIGN_NOT_FOUND', msg: '活动不存在' }, buildTag: BUILD_TAG };
    await maybePersistCampaignStatus(campaign);
    const campaignView = buildCampaignView(campaign);
    const [myRecord, winnerFeed] = await Promise.all([
      getDrawRecordByCampaignAndOpenid(campaignId, OPENID),
      shouldLoadWinnerFeed(campaignView) ? createWinnerFeed(campaignId, HOME_WINNER_FEED_LIMIT) : Promise.resolve([]),
    ]);
    return {
      ok: true,
      campaign: campaignView,
      myRecord: buildRecordView(myRecord),
      winnerFeed,
      buildTag: BUILD_TAG,
    };
  }

  if (action === 'get_my_record') {
    const campaignId = pickStr(event.campaignId);
    const record = await getDrawRecordByCampaignAndOpenid(campaignId, OPENID);
    return { ok: true, record: buildRecordView(record), buildTag: BUILD_TAG };
  }

  if (action === 'get_campaign_winners') {
    const campaignId = pickStr(event.campaignId);
    if (!campaignId) {
      return { ok: false, err: { code: 'MISSING_CAMPAIGN_ID', msg: '缺少活动ID' }, buildTag: BUILD_TAG };
    }
    const campaign = await getDocById(CAMPAIGN_COLLECTION, campaignId);
    if (!campaign || campaign.isDeleted === true) {
      return { ok: false, err: { code: 'CAMPAIGN_NOT_FOUND', msg: '活动不存在' }, buildTag: BUILD_TAG };
    }
    const items = await createWinnerFeed(campaignId, clampInt(event.limit, 50, 1, 200));
    return { ok: true, items, buildTag: BUILD_TAG };
  }

  if (action === 'get_history_campaigns') {
    const list = await loadHistoryCampaigns(clampInt(event.limit, 10, 0, 30));
    return { ok: true, items: list, buildTag: BUILD_TAG };
  }

  if (action === 'join_campaign') {
    const userReadyErr = validateReadyUser(user);
    if (userReadyErr) {
      return { ok: false, err: { code: 'USER_NOT_READY', msg: userReadyErr }, buildTag: BUILD_TAG };
    }

    const campaignId = pickStr(event.campaignId);
    if (!campaignId) {
      return { ok: false, err: { code: 'MISSING_CAMPAIGN_ID', msg: '缺少活动ID' }, buildTag: BUILD_TAG };
    }

    const recordId = getDrawRecordId(campaignId, OPENID);
    const existingRecord = await getDocById(DRAW_COLLECTION, recordId);
    if (existingRecord) {
      const campaign = await getDocById(CAMPAIGN_COLLECTION, campaignId);
      return {
        ok: true,
        already: true,
        campaign: campaign ? buildCampaignView(campaign) : null,
        myRecord: buildRecordView(existingRecord),
        buildTag: BUILD_TAG,
      };
    }

    const requestId = pickStr(event.requestId, md5(`${campaignId}:${OPENID}:${Date.now()}`));
    const txResult = await db.runTransaction(async (tx) => {
      let campaignDoc;
      try {
        const campaignRes = await tx.collection(CAMPAIGN_COLLECTION).doc(campaignId).get();
        campaignDoc = (campaignRes && campaignRes.data) || null;
      } catch (err) {
        return { ok: false, err: { code: 'CAMPAIGN_NOT_FOUND', msg: '活动不存在' } };
      }
      if (!campaignDoc || !campaignDoc._id) {
        return { ok: false, err: { code: 'CAMPAIGN_NOT_FOUND', msg: '活动不存在' } };
      }
      if (campaignDoc.isDeleted === true) {
        return { ok: false, err: { code: 'CAMPAIGN_NOT_FOUND', msg: '活动不存在' } };
      }

      let existingRecordDoc = null;
      try {
        const existingRes = await tx.collection(DRAW_COLLECTION).doc(recordId).get();
        existingRecordDoc = (existingRes && existingRes.data) || null;
      } catch (err) {
        existingRecordDoc = null;
      }
      if (existingRecordDoc && existingRecordDoc._id) {
        return { ok: true, already: true, record: existingRecordDoc, campaign: campaignDoc };
      }

      const effectiveStatus = computeEffectiveStatus(campaignDoc);
      if (effectiveStatus !== 'scheduled') {
        return {
          ok: false,
          err: {
            code: 'CAMPAIGN_NOT_JOINING',
            msg: effectiveStatus === 'open' ? '活动正在开奖，请稍后查看结果' : '活动已结束或已下线'
          },
          campaign: campaignDoc,
        };
      }

      const now = new Date();
      const progress = campaignDoc.progress && typeof campaignDoc.progress === 'object' ? campaignDoc.progress : {};
      const nextProgress = {
        ...progress,
        drawCount: Number(progress.drawCount || 0) + 1,
        participantCount: Number(progress.participantCount || progress.drawCount || 0) + 1,
        uniqueUserCount: Number(progress.uniqueUserCount || 0) + 1,
        updatedAt: now,
      };

      const drawRecord = {
        _id: recordId,
        campaignId,
        openid: OPENID,
        userId: pickStr(user._id, user.id),
        userHuifuId: pickStr(user.huifu_id, user.huifuId, user.huifuUserId, user.channelUserId),
        userSnapshot: buildUserSnapshot(user),
        result: 'pending',
        amountFen: 0,
        resultText: '已参与，等待开奖',
        payoutStatus: 'none',
        payoutLogId: '',
        requestId,
        joinAt: now,
        drawAt: null,
        createdAt: now,
        updatedAt: now,
      };
      const drawRecordPayload = { ...drawRecord };
      delete drawRecordPayload._id;
      await tx.collection(DRAW_COLLECTION).doc(recordId).set({ data: drawRecordPayload });
      await tx.collection(CAMPAIGN_COLLECTION).doc(campaignId).update({
        data: {
          progress: nextProgress,
          status: 'scheduled',
          updatedAt: now,
        }
      });

      return {
        ok: true,
        joined: true,
        record: drawRecord,
        campaign: {
          ...campaignDoc,
          progress: nextProgress,
          status: 'scheduled',
          updatedAt: now,
        },
      };
    });

    if (!txResult || !txResult.ok) {
      return { ...(txResult || { ok: false, err: { code: 'DRAW_FAILED', msg: '参与失败，请稍后重试' } }), buildTag: BUILD_TAG };
    }
    return {
      ok: true,
      campaign: buildCampaignView(txResult.campaign || {}),
      myRecord: buildRecordView(txResult.record),
      winnerFeed: [],
      buildTag: BUILD_TAG,
    };
  }

  return { ok: false, err: { code: 'UNSUPPORTED_ACTION', msg: `unsupported_action:${action}` }, buildTag: BUILD_TAG };
};
