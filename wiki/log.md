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

## [2026-07-16] pure-feed-sorting | 最新与热度分别使用单一排序规则

- Session: local Codex task
- Target pages: `README.md`, `wiki/index.md`, `wiki/overview.md`, `wiki/sources/2026-07-15-aihot-feed-integration.md`, `wiki/log.md`
- Summary: 用户取消“主稿热度优先、其余时间倒序”的混合规则，将 `featured-hot-latest-feed` 标记为 `superseded`。最终规则为：“最新”对包括放大主稿在内的全部资讯按发布时间倒序；“热度”对全部资讯按热度倒序，同热度按发布时间倒序；放大主稿始终是当前排序的第一条。
- Sources: 本次用户决定、当前代码、67 个 Node 测试、项目检查、CloudBase 重新部署与最新/热度两组线上调用、微信开发者工具重新编译后的首页画面。
- Sensitive handling: 未读取或记录账号、密码、令牌、OpenID 或个人数据；沿用本机现有 CloudBase 登录状态完成部署。
- Follow-ups: 后续新增排序方式时继续保持“一个选项对应完整列表的一种明确顺序”，避免再引入隐式主稿例外。

## [2026-07-16] source-preview-renderer | 缺图资讯原文截图服务上线

- Session: local Codex task
- Target pages: `wiki/index.md`, `wiki/overview.md`, `wiki/timeline.md`, `wiki/decisions/2026-07-16-source-preview-renderer.md`, `wiki/sources/2026-07-16-source-preview-deployment.md`, `wiki/secrets/index.md`, `wiki/log.md`
- Summary: 使用用户已有公网服务器部署非 root Playwright 截图服务，经回环 Mihomo 和 Nginx 鉴权路由为无封面资讯生成最多 3 张原文页面截图；CloudBase 新增维护 action、事务合并和孤儿清理队列，小程序首页使用截图视觉，详情支持 `wx.previewImage` 多图预览。上游动态池从 108 更新为 106 后自动发现并补齐 1 条新缺口，最终 106/106 有视觉素材，其中 13 条真实封面、93 条原文截图。
- Sources: 当前代码、服务器 systemd/Nginx/Mihomo 状态、CloudBase 部署和强制重建、云存储 220 张截图、82 个 Node 测试、项目检查、渲染器依赖审计、微信开发者工具详情及 `1/3 → 2/3` 多图预览。
- Sensitive handling: 按用户授权将原 `docs/txserverinfo.txt` 移入被 Git 忽略的 `wiki/secrets/` 原始凭据区，并新增服务器与截图令牌元数据页；普通 Wiki 和 Git 不包含实际服务器密码或令牌，云函数部署包已验证不包含 `config.local.js`。
- Follow-ups: 单独评估 `wx-server-sdk 4.0.2` 的传递依赖升级路径；服务器仍有系统更新并提示需要重启，后续应在维护窗口处理；迁移截图服务时必须保留代理后的私网出口阻断。

## [2026-07-16] visual-publication-gate | 新资讯先准备视觉再公开

- Session: local Codex task
- Target pages: `README.md`, `wiki/index.md`, `wiki/overview.md`, `wiki/timeline.md`, `wiki/entities/WeChatMiniProgram.md`, `wiki/decisions/2026-07-15-editorial-knowledge-platform-ui.md`, `wiki/decisions/2026-07-15-engaging-news-detail.md`, `wiki/decisions/2026-07-16-modular-architecture.md`, `wiki/decisions/2026-07-16-source-preview-renderer.md`, `wiki/sources/2026-07-15-aihot-feed-integration.md`, `wiki/sources/2026-07-16-modular-refactor.md`, `wiki/sources/2026-07-16-source-preview-deployment.md`, `wiki/log.md`
- Summary: 为资讯缓存增加视觉发布门禁和 5 分钟定时维护；新资讯先尝试真实封面，再生成原文截图，视觉就绪后才进入首页、详情、筛选计数和相关阅读。补充 URL 版本、随机上传代际、`expectedUrl` 事务条件、删除 claim、逐文件确认、失败防饥饿与 30 分钟重试，避免旧图误写、并发重放和长期阻塞。定时入口改用腾讯云 `TRIGGER_SRC=timer`，所有维护 action 从小程序公开路由移除。详情页将来源 URL 与紧凑复制按钮移到“接着看”之前，并明确微信不能直接唤起任意系统浏览器。
- Sources: 本次用户要求、当前代码、90 个 Node 测试、项目检查、CloudBase 部署信息、2026-07-16 18:00 真实定时触发日志和微信开发者工具验证。
- Sensitive handling: 未把云函数环境变量、服务器密码、令牌或其他凭据写入普通 Wiki 或 Git；沿用现有受限配置完成部署。
- Follow-ups: 若后续要在微信内直接打开某个来源，必须先在微信公众平台完成对应业务域名验证；持续观察登录墙、地区限制和反爬导致的截图失败率。

## [2026-07-17] fingerprint-sync-and-carousel | 指纹增量同步与详情自动轮播

- Session: local Codex task
- Target pages: `wiki/index.md`, `wiki/overview.md`, `wiki/timeline.md`, `wiki/entities/WeChatMiniProgram.md`, `wiki/decisions/2026-07-15-engaging-news-detail.md`, `wiki/decisions/2026-07-16-source-preview-renderer.md`, `wiki/decisions/2026-07-17-fingerprint-driven-feed-sync.md`, `wiki/sources/2026-07-15-aihot-feed-integration.md`, `wiki/sources/2026-07-17-fingerprint-sync-and-carousel.md`, `wiki/log.md`
- Summary: 将资讯同步改为每分钟 fingerprint 检查、变化才拉条目，并保留 15 分钟条件校验与 6 小时完整校验；加入跨实例租约、事务写校验、持久化退避和 Timer fail closed。因 CloudBase 单函数只保留一个触发器，视觉维护收敛到同一可信周期的 5 分钟刻度。详情截图改为自动轮播、圆点跟随和单图点击放大。
- Sources: 本次用户要求、当前代码、107 个 Node 测试、项目检查、CloudBase 函数与触发器状态、08:31/08:32 真实定时日志、缓存状态查询。
- Sensitive handling: 代码更新采用仅上传函数代码的方式，线上三个截图服务环境变量名称保留；普通 Wiki 未记录任何变量值、账号、密码或令牌。
- Follow-ups: 在真机抽查 1/2/3 张截图、循环圆点和返回后继续轮播；持续观察 fingerprint 接口的可用性、429/5xx 退避和 5 分钟视觉分支日志。

## [2026-07-17] history-immediate-visuals | 60 天归档、即时视觉与长页整组预览

- Session: local Codex task
- Target pages: `README.md`, `wiki/index.md`, `wiki/overview.md`, `wiki/timeline.md`, `wiki/entities/WeChatMiniProgram.md`, `wiki/decisions/2026-07-15-engaging-news-detail.md`, `wiki/decisions/2026-07-16-source-preview-renderer.md`, `wiki/decisions/2026-07-17-fingerprint-driven-feed-sync.md`, `wiki/decisions/2026-07-17-feed-history-and-visual-publication.md`, `wiki/sources/2026-07-15-aihot-feed-integration.md`, `wiki/sources/2026-07-17-fingerprint-sync-and-carousel.md`, `wiki/sources/2026-07-17-feed-history-and-long-preview.md`, `wiki/log.md`
- Summary: 核实 SCF 平台支持同函数多个触发器，旧“平台只能一个”结论标记为 `superseded`；由于 CloudBase CLI 3.6.1 只支持配置一个并会覆盖列表，线上仍采用单个分钟触发器。新资讯改为同分钟准备封面/截图，5 分钟分支只做重试与清理，并用视觉优先调度、4 分钟租约、控制状态保留和上传清理日志满足 180 秒预算。新增 60 天日报精选归档并前向保留 90 天，免费访问仍固定 7 天。详情列表只传首图、详情返回全部，页面和全屏均支持整组滑动；长页动态重测并最多截 12 张。
- Sources: AI HOT 公开接入说明与 OpenAPI、腾讯云 SCF/CloudBase CLI 官方文档、当前代码、119 个 Node 测试、项目检查、公网真实 5 图捕获、CloudBase 10:03–10:10 定时日志、线上免费 feed 与 8 图详情调用。
- Sensitive handling: 公网服务器与 CloudBase 凭据继续只保存在被 Git 忽略的 `wiki/secrets/` 或云环境；普通 Wiki 未写入账号、密码、令牌或环境变量值。
- Follow-ups: 会员、支付、可信权益解析和历史查询尚未实现；日报回填不是历史全量 items。真机继续抽查 1/5/8 张轮播、从中间图进入全屏及返回后的状态。

## [2026-07-17] full-feed-admin-capacity | 全量资讯、管理员权益与容量收敛

- Session: local Codex task
- Target pages: `README.md`, `wiki/index.md`, `wiki/overview.md`, `wiki/timeline.md`, `wiki/entities/WeChatMiniProgram.md`, `wiki/decisions/2026-07-17-fingerprint-driven-feed-sync.md`, `wiki/decisions/2026-07-17-feed-history-and-visual-publication.md`, `wiki/decisions/2026-07-17-full-feed-and-role-entitlements.md`, `wiki/sources/2026-07-17-fingerprint-sync-and-carousel.md`, `wiki/sources/2026-07-17-feed-history-and-long-preview.md`, `wiki/sources/2026-07-17-full-feed-admin-and-capacity.md`, `wiki/reports/architecture-2026-07-16.md`, `wiki/reports/architecture-2026-07-17.md`, `wiki/log.md`
- Summary: 将公开首页从旧 `selected` 一百余条切到近 7 天 `mode=all` 独立条目库；无图资讯也公开。新增按日轻量索引、服务端 free/admin 权益、旧归档迁移和维护 action；当前唯一微信账号已授权为管理员。同步收敛为分钟 fingerprint、6 小时条件校验、24 小时完整刷新；5 分钟任务只重试到期失败视觉，清理最多每小时一次。抓取上限调整为 6,000、facet 上限 12,000、offset 100,000，日索引支持超过 100 天分页。
- Sources: 本次用户要求、当前代码、AI HOT 公开接入说明、CloudBase/SCF 官方文档、138 个 Node 测试、项目检查、函数部署与状态 action、公网截图健康及服务器既有容量审计。
- Online evidence: 2026-07-17 最终状态为当前 7 天全量 1,949、60 天日索引 2,995、资讯文档 3,034、迁移完成、同步无错误；`knowledgeFeed` Active/Available，512 MB、300 秒；新增集合均为 `ADMINONLY`。
- Sensitive handling: 管理员身份只记录“唯一微信账号授权匹配”的结论，不写 OpenID、派生哈希、维护令牌、服务器账号或密码；实际敏感值继续只存在受限 `wiki/secrets/` 或云环境变量中。
- Follow-ups: 付费开放持续增长的 90 天全量前，改为聚合筛选计数和游标分页；稳定观察后收敛旧精选兼容链路；继续监控截图服务器偶发健康探测超时。

## [2026-07-17] full-visual-queue-quality-performance | 全量补图、质量信号与移动端预算

- Session: local Codex task
- Target pages: `wiki/index.md`, `wiki/overview.md`, `wiki/timeline.md`, `wiki/entities/WeChatMiniProgram.md`, `wiki/decisions/2026-07-16-source-preview-renderer.md`, `wiki/decisions/2026-07-17-full-feed-and-role-entitlements.md`, `wiki/decisions/2026-07-17-full-feed-visual-queue-and-quality.md`, `wiki/sources/2026-07-17-visual-backfill-quality-and-performance.md`, `wiki/reports/architecture-2026-07-17.md`, `wiki/log.md`
- Summary: 将旧精选专用视觉维护扩展为全量去重任务队列，历史先近 7 天后向前补，实时新增拥有最高优先级；线上完成 seed 并验证 worker 2/2。把精选收敛为版本化质量信号，为未来 `curated-filter` 权益预留边界。首页条目级 facet 改为约 19 KB 计数矩阵，分页只追加数据路径，详情只挂载当前及相邻截图并在自动播放一轮后停止。
- Sources: 本次用户要求、当前代码、公开资讯源说明、CloudBase 集合 ACL/索引/函数部署/状态调用、在线 27,092-byte 首屏响应、148 个 Node 测试、项目检查、云函数错误日志。
- Sensitive handling: 维护令牌只从本机受限配置读取并用于调用，未显示、记录或写入普通 Wiki；服务器凭据与截图令牌保持在既有受限位置。
- Follow-ups: 继续观察约 24 小时全量补图队列和函数 P95；为列表派生 360×253 缩略图与约 720px 主图；付费前完成游标分页、规模测试和独立 `curated-filter` entitlement。

## [2026-07-17] list-thumbnails-and-full-reseed | 列表缩略图上线并重新扫描全库

- Session: local Codex task
- Target pages: `README.md`, `wiki/index.md`, `wiki/overview.md`, `wiki/timeline.md`, `wiki/decisions/2026-07-17-full-feed-visual-queue-and-quality.md`, `wiki/sources/2026-07-17-visual-backfill-quality-and-performance.md`, `wiki/reports/architecture-2026-07-17.md`, `wiki/log.md`
- Summary: 在公网渲染器新增受控 360×253 JPEG 缩略图端点，在 CloudBase 增加临时文件 URL、缩略图上传和原子发布边界；列表与相关阅读优先轻量图，详情保留完整视觉。部署后按版本重跑全库 seed，3,005 条有效资讯对应 2,993 个待处理任务，最新分钟 worker 2/2 成功、无 retry/blocked。
- Sources: 当前代码、公网服务部署与健康状态、真实 CloudBase 临时文件缩略图测试、CloudBase 函数部署、受保护 visualStatus、151 个 Node 测试和项目检查。
- Sensitive handling: 部署与维护令牌只从既有受限本机配置读取，未输出实际值，也未写入普通 Wiki 或 Git。
- Follow-ups: 持续观察约 25 小时全库回填和真机性能面板；付费开放持续增长的历史前完成游标分页、12,001/25,000 条规模测试和独立 `curated-filter` entitlement。

## [2026-07-17] pro-membership-intelligence-foundation | Pro 会员与知识智能骨架上线

