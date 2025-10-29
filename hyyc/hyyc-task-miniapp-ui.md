# HYYC 小区任务平台（前端 UI 汇编）

说明：本文件收录整个小程序的“前端 UI 代码”（页面结构、样式、交互逻辑的空实现/桩函数），遵循简洁、留白、细边框的 shadcn 风格（干净、轻阴影、圆角）。代码中的英文标识保持原样；每个模块前附简要中文说明，尽量不用专业词，必要时括号解释。

使用方式（建议）：
- 在项目根目录按“路径注释”创建对应文件，把代码块完整粘贴。
- 若你希望一次性验证 UI，可在微信开发者工具里以本结构新建项目，然后逐一复制。

目录索引（建议的文件结构）：
- `app.json`, `app.js`, `app.wxss`
- `styles/shadcn.wxss`（UI 基础样式）
- `utils/format.js`, `utils/validators.js`, `utils/mock.js`, `utils/ui.js`
- 组件（components）
  - `components/ui/button/`（按钮）
  - `components/ui/card/`（卡片）
  - `components/ui/field/`（表单项：标签+输入）
  - `components/chat/bubble/`（聊天气泡）
- 页面（pages）
  - `pages/auth/realname/`（实名注册）
  - `pages/home/index/`（首页任务流）
  - `pages/task/publish/`（发布任务）
  - `pages/task/detail/`（任务详情）
  - `pages/task/submit/`（提交验收）
  - `pages/chat/room/`（聊天）
  - `pages/wallet/index/`（钱包）
  - `pages/profile/index/`（我的）
  - `pages/my/tasks/`（我的任务）

— 以下为全部代码清单 —

```json
// path: app.json
{
  "pages": [
    "pages/home/index/index",
    "pages/auth/realname/index",
    "pages/task/publish/index",
    "pages/task/detail/index",
    "pages/task/submit/index",
    "pages/chat/room/index",
    "pages/wallet/index/index",
    "pages/profile/index/index",
    "pages/my/tasks/index"
  ],
  "window": {
    "navigationBarTitleText": "HYYC 小区任务",
    "navigationBarBackgroundColor": "#ffffff",
    "navigationBarTextStyle": "black",
    "backgroundColor": "#f6f7f9",
    "backgroundTextStyle": "dark"
  },
  "style": "v2",
  "sitemapLocation": "sitemap.json",
  "tabBar": {
    "color": "#6b7280",
    "selectedColor": "#111827",
    "backgroundColor": "#ffffff",
    "borderStyle": "black",
    "list": [
      {
        "pagePath": "pages/home/index/index",
        "text": "首页",
        "iconPath": "assets/tab-home.png",
        "selectedIconPath": "assets/tab-home-active.png"
      },
      {
        "pagePath": "pages/task/publish/index",
        "text": "发布",
        "iconPath": "assets/tab-plus.png",
        "selectedIconPath": "assets/tab-plus.png"
      },
      {
        "pagePath": "pages/profile/index/index",
        "text": "我的",
        "iconPath": "assets/tab-user.png",
        "selectedIconPath": "assets/tab-user-active.png"
      }
    ]
  },
  "usingComponents": {}
}
```

```css
/* path: app.wxss */
@import "styles/shadcn.wxss";

page { background: #f6f7f9; }

.safe { padding-bottom: env(safe-area-inset-bottom); }
```

```js
// path: app.js
App({
  onLaunch() {
    // 这里只做 UI 演示相关的初始化提示
    console.log('HYYC UI app launch');
  },
  globalData: {
    user: null, // 实名信息（UI 阶段用假数据）
    community: null
  }
});
```

