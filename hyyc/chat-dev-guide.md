# 聊天功能（chat/room）开发说明（云开发版，按任务一对一私聊）

> 适用路径：`miniprograme/hyyc`  
> 目标：基于微信云开发（云数据库 + 云存储），为小区任务做「发布者和每个住户分别单聊」，支持文字和图片。

整套设计尽量用“人话”来写，方便以后自己或别的同事接手。

---

## 1. 功能概览

- 功能目标
  - 在任务详情页，任何能看到任务的人，都可以点“聊天”，和**发布这个任务的人**单独聊天。
  - 同一个任务，发布者可以和很多用户分别聊天，每一条聊天线的数据互相独立。
  - 支持发送文字、发送图片。
  - 聊天记录保存在云数据库里，页面通过“实时监听”自动更新。

- 使用到的微信能力
  - 云数据库：存任务、用户实名信息、聊天记录。
  - 实时监听 `watch`：数据库的记录一有变动，就推给前端。
  - 云存储：保存聊天图片文件。
  - 云函数 `login`：登录时获取 `openid`，已经在其它页面使用。

---

## 2. 关键文件一览

- 页面
  - 任务详情页：`miniprograme/hyyc/pages/task/detail/index.js`
    - 跳转到聊天页：`toChat(){ wx.navigateTo({ url: '/pages/chat/room/index?tid=' + this.data.task.id }); }`
  - 聊天页：  
    - 逻辑：`miniprograme/hyyc/pages/chat/room/index.js`  
    - 视图：`miniprograme/hyyc/pages/chat/room/index.wxml`  
    - 样式：`miniprograme/hyyc/pages/chat/room/index.wxss`

- 组件
  - 聊天气泡组件：`miniprograme/hyyc/components/chat/bubble/`
    - 逻辑：`index.js`
    - 视图：`index.wxml`
    - 样式：`index.wxss`

- 云开发相关
  - 云初始化：`miniprograme/hyyc/app.js`
  - 登录云函数：`miniprograme/hyyc/cloudfunctions/login/index.js`
  - 用户实名集合：`userInfo`
  - 任务集合：`tasks`
  - 新增聊天集合：`messages`（需要在云开发控制台里创建）

---

## 3. 数据设计

### 3.1 用户数据（已有）

- 云数据库集合：`userInfo`  
- 注册实名成功后，在本地缓存一份用户信息 `hyyc_user`（见 `pages/auth/realname/index.js`）：
  - `id`：使用 `userInfo` 集合中新建记录的 `_id`，作为全局唯一的“用户 ID”（后面任务、聊天都用它）。
  - 其它信息：`name`、`nickname`、`community` 等。
- 登录流程（欢迎页 `pages/auth/welcome/index.js`）：
  - 云函数 `login` 返回 `openid`；
  - 再用 `_openid` 去 `userInfo` 里查当前用户，查到后写入本地 `hyyc_user`。

> 聊天逻辑里：所有“是谁”相关的字段，都统一用 `hyyc_user.id`。

### 3.2 任务数据（已有）

- 云数据库集合：`tasks`
- 和聊天相关的字段：
  - `_id`：任务 ID（在聊天里记为 `tid`）。
  - `ownerId`：任务发布人的用户 ID（来自 `hyyc_user.id`）。
  - 其它字段：标题、描述、图片、位置等只跟展示有关，这里不展开。

### 3.3 聊天记录集合 `messages`（本功能新增）

在云数据库中新建集合 `messages`，每一条记录就是一句话或一张图片。  
设计目标：**同一个任务下，发布者和每个用户都是一条独立的“私聊线”**。

