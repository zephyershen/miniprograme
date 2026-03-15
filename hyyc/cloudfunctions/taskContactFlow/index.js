const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const TASK_COLLECTION = 'tasks';
const MSG_COLLECTION = 'messages';
const USER_COLLECTION = 'userInfo';

function pickStr(...vals) {
  for (const v of vals) {
    const s = String(v == null ? '' : v).trim();
    if (s) return s;
  }
  return '';
}

function randomId(len = 8) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < len; i += 1) {
    out += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return out;
}

function maskName(name = '') {
  const text = pickStr(name);
  if (!text) return '';
  if (text.length === 1) return text;
  if (text.length === 2) return `${text[0]}*`;
  return `${text[0]}${'*'.repeat(text.length - 2)}${text[text.length - 1]}`;
}

function maskPhone(phone = '') {
  const text = pickStr(phone).replace(/\s+/g, '');
  if (/^1\d{10}$/.test(text)) return `${text.slice(0, 3)}****${text.slice(7)}`;
  if (text.length >= 7) return `${text.slice(0, 3)}****${text.slice(-4)}`;
  return text;
}

async function getTaskById(taskId) {
  const res = await db.collection(TASK_COLLECTION).doc(taskId).get();
  return (res && res.data) || null;
}

async function getUserByOpenid(openid) {
  const id = pickStr(openid);
  if (!id) return null;
  const res = await db.collection(USER_COLLECTION).where({ _openid: id }).limit(1).get();
  const list = (res && res.data) || [];
  return list[0] || null;
}

function getParticipantRole(task = {}, openid = '') {
  const currentOpenid = pickStr(openid);
  if (!currentOpenid) return '';
  if (currentOpenid === pickStr(task._openid)) return 'owner';
  if (currentOpenid === pickStr(task.workerOpenid, task.worker_openid)) return 'worker';
  return '';
}

function getRoleUserId(task = {}, role = '') {
  return role === 'owner' ? pickStr(task.ownerId) : pickStr(task.workerId);
}

function getRoleOpenid(task = {}, role = '') {
  return role === 'owner' ? pickStr(task._openid) : pickStr(task.workerOpenid, task.worker_openid);
}

function getRoleDisplayName(task = {}, role = '') {
  if (role === 'owner') return pickStr(task.ownerNickname, task.ownerName, '发布者');
  return pickStr(task.workerNickname, task.workerName, '接单人');
}

function resolveTargetRole(task = {}, event = {}, requesterRole = '') {
  const explicitRole = pickStr(event.targetRole).toLowerCase();
  if (explicitRole === 'owner' || explicitRole === 'worker') return explicitRole;

  const targetUserId = pickStr(event.targetUserId, event.userId);
  if (targetUserId) {
    if (targetUserId === pickStr(task.ownerId)) return 'owner';
    if (targetUserId === pickStr(task.workerId)) return 'worker';
  }

  const targetOpenid = pickStr(event.targetOpenid, event.openid);
  if (targetOpenid) {
    if (targetOpenid === pickStr(task._openid)) return 'owner';
    if (targetOpenid === pickStr(task.workerOpenid, task.worker_openid)) return 'worker';
  }

  if (requesterRole === 'owner') return 'worker';
  if (requesterRole === 'worker') return 'owner';
  return '';
}

function isPhoneVisibleToViewer(task = {}, viewerRole = '', targetRole = '') {
  if (!viewerRole || !targetRole) return false;
  if (viewerRole === targetRole) return true;

  const access = task.contactAccess && typeof task.contactAccess === 'object' ? task.contactAccess : {};
  if (viewerRole === 'owner' && targetRole === 'worker') return access.workerPhoneVisibleToOwner === true;
  if (viewerRole === 'worker' && targetRole === 'owner') return access.ownerPhoneVisibleToWorker === true;
  return false;
}

function getAccessPatchForApproval(requesterRole = '', targetRole = '') {
  if (requesterRole === 'owner' && targetRole === 'worker') {
    return { workerPhoneVisibleToOwner: true };
  }
  if (requesterRole === 'worker' && targetRole === 'owner') {
    return { ownerPhoneVisibleToWorker: true };
  }
  return {};
}

