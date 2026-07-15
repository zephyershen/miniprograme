from __future__ import annotations

import json
from pathlib import Path


OUTPUT = Path(__file__).with_name("knowledge-platform-ui-spec.json")

GLOBAL_GUARD = (
    "Single vertical 9:16 mobile product-design reference showing one coherent interface state. "
    "No collage, no grid of multiple screens, no contact sheet, no split panels, no scrapbook. "
    "No readable words, no numbers, no logos, no brand marks, no real user data. "
    "Use abstract typographic bars and neutral image placeholders only. "
    "No rounded card containers, no floating card stack, no heavy gradient, no cyberpunk neon overload. "
    "Young, credible, bright editorial art direction for a Chinese WeChat knowledge product."
)


def suggestion(label: str, description: str) -> dict[str, str]:
    return {
        "label": label,
        "description": description,
        "promptHint": description,
    }


def make_item(
    item_id: str,
    family: str,
    title: str,
    caption: str,
    motif: str,
    palette: list[str],
    prompt: str,
    riffs: dict[str, tuple[str, str]],
    tone: str = "bright editorial, youthful, trustworthy",
) -> dict:
    return {
        "id": item_id,
        "family": family,
        "visualTerritory": family,
        "title": title,
        "caption": caption,
        "source": "Generated from the qualified knowledge-platform brief; no external image reference.",
        "tone": tone,
        "motif": motif,
        "palette": palette,
        "prompt": f"{prompt} {GLOBAL_GUARD}",
        "audienceCue": "Chinese young adults who want useful current knowledge without noisy scrolling.",
        "focusedOutputType": "WeChat mini-program visual system and mobile editorial feed",
        "remixSuggestions": {
            slot: [suggestion(label, description)]
            for slot, (label, description) in riffs.items()
        },
    }


OFF_WHITE = ["#F7F3EA", "#171717", "#D8D1C4", "#275DFF", "#FFFFFF"]
SIGNAL = ["#F6F7F4", "#111416", "#C9CED1", "#1C64F2", "#FF5A4F"]
AI_BLUE = ["#F7F8F4", "#111111", "#1E5EFF", "#9AB7FF", "#DDE7FF"]
ENTERTAINMENT = ["#FFF8F4", "#1B1718", "#FF5D66", "#FF9A87", "#FFD3C7"]
SOCIETY = ["#FFF9EC", "#211B13", "#E49A17", "#F2C464", "#F9E8B8"]
GAMING = ["#F7F8F1", "#111411", "#B6F23B", "#5E7F1D", "#E4F7B8"]
ENGLISH = ["#F3FBFD", "#132027", "#30BCE3", "#8EDCEF", "#D6F3F8"]
READING = ["#FBF8F1", "#1B1B19", "#DDD4C7", "#E9D54B", "#3C6EF5"]