- 字段推荐：
  - `tid`：字符串  
    - 任务 ID（`tasks` 集合里的 `_id`）。
  - `ownerId`：字符串  
    - 任务发布人的用户 ID（任务里的 `ownerId`）。
  - `peerUserId`：字符串  
    - 和发布人单聊的“另一方”的用户 ID。  
    - 比如：A 发任务，B 打开任务并和 A 聊天：  
      - `ownerId = A.id`，`peerUserId = B.id`。
  - `fromUserId`：字符串  
    - 发送方用户 ID（可能是 A，也可能是 B）。
  - `fromNickname`：字符串  
    - 发送方昵称或姓名，用于以后展示。
  - `type`：字符串  
    - `'text'` 或 `'image'`。
  - `text`：字符串  
    - 文本内容（只在 `type === 'text'` 时生效）。
  - `imageUrl`：字符串  
    - 图片消息的云文件 ID（只在 `type === 'image'` 时生效）。
  - `createTime`：时间  
    - 使用 `db.serverDate()` 写入，按这个字段排序即可。
  - `readByOwner`：布尔  
    - 这条消息**对任务发布者来说**是否已经读过：
      - 住户发消息时默认 `false`，业主自己发消息写 `true`。
      - 业主进入聊天页或在聊天页中实时收到消息时，通过云函数统一把这一条会话下自己的未读标记为已读。
  - `readByPeer`：布尔  
    - 这条消息**对住户本人来说**是否已经读过：
      - 住户自己发消息时写 `true`，业主发消息时默认 `false`。
      - 住户进入聊天页或在聊天页中实时收到消息时，通过云函数统一把这一条会话下自己的未读标记为已读。

> 可以简单理解为：  
> - 一个“聊天房间”由三样东西唯一确定：`(tid, ownerId, peerUserId)`；  
> - 普通住户看任务并聊天：`peerUserId = 这个住户本人的 id`；  
> - 业主后面如果要看和某个住户的聊天记录，就查那一条组合；  
> - 这样就保证“别人和业主聊的内容我看不到”。

---

## 4. 聊天页结构与交互

### 4.1 页面入口

- 在任务详情页 `pages/task/detail/index.js` 中，点击「先沟通 / 与业主聊天 / 与接单人聊天」时，会执行：

```js
toChat(){
  wx.navigateTo({
    url: '/pages/chat/room/index?tid=' + this.data.task.id
  });
}
```

- 即：只带任务 ID（`tid`）跳转到聊天页。  
  谁是 owner、谁是 peerUser，聊天页自己去算。

> 未来如果要做“业主的聊天列表”，可以在 URL 上多带一个 `peerUserId=xxx`，让业主直接进到指定住户的聊天记录。

### 4.2 聊天页布局（WXML）

文件：`miniprograme/hyyc/pages/chat/room/index.wxml`

- 顶部：`<ui-loading show="{{isLoading}}" />` 显示加载状态。
- 中间：纵向 `scroll-view` 展示聊天记录：

```xml
<scroll-view scroll-y style="flex:1; padding: 16rpx 24rpx;"
             scroll-with-animation="true"
             scroll-into-view="{{toView}}">
  <block wx:for="{{msgs}}" wx:key="id">
    <chat-bubble
      id="m{{item.id}}"
      mine="{{item.mine}}"
      type="{{item.type}}"
      text="{{item.text}}"
      image-url="{{item.imageUrl}}"
    />
  </block>
</scroll-view>
```

- 底部输入区：

```xml
<view class="row" style="padding: 12rpx 16rpx; background:#fff; border-top:1px solid #e5e7eb;">
  <view class="btn btn-outline btn-sm" style="margin-right:12rpx;" bindtap="chooseImage">图片</view>
  <input class="input" style="flex:1;margin-right:12rpx;" placeholder="输入消息" value="{{text}}" bindinput="onInput"/>
  <view class="btn btn-primary btn-sm" bindtap="send">发送</view>
</view>
```

---

## 5. 聊天页逻辑实现（按任务一对一房间）

文件：`miniprograme/hyyc/pages/chat/room/index.js`

### 5.1 初始化云数据库

```js
// 使用云开发数据库 messages 集合做聊天记录
const db = wx.cloud.database();
const MSG_COLLECTION = 'messages';
const TASK_COLLECTION = 'tasks';
```

依赖 `app.js` 中已经调用过：