```css
/* path: styles/shadcn.wxss */
/*
  简介：shadcn 风格（简洁、留白、细边框、圆角、轻阴影）
  约定：通过类名组合实现外观，不依赖 CSS 变量，兼容性更稳。
*/

/* 色板 */
.c-text { color: #111827; }
.c-muted { color: #6b7280; }
.c-primary { color: #111827; }
.c-danger { color: #b91c1c; }
.bg-page { background: #f6f7f9; }
.bg-card { background: #ffffff; }
.bg-primary { background: #111827; }
.bg-muted { background: #f3f4f6; }
.bg-danger { background: #ef4444; }

/* 边框与圆角 */
.b { border: 1px solid #e5e7eb; }
.br { border-radius: 12rpx; }
.br-full { border-radius: 9999rpx; }

/* 阴影（轻） */
.shadow-sm { box-shadow: 0 2rpx 8rpx rgba(0,0,0,0.06); }

/* 间距（rpx 简单分档） */
.p-12 { padding: 12rpx; }
.p-16 { padding: 16rpx; }
.p-20 { padding: 20rpx; }
.p-24 { padding: 24rpx; }
.px-24 { padding-left: 24rpx; padding-right: 24rpx; }
.py-16 { padding-top: 16rpx; padding-bottom: 16rpx; }
.m-16 { margin: 16rpx; }
.mt-12 { margin-top: 12rpx; }
.mt-16 { margin-top: 16rpx; }
.mt-20 { margin-top: 20rpx; }
.mb-16 { margin-bottom: 16rpx; }
.gap-12 > view + view { margin-top: 12rpx; }
.row-gap-8 > view + view { margin-left: 8rpx; }

/* 布局 */
.row { display: flex; flex-direction: row; align-items: center; }
.col { display: flex; flex-direction: column; }
.center { display: flex; align-items: center; justify-content: center; }
.space-between { justify-content: space-between; }
.wrap { flex-wrap: wrap; }

/* 文字 */
.text-sm { font-size: 24rpx; }
.text-base { font-size: 28rpx; }
.text-lg { font-size: 32rpx; }
.text-xl { font-size: 36rpx; }
.bold { font-weight: 600; }

/* 按钮基类 */
.btn { height: 88rpx; line-height: 88rpx; padding: 0 28rpx; border-radius: 12rpx; border: 1px solid #e5e7eb; background: #fff; color: #111827; }
.btn:active { opacity: 0.9; }
.btn-primary { background: #111827; color: #fff; border-color: #111827; }
.btn-outline { background: #fff; color: #111827; }
.btn-ghost { background: transparent; border-color: transparent; color: #111827; }
.btn-danger { background: #ef4444; border-color: #ef4444; color: #fff; }
.btn-sm { height: 64rpx; line-height: 64rpx; padding: 0 20rpx; }

/* 输入框 */
.field { display: flex; flex-direction: column; }
.field-label { font-size: 26rpx; color: #6b7280; margin-bottom: 8rpx; }
.input, .textarea { background: #fff; border: 1px solid #e5e7eb; border-radius: 12rpx; padding: 20rpx; }
.textarea { height: 220rpx; }

/* 卡片 */
.card { background: #fff; border: 1px solid #e5e7eb; border-radius: 16rpx; padding: 24rpx; box-shadow: 0 2rpx 8rpx rgba(0,0,0,0.04); }
.card-title { font-size: 32rpx; font-weight: 600; color: #111827; }
.card-sub { font-size: 24rpx; color: #6b7280; }

/* 徽标 */
.badge { font-size: 22rpx; padding: 4rpx 12rpx; border-radius: 9999rpx; border: 1px solid #e5e7eb; background: #fff; color: #111827; }
.badge-primary { background: #111827; color: #fff; border-color: #111827; }
.badge-danger { background: #ef4444; color: #fff; border-color: #ef4444; }

/* 头像 */
.avatar { width: 64rpx; height: 64rpx; border-radius: 9999rpx; background: #e5e7eb; }

/* 其他 */
.divider { height: 1px; background: #e5e7eb; margin: 16rpx 0; }
```

```js
// path: utils/format.js
// 简单格式化：金额、日期等
function formatMoney(n) {
  const num = Number(n || 0);
  return num.toFixed(2);
}

function formatDate(ts) {
  const d = new Date(ts);
  const mm = `${d.getMonth()+1}`.padStart(2,'0');
  const dd = `${d.getDate()}`.padStart(2,'0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

module.exports = { formatMoney, formatDate };
```

```js
// path: utils/validators.js
// 表单校验（简单必填 + 格式）
function required(v, msg) {
  if (v === undefined || v === null || String(v).trim() === '') {
    return msg || '请填写必填项';
  }
  return '';
}

function isPhone(v) {
  if (!/^1\d{10}$/.test(String(v || ''))) return '手机号格式不正确';
  return '';
}

function isIdNumber(v) {
  // 简单校验位数
  if (!/^\d{15}|\d{17}[0-9Xx]$/.test(String(v || ''))) return '身份证号格式不正确';
  return '';
}

module.exports = { required, isPhone, isIdNumber };
```

```js
// path: utils/ui.js
// UI 小工具：toast/confirm 等
function toast(title, icon='none') { wx.showToast({ title, icon }); }
function confirm(content, title='提示') {
  return new Promise((resolve) => {
    wx.showModal({ title, content, success: (res) => resolve(!!res.confirm) });
  });
}
module.exports = { toast, confirm };
```

