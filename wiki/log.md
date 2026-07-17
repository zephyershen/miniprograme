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