```js
wx.cloud.init({ env: 'cloud1-xxx', traceUser: true });
```

### 5.2 页面数据字段

```js
data: {
  tid: '',         // 当前任务 ID
  ownerId: '',     // 任务发布人 ID
  peerUserId: '',  // 和发布人单聊的“另一方”用户 ID
  msgs: [],        // 消息数组（已经带上 mine 标记等）
  text: '',        // 输入框内容
  toView: '',      // 用于滚动到最后一条消息
  isLoading: true,
  me: null         // 当前登录用户（本地缓存 hyyc_user）
},
```

### 5.3 onLoad：校验参数 + 读取当前用户

```js
onLoad(q) {
  const tid = (q && q.tid) || '';
  if (!tid) {
    wx.showToast({ title: '缺少任务信息', icon: 'none' });
    return;
  }

  const me = wx.getStorageSync('hyyc_user') || null;
  if (!me || !me.id) {
    wx.showToast({ title: '请先登录', icon: 'none' });
    wx.navigateTo({ url: '/pages/auth/welcome/index' });
    return;
  }

  const peerFromQuery = (q && q.peerUserId) || '';

  this.setData({ tid, me, isLoading: true });

  // 根据任务信息 + 当前用户 + peerUserId 决定“房间三元组”
  this._initRoomWithTask(tid, me, peerFromQuery);
},
```

### 5.4 `_initRoomWithTask`：确定 ownerId 和 peerUserId

```js
_initRoomWithTask(tid, me, peerFromQuery) {
  const self = this;
  db.collection(TASK_COLLECTION).doc(tid).get({
    success(res) {
      const task = (res && res.data) || {};
      const ownerId = task.ownerId || '';

      if (!ownerId) {
        wx.showToast({ title: '任务数据异常', icon: 'none' });
        self.setData({ isLoading: false });
        return;
      }

      const meId = me.id || '';
      let peerUserId = '';

      if (peerFromQuery) {
        // 业主从“聊天列表”等入口进入时，URL 上会带 peerUserId
        peerUserId = peerFromQuery;
      } else if (meId === ownerId) {
        // 当前版本：如果业主从任务详情直接点“与接单人聊天”，因为没有指定对方是谁，先友好提示
        wx.showToast({ title: '请从指定住户入口进入聊天', icon: 'none' });
        self.setData({ isLoading: false });
        return;
      } else {
        // 普通住户从任务详情进入：和任务发布人一对一
        peerUserId = meId;
      }

      self.setData({ ownerId, peerUserId });

      const room = { tid, ownerId, peerUserId };
      self.loadHistory(room, me);
      self.openWatch(room);
    },
    fail(err) {
      wx.showToast({ title: '任务不存在或已被删除', icon: 'none' });
      self.setData({ isLoading: false });
    }
  });
},
```

> 小结：  
> - “房间”由 `(tid, ownerId, peerUserId)` 三个值唯一确认；  
> - 普通住户从任务详情进来时，不需要额外参数，自动认为是“我和业主”的单聊；  
> - 业主要看某个住户的聊天，需要额外传入 `peerUserId`（后续可在“聊天列表”里实现）。

### 5.5 加载历史记录：`loadHistory`

```js
loadHistory(room, me) {
  const { tid, ownerId, peerUserId } = room || {};
  if (!tid || !ownerId || !peerUserId) {
    this.setData({ isLoading: false });
    return;
  }

  const self = this;
  db.collection(MSG_COLLECTION)
    .where({ tid, ownerId, peerUserId })
    .orderBy('createTime', 'asc')
    .limit(100)
    .get({
      success(res) {
        const docs = (res && res.data) || [];
        const msgs = self._decorateMsgs(docs, me);
        const last = msgs[msgs.length - 1];
        self.setData({
          msgs,
          isLoading: false,
          toView: last ? 'm' + last.id : ''
        });
      },
      fail(err) {
        self.setData({ isLoading: false, msgs: [] });
        wx.showToast({ title: '加载聊天失败', icon: 'none' });
      }
    });
},
```