```js
// path: utils/mock.js
// 本文件仅用于 UI 联调的假数据
const tasks = [
  {
    id: 't1',
    title: '帮忙取快递',
    amount: 8.8,
    deadline: Date.now() + 86400000,
    community: '海悦花园A区',
    address: '3栋 门口快递柜',
    desc: '中通 2 个包裹，麻烦尽快~',
    images: [],
    owner: { id: 'u1', name: '王阿姨' },
    status: 'posted' // posted/accepted/doing/submitted/done/cancelled
  },
  {
    id: 't2',
    title: '临时浇花',
    amount: 20,
    deadline: Date.now() + 2*86400000,
    community: '海悦花园A区',
    address: '5栋 1202',
    desc: '阳台 6 盆花浇水一次',
    images: [],
    owner: { id: 'u2', name: '李先生' },
    status: 'posted'
  }
];

const user = {
  id: 'me', name: '我', realname: true, community: '海悦花园A区', balance: 58.8
};

const walletFlows = [
  { id: 'f1', type: 'in', title: '完成任务#t100', amount: 12.5, time: Date.now()-3600000 },
  { id: 'f2', type: 'out', title: '提现申请', amount: 20, time: Date.now()-7200000 }
];

module.exports = { tasks, user, walletFlows };
```

```json
// path: components/ui/button/index.json
{ "component": true, "usingComponents": {} }
```

```wxml
<!-- path: components/ui/button/index.wxml -->
<button class="btn {{typeClass}} {{sizeClass}}" bindtap="onTap" hover-class="none">
  <slot></slot>
  <text wx:if="{{loading}}" style="margin-left:8rpx">…</text>
  <text wx:if="{{disabled}}" style="margin-left:8rpx">(禁用)</text>
  <text wx:if="{{danger}}" style="display:none"></text>
</button>
```

```wxss
/* path: components/ui/button/index.wxss */
@import "../../../styles/shadcn.wxss";
```

```js
// path: components/ui/button/index.js
Component({
  properties: {
    type: { type: String, value: 'primary' }, // primary/outline/ghost/danger
    size: { type: String, value: 'base' }, // base/sm
    loading: { type: Boolean, value: false },
    disabled: { type: Boolean, value: false }
  },
  data: {},
  methods: {
    onTap() {
      if (this.properties.loading || this.properties.disabled) return;
      this.triggerEvent('tap');
    }
  },
  observers: {
    'type,size': function(type,size){
      const map = { primary:'btn-primary', outline:'btn-outline', ghost:'btn-ghost', danger:'btn-danger' };
      const sm = size==='sm' ? 'btn-sm' : '';
      this.setData({ typeClass: map[type]||'btn-primary', sizeClass: sm });
    }
  }
});
```

```json
// path: components/ui/card/index.json
{ "component": true }
```

```wxml
<!-- path: components/ui/card/index.wxml -->
<view class="card">
  <view class="row space-between">
    <text class="card-title">{{title}}</text>
    <slot name="extra"></slot>
  </view>
  <view class="mt-12 card-sub" wx:if="{{sub}}">{{sub}}</view>
  <view class="mt-16">
    <slot></slot>
  </view>
 </view>
```

```wxss
/* path: components/ui/card/index.wxss */
@import "../../../styles/shadcn.wxss";
```

```js
// path: components/ui/card/index.js
Component({ properties: { title: String, sub: String } });
```

```json
// path: components/ui/field/index.json
{ "component": true }
```

```wxml
<!-- path: components/ui/field/index.wxml -->
<view class="field">
  <text class="field-label">{{label}}</text>
  <slot></slot>
  <text wx:if="{{error}}" class="text-sm c-danger" style="margin-top:8rpx">{{error}}</text>
 </view>
```

```wxss
/* path: components/ui/field/index.wxss */
@import "../../../styles/shadcn.wxss";
```

```js
// path: components/ui/field/index.js
Component({ properties: { label: String, error: String } });
```

```json
// path: components/chat/bubble/index.json
{ "component": true }
```

```wxml
<!-- path: components/chat/bubble/index.wxml -->
<view class="row" style="margin: 8rpx 0; justify-content: {{mine?'flex-end':'flex-start'}};">
  <view wx:if="{{!mine}}" class="avatar" style="margin-right:12rpx;"></view>
  <view style="max-width: 70%; background: {{mine?'#111827':'#fff'}}; color: {{mine?'#fff':'#111827'}}; padding: 16rpx 20rpx; border-radius: 16rpx; border: 1px solid #e5e7eb;">
    <text class="text-base">{{text}}</text>
  </view>
  <view wx:if="{{mine}}" class="avatar" style="margin-left:12rpx;"></view>
</view>
```

