# HYYC 小区任务小程序代码地图（miniprograme/hyyc）

本文件是 HYYC 小区任务小程序的开发说明，重点回答几个问题：

- 每个「文件夹 / 文件 / 函数」是干什么的。
- 这个文件对应小程序里的哪个页面、哪个按钮、哪一块 UI。
- 写接口或做联调时，应该改哪里。

> 说明：尽量不用专业词。少数必要词会用括号补一句，方便以后查。

---

## 1. 总体结构一览

项目根目录：`miniprograme/hyyc`

- 全局入口与配置：`app.js` / `app.json` / `app.wxss`
- 页面代码：`pages/**`
- 通用组件：`components/**`
- 工具函数：`utils/**`
- 业务配置：`config/**`
- 静态资源（动画等）：`assets/**`
- 主题样式：`styles/shadcn.wxss`
- 云函数：`cloudfunctions/**`
- 开发脚本：`scripts/**`
- 构建配置：`project.config.json` / `project.private.config.json` / `sitemap.json`
- 包管理配置：`package.json` / `package-lock.json`
- 第三方库（不用改）：`miniprogram_npm/**`、`node_modules/**`

后文会按这个顺序展开。

---

## 2. 根目录与全局入口

### 2.1 `app.json` —— 全局页面 & 底部标签栏

- 作用：告诉小程序「有哪些页面」「启动顺序」「底部 tab 栏长什么样」。
- 对应页面 / 按钮：
  - 启动首页：`pages/home/index/index`（底部 tab 里的「首页」）。
  - 注册相关：
    - `pages/auth/welcome/index`：欢迎页（客厅 Lottie 动画，一个会动的客厅插画，带登录/注册两个大按钮）。
    - `pages/auth/realname/index`：实名注册页。
  - 任务相关：
    - `pages/task/publish/index`：发布任务页（底部 tab 里的「发布」）。
    - `pages/task/detail/index`：任务详情页，从任务列表/我的任务点进。
    - `pages/task/submit/index`：提交任务完成页。
  - 聊天：
    - `pages/chat/room/index`：聊天室页，任务详情里的「先沟通 / 聊天」按钮跳转到这里。
  - 钱包：
    - `pages/wallet/index/index`：钱包页，「我的钱包」入口对应。
  - 我的：
    - `pages/profile/index/index`：「我的」页面，底部 tab 里的第三项。
  - 我的任务：
    - `pages/my/tasks/index`：「我的任务」列表，从「我的」页面点击进入。

- tabBar 配置（底部三个入口）：
  - 「首页」→ `pages/home/index/index`
  - 「发布」→ `pages/task/publish/index`
  - 「我的」→ `pages/profile/index/index`

- 其它关键字段：
  - `window`：设置所有页面的标题文字、顶部导航栏颜色、背景色等。
  - `requiredPrivateInfos: ["getLocation"]`：
    - 告诉微信，这个小程序会用到「获取地理位置」能力。
    - 实际使用位置：`pages/auth/realname/index.js` 中的 `getLocation()` 函数，用来判断用户是否在配置的小区范围内。
  - `permission.scope.userLocation.desc`：定位授权弹窗中显示的说明文案。
  - `lazyCodeLoading: "requiredComponents"`：按需加载组件，减少首屏包体积（一般无需修改）。

### 2.2 `app.js` —— 小程序入口逻辑

- 对应：整个小程序的启动，不对应某一个具体页面或按钮。
- 主要数据字段：
  - `globalData.user`：当前登录/实名用户的基本信息（后续页面会从这里或本地缓存里取）。
  - `globalData.community`：当前小区信息（目前主要从配置和实名信息中读）。
- 主要函数：
  - `onLaunch()`：小程序第一次被打开时自动执行。
    - 初始化云开发环境：
      - 调用 `wx.cloud.init({ env, traceUser })`。
      - 为后面的 `wx.cloud.database()` 和 `wx.cloud.callFunction()` 做准备。
      - 被 `pages/auth/realname/index.js`（写入云数据库）、`pages/profile/index/index.js`（测试云函数）间接依赖。
    - 主动加载自定义字体：
      - 使用 `wx.loadFontFace` 把「XiongKid」字体下载到本地。
      - 视觉效果：欢迎页、标题等地方会使用这套手写风格字体。
    - 打印 `console.log('HYYC UI app launch')`，方便调试启动是否正常。

### 2.3 `app.wxss` —— 全局样式

- 对应：所有页面的基础背景、文字样式，不单独对应某个按钮。
- 关键内容：
  - `@import "styles/shadcn.wxss";` 把整套主题系统引进来。
  - 定义全局字体：
    - 使用前面加载的 `XiongKid` 字体作为优先字体之一。
  - `page { ... }`：
    - 统一所有页面的背景色（浅米白）和字体族。
  - `.safe`：
    - 用 `env(safe-area-inset-bottom)` 适配 iPhone 刘海屏底部安全区域。
    - 使用位置：需要防止底部按钮被挡住时，在容器上加 `class="safe"`。

### 2.4 `project.config.json` / `project.private.config.json` —— 微信开发者工具配置

- 对应：微信开发者工具的工程配置，不直接对应任何页面或按钮。
- `project.config.json`（公共配置）：
  - 指定项目类型、使用的基础库版本、是否压缩 JS/WXSS/WXML 等。
  - 开启云函数目录 `cloudfunctions/`。
- `project.private.config.json`（本机私有配置）：
  - 本地调试相关开关，例如：
    - 是否开启热重载（修改代码后自动刷新）。
    - 是否关闭「域名校验」方便本地调试。
  - 只影响本机开发体验，不影响线上用户。

### 2.5 `sitemap.json` —— 页面收录规则

- 作用：告诉微信爬虫哪些页面允许被搜索收录。
- 当前配置：`"page": "*", "action": "allow"`，代表所有页面都允许被收录。
- 不直接对应页面上的按钮，只和搜索曝光相关。

### 2.6 `package.json` / `package-lock.json` —— 包管理配置

