export type WordCard = {
  id: string;
  word: string;
  phonetic: string;
  tag: string;
  meaning: string;
  example: string;
  scenario: string;
  mastery: number;
  level: "A1" | "A2" | "B1" | "B2" | "C1";
};

export type GrammarLesson = {
  id: string;
  title: string;
  level: "A1" | "A2" | "B1" | "B2" | "C1";
  description: string;
  examples: string[];
};

export type QuizItem = {
  id: string;
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
};

/* ─────────────── Dashboard ─────────────── */

export const dashboardMetrics = [
  { id: "today", label: "今日单词", value: 28, suffix: "", accent: "#ff8a3d" },
  { id: "streak", label: "连续打卡", value: 61, suffix: "d", accent: "#78dcc3" },
  { id: "minutes", label: "学习时长", value: 126, suffix: "m", accent: "#7d84ff" },
];

export const dashboardBursts = [
  { id: "burst-1", title: "3 min Shadowing", copy: "跟读一段职场口语，拿到 +24 XP", accent: "bg-[#ff8a3d]" },
  { id: "burst-2", title: "Weekend Slang", copy: "6 个短视频热词，今晚就能用", accent: "bg-[#78dcc3]" },
  { id: "burst-3", title: "Exam Rescue", copy: "把遗忘率最高的 12 个词拉回来", accent: "bg-[#7d84ff]" },
  { id: "burst-4", title: "Grammar Sprint", copy: "5 分钟搞定三大从句，语法不再丢分", accent: "bg-[#f2c56c]" },
];

export const dashboardTimeline = [56, 66, 84, 72, 108, 120, 142];

/* ─────────────── Learn Cards (12+ across CEFR levels) ─────────────── */