> 查询条件已经从“只看 tid”升级为“tid + ownerId + peerUserId 三个条件”，这样同一任务下不同住户的记录就天然分开。

### 5.6 实时监听：`openWatch`

```js
openWatch(room) {
  const { tid, ownerId, peerUserId } = room || {};
  if (!tid || !ownerId || !peerUserId) {
    return;
  }

  const self = this;
  if (this._watcher && this._watcher.close) {
    this._watcher.close();
  }
  this._watcher = db.collection(MSG_COLLECTION)
    .where({ tid, ownerId, peerUserId })
    .orderBy('createTime', 'asc')
    .watch({
      onChange(snapshot) {
        const docs = (snapshot && snapshot.docs) || [];
        const msgs = self._decorateMsgs(docs, self.data.me);
        const last = msgs[msgs.length - 1];
        self.setData({
          msgs,
          toView: last ? 'm' + last.id : self.data.toView
        });

        // 补充：在监听回调里，还会根据当前身份做一次“已读同步”：
        // - 如果当前用户是任务发布者（owner），调用云函数 markMessagesReadByOwner，
        //   把这个任务 + 这个住户会话下的消息统一标记为 readByOwner=true。
        // - 如果当前用户是住户本人（peerUserId），调用云函数 markMessagesReadByPeer，
        //   把这个任务 + 这个住户会话下的消息统一标记为 readByPeer=true。
        //
        // 这样可以保证：双方都停留在聊天页时，新来的消息不会被算成“未读”，
        // 只有人在别的页面时收到的消息，才会在任务详情/聊天列表上出现红色未读角标。
      },
      onError(err) {
        console.error('chat watch error', err);
      }
    });
},
```

- 可以把 `watch` 理解成“订阅当前房间的所有变更”，一有新消息插入，这里就会回调。
- 页面销毁时记得关闭监听：

```js
onUnload() {
  if (this._watcher && this._watcher.close) {
    this._watcher.close();
  }
  this._watcher = null;
},
```

### 5.7 消息数据转换：`_decorateMsgs`

```js
_decorateMsgs(docs, me) {
  const userId = (me && me.id) || '';
  return (docs || []).map(doc => {
    const id = doc._id || doc.id;
    const fromUserId = doc.fromUserId || '';
    return {
      id: id,
      text: doc.text || '',
      type: doc.type || 'text',
      imageUrl: doc.imageUrl || '',
      mine: userId && fromUserId === userId
    };
  });
},
```

- `mine`：是否是当前用户自己发的消息，用来控制聊天气泡靠左还是靠右。

### 5.8 输入框：`onInput`

```js
onInput(e) {
  this.setData({ text: e.detail.value });
},
```

### 5.9 发送文字消息：`send`

```js
send() {
  const text = (this.data.text || '').trim();
  if (!text) return;

  const me = this.data.me || {};
  const userId = me.id || '';
  if (!userId) {
    wx.showToast({ title: '请先登录', icon: 'none' });
    return;
  }

  const tid = this.data.tid;
  const ownerId = this.data.ownerId || '';
  const peerUserId = this.data.peerUserId || '';
  if (!tid) {
    wx.showToast({ title: '缺少任务信息', icon: 'none' });
    return;
  }
  if (!ownerId || !peerUserId) {
    wx.showToast({ title: '聊天对象信息缺失', icon: 'none' });
    return;
  }

  this.setData({ text: '' });

  db.collection(MSG_COLLECTION)
    .add({
      data: {
        tid,
        ownerId,
        peerUserId,
        fromUserId: userId,
        fromNickname: me.nickname || me.name || '',
        type: 'text',
        text,
        createTime: db.serverDate(),
        // 业主自己发出的消息，业主这边默认视为“已读”
        readByOwner: userId === ownerId,
        // 住户自己发出的消息，住户这边默认视为“已读”
        readByPeer: userId === peerUserId
      }
    })
    .catch(err => {
      console.error('send message error', err);
      wx.showToast({ title: '发送失败', icon: 'none' });
    });
},
```

