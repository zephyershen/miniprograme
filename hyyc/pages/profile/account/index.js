const { toast, confirm } = require('../../../utils/ui');
const { getStoredUser, patchStoredUser, setStoredUser } = require('../../../utils/userIdentity');
const { isPlatformAdminUser } = require('../../../utils/platformAdmin');

const db = wx.cloud.database();
const USER_COLLECTION = 'userInfo';
const RESET_CONFIRM_TEXT = 'CLEAR_TEST_DATA';

function pickStr(...vals) {
  for (const v of vals) {
    const s = String(v == null ? '' : v).trim();
    if (s) return s;
  }
  return '';
}

function stringifyResult(v) {
  try {
    return JSON.stringify(v, null, 2);
  } catch (err) {
    return String(v == null ? '' : v);
  }
}

Page({
  data: {
    isLoading: true,
    isSuperAdmin: false,
    userDocId: '',
    form: {
      nickname: '',
      building: '',
      floor: '',
      door: ''
    },
    financeForm: {
      username: '',
      password: '',
      limit: '30',
    },
    identityRepairForm: {
      username: '',
      password: '',
      scanLimit: '500',
    },
    resetDataForm: {
      username: '',
      password: '',
      scanLimit: '2000',
      confirmText: '',
      includeFiles: true,
    },
    restoreForm: {
      targetOpenid: '',
      targetPhone: '',
      targetHuifuId: '',
    },
    financeRunning: '',
    financeResultText: '',
    identityRepairRunning: '',
    identityRepairResultText: '',
    resetDataRunning: '',
    resetDataResultText: '',
    restoreRunning: '',
    restoreResultText: '',
    legalDocsRunning: false,
    legalDocsResultText: '',
    buildingRange: [],
    buildingIndex: 0,
    doorRange: [[], []],
    doorIndex: [0, 0],
    MAX_FLOOR: 33
  },

  onLoad() {
    const buildings = Array.from({ length: 23 }, (_, i) => `${i + 1}栋`);
    const floors = Array.from({ length: this.data.MAX_FLOOR }, (_, i) => `${i + 1}楼`);
    const rooms = ['01户', '02户', '03户', '04户'];
    this.setData({ buildingRange: buildings, doorRange: [floors, rooms] });
  },

  async onShow() {
    this.setData({ isLoading: true });
    let u = getStoredUser();
    const openid = await this._ensureOpenid();
    if (openid) {
      try {
        const queryRes = await db.collection(USER_COLLECTION).where({ _openid: openid }).limit(1).get();
        const list = (queryRes && queryRes.data) || [];
        if (list.length) {
          const doc = list[0];
          const isSuperAdmin = isPlatformAdminUser(doc) || !!u.isSuperAdmin;
          u = { ...doc, id: doc._id || doc.id, isSuperAdmin };
          setStoredUser(u);
        }
      } catch (err) {
        console.warn('读取最新账户信息失败，继续使用缓存', err);
      }
    }

    const buildings = this.data.buildingRange || [];
    let buildingIndex = 0;
    if (u.building) {
      const idx = buildings.indexOf(u.building);
      if (idx >= 0) buildingIndex = idx;
    }

    const floorNum = Number(u.floor || (u.door ? String(u.door).slice(0, -2) : 1)) || 1;
    const roomNo = Number(u.door ? String(u.door).slice(-2) : 1) || 1;
    const floorIdx = Math.max(0, Math.min(this.data.MAX_FLOOR - 1, floorNum - 1));
    const roomIdx = Math.max(0, Math.min(3, roomNo - 1));

    this.setData({
      isSuperAdmin: isPlatformAdminUser(u) || !!u.isSuperAdmin,
      form: {
        nickname: u.nickname || '',
        building: u.building || '',
        floor: u.floor || String(floorNum),
        door: u.door || (floorNum + roomNo.toString().padStart(2, '0'))
      },
      userDocId: pickStr(u.id, u._id),
      buildingIndex,
      doorIndex: [floorIdx, roomIdx],
      isLoading: false
    });
  },

  onInput(e) {
    const key = e.currentTarget.dataset.key;
    const value = e.detail.value;
    this.setData({ [`form.${key}`]: value });
  },

  onBuildingChange(e) {
    const idx = Number(e.detail.value || 0);
    const val = this.data.buildingRange[idx];
    this.setData({
      buildingIndex: idx,
      'form.building': val
    });
  },

  onFinanceInput(e) {
    const key = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.key;
    if (!key) return;
    const value = e && e.detail ? e.detail.value : '';
    this.setData({ [`financeForm.${key}`]: value });
  },

  onIdentityRepairInput(e) {
    const key = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.key;
    if (!key) return;
    const value = e && e.detail ? e.detail.value : '';
    this.setData({ [`identityRepairForm.${key}`]: value });
  },

  onResetDataInput(e) {
    const key = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.key;
    if (!key) return;
    const value = e && e.detail ? e.detail.value : '';
    this.setData({ [`resetDataForm.${key}`]: value });
  },

  onResetDataToggleFiles(e) {
    const checked = !!(e && e.detail && e.detail.value);
    this.setData({ 'resetDataForm.includeFiles': checked });
  },

  onRestoreInput(e) {
    const key = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.key;
    if (!key) return;
    const value = e && e.detail ? e.detail.value : '';
    this.setData({ [`restoreForm.${key}`]: value });
  },

  onDoorChange(e) {
    const value = e.detail.value || [0, 0];
    const fi = Number(value[0] || 0);
    const ui = Number(value[1] || 0);
    const floorNum = fi + 1;
    const roomNo = (ui + 1).toString().padStart(2, '0');
    const door = `${floorNum}${roomNo}`;
    this.setData({
      doorIndex: [fi, ui],
      'form.floor': `${floorNum}`,
      'form.door': door
    });
  },

  async onSave() {
    const f = this.data.form;

    this.setData({ isLoading: true });

    try {
      const docId = await this._resolveUserDocId();
      if (!docId) {
        toast('未找到用户记录，请稍后重试');
        return;
      }

      await db.collection(USER_COLLECTION).doc(docId).update({
        data: {
          nickname: f.nickname,
          building: f.building,
          floor: f.floor,
          door: f.door
        }
      });

      const cached = getStoredUser();
      setStoredUser({
        ...cached,
        id: docId,
        nickname: f.nickname,
        building: f.building,
        floor: f.floor,
        door: f.door
      });

      toast('已保存');
    } catch (err) {
      console.error('更新账户信息失败', err);
      toast('保存失败，请稍后重试');
    } finally {
      this.setData({ isLoading: false });
    }
  },

  async onFinanceDryRunTap() {
    await this._runFinanceCompensate(true);
  },

  async onFinanceRunTap() {
    await this._runFinanceCompensate(false);
  },

  async onIdentityRepairDryRunTap() {
    await this._runIdentityRepair(true);
  },

  async onIdentityRepairRunTap() {
    await this._runIdentityRepair(false);
  },

  async onResetDataDryRunTap() {
    await this._runResetTestData(true);
  },

  async onResetDataRunTap() {
    await this._runResetTestData(false);
  },

  async onRestorePreviewTap() {
    await this._runRestoreHuifuPreview();
  },

  async onRestoreApplyTap() {
    const proceed = await confirm('恢复后，这个用户的钱包顶部余额和提现能力会切回旧收款账号。确认继续吗？');
    if (!proceed) return;
    await this._runRestoreHuifuApply();
  },

  async onSyncLegalDocsTap() {
    if (!this.data.isSuperAdmin) {
      toast('仅管理员可用');
      return;
    }
    if (this.data.legalDocsRunning) return;

    this.setData({
      legalDocsRunning: true,
      legalDocsResultText: `准备同步协议文案...\n时间=${new Date().toLocaleString()}`
    });
    wx.showLoading({ title: '同步中...', mask: true });

    try {
      const res = await wx.cloud.callFunction({
        name: 'adminLegalDocsSync',
        data: {
          action: 'sync_default_docs',
        }
      });
      const ret = (res && res.result) || res || null;
      console.log('[account] adminLegalDocsSync result', ret);
      this.setData({
        legalDocsResultText: stringifyResult({
          calledAt: new Date().toISOString(),
          ret,
        })
      });
      if (ret && ret.ok) {
        toast('协议已同步');
      } else {
        toast(pickStr(ret && ret.msg, '同步失败'));
      }
    } catch (err) {
      console.error('[account] adminLegalDocsSync failed', err);
      this.setData({
        legalDocsResultText: stringifyResult({
          calledAt: new Date().toISOString(),
          error: pickStr(err && err.message, err),
        })
      });
      toast('调用失败，请查看结果区');
    } finally {
      wx.hideLoading();
      this.setData({ legalDocsRunning: false });
    }
  },

  async _runRestoreHuifuPreview() {
    if (!this.data.isSuperAdmin) {
      toast('仅管理员可用');
      return;
    }
    if (this.data.restoreRunning) return;

    const form = this.data.restoreForm || {};
    const targetOpenid = pickStr(form.targetOpenid);
    const targetPhone = pickStr(form.targetPhone);
    const targetHuifuId = pickStr(form.targetHuifuId);
    if (!targetOpenid && !targetPhone) {
      toast('请先输入用户 openid 或手机号');
      return;
    }

    this.setData({
      restoreRunning: 'preview',
      restoreResultText: `准备查找旧收款账号...\n时间=${new Date().toLocaleString()}`
    });
    wx.showLoading({ title: '查找中...', mask: true });

    try {
      const res = await wx.cloud.callFunction({
        name: 'adminRestoreUserAccount',
        data: {
          action: 'preview_restore',
          targetOpenid,
          targetPhone,
          manualHuifuId: targetHuifuId,
        }
      });
      const ret = (res && res.result) || res || null;
      console.log('[account] adminRestoreUserAccount preview result', ret);
      this.setData({
        restoreResultText: stringifyResult({
          calledAt: new Date().toISOString(),
          action: 'preview_restore',
          ret,
        })
      });
      if (ret && ret.ok) {
        const recommended = pickStr(ret.preview && ret.preview.recommendedHuifuId);
        if (recommended && !targetHuifuId) {
          this.setData({ 'restoreForm.targetHuifuId': recommended });
        }
        toast(recommended ? '已找到推荐旧账号' : '已完成预检查');
      } else {
        toast(pickStr(ret && ret.msg, '查找失败'));
      }
    } catch (err) {
      console.error('[account] adminRestoreUserAccount preview failed', err);
      this.setData({
        restoreResultText: stringifyResult({
          calledAt: new Date().toISOString(),
          action: 'preview_restore',
          error: pickStr(err && err.message, err),
        })
      });
      toast('调用失败，请查看结果区');
    } finally {
      wx.hideLoading();
      this.setData({ restoreRunning: '' });
    }
  },

  async _runRestoreHuifuApply() {
    if (!this.data.isSuperAdmin) {
      toast('仅管理员可用');
      return;
    }
    if (this.data.restoreRunning) return;

    const form = this.data.restoreForm || {};
    const targetOpenid = pickStr(form.targetOpenid);
    const targetPhone = pickStr(form.targetPhone);
    const targetHuifuId = pickStr(form.targetHuifuId);
    if (!targetOpenid && !targetPhone) {
      toast('请先输入用户 openid 或手机号');
      return;
    }

    this.setData({
      restoreRunning: 'apply',
      restoreResultText: `准备恢复旧收款账号...\n时间=${new Date().toLocaleString()}`
    });
    wx.showLoading({ title: '恢复中...', mask: true });

    try {
      const res = await wx.cloud.callFunction({
        name: 'adminRestoreUserAccount',
        data: {
          action: 'apply_restore',
          targetOpenid,
          targetPhone,
          targetHuifuId,
        }
      });
      const ret = (res && res.result) || res || null;
      console.log('[account] adminRestoreUserAccount apply result', ret);
      this.setData({
        restoreResultText: stringifyResult({
          calledAt: new Date().toISOString(),
          action: 'apply_restore',
          ret,
        })
      });
      if (ret && ret.ok) {
        const restored = pickStr(ret && ret.restoredHuifuId);
        if (restored) this.setData({ 'restoreForm.targetHuifuId': restored });
        toast(ret.noChange ? '当前已经是这个账号' : '恢复成功');
      } else {
        toast(pickStr(ret && ret.msg, '恢复失败'));
      }
    } catch (err) {
      console.error('[account] adminRestoreUserAccount apply failed', err);
      this.setData({
        restoreResultText: stringifyResult({
          calledAt: new Date().toISOString(),
          action: 'apply_restore',
          error: pickStr(err && err.message, err),
        })
      });
      toast('调用失败，请查看结果区');
    } finally {
      wx.hideLoading();
      this.setData({ restoreRunning: '' });
    }
  },

  async _runFinanceCompensate(dryRun) {
    if (!this.data.isSuperAdmin) {
      toast('仅管理员可用');
      return;
    }
    if (this.data.financeRunning) return;

    const financeForm = this.data.financeForm || {};
    const username = pickStr(financeForm.username);
    const password = pickStr(financeForm.password);
    const limit = Math.max(1, Math.min(200, Number(financeForm.limit) || 30));
    if (!username || !password) {
      toast('请输入管理员账号和密码');
      return;
    }

    const financeRunning = dryRun ? 'dryRun' : 'run';
    const title = dryRun ? '预检查中...' : '执行补偿中...';
    this.setData({
      financeRunning,
      financeResultText: `${dryRun ? '准备执行预检查' : '准备执行真实补偿'}...\nlimit=${limit}\n时间=${new Date().toLocaleString()}`,
    });
    wx.showLoading({ title, mask: true });

    try {
      const res = await wx.cloud.callFunction({
        name: 'adminFinanceCompensate',
        data: {
          username,
          password,
          action: 'run_all',
          dryRun: !!dryRun,
          limit,
        }
      });
      const ret = (res && res.result) || res || null;
      console.log('[account] adminFinanceCompensate result', ret);

      const output = {
        calledAt: new Date().toISOString(),
        dryRun: !!dryRun,
        limit,
        ret,
      };
      this.setData({
        financeResultText: stringifyResult(output),
      });

      if (ret && ret.ok) {
        toast(dryRun ? '预检查完成' : '补偿执行完成');
      } else {
        toast(pickStr(ret && ret.msg, ret && ret.financeResult && ret.financeResult.msg, '补偿执行失败'));
      }
    } catch (err) {
      console.error('[account] adminFinanceCompensate failed', err);
      this.setData({
        financeResultText: stringifyResult({
          calledAt: new Date().toISOString(),
          dryRun: !!dryRun,
          limit,
          error: pickStr(err && err.message, err),
        }),
      });
      toast('调用失败，请查看结果区和日志');
    } finally {
      wx.hideLoading();
      this.setData({ financeRunning: '' });
    }
  },

  async _runIdentityRepair(dryRun) {
    if (!this.data.isSuperAdmin) {
      toast('仅管理员可用');
      return;
    }
    if (this.data.identityRepairRunning) return;

    const repairForm = this.data.identityRepairForm || {};
    const username = pickStr(repairForm.username);
    const password = pickStr(repairForm.password);
    const scanLimit = Math.max(1, Math.min(5000, Number(repairForm.scanLimit) || 500));
    if (!username || !password) {
      toast('请输入管理员账号和密码');
      return;
    }

    const identityRepairRunning = dryRun ? 'dryRun' : 'run';
    const title = dryRun ? '预检查中...' : '执行修复中...';
    this.setData({
      identityRepairRunning,
      identityRepairResultText: `${dryRun ? '准备执行身份数据预检查' : '准备执行身份数据修复'}...\nscanLimit=${scanLimit}\n时间=${new Date().toLocaleString()}`,
    });
    wx.showLoading({ title, mask: true });

    try {
      const res = await wx.cloud.callFunction({
        name: 'adminRepairUserIdentity',
        data: {
          username,
          password,
          dryRun: !!dryRun,
          scanLimit,
        }
      });
      const ret = (res && res.result) || res || null;
      console.log('[account] adminRepairUserIdentity result', ret);

      const output = {
        calledAt: new Date().toISOString(),
        dryRun: !!dryRun,
        scanLimit,
        ret,
      };
      this.setData({
        identityRepairResultText: stringifyResult(output),
      });

      if (ret && ret.ok) {
        toast(dryRun ? '预检查完成' : '修复执行完成');
      } else {
        toast(pickStr(ret && ret.msg, '执行失败'));
      }
    } catch (err) {
      console.error('[account] adminRepairUserIdentity failed', err);
      this.setData({
        identityRepairResultText: stringifyResult({
          calledAt: new Date().toISOString(),
          dryRun: !!dryRun,
          scanLimit,
          error: pickStr(err && err.message, err),
        }),
      });
      toast('调用失败，请查看结果区和日志');
    } finally {
      wx.hideLoading();
      this.setData({ identityRepairRunning: '' });
    }
  },

  async _runResetTestData(dryRun) {
    if (!this.data.isSuperAdmin) {
      toast('仅管理员可用');
      return;
    }
    if (this.data.resetDataRunning) return;

    const resetForm = this.data.resetDataForm || {};
    const username = pickStr(resetForm.username);
    const password = pickStr(resetForm.password);
    const scanLimit = Math.max(1, Math.min(20000, Number(resetForm.scanLimit) || 2000));
    const confirmText = pickStr(resetForm.confirmText);
    const includeFiles = resetForm.includeFiles !== false;
    if (!username || !password) {
      toast('请输入管理员账号和密码');
      return;
    }
    if (!dryRun && confirmText !== RESET_CONFIRM_TEXT) {
      toast(`请输入确认口令：${RESET_CONFIRM_TEXT}`);
      return;
    }

    const resetDataRunning = dryRun ? 'dryRun' : 'run';
    const title = dryRun ? '预检查中...' : '执行清空中...';
    this.setData({
      resetDataRunning,
      resetDataResultText: `${dryRun ? '准备执行测试数据预检查' : '准备执行测试数据清空'}...\nscanLimit=${scanLimit}\nincludeFiles=${includeFiles}\n时间=${new Date().toLocaleString()}`,
    });
    wx.showLoading({ title, mask: true });

    try {
      const res = await wx.cloud.callFunction({
        name: 'adminResetTestData',
        data: {
          username,
          password,
          dryRun: !!dryRun,
          scanLimit,
          includeFiles,
          confirmText,
        }
      });
      const ret = (res && res.result) || res || null;
      console.log('[account] adminResetTestData result', ret);

      const output = {
        calledAt: new Date().toISOString(),
        dryRun: !!dryRun,
        scanLimit,
        includeFiles,
        ret,
      };
      this.setData({
        resetDataResultText: stringifyResult(output),
      });

      if (ret && ret.ok) {
        toast(dryRun ? '预检查完成' : '测试数据已清空');
      } else {
        toast(pickStr(ret && ret.msg, '执行失败'));
      }
    } catch (err) {
      console.error('[account] adminResetTestData failed', err);
      this.setData({
        resetDataResultText: stringifyResult({
          calledAt: new Date().toISOString(),
          dryRun: !!dryRun,
          scanLimit,
          includeFiles,
          error: pickStr(err && err.message, err),
        }),
      });
      toast('调用失败，请查看结果区和日志');
    } finally {
      wx.hideLoading();
      this.setData({ resetDataRunning: '' });
    }
  },

  async _ensureOpenid() {
    const u = getStoredUser();
    let openid = pickStr(u._openid, u.openid, u.openId);
    if (openid) return openid;
    try {
      const res = await wx.cloud.callFunction({ name: 'login' });
      openid = pickStr(res && res.result && res.result.openid);
      if (openid) patchStoredUser({ _openid: openid });
    } catch (e) {
      openid = '';
    }
    return openid;
  },

  async _resolveUserDocId() {
    const cached = getStoredUser();
    const cachedDocId = pickStr(this.data.userDocId, cached.id, cached._id);
    if (cachedDocId) return cachedDocId;

    const openid = await this._ensureOpenid();
    if (!openid) return '';

    const queryRes = await db.collection(USER_COLLECTION).where({ _openid: openid }).limit(1).get();
    const list = (queryRes && queryRes.data) || [];
    if (!list.length) return '';

    const doc = list[0];
    const docId = pickStr(doc._id, doc.id);
    const nextUser = { ...cached, ...doc, id: docId, isSuperAdmin: isPlatformAdminUser(doc) || !!cached.isSuperAdmin };
    this.setData({ userDocId: docId });
    setStoredUser(nextUser);
    return docId;
  }
});
