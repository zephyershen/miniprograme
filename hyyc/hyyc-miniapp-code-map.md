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
    - `.btn-sm`：小尺寸按钮，例如任务卡片里的「查看」等。
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

### 4.3 `assets/lottie/error.json` & `error.js`

- 作用：错误提示用的 Lottie 动画（一幅「有点头疼/出错了」的插画，会循环播放）。
- `.json`：原始动画文件。
- `.js`：把 `.json` 包装成 JS 模块，方便在小程序里 `require('../../../assets/lottie/error.js')`。
- 使用位置 / 对应页面：
  - `components/ui/error-dialog/index.js`：
    - 错误弹层里的主视觉动画。
  - 间接使用页面：
    - `pages/auth/realname/index`：
      - 通过 `<ui-error-dialog ... />` 使用该动画，在「该用户已存在」时弹出。

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
  - `tasks`：一组任务列表（仅用于早期 UI 演示，现在首页/详情/我的任务已经改为走云数据库 `tasks` 集合）。
  - `user`：假用户数据，用于演示「我的」「钱包」等页面。
  - `walletFlows`：钱包收支明细。
- 使用位置 / 对应页面：
  - 钱包：`pages/wallet/index/index.js`（余额和流水，仍使用本地假数据）。

### 5.3 `utils/format.js` —— 金额与日期格式化

- 函数：
  - `formatMoney(n)`：
    - 把金额格式化为两位小数字符串，如 `8.8` → `"8.80"`。
    - 使用位置：
      - 列表、详情、钱包、我的任务等所有展示金额的页面。
  - `formatDate(ts)`：
    - 把时间戳转成 `"YYYY-MM-DD"` 格式。
    - 使用位置：
      - 需要只展示日期的地方（例如部分历史记录等）。
  - `formatDateTime(ts)`：
    - 把时间戳转成 `"YYYY-MM-DD HH:mm"` 格式。
    - 使用位置：
      - 首页任务列表、任务详情、我的任务列表里的截止时间。
      - 对于没有设置截止时间的任务，业务代码会在调用处把 `deadline` 为空的情况显示为「不限」，而不是具体日期。

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
      - `pages/my/tasks/index.js` 里的「删除」按钮，在删除自己发布的任务前弹出确认框。

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
    - 上面是 `label` 标签文字（支持在必填项后加小红星），中间是 slot 放具体输入控件（`<input>` / `<textarea>` / `<picker>` 等），下面根据 `error` 是否有值显示错误文字。
  - `index.wxss`：引入全局字段样式。
  - `index.js`：
    - 属性：
      - `label`：表单字段标题。
      - `error`：错误文案字符串。
      - `required`：布尔值，是否在标题后显示红色 `*`。
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

### 7.5 `components/ui/error-dialog` —— 错误提示弹层（带 Lottie 动画）

- 文件：
  - `index.json`：
    - `"component": true`，声明组件。
  - `index.wxml`：
    - 最外层 `.error-mask` 做整页遮罩，`wx:if="{{show}}"` 控制是否渲染。
    - 中间 `.error-card.card` 是白色卡片，内部包含：
      - `lottie-box` + `<canvas id="error-canvas">`：播放错误 Lottie 动画。
      - `title`：可选标题行。
      - `message`：错误文案主体。
      - 一颗确认按钮：「{{confirmText}}」。
  - `index.wxss`：
    - 固定定位的半透明背景、卡片居中。
    - Lottie 区域宽高为 `280rpx`，和 JS 中的 `LOTTIE_SIZE_RPX` 对应。
    - 把内部按钮 `.actions .btn` 做成比全局默认按钮更小的尺寸。
  - `index.js`：
    - 引入：
      - `lottie-miniprogram`：播放 Lottie 动画的库。
      - `../../../assets/lottie/error.js`：错误动画数据。
    - 常量：
      - `LOTTIE_SIZE_RPX = 280`：和样式里宽高一致，用来按屏幕宽度换算成实际像素。
    - 属性：
      - `show`：是否显示错误弹层。
      - `title`：上方标题文字，可为空。
      - `message`：主文案，默认是「出错了，请稍后重试」。
      - `confirmText`：按钮文字，默认「确定」。
    - 观察者：
      - `show(val)`：
        - `true` 时调用 `playLottie()` 启动动画。
        - `false` 时调用 `stopLottie()` 停止并销毁动画。
    - 生命周期：
      - `ready()`：如果一开始 `show=true`，会自动播一遍动画。
      - `detached()`：组件被销毁时停止动画，防止内存泄漏。
    - 方法：
      - `playLottie()`：
        - 通过 `createSelectorQuery().select('#error-canvas').node(...)` 拿到 canvas。
        - 根据设备 `pixelRatio` 和屏幕宽度计算 canvas 宽高，保证在不同手机上清晰。
        - 调用 `lottie.setup(canvas)` + `lottie.loadAnimation({ animationData: errorAnim, ... })` 播放动画。
      - `stopLottie()`：
        - 如果已有动画实例，调用 `destroy()` 并清空引用。
      - `onConfirm()`：
        - 向外触发 `confirm` 事件，方便页面通过 `bindconfirm` 监听点击。