export const learnCards: WordCard[] = [
  // ── A1 · Beginner ──
  {
    id: "learn-1",
    word: "thank you",
    phonetic: "/ˈθæŋk juː/",
    tag: "basic greeting",
    meaning: "表示感谢的最基本表达",
    example: "Thank you for helping me find the station.",
    scenario: "日常礼貌 / 购物付款",
    mastery: 95,
    level: "A1",
  },
  {
    id: "learn-2",
    word: "excuse me",
    phonetic: "/ɪkˈskjuːz miː/",
    tag: "politeness",
    meaning: "打扰别人前的礼貌用语，也用于借过或引起注意",
    example: "Excuse me, could you tell me how to get to the library?",
    scenario: "问路 / 餐厅点餐 / 公共场合",
    mastery: 88,
    level: "A1",
  },
  {
    id: "learn-3",
    word: "look forward to",
    phonetic: "/lʊk ˈfɔːrwərd tuː/",
    tag: "daily use",
    meaning: "期待某事发生，后接名词或动名词",
    example: "I look forward to meeting you next week.",
    scenario: "邮件结尾 / 社交约定",
    mastery: 70,
    level: "A1",
  },

  // ── A2 · Elementary ──
  {
    id: "learn-4",
    word: "catch up",
    phonetic: "/kætʃ ʌp/",
    tag: "social",
    meaning: "赶上进度，或者和人轻松聊近况",
    example: "Let's catch up after class and talk through the new project.",
    scenario: "同学协作 / 同事寒暄",
    mastery: 53,
    level: "A2",
  },
  {
    id: "learn-5",
    word: "figure out",
    phonetic: "/ˈfɪɡjər aʊt/",
    tag: "daily use",
    meaning: "弄明白、想通，适合几乎所有日常场景",
    example: "Give me five minutes and I'll figure out another route.",
    scenario: "日常安排 / 解决问题",
    mastery: 81,
    level: "A2",
  },
  {
    id: "learn-6",
    word: "by the way",
    phonetic: "/baɪ ðə weɪ/",
    tag: "conversation filler",
    meaning: "顺便说一下，用于引出新话题或补充信息",
    example: "By the way, have you finished reading that book I lent you?",
    scenario: "日常闲聊 / 邮件补充",
    mastery: 76,
    level: "A2",
  },

  // ── B1 · Intermediate ──
  {
    id: "learn-7",
    word: "pull off",
    phonetic: "/pʊl ɔːf/",
    tag: "confidence",
    meaning: "成功做到一件原本不太容易的事",
    example: "I can't believe you pulled that presentation off on two hours of sleep.",
    scenario: "职场夸人 / 复盘项目",
    mastery: 48,
    level: "B1",
  },
  {
    id: "learn-8",
    word: "low-key",
    phonetic: "/ˌloʊ ˈkiː/",
    tag: "campus slang",
    meaning: "低调地，但也常带一点「其实很明显」的反差感",
    example: "I'm low-key obsessed with this podcast now.",
    scenario: "朋友聊天 / 社交媒体评论",
    mastery: 72,
    level: "B1",
  },
  {
    id: "learn-9",
    word: "get the hang of",
    phonetic: "/ɡɛt ðə hæŋ ʌv/",
    tag: "progress",
    meaning: "掌握窍门、逐渐熟练某件事",
    example: "It took me a while, but I finally got the hang of using chopsticks.",
    scenario: "学习新技能 / 入职适应",
    mastery: 60,
    level: "B1",
  },

  // ── B2 · Upper-Intermediate ──
  {
    id: "learn-10",
    word: "take something for granted",
    phonetic: "/teɪk ... fɔːr ˈɡræntɪd/",
    tag: "reflection",
    meaning: "把某事视为理所当然，直到失去才意识到其价值",
    example: "We often take clean water for granted until there's a shortage.",
    scenario: "议论文写作 / 深度谈话",
    mastery: 35,
    level: "B2",
  },
  {
    id: "learn-11",
    word: "the bottom line",
    phonetic: "/ðə ˈbɑːtəm laɪn/",
    tag: "business",
    meaning: "最终结论、最重要的一点（源自财务的「底线」概念）",
    example: "The bottom line is that we need to cut costs by 15% this quarter.",
    scenario: "商务会议 / 汇报总结",
    mastery: 42,
    level: "B2",
  },
  {
    id: "learn-12",
    word: "a blessing in disguise",
    phonetic: "/ə ˈblɛsɪŋ ɪn dɪsˈɡaɪz/",
    tag: "idiom",
    meaning: "因祸得福，看似不幸实际上是好事",
    example: "Losing that job turned out to be a blessing in disguise — I found my true passion.",
    scenario: "聊人生经历 / 安慰朋友",
    mastery: 30,
    level: "B2",
  },

  // ── C1 · Advanced ──
  {
    id: "learn-13",
    word: "nuance",
    phonetic: "/ˈnuːɑːns/",
    tag: "academic",
    meaning: "微妙的差异、细微之处，常用于学术或深入讨论",
    example: "There are important nuances in this policy that we need to address.",
    scenario: "学术论文 / 政策分析",
    mastery: 22,
    level: "C1",
  },
  {
    id: "learn-14",
    word: "devil's advocate",
    phonetic: "/ˈdɛvəlz ˈædvəkət/",
    tag: "debate",
    meaning: "故意唱反调的人（为了让讨论更全面）",
    example: "Let me play devil's advocate here — what if the data is misleading?",
    scenario: "会议讨论 / 辩论赛",
    mastery: 28,
    level: "C1",
  },
  {
    id: "learn-15",
    word: "unprecedented",
    phonetic: "/ʌnˈprɛsɪdɛntɪd/",
    tag: "formal",
    meaning: "史无前例的、前所未有的",
    example: "The pandemic created unprecedented challenges for the global economy.",
    scenario: "新闻报道 / 学术写作",
    mastery: 18,
    level: "C1",
  },
];

/* ─────────────── Battle ─────────────── */

export const battleLeaderboard = [
  { id: "rank-1", name: "Mia", score: 1420, streak: 19, accent: "#ff8a3d" },
  { id: "rank-2", name: "You", score: 1368, streak: 16, accent: "#78dcc3" },
  { id: "rank-3", name: "Ethan", score: 1312, streak: 14, accent: "#7d84ff" },
  { id: "rank-4", name: "Sophie", score: 1280, streak: 12, accent: "#f2c56c" },
  { id: "rank-5", name: "Leo", score: 1245, streak: 10, accent: "#ff7258" },
];