- 对应：Node 包管理配置，只在本地开发/构建时使用，不直接出现在小程序运行环境中。
- 主要依赖：
  - `lottie-miniprogram`：
    - 用于播放 Lottie 动画（一种矢量动画格式，相当于会动的插画）。
    - 具体使用位置：
      - `components/ui/loading/index.js`：购物袋加载动画。
      - `pages/auth/welcome/index.js`：客厅欢迎动画。
  - `@babel/runtime`：
    - JS 语法兼容工具（类似一个「翻译器」，让新语法在旧环境也能跑）。

### 2.7 本开发文档

- `hyyc-miniapp-code-map.md`（本文件）：
  - 作用：开发文档，不参与运行。
  - 建议：以后新增页面或函数时，在对应章节补一条说明，方便团队成员快速上手。

---

## 3. 主题样式：`styles/`

### 3.1 `styles/shadcn.wxss` —— 统一的 UI 设计系统

- 对应：所有页面的颜色、间距、按钮风格。
- 不直接和某一个按钮绑定，但几乎所有按钮、卡片都引用这里的类名。
- 重要类目举例：
  - 颜色相关：
    - `.color-primary` / `.bg-primary`：应用的主色（珊瑚红），用在主要按钮、关键文字。
    - `.color-success` / `.color-error`：成功/错误提示颜色。
  - 布局相关：
    - `.row` / `.col`：横向/纵向布局。
    - `.space-between` / `.wrap`：两端对齐、自动换行。
  - 文字相关：
    - `.text-sm` / `.text-lg` / `.text-xl`：不同字号。
    - `.bold` / `.font-semibold`：强调文字。
  - 按钮相关：
    - `.btn`：所有按钮的基础样式。
    - `.btn-primary` / `.btn-outline` / `.btn-info` 等：不同用途的按钮风格。
    - `.btn-sm`：小尺寸按钮，例如「上传图片」「查看」。
  - 表单相关：
    - `.field` / `.field-label` / `.input` / `.textarea`：表单容器、标题、输入框。
  - 卡片相关：
    - `.card` / `.card-title` / `.card-sub`：任务卡片、个人信息卡片等。

- 典型使用页面：
  - `pages/home/index/index.wxml` 中的任务列表和筛选标签。
  - `pages/task/publish/index.wxml` 中的输入表单和「清空 / 发布」按钮。
  - `pages/auth/realname/index.wxss` 中也基于此做了更「苹果风」的一层定制。

---

## 4. 静态资源：`assets/`

### 4.1 `assets/lottie/living-room.json` & `living-room.js`

- 作用：客厅主题的 Lottie 动画（一张会动的客厅插画）。
- `.json`：从设计工具导出的原始动画文件。
- `.js`：把 `.json` 包装成 JS 模块（`module.exports = {...}`），方便在小程序里 `require`。
- 使用位置 / 对应页面：
  - `pages/auth/welcome/index.js`：
    - 在欢迎页顶部的「客厅动画」区域，通过 `playLottie()` 函数播放。
    - 对应的 WXML：`<canvas id="hero-canvas" ... />`。

### 4.2 `assets/lottie/shopping-bag.json` & `shopping-bag.js`

- 作用：购物袋主题的 Lottie 动画（会动的购物袋图标）。
- `.json`：原始动画文件。
- `.js`：由脚本生成的 JS 模块。
- 使用位置 / 对应页面：
  - `components/ui/loading/index.js`：
    - 在「全屏加载中」弹层里播放。
    - 任何页面只要用 `<ui-loading show="{{isLoading}}" />`，就会显示这一动画。
  - 典型调用页面：
    - `pages/home/index/index`、`pages/task/publish/index`、
      `pages/task/detail/index`、`pages/task/submit/index`、
      `pages/chat/room/index`、`pages/wallet/index/index`、
      `pages/profile/index/index`、`pages/my/tasks/index`、
      `pages/auth/realname/index` 等。

---

## 5. 工具函数：`utils/`

### 5.1 `utils/api.js` —— 模拟接口（后续可换成真接口）

- 说明：现在全部是「假接口」，主要为了前端联调时有个流程。接入后台后可以在这里统一改成真实请求。
- 函数列表：
  - `delay(ms)`：
    - 简单的等待工具，用 `setTimeout` 包了一层 `Promise`。
    - 仅在本文件内部使用。
  - `async sendSmsCode(phone)`：
    - 模拟「发送短信验证码」，只打印日志并等待 400ms。
    - 当前代码里未直接被页面调用，保留给以后扩展。
  - `async verifySmsCode(phone, code)`：
    - 模拟「校验验证码」，把 `code === '123456'` 当作验证通过。
    - 当前未被页面使用。
  - `async exchangePhoneNumber(wxCode)`：
    - 模拟「通过微信 one-tap 授权换取用户手机号」。
    - 入参：微信返回的 `code`。
    - 返回：固定手机号 `13800138000`。
    - 对应页面 / 按钮：
      - `pages/auth/realname/index.js` 里的 `onGetPhoneNumber()` 函数会调用它。
      - WXML 中这一按钮暂时被注释掉，等小程序后台开通能力后再启用。
  - `async validateInvite(inviteCode, building, door)`：
    - 模拟「校验小区邀请码」。
    - 规则：邀请码等于 `HYYC2025` 时判定为正确。
    - 对应页面 / 按钮：
      - `pages/auth/realname/index.js` 的 `submit()` 中调用，在用户点「继续」按钮提交实名时校验邀请码。

### 5.2 `utils/mock.js` —— 本地假数据

- 导出对象：
  - `tasks`：一组任务列表，包含：
    - `title`：任务名称（如「帮忙取快递」）。
    - `amount`：佣金。
    - `deadline`：截止时间（时间戳）。
    - `community`、`address`、`building`：小区和楼栋信息。
    - `owner`：任务发布人。
    - `status`：任务状态（目前统一 `posted`）。
  - `user`：假用户数据，用于演示「我的」「钱包」等页面。
  - `walletFlows`：钱包收支明细。