- 使用位置 / 对应页面：
  - `pages/auth/realname/index.wxml`：
    - `<ui-error-dialog show="{{showUserExist}}" message="该用户已存在，请直接登录" bindconfirm="onUserExistConfirm" />`。
    - 当发现数据库中已有同名+同身份证的用户时弹出，点击「确定」后会走 `onUserExistConfirm()`，引导用户回到欢迎页直接登录。

### 7.6 `components/chat/bubble` —— 聊天气泡

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
  - `ui-button`、`ui-field`、`ui-loading`、`ui-error-dialog`。
- 设置导航栏标题为「实名注册」。

#### 8.1.2 `index.wxml`

- 结构：
  - `<ui-loading show="{{isLoading}}" />`：接口请求或定位时显示加载遮罩。
  - `<ui-error-dialog ... />`：当检测到同一姓名+身份证的实名信息已存在时，弹出错误提示弹层，引导用户直接登录。
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
  - `form`：表单内容，包括 `name`、`idNumber`、`phone`、`inviteCode`、`community`、`building`、`floor`、`door`。
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
  - `showUserExist`：是否显示「该用户已存在」错误弹层。
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
    - 当前代码中，为了方便开发调试，直接把 `inCommunity` 设为 `true`，并把 `locationText` 改成「开发测试：已视为在小区范围内」，真实定位逻辑保留在注释里，上线前可以按注释恢复：
      - 调用 `wx.getLocation` 获取当前经纬度。
      - 用 `distanceMeters` 对比 `config/community` 中配置的中心点和半径。
      - 根据距离更新 `inCommunity` 和 `locationText`（「已在花语云萃范围内（~120m）」或「不在小区范围」）。
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
      4. 等 `checkAll()` 全部通过后，通过云函数 `checkUserByIdNumber` 在服务端查询是否已经存在同一身份证号的用户（身份证号唯一，一个证件号只能注册一次）：
         - 云函数入参：`{ idNumber }`。
         - 如果云函数返回 `ok: true, exists: true`：
           - 关闭 loading（`isLoading=false`）。
           - 把 `showUserExist` 设为 `true`，弹出上一节的 `<ui-error-dialog>`，提示「该用户已存在，请直接登录」。
           - 不再继续新增记录。
      5. 只有在「校验通过」且「不存在已实名用户」的情况下：
         - 调用 `db.collection(USER_COLLECTION).add({ data: {...} })` 把实名信息写入云数据库 `userInfo` 集合：
           - 这里直接保存 `building`、`floor` 和 `door`，不再单独拆出「单元/户号」字段，`door` 本身已经包含楼层和户号（例如 `701` = 7 楼 01 户）。
           - 额外写入 `realname: true`、`verified: true`、`createdAt: new Date()` 作为状态字段。
         - 通过新增结果里的 `_id` 拿到这条用户记录在数据库里的唯一编号 `userId`。
         - 在本地 `wx.setStorageSync('hyyc_user', {...})` 存一份用户信息：
           - 内容为表单字段 + `id: userId` + `realname: true` + `verified: true`。
           - 后续所有页面（发布任务、我的任务等）都通过这个 `id` 作为用户通用编号，比如写入任务里的 `ownerId`。
         - 弹出「实名完成」提示，并切换到底部「首页」 tab。
  - `onUserExistConfirm()`：
    - 处理 `<ui-error-dialog>` 的确认按钮点击。
    - 先把 `showUserExist` 设为 `false` 关闭弹层，然后通过 `wx.redirectTo` 跳转回欢迎页 `pages/auth/welcome/index`，让已有用户走登录流程。

---

### 8.2 `pages/auth/welcome` —— 欢迎页（客厅动画 + 登录/注册入口）