- Session: local Codex task
- Target pages: `README.md`, `wiki/index.md`, `wiki/overview.md`, `wiki/timeline.md`, `wiki/entities/WeChatMiniProgram.md`, `wiki/decisions/2026-07-17-pro-membership-and-intelligence.md`, `wiki/sources/2026-07-17-pro-membership-implementation.md`, `wiki/reports/architecture-2026-07-17-membership.md`, `wiki/log.md`
- Summary: 落地普通 7 天、Pro 30 天、管理员全部归档的能力型权益；新增资讯/精选/简报/我的四 Tab、固定示例、服务端重鉴权、游标分页、AI 待处理队列、可回溯简报和独立 `knowledgeOps`。生产 AI、真实精选、真实简报与支付入口保持关闭。
- Online evidence: `knowledgeFeed` 和 `knowledgeOps` 已部署为 Active/Available；新集合为 `ADMINONLY`，条目/队列/简报复合索引已创建。受保护运维状态为资讯 3,090、分析/任务/简报/会员 0；分钟日志确认缩略图 worker 继续 2/2，intelligence/digests 为 disabled。
- Sources: 本次用户确认方案、当前代码、168 个 Node 测试、项目检查、CloudBase 函数详情、运维状态、集合 ACL、索引清单和分钟触发日志。
- Sensitive handling: 维护令牌只从本机受限配置读取并写入云函数环境变量；普通 Wiki、Git 和用户可见输出不记录令牌、OpenID、派生 ownerKey、账号或密码。
- Follow-ups: 用户提供 AI API 后在测试环境回填最近 30 天，覆盖至少 95% 且人工抽检通过后再开启真实精选/简报；使用第二个微信账号人工测试 Pro；支付最后接入并单独验证汇付签约、验签、查询、退款和沙箱流程。

## [2026-07-17] admin-role-preview | 当前管理员三身份预览上线

- Session: local Codex task
- Target pages: `README.md`, `wiki/overview.md`, `wiki/timeline.md`, `wiki/decisions/2026-07-17-pro-membership-and-intelligence.md`, `wiki/sources/2026-07-17-pro-membership-implementation.md`, `wiki/log.md`
- Summary: 在“我的”页增加普通用户、Pro 会员、管理员三个身份预览按钮；服务端验证真实管理员授权后只更新原授权记录的 `previewRole`，权益响应区分真实角色和有效角色，非管理员不能切换。资讯 Tab 在会话角色变化后重载，精选和简报继续在显示时重新鉴权。
- Online evidence: `knowledgeFeed` 重新部署成功；身份预览的 free/member、非法角色和非管理员拒绝路径均有测试覆盖。回归为 170/170，项目检查覆盖 27 JSON、143 JavaScript、9 页面。
- Sensitive handling: 未读取、记录或提交 OpenID、ownerKey、账号、密码、维护令牌或其他实际凭据；预览状态不创建真实会员记录。
- Follow-ups: 在微信开发者工具或真机点击三种按钮核对视觉；真实会员到期、宽限、撤销和续费状态仍用第二个微信账号验收。

## [2026-07-17] wechat-devtools-cli-workflow | 固化微信开发者工具 CLI 优先工作流

- Session: local Codex task
- Target pages: `wiki/index.md`, `wiki/overview.md`, `wiki/entities/WeChatMiniProgram.md`, `wiki/concepts/WeChatDevToolsCLI.md`, `wiki/log.md`
- Summary: 将后续微信开发者工具操作固定为 CLI 优先：使用本机既有 CLI、项目根目录和 `9420` 回环服务端口自动启动、打开与验证；图形界面只保留扫码、验证码、权限、审核和主观视觉验收等人工环节。CloudBase 和 Git 继续使用各自 CLI。
- Evidence: Stable 2.01.2510290 下 `auto`、`open`、`islogin` 均成功，登录状态有效，自动化端口只监听 `127.0.0.1:9420`。
- Sensitive handling: 未记录自动化握手值、会话标识、用户数据目录、账号、密码、令牌或其他临时运行信息；普通 Wiki 和 Git 不保存凭据。
- Follow-ups: 微信开发者工具升级后重新验证 CLI 路径、版本和回环端口；每次 CLI 操作后检查 Git 差异，避免提交 `project.config.json` 的无业务格式漂移。

## [2026-07-17] luma-ui-redesign | Luma 珍珠表面 UI 重构

- Session: local Codex task
- Target pages: `wiki/index.md`, `wiki/overview.md`, `wiki/timeline.md`, `wiki/decisions/2026-07-15-editorial-knowledge-platform-ui.md`, `wiki/decisions/2026-07-17-luma-ui-redesign.md`, `wiki/sources/2026-07-17-luma-ui-redesign.md`, `wiki/log.md`
- Summary: 按用户对简约、高端、时尚和 Apple 设计理念的要求，淘汰米白纸张、密集细线和直角视觉；建立冷白珍珠画布、实体表面、蓝紫焦点、连续圆角和悬浮控制层，并重构九个页面 WXSS。业务事件、数据合同、云函数、权限、分页和四 Tab 结构未变。
- Evidence: 170/170 个 Node 测试、项目检查、差异检查通过；微信开发者工具真实数据截图覆盖资讯、详情、精选、简报和我的，页面异常事件为 0。首轮截图发现并修复三身份分段按钮溢出；临时自动化端口清理后只保留 `127.0.0.1:9420`。
- Sensitive handling: 未读取或记录 OpenID、ownerKey、账号、密码、维护令牌或其他凭据；普通 Wiki 与截图文件不包含敏感值。
- Follow-ups: 上传体验版前在至少一台 iPhone 和一台 Android 真机抽查系统字号、透明度/对比度、长标题、筛选抽屉和详情 1/5/8 图场景。

## [2026-07-18] premium-ia-ai-column | 会员精选入口、AI 专栏与产品文案改版

- Session: local Codex task
- Target pages: `wiki/index.md`, `wiki/overview.md`, `wiki/timeline.md`, `wiki/decisions/2026-07-17-pro-membership-and-intelligence.md`, `wiki/decisions/2026-07-16-source-preview-renderer.md`, `wiki/decisions/2026-07-18-premium-learning-and-curation-ia.md`, `wiki/sources/2026-07-18-premium-ia-and-copy.md`, `wiki/log.md`
- Summary: 四 Tab 改为资讯、专栏、简报、我的；资讯顶部加入带锁会员精选入口，原精选功能迁移到非 Tab 页面，原 Tab 改为 Agent/Skill/MCP 等 AI 学习专栏。频道标签移除数字，精选与简报改为结果导向产品文案。完成原文截图正文聚焦三级回退可行性分析，但未修改线上捕获。
- Evidence: 本次用户要求、当前代码、174 个 Node 测试、项目检查、差异检查、微信开发者工具六场景截图和 0 页面异常事件。
- Sensitive handling: 未读取或记录 OpenID、ownerKey、维护令牌、服务器账号或密码；普通 Wiki 与截图不包含实际凭据。
- Follow-ups: 正式收费前将专栏完整正文迁移到服务端重鉴权接口；截图聚焦升级需新增站点适配器、通用正文识别、捕获版本和整页兜底合同，并另行部署与回填。

## [2026-07-18] focus-previews-handdrawn-column | 新资讯聚焦截图与手绘知识卡上线

- Session: local Codex task
- Target pages: `wiki/index.md`, `wiki/overview.md`, `wiki/timeline.md`, `wiki/decisions/2026-07-18-forward-only-focus-previews-and-handdrawn-column.md`, `wiki/sources/2026-07-18-focus-previews-and-handdrawn-column.md`, `wiki/log.md`
- Summary: 将原文截图升级为站点适配器、通用 DOM 正文识别、媒体稳定等待和整页回退；生产只处理发布日期边界后的新资讯。为六个 AI 专栏学习单元生成手绘主图，并把每课重构为概念、机制、判断三页可滑动知识卡。
- Online evidence: 渲染器与 `knowledgeFeed` 部署成功；生产 X 状态页高置信度聚焦，媒体 2/2 就绪，生成 622×1004 单张截图。生产完成 1 个符合新边界的视觉任务、待处理为 0，旧任务由策略跳过；随后上游源出现一次独立退避，本机 fingerprint/items 均为 HTTP 200，等待定时任务恢复。
- Verification: 177/177 个 Node 测试、28 JSON/153 JavaScript/10 页面项目检查和差异检查通过；微信开发者工具实际完成专栏展开和左右滑动，IDE 保持打开。
- Sensitive handling: 部署与维护凭据继续只从受限本机配置读取；普通 Wiki、Git 和用户可见输出不记录令牌、OpenID、派生身份、账号或密码。
- Follow-ups: 正式收费前把完整专栏正文迁移到服务端重鉴权内容接口；继续观察上游源退避恢复，并仅在真实聚焦误判样本证明必要时评估视觉模型兜底。

## [2026-07-18] ai-column-external-poster-import | 18 张完整手绘海报接入专栏

- Session: local Codex task
- Target pages: `wiki/overview.md`, `wiki/timeline.md`, `wiki/decisions/2026-07-18-forward-only-focus-previews-and-handdrawn-column.md`, `wiki/sources/2026-07-18-focus-previews-and-handdrawn-column.md`, `wiki/log.md`
- Summary: 将用户在 `png/` 提供的 18 张完整中文手绘知识海报按六课三页导入；新增源尺寸校验与 WebP 压缩脚本、独立资源映射，并把专栏页面简化为整幅海报轮播。旧六张 JPEG 占位图已替换，原始 PNG 保留。
- Evidence: 18/18 个 680×907 WebP 唯一且总计 1,682,558 bytes；主包运行时源文件估算 1,873,666 bytes；177/177 测试、28 JSON/154 JavaScript/10 页面检查及差异检查通过。微信开发者工具验证 Agent 第一/第二页和 Skill 海报，控制台无新增红色错误，IDE 保持打开。
- Sensitive handling: 本轮只处理本地视觉资产和展示代码，未读取或记录 OpenID、ownerKey、维护令牌、服务器账号、密码或其他凭据。
- Follow-ups: 正式收费前将完整专栏内容迁移到服务端重鉴权接口；上传体验版前在 iPhone 与 Android 真机复核 WebP 解码、中文细字、长屏滚动和 18 张海报的逐页顺序。

## [2026-07-18] ai-column-mobile-image-compatibility | 修复手机预览海报空白

- Session: local Codex task
- Target pages: `wiki/overview.md`, `wiki/timeline.md`, `wiki/decisions/2026-07-18-forward-only-focus-previews-and-handdrawn-column.md`, `wiki/sources/2026-07-18-focus-previews-and-handdrawn-column.md`, `wiki/log.md`
- Summary: 用户手机预览只显示海报黄色背景，而开发者工具正常。将 18 张运行时 WebP 改为 640×853 非渐进式基线 JPEG，移除 `swiper` 内 `lazy-load` 和淡入，增加图片失败提示、资源 key 日志与 Toast；原始 PNG 保留。
- Evidence: 18/18 个基线 JPEG 唯一且总计 1,603,890 bytes；177/177 测试、28 JSON/154 JavaScript/10 页面检查通过；CLI `preview` 成功并报告总包 1,785,800 bytes。
- Sensitive handling: 本轮没有读取或记录 OpenID、ownerKey、维护令牌、服务器账号、密码或其他凭据；预览命令仅使用开发者工具既有登录态。
- Follow-ups: 用户必须扫描本轮新二维码做真机复验，因为旧预览不会自动更新；重点检查六课第一页与左右翻页。若仍失败，读取新加入的 `poster failed to load` 真机日志，不再依赖纯色背景推断。

## [2026-07-18] ai-column-controlled-lazy-loading | 专栏改为受控懒加载窗口

- Session: local Codex task
- Target pages: `wiki/overview.md`, `wiki/timeline.md`, `wiki/decisions/2026-07-18-forward-only-focus-previews-and-handdrawn-column.md`, `wiki/sources/2026-07-18-focus-previews-and-handdrawn-column.md`, `wiki/log.md`
- Summary: 保留禁用微信图片组件 `lazy-load` 的真机兼容修复，但不再一次创建三张图片。新增 `posterLoadWindow` 策略：课程未展开时 0 张，展开时加载当前页与下一页，滑到第二页才创建第三页；切换课程或轨道时重置到第一页。
- Evidence: 新策略对首、中、末页与越界输入均有单元测试；178/178 全量测试、28 JSON/154 JavaScript/10 页面检查通过；CLI 新预览总包 1,786,530 bytes。
- Sensitive handling: 本轮只修改本地展示状态和测试，未读取或记录任何账号、身份或凭据。
- Follow-ups: 用户扫描最新二维码做真机复验；如仍出现空白，依据资源 key 错误日志继续定位，而不恢复组件黑盒懒加载。

## [2026-07-18] hd-column-passive-feed-updates | 高清专栏与不打断阅读的资讯更新

- Session: local Codex task
- Target pages: `wiki/index.md`, `wiki/overview.md`, `wiki/timeline.md`, `wiki/decisions/2026-07-18-passive-feed-updates-and-hd-column-preview.md`, `wiki/sources/2026-07-18-hd-column-and-passive-feed-updates.md`, `wiki/log.md`
- Summary: 专栏新增 CloudBase 高清图组和原生三图预览，包内仍使用受控加载的轻图；资讯新增 opaque head cursor、过滤一致的轻量计数接口和 X 风格悬浮提示，后台检测不再替换用户正在阅读的列表。
- Online evidence: 高清云图 18/18 上传并抽查 HTTP 200；`knowledgeFeed` 部署成功，`feedUpdates` 真实调用返回有效游标；微信预览包 1,793,643 bytes，模拟器无页面异常。
- Verification: 181/181 个 Node 测试、28 JSON/154 JavaScript/10 页面项目检查通过；模拟器确认专栏初始只挂载两张轻图，新资讯提示出现时主稿 ID 保持不变。
- Sensitive handling: 未读取或记录 OpenID、ownerKey、账号、密码、维护令牌或其他实际凭据。
- Follow-ups: 用户扫描最新二维码在真机验证高清缩放/三图滑动与新资讯提示；正式收费前仍需将完整专栏正文迁移到服务端重鉴权内容接口。

## [2026-07-18] engagement-editorial-social-ui | 资讯互动与编辑蓝会员转化界面上线

- Session: local Codex task
- Target pages: `README.md`, `wiki/index.md`, `wiki/overview.md`, `wiki/timeline.md`, `wiki/entities/WeChatMiniProgram.md`, `wiki/decisions/2026-07-17-luma-ui-redesign.md`, `wiki/decisions/2026-07-18-engagement-and-editorial-social-ui.md`, `wiki/sources/2026-07-18-engagement-ui-implementation.md`, `wiki/reports/architecture-2026-07-18-engagement.md`, `wiki/log.md`
- Summary: 接通资讯评论、喜爱、收藏和微信分享；评论为服务端 Pro 权益，喜爱加入热度，收藏以紧凑快照跨页保存。锁定能力统一使用编辑蓝会员转化卡，并把其他页面收敛到资讯页的冷白、实体表面和克制阴影。新增互动/评论表、ACL 和索引，重新部署 `knowledgeFeed`。
- Evidence: 当前代码、CloudBase 表/ACL/索引与函数部署、185 个 Node 测试、项目检查、CLI 预览、开发者工具截图、真实微信上下文下的热度往返、收藏跨页记录、评论读取和分享 payload。
- Sensitive handling: 普通 Wiki 未记录 OpenID、派生 owner key、账号、密码、令牌或自动化会话；测试产生的喜爱和收藏均已还原。
- Architecture: 本轮范围 9.2/10、新互动能力 9.4/10、整体约 9.0/10。当前任务规则不允许子代理，按相同 rubric 完成主代理自审；页面控制器偏长和真实第二账号/好友接收仍是明确未验证项。
- Follow-ups: 上传体验版前用第二真实账号验证免费/Pro 生命周期，并在 iPhone、Android 各完成一次评论输入、收藏列表和微信好友接收分享卡片的人工验收。