### 5.10 发送图片消息：`chooseImage`

```js
chooseImage() {
  const me = this.data.me || {};
  const userId = me.id || '';
  if (!userId) {
    wx.showToast({ title: '请先登录', icon: 'none' });
    return;
  }
  const tid = this.data.tid;
  const ownerId = this.data.ownerId || '';
  const peerUserId = this.data.peerUserId || '';
  if (!tid) {
    wx.showToast({ title: '缺少任务信息', icon: 'none' });
    return;
  }
  if (!ownerId || !peerUserId) {
    wx.showToast({ title: '聊天对象信息缺失', icon: 'none' });
    return;
  }

  wx.chooseImage({
    count: 1,
    sizeType: ['compressed'],
    sourceType: ['album', 'camera'],
    success(res) {
      const paths = res.tempFilePaths || [];
      if (!paths.length) return;
      const filePath = paths[0];
      const cloudPath = 'chat-images/' + (userId || 'anonymous') + '/' + Date.now() + '.jpg';

      wx.cloud.uploadFile({
        cloudPath,
        filePath,
        success(upRes) {
          const fileID = upRes.fileID || '';
          if (!fileID) return;
          const isOwnerSender = userId === ownerId;
          const isPeerSender = userId === peerUserId;
          db.collection(MSG_COLLECTION)
            .add({
              data: {
                tid,
                ownerId,
                peerUserId,
                fromUserId: userId,
                fromNickname: me.nickname || me.name || '',
                type: 'image',
                imageUrl: fileID,
                createTime: db.serverDate(),
                readByOwner: isOwnerSender,
                readByPeer: isPeerSender
              }
            })
            .catch(err => {
              console.error('send image message error', err);
              wx.showToast({ title: '发送图片失败', icon: 'none' });
            });
        },
        fail(err) {
          console.error('upload image error', err);
          wx.showToast({ title: '上传失败', icon: 'none' });
        }
      });
    }
  });
}
```

---

## 6. 聊天气泡组件 `chat-bubble`

这部分和“群聊版”保持一致，只是多支持了图片：

### 6.1 组件属性

文件：`miniprograme/hyyc/components/chat/bubble/index.js`

```js
Component({
  properties: {
    mine: Boolean,
    // 文本消息内容
    text: String,
    // 消息类型：text / image
    type: {
      type: String,
      value: 'text'
    },
    // 图片消息地址（云文件 ID 或 http 链接）
    imageUrl: {
      type: String,
      value: ''
    }
  },
  methods: {
    // 点击图片时，调用 wx.previewImage 放大预览当前图片
    onImageTap() {
      const url = this.data.imageUrl;
      if (!url) return;
      wx.previewImage({
        current: url,
        urls: [url]
      });
    }
  }
});
```

### 6.2 组件模板

文件：`miniprograme/hyyc/components/chat/bubble/index.wxml`

```xml
<view class="row" style="margin: 8rpx 0; justify-content: {{mine?'flex-end':'flex-start'}};">
  <view wx:if="{{!mine}}" class="avatar" style="margin-right:12rpx;"></view>
  <view class="bubble {{mine?'bubble-mine':'bubble-other'}}">
    <block wx:if="{{type === 'text'}}">
      <text class="text-base">{{text}}</text>
    </block>
    <block wx:elif="{{type === 'image'}}">
      <image
        src="{{imageUrl}}"
        class="bubble-image"
        mode="aspectFill"
        bindtap="onImageTap"
      />
    </block>
  </view>
  <view wx:if="{{mine}}" class="avatar" style="margin-left:12rpx;"></view>
</view>
```

### 6.3 样式

文件：`miniprograme/hyyc/components/chat/bubble/index.wxss`