```wxss
/* path: components/chat/bubble/index.wxss */
@import "../../../styles/shadcn.wxss";
```

```js
// path: components/chat/bubble/index.js
Component({ properties: { mine: Boolean, text: String } });
```

```json
// path: pages/auth/realname/index.json
{
  "usingComponents": {
    "ui-button": "/components/ui/button/index",
    "ui-field": "/components/ui/field/index"
  },
  "navigationBarTitleText": "实名注册"
}
```

```wxml
<!-- path: pages/auth/realname/index.wxml -->
<view class="px-24 py-16">
  <view class="card">
    <text class="card-title">请完成实名（用于小区安全）</text>
    <view class="mt-16 gap-12">
      <ui-field label="姓名" error="{{errors.name}}">
        <input class="input" placeholder="请输入姓名" value="{{form.name}}" bindinput="onInput" data-key="name"/>
      </ui-field>
      <ui-field label="身份证号" error="{{errors.idNumber}}">
        <input class="input" placeholder="请输入身份证号" value="{{form.idNumber}}" bindinput="onInput" data-key="idNumber"/>
      </ui-field>
      <ui-field label="手机号" error="{{errors.phone}}">
        <input class="input" placeholder="请输入手机号" value="{{form.phone}}" bindinput="onInput" data-key="phone"/>
      </ui-field>
      <ui-field label="所属小区" error="{{errors.community}}">
        <input class="input" placeholder="请输入小区名称" value="{{form.community}}" bindinput="onInput" data-key="community"/>
      </ui-field>
    </view>
    <view class="row space-between mt-20">
      <ui-button type="outline" bindtap="goBack">返回</ui-button>
      <ui-button type="primary" bindtap="submit">提交</ui-button>
    </view>
  </view>
</view>
```

```wxss
/* path: pages/auth/realname/index.wxss */
@import "../../../styles/shadcn.wxss";
```

```js
// path: pages/auth/realname/index.js
const { required, isPhone, isIdNumber } = require('../../../utils/validators');
const { toast } = require('../../../utils/ui');

Page({
  data: {
    form: { name: '', idNumber: '', phone: '', community: '' },
    errors: {}
  },
  onInput(e){
    const key = e.currentTarget.dataset.key;
    this.setData({ [`form.${key}`]: e.detail.value });
  },
  goBack(){ wx.navigateBack({ fail: ()=> wx.switchTab({ url: '/pages/home/index/index' })}); },
  submit(){
    const f = this.data.form; const errors = {};
    errors.name = required(f.name,'请输入姓名');
    errors.idNumber = isIdNumber(f.idNumber);
    errors.phone = isPhone(f.phone);
    errors.community = required(f.community,'请输入小区');
    Object.keys(errors).forEach(k=>{ if(!errors[k]) delete errors[k]; });
    if (Object.keys(errors).length){ this.setData({errors}); return; }
    // UI 阶段：本地存储模拟实名完成
    wx.setStorageSync('hyyc_user', { ...f, id:'me', realname:true });
    toast('实名完成');
    wx.switchTab({ url: '/pages/home/index/index' });
  }
});
```

```json
// path: pages/home/index/index.json
{
  "usingComponents": {
    "ui-card": "/components/ui/card/index",
    "ui-button": "/components/ui/button/index"
  },
  "navigationBarTitleText": "任务广场"
}
```