export const battleChallenges = [
  {
    id: "challenge-1",
    title: "好友快问快答",
    copy: "60 秒内回答 10 个高频表达，看谁更快更稳。",
    reward: "+80 XP",
  },
  {
    id: "challenge-2",
    title: "地铁口语冲刺",
    copy: "通勤 5 分钟专属 battle，适合今天只剩碎片时间的时候。",
    reward: "+56 XP",
  },
  {
    id: "challenge-3",
    title: "成语大师赛",
    copy: "看中文成语选对应英文 idiom，限时 90 秒。",
    reward: "+100 XP",
  },
  {
    id: "challenge-4",
    title: "听力极速挑战",
    copy: "听句子填空，训练你的耳朵和反应速度。",
    reward: "+72 XP",
  },
];

/* ─────────────── Discover Feed (6+ items, diverse categories) ─────────────── */

export const discoverFeed = [
  {
    id: "discover-1",
    category: "Campus Vlog",
    title: "被教授点名时，怎么自然争取一点思考时间",
    quote: "\"Let me think for a second.\"",
    caption: "比起机械地说 Wait，更自然也更不尴尬。",
    meta: "12.4k learners watched",
  },
  {
    id: "discover-2",
    category: "Office Talk",
    title: "老板临时改需求，别再只会说 okay",
    quote: "\"Got it, I'll rework the flow and send an updated draft.\"",
    caption: "保留执行力，也把你的专业感立住。",
    meta: "8.9k learners watched",
  },
  {
    id: "discover-3",
    category: "Pop Culture",
    title: "短视频评论区常见的 low-key / high-key 到底怎么用",
    quote: "\"I'm high-key impressed.\"",
    caption: "轻松口语里最容易听懂却最难用对的一组词。",
    meta: "15.7k learners watched",
  },
  {
    id: "discover-4",
    category: "Travel Survival",
    title: "入住酒店时前台最常问的 5 句话",
    quote: "\"Do you have a reservation under your name?\"",
    caption: "搞懂 check-in 流程，出国住酒店不再手忙脚乱。",
    meta: "9.3k learners watched",
  },
  {
    id: "discover-5",
    category: "Interview Prep",
    title: "英文面试如何回答「你最大的缺点是什么」",
    quote: "\"I tend to be overly detail-oriented, but I've learned to prioritize.\"",
    caption: "把弱点转化为优势的经典面试策略。",
    meta: "21.6k learners watched",
  },
  {
    id: "discover-6",
    category: "Movie Lines",
    title: "五部经典电影里的地道表达，看完就能用",
    quote: "\"You had me at hello.\" — Jerry Maguire",
    caption: "看电影学英语，语感提升最快的方法。",
    meta: "18.2k learners watched",
  },
  {
    id: "discover-7",
    category: "Email Writing",
    title: "英文邮件开头除了 Dear 还能怎么写",
    quote: "\"I hope this message finds you well.\"",
    caption: "职场邮件的语气拿捏，从第一句开始。",
    meta: "11.1k learners watched",
  },
  {
    id: "discover-8",
    category: "Daily Life",
    title: "去咖啡店点单，老外到底在说什么",
    quote: "\"Can I get a grande oat milk latte with an extra shot?\"",
    caption: "从 size 到 customize，一次搞懂咖啡店英语。",
    meta: "14.5k learners watched",
  },
];

/* ─────────────── Profile ─────────────── */

export const profileBadges = [
  { id: "badge-1", title: "Night Owl", copy: "连续 7 天夜间学习", tint: "from-[#7d84ff] to-[#a4a8ff]" },
  { id: "badge-2", title: "Social Speaker", copy: "完成 20 次口语对战", tint: "from-[#78dcc3] to-[#acecdd]" },
  { id: "badge-3", title: "Streak Boss", copy: "连续打卡超过 50 天", tint: "from-[#ff8a3d] to-[#ff7258]" },
  { id: "badge-4", title: "Clip Hunter", copy: "收藏 40 条短视频表达", tint: "from-[#f2c56c] to-[#ff9d52]" },
  { id: "badge-5", title: "Grammar Guru", copy: "完成全部语法课程", tint: "from-[#a78bfa] to-[#c4b5fd]" },
  { id: "badge-6", title: "Quiz Master", copy: "每日测验连续满分 7 天", tint: "from-[#34d399] to-[#6ee7b7]" },
];