function buildContactMessagePayload({ task = {}, request = {} }) {
  const req = request && typeof request === 'object' ? request : {};
  return {
    requestId: pickStr(req.requestId),
    status: pickStr(req.status),
    field: 'phone',
    requesterName: pickStr(req.requesterName),
    approverUserId: getRoleUserId(task, pickStr(req.targetRole)),
    approvedByName: pickStr(req.approvedByName),
    targetRole: pickStr(req.targetRole),
    targetUserId: pickStr(req.targetUserId),
  };
}

async function addContactRequestMessage({ task, request, now }) {
  const requesterRole = pickStr(request.requestedByRole);
  const messagePayload = buildContactMessagePayload({ task, request });
  const res = await db.collection(MSG_COLLECTION).add({
    data: {
      tid: pickStr(task._id),
      ownerId: pickStr(task.ownerId),
      peerUserId: pickStr(task.workerId),
      fromUserId: requesterRole === 'owner' ? pickStr(task.ownerId) : pickStr(task.workerId),
      fromNickname: pickStr(request.requesterName),
      type: 'contact_request',
      contactRequest: messagePayload,
      text: '',
      imageUrl: '',
      createTime: now,
      readByOwner: requesterRole === 'owner',
      readByPeer: requesterRole === 'worker',
    }
  });
  return pickStr(res && res._id);
}