```wxml
<!-- path: pages/home/index/index.wxml -->
<view class="px-24 py-16">
  <view class="row space-between">
    <text class="text-xl bold">本小区任务</text>
    <navigator url="/pages/task/publish/index" open-type="switchTab">
      <view class="btn btn-primary btn-sm">发布任务</view>
    </navigator>
  </view>

  <view class="row mt-16 row-gap-8 wrap">
    <view class="badge" bindtap="changeFilter" data-k="all" wx:class="{{filter==='all'?'badge-primary':''}}">全部</view>
    <view class="badge" bindtap="changeFilter" data-k="new" wx:class="{{filter==='new'?'badge-primary':''}}">最新</view>
    <view class="badge" bindtap="changeFilter" data-k="money" wx:class="{{filter==='money'?'badge-primary':''}}">高佣金</view>
  </view>

  <block wx:for="{{list}}" wx:key="id">
    <view class="mt-16">
      <ui-card title="{{item.title}}" sub="{{item.community}} · 截止 {{item.deadlineText}}">
        <view class="row space-between">
          <text class="text-lg bold">¥ {{item.amountText}}</text>
          <view class="row row-gap-8">
            <view class="badge">{{item.statusText}}</view>
            <navigator url="/pages/task/detail/index?id={{item.id}}">
              <view class="btn btn-outline btn-sm">详情</view>
            </navigator>
          </view>
        </view>
        <view class="mt-12 c-muted text-sm">{{item.desc}}</view>
      </ui-card>
    </view>
  </block>

  <view wx:if="{{!list.length}}" class="center" style="height: 50vh;">
    <text class="c-muted">暂无任务，去发布一个吧 ~</text>
  </view>
</view>
```

```wxss
/* path: pages/home/index/index.wxss */
@import "../../../styles/shadcn.wxss";
```

```js
// path: pages/home/index/index.js
const { tasks } = require('../../../utils/mock');
const { formatMoney, formatDate } = require('../../../utils/format');

Page({
  data: { filter: 'all', list: [] },
  onShow(){ this.load(); },
  changeFilter(e){ this.setData({ filter: e.currentTarget.dataset.k }, ()=> this.load()); },
  load(){
    let list = tasks.map(t=>({
      ...t,
      amountText: formatMoney(t.amount),
      deadlineText: formatDate(t.deadline),
      statusText: t.status==='posted'?'已发布':t.status
    }));
    if (this.data.filter==='money') list = list.sort((a,b)=>b.amount-a.amount);
    if (this.data.filter==='new') list = list.sort((a,b)=>b.deadline-a.deadline);
    this.setData({ list });
  }
});
```

```json
// path: pages/task/publish/index.json
{
  "usingComponents": {
    "ui-field": "/components/ui/field/index",
    "ui-button": "/components/ui/button/index"
  },
  "navigationBarTitleText": "发布任务"
}
```

```wxml
<!-- path: pages/task/publish/index.wxml -->
<view class="px-24 py-16">
  <view class="card">
    <view class="gap-12">
      <ui-field label="标题" error="{{errors.title}}">
        <input class="input" placeholder="如：帮忙拿快递" value="{{form.title}}" data-k="title" bindinput="onInput"/>
      </ui-field>
      <ui-field label="说明" error="{{errors.desc}}">
        <textarea class="textarea" placeholder="简单描述要做的事" value="{{form.desc}}" data-k="desc" bindinput="onInput"/>
      </ui-field>
      <ui-field label="佣金（元）" error="{{errors.amount}}">
        <input class="input" type="number" placeholder="如 10" value="{{form.amount}}" data-k="amount" bindinput="onInput"/>
      </ui-field>
      <ui-field label="截止日期" error="{{errors.deadline}}">
        <picker mode="date" value="{{form.deadline}}" bindchange="onDate">
          <view class="input row space-between"><text>{{form.deadline||'选择日期'}}</text><text>›</text></view>
        </picker>
      </ui-field>
      <ui-field label="地址" error="{{errors.address}}">
        <input class="input" placeholder="如 3栋1单元" value="{{form.address}}" data-k="address" bindinput="onInput"/>
      </ui-field>
      <ui-field label="图片（可选）">
        <view class="row wrap row-gap-8">
          <block wx:for="{{form.images}}" wx:key="*this"><image src="{{item}}" style="width:160rpx;height:160rpx;border-radius:12rpx;"/></block>
          <view class="btn btn-outline btn-sm" bindtap="chooseImg">上传图片</view>
        </view>
      </ui-field>
    </view>
    <view class="row space-between mt-20">
      <ui-button type="outline" bindtap="reset">清空</ui-button>
      <ui-button type="primary" bindtap="submit">发布</ui-button>
    </view>
  </view>
</view>
```

```wxss
/* path: pages/task/publish/index.wxss */
@import "../../../styles/shadcn.wxss";
```

