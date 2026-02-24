# 图片审核（COS 数据万象）一步步接入说明

目标：用户发布商品时**先保存**，商品先进入“审核中”，**别人看不到**；等图片都审核通过后，商品才会自动上架。

这份文档按“从 0 开始”写，你后面就算忘了今天踩过的坑，也能照着一步步再做一遍。

---

## 这套方案是怎么跑的（先理解大概）

一句话：**图片最终存云开发云存储，审核用 COS（数据万象 CI）来判，审核结果用回调通知我们。**

流程：

1) 小程序选图 → 上传到云存储（得到 `cloud://...` 的 fileID）
2) 写入 `goods`：先写 `status: pending`（审核中）
3) 调云函数 `imageAuditStart`：
   - 生成云存储图片的“临时链接”（临时链接=一段时间内可访问的链接）
   - 调用 COS 的“图片批量审核”（异步）
4) COS 审核完会“打电话”回来（回调=审核好了自动通知你）：
   - 命中违规：`goods.status = need_fix`，并写 `auditNeedFixIdx`（第几张要换）
   - 全部通过：`goods.status = posted`（上架）

重点：

- 我们**不会把图片再存一份到 COS 桶**（节省空间，也少一份维护）
- COS 桶更多是“开通审核服务 + 调用接口时要指定的桶”，图片来源用的是云存储临时链接

---

## 代码里改了什么（你要知道有哪些入口）

- 发布商品：先写 `status: pending`，再启动审核
- 审核通过：回调把商品改成 `status: posted`
- 审核不通过：商品变成 `status: need_fix`，并写入 `auditNeedFixIdx`
- “我的商品”页面：能看到 `pending/need_fix/posted`，并支持“去修改 / 重新审核”

复用点（以后其它地方也能用）：

- 前端统一用 `hyyc/utils/imageAudit.js` 的 `startImageAudit({ bizType, bizId, images })`
- 后端统一用云函数：
  - `hyyc/cloudfunctions/imageAuditStart`
  - `hyyc/cloudfunctions/imageAuditCallback`

---

## 第 1 步：COS 控制台要准备什么

你已经做过的（OK）：

- 桶私有
- 开启“内容审核 / 数据万象 CI”

### 1.1 创建“审核策略”（拿 BizType/策略ID）

你想要“默认审核所有类型”，最推荐用 **BizType（策略ID=一套审核规则的编号）**。

做法：

1) 在 COS 控制台找到「内容审核 / 审核策略 / 策略管理」这类页面
2) 新建一个“图片审核策略”
3) 把你想要的场景都勾上（色情/暴恐/政治/广告等）
4) 保存后，在“策略列表/详情”里找到 **BizType/策略ID**（通常是一串字符串），复制出来

你今天踩的坑：

- 你截图的「编辑图片审核配置」页面**可能看不到 BizType**
- BizType 一般在「审核策略列表/策略管理」里，不在“配置页面”里

> 如果你实在找不到 BizType：优先去“策略列表”找“查看详情/复制ID”的入口。

### 1.2 回调 URL 要不要在 COS 控制台填？

这套代码走的是：**调用接口时，在请求里带 Callback**。

所以：

- COS 控制台那一页的“回调 URL”**不是必须填**
- 我们用的回调地址来自云函数环境变量 `COS_AUDIT_CALLBACK_URL`

（只有你打算“把图片上传到 COS 桶→COS 自动触发审核→按桶配置回调”这种方案，才需要在 COS 控制台那页填回调 URL。）

---

## 第 2 步：云开发（CloudBase）要准备什么

### 2.1 创建数据库集合

必须有：

- `image_audit_jobs`（存每次审核任务的进度/结果）

你今天踩的坑：

- 没建集合会报：`collection not exists ... image_audit_jobs`

### 2.2 配置 `goods` 集合权限（避免权限拦截）

你今天踩的坑：

- 报错 `-502003 database permission denied`
- 原因不是 COS 密钥，而是 **数据库安全规则**把“新增 goods”拦住了

你当前规则里，`create` 用了 `doc.community`，但创建时应该用 `request.data.community`。

建议这样写（示例）：

```json
{
  "read": "auth != null && (doc._openid == auth.openid || (doc.status == 'posted' && get(`database.user_community.${auth.openid}`).community == doc.community))",
  "create": "auth != null && get(`database.user_community.${auth.openid}`).community == request.data.community",
  "update": "doc._openid == auth.openid",
  "delete": false
}
```