- 对应页面 / 按钮：
  - 页面：首次打开小程序且尚未实名时，从首页跳转到的欢迎页。
  - UI 元素：
    - 顶部大号 Lottie 客厅动画（客厅场景）。
    - 中部「欢迎各位业主」标题和说明。
    - 底部两个卡片式按钮：
      - 「登录」：调用登录流程。
      - 「注册」：跳转到实名注册页。

#### 8.2.1 `index.json`

- 设置导航栏标题为「欢迎」。
- 声明使用 `lottie-miniprogram` 相关能力（在 JS 中通过 `require('lottie-miniprogram')` 使用）。

#### 8.2.2 `index.wxml`

- 根节点 `<view class="welcome-page">`：整体背景容器。
- `.hero-card`：中间白色卡片，内部包含：
  - `.hero-lottie-box` + `<canvas id="hero-canvas">`：播放客厅 Lottie 动画。
  - `.hero-text`：标题 + 副标题。
  - `.actions` 区域的两个按钮：
    - `<view class="action-btn action-login" bindtap="onLoginTap">`：
      - 当 `isLoading` 为 `true` 时显示「登录中…」，否则显示「登录」。
    - `<view class="action-btn action-register" bindtap="onRegisterTap">注册</view>`：
      - 纯跳转按钮，不做任何授权，只负责带用户去实名注册页。

#### 8.2.3 `index.wxss`

- 设置浅橙色背景，与客厅动画风格统一。
- `.hero-card` 负责白色卡片 + 阴影 + 圆角。
- `.hero-lottie-box` / `.hero-lottie-canvas`：控制动画区域大小。
- `.action-login`、`.action-register`：
  - 统一的卡片式按钮基础样式。
  - 登录按钮使用实心渐变；注册按钮使用白底描边样式。

#### 8.2.4 `index.js`

- 数据：
  - `isLoading`：登录流程中的 loading 状态，防止多次点击。
- 函数：
  - `onShow()` / `onReady()`：
    - 页面显示或首次渲染时调用 `playLottie()`，启动客厅动画播放。
  - `onHide()` / `onUnload()`：
    - 页面隐藏或销毁时调用 `stopLottie()`，销毁动画实例，释放资源。
  - `onRegisterTap()`：
    - 直接调用 `wx.navigateTo({ url: '/pages/auth/realname/index' })`，让用户去填写实名信息。
  - `async onLoginTap()`：
    - 如果已经在登录中（`isLoading=true`），直接返回，避免重复提交。
    - 调用云函数 `login` 获取当前用户在本小程序下的 `openid`。
    - 根据 `_openid` 到云开发数据库 `userInfo` 集合里查询实名信息：
      - 未找到记录：弹框提示「尚未注册」，确认后跳转到实名页。
      - 找到记录：
        - 取出该文档的 `_id`，作为后续使用的通用 `id` 字段。
        - 把用户对象（去掉 `_id`，补上 `id` 字段）缓存到本地 `wx.setStorageSync('hyyc_user', cachedUser)`。
        - 弹出「登录成功」，稍作延时后 `wx.switchTab` 跳转到首页 `pages/home/index/index`。
    - 整个过程中会用 `wx.showLoading` / `wx.hideLoading` 控制顶部系统 loading。
  - `playLottie()`：
    - 使用 `this.createSelectorQuery().select('#hero-canvas').node(...)` 拿到 canvas。
    - 根据屏幕宽度和 `pixelRatio` 计算 canvas 宽高，并用 `lottie-miniprogram` 播放 `living-room` 动画。
    - 为了真机流畅度，限制了最大像素密度，并把画质设为 `medium`。
  - `stopLottie()`：
    - 调用动画实例的 `destroy()` 方法，并清空内部引用。

---

### 8.3 `pages/home/index` —— 首页任务广场

- 对应页面 / 按钮：
  - 底部 tab 第一项「首页」。
  - 页内元素：
    - 顶部「本小区任务」标题。
    - 右上角「发布任务」按钮（`goPublish()`）。
    - 筛选区域一排：
      - 标签：「全部」「最新」「本楼栋」。
      - 以及一个「任务地点：xxx」下拉标签（可选「全部」「小区内」「小区外」）。
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
  - 每个标签是一个 `<view class="badge ...">`，`data-k` 分别为 `"all"|"new"|"building"`。
  - 点击调用 `changeFilter` 更新筛选。