## [2026-07-19] interaction-reliability-profiled-media-comments | 互动可靠性与资料化原图评论

- Session: local Codex task
- Target pages: `wiki/index.md`, `wiki/overview.md`, `wiki/timeline.md`, `wiki/entities/WeChatMiniProgram.md`, `wiki/decisions/2026-07-19-profiled-media-comments-and-optimistic-engagement.md`, `wiki/sources/2026-07-19-interaction-reliability-and-comment-media.md`, `wiki/reports/architecture-2026-07-19-engagement-v2.md`, `wiki/log.md`
- Summary: 修复生产 `TransactionBusy` 与按钮等待感，改为乐观目标状态、顺序事务读和幂等评论；评论组件新增表情、手机原图、高清预览、主动头像昵称与“我的”编辑入口，移除“PRO”。无图资讯根因确认为原文预览 renderer HTTP 422，继续显示真实文字卡而不伪造图片。
- Online evidence: `knowledgeFeed` 部署成功；`knowledge_user_profiles` ACL 为 `ADMINONLY`；真实微信上下文完成喜爱/收藏开启还原，09:28–09:32 日志中 `TransactionBusy=0`、公共临时失败为 0；评论组件折叠/展开及资料页自动化通过。
- Verification: 185/185 Node 测试、31 JSON/173 JavaScript/11 页面项目检查和 `git diff --check` 通过；详情控制器由 463 行降至 283 行，本轮模块化评分 9.2/10。
- Sensitive handling: 没有替用户写入虚构头像昵称或访问真实相册；普通 Wiki 未记录昵称、头像、OpenID、派生 owner key、令牌或自动化会话。
- Follow-ups: 在真实 iPhone/Android 验收微信头像昵称、系统键盘位置、相册原图与好友接收；图片评论公开放量前接入内容审核和违规处置。

## [2026-07-19] comment-keyboard-dock-and-channel-availability | 评论键盘停靠与频道可用性收敛

- Session: local Codex task
- Target pages: `wiki/overview.md`, `wiki/timeline.md`, `wiki/entities/WeChatMiniProgram.md`, `wiki/decisions/2026-07-19-profiled-media-comments-and-optimistic-engagement.md`, `wiki/sources/2026-07-19-interaction-reliability-and-comment-media.md`, `wiki/log.md`
- Summary: 评论输入改为整块监听键盘高度并停靠在键盘顶部，底层详情页在评论打开时锁滚动；发送按钮固定 96rpx，表情扩为 64 个滚动网格，图片按钮使用 Lucide 标准轮廓。娱乐、社会、游戏和英语因缺少内容源暂时从导航隐藏，但保留分类规则。
- Evidence: 186/186 Node 测试、31 JSON/174 JavaScript/11 页面检查、`git diff --check`；微信开发者工具自动化确认 `all/featured/ai/tech` 导航、336px 键盘停靠、49px 模拟器按钮实宽、64 个表情、`overflow: hidden` 页面锁与评论独立滚动。
- Sensitive handling: 本轮未读取或写入用户头像、昵称、OpenID、owner key、相册内容、账号、密码或令牌；自动化只使用测试展示数据。
- Follow-ups: 在真实 iPhone 与 Android 上分别验证系统键盘动画、不同输入法高度、评论手势滚动和相册图片；四个暂隐藏频道需在各自内容源和去重审核机制完成后再恢复。

## [2026-07-19] rapid-engagement-and-right-aligned-send | 详情互动快速连点与发送右对齐

- Session: local Codex task
- Target pages: `wiki/overview.md`, `wiki/timeline.md`, `wiki/entities/WeChatMiniProgram.md`, `wiki/decisions/2026-07-19-profiled-media-comments-and-optimistic-engagement.md`, `wiki/sources/2026-07-19-interaction-reliability-and-comment-media.md`, `wiki/log.md`
- Summary: 将详情喜欢/收藏从“等待上次请求”改为可随时反向的最新目标同步，页面文案始终为“喜欢/收藏”并只变图标；评论发送按钮独占工具行最右列。
- Evidence: 188/188 Node 测试、31 JSON/175 JavaScript/11 页面项目检查和 `git diff --check`；微信开发者工具实测喜欢两次快速反向点击 29ms、收藏 16ms，最终均还原，发送按钮与工具行右缘间距 0px。
- Sensitive handling: 本轮未读取或记录用户头像、昵称、OpenID、owner key、相册内容、账号、密码或令牌；自动化只恢复互动前状态。
- Follow-ups: 在真实 iPhone/Android 进行双指快点、断网回滚和键盘工具行最终人工验收；公开上线前仍需完成用户内容审核、隐私合规与体验版验证。

## [2026-07-19] packy-grok-intelligence-pilot | Packy/Grok 知识分析接入与生产小批验证

- Session: local Codex task
- Target pages: `README.md`, `wiki/index.md`, `wiki/overview.md`, `wiki/timeline.md`, `wiki/entities/WeChatMiniProgram.md`, `wiki/decisions/2026-07-17-pro-membership-and-intelligence.md`, `wiki/sources/2026-07-19-packy-grok-intelligence.md`, `wiki/reports/architecture-2026-07-19-intelligence.md`, `wiki/log.md`
- Summary: 接入 PackyAPI Responses `grok-4.5`，实现严格单条/五条合批分析、来源可回溯简报、低推理、队列优先级、日上限、覆盖率与原始用量汇总。生产完成四条分析后关闭自动消费；真实精选和简报保持关闭。
- Online evidence: 模型列表与 Responses 成功；生产 4 条 ready、0 retry/blocked，最近 30 天 4/2,363；三条真实合批 2,218 token，原始成本单位较单条平均外推下降约 46%。`knowledgeFeed`、`knowledgeOps` 部署成功，最终环境开关确认 intelligence/digest generation/live curated/live digests 全部为 false。
- Verification: 197/197 Node 测试、31 JSON/178 JavaScript/11 页面项目检查、真实单条/合批 API、生产队列与分析文档抽查。模块化复审本轮 9.2/10，整体约 9.0/10。
- Sensitive handling: API key 未打印、未写代码/普通 Wiki/部署配置；本地凭据文件已加入 `.gitignore`，生产只使用 CloudBase 环境变量。Wiki 仅记录模型、用量和非敏感状态。
- Follow-ups: 用户确认月预算；新增管理员审核、人工修订、驳回和 AI 披露；受控回填最近 30 天并在覆盖 95% 与抽检通过后分开开启精选、简报生成和公开读取。

## [2026-07-19] automatic-intelligence-and-comment-moderation | 自动知识智能与评论图文审核

- Session: local Codex task
- Target pages: `wiki/index.md`, `wiki/overview.md`, `wiki/timeline.md`, `wiki/entities/WeChatMiniProgram.md`, `wiki/decisions/2026-07-17-pro-membership-and-intelligence.md`, `wiki/decisions/2026-07-19-automatic-ai-curation-and-comment-moderation.md`, `wiki/sources/2026-07-19-packy-grok-intelligence.md`, `wiki/reports/architecture-2026-07-19-automatic-intelligence.md`, `wiki/log.md`
- Summary: 按产品负责人选择开启 Packy/Grok 自动分析、精选、简报生成和公开读取；评论文本及最多三张图片发布前同步多模态审核，采用 fail-closed、提示注入隔离、内部审计与拒绝附件清理。精选/简报增加编辑蓝 AI 判断说明，评论输入显示上传和审核阶段。
- Online evidence: `knowledgeFeed`、`knowledgeOps` 部署完成；生产环境四个知识智能开关为 true、分钟触发器保留；截至记录完成 179 条分析、精选 12 条、发布 2 份真实简报，retry/blocked 为 0。真实截图 Responses 严格审核返回 allow。
- Verification: 199/199 Node 测试、31 JSON/179 JavaScript/11 页面项目检查、`git diff --check`、真实多模态 API 和生产状态查询。模块化复审本轮 9.3/10，整体约 9.1/10。
- Sensitive handling: API key 只保存在被 Git 忽略的本机文件和 CloudBase 环境变量；普通 Wiki、代码和用户输出不记录密钥、维护令牌、OpenID 或派生身份。
- Follow-ups: 观察首份真实简报；在 iPhone/Android 验证相册、键盘、审核等待与高清原图；补评论申诉/管理员覆盖、头像昵称审核和微信隐私/UGC 材料。PackyAPI AUP 的人工复核要求仍是显式风险，不能宣称零人工方案已满足供应商条款。

## [2026-07-19] hide-intelligence-mechanism-copy | 隐藏后台分析与审核机制文案

- Session: local Codex task
- Target pages: `wiki/index.md`, `wiki/overview.md`, `wiki/entities/WeChatMiniProgram.md`, `wiki/decisions/2026-07-19-automatic-ai-curation-and-comment-moderation.md`, `wiki/log.md`
- Summary: 精选与简报删除后台生成说明及 DTO 字段，空状态改为“正在整理”；评论上传后只显示“正在发布”，模型拒绝理由不直接返回用户；旧摘要页移除额度/本地规则提示，设置页移除模型用量卡。内容主题“AI 前沿/AI 专栏”继续保留。
- Online evidence: 微信官方内容安全目录提供 `/wxa/media_check_async` 主动接口；CloudBase 文档说明 COS 自动审核需要在控制台创建并启用任务，且单独计费。项目代码检索未发现微信内容安全调用，当前环境也未配置 COS 自动审核，因此没有移除现有图片审核。
- Deployment: `knowledgeFeed` 与 `digestIngest` 代码更新成功；既有环境变量和分钟触发器未改动。
- Verification: 200/200 个全量 Node 测试、31 JSON/179 JavaScript/11 页面检查和 `git diff --check` 通过。
- Sensitive handling: 普通 Wiki 未记录 API key、维护令牌、OpenID 或派生身份；只记录公开接口名称和非敏感部署状态。
- Follow-ups: 若要节省图片多模态成本，可在 CloudBase COS 显式启用自动审核或接入微信异步接口，但发布前必须先实现审核回调、待发布状态和违规文件处置。

## [2026-07-19] hide-briefing-coverage-warning | 隐藏简报覆盖率告警并复核上线缺口

- Session: local Codex task
- Target pages: `wiki/overview.md`, `wiki/decisions/2026-07-19-automatic-ai-curation-and-comment-moderation.md`, `wiki/log.md`
- Summary: 简报不再展示“当前数据覆盖不完整”黄色提示；`coverage.state/ratio` 继续保存在云端供运维观察，前端展示模型不再接收该内部字段。上线复核确认支付不是唯一缺口，评论治理、公开资料审核、隐私说明一致性、付费内容服务端鉴权和体验版真机验证仍需完成。
- Verification: 200/200 Node 测试、31 JSON/179 JavaScript/11 页面检查与 `git diff --check` 通过。
- Sensitive handling: 未读取或记录支付密钥、商户证书、OpenID、头像、昵称或其他实际用户数据。
- Follow-ups: 先补 UGC 与隐私闭环，再接支付订单/回调/查单/退款和会员生命周期，最后上传体验版进行双端与第二账号验收。

## [2026-07-19] profile-moderation-paid-content-huifu-payment | 资料审核、付费内容保护与斗拱支付部署

- Session: local Codex task
- Target pages: `README.md`, `docs/huifu-membership-payment.md`, `wiki/index.md`, `wiki/overview.md`, `wiki/timeline.md`, `wiki/entities/WeChatMiniProgram.md`, `wiki/decisions/2026-07-17-pro-membership-and-intelligence.md`, `wiki/decisions/2026-07-19-automatic-ai-curation-and-comment-moderation.md`, `wiki/decisions/2026-07-19-huifu-membership-payment-and-paid-content.md`, `wiki/sources/2026-07-19-profile-moderation-and-huifu-payment.md`, `wiki/log.md`
- Summary: 新增昵称/头像发布前审核与拒绝文件清理，删除“不保存昵称”；将专栏完整海报迁出客户端包并用服务端权益重鉴权与短期地址保护；新增斗拱下单、查单、签名验签、异步回调、幂等会员发放和小程序 `wx.requestPayment` 购买入口。按产品选择暂不实现举报、删除、申诉或自动隐藏。
- Online evidence: `knowledgeFeed` 与 `membershipBilling` 部署完成；`/hyyc/membership/notify` 映射成功且 GET 返回 405；云存储规则为 `CUSTOM` 并拒绝客户端直读 `ai-column/`；`knowledge_memberships` 和 `knowledge_membership_orders` 均为 `ADMINONLY`。线上商户配置不完整时 `plans.available=false`，没有真实扣款。
- Verification: 205/205 Node 测试、33 JSON/196 JavaScript/11 页面项目检查、`git diff --check` 通过；斗拱测试覆盖排序签名、同步/原始异步验签、金额/计划校验和 OpenID 不外泄。
- Sensitive handling: 未读取、打印或写入实际汇付私钥、公钥内容、商户号、产品号、OpenID 或用户资料。普通 Wiki 只记录所需环境变量名称和非敏感回调地址；生产密钥必须由用户直接配置到 CloudBase 环境变量。
- Follow-ups: 用户提供 30 天实际售价和非敏感商户/产品标识，并在 CloudBase 直接配置密钥；完成斗拱成功、取消、超时、重复通知、金额不一致与主动查单联调，补退款和退款后权益处理；再以普通/Pro 第二账号做购买、到期和内容重新锁定真机验收。

## [2026-07-19] infrastructure-pricing-and-huifu-mode | 生产配置、斗拱模式与冷启动定价复核

- Session: local Codex task
- Target pages: `wiki/index.md`, `wiki/overview.md`, `wiki/sources/2026-07-19-infrastructure-pricing-and-huifu-mode.md`, `wiki/log.md`
- Summary: 只读连接公网截图服务器并核对 CloudBase 套餐、函数、集合计数和云存储规模；从斗拱官方接口原文确认 `wx_zl_conf` 是微信直连与间联的判断条件，银行公户绑定不能单独决定模式；建议标价 ¥19.9/30 天、冷启动首购 ¥9.9/30 天。
- Online evidence: 公网机为 Ubuntu 24.04、2C2G、约 24.8GB 可用盘，`source-preview/nginx/mihomo` active 且 0 重启；CloudBase 标准版正常，五个函数部署完成，3,629 条资讯、2,105 条 ready 分析、102 条精选、3 份简报、0 有效付费会员、约 662MiB 云存储；支付计划仍为 `available:false` 和 0 元。
- Sensitive handling: SSH 地址、端口、密码、腾讯云登录信息、斗拱密钥、OpenID 与用户资料均未写入普通 Wiki 或用户输出；仅记录非敏感规格、计数和公开文档结论。
- Follow-ups: 用户在斗拱商户业务开通页确认是否存在微信直连配置，再选择 `direct` 或 `sub`；确定首发售价后配置生产环境并完成成功、取消、超时、重复通知、金额不一致、查单和退款联调。

