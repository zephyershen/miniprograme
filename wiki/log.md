# Wiki Log

## [2026-07-13] init | 创建项目 Wiki 并记录重做边界

- Session: local Codex task
- Target pages: `wiki/AGENTS.md`, `wiki/index.md`, `wiki/overview.md`, `wiki/entities/WeChatMiniProgram.md`, `wiki/sources/2026-07-13-code-and-repository-audit.md`, `wiki/decisions/2026-07-13-rebuild-product.md`
- Summary: 初始化项目级 Wiki，记录 AppID、云环境、Git 元数据、代码完整性、路径漂移风险和新产品约束。
- Sources: 本地项目文件、Git 命令、本次用户对话。
- Sensitive handling: 未保存 AppSecret、API 密钥、支付私钥、证书、用户数据或其他敏感值。
- Follow-ups: 确定并验证非小游戏、低隐私、纯线上获客的新产品方向；清理旧业务前建立存档点。

## [2026-07-13] rebuild | 实现“别收藏了”首版本地代码

- Session: local Codex task
- Target pages: `wiki/index.md`, `wiki/overview.md`, `wiki/timeline.md`, `wiki/entities/WeChatMiniProgram.md`, `wiki/decisions/`, `wiki/sources/`
- Summary: 将正式仓库确定为内层仓库，记录旧版标签和重建分支；把旧业务审计标记为历史证据，新增“别收藏了”首版决策、当前实现、测试结果和未完成的云端步骤。
- Sources: 当前本地代码、Git 命令、31 个 Node 测试、项目静态检查和本次用户确认的实施方案。
- Sensitive handling: 仅记录 AppID、环境 ID 和环境变量名称；未保存 AppSecret、AI 密钥、支付私钥、证书、用户数据或旧数据库内容。
- Follow-ups: 在有权限的微信开发者工具和 CloudBase 环境中完成资源盘点、确认清理、模型核对、部署、体验版上传与 30 天验证。

## [2026-07-14] cloud-cleanup-deploy | 清理旧云业务并部署首版函数

- Session: local Codex task
- Target pages: `wiki/index.md`, `wiki/overview.md`, `wiki/timeline.md`, `wiki/entities/WeChatMiniProgram.md`, `wiki/decisions/`, `wiki/sources/2026-07-14-cloud-cleanup-and-deployment.md`
- Summary: 记录目标环境的在线资源盘点与不可逆清理结果、5 个新集合及权限、标准版计费状态、两个 Node.js 18.15 云函数部署和无写入健康检查；把旧的“云端尚未清理/部署”结论更新为已完成。
- Sources: CloudBase CLI/API 命令输出、`cloudbaserc.json`、当前 Git 状态和本次用户确认。
- Sensitive handling: 未保存登录凭据、密钥值、旧业务数据内容、账户余额数值或支付信息；只记录非敏感资源数量、名称和状态。
- Follow-ups: 用真实微信 OpenID 验证 `dashboard`，确认 CloudBase 模型可调用，完成一次受控文章消化、开发者工具编译、真机预览和体验版上传。

## [2026-07-14] secrets | 保存腾讯云自动化登录凭据

- Session: local Codex task
- Target pages: `wiki/secrets/index.md`, `wiki/secrets/TencentCloud.md`, `wiki/log.md`
- Summary: 按用户明确要求，将腾讯云 CloudBase 自动化登录凭据保存到项目 Wiki 的受限敏感区，并记录用途、环境、验证状态和轮换规则。
- Sources: 本次用户对话和已完成的 CloudBase 登录/部署验证。
- Sensitive handling: 实际账号和密码只存在于 `wiki/secrets/TencentCloud.md`；普通日志不记录实际值，整个 `wiki/secrets/` 已由 `.gitignore` 排除。
- Follow-ups: 用户轮换密码后同步更新受限文件；自动化任务仅在项目授权范围内读取。

## [2026-07-15] runtime-fix-e2e | 完成真实微信闭环并记录 AI 降级策略

- Session: local Codex task
- Target pages: `wiki/index.md`, `wiki/overview.md`, `wiki/timeline.md`, `wiki/entities/WeChatMiniProgram.md`, `wiki/decisions/`, `wiki/sources/2026-07-15-wechat-e2e-and-runtime-fixes.md`, `wiki/log.md`
- Summary: 记录真实微信身份下的完整业务闭环，写入 `_id`、事务并发和 `ws` 依赖修复，确认 `hunyuan-v3 / hy3-preview` 的 429 额度限制，并接受明确标注的本地临时摘要兜底。验证数据已清除。
- Sources: 微信开发者工具运行结果、CloudBase 函数日志与 API、当前代码、32 个 Node 测试和静态检查。
- Sensitive handling: 普通 Wiki 未记录登录凭据、临时令牌或 OpenID；既有实际账号与密码仍只保存在被 Git 忽略且受本机 ACL 限制的 `wiki/secrets/`。
- Follow-ups: 用户决定是否开通适用的 AI 套餐或配置自有模型；随后预览、上传体验版并开始 30 天验证。