- 任务列表：
  - 使用 `<block wx:for="{{list}}">` 渲染。
  - 每条任务用 `<ui-card>` 展示：
    - 标题：任务标题。
    - 副标题：`{{item.community}} · 截止时间 {{item.deadlineText}}`：
      - 当任务没有设置截止时间时，`deadlineText` 为「不限」。
    - 说明（`desc`）：
      - 默认只展示前若干个字，例如最多 32 个字符，后面加 `…`。
      - 后面跟一个「展开 / 收起」的小文字按钮：
        - 点击「展开」：把当前卡片的 `descExpanded` 设为 `true`，显示完整说明。
        - 点击「收起」：再次设为 `false`，恢复为截断后的 `descShort`。
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
  - `locationFilter` / `locationFilterIndex` / `locationFilterLabels`：任务地点下拉选择相关字段。
- 函数：
  - `onShow()`：
    - 每次页面显示时执行。
    - 先从本地缓存 `wx.getStorageSync('hyyc_user')` 取用户信息：
      - 如果用户未实名（`!u.realname`），跳转到欢迎页：`wx.navigateTo({ url: '/pages/auth/welcome/index' })`。
      - 否则调用 `this.load()` 加载任务列表。
  - `changeFilter(e)`：
    - 根据 `e.currentTarget.dataset.k` 更新 `filter` 并再次调用 `load()`。
  - `onLocationFilterChange(e)`：
    - 「任务地点」下拉框的回调，根据用户选择更新 `locationFilter`（`"all"|"inside"|"outside"`）并重新加载任务列表。
  - `load()`：
    - 显示 loading。
    - 从云开发数据库 `tasks` 集合读取当前小区的任务列表，使用 `formatMoney`、`formatDateTime` 格式化金额和截止时间：
      - 如果某条任务的 `deadline` 为空，映射为「不限」。
      - 根据当前时间 `Date.now()` 计算每条任务是否「生效中」：
        - 条件：`status === 'posted'` 且 `deadline` 为空或晚于当前时间。
        - 只保留满足条件的任务（也就是任务广场只显示绿色「任务生效中」的任务）。
    - 根据 `filter` 和 `locationFilter` 不同进行排序或过滤：
      - `"new"`：按截止日期倒序。
      - `"building"`：
        - 如果用户未填写 `building`，弹出提示并引导去实名页补充。
        - 否则筛选出 `building` 等于用户楼栋的任务（如果任务本身没有 `building` 字段，则尝试从 `address` 中解析）。
      - `locationFilter`：
        - `"all"`：不过滤任务地点。
        - `"inside"`：只保留任务字段 `locationType === 'inside'` 的任务（例如小区内帮忙拿快递）。
        - `"outside"`：只保留 `locationType === 'outside'` 的任务（例如去商场或建材市场帮忙购买）。
    - 最后 `setData({ list, isLoading: false })`。
  - `toggleDesc(e)`：
    - 点击某条任务说明后面的「展开 / 收起」按钮时触发。
    - 根据 `data-id` 找到当前任务在 `list` 里的下标，把对应项的 `descExpanded` 布尔值取反。
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
    - 下方「清空」和「发布」两个按钮（在「编辑任务」模式下，顶部标题会动态变为「编辑任务」）。

#### 8.4.1 `index.json`

- 使用组件：
  - `ui-field`、`ui-button`、`ui-loading`。
- 标题「发布任务」。

#### 8.4.2 `index.wxml`

- `<ui-loading show="{{isLoading}}" />`。
- 一组 `ui-field`：
  - 标题、说明、佣金、截止时间（日期 + 时刻）、发布楼栋、门牌号、图片。
  - 「截止时间」这一行：
    - 左侧是「截止时间（不填默认无限制时间）」标题，说明用户可以不填。
    - 右侧是日期 picker + 时间 picker：
      - 日期：`mode="date"`，`bindchange="onDeadlineDate"`。
      - 时间：`mode="time"`，`bindchange="onDeadlineTime"`。
    - 如果用户没有选完整的日期和时间，则 `form.deadline` 为空，表示「不限时间」。
- 图片区域：
  - 使用一个横向可换行的容器展示缩略图列表 + 加号：
    - 每张图片：
      - 用 `<image>` 显示方形缩略图，点击图片本身会调用 `previewFormImage` 打开大图预览。
      - 右上角叠加一个小圆形「×」按钮，点击调用 `removeFormImage` 从当前表单里删除这张图片。
    - 在已有图片后面有一个带虚线边框的正方形「+」占位格：
      - `bindtap="chooseImg"`。
      - 点击后调用 `wx.chooseImage` 继续添加图片。
- 底部操作行：
  - 左侧「清空」→ `bindtap="reset"`。
  - 右侧「发布」→ `bindtap="submit"`。

#### 8.4.3 `index.js`

