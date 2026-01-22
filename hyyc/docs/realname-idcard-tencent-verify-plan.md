# 实名注册（身份证照片 + 腾讯身份证识别核验）任务计划清单

日期：2026-01-22

## 目标（按你已确认的规则）

1) 注册页不再让用户手填「姓名 / 身份证号」。  
2) 用户只需要上传：身份证正面（人像面）。  
3) 点「继续」后在后端做校验：
   - 使用腾讯人脸核身（FaceID）的 `IdCardOCRVerification`：
     - 它能从身份证人像面照片里做 OCR（图片文字识别：像把照片里的字“抄出来”）
     - 并返回“姓名和身份证号是否一致”的核验结果（你要的“没问题就注册”）
4) 校验通过：直接注册成功。  
5) 校验不通过：提示用户重新上传身份证（不展示识别结果）。  
6) 身份证照片不保存：校验结束后立即删除云存储里的照片（成功/失败都删）。

参考文档（后面实现时用）：
- 身份证识别及信息核验：`IdCardOCRVerification` 文档：`https://cloud.tencent.com/document/product/1007/37980`

接口能力确认（我从文档里挑出的关键点）：
1) 这个接口**支持传图片**：可以传 `ImageUrl` 或 `ImageBase64`（都是身份证人像面/正面）。  
2) 参数三选一即可：`姓名+身份证号` / `ImageBase64` / `ImageUrl`（同时传会按优先级使用）。  
3) 返回里有 `Result`：
   - `0`：一致（通过）
   - 其他：都当作不通过（让用户重新上传）
4) 图片限制（不满足就容易失败）：
   - 格式：PNG / JPG / JPEG（暂不支持 GIF）
   - `ImageBase64`：Base64 编码后不超过 3M
   - `ImageUrl`：图片下载时间不超过 3 秒，且下载后 Base64 编码不超过 3M
5) 本项目固定只用 `ImageUrl`（临时链接），不传 `ImageBase64`（避免把“大段 Base64 文本”在前端/云函数之间传来传去）。
6) 本项目也不传 `姓名+身份证号`（因为注册页不让用户手填姓名/身份证号）。

---

## 方案选择（实现最快/代码最少）

结论：用 `ImageUrl`（临时链接）方案。

- 前端只做两件事：先压缩照片，再上传云存储；拿到 `fileID` 后传给云函数（不在前端把图片转成 Base64（Base64=把图片变成一大段文字，会更大））。
- 云函数只做三件事：`fileID -> 临时链接(url) -> 调腾讯接口`，最后 `deleteFile` 删除图片（成功/失败都删）。
- 仍要注意接口限制：腾讯会去下载 `ImageUrl` 的图片，所以图片尽量压小一点、清晰一点，才更容易在 3 秒内下载完，也更不容易超过 3M。
- 本期先不处理：邀请码校验、定位校验（不在这里拦截，先把“身份证核验 + 注册”跑通）。

---

## 你最终会得到的流程（先统一理解）

1) 小程序实名页：用户选择身份证正面（人像面）照片（只显示照片缩略图，不显示姓名/身份证号）。  
2) 点击「继续」：
   - 前端先把照片压缩，再上传云存储拿到 `fileID`；
   - 把照片的 `fileID`（云存储文件编号，不传 Base64）+ 其他注册信息（手机号、小区、门牌等）发给云函数。  
3) 云函数（在云端跑的后端代码）：
   - 把身份证正面（人像面）的 `fileID` 转成临时链接（临时链接=短时间内能访问的图片网址）；
   - 用 `IdCardOCRVerification(ImageUrl)`：自动识别并核验（云函数不需要自己转 Base64）；
   - 通过才写入 `userInfo` 完成注册（姓名/身份证号从接口返回里拿）；
   - 最后删除身份证照片（不落库、不缓存）。
4) 云函数返回结果：成功就进入首页；失败就清空照片并提示重新上传。

---

## 任务清单（按开发顺序）

### A. 注册页 UI 改造（只让用户上传身份证）

涉及文件：
- `hyyc/pages/auth/realname/index.wxml`
- `hyyc/pages/auth/realname/index.js`
- `hyyc/pages/auth/realname/index.wxss`

任务：
1) 删除姓名/身份证号的输入框（label + input + 校验提示都去掉）。
2) 新增 1 块上传区：
   - 「身份证正面（人像面）」上传按钮 + 预览 + 删除/重传
3) 文案提示要简单明确（例子）：
   - “请拍清楚、不要反光、别遮挡四角”
   - “请上传本人身份证”