> 这份 read 示例已经包含了“别人只能看 posted；自己能看自己的所有状态”的逻辑。
>
> 另外一个容易忽略的点：
> - 如果你的 read 规则里用的是 `doc._openid == auth.openid` 来判断“这是本人”，
>   那么前端在查询“我的商品列表”时，最好也用 `_openid` 去 where（例如 `where({_openid: openid})`）。
>   只用 `ownerId` 这种“客户端自己传的字段”去查，可能会被规则判定为“不安全查询”，直接报 `Permission denied`。

### 2.3 确保 `user_community` 有数据

你的权限规则依赖 `user_community`：

- docId（_id）= 用户 openid
- 字段 `community` = 用户所在小区

如果 `user_community` 没这条记录，`create/read` 都可能被拒绝。

（项目里 `registerUserByIdCard` 云函数会写这张表；如果你之前没走过实名/注册流程，表里可能没有。）

---

## 第 3 步：配置回调地址（非常关键）

`imageAuditCallback` 必须是**公网可访问**的 https 地址（否则 COS “打电话”打不进来）。

你可以用两种方式得到回调 URL（选一种就行）：

### 方式 A（推荐）：HTTP 访问服务

1) 云开发控制台 → HTTP 访问服务
2) 新建一个路径，比如：`/hyyc/audit/callback`
3) 关联云函数：`imageAuditCallback`
4) 设置为“公开访问 / 无需鉴权”
5) 得到一个完整 https 地址，把它填到 `COS_AUDIT_CALLBACK_URL`

### 方式 B：云函数 URL（如果你的控制台里有）

1) 云函数 → `imageAuditCallback`
2) 开通“云函数 URL（https）”
3) 设为公开可访问
4) 复制 URL，填到 `COS_AUDIT_CALLBACK_URL`

你今天踩的坑：

- 找不到“云函数 URL”并不影响，用 HTTP 访问服务也能做回调

---

## 第 4 步：配置云函数环境变量（不要写死在代码里）

环境变量（可以理解为“云函数的配置项”，像你给它填的一张小表）在云开发控制台里配置。

### 4.1 imageAuditStart 的环境变量

- `COS_SECRET_ID`：COS 密钥 ID
- `COS_SECRET_KEY`：COS 密钥 Key
- `COS_AUDIT_BUCKET`：审核桶名（例：`imgs-check-1395663220`）
- `COS_AUDIT_REGION`：地域（上海一般是 `ap-shanghai`）
- `COS_AUDIT_CALLBACK_URL`：回调地址（上面第 3 步拿到的 https 地址）
- `COS_AUDIT_CALLBACK_TOKEN`：回调 token（建议填一个随机字符串，像“暗号”）
- `COS_AUDIT_BIZ_TYPE`：你的策略 BizType（你想“全类型审核”就一定要填它）

### 4.2 imageAuditCallback 的环境变量

- `COS_AUDIT_CALLBACK_TOKEN`：和上面保持一致（用于校验回调请求）

---

## 第 5 步：部署云函数（别忘了“云端安装依赖”）

云函数：

- `imageAuditStart` 依赖 `cos-nodejs-sdk-v5`
- `imageAuditCallback` 用 `wx-server-sdk`

你今天踩的坑（常见）：

- 代码更新后没重新部署，线上还在跑旧逻辑
- 部署时忘记选“云端安装依赖”，导致 SDK 不存在

---

## 第 6 步：验证是否成功（按这个顺序检查）

发布一个商品（带 1~9 张图）后：

1) `goods` 里应该立刻出现/更新一条数据：
   - `status = pending`
   - `auditJobId` 有值
2) `image_audit_jobs` 里会新增一条任务：
   - `status = pending`
   - `images[].state = pending`
3) 等 COS 回调到达后（通常很快）：
   - 全通过：`goods.status = posted`
   - 有违规：`goods.status = need_fix`，并写 `auditNeedFixIdx`
4) 小程序“我的商品”里能看到状态，并能点“重新审核”

---

## 今天踩过的坑（排错速查）

### 1) `collection not exists: image_audit_jobs`

原因：没建集合。  
解决：在云开发数据库新建 `image_audit_jobs`。

### 2) `Conf.DetectType invalid ...`

原因：传了 COS 不认识的 DetectType（比如我们一开始写了 `Terrorist`）。  
解决：**用 BizType（策略ID）**，别乱传 DetectType。你要全类型审核就填 `COS_AUDIT_BIZ_TYPE`。

### 3) `database permission denied (-502003)`

原因：数据库安全规则拦截（跟 COS 密钥无关）。  
解决：`create` 规则用 `request.data.xxx`，别用 `doc.xxx`。

### 4) 审核启动成功但一直没回调

排查：