- 使用位置 / 对应页面：
  - 首页任务列表：`pages/home/index/index.js`（加载任务广场）。
  - 任务详情：`pages/task/detail/index.js`（根据 `id` 找到对应任务）。
  - 我的任务：`pages/my/tasks/index.js`（两种「我发布的 / 我接受的」列表共用同一批数据）。
  - 钱包：`pages/wallet/index/index.js`（余额和流水）。

### 5.3 `utils/format.js` —— 金额与日期格式化

- 函数：
  - `formatMoney(n)`：
    - 把金额格式化为两位小数字符串，如 `8.8` → `"8.80"`。
    - 使用位置：
      - 列表、详情、钱包、我的任务等所有展示金额的页面。
  - `formatDate(ts)`：
    - 把时间戳转成 `"YYYY-MM-DD"` 格式。
    - 使用位置：
      - 首页任务列表、任务详情、我的任务列表里的截止日期。

### 5.4 `utils/validators.js` —— 表单校验

- 函数：
  - `required(v, msg)`：
    - 判断值是否为空（`null`/`undefined`/空字符串）。
    - 返回：错误消息字符串或空字符串。
    - 使用位置：
      - `pages/auth/realname/index.js`：实名表单。
      - `pages/task/publish/index.js`：发布任务表单。
  - `isPhone(v)`：
    - 简单检查手机号是否为 1 开头的 11 位数字。
    - 使用位置：
      - `pages/auth/realname/index.js` 的手机号校验。
  - `isIdNumber(v)`：
    - 检查是否为 15 位或 18 位身份证号。
    - 使用位置：
      - `pages/auth/realname/index.js` 的身份证号校验。

### 5.5 `utils/ui.js` —— 小提示封装

- 函数：
  - `toast(title, icon='none')`：
    - 封装 `wx.showToast`，用来在页面底部弹出一条轻提示。
    - 使用位置 / 对应按钮：
      - 实名提交成功、任务发布成功、接受任务、确认完成、提交验收等按钮点击后都用它提示结果。
  - `confirm(content, title='提示')`：
    - 封装 `wx.showModal` 并返回 `Promise`，用来做确认对话框。
    - 使用位置 / 对应按钮：
      - `pages/task/detail/index.js` 里的「确认完成」按钮，在打款前弹出确认框。

### 5.6 `utils/geo.js` —— 距离计算

- 函数：
  - `distanceMeters(lat1, lon1, lat2, lon2)`：
    - 根据经纬度计算两点之间的直线距离（单位：米），用的是地球半径的近似公式。
    - 使用位置 / 对应按钮：
      - `pages/auth/realname/index.js` 的 `getLocation()`：
        - 用户点击「获取定位」按钮后，调用 `wx.getLocation` 获取当前位置，再用本函数计算与小区中心点的距离。
        - 结果用来判断 `inCommunity` 是否为 `true`，并更新页面上的「已在/不在小区范围」提示。

### 5.7 `utils/util.js` —— 日志页面的时间格式化

- 函数：
  - `formatTime(date)`：
    - 把 JS `Date` 对象转成 `"YYYY/MM/DD hh:mm:ss"` 格式。
    - 内部用到 `formatNumber(n)` 把一位数补 0。
  - 使用位置 / 对应页面：
    - `pages/logs/logs.js`：
      - 小程序官方示例日志页，用本函数格式化每条日志的时间。

---

## 6. 业务配置：`config/`

### 6.1 `config/community.js` —— 小区信息与地理围栏

- 导出对象：
  - `name`：当前小区名称，例如 `"花语云萃"`。
  - `center`：小区中心点坐标 `{ lat, lng }`，用的是微信默认的 GCJ-02 坐标（微信 `getLocation` 返回的类型）。
  - `radiusMeters`：小区半径（单位：米），在这个距离内视为在小区内。
- 使用位置 / 对应页面：
  - `pages/auth/realname/index.js`：
    - 读取 `community.name` 作为表单默认小区名。
    - 在 `getLocation()` 中结合 `distanceMeters` 计算当前用户是否在 `radiusMeters` 范围内。
    - 结果决定实名页面上「实时定位」那一行的文案，以及是否允许提交。

---

## 7. 通用组件：`components/`

### 7.1 `components/ui/button` —— 通用按钮组件

- 文件列表：
  - `index.json`：
    - `"component": true`，声明这是一个自定义组件。
  - `index.wxml`：
    - 渲染真实的 `<button>` 标签。
    - 内部结构：
      - 主体文字：通过 `<slot></slot>`，由外部决定，比如「发布任务」「提交」等。
      - `{{loading}}` 为 `true` 时，在文字后显示省略号 `…`。
      - `{{disabled}}` 为 `true` 时，在文字后显示「(禁用)」提示。
  - `index.wxss`：
    - 引入 `styles/shadcn.wxss`，按钮的视觉风格由全局样式控制。
  - `index.js`：
    - 属性（可从 WXML 传入）：
      - `type`：按钮风格，`primary/outline/ghost/danger`。
      - `size`：按钮大小，`base/sm`。
      - `loading`：是否显示加载状态。
      - `disabled`：是否禁用点击。
    - `data`：
      - `typeClass` / `sizeClass`：根据 `type` 和 `size` 自动计算出的样式类名。
    - 函数：
      - `onTap()`：
        - 对应事件：组件外层写 `bind:tap="..."` 时，这里会在按钮真正被点击后触发。
        - 安全保护：如果 `loading` 或 `disabled` 为 `true`，则直接返回，不再往外冒泡。
      - 观察者 `'type,size'`：
        - 根据传入的 `type` 和 `size`，计算 `typeClass` / `sizeClass`，例如把 `type="primary"` 转成 `btn-primary`。
- 使用位置 / 对应按钮：
  - 所有 `<ui-button>` 即使用了该组件，例如：
    - 实名页的「继续」按钮。
    - 发布页的「发布」按钮。
    - 提交验收的「提交验收」按钮。
    - 钱包页返回按钮、任务详情页的操作按钮等。

### 7.2 `components/ui/card` —— 通用卡片