```css
.bubble { max-width: 70%; padding: 16rpx 20rpx; border-radius: 16rpx; border: 1px solid #e7e2de; }
.bubble-mine { background: #65c3c8; color: #ffffff; border-color: #65c3c8; }
.bubble-other { background: #ffffff; color: #2b3440; border-color: #e7e2de; }
.bubble-image { max-width: 400rpx; max-height: 400rpx; border-radius: 12rpx; display: block; }
```

---

## 7. 云开发控制台需要的配置

### 7.1 环境和初始化

- 在 `app.js` 中，已经调用：

```js
wx.cloud.init({
  env: 'cloud1-1g5aegr5eb60ce96', // 云开发环境 ID
  traceUser: true
});
```

- 确保这个环境 ID 和你在开发者工具里选中的云环境一致。

### 7.2 创建 `messages` 集合

1. 打开微信开发者工具 → 云开发面板 → 数据库。  
2. 点击「新建集合」。  
3. 输入集合名：`messages`。

### 7.3 集合权限设置（开发阶段建议）

因为聊天双方是两个不同用户，如果设置成“仅创建者可读写”，对方会看不到消息。

开发阶段建议：

- 可以设置为“所有用户可读，创建者可读写”或“所有用户可读写”。  
- 上线前如果要严格限制谁能读写，可以再改成“自定义权限”，例如：
  - 只允许任务 owner 和 peerUserId 对应的用户访问对应记录（这部分规则可以以后再细化）。

### 7.4 索引（可选但推荐）

查询和监听的条件是：

- `where({ tid, ownerId, peerUserId })`  
- `orderBy('createTime', 'asc')`

推荐在 `messages` 集合上建一个联合索引：

- 字段：`tid`（升序）、`ownerId`（升序）、`peerUserId`（升序）、`createTime`（升序）。  
- 这样当消息多了之后，查询和监听会更稳定。

### 7.5 云存储

- 不需要手动建 `chat-images` 目录，`wx.cloud.uploadFile` 会自动创建。  
- 可以在云开发面板 → 存储里看到上传的图片文件。

### 7.6 关于「实时数据推送」按钮

现在新版云开发控制台没有单独的“实时数据推送开关”。只要：

- 环境里开通了云数据库；  
- 小程序基础库版本支持 `watch`；  
- 代码里调用了 `collection().watch()`；

就已经在使用“实时数据推送”能力了。  
真正的限制主要是：

- 数据库读写次数；  
- 实时连接数上限（和云开发套餐有关）。

对“小区最多 5000 人在线”这种规模，只要套餐的实时连接上限足够，一般是没问题的。

---

## 8. 本地调试建议

1. 在欢迎页完成登录，确认本地有 `hyyc_user`。  
2. 发布一个任务。  
3. 账号 A（发布者）和账号 B（普通住户）分别进到同一个任务详情页。  
4. 从账号 B 的任务详情点“先沟通”，进入聊天页：  
   - 这时候房间三元组是：`(tid = 任务ID, ownerId = A.id, peerUserId = B.id)`。  
5. 在账号 B 里发文字、发图片，看账号 A 是否实时收到（A 这边暂时需要你手动从列表页或开发临时入口带上 `peerUserId` 打开同一个房间，未来可以做专门的聊天列表页）。  
6. 在云开发控制台里查看 `messages` 集合，确认记录的字段是否正确。

---

## 9. 后续可扩展方向（暂未实现）

可以在不改动当前设计的前提下，做一些增强：

- 为业主做一个“聊天会话列表”页：  
  - 按 `(tid, ownerId, peerUserId)` 组合聚合，展示最近一条消息和未读数等。  
  - 点击后跳转到 `/pages/chat/room/index?tid=...&peerUserId=...`。
- 做已读 / 未读状态，在 `messages` 或单独集合里加标记。  
- 做简单的“屏蔽拉黑”逻辑：比如在任务上记录哪些用户被屏蔽，加载聊天时跳过。  
- 做消息长度限制、敏感词过滤等。

当前版本已经满足：“一个任务可以和多个用户分别单聊，发布者和每个人之间有自己独立的聊天记录”的需求，后续如果有新需求，可以在这份文档上继续补充。***