- `COS_AUDIT_CALLBACK_URL` 是否是公网可访问的 https
- 回调地址是否“无需鉴权/公开访问”
- `COS_AUDIT_CALLBACK_TOKEN` 是否两端一致
- 云函数 `imageAuditCallback` 日志有没有进来

### 5) 审核慢/体验卡

说明：审核是异步的，不建议让用户一直“卡在发布页等审核结束”。  
这套方案是：先保存 → 状态 pending → 审核结果到达后再改状态。

### 6) 回调来了很多次，但商品/任务一直是 pending

现象：

- `imageAuditCallback` 日志里能看到多次回调
- 但 `goods.status` 一直不变（还是 `pending`）

原因（这次踩到的坑）：

- 多张图几乎同时回调时，如果回调处理代码每次都“整段覆盖写回 images 数组”，会出现互相覆盖，导致永远有图片停在 `pending`
- 并发写同一条审核任务（`image_audit_jobs`）时，云开发数据库也可能报 `DATABASE_TRANSACTION_CONFLICT`（冲突=多人同时改同一条）

解决：

- 回调处理时只更新“对应那一张图”的字段（不要整段覆盖写 images 数组）
- 更新完再做一次“是否全部完成”的收口（全部完成才把商品改成 `posted/need_fix`）
- 对 `DATABASE_TRANSACTION_CONFLICT` 做“短暂重试”（失败就让 COS 过一会儿重试回调，避免结果丢失）
- 记得重新部署 `imageAuditCallback`（否则线上还在跑旧逻辑）

---

## 参考文档链接（这次实现里用到/查过的）

> 说明：下面都是官方文档链接；你以后忘了细节，直接点开看对应页就能对上。

### 1) COS / 数据万象（CI）图片审核（核心）

- 图片批量审核（`POST /image/auditing`，支持 `BizType/Async/Callback/DataId`）  
  https://cloud.tencent.com/document/product/1235/108925
- 图片审核回调内容（COS 审核完回调你什么 JSON；含 Simple/Detail，Detail 里有 `JobsDetail`）  
  https://cloud.tencent.com/document/product/1235/108927
- 设置审核策略（在控制台创建/查看 BizType；你要“全类型审核”就靠它）  
  https://cloud.tencent.com/document/product/460/56345
- 查询图片审核任务结果（`GET /image/auditing/<jobId>`，用来排查/兜底查询）  
  https://cloud.tencent.com/document/product/460/68905

（同一份“图片批量审核”文档的国内站镜像，打不开 `.com` 可试这个：  
https://cloud.tencent.cn/document/product/1235/108925 ）

### 2) 云开发 CloudBase（回调 URL / 权限 / 环境变量）

- HTTP 访问云函数（用来把 `imageAuditCallback` 暴露成一个公网 https 回调地址）  
  https://docs.cloudbase.net/service/access-cloud-function
- 云函数环境变量（在哪里配、代码里怎么用 `process.env.xxx` 读）  
  https://docs.cloudbase.net/cloud-function/function-configuration/env
- 数据库安全规则（为什么 create 要用 `request.data.xxx`；以及 `get()` 怎么写）  
  https://docs.cloudbase.net/database/security-rules
- 错误码：DATABASE_COLLECTION_NOT_EXIST（没建集合会报这个）  
  https://docs.cloudbase.net/error-code/basic/DATABASE_COLLECTION_NOT_EXIST  
  （英文镜像： https://docs.cloudbase.net/en/error-code/DATABASE_COLLECTION_NOT_EXIST ）
- 错误码：DATABASE_PERMISSION_DENIED（权限规则拦截会报这个）  
  https://docs.cloudbase.net/error-code/basic/DATABASE_PERMISSION_DENIED  
  （英文镜像： https://docs.cloudbase.net/en/error-code/DATABASE_PERMISSION_DENIED ）
- 云函数快速入门（你给的那份，查云函数/部署/基础概念）  
  https://docs.cloudbase.net/cloud-function/quick-start

### 3) 微信小程序云开发（前端用到的几个 API）

- 上传文件到云存储：`wx.cloud.uploadFile`  
  https://developers.weixin.qq.com/miniprogram/dev/wxcloud/reference-sdk-api/storage/uploadFile/client.uploadFile.html
- 获取云文件临时链接：`wx.cloud.getTempFileURL`（我们把这个临时链接交给 COS 去审核）  
  https://developers.weixin.qq.com/miniprogram/dev/wxcloud/reference-sdk-api/storage/getTempFileURL/client.getTempFileURL.html
- 调云函数：`wx.cloud.callFunction`  
  https://developers.weixin.qq.com/miniprogram/dev/wxcloud/reference-sdk-api/functions/Cloud.callFunction.html