async function syncContactRequestMessage(messageId, payload) {
  const id = pickStr(messageId);
  if (!id) return;
  await db.collection(MSG_COLLECTION).doc(id).update({
    data: {
      contactRequest: payload,
      updatedAt: new Date(),
    }
  });
}

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { ok: false, code: 'MISSING_OPENID', msg: '缺少 OPENID' };

  const action = pickStr(event.action);
  const taskId = pickStr(event.taskId, event.tid, event.id);
  if (!taskId) return { ok: false, code: 'MISSING_TASK_ID', msg: '缺少 taskId' };

  try {
    const now = new Date();
    const task = await getTaskById(taskId);
    if (!task) return { ok: false, code: 'TASK_NOT_FOUND', msg: '任务不存在' };

    const requesterRole = getParticipantRole(task, OPENID);
    if (!requesterRole) return { ok: false, code: 'NOT_TASK_PARTICIPANT', msg: '只有任务双方可以操作' };

    const targetRole = resolveTargetRole(task, event, requesterRole);
    if (!targetRole) return { ok: false, code: 'INVALID_TARGET_ROLE', msg: '缺少有效的 targetRole' };
    if (requesterRole === targetRole && action !== 'get_profile') {
      return { ok: false, code: 'INVALID_TARGET', msg: '不能申请查看自己的手机号' };
    }

    const targetOpenid = getRoleOpenid(task, targetRole);
    const targetUserId = getRoleUserId(task, targetRole);
    const targetUser = await getUserByOpenid(targetOpenid);
    const currentRequest = task.contactRequest && typeof task.contactRequest === 'object' ? task.contactRequest : {};
    const currentStatus = pickStr(currentRequest.status);
    const phoneVisible = isPhoneVisibleToViewer(task, requesterRole, targetRole);
    const pendingSameDirection = currentStatus === 'pending'
      && pickStr(currentRequest.requestedByRole) === requesterRole
      && pickStr(currentRequest.targetRole) === targetRole;
    const pendingAny = currentStatus === 'pending';

    if (action === 'get_profile') {
      const canRequestPhone = requesterRole !== targetRole
        && !phoneVisible
        && !pendingAny
        && !!targetUserId
        && !!targetOpenid;

      return {
        ok: true,
        profile: {
          taskId,
          targetRole,
          userId: targetUserId,
          openid: targetOpenid,
          nickname: pickStr(targetUser && targetUser.nickname, targetRole === 'owner' ? task.ownerNickname : task.workerNickname),
          nameMasked: maskName(pickStr(targetUser && targetUser.name, targetRole === 'owner' ? task.ownerName : task.workerName)),
          community: pickStr(targetUser && targetUser.community, task.community),
          building: pickStr(targetUser && targetUser.building, targetRole === 'owner' ? task.building : ''),
          door: pickStr(targetUser && targetUser.door, targetRole === 'owner' ? task.door : ''),
          avatarFileID: pickStr(targetUser && targetUser.avatarFileID, targetRole === 'owner' ? task.ownerAvatarFileID : task.workerAvatarFileID),
          avatarUrl: pickStr(targetUser && targetUser.avatarUrl),
          phoneMasked: maskPhone(targetUser && targetUser.phone),
          phone: phoneVisible ? pickStr(targetUser && targetUser.phone) : '',
          phoneVisible,
          canRequestPhone,
          phoneRequestStatus: phoneVisible ? 'approved' : (pendingSameDirection ? 'pending' : ''),
          phoneRequestId: pendingSameDirection ? pickStr(currentRequest.requestId) : '',
        }
      };
    }

    if (action === 'request_phone') {
      if (phoneVisible) {
        return { ok: true, already: true, status: 'approved', msg: '已可查看完整手机号' };
      }
      if (!targetUserId || !targetOpenid) {
        return { ok: false, code: 'TARGET_NOT_READY', msg: '对方信息缺失，暂时无法申请' };
      }
      if (pendingSameDirection) {
        return {
          ok: true,
          already: true,
          status: 'pending',
          requestId: pickStr(currentRequest.requestId),
          msg: '已发起申请，请等待对方同意',
        };
      }
      if (pendingAny) {
        return { ok: false, code: 'REQUEST_PENDING', msg: '当前已有待处理申请，请稍后再试' };
      }

      const requestId = `PR${Date.now()}${randomId(8)}`;
      const nextRequest = {
        requestId,
        field: 'phone',
        status: 'pending',
        requestedAt: now,
        requestedByOpenid: OPENID,
        requestedByUserId: getRoleUserId(task, requesterRole),
        requestedByRole: requesterRole,
        requesterName: getRoleDisplayName(task, requesterRole),
        targetRole,
        targetUserId,
        targetOpenid,
      };

      const messageId = await addContactRequestMessage({ task, request: nextRequest, now });

      await db.collection(TASK_COLLECTION).doc(taskId).update({
        data: {
          contactRequest: {
            ...nextRequest,
            messageId,
          },
          updatedAt: now,
        }
      });

      return {
        ok: true,
        status: 'pending',
        requestId,
        messageId,
        msg: '已发起申请，请等待对方同意',
      };
    }

    if (action === 'approve_phone') {
      const requestId = pickStr(event.requestId);
      if (!requestId) return { ok: false, code: 'MISSING_REQUEST_ID', msg: '缺少 requestId' };
      if (pickStr(currentRequest.requestId) !== requestId || currentStatus !== 'pending') {
        return { ok: false, code: 'INVALID_REQUEST', msg: '申请不存在或已处理' };
      }
      if (pickStr(currentRequest.targetRole) !== requesterRole) {
        return { ok: false, code: 'NOT_APPROVER', msg: '只有被查看手机号的一方可以同意' };
      }

      const accessPatch = getAccessPatchForApproval(
        pickStr(currentRequest.requestedByRole),
        pickStr(currentRequest.targetRole)
      );
      const nextRequest = {
        ...currentRequest,
        status: 'approved',
        approvedAt: now,
        approvedByOpenid: OPENID,
        approvedByUserId: getRoleUserId(task, requesterRole),
        approvedByRole: requesterRole,
        approvedByName: getRoleDisplayName(task, requesterRole),
      };

      await db.collection(TASK_COLLECTION).doc(taskId).update({
        data: {
          contactAccess: {
            ...((task.contactAccess && typeof task.contactAccess === 'object') ? task.contactAccess : {}),
            ...accessPatch,
            updatedAt: now,
          },
          contactRequest: nextRequest,
          updatedAt: now,
        }
      });

      await syncContactRequestMessage(
        pickStr(currentRequest.messageId),
        buildContactMessagePayload({ task, request: nextRequest })
      );

      return { ok: true, status: 'approved', requestId, msg: '已同意查看手机号' };
    }

    return { ok: false, code: 'UNSUPPORTED_ACTION', msg: `unsupported_action: ${action}` };
  } catch (err) {
    console.error('[taskContactFlow] failed', err);
    return {
      ok: false,
      code: 'TASK_CONTACT_FLOW_ERROR',
      msg: err && err.message ? err.message : '手机号申请流程失败',
    };
  }
};