## [2026-07-19] wechat-virtual-payment-membership | 会员支付切换为微信小程序虚拟支付

- Session: local Codex task
- Target pages: `hyyc/features/billing/`, `hyyc/pages/profile/index.js`, `hyyc/app.js`, `hyyc/cloudfunctions/membershipBilling/`, `docs/wechat-virtual-payment-membership.md`, `wiki/index.md`, `wiki/overview.md`, `wiki/timeline.md`, `wiki/entities/WeChatMiniProgram.md`, `wiki/decisions/2026-07-19-wechat-virtual-payment-membership.md`, `wiki/log.md`
- Summary: 30 天会员属于微信定义的虚拟商品，支付通道由斗拱和普通 `wx.requestPayment` 改为 `wx.requestVirtualPayment(mode='short_series_goods')`；服务端使用 `code2Session` 绑定当前调用者、官方查单确认支付、幂等发放权益、发货确认重试和退款后权益回收。客户端只做乐观等待与异常退出恢复，不能凭支付回调直接解锁。
- Online evidence: `membershipBilling` 重新部署成功；线上尚未配置虚拟支付商户参数与定时触发器，真实 `plans` 调用安全返回 `available:false`，因此不会发起真实扣款。原斗拱 HTTPS 回调不再使用。
- Verification: 213/213 Node 测试、33 JSON/198 JavaScript/11 页面项目检查和支付专项 11/11 测试通过；覆盖签名向量、登录账号一致性、订单类型/环境校验、官方查单、空响应发货确认、退款状态与“仅官方查单可发放权益”。
- Sensitive handling: 未把实际 AppKey、AppSecret、session key、access token、OpenID 或支付凭据写入代码、普通 Wiki 或用户输出；线上函数无敏感环境变量。
- Follow-ups: 在微信公众平台开通小程序虚拟支付并发布 590 分的 30 天商品；将配置直接写入 CloudBase 环境变量后启用订单复核定时器或支付结果消息推送；最后在 Android、符合条件的 iOS 真机完成成功、取消、异常退出、重复查询、退款和退款后重新锁定验收。

## [2026-07-20] cloudbase-ai-cost-and-hybrid-routing | CloudBase 模型成本与 Packy 混合路由测算

- Session: local Codex task
- Target pages: `wiki/index.md`, `wiki/overview.md`, `wiki/decisions/2026-07-20-cloudbase-ai-primary-packy-fallback.md`, `wiki/sources/2026-07-20-cloudbase-ai-cost-and-hybrid-routing.md`, `wiki/log.md`
- Summary: 依据腾讯云最新资源点/旧配额/模型单价文档、当前账期真实监控曲线和定时任务代码审计，确认基础设施约占 14 万～17 万点/月，早期模型约需 0.5 万～2 万点/月；提出先优化分钟任务、再以 CloudBase 为主并保留 Packy 自动兜底，预留 10 万点给核心业务。
- Evidence: 当前仍为旧固定配额标准版；最近完整日数据库、函数计算、CloudBase API 等约 4,600 点/日，51 次分钟任务平均 14.76 秒、P95 71.65 秒。官方确认 33 万点为基础设施与模型共享余额，资源点切换不可逆，旧固定配额不切换仍可继续使用。
- Sensitive handling: CloudBase CLI 函数详情命令意外把环境变量回显到内部命令输出后已立即停止；实际值未复制到普通 Wiki、代码或用户输出。建议轮换 Packy Key、运维令牌和截图服务令牌，并避免再次使用该命令读取含密钥的函数。
- Follow-ups: 先合并重复指纹/缓存读取、降低归档统计和简报轮询频率；观察 48 小时至 7 天后，用约 200 条资讯和 30～50 组图文审核做影子对比，再由产品负责人确认是否切换资源点。

## [2026-07-20] cloudbase-resource-points-production-rollout | 资源点、模型主备与隔离调度生产落地

- Session: local Codex task
- Target pages: `wiki/timeline.md`, `wiki/log.md`, `wiki/entities/WeChatMiniProgram.md`, `wiki/overview.md`
- Summary: 将 CloudBase 标准版切换为 330,000 点共享资源点计费且保持超限按量关闭；启用 `qwen3.5-flash`/`qwen3.5-plus` 为主模型，Packy 作为预算与故障兜底。加入 20,000 点内部月度上限、2 倍输出预留、实耗原子补差和真正越过月上限时的持久化熔断，并完成后台任务与客户端性能收敛。
- Online evidence: `knowledgeFeed` 与 `membershipBilling` 代码更新成功；SCF 列表实际验证 `knowledgeFeed` 8 个隔离定时器、`membershipBilling` 1 个对账定时器均为 Available/on。`knowledge_ai_budget`、`knowledge_feed_archive` ACL、付费内容云存储规则和分析/覆盖索引均已在线复核。
- Primary-route proof: 12:00:30 的真实分析定时器以 `cloudbase` / `qwen3.5-flash` 完成，SCF `retCode=0`；任务零重试，实耗 8 点，月账本从 26 点结算到 34 点且 `overrunDetected=false`。此前 Node SDK 默认短超时已改为官方建议的 60 秒初始化；普通预估偏差改为月上限内原子补差，不再误触发整月熔断。
- Verification: 249/249 个 Node 测试、33 JSON/216 JavaScript/9 活跃页面项目检查和 `git diff --check` 通过；微信开发者工具 CLI 预览成功，包体为 248,598 bytes（242.8 KB）。
- Sensitive handling: 未把任何 API key、运维令牌、支付凭据、OpenID、昵称、头像或其他用户数据写入普通 Wiki。
- Follow-ups: 观察共享资源点、`knowledge_ai_budget`、模型兜底和九个定时器的 48 小时至 7 天真实曲线；微信虚拟支付仍需平台商品与支付参数，并需在 Android/iOS 真机完成支付、退款、到期重锁和媒体/分享验收。

## [2026-07-20] wechat-virtual-payment-launch-price | 5.9 元首发活动价与会员价格卡

- Session: local Codex task
- Target pages: `hyyc/cloudfunctions/membershipBilling/`, `hyyc/components/membership-prompt/`, `hyyc/pages/profile/`, `docs/wechat-virtual-payment-membership.md`, `wiki/decisions/2026-07-19-wechat-virtual-payment-membership.md`, `wiki/sources/2026-07-19-wechat-virtual-payment.md`, `wiki/timeline.md`, `wiki/log.md`
- Summary: 30 天会员定为一次购买 5.9 元、不自动续费；10.9 元为微信后台道具价和客户端划线价。实际支付签名使用 `goodsPrice=1090` 与 `activitySellingPrice=590`，订单与权益核对仍只接受 590 分。购买页和会员弹窗均从服务端读取价格并采用蓝黑编辑式价格卡。
- Online evidence: `membershipBilling` 部署成功；远程 `plans` 返回 `priceCents=590`、`compareAtPriceCents=1090` 且 `available=false`。支付密钥和已发布商品仍未配置，不会产生真实扣款。
- Verification: 250/250 个 Node 测试、33 JSON/216 JavaScript/9 活跃页面项目检查和 `git diff --check` 通过；微信开发者工具 CLI 打开项目并完成编译。
- Sensitive handling: 未读取、回显或写入现网 AppKey、AppSecret、session_key、OpenID 或用户信息。普通 Wiki 只记录公开价格、参数名和非敏感平台状态。
- Follow-ups: 用户在虚拟支付后台发布道具 `pro_30d`（1090 分），通过安全渠道配置现网 AppKey、AppSecret、OfferID 与 productId，开启苹果 IAP 支付和退款通知；随后完成 Android/iOS 真实成功、取消、异常退出、重复查单和退款验收。

## [2026-07-20] wechat-virtual-payment-production-config | 现网虚拟支付配置与品牌资料核对

- Session: local Codex task
- Target systems: CloudBase `membershipBilling` 环境变量、微信小程序账号基本信息、`wiki/index.md`、`wiki/overview.md`、`wiki/timeline.md`、`wiki/log.md`
- Summary: 从用户指定的工作区外文件安全读取 AppID、AppSecret 和现网 AppKey，连同已知 OfferID、约定道具 ID `pro_30d`、590/1090 分价格写入云函数环境；未把实际值复制到代码或 Wiki。微信账号资料只读核对确认平台仍显示旧名称“小萃凝聚力”和旧头像，本地项目名称已是“别收藏了”；同时生成新的蓝黑编辑式头像候选 `docs/assets/brand/miniprogram-avatar-v2.png`。
- Online evidence: SCF 状态为 Active，环境变量键完整；远程 `plans` 返回 `available=true`、`planKey=pro_30d`、`priceCents=590`、`compareAtPriceCents=1090`。未创建订单、未拉起收银台、未发生扣款。
- Sensitive handling: 命令只输出字段名、数量和布尔状态；AppSecret、AppKey、access token 与环境变量值均未回显。用户凭据继续保存在工作区外文件和 CloudBase 受限环境中。
- Follow-ups: 确认后台创建的真实道具 ID 与 `pro_30d` 完全一致；在公众平台把名称和头像切换为新品牌，配置小程序简称并开启苹果 IAP；随后上传体验版完成 Android/iOS 真实支付、退款与到期重锁验收。

## [2026-07-20] launch-readiness-remediation | 历史补审、资讯同步恢复与支付通知收口

- Session: local Codex task
- Target pages: `hyyc/cloudfunctions/knowledgeFeed/`, `hyyc/cloudfunctions/knowledgeOps/`, `hyyc/cloudfunctions/membershipBilling/`, `docs/wechat-virtual-payment-membership.md`, `wiki/index.md`, `wiki/overview.md`, `wiki/timeline.md`, `wiki/decisions/2026-07-19-wechat-virtual-payment-membership.md`, `wiki/sources/2026-07-20-launch-readiness-remediation.md`, `wiki/log.md`
- Summary: 新增幂等历史内容补审并将公开查询收紧为只返回审核通过内容；修复缓存 `_id` 回写导致的资讯源持续失败；为微信虚拟支付补齐 JSON 安全模式地址验证、iOS 退款询问、退款通知与官方查单确认后的权益回收。
- Online evidence: 生产 2 条评论和 1 份资料已补审，公开评论/完整资料缺审计数均为 0；资讯同步失败数 747→0，观测与应用指纹一致，连续运行结果为 updated/unchanged；三个云函数重新部署，五个函数最终均完成部署。`pro_30d` 方案远程返回 available=true，IAP 由产品负责人确认开启；订单表新增三个交易号稀疏索引。
- Verification: 265/265 个 Node 测试、33 JSON/223 JavaScript/9 活跃页面项目检查和 `git diff --check` 通过。消息入口在 Token/AESKey 缺失时返回 HTTP 503，证明未配置通知不会绕过验签。
- Sensitive handling: 未把 AppSecret、AppKey、消息 Token、EncodingAESKey、维护令牌、OpenID、昵称、头像、评论内容或附件写入普通 Wiki、代码输出或用户回复。
- Follow-ups: 在微信后台与 CloudBase 成对配置消息 Token/AESKey并完成 Android/iOS 真实支付、取消、恢复、发货、退款询问、退款与权益重锁；随后完成名称/备案、服务类目、隐私、体验版和微信审核发布。

## [2026-07-20] practical-column-editorial-system | 实用会员专栏与自动周案例

- Session: local Codex task
- Target pages: `hyyc/pages/curated/`, `hyyc/pages/column-reader/`, `hyyc/pages/trend-detail/`, `hyyc/features/ai-column/`, `hyyc/cloudfunctions/knowledgeFeed/content/`, `hyyc/cloudfunctions/knowledgeFeed/services/column-content-service.js`, `hyyc/cloudfunctions/knowledgeFeed/services/column-editorial-service.js`, `hyyc/cloudfunctions/knowledgeFeed/repositories/column-editorial.js`, `hyyc/cloudfunctions/knowledgeFeed/adapters/`, `cloudbaserc.json`, `wiki/`
- Summary: 把旧海报型专栏替换为 4 条路径、24 节实用课程、每周案例和 6 个趋势档案；免费只显示标题，全文按篇服务端鉴权。周案例加入显式不发布、上一完整自然周三次补偿、来源主域约束、生成租约、异常重抛与案例/趋势事务发布；前端加入身份/期限作用域缓存和权益无法确认时的全文清除。简报同步修正主题、日期、来源跳转与空状态。
- Verification: 288/288 Node 测试、35 JSON/231 JavaScript/11 页面项目检查和 `git diff --check` 通过；微信开发者工具 CLI `preview` 使用正确 AppID 成功，包体 298,071 bytes（291.1 KB）；模块化复审为 9.2/10。
- Online evidence: 本轮未部署新版 `knowledgeFeed`、未创建三张专栏生产集合、未调用真实模型或产生模型费用。生产最近验证仍为旧版八个 `knowledgeFeed` 触发器。
- Sensitive handling: 未读取、输出或写入模型密钥、支付密钥、OpenID、昵称、头像、评论或附件。
- Follow-ups: 部署新版函数和九入口配置，创建并锁定 `knowledge_column_cases`、`knowledge_trend_dossiers`、`knowledge_trend_events`，验证首次周案例与普通/Pro 真机路径；之后完成真实虚拟支付/退款、备案、体验版和微信审核发布。

## [2026-07-21] column-reader-restoration | 专栏阅读恢复与受保护手绘图回接

- Session: local Codex task
- Target pages: `hyyc/cloudfunctions/knowledgeFeed/content/ai-column-media.js`、`hyyc/cloudfunctions/knowledgeFeed/services/column-content-service.js`、`hyyc/features/ai-column/model.js`、`hyyc/pages/curated/index.js`、`hyyc/pages/column-reader/`、专栏测试与 `wiki/`
- Summary: 修复客户端新 action 与生产旧函数不匹配导致的全专栏详情空白；目录合同提升到版本 2，已解锁用户遇到旧合同会明确阻断而不再用本地标题掩盖。保留 24 节正文，把 Context、RAG、工具调用、Agent、Skill、MCP 六组共 18 张手绘图作为受保护补充内容，服务端鉴权后签发短期 URL，阅读器按当前/相邻页挂载并支持高清预览。
- Asset evidence: `D:\miniprogram\png` 的 18 张 1086×1448 源 PNG 全部存在，总计 52,106,685 bytes；客户端包内旧 JPEG 删除属于此前重构，云端 `ai-column/posters-hd/v1/` 发布副本继续复用。
- Online evidence: `knowledgeFeed` 部署成功；真实微信模拟器返回 `contractVersion=2`，代表课程“上下文：它为什么会忘”有 5 个正文段落、3 张签名图，且能滑到第 2 页。没有把该代表性回归夸大为 24 节逐项真机验收。
- Verification: 290/290 Node 测试、专栏专项 24/24、35 JSON/231 JavaScript/11 页面项目检查和 `git diff --check` 通过。
- Sensitive handling: 云函数详情诊断曾把环境变量显示在本地工具内部日志；实际值未写入代码、普通 Wiki 或用户回复。建议轮换受影响的 API key/维护令牌，并停止使用会回显环境值的详情命令。
- Follow-ups: 用安全清单复核第九个定时入口和三张专栏集合 `ADMINONLY` 权限；完成 24 节免费/Pro 双身份体验版、首次真实周案例及支付/退款联调。