4) 页面状态（data）增加：
   - `idCardFrontFileID`（上传到云存储后的 fileID）
   - `idCardFrontPreview`（本地预览用的临时路径）
   - `idCardUploading`（避免用户一边上传一边点继续）
5) 交互规则：
   - 选图成功后显示缩略图；点缩略图可预览大图（但不展示识别出的文字）。
   - 删除/重传会同时清掉对应的 fileID + 预览图。

校验改动（submit 前）：
- 原本：必须有 `name / idNumber`。
- 改为：必须有 `idCardFrontFileID`。

失败处理（你要求的“重新上传”）：
- 云函数返回失败时：
  - 页面清空图片（fileID + 预览都清空）
  - 提示一句话：
    - `VERIFY_FAIL` / `API_FAIL` / `TEMP_URL_FAIL` / `INVALID_PARAM`：`身份校验失败，请重新上传身份证照片`
    - `OPENID_EXISTS` / `ID_EXISTS`：`该用户已存在，请直接登录`

---

### B. 身份证照片上传策略（只用于校验，用完就删）

涉及文件：
- `hyyc/pages/auth/realname/index.js`（上传逻辑固定在这里实现）

任务：
1) 选择图片方式：固定用 `wx.chooseImage`：
   - `count: 1`（每次只选 1 张）
   - 支持：相册 / 拍照（都要支持）
2) 选择后先压缩：`wx.compressImage`（压缩=把照片变小一点，上传更快、也更容易通过“3 秒下载 / 3M”限制）。
   - 固定压缩一次：`quality = 80`（清晰度和体积的折中）
   - 如果压缩失败：就用原图继续走上传（不要卡死）
   - 页面缩略图用“压缩后的图片”（让你看到的和最终上传的一致）
3) 上传时机：点击「继续」时才上传（避免用户只选了图但没提交，云端留下图片）。
4) 上传方式：`wx.cloud.uploadFile`，上传到云存储。
5) 文件路径（只是路径，不是保存规则，固定生成规则）：
   - `idcard/${Date.now()}_${Math.random().toString(16).slice(2,8)}_front.jpg`（不依赖 openid，少写一段代码）
6) 上传限制（减少失败率）：
   - 单张只允许 1 张
   - 不要在前端 `callFunction` 里直接传 Base64（Base64 数据量更大，也更容易踩到“单次请求大小（一次提交能带多少数据）”）

注意：
- 不把这张照片的 `fileID` 写进 `userInfo`、也不写进本地缓存 `hyyc_user`。
- 前端兜底删图（防止“云端残留”）：
  - 如果图片已经上传成功拿到 `fileID`，但 `callFunction` 调用失败：前端立刻 `deleteFile` 删除图片
  - 页面退出（`onUnload`）时如果还有 `fileID`：再尝试 `deleteFile` 删除一次（尽力而为）

---

### C. 新增云函数：身份证识别核验 + 注册（核心）

新增云函数（用于注册提交）：
- 云函数名：`registerUserByIdCard`

涉及目录（后面实现时会新增）：
- `hyyc/cloudfunctions/registerUserByIdCard/index.js`
- `hyyc/cloudfunctions/registerUserByIdCard/package.json`

入参（前端传，固定）：
- `idCardFrontFileID`
- `form`：注册信息（本期只要求手机号 + 小区门牌，其他字段可选）
  - 必填：`phone`、`community`、`building`、`door`
  - 选填：`nickname`、`floor`、`inviteCode`（本期不校验邀请码，只是随表单一起传/存）
- `agree`：是否同意协议

云函数内部步骤（按顺序做）：
1) 取 openid（云开发提供的用户标识）。
2) 基础校验：
   - 必须同意协议 `agree=true`
   - 必须传入身份证正面 fileID
   - 必须有手机号（你们现在强制走“获取手机号”，继续保留）
3) 先做“重复注册”拦截（省钱也省时间）：
   - openid 已注册：直接返回 `OPENID_EXISTS`
4) 生成“临时图片链接”（给腾讯接口用）：
   - 用云存储的 `idCardFrontFileID` 生成临时 `ImageUrl`（固定有效期 5 分钟）
   - 注意：`IdCardOCRVerification` 的 `ImageUrl/ImageBase64` 是“身份证人像面（正面）”，所以核验只吃正面图
   - 如果用户传的不是正面（比如传了反面）：大概率会识别失败/核验失败，按失败处理让用户重新上传正面
5) 调腾讯接口做“识别 + 核验”：
   - 调 `IdCardOCRVerification(ImageUrl)`
   - 看返回 `Result`：
     - `0`：通过
     - 其他：返回 `VERIFY_FAIL`（前端提示重新上传）
   - 无论通过/不通过/接口报错：都写一条 `realname_verify_logs`（不存照片，只存状态、失败原因、RequestId、身份证后 4 位等）