```js
// path: pages/task/publish/index.js
const { required } = require('../../../utils/validators');
const { toast } = require('../../../utils/ui');

Page({
  data: {
    form: { title:'', desc:'', amount:'', deadline:'', address:'', images:[] },
    errors: {}
  },
  onInput(e){ const k=e.currentTarget.dataset.k; this.setData({ [`form.${k}`]: e.detail.value }); },
  onDate(e){ this.setData({ 'form.deadline': e.detail.value }); },
  chooseImg(){
    wx.chooseImage({ count:3, success: ({tempFilePaths}) => {
      this.setData({ 'form.images': (this.data.form.images||[]).concat(tempFilePaths) });
    }});
  },
  reset(){ this.setData({ form: { title:'', desc:'', amount:'', deadline:'', address:'', images:[] }, errors:{} }); },
  submit(){
    const f=this.data.form, errors={};
    errors.title=required(f.title,'请填写标题');
    errors.desc=required(f.desc,'请填写说明');
    errors.amount=required(f.amount,'请填写佣金');
    errors.deadline=required(f.deadline,'请选择截止日期');
    errors.address=required(f.address,'请填写地址');
    Object.keys(errors).forEach(k=>{ if(!errors[k]) delete errors[k]; });
    if(Object.keys(errors).length){ this.setData({errors}); return; }
    toast('已发布（演示）');
    wx.switchTab({ url: '/pages/home/index/index' });
  }
});
```

```json
// path: pages/task/detail/index.json
{
  "usingComponents": {
    "ui-card": "/components/ui/card/index",
    "ui-button": "/components/ui/button/index"
  },
  "navigationBarTitleText": "任务详情"
}
```

```wxml
<!-- path: pages/task/detail/index.wxml -->
<view class="px-24 py-16">
  <ui-card title="{{task.title}}" sub="{{task.community}} · {{task.address}}">
    <view class="row space-between">
      <text class="text-xl bold">¥ {{task.amountText}}</text>
      <view class="badge">{{task.statusText}}</view>
    </view>
    <view class="mt-16 c-muted">{{task.desc}}</view>
    <view class="row wrap mt-12 row-gap-8">
      <image wx:for="{{task.images}}" wx:key="*this" src="{{item}}" style="width:200rpx;height:200rpx;border-radius:12rpx;"/>
    </view>
  </ui-card>

  <view class="card mt-16">
    <text class="card-title">操作</text>
    <view class="row space-between mt-16" wx:if="{{!isOwner && !accepted}}">
      <ui-button type="primary" bindtap="accept">接受任务</ui-button>
      <ui-button type="outline" bindtap="toChat">先沟通</ui-button>
    </view>
    <view class="row space-between mt-16" wx:if="{{!isOwner && accepted}}">
      <ui-button type="primary" bindtap="toSubmit">提交完成</ui-button>
      <ui-button type="outline" bindtap="toChat">与业主聊天</ui-button>
    </view>
    <view class="row space-between mt-16" wx:if="{{isOwner}}">
      <ui-button type="outline" bindtap="toChat">与接单人聊天</ui-button>
      <ui-button type="primary" bindtap="approve">确认完成</ui-button>
    </view>
  </view>
</view>
```

```wxss
/* path: pages/task/detail/index.wxss */
@import "../../../styles/shadcn.wxss";
```

```js
// path: pages/task/detail/index.js
const { tasks } = require('../../../utils/mock');
const { formatMoney, formatDate } = require('../../../utils/format');
const { toast, confirm } = require('../../../utils/ui');

Page({
  data: { task: {}, isOwner: false, accepted: false },
  onLoad(q){
    const t = tasks.find(i=>i.id===q.id) || tasks[0];
    this.setData({ task: { ...t, amountText: formatMoney(t.amount), deadlineText: formatDate(t.deadline), statusText: '已发布' } });
    // UI 演示：通过 query 决定身份
    this.setData({ isOwner: q.role==='owner', accepted: q.accepted==='1' });
  },
  accept(){ toast('已接受（演示）'); this.setData({ accepted: true }); },
  toChat(){ wx.navigateTo({ url: '/pages/chat/room/index?tid=' + this.data.task.id }); },
  toSubmit(){ wx.navigateTo({ url: '/pages/task/submit/index?tid=' + this.data.task.id }); },
  async approve(){
    const ok = await confirm('确认任务已完成并打款给对方？');
    if (ok) { toast('已确认完成（演示）'); }
  }
});
```

```json
// path: pages/task/submit/index.json
{
  "usingComponents": {
    "ui-field": "/components/ui/field/index",
    "ui-button": "/components/ui/button/index"
  },
  "navigationBarTitleText": "提交验收"
}
```