- 文件：
  - `index.json`：声明组件。
  - `index.wxml`：
    - 上方一行标题 `{{title}}` + 右侧 `extra` 槽位（可放按钮等）。
    - 下方内容区域显示默认插槽内容。
  - `index.wxss`：引入全局样式。
  - `index.js`：
    - 属性：
      - `title`：标题文字。
      - `sub`：副标题/说明文字。
    - 无自定义方法。
- 使用位置 / 对应区域：
  - 首页任务卡片。
  - 钱包余额卡片、流水卡片。
  - 我的页面上的「账户信息」「导航」卡片等。

### 7.3 `components/ui/field` —— 表单项容器

- 文件：
  - `index.json`：声明组件。
  - `index.wxml`：
    - 上面是 `label` 标签文字，中间是 slot 放具体输入控件（`<input>` / `<textarea>` / `<picker>` 等），下面根据 `error` 是否有值显示错误文字。
  - `index.wxss`：引入全局字段样式。
  - `index.js`：
    - 属性：
      - `label`：表单字段标题。
      - `error`：错误文案字符串。
- 使用位置 / 对应区域：
  - 发布任务页的所有输入项。
  - 提交验收页中的「完成说明」「上传凭证」区域。
  - 部分其它表单结构也会用相同思路。

### 7.4 `components/ui/loading` —— 全屏加载组件

- 文件：
  - `index.json`：
    - `"component": true`，声明组件。
  - `index.wxml`：
    - 外层 `.loading-mask` 半透明全屏遮罩。
    - 中间 `card` 风格的白色卡片。
    - 内部包括：
      - `<canvas id="loading-canvas" ...>`：播放购物袋 Lottie 动画。
      - 文案 `{{text}}` + 三个跳动的小圆点。
  - `index.wxss`：
    - 定义遮罩层位置、卡片尺寸、动画点的样式和关键帧。
  - `index.js`：
    - 属性：
      - `show`：是否显示遮罩层。
      - `text`：显示的文字，例如「正在加载」。
    - 观察者：
      - `show(val)`：
        - `true` 时调用 `playLottie()`，`false` 时调用 `stopLottie()`。
    - 生命周期：
      - `ready()`：组件渲染完成，如一开始就 `show=true`，会补播一次动画。
      - `detached()`：组件销毁时，停止动画并清理实例。
    - 方法：
      - `playLottie()`：
        - 查询 `#loading-canvas` 节点，结合屏幕宽度和像素比设置 canvas 大小。
        - 调用 `lottie.setup(canvas)` 并播放 `shoppingBagAnim` 动画。
      - `stopLottie()`：
        - 调用动画实例的 `destroy()` 方法并清空引用，防止内存泄漏。
- 使用位置 / 对应按钮：
  - 所有有「数据加载」或「提交中」状态的页面顶部都会先放一个 `<ui-loading show="{{isLoading}}" />`：
    - 比如首页加载任务、发布任务点击「发布」后、实名认证提交、提交验收、打开聊天历史、加载钱包数据、加载个人信息等。

### 7.5 `components/chat/bubble` —— 聊天气泡

- 文件：
  - `index.json`：声明组件。
  - `index.wxml`：
    - 左右两侧的头像 + 中间对话气泡，根据 `mine` 控制气泡出现在左边还是右边。
  - `index.wxss`：
    - 定义 `.bubble`、`.bubble-mine`、`.bubble-other` 的底色和边框，以及自己消息/对方消息的配色。
  - `index.js`：
    - 属性：
      - `mine`：布尔值，为 `true` 时表示「自己发的消息」，消息气泡靠右。
      - `text`：消息内容文本。
    - 无额外方法。
- 使用位置 / 对应页面：
  - `pages/chat/room/index.wxml` 的消息列表，每一条消息是一个 `<chat-bubble>`。

---

## 8. 业务页面：`pages/`

### 8.1 `pages/auth/realname` —— 实名注册页

- 对应页面 / 按钮：
  - 页面：顶部标题「验证花语云萃业主身份」，整个实名表单页面。
  - 主要按钮/交互：
    - 「获取定位」按钮：点击后获取当前位置并判断是否在小区范围内。
    - 「继续」按钮：点击后提交实名信息。
    - （预留）获取手机号按钮：WXML 中被注释掉，等开通「获取手机号」能力后启用。

#### 8.1.1 `index.json`

- 声明使用的组件：
  - `ui-button`、`ui-field`、`ui-loading`。
- 设置导航栏标题为「实名注册」。

#### 8.1.2 `index.wxml`

- 结构：
  - `<ui-loading show="{{isLoading}}" />`：接口请求或定位时显示加载遮罩。
  - `.hero`：顶部文案，说明实名用途。
  - `.panel`：主体表单区域。
    - 表单字段：
      - 姓名、身份证号、手机号、小区名称。
      - 楼栋（picker 下拉）+ 门号（多列 picker）。
      - 小区邀请码。
      - 实时定位状态（文字 +「获取定位」按钮）。
  - `.actions` 区域：
    - 「继续」按钮，绑定 `bindtap="submit"`。

#### 8.1.3 `index.wxss`

- 为实名页面单独定制了「苹果风」渐变背景和表单样式。
- 主要样式类：
  - `.apple`：整体背景渐变。
  - `.hero` / `.h1` / `.sub`：顶部标题和说明。
  - `.panel` / `.group` / `.label` / `.control`：表单布局。
  - `.hint.ok` / `.hint.warn`：定位结果的绿色/橙色提示。
  - `.btn-primary` / `.btn-outline` 等：局部覆盖按钮样式，让「继续」按钮更突出。

#### 8.1.4 `index.js`

- 数据字段 `data`：
  - `form`：表单内容，包括 `name`、`idNumber`、`phone`、`inviteCode`、`community`、`building`、`floor`、`unit`、`door`。
  - `errors`：每个字段的错误消息。
  - `buildingRange`：楼栋选择列表（"1栋" 到 "23栋"）。
  - `buildingIndex`：当前选中的楼栋下标。
  - `doorRange`：门号选择列表，包含楼层数组和户号数组。
  - `doorIndex`：当前选中的楼层和户号下标。
  - `MAX_FLOOR`：最大楼层数 33。
  - `phoneVerified`：手机号是否通过一键授权（当前逻辑弱化，仅保留字段）。
  - `isLoading`：整页 loading 状态，对应 `<ui-loading> show`。
  - `inCommunity`：当前定位是否在小区范围内。
  - `locationText`：定位结果说明文字。