## [2026-07-21] visual-ready-feed-and-practical-column | 资讯视觉可靠发布与基础课/动手课改版

- Session: local Codex task
- Target pages: `hyyc/cloudrun/source-preview-renderer/src/`、`hyyc/cloudfunctions/knowledgeFeed/`、`hyyc/features/knowledge-feed/`、`hyyc/features/ai-column/`、`hyyc/pages/inbox/`、`hyyc/pages/curated/`、`hyyc/pages/column-reader/`、`hyyc/pages/briefing/`、`cloudbaserc.json`、`D:\files\miniprogram\AI专栏24课手绘图生成提示词.md` 与 `wiki/`
- Summary: 生产根因定位为聚焦截图空/越界裁剪和历史积压，而非公网代理普遍不稳定；渲染器加入裁剪校验与整页回退，视觉任务改为实时/恢复双车道、两分钟调度，资讯列表只发布视觉就绪条目。会员精选按真实权益去锁，顶部标题改为“AI 资讯”。专栏合同提升到版本 3，移除左侧贯穿线、周案例/趋势入口和周案例触发器，保留 24 节口语化基础课并新增 6 节动手课与免费技术支持说明；简报同步改为准确口语表达。
- Visual evidence: 修复前最近 1,000 条渲染日志的 128 次失败中，119 次为裁剪越界/空区域，网络 `ERR_*` 为 0；X、原失败 IT之家页和通用长页 canary 均返回 200。3 个灰度任务成功后，其余当前边界的 116 个旧 422 任务已重新排入恢复车道，旧 422 遗留计数归零；生产 feed 抽样 20 条均有列表视觉。
- Column evidence: `columnHome` 生产返回合同版本 3、24 节基础课和 6 节动手课；微信开发者工具自动化确认会员精选锁为 0、基础/动手双页签、动手课 6 行、支持说明、代表课程 3 张受保护手绘图和口语化简报均正常。30 天简报因来源不足未强行生成。
- Asset evidence: `D:\miniprogram\png` 的 18 张旧手绘源图继续保留；新增 72 段提示词覆盖 24 节课、每节 3 张，本轮按用户要求未生成图片。
- Verification: 306/306 Node 测试、35 JSON/234 JavaScript/11 页面项目检查、26/26 渲染器测试、106/106 核心定向测试和 `git diff --check` 通过。微信开发者工具验证不等同于物理真机验收。
- Sensitive handling: 部署、重排队列和简报刷新通过受限配置完成，维护令牌、模型密钥、OpenID、支付凭据和用户资料均未写入普通 Wiki 或用户输出。
- Follow-ups: 用户按提示词生成 72 张图片后接入受保护媒体映射；首发前完成普通/Pro 双身份物理真机、支付/退款、备案与微信审核发布验收，并持续观察恢复车道中的临时上游 5xx。

## [2026-07-21] timeout-feed-and-manual-production-validation | 模型超时、无图公开与动手课收口

- Session: local Codex task
- Target pages: `hyyc/cloudfunctions/knowledgeFeed/`、`hyyc/features/ai-column/`、`hyyc/features/briefing/`、`hyyc/pages/column-reader/`、`hyyc/pages/briefing/`、测试与 `wiki/`
- Summary: 用生产 LLM trace 证明超时来自应用阈值而非 CloudBase 模型失败或资源不足；将 CloudBase 分任务阈值调整为分析 90 秒、简报 180 秒、同步审核 30 秒，AI 内部月上限提高到 60,000 点。撤销所有图片发布门禁，动手课改为直接操作手册，简报删除个人影响判断。
- Resource evidence: 当前共享池 330,000 点、已用约 2,647.45、剩余约 327,352.55；应用内部 `knowledge_ai_budget` 为 1,053 点且未熔断。84 次模型 trace 全部最终 200，Flash/Plus 最大耗时分别为 73.6/150.3 秒。
- Online evidence: `knowledgeFeed` 部署成功；部署后定时批次的 `qwen3.5-flash` 在 58.898 秒返回 HTTP 200，新的 90 秒分析阈值生效且未出现主模型不可用告警。数据库 3,099 条 active 中 930 条当前无视觉；微信开发者工具首屏一次返回 8 条中的 6 条无图资讯，无图详情正常打开；专栏合同版本 4、会员无锁、六节动手课标题不含操作系统名、安装详情分平台、动手课无概览图，简报无 `trends` 字段。
- Verification: 307/307 Node 测试、35 JSON/234 JavaScript/11 页面项目检查与 `git diff --check` 通过；实际页面截图复核浅色命令卡和简报结构。
- Sensitive handling: 只聚合模型、状态、耗时、资源分类和非敏感计数；未读取或记录模型输入输出、环境变量值、令牌、OpenID、评论、头像或支付凭据。
- Follow-ups: 观察 7 天平台 AI 归集与 60,000 点曲线；若 SDK 提供可靠取消能力，再补上游请求中止，避免超时后主备双调用。首发前完成普通/Pro 双身份物理真机、真实支付/退款、备案与微信审核发布验收。

## [2026-07-21] pro-benefit-source-and-offer-presentation | Pro 权益单一来源与价格折扣模型

- Session: local Codex task
- Target pages: `hyyc/features/membership/benefits.js`、`hyyc/features/membership/presentation.js`、`hyyc/features/membership/prompt.js`、`hyyc/features/billing/session.js`、会员测试
- Summary: 以服务端实际权益为边界，统一整理精选、24 节基础课全文与已配套手绘、6 节动手课、三档简报与来源回看、30 天资讯/收藏回看、会员评论和已明确承诺的免费微信技术支持；喜欢、收藏动作与分享继续作为免费能力。我的页和全局会员提示共同读取同一权益模型，价格、划线价、节省金额和折扣只根据 `membershipBilling` 返回的分值计算，不写死金额，也不制造倒计时或限量。修复空到期时间被显示为 `1970.01.01` 的日期格式化问题。
- Verification: 权益/支付/会员专项 39/39、全量 Node 测试 314/314 通过；新增价格模型覆盖 590/1090 分、任意价格变化、无折扣与无有效价格路径；项目结构检查通过（35 JSON、235 JavaScript、11 pages），`git diff --check` 通过（仅既有行尾提示）。
- Follow-ups: 会员广告卡视觉与普通/Pro 身份回归已在同日后续任务完成；剩余体验版上传、物理真机与真实支付/退款验收。

## [2026-07-21] bounded-visual-publication-and-pro-access-pass | 四分钟等图与完整 Pro 通行证上线

- Session: local Codex task
- Target pages: `hyyc/cloudfunctions/knowledgeFeed/`、`hyyc/features/briefing/model.js`、`hyyc/features/membership/`、`hyyc/features/billing/session.js`、`hyyc/components/membership-prompt/`、`hyyc/pages/profile/`、`hyyc/pages/featured/`、测试与 `wiki/`
- Summary: 把文字立即公开改为四分钟有界等图；成功图文同发、首次明确失败或到期放行文字。简报标题按筛选后的真实核心条数派生。统一七项 Pro 权益、服务端价格与折扣模型，重做“我的”页和全局受限入口通行证，并补齐精选深链拦截。
- Online evidence: 生产只读验证普通/精选/频道主题/count 查询均无新增索引错误；`knowledgeFeed` 部署完成，事件调用 `InvokeResult=0` 且约 988ms 返回真实资讯、图片、筛选矩阵和权限。
- Visual evidence: 微信开发者工具验证普通用户点击精选实际打开通行证，弹层可滚动查看七项权益且底部 CTA 固定；普通/Pro“我的”页和“先看这5件事”均已截图。测试后恢复原 Pro 预览状态。
- Verification: 图片发布专项 41/41、会员支付专项 39/39、全量 314/314；项目检查为 35 JSON、235 JavaScript、11 pages；`git diff --check` 通过。
- Sensitive handling: 普通 Wiki 未记录 API key、维护令牌、支付凭据、OpenID 或用户资料。后续避免用会回显环境变量的函数详情输出作为普通验收材料。
- Follow-ups: 客户端尚未上传体验版或提交微信审核；首发前完成物理真机、真实支付/退款、备案、类目隐私和微信审核发布。

## [2026-07-21] minimal-pro-subscription-card | Pro 转化界面收敛为简约订阅卡

- Session: local Codex task
- Target pages: `hyyc/components/membership-prompt/`、`hyyc/pages/profile/`、`hyyc/tests/membership-ui.test.js` 与 `wiki/`
- Summary: 根据手机端反馈删除会员弹层和“我的”页的左侧蓝轨、装饰圆环、`P` 徽章、三格指标、权益小卡及胶囊标签；改为冷白卡面、单层价格信息和发丝线权益清单，只保留一个蓝色主动作。两处 CTA 文案固定为“订阅”，价格继续单独展示，并使用 `white-space: nowrap` 防止手机端换行；七项真实权益与服务端动态折扣模型保持不变。
- Render evidence: 微信开发者工具渲染树确认两处按钮文本均为“订阅”、计算样式均为 `nowrap`、高度为 40/41px；两处卡面均为白色、侧轨节点不存在、权益行均为 7 条。测试后管理员预览身份恢复为 `member`。
- Verification: 会员 UI 定向测试 15/15、全量 Node 测试 314/314、项目检查 35 JSON/235 JavaScript/11 pages 和 `git diff --check` 通过（仅既有行尾提示）。
- Follow-ups: 客户端尚未上传体验版或提交微信审核；首发前继续完成物理真机、真实支付/退款与微信审核发布验收。

## [2026-07-21] membership-prompt-scroll-isolation | 会员弹层移除“当前”并阻止底页滚动穿透

- Session: local Codex task
- Target pages: `hyyc/components/membership-prompt/`、八个会员弹层宿主页、`hyyc/tests/membership-ui.test.js` 与 `wiki/`
- Summary: 删除权益标题旁的“当前”标签，保留入口相关权益置顶与轻量强调；会员弹层遮罩拦截外层触摸移动，全部宿主页在弹层显示期间用 `page-meta` 锁住底页，卡片内部 `scroll-view` 保持为唯一滚动区域。详情页同时兼容评论抽屉和会员弹层的页面锁。
- Render evidence: 微信开发者工具确认“当前”节点不存在；弹层内部内容高度 595px、可视高度 426px，内部滚动位置可从 0 移到约 169px；弹层打开及卡头滑动期间底页始终保持在 520px，关闭后可继续滚到 640px。测试后预览身份恢复为 `member`。
- Verification: 会员 UI 定向测试 16/16、全量 Node 测试 315/315、项目结构检查 35 JSON/235 JavaScript/11 pages 与 `git diff --check` 均通过；静态回归会自动扫描所有挂载会员弹层的页面，要求存在底页滚动锁、遮罩触摸拦截和内部 `scroll-y`。
- Follow-ups: 客户端尚未上传体验版或提交微信审核；首发前用 iOS/Android 物理真机复核触摸惯性、边界回弹及真实支付/退款流程。

## [2026-07-21] source-preview-v3-quality-and-repair | 截图错误壳拦截、AI 复核与历史坏图隔离

- Session: local Codex task
- Target pages: `hyyc/cloudrun/source-preview-renderer/`、`hyyc/cloudfunctions/knowledgeFeed/`、`hyyc/cloudfunctions/knowledgeOps/`、截图/修复测试与 `wiki/`
- Summary: 修复 HTTP 200 错误壳被误判为成功截图的问题；renderer v3 要求 X status 精确命中并在截图前后复核，普通网页和可疑稀疏图进入 CloudBase 视觉审核，所有不确定结果 fail-closed。新增维护端精确 CAS 修复，把仍 active 的坏图引用撤下、保留文字并排入 v3 重抓。
- Production evidence: 云存储确认 51 份字节相同的 X 错误页及多类空白/加载失败占位图；64 条候选中 47 条 active 已隔离，17 条非 active 自动跳过。公网 renderer release `20260721-150436` 健康；目标 X canary 返回 v3、精确命中和 65,949 字节截图；生产已有修复任务以 `previewQualityAudit.policyVersion=1` 成功发布新图。
- Verification: 363/363 Node 测试、35 JSON/241 JavaScript/11 pages 项目检查及相关 `git diff --check` 通过。
- Sensitive handling: 普通 Wiki 和输出未记录维护令牌、renderer Bearer token、SSH 凭据、模型密钥或用户身份数据。
- Follow-ups: 继续由两分钟 worker 消化其余重抓任务；始终无法取得有效画面的条目保持文字可读且不发布无意义图片。

## [2026-07-21] ai-column-oil-visual-audit | 72 张专栏图 Packy 审核与单图替换