items = [
    make_item(
        "editorial-01-lead-index",
        "编辑索引",
        "非对称头条索引",
        "用字号、留白和细线建立首屏内容主次。",
        "asymmetrical lead story, thin rules, generous negative space",
        OFF_WHITE,
        "A refined off-white mobile editorial feed with one dominant lead-story region, two subordinate text rows, razor-thin black dividers, a narrow cobalt category rail, and strong asymmetrical whitespace.",
        {
            "style": ("Swiss editorial", "Tighten the baseline rhythm and make the asymmetry more deliberate without adding containers."),
            "palette": ("Ink and cobalt", "Reduce the palette to warm paper, black ink and one precise cobalt thread."),
            "scene": ("Fresh morning edition", "Make the interface feel like a newly issued morning edition with crisp natural light."),
            "props": ("Hairline rules", "Use only fine rules, tiny status dots and quiet image crops as structural cues."),
            "character": ("No human", "Keep the frame entirely interface-led with no hands or people."),
            "format": ("Tall first screen", "Recompose for a tall WeChat first screen with a clear opening hierarchy."),
        },
    ),
    make_item(
        "editorial-02-section-rail",
        "编辑索引",
        "侧边栏目轨道",
        "窄色轨与缩进替代卡片边界。",
        "slim section rail, indentation, editorial list rhythm",
        OFF_WHITE,
        "A bright mobile knowledge index organized by a slim vertical section rail at the left edge, staggered indents, black typographic bars, fine horizontal separators, and a restrained cobalt locator mark.",
        {
            "style": ("Index precision", "Push the left rail and indentation system into a sharper editorial index language."),
            "palette": ("Paper white", "Use warmer paper white with softer gray rules and one saturated blue locator."),
            "scene": ("Section browsing", "Show a single calm category-browsing state with one active rail position."),
            "props": ("Locator marks", "Add tiny geometric locators and rule endings, never pills or badges."),
            "character": ("Thumb-free", "Keep the interface unobstructed and free of human hands."),
            "format": ("Narrow portrait", "Make the composition feel especially efficient on a narrow phone screen."),
        },
    ),
    make_item(
        "editorial-03-image-led-story",
        "编辑索引",
        "图像主导头条",
        "一条通栏图片与严格文本层级形成杂志感。",
        "edge-to-edge editorial image strip, strict hierarchy",
        ["#F8F3EA", "#181818", "#CFC5B6", "#EC5A45", "#FFFFFF"],
        "A single mobile editorial story opener with one edge-to-edge documentary image strip, an oversized abstract headline block beneath it, two compact metadata lines, and thin black rules on a warm off-white surface.",
        {
            "style": ("Magazine opener", "Increase the tension between the full-width image strip and the strict text hierarchy."),
            "palette": ("Warm coral cue", "Replace cobalt with one restrained coral editorial cue on warm paper."),
            "scene": ("Breaking feature", "Make this feel like a high-priority feature arriving inside a calm publication."),
            "props": ("Crop marks", "Use subtle crop edges and fine registration-like ticks without readable labels."),
            "character": ("Documentary presence", "If a person appears inside the story image, keep them distant and nonspecific."),
            "format": ("Hero portrait", "Give the image strip more vertical presence while retaining the article hierarchy."),
        },
    ),
    make_item(
        "editorial-04-dense-briefs",
        "编辑索引",
        "高密度短讯列表",
        "用下划线、缩进和行距承载密集更新。",
        "dense brief list, underlines, indentation, typographic rhythm",
        ["#FAF8F2", "#141414", "#B9B5AC", "#275DFF", "#EFECE4"],
        "A dense but calm mobile brief list on a light paper background, each update separated by thin underlines, alternating indentation, compact abstract metadata bars, and a single blue active indicator, with no boxed modules.",
        {
            "style": ("Newsroom discipline", "Make the dense list feel edited and breathable rather than dashboard-like."),
            "palette": ("Soft graphite", "Use graphite text, bone white and a muted cobalt active indicator."),
            "scene": ("Rapid scan", "Optimize the single screen for scanning many short updates in seconds."),
            "props": ("Underlined rhythm", "Let underlines, baselines and indentation carry all component boundaries."),
            "character": ("No human", "Keep the visual reference strictly interface-only."),
            "format": ("Long feed crop", "Extend the list vertically to demonstrate a continuous non-card feed."),
        },
    ),
    make_item(
        "editorial-05-section-opener",
        "编辑索引",
        "专题开场页",
        "大留白、色块边带和栏目节奏形成仪式感。",
        "section opener, edge band, large negative space",
        ["#F4EFE5", "#151515", "#E45A47", "#F6C9BE", "#FFFFFF"],
        "A minimal mobile section opener with a narrow coral edge band, a large blank editorial field, one abstract title block, a compact row of topic markers, and a precise continuation list separated by hairlines.",
        {
            "style": ("Quiet ceremony", "Increase the sense of a deliberate section opening through scale and silence."),
            "palette": ("Coral margin", "Keep the warm neutral field and concentrate coral only along one edge."),
            "scene": ("Topic arrival", "Show the exact moment a reader enters one curated topic section."),
            "props": ("Edge band", "Use one flat edge band and tiny line markers as the only decorative elements."),
            "character": ("No human", "Let pure editorial composition carry the frame."),
            "format": ("Above-the-fold", "Focus on a strong above-the-fold mobile section entrance."),
        },
    ),
    make_item(
        "editorial-06-paper-detail",
        "编辑索引",
        "纸张与墨线材质",
        "把纸感、印刷网点与细线转译为数字界面质感。",
        "paper grain, ink line, restrained digital texture",
        ["#F2EBDD", "#161512", "#BEB4A4", "#315CFF", "#FCFAF5"],
        "A macro close-up visual study of a single mobile interface surface inspired by fine uncoated paper grain, crisp black ink rules, subtle halftone texture, and one clean cobalt digital accent, still clearly a modern phone screen.",
        {
            "style": ("Tactile digital", "Push the meeting point between paper tactility and precise modern interface rendering."),
            "palette": ("Natural stock", "Warm the neutral stock and keep blue as a tiny digital interruption."),
            "scene": ("Macro surface", "Move closer to the screen surface so material and rule quality dominate."),
            "props": ("Ink texture", "Add subtle halftone and registration texture without introducing print clutter."),
            "character": ("No human", "Exclude people and concentrate on material detail."),
            "format": ("Detail crop", "Create a tighter portrait crop of the interface material and thin-rule system."),
        },
    ),

    make_item(
        "signal-01-channel-track",
        "实时信号",
        "横向频道轨道",
        "页内频道像一条可定位的编辑轨道。",
        "horizontal channel track, active marker, current position",
        SIGNAL,
        "A clean mobile news interface with a single horizontal channel track near the top, one clear active marker, compact abstract section labels, a live update dot, and a continuous list below divided only by hairlines.",
        {
            "style": ("Transit clarity", "Make the channel track feel as legible and intentional as a modern transit line."),
            "palette": ("Blue signal", "Use cool white, charcoal and one crisp blue signal with a tiny coral alert."),
            "scene": ("Channel switch", "Capture the precise interface state just after switching to a new topic."),
            "props": ("Track markers", "Use small track stops, ticks and a single live dot, never pill tabs."),
            "character": ("No human", "Keep the channel mechanism fully visible without hands."),
            "format": ("Top-heavy portrait", "Emphasize the upper navigation track within a tall phone composition."),
        },
    ),
    make_item(
        "signal-02-live-timeline",
        "实时信号",
        "更新垂直时间线",
        "时间线与状态点表达持续更新。",
        "vertical timeline, status points, chronological flow",
        ["#F7F7F3", "#121617", "#ADB6BA", "#FF5A4F", "#1C64F2"],
        "A single mobile live-update timeline with a thin vertical line, spaced status points, alternating left-right content alignment, pale neutral background, and one coral current-event marker, no boxes or cards.",
        {
            "style": ("Chronology first", "Make temporal sequence the dominant visual grammar while keeping the page light."),
            "palette": ("Coral now", "Reserve coral for the current moment and keep older events in cool gray."),
            "scene": ("Live unfolding", "Show one active event arriving at the top of a continuous timeline."),
            "props": ("Status points", "Use precise dots, line joints and subtle progress ticks only."),
            "character": ("No human", "Keep all attention on the live chronology."),
            "format": ("Timeline portrait", "Extend the vertical line through most of the tall mobile frame."),
        },
    ),
    make_item(
        "signal-03-pulse-update",
        "实时信号",
        "脉冲式新动态",
        "小范围动势提示新内容，不制造焦虑。",
        "subtle pulse, new update, calm motion cue",
        ["#F5F7F4", "#111615", "#C7D0CB", "#2A67FF", "#7BA0FF"],
        "A restrained mobile update screen with one subtle blue pulse line crossing a clean content row, a tiny live status point, generous white space, and a structured feed continuing beneath with thin separators.",
        {
            "style": ("Calm kinetic", "Introduce controlled movement without turning the interface into a trading terminal."),
            "palette": ("Electric blue pulse", "Keep the screen neutral and concentrate energy in one blue pulse line."),
            "scene": ("New item arrives", "Capture a single new item entering the feed with quiet visual motion."),
            "props": ("Pulse trace", "Use one pulse trace and one state point, avoiding charts or metrics."),
            "character": ("No human", "Keep the frame focused on the arrival cue."),
            "format": ("Centered pulse", "Place the pulse moment near the visual center of a tall screen."),
        },
    ),
    make_item(
        "signal-04-refresh-motion",
        "实时信号",
        "刷新中的连续信息流",
        "轻微运动模糊表现滚动和更新节奏。",
        "controlled motion blur, continuous feed, refresh rhythm",
        ["#FAFAF6", "#171A1B", "#C5C8C9", "#2B63E8", "#E8EBEC"],
        "A single mobile feed during a gentle refresh, with crisp anchored navigation and a few content rows carrying subtle controlled vertical motion blur, thin dividers, and a quiet blue refresh cue.",
        {
            "style": ("Editorial motion", "Balance motion blur with a stable editorial grid and clear hierarchy."),
            "palette": ("Cool newsroom", "Use cool neutral grays and one desaturated blue refresh cue."),
            "scene": ("Mid refresh", "Show the single instant of a feed refreshing without spinners or loading cards."),
            "props": ("Anchor line", "Keep one sharp anchor rule while surrounding rows move softly."),
            "character": ("Passing thumb", "Optionally include only the edge of a nonspecific thumb to imply refresh motion."),
            "format": ("Motion crop", "Use a tall close crop that makes vertical movement obvious."),
        },
    ),
    make_item(
        "signal-05-navigation-system",
        "实时信号",
        "底栏与页内频道协作",
        "展示主导航和频道导航的双层关系。",
        "bottom navigation, horizontal categories, two-level hierarchy",
        ["#F7F8F5", "#121515", "#CBD0CC", "#265DFF", "#FF6758"],
        "A coherent mobile product screen demonstrating two-level navigation: a slim horizontal topic track inside the page and a minimal bottom navigation rail, with the content list between them separated by lines and whitespace, no rounded containers.",
        {
            "style": ("System clarity", "Make the relationship between global and local navigation immediately understandable."),
            "palette": ("Neutral with dual cues", "Use blue for the active topic and coral for one fresh-update indicator."),
            "scene": ("Discover home", "Show the default discovery state with one topic selected and one bottom destination active."),
            "props": ("Minimal glyphs", "Use abstract line glyphs and tiny markers instead of labeled icons."),
            "character": ("No human", "Present the navigation architecture without hands or device mockup clutter."),
            "format": ("Full device field", "Show the entire useful vertical field from topic rail to bottom navigation."),
        },
    ),
    make_item(
        "signal-06-source-radar",
        "实时信号",
        "来源更新雷达",
        "用来源点位而非品牌 Logo 表示多厂商更新。",
        "source nodes, update status, provenance without logos",
        ["#F6F7F3", "#161817", "#AEB7B2", "#285FFF", "#E9ECE8"],
        "A mobile source-monitoring view with a quiet vertical list of anonymous source nodes, tiny freshness dots, thin connector rules, and a single expanded update row, all on a bright neutral field with no logos or readable labels.",
        {
            "style": ("Source observatory", "Make source freshness visible without resembling an analytics dashboard."),
            "palette": ("Cool provenance", "Use quiet cool neutrals and one blue freshness signal."),
            "scene": ("Official-source check", "Show one anonymous official source receiving a fresh update."),
            "props": ("Node connectors", "Use small source nodes, connector rules and freshness dots only."),
            "character": ("No human", "Keep the composition entirely source-system focused."),
            "format": ("Compact source list", "Fit several source rows into one tall but breathable mobile screen."),
        },
    ),

    make_item(
        "spectrum-01-ai-cobalt",
        "频道色谱",
        "AI 科技蓝",
        "蓝色只作为栏目标识与关键动作。",
        "AI technology channel, cobalt accent, analytical clarity",
        AI_BLUE,
        "A bright mobile AI and technology channel using a strict black editorial list, one flat cobalt edge stripe, cool pale-blue section markers, thin rules, and one technical illustration crop without logos or text.",
        {
            "style": ("Technical editorial", "Combine analytical precision with magazine-scale hierarchy, avoiding dashboards."),
            "palette": ("Cobalt hierarchy", "Use cobalt only for channel identity and one primary action cue."),
            "scene": ("AI update channel", "Show a single current AI update leading a compact knowledge list."),
            "props": ("Blueprint ticks", "Add subtle blueprint-like ticks and line joints without diagrams or labels."),
            "character": ("No human", "Keep the technology channel abstract and product-focused."),
            "format": ("Cobalt edge crop", "Make the cobalt edge stripe visible throughout the portrait frame."),
        },
    ),
    make_item(
        "spectrum-02-entertainment-coral",
        "频道色谱",
        "娱乐珊瑚红",
        "更有节奏，但保持编辑可信度。",
        "entertainment channel, coral rhythm, editorial energy",
        ENTERTAINMENT,
        "A youthful mobile entertainment channel with a flat coral section band, one cinematic image crop, energetic but disciplined black type bars, staggered story rows, and thin separators on a warm light field.",
        {
            "style": ("Culture magazine", "Increase cultural energy through crop and rhythm, not decorative cards."),
            "palette": ("Coral spotlight", "Concentrate coral around one lead story and keep supporting content neutral."),
            "scene": ("Culture release", "Show one new entertainment release leading a fast editorial scan."),
            "props": ("Frame cues", "Use film-frame edges and tiny rhythm marks without recognizable media branding."),
            "character": ("Distant performer", "Allow one nonspecific cropped performer silhouette inside the lead image."),
            "format": ("Cinematic portrait", "Use one wide image crop within a tall mobile editorial frame."),
        },
    ),
    make_item(
        "spectrum-03-society-amber",
        "频道色谱",
        "社会琥珀色",
        "温暖而严肃，避免煽情与警报感。",
        "society channel, amber accent, civic warmth",
        SOCIETY,
        "A trustworthy mobile society channel using warm amber as a slim contextual band, documentary imagery with anonymous public space, black editorial hierarchy, generous margins, and precise source rows separated by hairlines.",
        {
            "style": ("Civic editorial", "Make the screen humane and serious without looking bureaucratic or alarming."),
            "palette": ("Measured amber", "Use amber as a contextual cue rather than a warning color."),
            "scene": ("Public life", "Feature one calm documentary public-space story above supporting briefs."),
            "props": ("Source rules", "Strengthen attribution with lines and markers instead of badges."),
            "character": ("Anonymous citizens", "If people appear in the image, keep them distant, diverse and non-identifiable."),
            "format": ("Documentary portrait", "Balance one documentary image with a continuing vertical brief list."),
        },
    ),
    make_item(
        "spectrum-04-gaming-lime",
        "频道色谱",
        "游戏荧光绿",
        "用荧光绿提供能量，但不做赛博朋克。",
        "gaming channel, acid-lime accent, structured energy",
        GAMING,
        "A modern mobile gaming knowledge channel on a pale neutral background with one flat acid-lime edge stripe, black editorial rows, a single abstract game-world image crop, precise status marks, and no neon glow.",
        {
            "style": ("Playful precision", "Add gaming energy through crop and timing while preserving editorial discipline."),
            "palette": ("Flat lime", "Keep lime completely flat and matte against charcoal and warm white."),
            "scene": ("Game update", "Show one major game update leading a clean sequence of supporting notes."),
            "props": ("Pixel ticks", "Use sparse pixel-like ticks and angular rule endings without controllers or logos."),
            "character": ("No avatar", "Avoid recognizable characters; keep any imagery atmospheric and anonymous."),
            "format": ("Energetic tall crop", "Use a dynamic diagonal image crop inside one portrait screen."),
        },
    ),
    make_item(
        "spectrum-05-english-cyan",
        "频道色谱",
        "英语天青色",
        "双语学习感清爽，不像课程商城。",
        "English learning channel, cyan accent, bilingual rhythm",
        ENGLISH,
        "A clean mobile English knowledge channel with alternating abstract bilingual line lengths, one cyan vertical cue, pronunciation-wave micro marks, thin separators, and airy spacing on a pale cool background.",
        {
            "style": ("Language editorial", "Make the alternating line rhythm feel educational without resembling a course app."),
            "palette": ("Clear cyan", "Use cyan for language cues and progress only, keeping the page mostly neutral."),
            "scene": ("Daily phrase in context", "Show one bilingual knowledge item expanded above a short learning list."),
            "props": ("Wave marks", "Add tiny pronunciation-wave marks and underline cues without readable characters."),
            "character": ("Quiet learner", "Optionally show a subtle hand at the edge, never a posed classroom figure."),
            "format": ("Line-by-line portrait", "Emphasize alternating line lengths down the vertical reading path."),
        },
    ),
    make_item(
        "spectrum-06-category-thread",
        "频道色谱",
        "多频道色线系统",
        "五种频道色在同一信息流中保持克制。",
        "multi-category thread, flat color stripes, unified editorial system",
        ["#F8F7F2", "#151515", "#245FFF", "#FF625F", "#E2A11E", "#B4EF3D", "#35BCD9"],
        "A single unified mobile discovery feed where five flat category colors appear only as very thin edge threads and tiny section markers across one continuous black-on-cream editorial list, with no gradients and no boxed cards.",
        {
            "style": ("Unified spectrum", "Make five categories feel like one publication rather than five separate apps."),
            "palette": ("Thin color threads", "Reduce every category color to a narrow thread or tiny marker on a neutral base."),
            "scene": ("Mixed latest feed", "Show a single latest feed containing several categories in a calm sequence."),
            "props": ("Category stitches", "Use tiny colored stitches along rules instead of tags or chips."),
            "character": ("No human", "Keep the category system fully visible and unobstructed."),
            "format": ("Full feed portrait", "Extend the mixed category thread from top channel rail to bottom navigation."),
        },
    ),

    make_item(
        "reading-01-highlighted-article",
        "知识阅读",
        "重点标注阅读",
        "以标注、边注和留白支持理解。",
        "highlighted passage, margin notes, focused reading",
        READING,
        "A focused mobile article-reading screen on warm paper white, with one translucent yellow passage highlight, thin blue margin-note line, generous line spacing, a source strip, and no floating cards or toolbars.",
        {
            "style": ("Scholar editorial", "Make highlights and margin notes feel deliberate, calm and publication-grade."),
            "palette": ("Yellow highlight", "Use soft yellow for one key passage and blue only for one margin link."),
            "scene": ("Deep reading", "Show the reader midway through one article with a single meaningful highlight."),
            "props": ("Margin notation", "Use one margin rule, one annotation tick and a subtle source line."),
            "character": ("No human", "Keep the article surface unobstructed for close inspection."),
            "format": ("Reading portrait", "Use long vertical text rhythm with comfortable mobile margins."),
        },
    ),
    make_item(
        "reading-02-bilingual-lines",
        "知识阅读",
        "逐行双语阅读",
        "中英文以节奏对应，而不是左右分栏。",
        "interleaved bilingual lines, paired rhythm, mobile legibility",
        ["#F5FBFC", "#182126", "#AFCBD2", "#2FB9D8", "#F2D969"],
        "A mobile bilingual reading screen with interleaved long and short abstract line groups, subtle cyan connectors between paired lines, one soft yellow learning highlight, and a continuous single-column vertical flow.",
        {
            "style": ("Interleaved translation", "Strengthen the pairwise rhythm without using a desktop-style split column."),
            "palette": ("Cyan learning link", "Use cyan connectors and one pale yellow learning emphasis on a cool white page."),
            "scene": ("Translation assist", "Show one sentence pair actively connected within a longer reading flow."),
            "props": ("Pair connectors", "Use short connector rules and underline ticks between corresponding lines."),
            "character": ("No human", "Keep the bilingual rhythm clean and unobstructed."),
            "format": ("Single-column portrait", "Maintain one vertical column optimized for narrow mobile reading."),
        },
    ),
    make_item(
        "reading-03-source-provenance",
        "知识阅读",
        "来源与可信度追踪",
        "来源、时间与事实点在底部形成清晰证据链。",
        "provenance footer, source trace, evidence hierarchy",
        ["#FAF8F2", "#191A18", "#B8B7B0", "#2B61EE", "#E9E5DA"],
        "A mobile article detail view with a calm reading body and a precise provenance footer made of anonymous source markers, one date-length bar, thin connector lines, and a small verified-source dot, with no badges or logos.",
        {
            "style": ("Evidence first", "Make provenance feel integral to reading rather than a legal footer."),
            "palette": ("Quiet verification blue", "Reserve blue for one verification point and keep evidence rows neutral."),
            "scene": ("Source inspection", "Show the moment a reader reaches the evidence section after an article."),
            "props": ("Evidence connectors", "Use source dots, fine connectors and aligned metadata bars."),
            "character": ("No human", "Keep the source hierarchy fully visible."),
            "format": ("Lower-half focus", "Crop the portrait screen to emphasize the transition from article to evidence."),
        },
    ),
    make_item(
        "reading-04-save-annotation",
        "知识阅读",
        "收藏与批注动作",
        "动作嵌入文字边缘，不使用浮动按钮卡片。",
        "inline save action, margin annotation, subtle interaction",
        ["#F9F6EF", "#181817", "#D0C8BA", "#EECC45", "#345FE8"],
        "A mobile reading screen showing one inline save action embedded in the article margin, a slim annotation rail, one yellow emphasis mark, and a blue confirmation stroke, with controls integrated into the text rhythm rather than floating buttons.",
        {
            "style": ("Inline interaction", "Make saving and annotation feel native to the reading rhythm."),
            "palette": ("Ink, yellow, blue", "Keep the interaction palette to black ink, one yellow highlight and one blue confirmation."),
            "scene": ("Knowledge captured", "Show a single conclusion being saved from inside the article flow."),
            "props": ("Margin action", "Use a tiny margin glyph, a short rule and one confirmation stroke."),
            "character": ("Focused fingertip", "Optionally include one subtle fingertip near the inline action without obscuring content."),
            "format": ("Interaction close crop", "Crop tightly around the margin action and surrounding reading context."),
        },
    ),
    make_item(
        "reading-05-progress-rhythm",
        "知识阅读",
        "阅读进度节奏",
        "用细线与段落密度提示进度，不做仪表盘。",
        "reading progress, paragraph rhythm, thin edge line",
        ["#FCFAF5", "#191917", "#D5CEC2", "#D6BD34", "#315DE6"],
        "A long-form mobile reading view with a hairline progress indicator running down one edge, changing paragraph density, one quiet section break, and a small completion marker, all on a warm bright surface with no charts.",
        {
            "style": ("Measured pacing", "Make reading progress emerge from page rhythm instead of analytics graphics."),
            "palette": ("Warm progress line", "Use a muted golden progress line with a tiny blue completion cue."),
            "scene": ("Halfway through", "Show a calm midpoint state in a substantial knowledge article."),
            "props": ("Edge progress", "Use one continuous edge hairline and a single section-break marker."),
            "character": ("No human", "Keep the long-form reading system unobstructed."),
            "format": ("Extended portrait", "Favor a very tall visual flow that communicates reading continuity."),
        },
    ),
    make_item(
        "reading-06-young-reader",
        "知识阅读",
        "年轻用户的真实阅读场景",
        "用真实使用情境验证界面气质。",
        "young Chinese reader, commuter setting, editorial mobile interface",
        ["#F5F1E9", "#1B1B1A", "#C7BDAF", "#2D62EF", "#E8D34E"],
        "A single editorial photograph of a young Chinese adult reading a bright knowledge interface on a phone during a quiet urban commute, natural daylight, relaxed focused posture, screen visible with abstract non-readable editorial rows and thin dividers.",
        {
            "style": ("Documentary realism", "Make the reader and commute feel candid, contemporary and unposed."),
            "palette": ("Natural daylight", "Use soft transit neutrals with a small blue and yellow screen accent."),
            "scene": ("Quiet commute", "Place the reader by a train window during a calm morning journey."),
            "props": ("Everyday carry", "Include only restrained everyday objects such as earphones or a canvas bag."),
            "character": ("Focused young reader", "Keep the reader nonspecific, natural and absorbed in useful content."),
            "format": ("Handheld portrait", "Frame one vertical phone-in-use moment with enough screen detail to judge the system."),
        },
        tone="natural, youthful, trustworthy editorial photography",
    ),
]