6) 再做一次“身份证唯一”拦截：
   - `userInfo.where({idNumber})` 已存在：返回 `ID_EXISTS`（前端提示“该用户已存在，请直接登录”）
7) 通过才写入注册信息：
   - 写入 `userInfo`（固定写入规则）：
     - `name` / `idNumber`：从 `IdCardOCRVerification` 返回值里拿
     - `_openid`：写当前用户 openid（保证登录页能用 `_openid` 查到用户）
     - 额外写入状态字段：
       - `realname: true`（表示已实名）
       - `verified: true`（表示已核验通过）
       - `createdAt: new Date()`（创建时间）
     - 其他字段：从 `form` 来（例如 phone/community/building/door/nickname...）
   - 写入 `user_community`（固定规则）：
     - 用 openid 作为 `_id`
     - 写入 `community`
     - 有则更新 `updatedAt`，无则创建 `createdAt/updatedAt`
8) 删除身份证照片（成功/失败都删）：
   - 用 `cloud.deleteFile({ fileList: [idCardFrontFileID] })`
   - 删除失败只记日志，不影响注册结果（但要尽量删）

返回值（给前端，固定）：
- 成功：`{ ok: true, user: {...} }`
- 失败（固定这些 code 和 msg，不把身份证号/姓名塞进 msg）：
  - `AGREEMENT_REQUIRED`：`请先阅读并同意用户协议和隐私政策`
  - `NO_OPENID`：`获取用户身份失败`
  - `INVALID_PARAM`：`缺少必要参数`
  - `TEMP_URL_FAIL` / `API_FAIL` / `VERIFY_FAIL`：`身份校验失败，请重新上传身份证照片`
  - `OPENID_EXISTS` / `ID_EXISTS`：`该用户已存在，请直接登录`

---

### D. 腾讯云侧配置（环境变量 + 依赖）

涉及内容：
1) 在云开发控制台给 `registerUserByIdCard` 配环境变量（像“云端配置表”）：
   - `TENCENT_SECRET_ID`
   - `TENCENT_SECRET_KEY`
   - `TENCENT_REGION=ap-beijing`（固定值，给 SDK 用）
2) 云函数依赖：
   - 使用腾讯云 Node.js SDK（SDK：官方封装好的调用工具，像“遥控器”）
   - 部署云函数时选择“云端安装依赖”

验收点：
- 云函数日志里能看到 `IdCardOCRVerification` 调用成功（失败时能看到错误码，方便排查）。

---

### E. 核验流水（必做，不存照片）

目的：后面有人说“我怎么一直过不了”，你能查到到底是接口调用失败、还是核验没通过。

新增集合（固定）：
- `realname_verify_logs`

只存这些（全部是“非照片”信息，固定字段）：
- `_openid`
- `status`（pass/fail）
- `failCode`（API_FAIL / VERIFY_FAIL / …）
- `requestId`（腾讯接口返回的 RequestId，用来跟腾讯侧对账）
- `createdAt`
- `idNumberLast4`（只存后 4 位，方便定位，不泄露全量）

---

### F. 回归检查（避免改实名页导致别的功能坏）

1) 登录页 `pages/auth/welcome`：
   - 登录成功后仍能查到 `userInfo` 并进入首页（逻辑不变）
2) “我的-账户信息”页：
   - 仍能展示 name/idNumber（从 `userInfo` 来）
   - 仍能保存 nickname/phone/门牌等（逻辑不变）
3) 发布商品/任务：
   - 仍能使用 `u.name` / `u.nickname` 等字段（因为注册后还是会写入 name）

---

## 验收用例清单（你验收时按这个点一遍）

1) 正常通过：
   - 上传清晰正面（人像面） → 点继续 → 注册成功 → 进入首页
2) 上传了反面/遮挡/模糊：
   - `IdCardOCRVerification` 识别/核验失败 → 提示重新上传 → 页面清空图片
3) 身份核验不通过：
   - `IdCardOCRVerification` 返回 Result != 0 → 提示重新上传 → 页面清空图片
4) 同一微信重复注册：
   - 已注册用户再次走实名页 → 提示“该用户已存在，请直接登录”
5) 同一身份证重复注册：
   - 不同微信用同一身份证 → 提示“该用户已存在，请直接登录”
6) 云存储不残留：
   - 成功/失败后，云存储里不应长期存在 `idcard/...` 的图片（用控制台抽查）