- Session: local Codex task
- Target pages: `D:\files\miniprogram\AI专栏24课手绘图生成提示词.md`、`D:\files\miniprogram\AI专栏24课手绘图_oil-visual_20260721\`、`wiki/syntheses/2026-07-21-ai-column-oil-visual-audit.md`
- Summary: 复用 PackyAPI `grok-4.5` 多模态 Responses 接口，以三张一批和严格 JSON Schema 审核 72 张 Oil Visual 专栏图的人物/动物肢体、内容完整性、文字和可用性。确认并替换 `03-hallucination-02.png` 的额外手臂问题；`12-acceptance-01.png` 经原图和单图复审确认首轮为模型误判。最终 72/72 通过。
- Verification: 72 个 PNG 与提示词一一对应，全部可读取、均为 1086×1448、无重复哈希；替换图 Packy 复审为 `pass`、内容 9/10、置信度 0.93。
- Sensitive handling: Packy 密钥只在运行时从本机受限文件读取，未写入脚本、普通 Wiki、日志或用户输出。
- Follow-ups: 接入受保护媒体映射前仍应在微信开发者工具与普通/Pro 真机中检查缩略图裁切、高清预览和三页顺序。

## [2026-07-21] aihot-source-metadata-and-fair-visual-queue | AIHOT 原始来源资料与公平截图队列

- Session: local Codex task
- Target pages: `hyyc/cloudfunctions/knowledgeFeed/adapters/aihot-feed-enrichment.js`、`hyyc/cloudfunctions/knowledgeFeed/lib/source-metadata.js`、`hyyc/cloudfunctions/knowledgeFeed/repositories/source-profile.js`、`hyyc/cloudfunctions/knowledgeFeed/services/source-metadata-enrichment-service.js`、`hyyc/cloudfunctions/knowledgeFeed/repositories/feed-visual-job.js`、`hyyc/cloudfunctions/knowledgeFeed/services/feed-visual-worker-service.js`、`hyyc/features/knowledge-feed/source-presentation.js`、资讯列表/详情、测试与 `wiki/`
- Summary: 把 AIHOT `/items` 保持为正文事实源，以 `/feed` fail-open 补充作者身份、头像与原始标签；头像即时持久化到 CloudBase，内部 `sourceMetadataHash` 与内容/分析哈希隔离，页面没有原始标签时隐藏而不再回退本地分类。视觉队列把 live/repair 拆成独立查询并在 fresh/recovery 四阶段持久轮转，每分钟最多启动一个捕获；过时 v2 在清理后按条目状态升级 v3 或删除。
- Production evidence: 用户指出的两条最新 Rohan Paul 资讯已生成正确 v3 目标截图和缩略图，对应成功任务文档已删除；分钟任务连续完成旧 v2 升级和实时 v3 发布且组合查询无索引错误。来源增强已覆盖 114 条资讯和 25 个账号头像；三条 Rohan Paul 样本的昵称、账号与原始标签均和 AIHOT 页面一致。
- Lifecycle: 成功、已就绪和 stale 任务自动删除；临时失败与清理失败保留重试，`blocked` 保留诊断，仍缺图的有效 v2 先升级 v3、待成功后删除。队列因此会自动收口，但不会为了“看起来为空”提前丢掉可恢复或需要诊断的任务。
- Verification: `knowledgeFeed` 部署成功；384/384 个 Node 测试、35 JSON/248 JavaScript/11 页面项目检查与相关语法检查通过。公开 item 返回作者/头像/标签且不泄漏内部元数据哈希。
- Sensitive handling: 生产诊断不在普通 Wiki或用户输出记录环境变量、维护令牌、模型密钥、OpenID 或支付凭据；此前可能回显环境值的函数详情命令不再用于普通验收。
- Follow-ups: 客户端代码仍需按正常微信体验版/审核流程发布，并在 iOS/Android 物理真机复核作者行、长标签换行、图片渐进补入和历史队列持续下降。

## [2026-07-21] cloud-media-runtime-and-safe-visual-throughput | 修复 cloud:// 图片 500 并安全提高最新截图吞吐

- Session: local Codex task
- Target pages: 资讯列表/详情/精选/收藏、个人资料与评论媒体、`features/*/media`、视觉 worker、CloudBase 触发器、Nginx 和 `wiki/`
- Summary: 定位头像 500 为 WXML 直接绑定 `cloud://` 后被微信渲染层拼成页面相对路径；所有 CloudBase 媒体改由 feature session 批量换取 HTTPS 临时地址，合并并发和有界缓存，实际加载失败只强制刷新一次后 fail-open。资讯 UI 同步采用作者/时间在上、媒体后放上游标签，以及仅在“最新”模式出现的 62rpx 左侧时间线。
- Production evidence: Nginx 读取超时提高到 54 秒；8 个 `knowledgeFeed` 触发器全部 Available/on，视觉 cron 为 `:10/:25/:40/:55`。最近 6 分钟 9 次真正 capture 成功 8、质量重试 1、429/504 为 0；最新 12 条 ready 11、retry 1。renderer 重启 0，但历史内存峰值约 1.05 GiB/上限 1.27 GiB，因此保持单 Chromium 并发。
- Verification: 403/403 Node 测试、35 JSON/252 JavaScript/11 pages 检查通过；开发者工具已在回环端口打开项目，最近日志未出现本地图片 500、编译或语法错误。客户端未上传体验版或提交微信审核。
- Follow-ups: 全量 v3 live 队列仍有 89 条且持续新增，当前优先保证最新资讯；若要求历史积压持续净下降，应先扩容或拆独立实例，再增加真正并发。首发前仍需 iOS/Android 物理真机复核临时地址刷新和时间线长文本布局。

## [2026-07-21] source-avatar-storage-acl-and-renderer-architecture-audit | 来源头像权限与截图执行层复核

- Session: local Codex task
- Scope: Cloud Storage 生产规则、来源头像对象抽样、现有截图容量与 CloudBase/公网代理边界
- Summary: 确认头像文件和账号映射抽样正确，但生产公开读规则遗漏 `knowledge-source-avatars/`；客户端临时地址修复尚未上传，因此头像显示存在权限和版本两层阻断。截图积压主要来自 2C2G 公网机单 Chromium 吞吐，CloudBase 云函数本身可访问公网；建议把独立 SCF 镜像函数作为可控并发截图执行层，并把现有公网机收缩为受限 X 出口代理，队列仍保留作退避、重试和背压。
- Production changes: 无；本轮只读复核，未修改存储规则、云函数、服务器或线上数据。

## [2026-07-21] source-avatar-storage-access-fix | 修复来源头像客户端读取权限

- Session: local Codex task
- Target: `docs/cloud-storage-rules.json`、生产 Cloud Storage 自定义规则、头像媒体客户端合同与回归测试
- Summary: 只新增 `knowledge-source-avatars/` 公开读前缀，保留课程受保护媒体和现有 owner-only 写规则；增加权限回归测试，防止后续规则调整再次遗漏来源头像。CloudBase 环境内新增云函数继续消耗同一资源点池；脱离 CloudBase 单独创建的 SCF 才走独立 SCF 账单。
- Production evidence: 线上规则复读已包含头像前缀；最新 8 条生产资讯有 3 条携带来源头像 Cloud File ID，抽样头像临时 HTTPS 地址返回 HTTP 200、`image/webp`。开发者工具已重新打开项目。
- Verification: 404/404 Node 测试、35 JSON/253 JavaScript/11 pages 项目检查通过；头像权限与媒体专项 11/11 通过。
- Follow-ups: 客户端临时 HTTPS 地址解析修复仍需随当前完整版本上传体验版并做 iOS/Android 真机验收；本轮未上传，以免把工作区内其他尚在验收的改动一并发布。

## [2026-07-22] cloudbase-scf-source-preview-and-mobile-timeline | SCF 截图迁移、公网代理收缩与时间线修复

- Session: local Codex task
- Target pages: `cloudbaserc.json`、`hyyc/cloudrun/source-preview-renderer/`、`hyyc/cloudfunctions/knowledgeFeed/`、资讯时间线页面/模型、运维脚本与 `wiki/`
- Summary: 把 Chromium 截图、质量证明和 Cloud Storage 上传迁入 CloudBase `sourcePreviewWorker`；普通网页先直连，X 与地区性网络失败通过受限 WSS/Mihomo 中继。生产关闭 HTTP renderer fallback，冻结实例遇到失效浏览器句柄时只重启一次。公网服务器删除旧 renderer、第二代理和三个旧监听端口，只保留网络中继；旧截图路由固定 410。移动端“最新”时间线增加日期折叠并分离时间、节点和正文空间。
- Production evidence: 公网中继 X 实测 200/4359 bytes，健康 200、旧入口 410；下线后的 CloudBase X canary 19.5 秒完成，`targetMatched=true` 并上传 1 张 JPEG，下载肉眼核验内容正确。迁移前生产函数日志已连续确认真实 X、x.ai、TechCrunch、Google 页面成功且未使用 HTTP fallback。
- Verification: 409/409 Node 测试、35 JSON/261 JavaScript/11 pages 项目检查通过；微信开发者工具 preview 成功，包体 1,775,837 bytes。客户端未上传体验版或提交审核。
- Architecture: 依照 modular-code-architect 将浏览器运行时、出口策略、WSS bridge/relay 和 CloudBase 调用 adapter 分离；frontend-design 用于移动时间线层级、日期折叠和间距收敛。
- Sensitive handling: 普通 Wiki 和输出没有记录 CloudBase 凭据、renderer token、服务器密码、OpenID、支付凭据或环境变量实际值。
- Follow-ups: 视觉任务队列继续保留用于退避、重试、清理与背压；首发前仍需上传体验版，并在 iOS/Android 物理真机复核折叠触摸区、长时间文本和临时头像 URL 刷新。

## [2026-07-22] parallel-visual-worker-and-column-media-v2 | 四实例截图并发与 24 课手绘图上线

- Session: local Codex task
- Target pages: `hyyc/cloudfunctions/knowledgeFeed/` 视觉调度与专栏媒体服务、`hyyc/tests/`、Cloud Storage `ai-column/posters-hd/v2/`、`wiki/`
- Summary: 生产日志确认 X 精确截图约 13 秒且 2GB 单实例内存充足；移除调度器单任务硬限制，保持单实例单 Chromium 并通过 CloudBase 最多 4 个隔离实例并发。fresh live 待处理超过 2 条时优先排空，普通网页仍保留完整 AI 审核预算。用户生成的 72 张图完成完整性复核、高质量 JPEG 优化和云端上传，24 节基础课全部接入三页受保护图文。
- Production evidence: 同一秒观测到 4 个 `sourcePreviewWorker` 实例；一轮 162.8 秒尝试 13 条、成功发布 8 条，失败条目进入重试。08:36 数据库复核 `pending=0`、fresh live `=0`、`leased=2`，最新待处理低于目标；114 条历史 retry 继续按退避收口。72/72 发布图上传成功，云端目录首尾为 `01-model-basics-01.jpg` 与 `24-security-03.jpg`。
- Verification: 72 个源 PNG 全部 1086×1448、无重复哈希；发布副本约 35MB。全量 Node 测试 413/413、项目检查 35 JSON/261 JavaScript/11 pages 通过。
- Architecture: `modular-code-architect` 用于保持调度选择、执行并发、截图 worker、课程目录和媒体签名边界分离；`oil-visual` 用于按发布资产流程校验源图、保留原件、生成优化副本并复核手机阅读清晰度。
- Sensitive handling: 普通 Wiki 和输出没有记录 CloudBase 凭据、代理令牌、服务器密码、OpenID、支付凭据或环境变量实际值。
- Follow-ups: “2 条”是 fresh live 排空目标，不是突发新增或外站失败下的绝对队列上限；继续观察成功率、代理压力和历史 retry 收口，首发前完成普通/Pro 物理真机 24 课抽样与三页顺序验收。

## [2026-07-22] native-media-budgeted-visuals-and-lazy-days | 来源媒体优先、截图预算上限与日期懒加载

- Session: local Codex task
- Target: AIHOT 来源媒体增强、CloudBase 视觉 worker、资讯日期折叠、会员历史权限、课程画廊与 `wiki/`
- Summary: 优先校验并持久化 AIHOT `xMediaProxied` 原图，没有合格图片时才进入截图；保持 4 个隔离 2GB 实例并发，同时按任务保守预留 24 点、每日最多 1200 点。普通用户历史改为滚动 24 小时；7/30 天先返回完整日期桶，展开后通过 `feedDay` 分页加载。24 课画廊只加载当前图片，基础课旧蓝色概览图停用。
- Production evidence: 30 天接口返回 30 个日期桶；2026-07-20 的单日接口返回 224 条、首批 20 条与分页游标，函数执行约 366ms。来源同步本轮指纹未变化，返回 `not-modified`，因此没有重复下载或截图。
- Verification: 全量 Node 测试 417/417 通过；项目检查覆盖 35 JSON、261 JavaScript 与 11 pages。课程 72 张优化图总计 36,782,296 bytes，但单课程接口只签发 3 张，客户端首轮只加载当前页。
- Architecture: `modular-code-architect` 保持来源解析/下载、视觉调度/预算、按日查询、前端日期状态与课程媒体窗口各自独立；`frontend-design` 将日期空状态、加载态和折叠层级收敛为手机端窄时间线。
- Caveat: 每日 1200 点只约束截图链路，CloudBase 共享池中的数据库、存储、出网、其他函数和模型仍需用控制台总量告警监管。

## [2026-07-22] unbounded-visuals-and-aihot-source-scopes | 取消截图日限额与 AIHOT 来源导航

- Session: local Codex task
- Target: `knowledgeFeed` 来源增强、视觉队列、来源范围查询、资讯顶部布局、生产索引/数据和 `wiki/`
- Summary: 撤销每日 1200 点/50 次截图硬上限，保留 4 个隔离 2GB 实例、质量审核、超时、租约和退避；同批首次任务按发布时间从新到旧。AIHOT 原帖照片不再限制张数。顶部改为“全部 / 一手信源 / 资讯 / 推文”，精选保持独立会员入口，筛选与排序同排且顶部不显示总数。
- Production evidence: 旧上限用满后生产曾有 25 条首次任务和 97 条重试；发布后首次任务降至 0，最新 5 条全部 `ready`，抽检截图准确包含对应作者、正文和原帖媒体。强制刷新更新 2,092 条当前资讯，并清除同步状态中的遗留预算字段。来源范围生产记录已有 `firstParty=154`、`news=762`、`x=1176`。
- Verification: 420/420 Node 测试通过，覆盖最新优先、维护刷新与 AIHOT 原图视觉字段回接；项目检查覆盖 35 JSON、264 JavaScript、11 pages。`knowledgeFeed` 部署成功，生产 4 个来源复合索引可用；最新 16 条生产资讯全部 `ready`，即时等待/租约队列为 0。
- Failure boundary: 剩余历史 retry 主要是网页抓取失败或 AI 视觉复核拒绝；文字继续可读，无效图片不发布。资源总量改由 CloudBase 控制台告警监控，不再为了应用内预估而停止新资讯补图。

## [2026-07-22] signed-media-and-x-egress-recovery | 修复临时图片 403 并增强 X 401/登录墙恢复

- Session: local Codex task
- Target: 客户端 CloudBase 媒体缓存、`sourcePreviewWorker` 出口策略、云端 canary 与 `wiki/`
- Summary: 复现旧列表缩略图签名 HTTP 403、同 File ID 新签名 HTTP 200；客户端正缓存改为服从 SDK `maxAge`、预留到期余量并在未知寿命时最多缓存 5 分钟。X 截图改为 CloudBase 原页直连 → 官方嵌入页直连 → 公网代理原页 → 公网代理嵌入页，401、403 和登录墙均可进入恢复链路，四层仍要求精确 status id。
- Production evidence: `sourcePreviewWorker` 部署成功且原有四个环境变量名称完整；真实 X 原页和官方嵌入页 canary 均 `targetMatched=true`、上传 1 张 JPEG，当前环境实际走 `foreign-proxy`。4 个本轮 canary 文件已按精确路径删除。
- Verification: 422/422 Node 测试通过；项目检查覆盖 35 JSON、264 JavaScript、11 pages；新签名缩略图 HTTP 200；微信开发者工具在现有 17952 回环端口登录并重新打开项目。
- Architecture: `modular-code-architect` 将临时地址寿命归一化留在媒体服务、缓存淘汰留在 feature session、图片失败恢复留在 page recovery；X URL 变换/可恢复错误分类留在 egress policy，浏览器编排只消费策略。`playwright` 用无登录 Edge 验证 X 原页和官方嵌入页都包含目标作者、正文和媒体。
- Sensitive handling: 未记录签名 URL、CloudBase 凭据、代理令牌、服务器密码、OpenID 或环境变量值；只记录非敏感变量名称和 canary 结果。

## [2026-07-22] public-proxy-capacity-and-traffic-audit | 公网中继真实容量与流量复核

- Session: local Codex task
- Scope: 公网服务器资源、WSS/Mihomo/Nginx 状态、一次真实 X 视频推文截图的网卡与 CONNECT 目标
- Summary: 现网业务常驻内存低于 600 MiB，代理三服务 active 且 24 小时无 warning；真实截图尝试约产生 2.73 MB RX/2.89 MB TX，并连接两次 `video.twimg.com`，说明截图浏览器会加载初始视频资源但没有观察到完整视频级流量。代理专用新节点 1C1G、200 Mbps、512 GB/月足够，10 GB 仅适合全新最小化部署。
- Risk: 发现一个从 2026-01-20 遗留至今、持续占满一核的非 systemd Codex CLI 进程；本轮只读诊断未终止，迁移或降配前需确认清理。
- Sensitive handling: Wiki 和输出未记录公网 IP、SSH 端口、密码、代理订阅、节点地址或维护令牌。

## [2026-07-22] new-relay-route-canary | 新公网直连中继部署、线路诊断与生产回滚

- Session: local Codex task
- Target: 新公网中继、正式代理子域名、`hyyc/cloudrun/source-preview-renderer/`、CloudBase `sourcePreviewWorker` 与 `wiki/`
- Summary: 新节点完成最小化直连 WSS 中继部署，新增可选 DNS 解析后地址固定与认证探针能力；本地直连和 WSS 均成功。CloudBase 灰度在 opening handshake 超时，双端抓包证明腾讯 SYN 到达而服务端 SYN-ACK 未能回到腾讯，定位为服务商回程路由/上游互联问题。生产未切换新节点并恢复旧中继。
- Production evidence: 旧中继认证探针成功；真实 X canary 53.4 秒完成、精确命中并上传 1 张 JPEG，验收后删除。实时视觉队列 `pending=0`、`leased=0`，剩余 95 条均为历史 retry。
- Verification: 原文截图专项 34/34、全量 Node 425/425、35 JSON/266 JavaScript/11 页面检查通过。
- Architecture: `modular-code-architect` 将出站连接、DNS/IP 固定、WSS bridge、认证探针和截图编排分离；`playwright` 用于 DNSPod 正式域名配置与保存结果验证。
- Sensitive handling: 普通 Wiki 和输出未记录私钥、CloudBase 凭据、中继令牌或环境变量实际值；新节点连接元数据只写入 Git 忽略的 `wiki/secrets/`。
- Follow-ups: 向新服务商提交腾讯云方向回程失败证据；服务商修复后必须先通过 CloudBase 探针和真实 X canary，才允许切换并下线旧中继。

## [2026-07-22] cloud-media-proactive-renewal | 修复长驻页面临时图片签名过期 403

- Session: local Codex task
- Target: `hyyc/services/cloud-media.js`、`features/knowledge-feed/cloud-media-session.js`、`cloud-media-recovery.js`、资讯/详情/精选/收藏页面与媒体测试
- Summary: 用户提供的缩略图签名在报错时已过期约 29 分钟；数据库仍只保存 File ID，同一文件新签名 HTTP 200。根因是签名写入页面 `data` 后不会随内存缓存到期自动更新，懒加载图片晚进入视口时会先请求旧 URL。现解析 TCB 绝对到期时间、拒绝过期 URL 回填，并让四个长驻页面只在可见期间于到期前批量续签。
- Verification: 旧签名 HTTP 403、新签名 HTTP 200/`image/jpeg`；428/428 Node 测试、35 JSON/266 JavaScript/11 页面检查和差异检查通过。开发者工具已自动重启 appservice 编译，修复后日志没有图片 403、语法或引用错误。
- Architecture: `modular-code-architect` 保持提供商到期解析、File ID/URL 租约、页面生命周期续签和错误兜底各自独立；页面只声明当前可见媒体及应用回调。
- Sensitive handling: 未记录实际签名值或完整临时 URL；普通 Wiki 只记录到期时间、对象类型和匿名验证结果。
- Deployment boundary: 本轮只改客户端，不需要重新部署云函数；正式用户需随下一次小程序客户端上传获得修复。

## [2026-07-22] replacement-relay-ip-cutover | 替换公网地址通过 CloudBase 回程并切换生产

- Session: local Codex task
- Target: 替换公网地址、`source-preview-relay.service`、Nginx TLS、CloudBase `sourcePreviewWorker` 与 `wiki/`
- Summary: 替换地址的 SSH/HTTP/HTTPS、X 直连、Nginx/WSS 均正常；新增独立灰度证书并将节点令牌对齐到 CloudBase 现有令牌。生产函数改为正式证书域名 + 固定替换地址，绕过尚未更新的公共 DNS，同时保留完整 TLS SNI 校验。
- Production evidence: CloudBase `probeRelay` 返回 `relayReady=true`、`addressPinned=true`；真实 X canary 79.716 秒完成，使用 `foreign-proxy`、目标精确匹配、5/5 媒体就绪、质量通过并上传 1 张 JPEG。对象验收后按精确路径删除并确认不存在。
- Incident note: CLI 因返回包含完整 Base64 审核图而报告调用失败，但函数日志 `retCode=0`；后续真实 canary 应读取函数日志/对象结果或使用轻量响应，不能只看 CLI 退出码。
- Sensitive handling: 普通 Wiki 未记录公网 IP、私钥、临时云凭据、令牌或环境变量值；连接元数据仅更新到 Git 忽略的 `wiki/secrets/`。
- Follow-up: 当前临时云凭据没有 DNSPod 查询/修改权限且网页登录态失效；需在 DNSPod 把正式代理子域名更新到替换地址，传播并经 CloudBase 复核后再考虑移除固定地址变量。

## [2026-07-22] production-dns-chrome-and-visual-recovery | 正式 DNS、浏览器自动化与最新资讯补图收口

- Session: local Codex task
- Target: DNSPod 正式 A 记录、Chrome/Playwright、本地与 CloudBase 自动化、`sourcePreviewWorker`、`knowledgeFeed`、公网 WSS/Nginx 与生产视觉队列
- Summary: 正式代理子域名已切换到替换地址并完成公共解析复核；从 Google 官方安装包安装 Chrome `150.0.7871.182`，Playwright 持久化 Chrome 会话验证成功。截图函数改为只跨函数返回 Cloud File ID，父函数只下载一张有界代表图复审；精确 X 改为中继官方嵌入页优先，区域受限新闻站点中继优先，并为注册墙站点增加受 AI 复审的第一方 Open Graph 主图路径。公网 Nginx `worker_connections` 提升至 4096、文件句柄上限提升至 8192。
- Production evidence: 正式 TLS 健康端点返回 HTTP 200；修复后真实 X canary 15.185 秒完成。此前缺图的最新 X/Google 条目、TechCrunch 长页、The Decoder 页面均已补图；MarkTechPost 主图由 CloudBase `qwen3.5-plus` 以 0.95 置信度判定 `CONTENT_MATCH` 后写入原图与列表缩略图。最新 40 条复核仅剩一个真实 404 源站条目无图，文本仍正常公开；错误页、登录墙和不相关图继续不发布。
- Queue: 复核时实时等待队列为 0；定时器曾并行租用 4 条，随后收敛到 1 条执行中，属于正在处理而非积压。历史 retry/blocked 保留用于退避与诊断，不会阻塞 fresh live。
- Verification: 434/434 Node 测试、35 JSON/267 JavaScript/11 pages 项目检查和差异检查通过；`knowledgeFeed` 与 `sourcePreviewWorker` 均已部署。
- Architecture: `modular-code-architect` 用于保持 DNS/TLS 地址固定、出口策略、浏览器捕获、第一方媒体提取、AI 复审和视觉发布边界独立；`playwright` 用于 DNSPod 保存结果和 Chrome 自动化验证。
- Sensitive handling: 腾讯云账号密码、CloudBase 凭据、中继令牌和 SSH 私钥未输出或写入普通 Wiki；实际连接元数据只保存在 Git 忽略的 `wiki/secrets/`。

## [2026-07-22] six-concurrency-and-personal-proxy-headroom | 六并发截图与个人代理余量验证

- Session: local Codex task
- Target: `knowledgeFeed` 视觉调度配置、并发与优先级测试、新公网 WSS/Nginx 容量、生产实时队列和 `wiki/`
- Summary: 截图并发从 4 调到 6，fresh live 等待目标从 2 调到 0；每分钟四次视觉探测不变，避免增加全天空转函数消耗。单实例仍保持一个 Chromium，质量闸门、全局租约、历史公平轮转和失败退避不变。
- Production evidence: 两轮真实六路 X 压测均 6/6 精确命中并通过质量闸门；较快一轮单路约 10.0–10.5 秒、整批约 13.1 秒。代理窗口最低约 490MB available、Swap 0、负载最高约 0.02，Nginx 扩容后无新连接上限错误。压测临时对象全部删除；实时队列 pending 0、leased 0、fresh live 0，65 条 retry 与 4 条 blocked 为历史退避/诊断。
- Verification: 434/434 Node 测试、35 JSON/267 JavaScript/11 页面检查和差异检查通过；`knowledgeFeed` 部署成功。
- Decision: 当前保留 6，不升到 8；单人 Clash/AI/新闻和偶尔视频使用保留足够代理余量。目标 0 是调度优先级，不是外站故障下的绝对零延迟承诺。
- Sensitive handling: 普通 Wiki 未记录公网 IP、私钥、CloudBase 凭据、中继令牌、账号密码或未来订阅值。
## [2026-07-22] cloud-media-signing-time-correction | 修复资讯图片与来源头像全局留白

- Session: local Codex task
- Target pages: `hyyc/services/cloud-media.js`、`hyyc/features/knowledge-feed/cloud-media-session.js`、媒体回归测试与 `wiki/`
- Summary: 生产条目、公开 DTO、云存储对象和读取 ACL 均正常；微信 SDK 也成功返回临时 HTTPS。根因是客户端把 TCB 地址的 `t` 签名生成时间误作绝对过期时间，导致刚获取的头像、列表缩略图和详情预览被共享媒体 session 全部拒绝。现已只按 SDK `maxAge` 或五分钟有界 TTL 续签，并兼容 `status: 0`、`code: SUCCESS` 与 `fileID`/`fileId` 返回形态。
- Runtime evidence: 开发者工具自动化对同一生产资讯修复前复现三个 URL 为空，修复后头像、缩略图和正文原图均为可渲染 HTTPS；列表与详情截图肉眼复核通过。
- Verification: 435/435 Node 测试、35 JSON/267 JavaScript/11 pages 项目检查和 `git diff --check` 通过；无需修改云函数、云存储对象或截图队列。

## [2026-07-22] runtime-reliability-performance-and-feed-spacing | 资讯间距与生产运行复核

- Session: local Codex task
- Target: `pages/inbox/index.wxss`、资讯 UI 回归、生产代理/截图/队列、小程序首屏与 `wiki/`
- Summary: 同一已展开日期内的相邻资讯卡增加 `14rpx` 间距，日期首项和卡片内部不增空白；修正总览中测试数、普通用户 24 小时权益、CloudBase `t` 签名语义、24×3 手绘图和六云函数等过时事实。
- Production evidence: 公网节点负载接近 0、可用内存约 486–511 MiB、Swap 0，最近一小时 Nginx/WSS 无 error；两轮 X/Twitter widget/Anthropic/Hugging Face/GitHub 直连均 HTTP 200。CloudBase 两次中继探针成功；真实 X canary 约 8.4 秒并通过目标/质量校验，临时对象已删除。实时 3 条 pending 约 40 秒收敛为 pending 0、leased 0；最新 30 条中 29 条有图，1 条 X 超时进入 retry 但文字正常公开。
- Client evidence: 开发者工具首屏真实渲染 8 条资讯、7 张列表图和 7 个头像，无 feed error；同会话两次进入到文字与图片同时可用约 7.9/4.4 秒。滚动与懒加载边界良好，但不把该结果夸大为所有网络下的亚秒冷启动。
- Verification: 436/436 Node 测试、35 JSON/267 JavaScript/11 注册页面检查与 `git diff --check` 通过；视觉截图确认间距、时间线、图片和头像。
- Sensitive handling: 普通 Wiki 未记录公网地址、SSH 私钥、CloudBase/腾讯云凭据、维护令牌、模型密钥或临时签名 URL。

## [2026-07-23] relay-single-endpoint-audit | 明确旧公网节点不是自动备用

- Session: local Codex task
- Target: CloudBase `sourcePreviewWorker` 线上配置、截图出口代码与 `wiki/`
- Summary: 线上函数只配置一组正式中继 URL 与固定地址，当前替换地址存在、先前地址不存在；代码也没有第二中继字段。旧公网服务器已退出小程序生产路径且不是自动备用，新中继故障时只会尝试 CloudBase 直连并进入视觉重试/文字降级。
- Boundary: 旧服务器若仍承载个人 Clash/Mihomo、订阅或其他非小程序服务，是否停机需要按那些服务单独确认。固定地址启用期间，单纯 DNS 切换不能构成自动故障转移。
- Sensitive handling: 只记录字段存在性和地址匹配结论，未记录公网地址、正式域名、令牌或凭据。

## [2026-07-23] source-avatar-profile-join-repair | 修复新资讯作者头像资料延迟回填

- Session: local Codex task
- Target: `hyyc/cloudfunctions/knowledgeFeed/lib/source-metadata.js`、AIHOT 来源增强适配器、作者资料增强服务、专项回归与 `wiki/`
- Root cause: AIHOT 正文条目可能先于可选作者资料传播；旧服务只为当轮增强流已经出现的账号读取作者档案，导致正文先入库后长期保留首字母头像。生产作者档案和头像对象本身均正常，新公网中继不是原因。
- Summary: 共享模块统一解析精确 X 原帖账号；增强服务现在为本批所有 X 原帖读取已有作者档案，上游资料晚到或暂时失败时仍能补回昵称、账号和头像，不阻断正文且不清空旧资料。
- Production evidence: `knowledgeFeed` 部署后强制检查 2,110 条当前资讯，仅更新 1 条；目标条目已具备作者身份与头像 File ID，对应临时地址返回 HTTP 200、`image/webp`。
- Verification: 来源资料专项 9/9、全量 Node 437/437、35 JSON/267 JavaScript/11 pages 项目检查及 `git diff --check` 通过。
- Sensitive handling: 普通 Wiki 未记录公网地址、正式域名、CloudBase 凭据、维护令牌、模型密钥、Cloud File ID 或临时签名 URL。

## [2026-07-23] aigclink-open-source-library | 接入 AIGCLINK 并新增“开源库”来源范围

- Session: local Codex task
- Target: `hyyc/cloudfunctions/knowledgeFeed/adapters/aigclink-source.js`、独立同步服务、定时调度、频道模型、资讯导航和 `wiki/`
- Summary: 读取 AIGCLINK 公开列表的最近 30 条索引字段，保留标题、摘要、日期、标签、项目链接和来源详情链接，不复制正文；使用独立 6 小时刷新与失败边界写入既有条目/日期索引，并在资讯顶部增加青绿色“开源库”入口。
- Verification: 公开接口实测返回 30 条；专项与调度测试 6/6、全量 Node 441/441、35 JSON/270 JavaScript/11 页面检查及差异检查通过；微信开发者工具 CLI 预览成功，包约 361.9 KB。
- Deployment boundary: 本轮未部署 `knowledgeFeed` 或改写生产数据；工作区已有大量未提交既有改动，需先整理部署范围，避免无关改动随云函数一起上线。
- Sensitive handling: 未记录 CloudBase 凭据、维护令牌、用户数据或短期运行令牌；只保存公开集合的稳定标识和来源契约。

## [2026-07-23] aigclink-channel-contract-production-fix | 修复“开源库”假选中并完成生产同步

- Session: local Codex task
- Root cause: 客户端已经发送 `channel: 'openSource'`，但服务端 `feed-page` 允许频道仍只有 `all / firstParty / news / x`，所以参数静默回退为 `all`；当时线上函数也尚未包含 AIGCLINK adapter 与同步服务。
- Fix: 把 `openSource` 纳入服务端查询合同，并增加“只返回开源库、不混入 AIHOT”的回归；部署 `knowledgeFeed` 后由分钟定时器完成首次同步。
- Production evidence: 生产有 30 条 `sourceChannelKey: 'openSource'` 条目，`source` 为 `AIGCLINK 开源库`；同步状态计数 30，错误码为空。抽检标题和项目 URL 与目标平台公开列表一致。
- Verification: 频道/AIGCLINK/调度专项 24/24、全量 Node 442/442、35 JSON/270 JavaScript/11 页面检查和差异检查通过。
- Sensitive handling: 未在 Wiki 中记录云凭据、维护令牌、模型密钥、用户数据或短期签名地址。

## [2026-07-23] github-library-flat-layout-and-avatar | 区分开源库独立布局并更新 GitHub 识别

- Session: local Codex task
- Target: `hyyc/pages/inbox/`、资讯列表模型、AIGCLINK adapter/同步服务、来源频道配置和 `wiki/`
- Product contract: 独立“GitHub 开源库”频道为连续卡片列表，不显示日期分组、折叠控件、时间线、时间点或单条时间；同一批条目出现在“全部”频道时继续使用普通资讯的日期时间线。
- Source presentation: 可见来源从 `AIGCLINK 开源库` 改为 `GitHub 开源库`，使用 GitHub 官方 Brand Toolkit 的 Invertocat 小头像；AIGCLINK 仍保留为内部上游归因和详情链接。
- Production evidence: `knowledgeFeed` 同步版本 2 已部署；生产聚合分组确认 30/30 条 `openSource` 记录使用新名称和同一 Cloud File ID，同步状态计数 30、版本 2、错误码为空。
- Verification: 全量 Node 444/444、35 JSON/270 JavaScript/11 页面项目检查、目标语法和差异检查均通过；微信开发者工具 CLI 预览成功，包约 360.3 KB。

## [2026-07-23] personal-clash-proxy | 新公网节点增加个人 Clash 订阅

- Session: local Codex task
- Target: 新公网节点 sing-box/systemd、现有 Nginx 443、Clash Verge/Mihomo 兼容配置与 `wiki/`
- Summary: 新增独立 VLESS/WebSocket 服务和只读远程 Clash YAML，均通过随机精确路径复用现有 TLS；没有新增公网端口、UFW 规则或修改小程序生产中继入口。服务端拒绝私网目标，订阅禁用缓存与 access log。
- Verification: sing-box 配置、Nginx 语法、三项 systemd 服务状态和原健康端点通过；Mihomo `v1.19.29` 对远程订阅语法检查通过，隔离端口真实 HTTPS 返回 204 且出口与服务器一致。
- Security finalization: 交付前发现旧版 Windows .NET 随机 API 未填充草稿路径，已使用 `RandomNumberGenerator.Create().GetBytes()` 同时轮换 WebSocket 与订阅路径；旧订阅返回 404，新路径重新完成 Mihomo 语法与真实出口验证。
- User boundary: 按用户要求未在本机 Clash Verge 自动导入、切换或改写现有订阅；只交付私有订阅链接。
- Sensitive handling: 实际订阅 URL、UUID、随机路径和服务器地址只保存在 `wiki/secrets/` 与服务器受限配置中，普通 Wiki 未记录实际值。

## [2026-07-23] aigclink-full-library-native-tags | 全量开源库与原生标签筛选上线

- Session: local Codex task
- Product contract: 顶部来源标签压缩为 `GitHub`；独立频道不显示日期、时间线或 AIHOT 的时间/公司/方向条件，只提供可搜索的 AIGCLINK 原生标签并向所有角色开放全量历史。同一条目在“全部”频道继续遵守普通资讯的时间线、筛选和权限。
- Source contract: AIGCLINK 单次 record map 存在约 999 block 容量，改为包含式日期分段后取得完整 1,727 条、528 个标签，跨度 2023-10-28 至 2026-07-21；8 条空摘要记录也被保留。
- Sync contract: 每分钟读取最新 30 条内容指纹，变化时分段全量同步；未变化只更新轮询时间，每 24 小时全量对账旧记录。历史回填不扩写日期索引、不批量排截图，文字立即公开。
- Production evidence: `knowledgeFeed` 同步版本 3 已部署；生产开源库返回 `totalAvailable/resultCount: 1727`，`MCP` 原生标签返回 53 条且应用时间为 `all`；随后轮询返回 `unchanged`，同步错误为空。
- Verification: 全量 Node 447/447、35 JSON/270 JavaScript/11 页面检查和 `git diff --check` 通过；微信开发者工具 CLI 预览成功，包 372,810 bytes（364.1 KB）。
- Sensitive handling: 普通 Wiki 未记录 CloudBase 凭据、维护令牌、用户数据、Cloud File ID 或短期签名地址。

## [2026-07-23] feed-copy-and-product-avatar-fallback | 优化来源命名与缺省头像

- Session: local Codex task
- Product copy: GitHub 标签筛选弹层不再显示技术性的 `AIGCLINK 标签` 眉题；AIHOT 的 `firstParty` 内部合同不变，顶部用户界面名称从“一手信源”调整为“官方动态”。
- Avatar contract: 列表、详情来源档案和相关推荐优先显示真实来源头像；没有头像或 CloudBase 临时头像续签失败时，统一回退到 96×96、5,138 bytes 的本地产品图标，不再显示灰色首字母占位。
- Verification: 头像/频道/筛选专项 44/44、全量 Node 448/448、35 JSON/270 JavaScript/11 页面项目检查通过；微信开发者工具 CLI 登录与预览成功，包 379,193 bytes（370.3 KB）。
- Deployment boundary: 本轮只有客户端文案、展示逻辑和本地资源变更，未修改云端 DTO 或生产数据；未重新部署云函数，也未上传体验版。

## [2026-07-23] channel-spinner-and-production-readiness-audit | 内容区纯转圈与全项目生产审计

- Session: local Codex task
- Target: `hyyc/pages/inbox/`、客户端/云函数/截图链路、依赖、CloudBase 只读状态、发布流程与 `wiki/`
- UI change: 顶部频道保持原样；频道切换只在中间内容区显示无文字圆形转圈，初次进入仍使用原骨架屏。成功、失败或最新请求结束后清理转圈，快速切换继续由首页 request generation 防旧请求覆盖。
- Audit result: 当前发布门禁为 Fail。已确认生产用户媒体规则与服务端删除缺少对象级所有权、会员降级后详情缓存可短时保留付费内容、截图浏览器存在 DNS rebinding 边界、当前生产快照不可由单一 Git SHA 重建；另记录异步竞态、同步租约、AI 预算/幂等、视觉孤儿文件、统计截断、依赖与真实支付等 P2/P1 门禁。
- Production evidence: `tcb storage rules get --json` 确认生产 `user-media/` 公开读且写规则未绑定路径；函数只读清单显示 6 个函数均已部署，截图函数为 Node 20.19、其余为 Node 18.15。未部署函数、改写数据或上传体验版。
- Verification: 频道专项 2/2、全量 Node 450/450、35 JSON/271 JavaScript/11 pages 项目检查和 `git diff --check` 通过；实验覆盖率 Lines 77.72% / Branches 70.07% / Functions 73.63%；微信开发者工具 CLI preview 成功，包约 371.1 KB。生产日志 API 返回 `ResourceUnavailable`，未据此宣称最近 24 小时无错误。
- Sensitive handling: 未读取 `wiki/secrets/`，未记录凭据、令牌、用户数据、Cloud File ID、短期签名 URL 或环境变量值。

## [2026-07-23] personal-clash-proxy-unbounded-service | 移除个人代理人为资源上限

- Session: local Codex task
- Scope: 仅新公网节点 `personal-proxy.service`；未操作本机 Clash Verge、当前订阅或 7897 监听。
- Evidence: sing-box 配置没有连接/流并发字段，Nginx 没有 `limit_conn` 或 `limit_req`；调整前 443 已同时存在 22 条连接，因此节点从来不是单连接。
- Change: 使用 systemd 持久属性覆盖把 `MemoryMax` 和 `TasksMax` 设为 `infinity`，保留 `LimitNOFILE=524288` 的系统文件描述符容量。
- Verification: 服务保持 active/running，主进程 PID 不变、`NRestarts=0`、重启增量 0；没有因调整主动断开现有连接。

## [2026-07-23] cloudbase-access-control-release-controls | 补齐数据库与存储规则发布门禁

- Session: local Codex task
- Scope: `hyyc/scripts/cloudbase-*` 发布控制、共用模块、专项测试、运行手册与 `wiki/`；未修改用户媒体业务逻辑。
- Change: 数据库 22 个集合、云存储规则与精确四函数 manifest 都有 dry-run/只读 check；规则与退休函数 apply 需要精确环境确认并最终回读。函数详情只输出 runtime、handler、资源配置、状态和触发器白名单，绝不输出 Environment/CodeInfo。
- Read-only production evidence: 当前有 5 个合同集合仍为 `PRIVATE`；存储仍允许旧 `user-media/` 公开读取和 owner 直写。四个正式函数配置与触发器匹配，但线上仍有两个允许列表内的退休函数；对应 check 正确阻止继续发布。未部署、删除或改写线上资源。
- Security gate: 白名单脚本形成前的一次原始只读详情核对把生产环境变量值带入本地工具输出；普通 Wiki/仓库未保存或复述值，但发布前必须轮换受影响凭据。
- Verification: 专项 15/15、数据库合同 22/22、30 JSON/274 JavaScript/11 pages 项目检查、包级 dry-run、退休 plan、真实 CLI 只读回读和三项缺确认 apply 拒绝通过。
- Sensitive handling: 未读取或记录 CloudBase 凭据、令牌、用户数据、Cloud File ID、环境变量值或短期签名地址。

## [2026-07-23] cloudbase-database-index-controls | 建立增量索引合同并回读生产漂移

- Session: local Codex task
- Scope: `docs/cloud-database-indexes.json`、索引 plan/check/apply/readback 脚本、专项测试、运行手册与 `wiki/`；未修改业务服务，未执行线上 apply。
- Change: 34 个生产关键查询索引纳入版本化增量合同；apply 必须精确环境确认，只创建缺失索引，从不删除未知索引。缺少集合、同名定义冲突都会在任何写入前阻断；所有只读和失败输出均限制为索引元数据白名单。
- Read-only production evidence: 合同集合中回读到 43 个现有索引（含内置索引），没有同名冲突；缺少 11 个必要索引。`knowledge_user_media` 集合尚不存在，因此必须先运行版本化集合 apply，并由数据库规则确认 `ADMINONLY`，再应用索引。
- Verification: 索引专项 8/8、全量 Node 515/515、34 项离线合同检查和 30 JSON/277 JavaScript/11 pages 项目检查通过；真实 plan/readback 漂移一致，check 正确退出 1，无确认 apply 在首次远程读取前拒绝。
- Follow-up: 索引审计记录的收藏/评论 100 条后截断已由后续生产整改任务修复，不属于索引控制改动。
- Sensitive handling: 未记录数据库文档、用户数据、Cloud File ID、短期签名地址、函数环境变量值、登录凭据或原始 TCB 响应。

## [2026-07-23] cloudbase-database-collection-controls | 显式创建缺失合同集合

- Session: local Codex task
- Scope: 集合 plan/check/apply/readback、专项测试、package scripts、发布手册与 `wiki/`；复用既有 22 集合规则合同，未修改业务服务或索引合同。
- Change: apply 在首次远程读取前要求精确环境确认，先完整 `ListTables`，再只以 `CreateTable` 创建缺失合同集合；请求同时设置 `PermissionInfo.AclTag=ADMINONLY`。没有删表、文档读取、未知集合修改或原始失败响应输出能力。
- Read-only production evidence: 22 个合同集合中现有 21 个，仅缺 `knowledge_user_media`；另有 5 个非合同集合只计数保留，未输出名称。真实 check 正确退出 1；未执行线上 apply。
- Verification: 集合专项 9/9、全量 Node 515/515、30 JSON/277 JavaScript/11 pages/0.43 MiB 项目检查、真实 plan/readback、无确认 apply 拒绝和差异空白检查通过。
- Release order: 先集合 apply/readback，再由数据库规则 apply/check 最终确认 22 个集合全部 `ADMINONLY`，之后应用索引/存储规则并运行隔离媒体 canary。
- Sensitive handling: 未记录数据库文档、未知集合名、用户数据、Cloud File ID、短期签名地址、函数环境变量值、登录凭据或原始 TCB 响应。

## [2026-07-23] production-release-candidate | 生产收敛并上传微信 1.0.0

- Session: local Codex task
- Snapshot: `1bf9fb8cc7bf01ba54108ca089e02b621b400cda`，标签
  `release-candidate-2026-07-23`；GitHub Actions 10/10，本地 515/515。
- CI maintenance: `actions/checkout` 与 `actions/setup-node` 升级到 v5，
  使用 Node 24 action 运行时并增加手动门禁入口，消除 GitHub 对 v4/Node 20
  的弃用告警。
- Production: 22 个合同集合全部 `ADMINONLY`，34 个合同索引收敛，用户媒体
  客户端直写关闭；四个正式函数及九个触发器精确回读，两个旧 digest 函数退休。
- Canaries: GitHub 1,728 条/528 标签/不限时间，截图真实 X 捕获，隔离媒体
  上传、跨身份不可见和立即清理均通过；临时函数及 canary 数据全部清理。
- Upload boundary: 没有用户次数或累计上传配额；6MB 只是单次请求体技术上限，
  头像 1 MiB、评论图片 3 MiB 为单文件安全边界。
- WeChat: 版本 `1.0.0` 已上传体验版，包体 397,154 bytes。正式审核与发布、
  真机验收、后台类目/隐私配置和开售前支付退款矩阵仍由管理员完成。
- Sensitive handling: 未在仓库或普通 Wiki 记录凭据、环境变量值、用户标识、
  Cloud File ID 或短期签名地址。