export const profileBars = [
  { id: "listen", label: "Listening", value: 78, accent: "#78dcc3" },
  { id: "speak", label: "Speaking", value: 65, accent: "#ff8a3d" },
  { id: "read", label: "Reading", value: 84, accent: "#7d84ff" },
  { id: "write", label: "Writing", value: 58, accent: "#f2c56c" },
];

/* ─────────────── CEFR Levels ─────────────── */

export const levels = [
  {
    id: "A1",
    name: "A1 · 入门",
    description: "能理解并使用日常基础表达，如问候、自我介绍和简单购物。",
    wordCount: 500,
    color: "#78dcc3",
  },
  {
    id: "A2",
    name: "A2 · 基础",
    description: "能处理简单的日常任务，如描述个人背景、购物和问路。",
    wordCount: 1000,
    color: "#7d84ff",
  },
  {
    id: "B1",
    name: "B1 · 中级",
    description: "能应对旅行、工作中常见的场景，能描述经历和计划。",
    wordCount: 2000,
    color: "#f2c56c",
  },
  {
    id: "B2",
    name: "B2 · 中高级",
    description: "能流畅自然地交流，能理解复杂文本的主旨并参与深度讨论。",
    wordCount: 4000,
    color: "#ff8a3d",
  },
  {
    id: "C1",
    name: "C1 · 高级",
    description: "能在学术和职业环境中灵活使用英语，理解含蓄和抽象的表达。",
    wordCount: 8000,
    color: "#ff7258",
  },
];

/* ─────────────── Grammar Lessons ─────────────── */

export const grammarLessons: GrammarLesson[] = [
  {
    id: "grammar-1",
    title: "Be 动词的基本用法",
    level: "A1",
    description: "学习 am / is / are 在不同人称中的使用，奠定英语句型基础。",
    examples: [
      "I am a student.",
      "She is from Japan.",
      "They are my best friends.",
      "It is a beautiful day.",
    ],
  },
  {
    id: "grammar-2",
    title: "一般现在时 vs 现在进行时",
    level: "A2",
    description: "区分习惯性动作和正在发生的动作，掌握时态选择的直觉。",
    examples: [
      "I drink coffee every morning. (习惯)",
      "I am drinking coffee right now. (正在进行)",
      "She works at a bank. (职业)",
      "She is working from home today. (临时状态)",
    ],
  },
  {
    id: "grammar-3",
    title: "现在完成时：经历与结果",
    level: "B1",
    description: "用 have/has + 过去分词描述过去经历对现在的影响，区分 ever/never/already/yet。",
    examples: [
      "I have visited Paris three times.",
      "She has never tried sushi before.",
      "We have already finished the report.",
      "Have you seen the latest episode yet?",
    ],
  },
  {
    id: "grammar-4",
    title: "定语从句：who / which / that",
    level: "B1",
    description: "用关系代词连接两个句子，让表达更丰富、更精确。",
    examples: [
      "The person who called you is my manager.",
      "The book that I recommended is on the shelf.",
      "This is the café which has the best espresso in town.",
      "She's the colleague who helped me with the project.",
    ],
  },
  {
    id: "grammar-5",
    title: "虚拟语气：If I were…",
    level: "B2",
    description: "表达与现实相反的假设，让你的口语和写作更高级。",
    examples: [
      "If I were you, I would accept the offer.",
      "If she had studied harder, she would have passed the exam.",
      "I wish I were taller.",
      "If we had left earlier, we wouldn't have missed the train.",
    ],
  },
  {
    id: "grammar-6",
    title: "被动语态的高级运用",
    level: "B2",
    description: "掌握被动语态在正式写作、新闻和学术语境中的使用技巧。",
    examples: [
      "The report was submitted ahead of schedule.",
      "New regulations are being considered by the committee.",
      "The issue should have been addressed earlier.",
      "It is widely believed that remote work improves productivity.",
    ],
  },
  {
    id: "grammar-7",
    title: "倒装句与强调结构",
    level: "C1",
    description: "使用倒装和 cleft sentence 增强语句的表现力，提升写作水平。",
    examples: [
      "Not only did she finish on time, but she also exceeded expectations.",
      "Rarely have I seen such a well-organized event.",
      "It was the CEO who made the final decision.",
      "What I really need is a good night's sleep.",
    ],
  },
  {
    id: "grammar-8",
    title: "名词性从句与间接引语",
    level: "C1",
    description: "灵活使用 that 从句、wh- 从句和间接引语转述他人观点。",
    examples: [
      "She mentioned that she would be late for the meeting.",
      "What he said surprised everyone in the room.",
      "The question is whether we can meet the deadline.",
      "He asked me if I had ever been to London.",
    ],
  },
];