```wxml
<!-- path: pages/task/submit/index.wxml -->
<view class="px-24 py-16">
  <view class="card">
    <ui-field label="完成说明">
      <textarea class="textarea" placeholder="简单描述完成情况" value="{{note}}" bindinput="onNote"/>
    </ui-field>
    <ui-field label="上传凭证（照片）">
      <view class="row wrap row-gap-8">
        <block wx:for="{{images}}" wx:key="*this"><image src="{{item}}" style="width:200rpx;height:200rpx;border-radius:12rpx;"/></block>
        <view class="btn btn-outline btn-sm" bindtap="choose">上传图片</view>
      </view>
    </ui-field>
    <view class="row space-between mt-16">
      <ui-button type="outline" bindtap="cancel">取消</ui-button>
      <ui-button type="primary" bindtap="submit">提交验收</ui-button>
    </view>
  </view>
 </view>
```

```wxss
/* path: pages/task/submit/index.wxss */
@import "../../../styles/shadcn.wxss";
```

```js
// path: pages/task/submit/index.js
const { toast } = require('../../../utils/ui');
Page({
  data: { tid: '', note: '', images: [] },
  onLoad(q){ this.setData({ tid: q.tid||'' }); },
  onNote(e){ this.setData({ note: e.detail.value }); },
  choose(){ wx.chooseImage({ count: 3, success: ({tempFilePaths})=> this.setData({ images: this.data.images.concat(tempFilePaths) }) }); },
  cancel(){ wx.navigateBack(); },
  submit(){ toast('已提交（演示）'); wx.navigateBack(); }
});
```

```json
// path: pages/chat/room/index.json
{
  "usingComponents": {
    "chat-bubble": "/components/chat/bubble/index"
  },
  "navigationBarTitleText": "聊天"
}
```

```wxml
<!-- path: pages/chat/room/index.wxml -->
<view class="col" style="height:100vh;">
  <scroll-view scroll-y style="flex:1; padding: 16rpx 24rpx;" scroll-with-animation="true" scroll-into-view="{{toView}}">
    <block wx:for="{{msgs}}" wx:key="id">
      <chat-bubble id="m{{item.id}}" mine="{{item.mine}}" text="{{item.text}}" />
    </block>
  </scroll-view>
  <view class="row" style="padding: 12rpx 16rpx; background:#fff; border-top:1px solid #e5e7eb;">
    <input class="input" style="flex:1;margin-right:12rpx;" placeholder="输入消息" value="{{text}}" bindinput="onInput"/>
    <view class="btn btn-primary btn-sm" bindtap="send">发送</view>
  </view>
</view>
```

```wxss
/* path: pages/chat/room/index.wxss */
@import "../../../styles/shadcn.wxss";
```

```js
// path: pages/chat/room/index.js
Page({
  data: { tid: '', msgs: [], text: '', toView: '' },
  onLoad(q){ this.setData({ tid: q.tid||'' }); this.mockHistory(); },
  mockHistory(){
    const msgs=[
      { id:1, text:'你好，我来接这个任务可以吗？', mine:false },
      { id:2, text:'可以的，取快递在3栋柜子。', mine:true }
    ];
    this.setData({ msgs, toView: 'm2' });
  },
  onInput(e){ this.setData({ text: e.detail.value }); },
  send(){
    if(!this.data.text.trim()) return;
    const id = (this.data.msgs.slice(-1)[0]?.id||0)+1;
    const msgs = this.data.msgs.concat({ id, text: this.data.text, mine:true });
    this.setData({ msgs, text:'', toView: 'm'+id });
  }
});
```

```json
// path: pages/wallet/index/index.json
{
  "usingComponents": {
    "ui-card": "/components/ui/card/index",
    "ui-button": "/components/ui/button/index"
  },
  "navigationBarTitleText": "钱包"
}
```

```wxml
<!-- path: pages/wallet/index/index.wxml -->
<view class="px-24 py-16">
  <ui-card title="可用余额">
    <text class="text-xl bold">¥ {{balance}}</text>
  </ui-card>
  <ui-card class="mt-16" title="收支明细">
    <block wx:for="{{flows}}" wx:key="id">
      <view class="row space-between py-16">
        <text>{{item.title}}</text>
        <text class="bold" style="color:{{item.type==='in'?'#111827':'#b91c1c'}}">{{item.type==='in'?'+':'-'}}{{item.amount}}</text>
      </view>
      <view class="divider"></view>
    </block>
  </ui-card>
  <view class="mt-16">
    <navigator url="/pages/profile/index/index">
      <view class="btn btn-outline">返回</view>
    </navigator>
  </view>
</view>
```

```wxss
/* path: pages/wallet/index/index.wxss */
@import "../../../styles/shadcn.wxss";
```