## [2026-07-15] editorial-ui | 采用编辑索引式知识平台方向并完成首轮 UI 落地

- Session: local Codex task
- Target pages: `wiki/index.md`, `wiki/overview.md`, `wiki/timeline.md`, `wiki/entities/WeChatMiniProgram.md`, `wiki/decisions/2026-07-13-digest-inbox-v1.md`, `wiki/decisions/2026-07-15-editorial-knowledge-platform-ui.md`, `wiki/sources/2026-07-15-editorial-ui-implementation.md`, `wiki/log.md`
- Summary: 记录用户从个人消化箱转向知识获取平台的产品决策、选定的编辑索引 Moodboard、当前 UI 实现和验证结果；将旧“不做资讯流”边界标记为 superseded，同时保留已验证摘要闭环作为迁移基础。
- Sources: 本次用户对话、选定 Moodboard、本地代码、微信开发者工具模拟器、35 个 Node 测试和静态检查。
- Sensitive handling: 未读取或记录账号、密码、令牌、OpenID 或其他敏感值。
- Follow-ups: 实现官方来源白名单、抓取/订阅、去重、时效排序和内容审核；在此之前不得宣称已提供实时官方资讯。

## [2026-07-15] aihot-feed | 接入 AI HOT 图文资讯并完成云端验证

- Session: local Codex task
- Target pages: `wiki/index.md`, `wiki/overview.md`, `wiki/timeline.md`, `wiki/entities/WeChatMiniProgram.md`, `wiki/sources/2026-07-15-aihot-feed-integration.md`, `wiki/log.md`
- Summary: 记录 AI HOT 公开精选 API、AI/科技频道映射、资讯详情页、15 分钟缓存、来源追踪、原文封面安全缓存与分类视觉兜底；新增一个管理端集合和第三个云函数，并完成真实数据、存储、测试及模拟器验证。
- Sources: AI HOT 公开接口、原文公开元数据、本地代码、CloudBase CLI/API、云函数日志、对象存储清单和微信开发者工具模拟器。
- Sensitive handling: 未读取或写入账号密码、令牌、OpenID 或个人数据；缓存仅包含公共资讯与云封面 ID。
- Follow-ups: 分别接入娱乐、社会、游戏和英语来源；补充重点厂商官方直连、跨来源去重、审核和定时封面维护。

## [2026-07-15] public-feed-cleanup | 首页收敛为纯资讯流

- Session: local Codex task
- Target pages: `wiki/index.md`, `wiki/overview.md`, `wiki/decisions/2026-07-15-editorial-knowledge-platform-ui.md`, `wiki/sources/2026-07-15-aihot-feed-integration.md`, `wiki/log.md`
- Summary: 按用户截图反馈移除首页总标题说明、英文眉题、设置入口、待处理/导入/关注方向和个人队列；用户界面隐藏聚合平台、API、缓存等接入实现，仅展示具备真实原图的 7 条资讯，不再生成或绘制缺图兜底封面。
- Sources: 本次用户对话、当前代码、41 个 Node 测试、静态检查、线上云函数调用和微信开发者工具模拟器截图。
- Sensitive handling: 未读取或记录账号、密码、令牌、OpenID 或个人数据。
- Follow-ups: 为当前无图条目补抓合规原图，并分别接入娱乐、社会、游戏和英语来源；在没有真实图片前继续隐藏相应条目。

## [2026-07-15] engaging-detail | 详情页改为短读导览和条件式原文入口

- Session: local Codex task
- Target pages: `wiki/index.md`, `wiki/overview.md`, `wiki/timeline.md`, `wiki/decisions/2026-07-15-engaging-news-detail.md`, `wiki/sources/2026-07-15-aihot-feed-integration.md`, `wiki/log.md`
- Summary: 把详情页重组为真实封面、30 秒导读、三条关键信息、三条有图相关阅读和原始出处；增加已验证业务域名白名单与复制链接兜底，并清除来源标签中的 RSS、翻译中转等技术后缀，避免空白页、大段转载和采集实现暴露。
- Sources: 本次用户对话、当前代码、45 个 Node 测试、静态检查、线上云函数详情调用和微信开发者工具模拟器。
- Sensitive handling: 未读取或记录账号、密码、令牌、OpenID 或个人数据。
- Follow-ups: 接入新官方来源时同步评估微信业务域名资质；只有完成验证的域名才能加入小程序内直开白名单。

