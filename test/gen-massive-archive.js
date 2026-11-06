/* ============================================================
 * 超级大账号 Mock 数据生成器
 * 生成上万条树洞 + 几万条评论 + 几百张图片 + 几十段语音的 archive.json
 * 用于压测前端渲染 / IndexedDB / zip 导出打包
 * ============================================================ */
'use strict';

function rnd(seed) {
  // 确定性伪随机，保证每次生成的数据一致
  var s = seed || 42;
  return function () {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

var rand = rnd(20261106);

var NICKS = ['烛..', '夏如', '长安卖瓜郎', '小雪生', '北冥有鱼', '城南旧事', '深夜电台', '凌晨三点半', '风止于秋水', '一枕星河'];
var REGIONS = ['山东省', '江苏省', '陕西省', '美国', '北京市', '广东省', '四川省', '浙江省', '湖南省', '湖北省'];
var MOODS = ['开心', '平静', '疲惫', '不开心', '治愈', '倾诉'];
var TOPICS = ['深夜emo', '考研日记', '异地恋', '工作吐槽', '原生家庭', '失眠互助', '毕业焦虑', '深夜树洞', '情感倾诉', '生活碎片'];
var CONTENTS = [
  '今天又是没有睡好的一天，翻来覆去到凌晨四点，脑子里全是那些理不清的事。',
  '有时候觉得，把心事写在这里，好像就真的有一个树洞在听。',
  '好久没这么痛痛快快地哭一场了，哭完之后好像真的轻松了一点点。',
  '异地第二年了，隔着屏幕的晚安越来越像例行公事，可我还是舍不得删。',
  '考研倒计时还有47天，数学还是错一堆，但是不敢跟家里说。',
  '今天在地铁站看到一个背影像极了爸爸的人，站在原地哭了十分钟。',
  '我也不知道自己是怎么了，明明什么都没发生，就是突然觉得好累。',
  '刚刚收到一条陌生人的抱抱，突然就没那么孤单了。谢谢你们。',
  '原生家庭这四个字，压了我二十几年。今天想试着原谅，不是为了他们，是为了我自己。',
  '凌晨三点十七分，又失眠了。数到第两千三百只羊的时候，我决定来树洞坐一会儿。',
  '其实我们都知道，有些话说出来就回不去了，所以我把它们都留在了这里。',
  '今天被领导当众骂了一顿，躲在厕所里不敢出声。成年人的崩溃真的就在一瞬间。',
  '决定从今天开始记录一些微小的好事，哪怕只是今天买到了最后一瓶草莓牛奶。',
  '分手三个月了，还是会下意识地想买他喜欢的芒果，然后才想起来已经没有他了。',
  '确诊轻度抑郁第28天，今天按时吃药了，也出门晒了十分钟太阳，算是进步吧。',
];
var REPLIES = [
  '抱抱你，会好起来的',
  '我也是这样，你不是一个人',
  '加油，陌生人！',
  '看哭了，抱抱',
  '树洞一直在，我们都在',
  '早点睡，明天会好的',
  '我也经历过，懂你的感受',
  '给你一个大大的拥抱',
];

// 生成一个 SVG 图片的 Blob（模拟真实图片字节）
function fakeImageBytes(seed) {
  var r = rnd(seed);
  var hue = Math.floor(r() * 360);
  var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600">' +
    '<rect width="800" height="600" fill="hsl(' + hue + ',60%,88%)"/>' +
    '<circle cx="400" cy="300" r="120" fill="hsl(' + ((hue + 40) % 360) + ',55%,70%)"/>' +
    '<text x="400" y="320" font-size="48" text-anchor="middle" fill="hsl(' + hue + ',40%,40%)">岁岁 #' + seed + '</text>' +
    '</svg>';
  return Buffer.from(svg, 'utf8');
}

// 生成一段 fake WAV（16kHz 16bit 单声道，约 2~5 秒）
function fakeWavBytes(seed) {
  var r = rnd(seed);
  var seconds = 2 + Math.floor(r() * 3);
  var rate = 16000, dataLen = rate * seconds * 2;
  var buf = Buffer.alloc(44 + dataLen);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + dataLen, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22); buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(dataLen, 40);
  var freq = 220 + r() * 440;
  for (var i = 0; i < rate * seconds; i++) {
    var s = Math.floor(Math.sin(i / rate * freq * 2 * Math.PI) * 32767 * 0.3);
    buf.writeInt16LE(s, 44 + i * 2);
  }
  return buf;
}

function pick(arr) { return arr[Math.floor(rand() * arr.length)]; }

function genComments(treeId, count, seed) {
  var r = rnd(seed);
  var out = [];
  for (var i = 0; i < count; i++) {
    out.push({
      id: 'c' + treeId + '_' + i,
      createUid: 'u' + Math.floor(r() * 9000 + 1000),
      createUsername: pick(NICKS),
      createIcon: 'avatar_' + Math.floor(r() * 8) + '.png',
      createLevel: Math.floor(r() * 9) + 1,
      createMember: r() < 0.15 ? 1 : 0,
      createRegion: pick(REGIONS),
      createTime: '2024-' + String(Math.floor(r() * 12) + 1).padStart(2, '0') + '-' + String(Math.floor(r() * 28) + 1).padStart(2, '0') + ' ' + String(Math.floor(r() * 24)).padStart(2, '0') + ':' + String(Math.floor(r() * 60)).padStart(2, '0'),
      content: pick(REPLIES),
      likeCount: Math.floor(r() * 50),
      replyCount: r() < 0.3 ? Math.floor(r() * 4) + 1 : 0,
      subComments: []
    });
  }
  return out;
}

function genTreeItem(idx, seed) {
  var r = rnd(seed);
  var commentCount = r() < 0.7 ? Math.floor(r() * 8) + 1 : 0; // 70%有评论，最多8条
  var hasImg = r() < 0.55;
  var hasAudio = r() < 0.18;
  var imgCount = hasImg ? Math.floor(r() * 4) + 1 : 0;
  var item = {
    id: 't' + idx,
    treeHoleId: 'th' + idx,
    content: pick(CONTENTS) + (r() < 0.4 ? ' ' + pick(CONTENTS) : ''),
    createTime: '2024-' + String(Math.floor(r() * 12) + 1).padStart(2, '0') + '-' + String(Math.floor(r() * 28) + 1).padStart(2, '0') + ' ' + String(Math.floor(r() * 24)).padStart(2, '0') + ':' + String(Math.floor(r() * 60)).padStart(2, '0'),
    createRegion: pick(REGIONS),
    likeCount: Math.floor(r() * 80),
    commentsCount: commentCount,
    anonymous: r() < 0.35 ? 1 : 0,
    isTop: r() < 0.02 ? 1 : 0,
    topicTitle: r() < 0.3 ? pick(TOPICS) : '',
    imgPath: '',
    resourceType: 0,
    resourcePath: '',
    audioSecond: 0,
    createUid: 'u_mock_15318544267',
    createUsername: '烛..',
    createIcon: 'avatar_me.png',
    createLevel: 9,
    createMember: 0,
    moodName: pick(MOODS),
    comments: genComments(idx, commentCount, seed + 100000),
    _mock: true
  };
  // 生成媒体路径（模拟 COS 私有桶路径）
  var mediaBase = 'media/15318544267/';
  var imgs = [];
  for (var i = 0; i < imgCount; i++) {
    imgs.push(mediaBase + 'img_' + idx + '_' + i + '.png');
  }
  if (hasAudio) {
    item.resourceType = 2;
    item.resourcePath = mediaBase + 'voice_' + idx + '.wav';
    item.audioSecond = 2 + Math.floor(r() * 60);
    item.audio = item.resourcePath;
  } else if (imgCount > 0) {
    item.resourceType = 1;
    item.resourcePath = imgs.join(';;');
    item.imgPath = item.resourcePath;
  }
  item.images = imgs;
  return item;
}

function genProfile() {
  return {
    id: 'mock_15318544267',
    userId: 'mock_15318544267',
    uid: 'mock_15318544267',
    nickname: '烛..',
    nickName: '烛..',
    signature: '见自己',
    icon: 'avatar_me.png',
    iconUrl: 'avatar_me.png',
    avatar: 'avatar_me.png',
    region: '美国',
    regTime: '2022-08-16',
    joinTime: '2022-08-16',
    companion_days: 1542,
    userLevel: 9,
    growth_level: 9,
    followCount: 52,
    fansCount: 59,
    visitCount: 1924,
    treeholeCount: 0, // 后面填
    comfortCount: 0,
    restaurantName: '乖乖熊721383的解忧馆',
    labels: '@￥@@#@￥@@#@',  // 复现乱码标签
    homepageCover: 'media/15318544267/cover_bg.jpg',
    profileFrame: 'media/15318544267/frame_001.png',
    profileMusic: '',
    isGuardian: 0,
    betterThanPercent: 96,
    signReport: {
      totalDays: 289,
      continueDays: 12,
      betterThanPercent: 96,
      ratios: [
        { name: '开心', percent: 34, count: 98 },
        { name: '平静', percent: 41, count: 119 },
        { name: '疲惫', percent: 18, count: 52 },
        { name: '不开心', percent: 7, count: 20 }
      ]
    }
  };
}

function generate(opts) {
  opts = opts || {};
  var treeCount = opts.treeCount || 15000;
  var mediaCount = { img: 0, wav: 0 };
  var tree = [];
  for (var i = 0; i < treeCount; i++) {
    var it = genTreeItem(i, 20261106 + i);
    tree.push(it);
    mediaCount.img += it.images.length;
    if (it.resourcePath && /\.wav$/.test(it.resourcePath)) mediaCount.wav++;
  }
  var profile = genProfile();
  profile.treeholeCount = treeCount;

  var archive = {
    profile: profile,
    tree: tree,
    moods: [],
    diaries: [],
    post: { inbox: [], replied: [] },
    museum: { future: [], past: [] },
    fm: [],
    friends: [],
    chats: [],
    _meta: { treeCount: treeCount, imgCount: mediaCount.img, wavCount: mediaCount.wav }
  };

  return { archive: archive, mediaCount: mediaCount };
}

// 生成媒体文件的 Blob（用于打包测试，不真生成上万文件，按 key 缓存）
var _mediaCache = {};
function mediaBytesFor(path) {
  if (_mediaCache[path]) return _mediaCache[path];
  var seed = 0;
  var m = path.match(/(\d+)/g);
  if (m) seed = parseInt(m.join(''), 10);
  var b;
  if (/\.wav$/i.test(path)) b = fakeWavBytes(seed);
  else b = fakeImageBytes(seed);
  _mediaCache[path] = b;
  return b;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { generate: generate, mediaBytesFor: mediaBytesFor };
}
if (typeof window !== 'undefined') {
  window.SUISUI_MOCK_GEN = { generate: generate, mediaBytesFor: mediaBytesFor };
}