- 数据：
  - `form`：发布任务的所有字段（包括 `title`、`desc`、`amount`、`deadline`、`deadlineDate`、`deadlineTime`、`building`、`floor`、`door`、`address`、`images` 等）。
  - `errors`：校验错误信息。
  - `buildingRange`、`buildingIndex`：楼栋选择。
  - `doorRange`、`doorIndex`：门牌多列选择（楼层 + 户号）。
  - `MAX_FLOOR`：最大楼层数，用于生成门牌选择列表。
  - `isLoading`：发布 / 保存过程中的加载状态。
  - `editTaskId`：如果是从「我的任务」里进入编辑，则这里保存正在编辑的任务 ID；为空表示新建。
- 函数（仅列出主要逻辑）：
  - `onShow()`：
    - 从本地缓存 `wx.getStorageSync('hyyc_user')` 读取用户：
      - 如果未实名（`!u.realname`），跳转到实名页。
    - 初始化：
      - 楼栋列表：`1-23栋`。
      - 楼层列表：`1-MAX_FLOOR 楼`。
      - 户号列表：`01户-04户`。
    - 根据实名信息预填楼栋和门牌：
      - 优先使用用户的 `building` 作为默认楼栋。
      - 从用户的 `door`（比如 `"701"`）反推出楼层（`"7"`）和第几户（`01` → 第 1 户）。
      - 更新 `doorIndex`，并拼出任务地址「X栋Y单元」，写入 `form.building`、`form.floor`、`form.door`、`form.address`。
    - 再检查是否有本地缓存的 `hyyc_edit_task_id`：
      - 如果有：说明是从「我的任务」点「编辑」过来的，会把导航标题改为「编辑任务」，并调用 `loadTaskForEdit(id)` 把云端任务信息填回表单。
      - 如果没有：保持标题为「发布任务」，`editTaskId` 设为空。
  - `loadTaskForEdit(id)`：
    - 根据任务 ID 从云开发数据库 `tasks` 集合读取任务详情。
    - 把任务里的字段（标题、说明、金额、截止时间、楼栋、门牌、地址、图片、任务地点等）逐一写回 `form`：
      - 把时间戳 `deadline` 转成 `"YYYY-MM-DD HH:mm"` 并拆回 `deadlineDate`、`deadlineTime`。
      - 图片数组 `images` 直接写入表单，后续提交时会保留原 fileID。
      - 把任务里的 `locationType` 写回到表单（可能为空、`inside`、`outside`）。
  - `onInput(e)`：
    - 根据 `data-k` 更新对应表单字段，例如标题、说明、佣金等。
  - `onDeadlineDate(e)` / `onDeadlineTime(e)`：
    - 分别更新日期和时间字段。
    - 当日期和时间都有值时，把它们拼成完整的 `form.deadline`（`"YYYY-MM-DD HH:mm"`）；否则让 `form.deadline` 为空。
  - `chooseImg()`：
    - 调用 `wx.chooseImage` 选择最多 3 张图片。
    - 把返回的本地临时路径追加到 `form.images`，后续提交时统一上传到云存储。
  - `reset()`：
    - 清空标题、说明、佣金、截止时间和图片，保留预填的楼栋和门牌。
    - 同时清空 `errors`。
  - `previewFormImage(e)`：
    - 读取被点击图片在 `form.images` 里的下标 `index`。
    - 调用 `wx.previewImage({ current, urls })` 预览当前图片，并可以左右滑动查看同一任务里的其他图片。
  - `removeFormImage(e)`：
    - 根据 `data-index` 从 `form.images` 数组里移除对应图片，实现「右上角叉号删除」效果。
  - `async submit()`：
    - 使用 `required()` 校验必填项：
      - 标题、佣金、发布楼栋、门牌号。
      - 截止时间不再强制必填，不填就视为「不限」。
    - 再次从本地读取 `hyyc_user`，未实名则引导去实名。
    - 提交流程：
      1. 把 `form.images` 里的本地临时路径逐个上传到云存储 `wx.cloud.uploadFile`：
         - 云端路径约定为：`tasks/<用户id>/<时间戳>_序号.jpg`。
         - 上传成功后收集得到一组 `fileID`。
      2. 如果 `form.deadline` 有值，把 `"YYYY-MM-DD HH:mm"` 转成时间戳（毫秒）存入 `deadline` 字段；没有值就写 `null`，后续展示为「不限」。
      3. 调用 `db.collection('tasks').add({ data: {...} })` 写入一条任务记录：
         - 核心字段包括：`title`、`desc`、`amount`（数字）、`deadline`（时间戳或 `null`）、`community`、`building`、`door`、`address`、`locationType`（任务地点，可为空、`inside`、`outside`）、`images`（fileID 数组）、`ownerId`、`ownerName`、`ownerNickname`、`status: 'posted'`、`createdAt: db.serverDate()`。
    - 成功后：
      - `toast('已发布')`。
      - 把 `isLoading` 设回 `false`。
      - 切回首页 tab：`wx.switchTab({ url: '/pages/home/index/index' })`。
    - 出错时：
      - 打印日志，关闭 loading，并用 `toast('发布失败，请稍后重试')` 提示用户。
  - `onBuilding(e)`：
    - 楼栋 picker 的回调。
    - 根据用户选择更新 `buildingIndex`、`form.building`，并根据当前门牌重新拼接地址「X栋Y单元」。
  - `onDoorChange(e)`：
    - 多列选择门牌（楼层 + 户号）。
       - 通过两列下标反推楼层（第几层）和第几户，再组合生成 `door`（例如 `7 楼 + 第 1 户 → "701"`）。
       - 同时更新 `form.floor`、`form.door` 和中文地址 `form.address`。

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
  - 图片区域：
    - 使用 `<image wx:for="{{task.images}}">` 渲染所有凭证图片。
    - 点击任意一张图片会调用 `previewTaskImage`，通过 `wx.previewImage` 打开大图预览，并可左右滑动查看该任务所有图片。