- 函数：
  - `onInput(e)`：
    - 根据 `data-key` 更新 `form` 某个字段。
    - 对应 WXML 中所有 `<input>` 的实时输入。
  - `onLoad()`：
    - 初始化楼栋与门号选择列表：
      - 楼栋：`1-23栋`。
      - 楼层：`1-MAX_FLOOR 楼`。
      - 户号：`01户-04户`。
  - `onBuilding(e)`：
    - 处理楼栋 picker 的变更，根据用户选项更新 `buildingIndex` 和 `form.building`。
  - `onDoorChange(e)`：
    - 处理多列门号 picker 的变更。
    - 计算楼层+户号组合得到门牌号，如 `7楼 + 01户 → door = "701"`。
  - `async onGetPhoneNumber(e)`：
    - 预留的一键获取手机号逻辑：
      - 从 `e.detail` 中取出 `code` 和 `errMsg`。
      - 根据不同错误情况给出不同人类可读提示（用户取消、未开通能力等）。
      - 调用 `exchangePhoneNumber(code)`，成功后更新 `form.phone` 和 `phoneVerified`。
    - 当前页面 WXML 中暂未启用该按钮，但逻辑已经写好，方便以后打开。
  - `async getLocation()`：
    - 用户点击「获取定位」按钮后调用。
    - 调用 `wx.getLocation` 获取当前经纬度。
    - 用 `distanceMeters` 对比 `config/community` 中配置的中心点和半径。
    - 结果：
      - 更新 `inCommunity` 布尔值。
      - 更新 `locationText` 文案，如「已在花语云萃范围内（~120m）」或「不在小区范围」。
  - `goBack()`：
    - 尝试返回上一个页面，如果失败则切换到底部「首页」 tab。
  - `submit()`：
    - 对应 WXML 中的「继续」按钮。
    - 步骤：
      1. 使用 `required`、`isPhone`、`isIdNumber` 对表单逐项校验，把错误信息写入 `errors`。
      2. 如果有错误，直接 `setData({ errors })` 并中断。
      3. 定义内部异步函数 `checkAll()`：
         - 调用 `validateInvite` 校验小区邀请码。
         - 检查 `inCommunity`，如果不在范围，提示「请在小区内完成定位」。
      4. 等 `checkAll()` 全部通过后：
         - 调用 `db.collection(USER_COLLECTION).add(...)` 把实名信息写入云数据库。
         - 在本地 `wx.setStorageSync('hyyc_user', {...})` 存一份，供后续页面快速读取。
         - 弹出「实名完成」提示。
         - 切换到底部「首页」 tab。

---

### 8.2 `pages/auth/welcome` —— 欢迎页（客厅动画）

- 对应页面 / 按钮：
  - 页面：首次打开小程序且尚未实名时，从首页跳转到的欢迎页。
  - UI 元素：
    - 顶部大号 Lottie 客厅动画。
    - 中部「欢迎各位业主」标题和说明。
    - 底部两个按钮样式的块：
      - 「登录」
      - 「注册」
    - 目前这两个按钮还没有 `bindtap` 事件，后续可以在这里接入登录/注册流程。

#### 8.2.1 `index.json`

- 只设置了导航栏标题「欢迎」，暂未声明自定义组件。

#### 8.2.2 `index.wxml`

- `<view class="welcome-page">`：整体布局。
- `hero-lottie-box` + `<canvas id="hero-canvas">`：用来播放 `living-room` 动画。
- `.actions` 区域的两个 `view` 分别显示「登录」「注册」。

#### 8.2.3 `index.wxss`

- 设置背景色与 Lottie 动画背景一致的浅橙色。
- 调整卡片的阴影、圆角、字体为更温暖的风格。
- `.action-login`、`.action-register` 为两种按钮样式（渐变和白底虚线）。

#### 8.2.4 `index.js`

- 数据：当前只用一个空对象 `data: {}`。
- 函数：
  - `onReady()`：
    - 页面首次渲染完成后调用 `playLottie()` 播放客厅动画。
  - `onHide()` / `onUnload()`：
    - 页面隐藏或销毁时调用 `stopLottie()` 停止动画，释放资源。
  - `playLottie()`：
    - 查询 `#hero-canvas` 节点，按屏幕宽度计算 canvas 尺寸。
    - 使用 `wx.getWindowInfo()`（老版本回退到 `wx.getSystemInfoSync()`）获取 `pixelRatio`。
    - 设置动画循环播放，并把速度调成原来的一半，让动作更柔和。
  - `stopLottie()`：
    - 调用动画实例的 `destroy()` 方法并清空引用。

---

### 8.3 `pages/home/index` —— 首页任务广场

- 对应页面 / 按钮：
  - 底部 tab 第一项「首页」。
  - 页内元素：
    - 顶部「本小区任务」标题。
    - 右上角「发布任务」按钮（`goPublish()`）。
    - 筛选标签一排四个：
      - 「全部」「最新」「高佣金」「本楼栋」。
    - 任务列表卡片，每条里有「详情」按钮。

#### 8.3.1 `index.json`

- 声明使用组件：
  - `ui-card`、`ui-button`、`ui-loading`。
- 设置标题为「任务广场」。

#### 8.3.2 `index.wxml`

- 顶部 `<ui-loading show="{{isLoading}}" />`。
- 标题和「发布任务」按钮：
  - 「发布任务」绑定 `bindtap="goPublish"`。
- 筛选标签：
  - 每个标签是一个 `<view class="badge ...">`，`data-k` 分别为 `"all"|"new"|"money"|"building"`。
  - 点击调用 `changeFilter` 更新筛选。
- 任务列表：
  - 使用 `<block wx:for="{{list}}">` 渲染。
  - 卡片右侧「详情」按钮：
    - 绑定 `bindtap="toDetail"`，通过 `data-id` 传入任务 ID。