/* ─────────────── Daily Quizzes ─────────────── */

export const dailyQuizzes: QuizItem[] = [
  {
    id: "quiz-1",
    question: "\"I'm looking forward ___ you.\" 横线处应填什么？",
    options: ["to see", "to seeing", "seeing", "see"],
    correctIndex: 1,
    explanation: "look forward to 中的 to 是介词，后面接动名词（-ing 形式），所以正确答案是 to seeing。",
  },
  {
    id: "quiz-2",
    question: "\"Could you ___ me a favor?\" 横线处应填什么？",
    options: ["make", "do", "give", "take"],
    correctIndex: 1,
    explanation: "do someone a favor 是固定搭配，意为'帮某人一个忙'。虽然 give 也能搭配，但 do 是最地道的用法。",
  },
  {
    id: "quiz-3",
    question: "\"She ___ here since 2019.\" 横线处应填什么？",
    options: ["works", "worked", "has worked", "is working"],
    correctIndex: 2,
    explanation: "since 2019 表示从过去某个时间持续到现在，需要用现在完成时 has worked。",
  },
  {
    id: "quiz-4",
    question: "\"a blessing in disguise\" 是什么意思？",
    options: ["伪装的祝福", "因祸得福", "虚假的承诺", "隐藏的宝藏"],
    correctIndex: 1,
    explanation: "a blessing in disguise 意为'因祸得福'——表面看起来是坏事，最后却变成了好事。",
  },
  {
    id: "quiz-5",
    question: "以下哪个句子语法正确？",
    options: [
      "If I was you, I will go.",
      "If I were you, I would go.",
      "If I am you, I would go.",
      "If I were you, I will go.",
    ],
    correctIndex: 1,
    explanation: "虚拟语气中，与现在事实相反的假设用 were（不分人称），主句用 would + 动词原形。",
  },
  {
    id: "quiz-6",
    question: "\"pull off\" 在口语中最常见的意思是什么？",
    options: ["拉下来", "取消", "成功做到", "出发"],
    correctIndex: 2,
    explanation: "pull off 在口语中常指'成功做到一件不容易的事'，如 She pulled off an amazing presentation.",
  },
  {
    id: "quiz-7",
    question: "\"I ___ to the gym three times a week.\" 横线处应填什么？",
    options: ["go", "am going", "have gone", "went"],
    correctIndex: 0,
    explanation: "three times a week 表示经常性动作，用一般现在时 go。",
  },
  {
    id: "quiz-8",
    question: "\"Not only ___ the project, but she also won an award.\" 横线处应填什么？",
    options: ["she finished", "did she finish", "she did finish", "finished she"],
    correctIndex: 1,
    explanation: "Not only 放在句首时，主句需要用部分倒装（助动词 + 主语 + 动词），所以是 did she finish。",
  },
  {
    id: "quiz-9",
    question: "\"The report needs ___ before Friday.\" 横线处应填什么？",
    options: ["to finish", "finishing", "to be finished", "finished"],
    correctIndex: 2,
    explanation: "报告是被完成的（被动），need + to be done 或 need + doing 都可以，但 to be finished 更正式标准。",
  },
  {
    id: "quiz-10",
    question: "\"Let me play devil's advocate\" 这句话的意思是？",
    options: ["让我为魔鬼辩护", "让我故意唱个反调", "让我当个坏人", "让我替你说话"],
    correctIndex: 1,
    explanation: "play devil's advocate 意为'故意唱反调'，目的是让讨论更全面、考虑更周到，并非真的反对。",
  },
];