- 下半部分操作区：
  - 根据 `isOwner`、`accepted` 不同切换不同按钮组（接单、沟通、提交、确认完成）。

#### 8.5.3 `index.js`

- 依赖：
  - `formatMoney`、`formatDateTime`：金额和时间格式化工具。
  - `toast`、`confirm`：统一的轻提示 / 确认弹窗工具。
  - 云数据库：`tasks` 集合（任务）、`messages` 集合（聊天记录）。

- 数据字段：
  - `task`：当前任务详情（包括标题、金额、社区、楼栋门牌、图片等）。
  - `isOwner`：当前登录用户是否为任务发布者：
    - 不是通过 URL 判断，而是用本地缓存的 `hyyc_user.id` 和任务里的 `ownerId` 对比。
  - `accepted`：是否已接受任务（当前仍由 URL 上的 `accepted` 控制，实际接单逻辑后续再接入）。
  - `isLoading`：详情加载状态。
  - `unreadCount`：**业主视角**下，这个任务下所有住户会话的未读消息总条数（只统计“别人发给我且我没读过”的消息）。
  - `peerUnreadCount`：**普通住户视角**下，这个任务下“业主发给我”的未读消息条数。

- 关键函数：
  - `onLoad(q)`：
    - 从 URL 参数里读取 `id`（任务 ID），如果缺失则提示错误并返回。
    - 从本地 `wx.getStorageSync('hyyc_user')` 取当前登录用户信息：
      - 取出 `myId = hyyc_user.id`。
    - 调用 `db.collection('tasks').doc(id).get()` 拉取任务详情：
      - 额外组装一些展示字段：
        - `amountText`：`formatMoney(amount)`。
        - `deadlineText`：未设置截止时间时显示为「不限」。
        - `statusText`：当前只区分「已发布」和原始状态字符串。
        - `locationText`：优先使用「楼栋 + 门牌号」，否则回退到 `address`。
      - 根据 `myId` 是否等于 `task.ownerId` 计算 `isOwner`。
      - 读取 URL 上的 `accepted` 字段，兼容当前「已接受」演示逻辑。
      - 把 `task`、`isOwner`、`accepted` 写入 `data`。
      - 根据角色不同，初始化未读角标：
        - 如果是业主：
          - 调用 `loadUnreadCount(task.id, myId)` 统计未读消息总条数。
          - 调用 `setupBadgeWatch(task, myId, true)` 启动实时监听（见后文）。
        - 如果是普通住户：
          - 调用 `loadPeerUnread(task.id, task.ownerId, myId)` 统计“业主发给我”的未读消息条数。
          - 调用 `setupBadgeWatch(task, myId, false)` 启动住户侧的实时监听。
  - `onShow()`：
    - 从本地再拿一次当前用户和 `task.id`。
    - 如果没有任务或没登录，直接返回。
    - 根据 `isOwner` 再次刷新未读数据，并重新挂载对应的 `watch`：
      - 业主：`loadUnreadCount + setupBadgeWatch(task, myId, true)`。
      - 住户：`loadPeerUnread + setupBadgeWatch(task, myId, false)`。
  - `onHide()` / `onUnload()`：
    - 调用 `clearBadgeWatch()` 关闭云数据库的实时监听，避免页面切换时重复监听。
  - `loadUnreadCount(tid, ownerId)`：
    - 业主视角下的一次性统计：
      - 查询 `messages` 集合：`where({ tid, ownerId })`，按 `createTime` 倒序取最多 500 条。
      - 未读条件：`fromUserId` 不等于 `ownerId` 且 `readByOwner !== true`。
      - 把所有满足条件的消息条数累加，写入 `unreadCount`。
      - 这个数字会展示在任务详情页的「聊天会话列表」按钮右上角红点里。
  - `loadPeerUnread(tid, ownerId, peerUserId)`：
    - 普通住户视角的一次性统计：
      - 查询当前任务下自己这条会话：`where({ tid, ownerId, peerUserId })`。
      - 未读条件：`fromUserId === ownerId` 且 `readByPeer !== true`（业主发给我的、我没看过的）。
      - 把满足条件的消息条数累加，写入 `peerUnreadCount`。
      - 这个数字会展示在任务详情页「先沟通 / 与业主聊天」按钮右上角红点里。
  - `setupBadgeWatch(task, myId, isOwner)` / `clearBadgeWatch()`：
    - 统一管理任务详情页上的未读角标实时监听。
    - 如果是业主视角：调用 `openOwnerBadgeWatch(task.id, myId)`。
    - 如果是住户视角：调用 `openPeerBadgeWatch(task.id, task.ownerId, myId)`。
    - `clearBadgeWatch()` 会在 `onHide`/`onUnload` 时关闭已有监听。
  - `openOwnerBadgeWatch(tid, ownerId)`：
    - 调用 `db.collection('messages').where({ tid, ownerId }).orderBy('createTime','desc').watch(...)`。
    - 每次 `onChange` 时：
      - 按上面的“业主未读条件”重新统计未读消息条数，写入 `unreadCount`。
      - 所以当住户不停给业主发消息时，业主停留在任务详情页也能实时看到红点从 1→2→3 增长。
  - `openPeerBadgeWatch(tid, ownerId, peerUserId)`：
    - 只监听当前住户自己那条会话：`where({ tid, ownerId, peerUserId })`。
    - 每次 `onChange` 时：
      - 按“住户未读条件”统计未读消息条数，写入 `peerUnreadCount`。
      - 所以业主发来消息时，如果住户停留在任务详情页，「先沟通 / 与业主聊天」按钮的红点数字也会实时变化。
  - `previewTaskImage(e)`：
    - 点击任务图片时调用。
    - 读取下标并使用 `wx.previewImage` 打开大图预览（可左右滑动查看本任务的所有图片）。
  - `accept()`：
    - 演示用的「接受任务」逻辑：
      - 如果当前用户本身就是业主，提示「这是你发布的任务，无需自己接受」。
      - 否则弹出「已接受（演示）」并把 `accepted` 设为 `true`。
  - `toChat()`：
    - 普通住户点击「先沟通 / 与业主聊天」按钮时调用。
    - 使用 `wx.navigateTo({ url: '/pages/chat/room/index?tid=' + task.id })` 打开与该任务发布者的一对一聊天页。
  - `toChatSessions()`：
    - 业主视角下显示的「聊天会话列表」按钮。
    - 跳转到 `pages/chat/sessions/index`，并带上 `tid`：
      - 会话列表页会根据 `tid + 当前业主 id` 聚合出所有有聊天记录的住户会话，并展示每个住户的最后一条消息和未读数量。
  - `toSubmit()`：
    - 普通住户点击「提交完成」时，跳转到 `pages/task/submit/index`，把 `tid` 传过去。
  - `async approve()`：
    - 业主点击「确认完成」按钮时调用。
    - 使用 `confirm('确认任务已完成并打款给对方？')` 做二次确认，确认后弹出「已确认完成（演示）」。

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
    - 每条任务卡片右侧「删除」「编辑」「查看」按钮（根据当前 tab 不同展示不同组合）。