- 无数据提示：
  - `wx:if="{{!list.length}}"` 时显示「暂无任务」占位。

#### 8.3.3 `index.wxss`

- 引入全局样式，局部可再根据需要调整。

#### 8.3.4 `index.js`

- 数据字段：
  - `filter`：当前筛选类型，默认 `"all"`。
  - `list`：当前展示的任务列表。
  - `isLoading`：加载状态，对应 `<ui-loading>`。
- 函数：
  - `onShow()`：
    - 每次页面显示时执行。
    - 先从本地缓存 `wx.getStorageSync('hyyc_user')` 取用户信息：
      - 如果用户未实名（`!u.realname`），跳转到欢迎页：`wx.navigateTo({ url: '/pages/auth/welcome/index' })`。
      - 否则调用 `this.load()` 加载任务列表。
  - `changeFilter(e)`：
    - 根据 `e.currentTarget.dataset.k` 更新 `filter` 并再次调用 `load()`。
  - `load()`：
    - 显示 loading。
    - 从 `utils/mock.js` 读取任务数据，使用 `formatMoney`、`formatDate` 格式化金额和日期。
    - 根据 `filter` 不同进行排序或过滤：
      - `"money"`：按金额从高到低排序。
      - `"new"`：按截止日期倒序。
      - `"building"`：
        - 如果用户未填写 `building`，弹出提示并引导去实名页补充。
        - 否则筛选出 `building` 等于用户楼栋的任务（如果任务本身没有 `building` 字段，则尝试从 `address` 中解析）。
    - 最后 `setData({ list, isLoading: false })`。
  - `parseBuilding(addr='')`：
    - 从地址字符串中用正则 `(...栋)` 粗略提取楼栋信息，用于兼容没有显式 `building` 字段的任务。
  - `goPublish()`：
    - 对应「发布任务」按钮。
    - 调用 `wx.switchTab({ url: '/pages/task/publish/index' })` 跳转到底部「发布」 tab。
  - `toDetail(e)`：
    - 对应任务卡片中的「详情」按钮。
    - 读取 `data-id` 并跳转到 `pages/task/detail/index`，携带任务 `id`。

---

### 8.4 `pages/task/publish` —— 发布任务页

- 对应页面 / 按钮：
  - 底部 tab 中间的「发布」。
  - 页内按钮：
    - 「上传图片」按钮。
    - 下方「清空」和「发布」两个按钮。

#### 8.4.1 `index.json`

- 使用组件：
  - `ui-field`、`ui-button`、`ui-loading`。
- 标题「发布任务」。

#### 8.4.2 `index.wxml`

- `<ui-loading show="{{isLoading}}" />`。
- 一组 `ui-field`：
  - 标题、说明、佣金、截止日期、地址、发布楼栋、图片。
- 「上传图片」按钮：
  - `bindtap="chooseImg"`。
- 底部操作行：
  - 左侧「清空」→ `bindtap="reset"`。
  - 右侧「发布」→ `bindtap="submit"`。

#### 8.4.3 `index.js`

- 数据：
  - `form`：发布任务的所有字段。
  - `errors`：校验错误信息。
  - `buildingRange`、`buildingIndex`：楼栋选择。
  - `isLoading`：发布过程中的加载状态。
- 函数：
  - `onShow()`：
    - 检查本地是否有实名信息：
      - 未实名时直接跳转到实名页。
    - 初始化楼栋列表，并默认选中用户楼栋。
  - `onInput(e)`：
    - 根据 `data-k` 更新对应表单字段。
  - `onDate(e)`：
    - 更新 `form.deadline`。
  - `chooseImg()`：
    - 调用 `wx.chooseImage` 选择最多 3 张图片。
    - 结果追加到 `form.images`。
  - `reset()`：
    - 把 `form` 重置为初始空值，同时清空 `errors`。
  - `submit()`：
    - 使用 `required()` 校验所有必填项。
    - 如果有错误，写入 `errors` 并中断。
    - 否则：
      - 设置 `isLoading=true`，模拟 1 秒提交流程。
      - 提交完成后弹出「已发布（演示）」。
      - 切回首页 tab。
  - `onBuilding(e)`：
    - 选择楼栋 picker 的回调，更新 `buildingIndex` 和 `form.building`。

---

### 8.5 `pages/task/detail` —— 任务详情页

- 对应页面 / 按钮：
  - 从首页任务列表、我的任务列表的「详情 / 查看」按钮进入。
  - 页内按钮按身份不同有不同展示：
    - 普通接任务用户：
      - 「接受任务」→ 接单。
      - 「先沟通」/「与业主聊天」→ 打开聊天页。
      - 「提交完成」→ 跳转到提交验收页。
    - 任务发布者：
      - 「与接单人聊天」→ 打开聊天页。
      - 「确认完成」→ 打款确认。

#### 8.5.1 `index.json`

- 使用组件：
  - `ui-card`、`ui-button`、`ui-loading`。
- 标题「任务详情」。

#### 8.5.2 `index.wxml`

- `<ui-loading show="{{isLoading}}" />`。
- 上半部分任务信息卡片：
  - 显示标题、社区+地址、金额、状态、描述、图片列表。
- 下半部分操作区：
  - 根据 `isOwner`、`accepted` 不同切换不同按钮组（接单、沟通、提交、确认完成）。

#### 8.5.3 `index.js`

- 数据：
  - `task`：当前任务详情。
  - `isOwner`：当前用户是否为发布者（由 URL 参数 `role` 判断）。
  - `accepted`：任务是否已被接受（由 URL 参数 `accepted` 判断）。
  - `isLoading`：加载状态。
- 函数：
  - `onLoad(q)`：
    - 根据 `q.id` 在 `tasks` 假数据中找到对应任务，没有则退回第一个。
    - 使用 `formatMoney`、`formatDate` 格式化金额和截止日期。
    - 设置 `isOwner` 和 `accepted`。
  - `accept()`：
    - 对应「接受任务」按钮。
    - 简单弹出「已接受（演示）」提示，并把 `accepted` 设为 `true`。
  - `toChat()`：
    - 对应所有「聊天」类按钮。
    - 跳转到 `pages/chat/room/index`，参数里带上任务 ID。
  - `toSubmit()`：
    - 对应「提交完成」按钮。
    - 跳转到 `pages/task/submit/index`。
  - `async approve()`：
    - 对应发布者看到的「确认完成」按钮。
    - 使用 `confirm()` 弹出确认弹窗，确认后再 `toast("已确认完成（演示）")`。