```js
// path: pages/wallet/index/index.js
const { walletFlows, user } = require('../../../utils/mock');
const { formatMoney } = require('../../../utils/format');

Page({
  data: { balance: '0.00', flows: [] },
  onShow(){
    this.setData({ balance: formatMoney(user.balance), flows: walletFlows.map(i=>({ ...i, amount: formatMoney(i.amount) })) });
  }
});
```

```json
// path: pages/profile/index/index.json
{
  "usingComponents": {
    "ui-card": "/components/ui/card/index"
  },
  "navigationBarTitleText": "我的"
}
```

```wxml
<!-- path: pages/profile/index/index.wxml -->
<view class="px-24 py-16">
  <ui-card title="账户信息">
    <view class="row">
      <view class="avatar"></view>
      <view style="margin-left:12rpx;">
        <text class="bold">{{user.name||'未实名'}}</text>
        <view class="c-muted text-sm">{{user.community||'未设置小区'}} · {{user.realname?'已实名':'未实名'}}</view>
      </view>
    </view>
  </ui-card>

  <ui-card class="mt-16" title="导航">
    <navigator url="/pages/my/tasks/index"><view class="py-16">我的任务</view></navigator>
    <view class="divider"></view>
    <navigator url="/pages/wallet/index/index"><view class="py-16">我的钱包</view></navigator>
    <view class="divider"></view>
    <navigator url="/pages/auth/realname/index"><view class="py-16">实名认证</view></navigator>
  </ui-card>
</view>
```

```wxss
/* path: pages/profile/index/index.wxss */
@import "../../../styles/shadcn.wxss";
```

```js
// path: pages/profile/index/index.js
Page({
  data: { user: {} },
  onShow(){ this.setData({ user: wx.getStorageSync('hyyc_user')||{} }); }
});
```

```json
// path: pages/my/tasks/index.json
{
  "usingComponents": {
    "ui-card": "/components/ui/card/index",
    "ui-button": "/components/ui/button/index"
  },
  "navigationBarTitleText": "我的任务"
}
```

```wxml
<!-- path: pages/my/tasks/index.wxml -->
<view class="px-24 py-16">
  <view class="row row-gap-8">
    <view class="badge" bindtap="setTab" data-k="owner" wx:class="{{tab==='owner'?'badge-primary':''}}">我发布的</view>
    <view class="badge" bindtap="setTab" data-k="worker" wx:class="{{tab==='worker'?'badge-primary':''}}">我接受的</view>
  </view>

  <block wx:for="{{list}}" wx:key="id">
    <view class="mt-16">
      <ui-card title="{{item.title}}" sub="截止 {{item.deadlineText}}">
        <view class="row space-between">
          <text>¥ {{item.amountText}}</text>
          <navigator url="/pages/task/detail/index?id={{item.id}}&role={{tab==='owner'?'owner':''}}&accepted=1">
            <view class="btn btn-outline btn-sm">查看</view>
          </navigator>
        </view>
      </ui-card>
    </view>
  </block>
  <view wx:if="{{!list.length}}" class="center" style="height: 50vh;">
    <text class="c-muted">暂无记录</text>
  </view>
</view>
```

```wxss
/* path: pages/my/tasks/index.wxss */
@import "../../../styles/shadcn.wxss";
```

```js
// path: pages/my/tasks/index.js
const { tasks } = require('../../../utils/mock');
const { formatMoney, formatDate } = require('../../../utils/format');

Page({
  data: { tab: 'owner', list: [] },
  onShow(){ this.load(); },
  setTab(e){ this.setData({ tab: e.currentTarget.dataset.k }, ()=> this.load()); },
  load(){
    // UI 演示：直接显示同一批任务
    const list = tasks.map(t=>({ ...t, amountText: formatMoney(t.amount), deadlineText: formatDate(t.deadline) }));
    this.setData({ list });
  }
});
```

```
// 说明：至此前端 UI 已包含“实名、任务广场、发布、详情、提交、聊天、钱包、我的、我的任务”等页面组件。
// 真实接入步骤（简述）：
// 1）把本 md 中各段代码按 path 创建到小程序目录；
// 2）替换 utils/mock.js 为真实接口；
// 3）在 app.json 增加 usingComponents 路径正确性；
// 4）若使用云开发（微信自带数据库/存储），把聊天、任务、上传接入云函数；
// 5）根据小区过滤只展示同社区任务（后端按 user.community 查询，前端透传）。
```