#### 8.10.1 `index.json`

- 使用组件：
  - `ui-card`、`ui-button`、`ui-loading`。
- 标题「我的任务」。

#### 8.10.2 `index.wxml`

- 顶部 tab：
  - 「我发布的」和「我接受的」两个 `view`，根据 `tab` 高亮。
- 列表：
  - 每条任务卡片显示：
    - 标题。
    - 「截止 {{item.deadlineText}}」，其中 `deadlineText` 为格式化后的截止时间，未设置时为「不限」。
    - 金额（例如 `¥ 5.00`）。
  - 右侧按钮区域：
    - 在「我发布的」标签下：
      - 「删除」按钮：
        - `bindtap="onDeleteTask"`，只在 `tab === 'owner'` 时展示。
        - 使用 `data-id="{{item.id}}"` 传入任务 ID。
      - 「编辑」按钮：
        - `bindtap="onEditTask"`，只在 `tab === 'owner'` 时展示。
        - 点击后会：
          - 把任务 ID 暂存在本地 `wx.setStorageSync('hyyc_edit_task_id', id)`。
          - 使用 `wx.switchTab({ url: '/pages/task/publish/index' })` 切到底部「发布」 tab。
          - 发布页在 `onShow()` 里读取这个 ID 并进入「编辑任务」模式。
    - 在「我接受的」标签下：
      - 只显示「查看」按钮，不显示「删除」和「编辑」：
        - 「查看」依然通过 `bindtap="toDetail"` 跳转到任务详情页。

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
    - 根据当前 tab 从云开发数据库 `tasks` 集合中加载对应的任务列表：
      - `owner`：查询 `ownerId` 为当前用户的任务（我发布的）。
      - `worker`：查询 `workerId` 为当前用户的任务（我接受的，当前暂未真正接单，通常为空）。
    - 使用 `formatMoney`、`formatDateTime` 格式化金额和截止时间，并在 `deadline` 为空时把 `deadlineText` 设为「不限」。
  - `async onDeleteTask(e)`：
    - 只在 `tab === 'owner'`（我发布的）时生效。
    - 从 `e.currentTarget.dataset.id` 读取任务 ID。
    - 调用 `confirm('确定要删除这个任务吗？删除后无法恢复。', '删除任务')` 让用户确认。
    - 确认后调用 `db.collection(TASK_COLLECTION).doc(id).remove()` 删除云数据库里的这条任务。
    - 删除成功后 `toast('已删除')` 并重新调用 `load()` 刷新列表；失败时提示「删除失败，请稍后重试」。
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