---

### 8.6 `pages/task/submit` —— 提交验收页

- 对应页面 / 按钮：
  - 从任务详情页的「提交完成」按钮跳转。
  - 页内按钮：
    - 「上传图片」。
    - 底部「取消」「提交验收」。

#### 8.6.1 `index.json`

- 使用组件：
  - `ui-field`、`ui-button`、`ui-loading`。
- 标题「提交验收」。

#### 8.6.2 `index.wxml`

- `<ui-loading show="{{isLoading}}" />`。
- 两个表单字段：
  - 「完成说明」文本框。
  - 「上传凭证（照片）」：图片预览 + 「上传图片」按钮。
- 底部操作按钮：
  - 「取消」→ `bindtap="cancel"`。
  - 「提交验收」→ `bindtap="submit"`。

#### 8.6.3 `index.js`

- 数据：
  - `tid`：任务 ID（从 URL 参数带入）。
  - `note`：完成说明。
  - `images`：上传的照片列表。
  - `isLoading`：提交过程中的加载状态。
- 函数：
  - `onLoad(q)`：
    - 从 URL 参数里读取 `tid` 并保存。
  - `onNote(e)`：
    - 更新完成说明。
  - `choose()`：
    - 调用 `wx.chooseImage` 让用户选择最多 3 张图片，并追加到 `images`。
  - `cancel()`：
    - 返回上一页。
  - `submit()`：
    - 点击「提交验收」后：
      - 把 `isLoading` 设为 `true`，模拟 1 秒提交流程。
      - 完成后 `toast('已提交（演示）')` 并返回上一页。

---

### 8.7 `pages/chat/room` —— 聊天室页

- 对应页面 / 按钮：
  - 从任务详情页的「先沟通」「与业主聊天」「与接单人聊天」按钮进入。
  - 页内按钮：
    - 底部输入框右侧的「发送」按钮。

#### 8.7.1 `index.json`

- 使用组件：
  - `chat-bubble`、`ui-loading`。
- 标题「聊天」。

#### 8.7.2 `index.wxml`

- 顶部 `<ui-loading show="{{isLoading}}" />`。
- 上半部分 `scroll-view`：
  - 滚动展示消息列表，每条使用 `<chat-bubble>`。
- 下半部分输入区：
  - 文本输入框 `bindinput="onInput"`。
  - 「发送」按钮 `bindtap="send"`。

#### 8.7.3 `index.js`

- 数据：
  - `tid`：任务 ID，便于后续与任务绑定。
  - `msgs`：消息数组。
  - `text`：当前输入框里的内容。
  - `toView`：用于滚动到最新消息的位置。
  - `isLoading`：历史消息加载状态。
- 函数：
  - `onLoad(q)`：
    - 保存 `tid`，然后调用 `mockHistory()` 加载历史记录。
  - `mockHistory()`：
    - 设置 `isLoading=true`，延迟 600ms 后写入两条示例对话，并设置 `toView='m2'`。
  - `onInput(e)`：
    - 实时更新输入框文本。
  - `send()`：
    - 如果输入为空，直接返回。
    - 否则：
      - 获取最后一条消息的 ID，+1 作为新消息 ID。
      - 把新消息追加到 `msgs`，设置 `mine: true`。
      - 清空输入框，并把 `toView` 设置为新 ID，滚动至底部。

---

### 8.8 `pages/wallet/index` —— 钱包页

- 对应页面 / 按钮：
  - 从「我的」页面中的「我的钱包」条目进入。
  - 页内按钮：
    - 底部「返回」按钮，回到上一页或个人中心。

#### 8.8.1 `index.json`

- 使用组件：
  - `ui-card`、`ui-button`、`ui-loading`。
- 标题「钱包」。

#### 8.8.2 `index.wxml`

- 顶部余额卡片。
- 下方收支明细列表。
- 底部「返回」按钮 `bindtap="gotoProfile"`。

#### 8.8.3 `index.js`

- 数据：
  - `balance`：当前可用余额（字符串）。
  - `flows`：收支列表。
  - `isLoading`：加载状态。
- 函数：
  - `onShow()`：
    - 进入页面时，模拟 700ms 加载：
      - 从 `utils/mock.js` 的 `user.balance` 和 `walletFlows` 读取数据。
      - 使用 `formatMoney` 格式化金额。
  - `gotoProfile()`：
    - 返回上一页，如失败则切换到「我的」 tab。

---

### 8.9 `pages/profile/index` —— 我的页面

- 对应页面 / 按钮：
  - 底部 tab 的「我的」。
  - 页内按钮/条目：
    - 「我的任务」→ `gotoMyTasks()`。
    - 「我的钱包」→ `gotoWallet()`。
    - 「实名认证」→ `gotoRealname()`。
    - 「测试云函数（login）」→ `testCloudFunction()`。
    - 「退出登录」→ `logout()`。

#### 8.9.1 `index.json`

- 使用组件：
  - `ui-card`、`ui-loading`。
- 标题「我的」。

#### 8.9.2 `index.wxml`

- 账户信息卡片：
  - 显示头像占位、用户姓名、小区、实名状态、楼栋/门号。
- 导航卡片：
  - 几个点击区域，分别绑定不同的跳转方法。

#### 8.9.3 `index.js`

- 数据：
  - `user`：本地存储的用户信息。
  - `isLoading`：加载状态。