## [2026-07-15] feed-scale-filter | 扩大内容池、修复摘要缺失并实现主题筛选

- Session: local Codex task
- Target pages: `wiki/index.md`, `wiki/overview.md`, `wiki/timeline.md`, `wiki/decisions/2026-07-15-engaging-news-detail.md`, `wiki/decisions/2026-07-15-editorial-knowledge-platform-ui.md`, `wiki/sources/2026-07-15-aihot-feed-integration.md`, `wiki/log.md`
- Summary: 将近 7 天精选内容池从固定 20 条扩为游标分页的 108 条，整池检查后公开 13 条真实图文；取消详情字符裁剪并完整展示上游摘要；新增时间、公司与模型、技术方向组合筛选、选项计数和空项禁用。
- Sources: 公开 API/Topics 页面、当前代码、CloudBase 云端调用、真实来源封面、51 个 Node 测试、静态检查和微信开发者工具渲染。
- Sensitive handling: 未读取或记录账号、密码、令牌、OpenID 或个人数据；普通 Wiki 只记录公开资讯和非敏感运行事实。
- Follow-ups: 继续增加合规图文来源和重点厂商官方直连；若需提高 13 条公开图文数量，应改善真实图片获取，不恢复假封面或缺图条目。

## [2026-07-15] show-text-only-feed | 取消封面展示门槛并修复筛选弹层

- Session: local Codex task
- Target pages: `wiki/index.md`, `wiki/overview.md`, `wiki/timeline.md`, `wiki/decisions/2026-07-15-editorial-knowledge-platform-ui.md`, `wiki/sources/2026-07-15-aihot-feed-integration.md`, `wiki/log.md`
- Summary: 按用户新规则公开全部 108 条资讯，无图内容使用纯文字编辑行；首页、详情和相关阅读不再要求封面。筛选弹层改为独立滚动区并修复底部按钮遮挡，同时记录线上 CloudBase 与本地开发浏览器的网络边界。
- Sources: 本次用户对话、当前代码、CloudBase 线上 108/108 调用、微信开发者工具首页/筛选/无图详情验证、52 个 Node 测试和静态检查。
- Sensitive handling: 未读取或记录账号、密码、令牌、OpenID 或个人数据；网络说明不包含凭据或内部地址。
- Follow-ups: 继续提高真实封面命中率和接入其他频道来源，但不得再次以缺图为由隐藏已收录资讯。

## [2026-07-16] feed-lazy-pagination | 首页改为服务端分页和触底增量加载

- Session: local Codex task
- Target pages: `wiki/index.md`, `wiki/overview.md`, `wiki/sources/2026-07-15-aihot-feed-integration.md`, `wiki/log.md`, `README.md`
- Summary: 将旧的“全部资讯一次下发和渲染”标记为 superseded；`knowledgeFeed` 先完成频道与主题筛选，再按 8 条一页返回，首页触底追加并在频道/筛选变化时重置。云函数已部署，线上第一页、第二页和组合筛选均验证通过。
- Sources: 本次用户要求、当前代码、55 个 Node 测试、静态检查、CloudBase 部署与三次线上函数调用、微信开发者工具模拟器画面。
- Sensitive handling: 未读取、记录或新增账号、密码、令牌、代理地址或个人数据；沿用现有本机 CloudBase 登录状态完成部署。
- Follow-ups: 暂不建设公网代理；后续按具体来源做可用性监控，只有官方接口与公开源确实无法稳定访问时再单独评估合规采集节点。

## [2026-07-16] feed-sort | 新增最新与热度排序并保持筛选分页

- Session: local Codex task
- Target pages: `wiki/index.md`, `wiki/overview.md`, `wiki/sources/2026-07-15-aihot-feed-integration.md`, `wiki/log.md`, `README.md`
- Summary: 将默认资讯顺序明确为发布时间从新到旧，新增热度从高到低排序；两种顺序都在频道和时间、公司/模型、技术方向筛选之后执行，再按 8 条一页下发。切换排序时从第一页重载，同热度按发布时间倒序。
- Sources: 本次用户要求、当前代码、57 个 Node 测试、静态检查、CloudBase 部署以及最新、热度近 7 天、热度近 24 小时三组线上函数调用。
- Sensitive handling: 未读取、记录或新增账号、密码、令牌、代理地址或个人数据；沿用现有本机 CloudBase 登录状态完成部署。
- Follow-ups: 当前热度使用上游编辑热度值；若未来需要反映小程序用户行为，应另行设计合规的浏览、停留和收藏统计口径。