### 9.2 `cloudfunctions/checkUserByIdNumber/index.js` —— 根据身份证号查重

- 作用：
  - 在服务端（云函数环境）根据身份证号查询 `userInfo` 集合，判断是否已经存在实名记录。
  - 解决前端因为数据库权限限制查不到“别人注册过的身份证号”的问题。
- 入参：
  - `event.idNumber`：字符串，用户在实名页输入的身份证号。
- 返回：
  - `ok: true|false`：本次调用是否成功。
  - `exists: true|false`：当 `ok=true` 时，表示是否已经查到同一个身份证号的用户。
  - `user`：当 `exists=true` 时，返回一个精简的用户对象（只带 `_id`、`_openid`、`name`、`idNumber`），方便后续需要时扩展使用。
- 使用位置：
  - `pages/auth/realname/index.js` 的 `submit()` 中：
    - 在本地校验、邀请码校验、定位校验都通过后，先调用该云函数。
    - 如果 `exists=true`，直接弹出「该用户已存在，请直接登录」，不再 `add()` 新记录。

### 9.3 `cloudfunctions/markMessagesReadByOwner` / `markMessagesReadByPeer` —— 聊天已读标记

- 共同目标：
  - 在服务端统一把某个任务下、某条住户会话里的消息标记为“业主已读”或“住户已读”，避免前端因为数据库权限设置无法更新别人的记录。
- `markMessagesReadByOwner`：
  - 入参：`{ tid, ownerId, peerUserId }`。
  - 行为：
    - 在 `messages` 集合中查找所有满足 `(tid, ownerId, peerUserId)` 的记录。
    - 调用 `update({ data: { readByOwner: true } })` 把这些消息对业主视角全部标记为已读。
  - 使用位置：
    - `pages/chat/room/index.js`：
      - 业主进入某个住户的聊天页时调用一次。
      - 在聊天页的实时监听 `watch` 回调里，每次收到新消息也会调用一次，保证正在聊天时不会产生“未读”。
- `markMessagesReadByPeer`：
  - 入参：`{ tid, ownerId, peerUserId }`。
  - 行为：
    - 在 `messages` 集合中查找同一房间的所有记录，并把 `readByPeer` 统一更新为 `true`。
  - 使用位置：
    - `pages/chat/room/index.js`：
      - 住户进入与业主的聊天页时调用一次。
      - 在聊天页实时监听回调里也会调用一次，保证住户停留在聊天页时看到的新消息不会累积未读数。

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