spec = {
    "meta": {
        "title": "知识获取平台 UI 视觉方向",
        "summary": "24 个非卡片式微信知识平台视觉参考，覆盖编辑索引、实时信号、频道色谱与知识阅读。",
        "audience": "面向中国泛年轻用户",
        "market": "中国",
        "channel": "微信小程序",
        "stage": "Explore",
        "itemCount": 24,
        "createdAt": "2026-07-15",
    },
    "signals": {
        "theme": "官方更新优先、精选媒体补充的年轻化知识获取平台",
        "goal": "让用户快速发现最新动态，并进一步完成可信、可追溯的知识阅读",
        "audience": "对 AI、科技、娱乐、社会、游戏和英语感兴趣的中国年轻用户",
        "brand_inputs": ["当前绿色圆角卡片系统仅作为反例，不延续"],
        "palette_direction": "明亮编辑底色；频道色只作细线、边带和状态标识；拒绝大面积渐变",
        "emotional_register": ["可信", "年轻", "清晰", "有编辑判断", "不过度刺激"],
        "must_include": ["底部主导航", "页内横向频道", "连续非卡片信息流", "来源与时间线索"],
        "visual_principles": ["留白分层", "细线分隔", "字号层级", "缩进定位", "单一频道色"],
        "avoid": ["圆角卡片堆叠", "小红书瀑布流", "传统门户密度", "金融终端", "赛博朋克", "可读假文字", "品牌 Logo"],
        "next_outputs": ["小程序页面结构", "设计 tokens", "WXML/WXSS 视觉系统"],
        "context_signals": ["官方来源优先", "精选媒体白名单", "微信移动端", "泛年轻用户"],
    },
    "items": items,
}


if __name__ == "__main__":
    OUTPUT.write_text(json.dumps(spec, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(OUTPUT), "items": len(items)}, ensure_ascii=False))
