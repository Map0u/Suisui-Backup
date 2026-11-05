/* 岁岁·时光纪念馆 — 演示回忆数据（「先逛逛岁岁纪念馆」加载）
 * 结构即为 archive.json 的规范结构，真实备份导出时生成同构数据。 */
window.SUISUI_DEMO_ARCHIVE = {
  meta: {
    version: 1,
    app: '岁岁·时光纪念馆',
    exported_at: '2026-11-05T12:00:00+08:00',
    motto: '不急不忙，岁岁安康'
  },
  profile: {
    nickname: '阿岁',
    suisui_id: 'SuiSui_20240101',
    sex: 'female',
    avatar: 'assets/feed/ic_avatar_default.png',
    home_bg: 'assets/mine/app_user_home_background.png',
    voice_card: { duration: 9, src: 'assets/audio/refresh_song.mp3', text: '你好呀，我是阿岁，很高兴在岁岁遇见你。' },
    stats: { follow: 12, fans: 8, friends: 5, guard: 2, visitors: 37 },
    counts: { moments: 42, favorites: 9, replies: 6 },
    join_days: 428,
    growth_level: 6,
    growth_title: 'Lv6 织梦岁',
    homepageCover: 'assets/ic_mine_home_top_bg.png',
    profileFrame: 'assets/mine/ic_vip.png',
    profileMusic: 'assets/audio/refresh_song.mp3',
    labels: ['倾听者', '夜猫子'],
    isGuardian: true,
    betterThanPercent: 86,
    signReport: {
      totalDays: 186,
      continueDays: 12,
      betterThanPercent: 86,
      ratios: [
        { name: '开心', percent: 42, count: 78 },
        { name: '平静', percent: 28, count: 52 },
        { name: '疲惫', percent: 18, count: 33 },
        { name: '不开心', percent: 12, count: 23 }
      ]
    }
  },
  moods: [
    { id: 'm1', scope: 'public', mood: 'happy', moodName: '开心', causeName: '晚霞', causeDesc: '下班路上整片晚霞铺开，心里一下子亮了。', nickname: '阿岁', sex: 'female', time: '2024-03-14 22:18', text: '今天下班路上看到一整片晚霞，像水彩泼在天上，赶紧拍下来存进岁岁。', images: [], voice: { duration: 7, src: 'assets/audio/refresh_song.mp3' }, hugs: 12, comments: [{ nickname: '星星邮差', text: '我也看到了！同一片天。', time: '22:31' }] },
    { id: 'm2', scope: 'friend',  mood: 'tired',  nickname: '阿岁', sex: 'female', time: '2024-05-02 23:47', text: '加班到十一点，回家泡了个热水脚。在这里偷偷说一句：辛苦啦，明天的自己。', images: [], voice: null, hugs: 5, locked: false, comments: [] },
    { id: 'm3', scope: 'self',    mood: 'unhappy',nickname: '阿岁', sex: 'female', time: '2024-07-19 01:12', text: '凌晨睡不着，把心事锁在这里。只有我自己看得见。', images: [], voice: null, hugs: 0, locked: true, comments: [] },
    { id: 'm4', scope: 'public',  mood: 'calm',   nickname: '阿岁', sex: 'female', time: '2025-01-01 00:05', text: '新年的第一条碎碎念：希望今年也能在岁岁和大家慢慢走完。', images: [], voice: { duration: 5, src: 'assets/audio/refresh_song.mp3' }, hugs: 21, comments: [{ nickname: '南巷', text: '岁岁安康！', time: '00:20' }, { nickname: '岛', text: '一起慢慢走。', time: '00:33' }] },
    { id: 'm5', scope: 'friend',  mood: 'happy',  nickname: '阿岁', sex: 'female', time: '2025-06-30 18:40', text: '收到了不晚邮局的回信，原来真的有人在认真读我的信。', images: [], voice: null, hugs: 8, comments: [] }
  ],
  diaries: [
    { id: 'd1', title: '晚霞手账', time: '2024-03-14 22:20', text: '把今天的晚霞贴进碎碎念。颜色很软，像被谁轻轻揉过。', images: ['assets/mood/mood_happy.png', 'assets/misc/ic_wish.png'] }
  ],
  tree: [
    { id: 't1', planet: 'emo', topStatus: 1, isMember: 1, giftCount: 3, backgroundCover: 'assets/bwg/ic_mail_top_bg.png', time: '2024-04-09 23:55', text: '在树洞扔下一颗小石头：最近总是莫名低落，希望漂到的人给我一点力气。', replies: [{ nickname: '路过的星星', text: '抱抱你，低落也是身体在提醒你该休息了。' }] },
    { id: 't2', planet: 'night', time: '2024-11-23 02:31', text: '深夜树洞：想妈妈了，但是不好意思打电话。', replies: [{ nickname: '白昼', text: '明天就打吧，她一定也在想你。' }] },
    { id: 't3', planet: 'happy', time: '2025-02-14 20:00', text: '今天一个人也过得很开心，给自己买了花。', replies: [] }
  ],
  post: {
    inbox: [
      { id: 'L1', state: 'opened', from: '不晚邮差', to: '阿岁', callName: '亲爱的自己', museumStatus: 1, stamp: 330, time: '2024-08-15', title: '一封来自陌生人的回信', body: '亲爱的阿岁：\n\n读到你上个月寄出的信，你说最近在学着自己做饭。我也曾经把厨房弄得一团糟，但现在已经能做出一碗像样的番茄鸡蛋面了。\n\n慢慢来，不晚的。把日子过成自己喜欢的样子，就很好吃。\n\n—— 不晚邮差' },
      { id: 'L2', state: 'can_open',  from: '星海',     to: '阿岁', stamp: 330, time: '2025-03-02', title: '给你的晚安', body: '阿岁你好：\n\n在信箱里捡到你的心事，忍不住回一封。愿今晚的梦是浅蓝色的，像岁岁的天空。\n\n晚安，好梦。\n\n—— 星海' },
      { id: 'L3', state: 'new',       from: '不晚邮局', to: '阿岁', stamp: 330, time: '2025-10-01', title: '你的未来信已抵达', body: '这是一封一年前你寄给未来的信，现在可以拆开啦。' }
    ],
    sent: [
      { id: 'S1', state: 'sent', from: '阿岁', to: '陌生星球', stamp: 330, time: '2024-08-01', title: '寄往夏天的一封信', body: '你好，不知道名字的朋友：\n\n今天学着做了第一顿饭，虽然有点咸，但我想把这个小小的进步寄给你。\n\n—— 阿岁' },
      { id: 'S2', state: 'sent', from: '阿岁', to: '未来的自己', stamp: 330, time: '2024-10-01', title: '寄给一年后的我', body: '未来的阿岁：\n\n不知道一年后的你有没有变得更勇敢？希望这封信抵达时，你正在笑。\n\n—— 2024 的你' }
    ],
    replied: [
      { id: 'R1', state: 'opened', from: '阿岁', to: '白昼', stamp: 330, time: '2024-12-03', title: '回信：谢谢你路过我的树洞', body: '白昼：\n\n谢谢你在树洞底下的那句「她一定也在想你」。我第二天真的打了电话，妈妈笑了很久。\n\n—— 阿岁' }
    ]
  },
  fm: [
    { id: 'f1', title: '阿岁的深夜电台 · 第 1 期', owner: '阿岁', duration: '03:27', src: 'assets/audio/notice_song.mp3', cover: 'assets/fm/fm_music.png', fav: true },
    { id: 'f2', title: '收藏的电台 · 雨声与白噪音', owner: '岁岁FM', duration: '10:00', src: 'assets/audio/refresh_song.mp3', cover: 'assets/fm/fm_radio.png', fav: true }
  ],
  museum: {
    card: {
      letter_from: '南巷',
      letter_time: '2024-09-18',
      letter_title: '关于秋天的第一场雨',
      letter_body: '阿岁：\n\n今天这里下了一整天雨，空气里全是泥土和落叶的味道。突然想起去年在岁岁写下的心愿，原来不知不觉已经走过了这么远。愿你在这个秋天，也能遇到温暖的人。',
      reply_from: '阿岁',
      reply_time: '2024-09-19',
      reply_body: '南巷：\n\n我收到了！这里也是阴天，但泡了热茶。谢谢你寄来的雨天，不管晴雨，我们在岁岁都是被挂念的。一切都不晚。'
    },
    future: [ { id: 'fu1', to: '未来的阿岁', callName: '未来的阿岁', time: '2024-10-01', arrive: '2025-10-01', majorDay: '2025-10-01', museumStatus: 1, opened: true, body: '愿一年后的你，眼里仍有光。', images: ['assets/bwg/ic_future_letter.png'], imgPath: 'assets/bwg/ic_future_letter.png', audio: 'assets/audio/refresh_song.mp3' } ],
    now: { note: '【我在岁岁的这一程】手账数据来源于本次备份统计。' },
    years: { note: '岁岁馆：这里教你把回忆永久留在手机里。' }
  },
  chats: [
    { id: 'c1', name: '星星邮差', nickname: '星星邮差', avatar: 'assets/feed/ic_avatar_default.png', last: '晚安，明天见。', time: '23:58', kind: 'match', sex: 'female', eachFollow: 1, isMember: 1,
      messages: [
        { from: 'them', type: 'text', text: '嗨，看到你也喜欢晚霞，想认识一下。', time: '2024-03-14 22:40' },
        { from: 'me',   type: 'text', text: '你好呀！今天的晚霞真的很好看。', time: '2024-03-14 22:42' },
        { from: 'me',   type: 'hug',  baobao: 1, text: '送给你一个抱抱～', time: '2024-03-14 22:43' },
        { from: 'them', type: 'voice', duration: 6, src: 'assets/audio/refresh_song.mp3', time: '2024-03-14 22:50' },
        { from: 'them', type: 'letter', title: '不晚邮局的一封信', text: '我把这封信寄给你，希望不晚。', time: '2024-03-15 21:00' },
        { from: 'them', type: 'fm', title: '深夜电台 · 雨声', src: 'assets/audio/refresh_song.mp3', time: '2024-03-15 22:10' },
        { from: 'them', type: 'text', text: '晚安，明天见。', time: '2024-03-15 23:58' }
      ] },
    { id: 'c2', name: '白昼', nickname: '白昼', avatar: 'assets/feed/ic_avatar_default.png', last: '树洞那条回复看到了吗？', time: '12:05', kind: 'friend', sex: 'male', eachFollow: 0, isMember: 0,
      messages: [
        { from: 'them', type: 'text', text: '树洞那条回复看到了吗？', time: '2024-11-24 12:05' },
        { from: 'me',   type: 'text', text: '看到了，谢谢你。', time: '2024-11-24 12:20' },
        { from: 'them', type: 'gift', title: '一颗小星星', text: '把星星别在你胸口。', time: '2024-11-24 12:21' }
      ] },
    { id: 'c3', name: '岁岁树洞群', avatar: 'assets/chat/ic_group_room.png', last: '[群聊] 今晚的月色真好', time: '01:12', kind: 'group',
      messages: [
        { from: 'them', type: 'text', text: '今晚的月色真好', time: '2025-02-14 01:12' },
        { from: 'me',   type: 'text', text: '是呀，抬头就看到。', time: '2025-02-14 01:15' }
      ] }
  ],
  notices: [
    { type: 'hug',    text: '「星星邮差」给了你一个抱抱', time: '2024-03-15' },
    { type: 'follow', text: '「白昼」开始守护你', time: '2024-11-24' },
    { type: 'letter', text: '你收到一封不晚邮局的信', time: '2025-03-02' }
  ],
  signs: [
    { date: '2024-03-14', text: '把晚霞装进口袋的人，运气都不会太差。' },
    { date: '2025-01-01', text: '新的一年，慢慢走，别急。' }
  ],
  media_index: {}
};