- 函数：
  - `onShow()`：
    - 每次进入页面时，从 `wx.getStorageSync('hyyc_user')` 读取用户。
    - 模拟 500ms loading。
  - `gotoMyTasks()`：
    - 跳转到 `pages/my/tasks/index`。
  - `gotoWallet()`：
    - 跳转到 `pages/wallet/index/index`。
  - `gotoRealname()`：
    - 跳转到 `pages/auth/realname/index`。
  - `async testCloudFunction()`：
    - 对应「测试云函数（login）」条目。
    - 调用 `wx.cloud.callFunction({ name: 'login' })`。
    - 把返回的 `openid` 截断后显示在 `wx.showToast` 中，验证云函数是否可用。
  - `logout()`：
    - 对应「退出登录」条目。
    - 弹出确认框，确认后：
      - 删除本地 `hyyc_user` 缓存。
      - 使用 `wx.reLaunch` 回到欢迎页 `pages/auth/welcome/index`。

---

### 8.10 `pages/my/tasks` —— 我的任务页

- 对应页面 / 按钮：
  - 从「我的」页面的「我的任务」条目进入。
  - 页内按钮：
    - 顶部两个标签：「我发布的」「我接受的」。
    - 每条任务卡片右侧「查看」按钮。

#### 8.10.1 `index.json`

- 使用组件：
  - `ui-card`、`ui-button`、`ui-loading`。
- 标题「我的任务」。

#### 8.10.2 `index.wxml`

- 顶部 tab：
  - 「我发布的」和「我接受的」两个 `view`，根据 `tab` 高亮。
- 列表：
  - 每条任务卡片下方有一个「查看」按钮，绑定 `toDetail`，通过：
    - `data-id` 传任务 ID。
    - `data-role` 在「我发布的」时传 `"owner"`，在「我接受的」时传空串。

#### 8.10.3 `index.js`

- 数据：
  - `tab`：当前 tab 类型，默认 `"owner"`。
  - `list`：任务列表。
  - `isLoading`：加载状态。
- 函数：
  - `onShow()`：
    - 每次进入页面时调用 `load()`。
  - `setTab(e)`：
    - 更新 `tab` 为 `owner` 或 `worker`，然后重新 `load()`。
  - `load()`：
    - 模拟 600ms 加载。
    - 使用 `tasks` 假数据生成列表，统一格式化金额和日期。
    - 当前 demo 中「我发布的」「我接受的」两种 tab 展示的是同一批数据，后期接真实接口时可以分开。
  - `toDetail(e)`：
    - 从 `e.currentTarget.dataset` 中取出任务 `id` 和 `role`。
    - 跳转到 `pages/task/detail/index`，同时传入 `role`（用于决定是否显示「确认完成」按钮）和 `accepted=1`（演示用）。

---

### 8.11 `pages/index` —— 官方示例首页（暂未接入主流程）

- 对应页面：
  - 微信小程序官方模板自带的用户头像+昵称示例页面。
  - 当前没有出现在 `app.json` 的主页面数组中，所以正常用户不会跳到这里。
- 主要按钮：
  - 选择头像、输入昵称、获取头像昵称等按钮，都属于官方示例逻辑。
- 文件：
  - `index.json`：空配置。
  - `index.wxml`：原生示例布局。
  - `index.wxss`：对应的基础样式。
  - `index.js`：
    - `bindViewTap()`：跳转到 `pages/logs/logs`。
    - `onChooseAvatar(e)`：更新头像。
    - `onInputChange(e)`：更新昵称。
    - `getUserProfile(e)`：调用微信 `wx.getUserProfile` 获取用户信息。

---

### 8.12 `pages/logs` —— 官方示例日志页

- 对应页面：
  - 只用于演示记录小程序启动日志，当前也未在 `app.json` 中暴露给普通用户。
- 文件：
  - `logs.json`：空配置。
  - `logs.wxml`：
    - 滚动列表展示 logs 数组。
  - `logs.wxss`：
    - 简单样式。
  - `logs.js`：
    - 数据：
      - `logs`：格式化后的日志数组。
    - 函数：
      - `onLoad()`：
        - 从 `wx.getStorageSync('logs')` 读取时间戳数组。
        - 使用 `util.formatTime` 转成人类可读的日期时间。

---

## 9. 云函数：`cloudfunctions/`

### 9.1 `cloudfunctions/login/index.js` —— 获取 openid 的云函数

- 对应功能 / 按钮：
  - 在「我的」页面中点击「测试云函数（login）」时调用。
- 函数：
  - `exports.main(event, context)`：
    - 入参：
      - `event.userInfo`：由云开发自动注入，包含用户的 openId、appId 等。
    - 返回：
      - `openid`：当前用户在该小程序下的唯一标识。
      - `appid`：当前小程序的 appId。
      - `userInfo`：原样透传。
- 使用流程：
  - 前端 `pages/profile/index/index.js` 中：
    - 调用 `wx.cloud.callFunction({ name: 'login' })`。
    - 成功后从 `res.result.openid` 读取 openid，并在 `Toast` 中展示前几位，验证云函数是否可用。

---

## 10. 开发脚本：`scripts/`

### 10.1 `scripts/gen-lottie-js.js` —— Lottie JSON 转 JS 脚本

- 作用：
  - 在 Node 环境下运行一次，把 `assets/lottie/shopping-bag.json` 读取出来，并生成对应的 `shopping-bag.js` 文件。
  - 这样在小程序代码里就可以直接 `require('../../../assets/lottie/shopping-bag.js')` 来拿到动画数据。
- 函数/逻辑：
  - 使用 `fs.readFileSync` 读取原始 json 字符串。
  - 拼接成 `module.exports = ...` 字符串。
  - 用 `fs.writeFileSync` 写入目标 JS 文件。
- 对应页面：
  - 本脚本本身不在小程序内运行，只是为 `components/ui/loading` 提供动画数据。

---

## 11. 第三方库目录（了解即可，不需要逐文件阅读）

> 下面两个目录主要是安装的依赖库代码，一般不需要改。

- `miniprogram_npm/lottie-miniprogram/**`：
  - Lottie 官方提供的小程序版 SDK。
  - 由构建工具自动生成，供小程序端 `require('lottie-miniprogram')` 使用。
- `node_modules/**`：
  - Node 环境下的依赖，例如 Babel 运行时和 Lottie SDK。
  - 仅在本地构建或脚本执行时参与，不会直接出现在小程序包体内。

