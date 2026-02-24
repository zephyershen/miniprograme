# 实名页：一键获取微信昵称 + 手机号（可重新部署）

日期：2026-01-21

## 目标（做了什么）

在 `pages/auth/realname`（实名注册页）里，让用户**自己点按钮**并在微信弹窗里点“允许”，然后：

- 把**微信昵称**填到“昵称”输入框里（用户也可以手动改）。
- 把**微信手机号**自动填到“手机号”输入框里（输入框置灰，不允许手动改）。

## 页面上的效果（用户会看到什么）

### 1）昵称：用户可手填，也可一键选择微信昵称（腾讯新版规则）

- 位置：表单第一项「昵称」输入框 + 右侧按钮「获取」。
- 发生的事：
  - 用户可以直接手动输入昵称。
  - 也可以点右侧「获取」，页面会把光标放到昵称输入框并弹出键盘；
    然后用户在**键盘上方**点“选择微信昵称”，昵称就会自动填入。
- 说明：这是微信现在推荐的做法（昵称不会再像以前那样直接返回给小程序，需要用户自己点一下确认）。

### 2）手机号：点“获取”→弹授权→回填手机号（输入框置灰不可编辑）

- 位置：「手机号」右侧按钮「获取」（按钮使用 `open-type="getPhoneNumber"`）。
- 发生的事：
  - 用户点击后会弹出微信授权弹窗。
  - 用户点“允许”后，前端会拿到一个 `code`（它不是手机号，只是一次性“换手机号的票据”）。
  - 前端把 `code` 发给云函数，云函数再去微信那边把真实手机号换回来。
  - 成功后写入 `form.phone`，并把 `phoneVerified` 设为 `true`，按钮文案会从「获取」变成「已获取」（并禁用按钮，避免重复点）。
  - 如果没点“获取手机号”，提交时会提示“请点击右侧“获取”授权手机号”。

## 涉及的文件（改了哪些 / 新增了哪些）

### A. 页面（实名页）

- 修改：`hyyc/pages/auth/realname/index.wxml`
  - 「昵称」一行：
    - 输入框可编辑，并设置 `type="nickname"`（支持从键盘上方一键选微信昵称）。
    - 右侧按钮 `bindtap="onGetWechatProfile"` 用于聚焦输入框并提示用户从键盘上方选择微信昵称。
  - 「手机号」一行：
    - 输入框置灰 + 禁用（不可编辑）。
    - 启用按钮 `open-type="getPhoneNumber"`，事件 `bindgetphonenumber="onGetPhoneNumber"`。
    - `phoneVerified` 为 true 时禁用按钮并显示「已获取」。

- 修改：`hyyc/pages/auth/realname/index.js`
  - `onGetWechatProfile()`：不再走 `wx.getUserProfile`；改为聚焦昵称输入框，让用户从键盘上方一键选微信昵称。
  - 使用 `exchangePhoneNumber(code)` 把手机号换回来，失败时优先展示后端返回的 `msg`。

- 修改：`hyyc/pages/auth/realname/index.wxss`
  - 新增 `.control-disabled` / `.placeholder-disabled`：用于输入框置灰显示。

### B. 前端 API（把 code 发给云函数）

- 修改：`hyyc/utils/api.js`
  - `exchangePhoneNumber(wxCode)`：从“mock 假数据”改为**调用云函数** `exchangePhoneNumber`。

### C. 云函数（真正去微信换手机号）

- 新增：`hyyc/cloudfunctions/exchangePhoneNumber/index.js`
  - 用 `cloud.openapi.phonenumber.getPhoneNumber({ code })` 换手机号。
  - 返回结构：`{ ok: true, phoneNumber }` 或 `{ ok: false, msg }`。

- 新增：`hyyc/cloudfunctions/exchangePhoneNumber/config.json`
  - 声明云函数需要调用的微信接口权限（不加可能会报 `system error: error code: -604101`）。
  - 注意：这个文件必须是**标准 JSON**（不能有注释、不能多逗号）。

- 新增：`hyyc/cloudfunctions/exchangePhoneNumber/package.json`
  - 依赖 `wx-server-sdk`。

### D. 隐私/合规声明（说明一下）

- `hyyc/app.json` 里的 `requiredPrivateInfos`：你们当前开发者工具会校验这个字段只允许“定位相关”的值（例如 `getLocation`）。
- 所以**不要**把 `getUserProfile` / `getPhoneNumber` 写进 `requiredPrivateInfos`，否则会直接编译报错。
- 昵称/手机号的授权弹窗，分别由：
  - `wx.getUserProfile({ desc })`（昵称）
  - 按钮 `open-type="getPhoneNumber"`（手机号）
 触发，不依赖 `requiredPrivateInfos`。

### E. 兼容显示（可选，但建议保留）

- 修改：`hyyc/pages/goods/detail/index.js`
  - 卖家昵称显示优先用 `seller.nickname`（兼容你们实名页字段），再兜底 `seller.nickName` / `seller.name`。

## 重新部署步骤（按这个做就能跑起来）

### 1）部署云函数 `exchangePhoneNumber`

在微信开发者工具里：

1. 打开云开发面板（你们项目已在 `app.js` 里初始化云环境）。
2. 找到云函数列表里的 `exchangePhoneNumber`。
3. 上传并部署：选择“云端安装依赖”（第一次部署必须装依赖）。

如果不部署云函数，页面会提示类似“获取手机号失败（云函数未部署或未开通能力）”。

### 2）在小程序后台开通“获取手机号”能力

如果后台没开通能力，用户点“获取手机号”时，前端可能拿不到 `code`，会提示类似“未开通获取手机号能力”。

（具体入口以微信后台页面为准，核心就是：把“获取手机号”这个能力打开。）

### 3）真机验证

1. 进入「实名注册」页：`/pages/auth/realname/index`
2. 点「昵称-获取」：
   - 键盘弹出 → 在键盘上方选择微信昵称 → 昵称自动填入（也可以不点获取，直接手填）
3. 点「手机号-获取」：
   - 允许 → 手机号自动填充，按钮变“已获取”
   - 拒绝 → toast 提示取消

## 备注（和数据保存的关系）

- 昵称/手机号只是“回填到表单里”，真正写进数据库是在你点击「继续」并成功注册后：
  - 注册逻辑在云函数：`hyyc/cloudfunctions/registerUserByIdCard/index.js`
  - 写入集合：`userInfo`