## [2026-07-16] modular-refactor | 按能力与依赖边界重构知识资讯主链路

- Session: local Codex task
- Target pages: `README.md`, `wiki/index.md`, `wiki/overview.md`, `wiki/decisions/2026-07-16-modular-architecture.md`, `wiki/sources/2026-07-16-modular-refactor.md`, `wiki/reports/architecture-2026-07-16.md`, `wiki/log.md`
- Summary: 按用户指定的 modular-code-architect 规范，将小程序端拆为知识资讯/个人消化 feature 与共享 CloudBase 传输，将 `knowledgeFeed` 拆为外部源 adapter、缓存 repository、用例 service 和公开 presenter；入口只保留编排。删除不可达且依赖缺失的旧社区引导，补齐 `ws` 依赖。
- Sources: 当前代码审查、66 个 Node 测试、项目检查、CloudBase 两次部署以及最新列表、热度时间筛选、有效详情、无效详情线上回归。
- Sensitive handling: 未读取或记录账号、密码、令牌、OpenID 或个人数据；沿用本机现有 CloudBase 登录状态部署。
- Follow-ups: 新内容源通过 adapter 接入并统一条目契约；两个已退出首页的旧摘要函数只在重新启用或新增需求时按相同边界逐片迁移。

## [2026-07-16] wechat-module-resolution-fix | 修复微信打包器模块未定义错误

- Session: local Codex task
- Target pages: `README.md`, `wiki/overview.md`, `wiki/decisions/2026-07-16-modular-architecture.md`, `wiki/sources/2026-07-16-modular-refactor.md`, `wiki/reports/architecture-2026-07-16.md`, `wiki/log.md`
- Summary: 真实微信编译发现模块化重构中的 `...require(...)` 聚合和无扩展名页面引用未被打包器稳定收包；改为具体模块直引并统一补齐 `.js`，新增项目检查规则。首页加载 106 条资讯、详情打开且控制台项目红色错误清空。
- Sources: 用户截图、当前代码、66 个 Node 测试、项目检查、微信开发者工具首页和详情实机模拟器验证。
- Sensitive handling: 未读取或记录账号、密码、令牌、OpenID 或个人数据；未访问 `wiki/secrets/`。
- Follow-ups: 后续客户端模块重构必须同时通过 Node 测试、`npm run check` 与微信开发者工具普通编译；Node smoke test 不再单独作为运行时兼容证据。

## [2026-07-16] default-hot-feed | 首页默认优先展示高热度资讯

- Session: local Codex task
- Target pages: `README.md`, `wiki/overview.md`, `wiki/sources/2026-07-15-aihot-feed-integration.md`, `wiki/log.md`
- Summary: 按用户对首屏吸引力的要求，将首页默认排序从“最新”改为“热度”，并把热度入口置于排序选项首位；频道与时间、公司/模型、技术方向筛选仍先于排序执行，同热度继续按发布时间倒序，用户仍可手动切换“最新”。
- Sources: 本次用户要求、当前代码、67 个 Node 测试、项目检查、CloudBase 部署与默认参数线上调用、微信开发者工具重新编译后的首页画面。
- Sensitive handling: 未读取或记录账号、密码、令牌、OpenID 或个人数据；沿用本机现有 CloudBase 登录状态完成部署。
- Follow-ups: 当前热度仍使用上游编辑热度值；未来如引入小程序内行为热度，需要另行定义合规的浏览、停留、收藏权重和防刷机制。

## [2026-07-16] featured-hot-latest-feed | 主稿热度优先、普通资讯默认时间倒序

- Session: local Codex task
- Target pages: `README.md`, `wiki/index.md`, `wiki/overview.md`, `wiki/sources/2026-07-15-aihot-feed-integration.md`, `wiki/log.md`
- Summary: 用户澄清首页不是默认整列热度排序；将上一条 `default-hot-feed` 结论标记为 `superseded`。当前规则是先在频道与筛选结果中选出热度最高的一条作为放大主稿，再把其余资讯按发布时间从新到旧排列且不重复主稿；只有用户主动切换“热度”时整列才按热度排序。
- Sources: 本次用户澄清、当前代码、67 个 Node 测试、项目检查、CloudBase 重新部署与默认参数线上调用、微信开发者工具重新编译后的首页画面。
- Sensitive handling: 未读取或记录账号、密码、令牌、OpenID 或个人数据；沿用本机现有 CloudBase 登录状态完成部署。
- Follow-ups: 热度仍使用上游编辑值；后续新增内容源时必须把所有候选先统一归一化，再在完整筛选结果中选择主稿，不能只比较当前分页的局部数据。
