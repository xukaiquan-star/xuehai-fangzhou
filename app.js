/* ==========================================
   学海方舟 - 核心应用逻辑
   app.js
   ========================================== */

// ===== 全局状态 =====
const APP = {
  dark: false,
  currentPage: 'home',
  timerInterval: null,
  timerSec: 0,
  timerRunning: false,
  pomoInterval: null,
  pomoSec: 25 * 60,
  pomoRunning: false,
  pomoPhase: 'work', // work | break
  pomoCount: 0,
  immerseInterval: null,
  immerseSec: 0,
  immerseRunning: false,
  immerseDuration: 50,
  noiseCtx: null,
  noiseSource: null,
  currentMood: null,
};

// =========================================
//  登录管理器
// =========================================
const LoginManager = {
  _currentUser: null,
  _loginMode: 'login', // 'login' | 'register'

  init() {
    const session = sessionStorage.getItem('ark_session');
    if(session) {
      try { this._currentUser = JSON.parse(session).username; }
      catch(e) { sessionStorage.removeItem('ark_session'); }
    }
  },

  register(username, password) {
    if(!username || username.trim().length < 1)
      return { success: false, msg: '请输入昵称' };
    if(!/^\d{4}$/.test(password))
      return { success: false, msg: '密码必须是 4 位数字' };
    const users = JSON.parse(localStorage.getItem('ark_users') || '[]');
    if(users.find(u => u.username === username))
      return { success: false, msg: '该昵称已被注册' };
    users.push({ username, password, created: Date.now() });
    localStorage.setItem('ark_users', JSON.stringify(users));
    return { success: true };
  },

  login(username, password) {
    const users = JSON.parse(localStorage.getItem('ark_users') || '[]');
    const user = users.find(u => u.username === username);
    if(!user) return { success: false, msg: '该昵称尚未注册' };
    if(user.password !== password) return { success: false, msg: '密码错误' };
    this._currentUser = username;
    sessionStorage.setItem('ark_session', JSON.stringify({ username, loginTime: Date.now() }));
    this._migrateData(username);
    this._recordLogin(username);
    return { success: true };
  },

  loginAsGuest() {
    this._currentUser = 'guest';
    sessionStorage.setItem('ark_session', JSON.stringify({ username: 'guest', loginTime: Date.now() }));
    this._migrateData('guest');
    return { success: true };
  },

  logout() {
    this._currentUser = null;
    sessionStorage.removeItem('ark_session');
  },

  getCurrentUser() {
    if(this._currentUser) return this._currentUser;
    const session = sessionStorage.getItem('ark_session');
    if(session) {
      try { this._currentUser = JSON.parse(session).username; return this._currentUser; }
      catch(e) { return null; }
    }
    return null;
  },

  isGuest() { return this.getCurrentUser() === 'guest'; },

  _migrateData(username) {
    const keys = ['gtd_tasks','q1','q2','q3','q4','wrong_cards','daily_reviews',
      'immerse_records','immerse_theme','xp','skills','dark','wrong_review_correct'];
    keys.forEach(k => {
      const oldK = 'ark_' + k, newK = 'ark_' + username + '_' + k;
      if(localStorage.getItem(newK) === null && localStorage.getItem(oldK) !== null)
        localStorage.setItem(newK, localStorage.getItem(oldK));
    });
  },

  _recordLogin(username) {
    const today = new Date().toLocaleDateString('zh-CN');
    const key = 'ark_' + username + '_';
    const lastLogin = JSON.parse(localStorage.getItem(key + 'last_login_date') || '""');
    const loginDays = JSON.parse(localStorage.getItem(key + 'login_days') || '0');

    if(lastLogin !== today) {
      const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
      const newDays = (lastLogin === yesterday.toLocaleDateString('zh-CN')) ? loginDays + 1
                    : (lastLogin === '' ? 1 : 1);
      localStorage.setItem(key + 'login_days', JSON.stringify(newDays));
      localStorage.setItem(key + 'last_login_date', JSON.stringify(today));
      if([3,7,14,30].includes(newDays))
        setTimeout(() => toast(`🎉 连续登录 ${newDays} 天！解锁专属成就！`, 4000), 1200);
    }
  },

  getLoginDays() {
    const u = this.getCurrentUser(); if(!u) return 0;
    return JSON.parse(localStorage.getItem('ark_' + u + '_login_days') || '0');
  }
};
LoginManager.init();

// =========================================
//  AI 助手（Puter.js）
// =========================================
const AIAssistant = {
  async ask(prompt, model) {
    try {
      if(typeof puter === 'undefined' || !puter.ai) throw new Error('Puter not ready');
      const opts = model ? { model } : {};
      const resp = await puter.ai.chat(prompt, opts);
      let text = '';
      if(typeof resp === 'string') text = resp;
      else if(resp && resp.message) text = resp.message;
      else if(resp && resp.content) text = resp.content;
      else if(resp && resp.text) text = resp.text;
      else text = String(resp || '');
      return text.trim();
    } catch(e) {
      console.warn('AI call failed:', e);
      return null;
    }
  },

  async polishInsight(text) {
    const prompt = `请把这段学习感悟改写成一段更有感染力、更简洁的文字，保留原意，字数不超过50字。只输出改写后的文字，不要加任何解释或引号。原文：${text}`;
    return await this.ask(prompt, 'openai/gpt-5.5');
  },

  async recommendTheme() {
    const records = load('immerse_records', []);
    const kws = records.slice(-5).flatMap(r => r.keywords || []);
    if(kws.length === 0) {
      const d = ['数学思维训练','英语阅读突破','科学实验探究'];
      return d[Math.floor(Math.random()*d.length)];
    }
    const prompt = `根据以下学习关键词，推荐1个适合小学生的新学习主题（用中文，不超过10个字）。只输出主题名称，不要加解释。关键词：${kws.join('、')}`;
    const result = await this.ask(prompt, 'openai/gpt-5.5');
    if(result) return result.replace(/["'""''「」\n]/g, '').trim().slice(0, 15);
    const d = ['数学思维训练','英语阅读突破','科学实验探究'];
    return d[Math.floor(Math.random()*d.length)];
  }
};

// ===== 数据持久化（多用户隔离） =====
function save(key, val) {
  const u = LoginManager.getCurrentUser();
  const prefix = u ? u + '_' : '';
  localStorage.setItem('ark_' + prefix + key, JSON.stringify(val));
}
function load(key, def) {
  const u = LoginManager.getCurrentUser();
  const prefix = u ? u + '_' : '';
  try { const v = localStorage.getItem('ark_' + prefix + key); return v ? JSON.parse(v) : def; }
  catch(e) { return def; }
}

// ===== Toast =====
function toast(msg, dur = 2200) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), dur);
}

// ===== 封面 & 入场 =====
function enterApp() {
  const cover = document.getElementById('cover-page');
  cover.style.transition = 'opacity 0.8s ease';
  cover.style.opacity = '0';
  setTimeout(() => {
    cover.style.display = 'none';
    document.getElementById('main-app').style.display = 'block';
    updateUserMenu();
    showPage('home');
    refreshQuote();
    initHeatmap();
    initGardenXP();
  }, 800);
}

function showCover() {
  const cover = document.getElementById('cover-page');
  cover.style.display = 'flex';
  cover.style.opacity = '1';
}

// ===== 封面海洋画布 =====
(function initOcean() {
  const canvas = document.getElementById('ocean-canvas');
  const ctx = canvas.getContext('2d');
  let W, H, waves = [], stars = [];

  function resize() {
    W = canvas.width = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener('resize', resize);

  // 星星
  for(let i = 0; i < 120; i++) {
    stars.push({ x: Math.random(), y: Math.random() * 0.55, r: Math.random() * 1.5 + 0.5, a: Math.random() });
  }

  // 波浪参数
  waves = [
    { amp: 18, freq: 0.012, speed: 0.02, phase: 0, color: 'rgba(30,100,180,0.25)', y: 0.72 },
    { amp: 14, freq: 0.018, speed: 0.03, phase: 1, color: 'rgba(40,120,200,0.3)',  y: 0.76 },
    { amp: 12, freq: 0.022, speed: 0.04, phase: 2, color: 'rgba(60,150,220,0.35)', y: 0.80 },
    { amp: 10, freq: 0.028, speed: 0.05, phase: 3, color: 'rgba(80,170,230,0.4)',  y: 0.85 },
  ];

  function drawStars(t) {
    stars.forEach(s => {
      const alpha = 0.4 + 0.6 * Math.abs(Math.sin(t * 0.0008 + s.a * 10));
      ctx.beginPath();
      ctx.arc(s.x * W, s.y * H, s.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,255,255,${alpha})`;
      ctx.fill();
    });
  }

  function drawWave(w, t) {
    ctx.beginPath();
    ctx.moveTo(0, H);
    for(let x = 0; x <= W; x += 4) {
      const y = w.y * H + Math.sin(x * w.freq + w.phase + t * w.speed) * w.amp
                        + Math.sin(x * w.freq * 1.7 + w.phase * 2 + t * w.speed * 0.7) * (w.amp * 0.4);
      ctx.lineTo(x, y);
    }
    ctx.lineTo(W, H); ctx.closePath();
    ctx.fillStyle = w.color; ctx.fill();
  }

  // 气泡
  const bubbleContainer = document.getElementById('cover-bubbles');
  for(let i = 0; i < 20; i++) {
    const b = document.createElement('div');
    b.className = 'bubble';
    const size = 20 + Math.random() * 60;
    b.style.cssText = `
      width:${size}px; height:${size}px;
      left:${Math.random()*100}%;
      animation-duration:${6+Math.random()*10}s;
      animation-delay:${Math.random()*8}s;
    `;
    bubbleContainer.appendChild(b);
  }

  let t = 0;
  function draw() {
    ctx.clearRect(0, 0, W, H);
    drawStars(t);
    waves.forEach(w => drawWave(w, t));
    t++;
    requestAnimationFrame(draw);
  }
  draw();
})();

// ===== 正计时 =====
function timerToggle() {
  APP.timerRunning = !APP.timerRunning;
  document.getElementById('timer-btn').textContent = APP.timerRunning ? '⏸' : '▶';
  if(APP.timerRunning) {
    APP.timerInterval = setInterval(() => {
      APP.timerSec++;
      updateTimerDisplay();
    }, 1000);
  } else {
    clearInterval(APP.timerInterval);
  }
}
function timerReset() {
  clearInterval(APP.timerInterval);
  APP.timerRunning = false; APP.timerSec = 0;
  document.getElementById('timer-btn').textContent = '▶';
  updateTimerDisplay();
}
function updateTimerDisplay() {
  const h = Math.floor(APP.timerSec / 3600);
  const m = Math.floor((APP.timerSec % 3600) / 60);
  const s = APP.timerSec % 60;
  document.getElementById('timer-display').textContent =
    `${pad(h)}:${pad(m)}:${pad(s)}`;
}

// ===== 番茄钟 (顶栏) =====
function pomoToggle() {
  APP.pomoRunning = !APP.pomoRunning;
  const topBtn = document.getElementById('pomo-btn');
  if(topBtn) topBtn.textContent = APP.pomoRunning ? '⏸' : '▶';
  if(APP.pomoRunning) {
    APP.pomoInterval = setInterval(tickPomo, 1000);
  } else {
    clearInterval(APP.pomoInterval);
  }
  syncPomoBigBtn();
}
function pomoReset() {
  clearInterval(APP.pomoInterval);
  APP.pomoRunning = false;
  APP.pomoSec = 25 * 60;
  APP.pomoPhase = 'work';
  document.getElementById('pomo-btn').textContent = '▶';
  updatePomoDisplay();
  updatePomoBig();
}
function tickPomo() {
  APP.pomoSec--;
  if(APP.pomoSec <= 0) {
    if(APP.pomoPhase === 'work') {
      APP.pomoCount++;
      document.getElementById('pomo-count').textContent = APP.pomoCount;
      APP.pomoPhase = 'break';
      APP.pomoSec = 5 * 60;
      toast('🍅 番茄完成！休息5分钟～');
      playBell();
      updateXP(10);
      updateRiverMarks();
    } else {
      APP.pomoPhase = 'work';
      APP.pomoSec = 25 * 60;
      toast('☀️ 休息结束，继续专注！');
    }
  }
  updatePomoDisplay();
  updatePomoBig();
}
function updatePomoDisplay() {
  const m = Math.floor(APP.pomoSec / 60);
  const s = APP.pomoSec % 60;
  document.getElementById('pomo-display').textContent = `${pad(m)}:${pad(s)}`;
}
function updatePomoBig() {
  const el = document.getElementById('pomo-big-time');
  if(el) {
    const m = Math.floor(APP.pomoSec / 60);
    const s = APP.pomoSec % 60;
    el.textContent = `${pad(m)}:${pad(s)}`;
    // 更新圆圈进度
    const total = APP.pomoPhase === 'work' ? 25*60 : 5*60;
    const progress = (total - APP.pomoSec) / total;
    const circ = document.getElementById('pomo-circle-fg');
    if(circ) {
      const r = 54;
      const len = 2 * Math.PI * r;
      circ.style.strokeDasharray = len;
      circ.style.strokeDashoffset = len * (1 - progress);
    }
    const phaseEl = document.getElementById('pomo-phase-label');
    if(phaseEl) phaseEl.textContent = APP.pomoPhase === 'work' ? '🍅 专注时间' : '☕ 休息时间';
  }
}

// ===== 白噪音（纯前端 Web Audio API 生成，无需外部音频文件） =====
let noiseCtx = null;
let noiseNodes = null; // { source, gain, filter, lfo }
const NOISE_NAMES = { rain: '🌧 雨声', wave: '🌊 海浪', wind: '💨 风声' };

function getNoiseCtx() {
  if(!noiseCtx) {
    try { noiseCtx = new (window.AudioContext || window.webkitAudioContext)(); }
    catch(e) { return null; }
  }
  // 浏览器可能 suspend 了 context，需要 resume
  if(noiseCtx.state === 'suspended') noiseCtx.resume();
  return noiseCtx;
}

// 生成一段噪声 buffer（white noise 基底）
function createNoiseBuffer(ctx, type) {
  const len = ctx.sampleRate * 4; // 4秒循环
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  if(type === 'rain') {
    // 白噪声 + 轻微高频增强
    for(let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * 0.5;
  } else if(type === 'wave') {
    // 棕色噪声（低频更重，模拟海浪）
    let last = 0;
    for(let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      data[i] = last * 3;
    }
  } else { // wind: 粉红噪声（介于白和棕之间）
    let b0=0,b1=0,b2=0,b3=0,b4=0,b5=0,b6=0;
    for(let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886*b0 + w*0.0555179;
      b1 = 0.99332*b1 + w*0.0750759;
      b2 = 0.96900*b2 + w*0.1538520;
      b3 = 0.86650*b3 + w*0.3104856;
      b4 = 0.55000*b4 + w*0.5329522;
      b5 = -0.7616*b5 - w*0.0168980;
      data[i] = (b0+b1+b2+b3+b4+b5+b6+w*0.5362) * 0.11;
      b6 = w * 0.115926;
    }
  }
  return buf;
}

function playNoise(type) {
  // 停掉之前的
  stopNoise();
  const ctx = getNoiseCtx();
  if(!ctx) { toast('⚠️ 浏览器不支持音频播放'); return; }

  const buf = createNoiseBuffer(ctx, type);
  const source = ctx.createBufferSource();
  source.buffer = buf; source.loop = true;

  // 主增益
  const gain = ctx.createGain();
  gain.gain.value = 0;

  // 滤波器，模拟不同环境音
  const filter = ctx.createBiquadFilter();
  if(type === 'rain') {
    filter.type = 'bandpass'; filter.frequency.value = 2400; filter.Q.value = 0.5;
  } else if(type === 'wave') {
    filter.type = 'lowpass'; filter.frequency.value = 600;
  } else {
    filter.type = 'lowpass'; filter.frequency.value = 900;
  }

  // 海浪型：用 LFO 调制音量模拟潮汐
  let lfo = null, lfoGain = null;
  if(type === 'wave') {
    lfo = ctx.createOscillator();
    lfo.frequency.value = 0.12; // 慢周期
    lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.18;
    lfo.connect(lfoGain); lfoGain.connect(gain.gain);
    lfo.start();
  }

  source.connect(filter); filter.connect(gain); gain.connect(ctx.destination);
  source.start();

  // 淡入
  gain.gain.setValueAtTime(0, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(type === 'rain' ? 0.35 : type === 'wave' ? 0.5 : 0.3, ctx.currentTime + 0.5);

  noiseNodes = { source, gain, filter, lfo, lfoGain };
  document.getElementById('noise-label').textContent = NOISE_NAMES[type];
}

function stopNoise() {
  if(noiseNodes) {
    const ctx = noiseCtx;
    try {
      if(noiseNodes.gain) {
        noiseNodes.gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.3);
      }
      if(noiseNodes.source) setTimeout(() => { try{noiseNodes.source.stop();}catch(e){} }, 350);
      if(noiseNodes.lfo)   setTimeout(() => { try{noiseNodes.lfo.stop();}catch(e){} }, 350);
    } catch(e) {}
    noiseNodes = null;
  }
  document.getElementById('noise-label').textContent = '已关闭';
}

// ===== 提示音 =====
function playBell() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.value = 880;
    osc.type = 'sine';
    gain.gain.setValueAtTime(0.5, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.5);
    osc.start(); osc.stop(ctx.currentTime + 1.5);
  } catch(e) {}
}

// ===== 金句 =====
const QUOTES = [
  '不积跬步，无以至千里。——荀子',
  '学而不思则罔，思而不学则殆。——孔子',
  '书是人类进步的阶梯。——高尔基',
  '知识就是力量。——培根',
  '读书破万卷，下笔如有神。——杜甫',
  '业精于勤，荒于嬉。——韩愈',
  '天才是百分之一的灵感加百分之九十九的汗水。——爱迪生',
  '学习是灯，勤奋是油，不勤奋则灯不亮。',
  '每学到一点新知识，就是迈向成功的一小步。',
  '今日的努力，是明日骄傲的资本。',
  '好奇心是知识的摇篮。',
  '专注是最好的天赋，坚持是最长的捷径。',
  '把每一次学习都当作一次远航，风浪越大，收获越多。',
  '知行合一，学以致用。——王阳明',
  '温故而知新，可以为师矣。——孔子',
];
function refreshQuote() {
  const q = QUOTES[Math.floor(Math.random() * QUOTES.length)];
  document.getElementById('daily-quote').textContent = q;
}

// ===== 暗黑模式 =====
function toggleDark() {
  APP.dark = !APP.dark;
  document.body.classList.toggle('dark', APP.dark);
  document.getElementById('dark-btn').textContent = APP.dark ? '☀️' : '🌙';
  save('dark', APP.dark);
}

// ===== 导航 =====
function showPage(name) {
  APP.currentPage = name;
  // 更新 nav active
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.page === name);
  });
  // 同步移动端Tab
  document.querySelectorAll('.mobile-tab').forEach(el => {
    el.classList.toggle('active', el.dataset.mtab === name);
  });
  const mc = document.getElementById('main-content');
  mc.innerHTML = '';
  mc.className = 'main-content fade-in';
  // 移动端加底部padding
  if(window.innerWidth <= 900) mc.classList.add('has-mobile-tabs');
  const builders = {
    home: buildHomePage,
    zhixing: buildZhixingPage,
    mingjing: buildMingjingPage,
    modi: buildModiPage,
    wrongbook: buildWrongbookPage,
    review: buildReviewPage,
    knowledge: buildKnowledgePage,
    garden: buildGardenPage,
    stats: buildStatsPage,
    achievements: buildAchievementsPage,
  };
  if(builders[name]) builders[name](mc);
  // 更新番茄钟大面板
  if(name === 'zhixing') { setTimeout(updatePomoBig, 50); }
  // 初始化心流全屏星星
  if(name === 'modi') { setTimeout(initFlowStars, 100); }
  // 初始化知识图谱Canvas
  if(name === 'knowledge') { setTimeout(initKnowledgeGraph, 200); }
  // 初始化滑动分拣
  if(name === 'zhixing') { setTimeout(initSwipeSort, 300); }
  // 初始化河流时间轴
  if(name === 'zhixing') { setTimeout(initRiverTimeline, 150); }
}

const pad = n => String(n).padStart(2, '0');

// =========================================
//  天气系统
// =========================================
function calcWeather() {
  const reviews = load('daily_reviews', []);
  const immerses = load('immerse_records', []);
  const tasks = load('gtd_tasks', []);
  const today = new Date();
  let totalActivity = 0;
  let daysActive = 0;
  for(let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const ds = d.toLocaleDateString('zh-CN');
    const hasReview = reviews.some(r => r.date === ds);
    const immCount = immerses.filter(r => r.date === ds).length;
    const tskCount = tasks.filter(t => t.created === ds).length;
    const dayScore = (hasReview ? 3 : 0) + immCount * 2 + tskCount;
    if(dayScore > 0) daysActive++;
    totalActivity += dayScore;
  }
  const doneTasks = tasks.filter(t => t.done).length;
  totalActivity += doneTasks;

  if(daysActive >= 6 && totalActivity >= 15) {
    return { icon:'☀️', label:'晴空万里', advice:'学习状态正佳，适合挑战难题和深度沉浸！' };
  } else if(daysActive >= 4) {
    return { icon:'⛅', label:'多云转晴', advice:'状态不错，保持节奏，四象限法帮你分清轻重缓急～' };
  } else if(daysActive >= 2) {
    return { icon:'🌧️', label:'细雨绵绵', advice:'雨天适合记忆类任务和错题复习，启动番茄钟吧！' };
  } else {
    return { icon:'⛈️', label:'风暴来袭', advice:'最近学习时间偏少，从一个小番茄开始重新出发吧！' };
  }
}

// =========================================
//  首页
// =========================================
function buildHomePage(mc) {
  const gtdTasks = load('gtd_tasks', []);
  const quadTasks = { q1: load('q1', []), q2: load('q2', []), q3: load('q3', []), q4: load('q4', []) };
  const totalQ = Object.values(quadTasks).reduce((a, b) => a + b.length, 0);
  const wrongs = load('wrong_cards', []);
  const hour = new Date().getHours();
  const greeting = hour < 6 ? '夜深了' : hour < 10 ? '早上好' : hour < 14 ? '上午好' : hour < 18 ? '下午好' : '晚上好';
  const weather = calcWeather();

  // 个性化问候
  const currentUser = LoginManager.getCurrentUser();
  const isGuest = LoginManager.isGuest();
  const displayName = isGuest ? '小航海家' : currentUser + '船长';
  const loginDays = LoginManager.getLoginDays();

  // 今日待复习错题
  const today = new Date().toLocaleDateString('zh-CN');
  const dueWrongs = wrongs.filter(c => {
    if(!c.nextReview) return false;
    const nr = new Date(c.nextReview);
    return nr.toLocaleDateString('zh-CN') === today || nr <= new Date();
  });

  mc.innerHTML = `
    <div class="home-greeting">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:0.8rem;">
        <div>
          <div class="greeting-main">${greeting}，${displayName}！⚓</div>
          <div class="greeting-sub">${loginDays > 0 ? `今天是你的第 ${loginDays} 次航行，继续探索知识海域吧～` : '今天也是扬帆起航的好日子，让我们开始学习之旅吧～'}</div>
        </div>
        <div class="weather-widget">
          <span class="weather-icon">${weather.icon}</span>
          <div>
            <div style="font-weight:700;">${weather.label}</div>
            <div class="weather-advice">${weather.advice}</div>
          </div>
        </div>
      </div>
      ${dueWrongs.length > 0 ? `
      <div style="margin-top:1rem;padding:10px 14px;background:rgba(239,68,68,0.12);border-radius:12px;font-size:0.82rem;display:flex;align-items:center;gap:8px;">
        <span>📕</span> 今日有 <strong style="color:#fca5a5;">${dueWrongs.length}</strong> 道错题待复习，去<a style="color:#fca5a5;cursor:pointer;text-decoration:underline;" onclick="showPage('wrongbook')">错题本</a>看看吧！
      </div>` : ''}
    </div>
    <div class="home-stats">
      <div class="stat-card">
        <div class="stat-num">${APP.pomoCount}</div>
        <div class="stat-label">🍅 今日番茄</div>
      </div>
      <div class="stat-card">
        <div class="stat-num">${gtdTasks.length}</div>
        <div class="stat-label">📋 任务收集</div>
      </div>
      <div class="stat-card">
        <div class="stat-num">${totalQ}</div>
        <div class="stat-label">🪞 四象限任务</div>
      </div>
      <div class="stat-card">
        <div class="stat-num">${wrongs.length}</div>
        <div class="stat-label">📕 错题记录</div>
      </div>
    </div>
    <div class="section-title">🚀 选择你的计划引擎</div>
    <div class="engine-cards">
      <div class="engine-card zhixing" onclick="showPage('zhixing')">
        <div class="engine-icon">⏰</div>
        <div class="engine-name">知行·番茄流</div>
        <div class="engine-tagline">GTD宏观管控 × 番茄钟微观执行<br>战略与战术的完美结合</div>
        <div class="engine-tags">
          <span class="engine-tag">GTD工作法</span>
          <span class="engine-tag">番茄钟25+5</span>
          <span class="engine-tag">任务拆解</span>
          <span class="engine-tag">周回顾</span>
        </div>
      </div>
      <div class="engine-card mingjing" onclick="showPage('mingjing')">
        <div class="engine-icon">🪞</div>
        <div class="engine-name">明镜·四象限流</div>
        <div class="engine-tagline">四象限筛选"学什么"<br>费曼学习法确保"真学会"</div>
        <div class="engine-tags">
          <span class="engine-tag">艾森豪威尔矩阵</span>
          <span class="engine-tag">费曼学习法</span>
          <span class="engine-tag">优先级管理</span>
        </div>
      </div>
      <div class="engine-card modi" onclick="showPage('modi')">
        <div class="engine-icon">💧</div>
        <div class="engine-name">墨滴·沉浸流</div>
        <div class="engine-tagline">心流触发 × 主题式深度学习<br>让知识如墨滴般自然晕染</div>
        <div class="engine-tags">
          <span class="engine-tag">心流状态</span>
          <span class="engine-tag">主题式学习</span>
          <span class="engine-tag">知识图谱</span>
        </div>
      </div>
    </div>
  `;
}

// =========================================
//  知行·番茄流
// =========================================
function buildZhixingPage(mc) {
  const tasks = load('gtd_tasks', []);

  mc.innerHTML = `
    <div class="page-title">⏰ 知行·番茄流 <span class="badge">GTD + 番茄钟</span></div>
    <div class="zhixing-layout">
      <div>
        <!-- GTD收集箱 -->
        <div class="card" style="margin-bottom:1rem;">
          <div class="section-title">📥 GTD 收集箱</div>
          <div class="inbox-input-row">
            <input class="inbox-input" id="gtd-input" placeholder="把脑海里所有任务都扔进来…" onkeydown="if(event.key==='Enter')addGTDTask()">
            <select id="gtd-subject" style="border:1px solid var(--border-color);border-radius:8px;padding:0 10px;background:var(--bg-body);color:var(--text-primary);font-size:0.85rem;">
              <option value="数学">数学</option>
              <option value="语文">语文</option>
              <option value="英语">英语</option>
              <option value="科学">科学</option>
              <option value="其他">其他</option>
            </select>
            <input type="number" id="gtd-pomo" placeholder="🍅数" min="1" max="10" style="width:70px;border:1px solid var(--border-color);border-radius:8px;padding:0 8px;background:var(--bg-body);color:var(--text-primary);">
            <button class="btn-primary" onclick="addGTDTask()">+ 加入</button>
          </div>
          <div class="task-list" id="gtd-task-list"></div>
        </div>

        <!-- GTD四步骤 -->
        <div class="card">
          <div class="section-title">📋 GTD 四步工作法</div>
          <div class="gtd-steps">
            <div class="gtd-step active">
              <div class="step-num">1</div>
              <div class="step-text"><div class="step-title">📥 收集与清空</div>将所有任务、想法、待办事项扔进收集箱，让大脑从记忆负担中解放</div>
            </div>
            <div class="gtd-step">
              <div class="step-num">2</div>
              <div class="step-text"><div class="step-title">✂️ 整理与拆解</div>把模糊的想法拆解为可执行的下一步（如"复习第三章"→"做前5道课后题"）</div>
            </div>
            <div class="gtd-step">
              <div class="step-num">3</div>
              <div class="step-text"><div class="step-title">🍅 执行与专注</div>从任务库挑选高优先级，分配番茄钟，启动后屏蔽一切干扰</div>
            </div>
            <div class="gtd-step">
              <div class="step-num">4</div>
              <div class="step-text"><div class="step-title">🔄 回顾与复盘</div>每周固定时间回顾完成情况、清理已完成、重新评估优先级</div>
            </div>
          </div>
        </div>
      </div>

      <!-- 番茄钟大面板 -->
      <div class="pomo-panel">
        <div class="card pomo-big-timer">
          <div class="pomo-phase-label" id="pomo-phase-label">🍅 专注时间</div>
          <div class="pomo-circle-wrap">
            <svg class="pomo-svg" viewBox="0 0 120 120">
              <circle class="pomo-circle-bg" cx="60" cy="60" r="54"/>
              <circle class="pomo-circle-fg" id="pomo-circle-fg" cx="60" cy="60" r="54"
                stroke-dasharray="339.3" stroke-dashoffset="339.3"/>
            </svg>
            <div class="pomo-inner-time" id="pomo-big-time">25:00</div>
          </div>
          <div class="pomo-ctrl-row">
            <button class="pomo-btn primary" onclick="pomoToggle()" id="pomo-big-btn">▶ 开始</button>
            <button class="pomo-btn secondary" onclick="pomoReset()">↺ 重置</button>
          </div>
          <div style="margin-top:1rem;font-size:0.85rem;opacity:0.7;">
            已完成番茄：<span style="color:#f97316;font-weight:800;" id="pomo-done-count">0</span> 🍅
          </div>
        </div>

        <div class="card">
          <div class="section-title">📊 今日番茄统计</div>
          <div style="display:flex;gap:0.6rem;flex-wrap:wrap;" id="pomo-record-row">
            <span style="font-size:0.8rem;color:var(--text-secondary);">暂无记录，快开始第一个番茄吧！</span>
          </div>
        </div>
      </div>
    </div>
  `;

  renderGTDTasks();
  updatePomoBig();
  syncPomoBigBtn();
}

function addGTDTask() {
  const input = document.getElementById('gtd-input');
  const text = input.value.trim();
  if(!text) { toast('请输入任务内容'); return; }
  const tasks = load('gtd_tasks', []);
  tasks.unshift({
    id: Date.now(),
    text,
    subject: document.getElementById('gtd-subject').value,
    pomo: parseInt(document.getElementById('gtd-pomo').value) || 1,
    done: false,
    created: new Date().toLocaleDateString('zh-CN'),
  });
  save('gtd_tasks', tasks);
  input.value = '';
  renderGTDTasks();
  toast('✅ 任务已加入收集箱');
  updateXP(3);
}

function renderGTDTasks() {
  const tasks = load('gtd_tasks', []);
  const list = document.getElementById('gtd-task-list');
  if(!list) return;
  if(!tasks.length) { list.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-secondary);font-size:0.85rem;">收集箱还是空的，把待办事项都扔进来吧～</div>'; return; }
  list.innerHTML = tasks.map((t, i) => `
    <div class="task-item ${t.done ? 'done-item' : ''}">
      <div class="task-check ${t.done ? 'done' : ''}" onclick="toggleGTDTask(${i})">${t.done ? '✓' : ''}</div>
      <div class="task-text ${t.done ? 'done' : ''}">${t.text}</div>
      <span class="task-subject">${t.subject}</span>
      <span class="task-pomo-badge">🍅×${t.pomo}</span>
      <button class="task-del" onclick="deleteGTDTask(${i})">✕</button>
    </div>
  `).join('');
}

function toggleGTDTask(i) {
  const tasks = load('gtd_tasks', []);
  tasks[i].done = !tasks[i].done;
  save('gtd_tasks', tasks);
  if(tasks[i].done) { updateXP(15); toast('🎉 任务完成！获得15XP'); }
  renderGTDTasks();
}

function deleteGTDTask(i) {
  const tasks = load('gtd_tasks', []);
  tasks.splice(i, 1);
  save('gtd_tasks', tasks);
  renderGTDTasks();
}

// ===== GTD 滑动分拣（移动端） =====
function initSwipeSort() {
  const list = document.getElementById('gtd-task-list');
  if(!list || window.innerWidth > 900) return;
  const items = list.querySelectorAll('.task-item');
  items.forEach((item, i) => {
    let startX = 0, startY = 0, swiped = false;
    item.addEventListener('touchstart', e => {
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      swiped = false;
    }, {passive: true});
    item.addEventListener('touchmove', e => {
      const dx = e.touches[0].clientX - startX;
      const dy = e.touches[0].clientY - startY;
      if(Math.abs(dx) > 20 || Math.abs(dy) > 20) swiped = true;
    }, {passive: true});
    item.addEventListener('touchend', e => {
      if(!swiped) return;
      const dx = e.changedTouches[0].clientX - startX;
      const dy = e.changedTouches[0].clientY - startY;
      const tasks = load('gtd_tasks', []);
      if(!tasks[i]) return;
      const task = {...tasks[i]};
      tasks.splice(i, 1);
      save('gtd_tasks', tasks);

      if(Math.abs(dx) > Math.abs(dy)) {
        // 水平滑动：重要/不重要
        if(dx > 50) {
          // 右滑 → 重要 → Q2（重要不紧急）
          const q2 = load('q2', []);
          q2.push({ text: task.text, subject: task.subject, id: Date.now() });
          save('q2', q2);
          toast('👉 已移至「重要不紧急」象限');
        } else if(dx < -50) {
          // 左滑 → 不重要 → Q4
          const q4 = load('q4', []);
          q4.push({ text: task.text, subject: task.subject, id: Date.now() });
          save('q4', q4);
          toast('👈 已移至「不重要」象限');
        }
      } else {
        // 垂直滑动：紧急/不紧急
        if(dy < -40) {
          // 上滑 → 紧急 → Q1
          const q1 = load('q1', []);
          q1.push({ text: task.text, subject: task.subject, id: Date.now() });
          save('q1', q1);
          toast('👆 已移至「重要且紧急」象限');
        } else if(dy > 40) {
          // 下滑 → 不紧急 → Q3
          const q3 = load('q3', []);
          q3.push({ text: task.text, subject: task.subject, id: Date.now() });
          save('q3', q3);
          toast('👇 已移至「紧急不重要」象限');
        }
      }
      renderGTDTasks();
    });
  });
}

function syncPomoBigBtn() {
  const btn = document.getElementById('pomo-big-btn');
  if(btn) btn.textContent = APP.pomoRunning ? '⏸ 暂停' : '▶ 开始';
  const cnt = document.getElementById('pomo-done-count');
  if(cnt) cnt.textContent = APP.pomoCount;
}

// ===== 河流时间轴 =====
function initRiverTimeline() {
  const panel = document.querySelector('.pomo-panel');
  if(!panel) return;
  // 在番茄面板下方插入河流
  const riverHTML = `
    <div class="card" style="margin-top:1rem;">
      <div class="section-title">🌊 时间河流</div>
      <svg class="river-svg" viewBox="0 0 300 140" id="river-svg">
        <defs>
          <linearGradient id="riverGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#3b82f6" stop-opacity="0.15"/>
            <stop offset="100%" stop-color="#1e40af" stop-opacity="0.35"/>
          </linearGradient>
        </defs>
        <!-- 河岸 -->
        <path d="M0,60 Q50,45 100,55 Q150,65 200,50 Q250,40 300,55 L300,140 L0,140Z" fill="url(#riverGrad)"/>
        <path d="M0,65 Q60,50 120,60 Q180,70 240,55 Q280,48 300,55" fill="none" stroke="rgba(59,130,246,0.4)" stroke-width="1.5"/>
        <path d="M0,75 Q50,65 110,70 Q170,78 230,68 Q270,62 300,68" fill="none" stroke="rgba(59,130,246,0.2)" stroke-width="1"/>
        <!-- 小船 -->
        <g id="river-boat-group">
          <text x="150" y="58" font-size="18" text-anchor="middle">
            <animateMotion dur="10s" repeatCount="indefinite" path="M20,60 Q80,40 140,55 Q200,70 260,50 Q290,45 300,55"></animateMotion>
            ⛵
          </text>
        </g>
        <!-- 时间标记 -->
        ${[0,25,50,75,100].map((p, i) => {
          const h = 8 + Math.floor(p / 25);
          return `<text x="${3 + p * 0.97 * 3}" y="${h < 12 ? 88 : 95}" font-size="6" fill="rgba(255,255,255,0.25)" text-anchor="middle">${h}:00</text>`;
        }).join('')}
        <!-- 番茄标记 -->
        <g id="pomo-river-marks"></g>
      </svg>
      <div style="text-align:center;font-size:0.72rem;color:var(--text-secondary);margin-top:0.5rem;">
        ⛵ 每个番茄都是一段航程，小船随专注时间在河流上前行
      </div>
    </div>
  `;
  panel.insertAdjacentHTML('beforeend', riverHTML);
  updateRiverMarks();
}

function updateRiverMarks() {
  const marks = document.getElementById('pomo-river-marks');
  if(!marks) return;
  const count = Math.min(APP.pomoCount, 20);
  marks.innerHTML = Array.from({length: count}, (_, i) => {
    const x = 10 + (i * 14);
    return `<circle cx="${x}" cy="90" r="3" fill="#f97316" opacity="${0.3 + i * 0.03}"><animate attributeName="opacity" values="${0.3 + i * 0.03};${0.6 + i * 0.02};${0.3 + i * 0.03}" dur="2s" repeatCount="indefinite"/></circle>`;
  }).join('');
}

// =========================================
//  明镜·四象限流
// =========================================
function buildMingjingPage(mc) {
  mc.innerHTML = `
    <div class="page-title">🪞 明镜·四象限流 <span class="badge">四象限 + 费曼学习</span></div>
    <div class="quadrant-grid">
      ${buildQuadrant('q1', '⚡ 第一象限', '重要且紧急', '立即执行！')}
      ${buildQuadrant('q2', '🌟 第二象限', '重要不紧急', '重点排期')}
      ${buildQuadrant('q3', '⚙️ 第三象限', '紧急不重要', '委派或快处理')}
      ${buildQuadrant('q4', '🗑 第四象限', '不紧急不重要', '果断剔除')}
    </div>
    <div class="feynman-panel">
      <div class="card">
        <div class="section-title">🧠 费曼学习法 · 深度内化（针对第二象限核心知识）</div>
        <div class="feynman-steps">
          <div class="feynman-step" onclick="openFeynmanStep(1)">
            <div class="feynman-icon">📖</div>
            <div class="feynman-name">① 选择概念</div>
            <div class="feynman-desc">选定一个要彻底掌握的知识点或概念</div>
          </div>
          <div class="feynman-step" onclick="openFeynmanStep(2)">
            <div class="feynman-icon">👩‍🏫</div>
            <div class="feynman-name">② 用大白话"教"</div>
            <div class="feynman-desc">想象向一个完全不懂的人解释，用最通俗的语言讲清楚</div>
          </div>
          <div class="feynman-step" onclick="openFeynmanStep(3)">
            <div class="feynman-icon">🔍</div>
            <div class="feynman-name">③ 发现盲点</div>
            <div class="feynman-desc">在"教"的过程中找到自己讲不清楚的地方，那就是知识盲点</div>
          </div>
          <div class="feynman-step" onclick="openFeynmanStep(4)">
            <div class="feynman-icon">✨</div>
            <div class="feynman-name">④ 简化回顾</div>
            <div class="feynman-desc">回头重新学习盲点，简化表达，直到能用大白话讲清楚</div>
          </div>
        </div>
      </div>
    </div>
  `;
  ['q1','q2','q3','q4'].forEach(renderQuadrantTasks);
}

function buildQuadrant(qid, title, sub, action) {
  const colors = { q1: 'red', q2: 'green', q3: 'yellow', q4: 'gray' };
  const labels = { q1: '⚡ 立即做', q2: '📅 计划做', q3: '👐 委派做', q4: '🗑 不必做' };
  return `
    <div class="quadrant ${qid}" id="quad-${qid}"
      ondragover="event.preventDefault()" ondrop="dropToQuad('${qid}',event)">
      <div class="q-header">
        <div>
          <div class="q-title">${title}</div>
          <div style="font-size:0.72rem;color:var(--text-secondary);">${sub}</div>
        </div>
        <span class="q-badge">${labels[qid]}</span>
      </div>
      <div class="q-tasks" id="qtasks-${qid}"></div>
      <div class="q-add-row">
        <input class="q-input" id="qi-${qid}" placeholder="${action}" onkeydown="if(event.key==='Enter')addQuadTask('${qid}')">
        <button class="q-add-btn" onclick="addQuadTask('${qid}')">+</button>
      </div>
    </div>
  `;
}

function renderQuadrantTasks(qid) {
  const tasks = load(qid, []);
  const container = document.getElementById('qtasks-' + qid);
  if(!container) return;
  if(!tasks.length) {
    container.innerHTML = `<div style="text-align:center;padding:1rem;color:var(--text-secondary);font-size:0.78rem;opacity:0.6;">暂无任务</div>`;
    return;
  }
  container.innerHTML = tasks.map((t, i) => `
    <div class="q-task" draggable="true" ondragstart="dragTask('${qid}',${i},event)">
      <span style="font-size:0.9rem;">${getQuadEmoji(qid)}</span>
      <span style="flex:1;">${t.text}</span>
      <span style="font-size:0.7rem;color:var(--text-secondary);">${t.subject||''}</span>
      <button class="q-task-del" onclick="deleteQuadTask('${qid}',${i})">✕</button>
    </div>
  `).join('');
}

function getQuadEmoji(q) {
  return { q1: '🔴', q2: '🟢', q3: '🟡', q4: '⚪' }[q];
}

function addQuadTask(qid) {
  const input = document.getElementById('qi-' + qid);
  const text = input.value.trim();
  if(!text) return;
  const tasks = load(qid, []);
  tasks.push({ text, subject: '', id: Date.now() });
  save(qid, tasks);
  input.value = '';
  renderQuadrantTasks(qid);
  updateXP(5);
  toast('✅ 已加入' + { q1:'第一', q2:'第二', q3:'第三', q4:'第四' }[qid] + '象限');
}

function deleteQuadTask(qid, i) {
  const tasks = load(qid, []);
  tasks.splice(i, 1);
  save(qid, tasks);
  renderQuadrantTasks(qid);
}

let dragSrc = null;
function dragTask(qid, i, e) { dragSrc = { qid, i }; e.dataTransfer.effectAllowed = 'move'; }
function dropToQuad(targetQ, e) {
  if(!dragSrc || dragSrc.qid === targetQ) return;
  const srcTasks = load(dragSrc.qid, []);
  const task = srcTasks.splice(dragSrc.i, 1)[0];
  save(dragSrc.qid, srcTasks);
  const tgtTasks = load(targetQ, []);
  tgtTasks.push(task);
  save(targetQ, tgtTasks);
  ['q1','q2','q3','q4'].forEach(renderQuadrantTasks);
  toast(`↗ 任务已移至${['','第一','第二','第三','第四'][parseInt(targetQ[1])]}象限`);
  dragSrc = null;
}

function openFeynmanStep(n) {
  const tips = [
    '', 
    '📖 第一步：选一个今天学到的核心概念，写在复盘页里',
    '👩‍🏫 第二步：合上书本，用大白话"教"给虚拟小朋友听，试试在复盘框里写出来',
    '🔍 第三步：你是不是有某些地方卡住了？那就是盲点！标记出来',
    '✨ 第四步：重新翻书补充盲点，再次简化，直到讲得清晰流畅',
  ];
  toast(tips[n]);
}

// =========================================
//  墨滴·沉浸流
// =========================================
function buildModiPage(mc) {
  const records = load('immerse_records', []);

  mc.innerHTML = `
    <div class="page-title">💧 墨滴·沉浸流 <span class="badge">心流触发 + 主题式学习</span></div>
    <div class="modi-layout">
      <div class="immerse-panel">
        <!-- 主题锚定 -->
        <div class="theme-anchor-card">
          <div class="theme-label">🗺 第一步 · 主题锚定</div>
          <input class="theme-input" id="immerse-theme" placeholder="输入本次学习主题（如：分数加减法、古诗背诵…）" value="${load('immerse_theme', '')}">
          <button class="btn-ai" style="margin-top:0.5rem;width:100%;" onclick="aiRecommendTheme(event)">🧠 AI 推荐主题</button>
          <div style="margin-top:0.8rem;display:flex;gap:0.6rem;flex-wrap:wrap;">
            ${['数学探索', '语文品读', '英语对话', '科学实验', '历史探秘'].map(t =>
              `<button onclick="setTheme('${t}')" style="background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);border-radius:20px;padding:4px 12px;color:rgba(255,255,255,0.7);font-size:0.75rem;cursor:pointer;">${t}</button>`
            ).join('')}
          </div>
        </div>

        <!-- 沉浸计时器 -->
        <div class="immerse-timer-card">
          <div class="immerse-phase">💧 沉浸心流中</div>
          <div class="immerse-time" id="immerse-time-display">00:00</div>
          <div style="margin:0.5rem 0;font-size:0.75rem;opacity:0.5;">推荐时长（分钟）</div>
          <div class="immerse-duration-row">
            ${[45, 60, 75, 90].map(d =>
              `<button class="dur-btn ${APP.immerseDuration===d?'active':''}" onclick="setImmerseDur(${d})">${d}min</button>`
            ).join('')}
          </div>
          <div class="immerse-btns" style="margin-top:1rem;">
            <button class="immerse-btn start" onclick="immerseToggle()" id="immerse-btn">▶ 开始沉浸</button>
            <button class="immerse-btn stop" onclick="immerseReset()">↺ 重置</button>
          </div>
          <button class="btn-primary" style="width:100%;margin-top:0.6rem;background:linear-gradient(135deg,#8b5cf6,#6d28d9);" onclick="enterFlowFullscreen()">🌌 全屏心流模式</button>
          <div style="margin-top:1rem;font-size:0.8rem;opacity:0.5;" id="immerse-goal-label">
            目标：${APP.immerseDuration} 分钟沉浸
          </div>
        </div>

        <!-- 四步指引 -->
        <div class="card">
          <div class="section-title">🌊 沉浸四步走</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.6rem;">
            ${[
              ['🗺','主题锚定','选择有深度的学习主题，而非零散知识点'],
              ['🔐','环境封印','关通知 · 准备好资料 · 创造不被打断的空间'],
              ['🌊','心流冲刺','以任务块为单位，完成后再休息，45-90分钟灵活调'],
              ['🕸','主题串联','结束后3-5分钟，记录关键词和知识关联'],
            ].map(([icon, name, desc]) => `
              <div style="padding:0.8rem;background:var(--bg-body);border-radius:8px;border:1px solid var(--border-color);">
                <div style="font-size:1.3rem;margin-bottom:0.3rem;">${icon}</div>
                <div style="font-size:0.82rem;font-weight:700;margin-bottom:0.2rem;">${name}</div>
                <div style="font-size:0.72rem;color:var(--text-secondary);">${desc}</div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>

      <!-- 知识串联面板 -->
      <div>
        <div class="card" style="margin-bottom:1rem;">
          <div class="section-title">🕸 本次知识串联</div>
          <textarea id="immerse-keywords-input" class="review-textarea" style="height:80px;" placeholder="输入本次学习关键词（用逗号分隔）…"></textarea>
          <textarea id="immerse-notes-input" class="review-textarea" style="height:80px;margin-top:0.5rem;" placeholder="记录知识关联和新发现…"></textarea>
          <button class="btn-primary" style="width:100%;margin-top:0.5rem;" onclick="saveImmerseRecord()">💾 保存本次沉浸</button>
        </div>

        <div class="card">
          <div class="section-title">📜 沉浸历史</div>
          <div class="flow-records" id="immerse-records">
            ${records.length ? records.slice(-6).reverse().map(r => `
              <div class="flow-record">
                <div class="flow-time">${r.date}<br>${r.duration}分钟</div>
                <div class="flow-content">
                  <div style="font-weight:600;font-size:0.82rem;">${r.theme}</div>
                  <div style="font-size:0.78rem;color:var(--text-secondary);margin-top:2px;">${r.notes}</div>
                  <div class="flow-keywords">${(r.keywords||[]).map(k=>`<span class="flow-kw">${k}</span>`).join('')}</div>
                </div>
              </div>
            `).join('') : '<div style="text-align:center;padding:1rem;color:var(--text-secondary);font-size:0.82rem;">还没有沉浸记录，开始你的第一次深度学习吧！</div>'}
          </div>
        </div>
      </div>
    </div>
  `;
  updateImmerseDisplay();
}

function setTheme(t) {
  document.getElementById('immerse-theme').value = t;
  save('immerse_theme', t);
}

function setImmerseDur(d) {
  APP.immerseDuration = d;
  document.querySelectorAll('.dur-btn').forEach(b => b.classList.toggle('active', b.textContent.trim() === d + 'min'));
  const lbl = document.getElementById('immerse-goal-label');
  if(lbl) lbl.textContent = '目标：' + d + ' 分钟沉浸';
}

function immerseToggle() {
  APP.immerseRunning = !APP.immerseRunning;
  const btn = document.getElementById('immerse-btn');
  if(btn) btn.textContent = APP.immerseRunning ? '⏸ 暂停' : '▶ 继续';
  if(APP.immerseRunning) {
    APP.immerseInterval = setInterval(() => {
      APP.immerseSec++;
      updateImmerseDisplay();
      if(APP.immerseSec >= APP.immerseDuration * 60) {
        immerseReset();
        toast('🎉 沉浸完成！请花3-5分钟串联知识～', 4000);
        playBell();
        updateXP(30);
      }
    }, 1000);
  } else {
    clearInterval(APP.immerseInterval);
  }
}

function immerseReset() {
  clearInterval(APP.immerseInterval);
  APP.immerseRunning = false; APP.immerseSec = 0;
  const btn = document.getElementById('immerse-btn');
  if(btn) btn.textContent = '▶ 开始沉浸';
  updateImmerseDisplay();
}

function updateImmerseDisplay() {
  const el = document.getElementById('immerse-time-display');
  const fsEl = document.getElementById('flow-fs-time');
  const m = Math.floor(APP.immerseSec / 60);
  const s = APP.immerseSec % 60;
  const timeStr = `${pad(m)}:${pad(s)}`;
  if(el) {
    el.textContent = timeStr;
    if(APP.immerseSec >= APP.immerseDuration * 60) el.style.color = '#34d399';
    else el.style.color = '';
  }
  if(fsEl) {
    fsEl.textContent = timeStr;
  }
}

// ===== 全屏心流模式 =====
let flowFsExitTimer = null;
function initFlowStars() {
  const container = document.getElementById('flow-fs-stars');
  if(!container || container.children.length > 0) return;
  for(let i = 0; i < 80; i++) {
    const star = document.createElement('div');
    star.className = 'flow-fs-star';
    star.style.left = Math.random() * 100 + '%';
    star.style.top = Math.random() * 100 + '%';
    star.style.animationDelay = Math.random() * 3 + 's';
    star.style.animationDuration = (2 + Math.random() * 4) + 's';
    star.style.width = star.style.height = (1 + Math.random() * 2.5) + 'px';
    container.appendChild(star);
  }
}

function enterFlowFullscreen() {
  const fs = document.getElementById('flow-fullscreen');
  if(!fs) return;
  fs.classList.add('active');
  updateImmerseDisplay();
  // 尝试浏览器全屏
  try { document.documentElement.requestFullscreen?.() || document.documentElement.webkitRequestFullscreen?.(); } catch(e) {}

  // 长按退出：mouse/touch
  let pressTimer;
  const onDown = () => {
    pressTimer = setTimeout(() => { exitFlowFullscreen(); }, 800);
  };
  const onUp = () => { clearTimeout(pressTimer); };
  fs.addEventListener('mousedown', onDown);
  fs.addEventListener('mouseup', onUp);
  fs.addEventListener('touchstart', onDown, {passive:true});
  fs.addEventListener('touchend', onUp);
  fs._exitHandlers = { onDown, onUp };

  // ESC键退出
  const onKey = (e) => { if(e.key === 'Escape') exitFlowFullscreen(); };
  document.addEventListener('keydown', onKey);
  fs._keyHandler = onKey;

  // 更新计时器到全屏
  flowFsExitTimer = setInterval(() => {
    document.getElementById('flow-fs-time').textContent =
      `${pad(Math.floor(APP.immerseSec/60))}:${pad(APP.immerseSec%60)}`;
  }, 1000);
}

function exitFlowFullscreen() {
  const fs = document.getElementById('flow-fullscreen');
  if(!fs) return;
  fs.classList.remove('active');
  clearInterval(flowFsExitTimer);
  if(fs._keyHandler) { document.removeEventListener('keydown', fs._keyHandler); }
  if(fs._exitHandlers) {
    fs.removeEventListener('mousedown', fs._exitHandlers.onDown);
    fs.removeEventListener('mouseup', fs._exitHandlers.onUp);
    fs.removeEventListener('touchstart', fs._exitHandlers.onDown);
    fs.removeEventListener('touchend', fs._exitHandlers.onUp);
  }
  try { document.exitFullscreen?.() || document.webkitExitFullscreen?.(); } catch(e) {}
}

function saveImmerseRecord() {
  const theme = document.getElementById('immerse-theme').value.trim() || '未命名主题';
  const kw = document.getElementById('immerse-keywords-input').value;
  const notes = document.getElementById('immerse-notes-input').value.trim();
  const keywords = kw.split(/[,，\s]+/).filter(Boolean);
  const records = load('immerse_records', []);
  records.push({
    theme, keywords, notes,
    duration: Math.floor(APP.immerseSec / 60) || APP.immerseDuration,
    date: new Date().toLocaleDateString('zh-CN'),
  });
  save('immerse_records', records);
  save('immerse_theme', theme);
  toast('✅ 沉浸记录已保存！');
  updateXP(10);
  buildModiPage(document.getElementById('main-content'));
}

// =========================================
//  错题本
// =========================================
function buildWrongbookPage(mc) {
  const cards = load('wrong_cards', []);
  mc.innerHTML = `
    <div class="page-title">📕 错题本 <span class="badge">SRS 间隔复习</span></div>
    <div class="card" style="margin-bottom:1.25rem;">
      <div class="section-title">➕ 添加错题</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.8rem;margin-bottom:0.8rem;">
        <input class="inbox-input" id="wq-q" placeholder="错题题目…">
        <input class="inbox-input" id="wq-a" placeholder="正确答案…">
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.8rem;margin-bottom:0.8rem;">
        <input class="inbox-input" id="wq-note" placeholder="错误原因 / 学习笔记…">
        <select id="wq-sub" style="border:1px solid var(--border-color);border-radius:8px;padding:0 12px;background:var(--bg-body);color:var(--text-primary);">
          <option value="math">数学</option>
          <option value="chinese">语文</option>
          <option value="english">英语</option>
          <option value="science">科学</option>
        </select>
      </div>
      <button class="btn-primary" onclick="addWrongCard()">📌 收录错题</button>
    </div>
    <div class="wrong-book-grid" id="wrong-grid">
      ${cards.length ? cards.map((c, i) => buildWrongCardHTML(c, i)).join('') :
        '<div style="grid-column:1/-1;text-align:center;padding:3rem;color:var(--text-secondary);">还没有错题记录，遇到难题就收录进来吧～</div>'}
    </div>
  `;
}

function buildWrongCardHTML(c, i) {
  const subNames = { math: '数学', chinese: '语文', english: '英语', science: '科学' };
  const nextDate = c.nextReview || '今天';
  return `
    <div class="wrong-card ${c.subject}" id="wc-${i}">
      <span class="wrong-subject">${subNames[c.subject] || c.subject}</span>
      <div class="wrong-question">${c.question}</div>
      <div class="wrong-answer">✓ ${c.answer}</div>
      ${c.note ? `<div class="wrong-note">💡 ${c.note}</div>` : ''}
      <div class="wrong-review-date">📅 下次复习：${nextDate}</div>
      <div style="display:flex;gap:0.4rem;margin-top:0.8rem;">
        <button onclick="reviewWrong(${i},'forget')" style="flex:1;padding:5px;border:1px solid #ef4444;border-radius:6px;background:none;color:#ef4444;cursor:pointer;font-size:0.75rem;">❌ 忘了</button>
        <button onclick="reviewWrong(${i},'fuzzy')" style="flex:1;padding:5px;border:1px solid #f59e0b;border-radius:6px;background:none;color:#f59e0b;cursor:pointer;font-size:0.75rem;">🌊 模糊</button>
        <button onclick="reviewWrong(${i},'got')" style="flex:1;padding:5px;border:1px solid #10b981;border-radius:6px;background:none;color:#10b981;cursor:pointer;font-size:0.75rem;">✅ 记住</button>
        <button onclick="delWrongCard(${i})" style="padding:5px 8px;border:1px solid var(--border-color);border-radius:6px;background:none;color:var(--text-secondary);cursor:pointer;font-size:0.75rem;">🗑</button>
      </div>
    </div>
  `;
}

function addWrongCard() {
  const q = document.getElementById('wq-q').value.trim();
  const a = document.getElementById('wq-a').value.trim();
  if(!q || !a) { toast('请填写题目和答案'); return; }
  const cards = load('wrong_cards', []);
  cards.unshift({
    question: q, answer: a,
    note: document.getElementById('wq-note').value.trim(),
    subject: document.getElementById('wq-sub').value,
    interval: 1, efactor: 2.5,
    nextReview: new Date().toLocaleDateString('zh-CN'),
    created: new Date().toLocaleDateString('zh-CN'),
  });
  save('wrong_cards', cards);
  ['wq-q','wq-a','wq-note'].forEach(id => document.getElementById(id).value = '');
  toast('📌 错题已收录');
  updateXP(8);
  buildWrongbookPage(document.getElementById('main-content'));
}

function reviewWrong(i, result) {
  const cards = load('wrong_cards', []);
  const c = cards[i];
  // 简化 SM-2
  const ratings = { forget: 0, fuzzy: 2, got: 5 };
  const q = ratings[result];
  if(q < 3) { c.interval = 1; }
  else {
    c.efactor = Math.max(1.3, c.efactor + (0.1 - (5-q)*(0.08+(5-q)*0.02)));
    c.interval = c.interval === 1 ? 6 : Math.round(c.interval * c.efactor);
  }
  const next = new Date();
  next.setDate(next.getDate() + c.interval);
  c.nextReview = next.toLocaleDateString('zh-CN');
  save('wrong_cards', cards);
  const msgs = { forget: '继续加油，明天再来复习！', fuzzy: '快要记住了，6天后再来！', got: `太棒了！${c.interval}天后见！` };
  toast(msgs[result]);
  if(result === 'got') {
    updateXP(12);
    const correct = load('wrong_review_correct', 0);
    save('wrong_review_correct', correct + 1);
  }
  buildWrongbookPage(document.getElementById('main-content'));
}

function delWrongCard(i) {
  const cards = load('wrong_cards', []);
  cards.splice(i, 1);
  save('wrong_cards', cards);
  buildWrongbookPage(document.getElementById('main-content'));
}

// =========================================
//  每日复盘
// =========================================
function buildReviewPage(mc) {
  const today = new Date().toLocaleDateString('zh-CN');
  const reviews = load('daily_reviews', []);
  const todayReview = reviews.find(r => r.date === today) || {};

  mc.innerHTML = `
    <div class="page-title">📝 每日复盘</div>
    <div class="review-layout">
      <div>
        <div class="card" style="margin-bottom:1rem;">
          <div class="section-title">😊 今日心情</div>
          <div class="mood-row">
            ${['😄','😊','😐','😔','😤'].map(m => `
              <button class="mood-btn ${todayReview.mood === m ? 'active' : ''}" onclick="setMood('${m}')">${m}</button>
            `).join('')}
          </div>
        </div>
        <div class="card" style="margin-bottom:1rem;">
          <div class="section-title">🎯 今日目标完成情况</div>
          <textarea class="review-textarea" id="rv-goals" placeholder="今天完成了哪些目标？有什么遗留的？">${todayReview.goals||''}</textarea>
        </div>
        <div class="card" style="margin-bottom:1rem;">
          <div class="section-title">💭 学习收获与感悟</div>
          <textarea class="review-textarea" id="rv-insight" placeholder="今天学到了什么？有什么新的想法？">${todayReview.insight||''}</textarea>
          <button class="btn-ai" style="margin-top:0.5rem;" onclick="aiPolishInsight(event)">✨ AI 帮我润色</button>
        </div>
        <div class="feynman-box">
          <div class="feynman-box-title">🧠 费曼输出：用大白话解释今天学到的核心概念</div>
          <div style="font-size:0.72rem;color:var(--text-secondary);margin-bottom:0.5rem;line-height:1.5;">
            💡 <strong>试试这样写：</strong>「如果我要教给一个8岁的小朋友<em>${getRandomConcept()}</em>，我会这样说——」
          </div>
          <textarea class="review-textarea" id="rv-feynman" style="border-color:var(--accent);background:transparent;" placeholder="先写下你要解释的概念……&#10;&#10;然后用最简单的话、最生活化的例子来教"它"……&#10;&#10;如果发现自己讲不清楚，恭喜你——你找到了知识盲点！标记它，然后回头查漏补缺。">${todayReview.feynman||''}</textarea>
        </div>
        <div style="margin-top:1rem;">
          <div class="section-title">📅 明日计划</div>
          <textarea class="review-textarea" id="rv-plan" placeholder="明天最重要的3件事是什么？">${todayReview.plan||''}</textarea>
        </div>
        <button class="btn-primary" style="margin-top:1rem;width:100%;" onclick="saveReview()">💾 保存今日复盘</button>
      </div>

      <!-- 历史复盘 -->
      <div class="card">
        <div class="section-title">📜 复盘历史</div>
        <div style="display:flex;flex-direction:column;gap:0.8rem;max-height:600px;overflow-y:auto;">
          ${reviews.slice(-10).reverse().map(r => `
            <div style="padding:10px;background:var(--bg-body);border-radius:8px;border-left:3px solid var(--accent);">
              <div style="display:flex;justify-content:space-between;margin-bottom:5px;">
                <span style="font-size:0.75rem;color:var(--text-secondary);">${r.date}</span>
                <span style="font-size:1rem;">${r.mood||'😊'}</span>
              </div>
              ${r.insight ? `<div style="font-size:0.8rem;color:var(--text-primary);">${r.insight.slice(0,60)}${r.insight.length>60?'…':''}</div>` : ''}
              ${r.feynman ? `<div style="font-size:0.75rem;color:var(--accent);margin-top:3px;">🧠 ${r.feynman.slice(0,40)}…</div>` : ''}
            </div>
          `).join('') || '<div style="color:var(--text-secondary);font-size:0.82rem;text-align:center;padding:1rem;">还没有复盘记录</div>'}
        </div>
      </div>
    </div>
  `;
  APP.currentMood = todayReview.mood || null;
}

function setMood(m) {
  APP.currentMood = m;
  document.querySelectorAll('.mood-btn').forEach(b => b.classList.toggle('active', b.textContent === m));
}

function getRandomConcept() {
  const concepts = [
    '分数的加减法', '水的三种形态', '光合作用', '勾股定理',
    '英语现在完成时', '古诗词的意象', '牛顿第一定律', '细胞的结构',
    '十进制与二进制', '地球的公转与自转', '成语的来源', '电流与电路',
    '三角形内角和', '化学元素周期表', '唐宋八大家',
  ];
  return concepts[Math.floor(Math.random() * concepts.length)];
}

function saveReview() {
  const today = new Date().toLocaleDateString('zh-CN');
  const reviews = load('daily_reviews', []);
  const idx = reviews.findIndex(r => r.date === today);
  const entry = {
    date: today,
    mood: APP.currentMood,
    goals: document.getElementById('rv-goals').value,
    insight: document.getElementById('rv-insight').value,
    feynman: document.getElementById('rv-feynman').value,
    plan: document.getElementById('rv-plan').value,
  };
  if(idx >= 0) reviews[idx] = entry;
  else reviews.push(entry);
  save('daily_reviews', reviews);
  toast('✅ 复盘已保存！');
  updateXP(20);
  buildReviewPage(document.getElementById('main-content'));
}

// =========================================
//  知识图谱
// =========================================
function buildKnowledgePage(mc) {
  const records = load('immerse_records', []);
  const allKw = records.flatMap(r => r.keywords || []);
  const kwCount = allKw.reduce((acc, k) => { acc[k] = (acc[k]||0)+1; return acc; }, {});
  const colors = ['#3b82f6','#8b5cf6','#ec4899','#10b981','#f59e0b','#ef4444','#06b6d4'];

  mc.innerHTML = `
    <div class="page-title">🗺 知识图谱</div>
    <div class="card" style="margin-bottom:1.25rem;">
      <div class="section-title">🔗 知识关联网络</div>
      <div class="graph-canvas-wrap" id="graph-canvas-wrap">
        <canvas id="graph-canvas"></canvas>
      </div>
    </div>
    <div class="card" style="margin-bottom:1.25rem;">
      <div class="section-title">🔑 关键词云</div>
      <div class="knowledge-tags">
        ${Object.entries(kwCount).sort((a,b)=>b[1]-a[1]).map(([k, n], i) => `
          <span class="k-tag" style="background:${colors[i%colors.length]}20;color:${colors[i%colors.length]};border-color:${colors[i%colors.length]}40;font-size:${0.75+n*0.08}rem;">
            ${k} <span style="opacity:0.6;font-size:0.7em;">×${n}</span>
          </span>
        `).join('') || '<span style="color:var(--text-secondary);font-size:0.85rem;">还没有知识关键词，在墨滴流中记录一次沉浸学习吧～</span>'}
      </div>
    </div>
    <div class="card">
      <div class="section-title">📚 学习主题脉络</div>
      <div class="flow-records">
        ${records.length ? records.slice().reverse().map(r => `
          <div class="flow-record">
            <div class="flow-time">${r.date}<br><span style="color:var(--accent);font-weight:600;">${r.duration}min</span></div>
            <div class="flow-content">
              <div style="font-weight:700;font-size:0.88rem;">💧 ${r.theme}</div>
              ${r.notes ? `<div style="font-size:0.8rem;color:var(--text-secondary);margin-top:3px;">${r.notes}</div>` : ''}
              <div class="flow-keywords">${(r.keywords||[]).map(k=>`<span class="flow-kw">${k}</span>`).join('')}</div>
            </div>
          </div>
        `).join('') : '<div style="text-align:center;padding:2rem;color:var(--text-secondary);font-size:0.85rem;">在"墨滴·沉浸流"中记录学习后，知识脉络会在这里呈现。</div>'}
      </div>
    </div>
  `;
}

// ===== 知识图谱 Canvas 力导向图 =====
function initKnowledgeGraph() {
  const container = document.getElementById('graph-canvas-wrap');
  const canvas = document.getElementById('graph-canvas');
  if(!container || !canvas) return;
  const W = container.clientWidth;
  const H = Math.max(300, window.innerHeight * 0.4);
  container.style.minHeight = H + 'px';
  canvas.width = W * 2;
  canvas.height = H * 2;
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(2, 2);

  const records = load('immerse_records', []);
  if(!records.length) {
    ctx.fillStyle = '#8899b4';
    ctx.font = '14px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('还没有数据，完成沉浸学习后这里会生成知识网络', W/2, H/2);
    return;
  }

  // 提取关键词节点
  const kwMap = {};
  records.forEach(r => {
    (r.keywords||[]).forEach(k => {
      if(!kwMap[k]) kwMap[k] = { count:0, themes: new Set() };
      kwMap[k].count++;
      kwMap[k].themes.add(r.theme);
    });
  });

  const nodes = [];
  const colorPal = ['#3b82f6','#8b5cf6','#ec4899','#10b981','#f59e0b','#ef4444','#06b6d4','#f97316'];
  Object.entries(kwMap).forEach(([name, data], i) => {
    nodes.push({
      name, count: data.count,
      x: Math.random() * W, y: Math.random() * H,
      vx: 0, vy: 0,
      r: 8 + Math.min(data.count * 3, 30),
      color: colorPal[i % colorPal.length],
    });
  });

  // 在同一主题中共现的关键词之间添加边
  const edges = [];
  records.forEach(r => {
    const kws = r.keywords || [];
    for(let i = 0; i < kws.length; i++) {
      for(let j = i + 1; j < kws.length; j++) {
        const a = nodes.findIndex(n => n.name === kws[i]);
        const b = nodes.findIndex(n => n.name === kws[j]);
        if(a >= 0 && b >= 0 && a !== b) {
          const exists = edges.some(e => (e.a === a && e.b === b) || (e.a === b && e.b === a));
          if(!exists) edges.push({ a, b });
        }
      }
    }
  });

  // 力导向模拟
  const cx = W / 2, cy = H / 2;
  function simulate() {
    // 排斥力
    for(let i = 0; i < nodes.length; i++) {
      for(let j = i + 1; j < nodes.length; j++) {
        let dx = nodes[j].x - nodes[i].x;
        let dy = nodes[j].y - nodes[i].y;
        let dist = Math.sqrt(dx * dx + dy * dy) || 1;
        let force = 2000 / (dist * dist);
        let fx = (dx / dist) * force;
        let fy = (dy / dist) * force;
        nodes[i].vx -= fx * 0.01; nodes[i].vy -= fy * 0.01;
        nodes[j].vx += fx * 0.01; nodes[j].vy += fy * 0.01;
      }
    }
    // 引力到中心
    nodes.forEach(n => {
      let dx = cx - n.x, dy = cy - n.y;
      n.vx += dx * 0.001;
      n.vy += dy * 0.001;
    });
    // 边引力
    edges.forEach(e => {
      let dx = nodes[e.b].x - nodes[e.a].x;
      let dy = nodes[e.b].y - nodes[e.a].y;
      let dist = Math.sqrt(dx * dx + dy * dy) || 1;
      let target = 60;
      let force = (dist - target) * 0.005;
      let fx = (dx / dist) * force;
      let fy = (dy / dist) * force;
      nodes[e.a].vx += fx; nodes[e.a].vy += fy;
      nodes[e.b].vx -= fx; nodes[e.b].vy -= fy;
    });

    nodes.forEach(n => {
      n.vx *= 0.9; n.vy *= 0.9;
      n.x += n.vx; n.y += n.vy;
      n.x = Math.max(n.r, Math.min(W - n.r, n.x));
      n.y = Math.max(n.r, Math.min(H - n.r, n.y));
    });
  }
  for(let s = 0; s < 100; s++) simulate();

  // 绘制
  ctx.clearRect(0, 0, W, H);
  // 边
  ctx.strokeStyle = 'rgba(139,92,246,0.25)';
  ctx.lineWidth = 1;
  edges.forEach(e => {
    ctx.beginPath();
    ctx.moveTo(nodes[e.a].x, nodes[e.a].y);
    ctx.lineTo(nodes[e.b].x, nodes[e.b].y);
    ctx.stroke();
  });
  // 节点
  nodes.forEach(n => {
    ctx.beginPath();
    ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
    ctx.fillStyle = n.color + '30';
    ctx.fill();
    ctx.strokeStyle = n.color;
    ctx.lineWidth = 2;
    ctx.stroke();
    // 标签
    const fontSize = Math.min(n.r * 0.8, 14);
    ctx.fillStyle = isDark() ? '#e2e8f0' : '#1a2639';
    ctx.font = `bold ${fontSize}px "PingFang SC","Microsoft YaHei",sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(n.name, n.x, n.y);
  });
}

function isDark() {
  return document.body.classList.contains('dark');
}

// =========================================
//  电子盆栽
// =========================================
const PLANT_STAGES = [
  { emoji: '🌱', name: '嫩芽', minXP: 0 },
  { emoji: '🌿', name: '幼苗', minXP: 50 },
  { emoji: '🌾', name: '茁壮', minXP: 150 },
  { emoji: '🌳', name: '大树', minXP: 350 },
  { emoji: '🌲', name: '参天大树', minXP: 700 },
  { emoji: '✨🌲✨', name: '传说之树', minXP: 1200 },
];

function buildGardenPage(mc) {
  const xp = load('xp', 0);
  const stage = PLANT_STAGES.filter(s => xp >= s.minXP).pop();
  const nextStage = PLANT_STAGES.find(s => s.minXP > xp);
  const progress = nextStage ? Math.round((xp - stage.minXP) / (nextStage.minXP - stage.minXP) * 100) : 100;

  const skills = load('skills', { focus: 0, memory: 0, logic: 0, creative: 0 });

  mc.innerHTML = `
    <div class="page-title">🌱 电子盆栽</div>
    <div class="garden-layout">
      <div>
        <div class="plant-stage">
          <div class="plant-emoji">${stage.emoji}</div>
          <div class="plant-name">${stage.name}</div>
          <div class="plant-info">当前XP：<strong style="color:var(--accent);">${xp}</strong></div>
          <div class="xp-bar-wrap">
            <div class="xp-bar-label">${nextStage ? `距离 ${nextStage.name} 还需 ${nextStage.minXP - xp} XP` : '已达到最高等级！'}</div>
            <div class="xp-bar"><div class="xp-bar-fill" style="width:${progress}%"></div></div>
          </div>
        </div>
        <div class="card" style="margin-top:1rem;">
          <div class="section-title">📈 成长历程</div>
          ${PLANT_STAGES.map(s => `
            <div style="display:flex;align-items:center;gap:0.8rem;padding:6px 0;opacity:${xp>=s.minXP?1:0.3};">
              <span style="font-size:1.5rem;">${s.emoji}</span>
              <div style="flex:1;">
                <div style="font-size:0.85rem;font-weight:700;">${s.name}</div>
                <div style="font-size:0.72rem;color:var(--text-secondary);">解锁XP：${s.minXP}</div>
              </div>
              ${xp >= s.minXP ? '<span style="color:var(--success);font-size:0.8rem;">✓ 已解锁</span>' : `<span style="font-size:0.75rem;color:var(--text-secondary);">还需 ${s.minXP-xp} XP</span>`}
            </div>
          `).join('')}
        </div>
      </div>
      <div>
        <div class="card">
          <div class="section-title">🎯 技能树</div>
          <div class="skill-tree">
            ${[
              { key: 'focus', icon: '🎯', name: '专注力', color: '#f97316' },
              { key: 'memory', icon: '🧠', name: '记忆力', color: '#8b5cf6' },
              { key: 'logic', icon: '⚙️', name: '逻辑力', color: '#3b82f6' },
              { key: 'creative', icon: '🎨', name: '创造力', color: '#ec4899' },
            ].map(s => `
              <div class="skill-item">
                <div class="skill-icon">${s.icon}</div>
                <div style="flex:1;">
                  <div class="skill-name">${s.name}</div>
                  <div style="font-size:0.7rem;color:var(--text-secondary);">Lv.${Math.floor(skills[s.key]/20)+1} · ${skills[s.key]}pts</div>
                  <div class="skill-bar"><div class="skill-fill" style="width:${skills[s.key]%20*5}%;background:${s.color};"></div></div>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
        <div class="card" style="margin-top:1rem;">
          <div class="section-title">⚓ XP 获取引擎</div>
          <div style="font-size:0.82rem;color:var(--text-secondary);margin-bottom:0.8rem;line-height:1.5;">
            XP 只能通过实际学习行动获取，不能手动添加。<br>每次行动后自动累积，滋养植物成长 🌱
          </div>
          <div style="display:flex;flex-direction:column;gap:0.5rem;">
            ${[
              ['🍅 完成番茄钟', '+10', '知行·番茄流', '#f97316'],
              ['✅ 完成GTD任务', '+15', '知行·番茄流', '#f97316'],
              ['🪞 添加四象限任务', '+5', '明镜·四象限流', '#3b82f6'],
              ['📕 添加错题', '+8', '错题本', '#ef4444'],
              ['✅ 错题复习"记住"', '+12', '错题本', '#ef4444'],
              ['💧 完成沉浸学习', '+30', '墨滴·沉浸流', '#8b5cf6'],
              ['📝 每日复盘', '+20', '每日复盘', '#10b981'],
              ['📌 添加GTD任务', '+3', '知行·番茄流', '#f97316'],
            ].map(([action, xp, engine, color]) => `
              <div style="display:flex;align-items:center;gap:0.6rem;padding:8px 10px;background:var(--bg-body);border-radius:8px;border-left:3px solid ${color};">
                <span style="flex:1;font-size:0.82rem;">${action}</span>
                <span style="font-size:0.7rem;color:${color};font-weight:600;">${engine}</span>
                <span style="font-size:0.9rem;font-weight:800;color:var(--accent);min-width:40px;text-align:right;">${xp}</span>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    </div>
  `;
}

function updateXP(amount) {
  let xp = load('xp', 0);
  xp += amount;
  save('xp', xp);
  // 更新技能：番茄→专注，复习→记忆，四象限→逻辑，沉浸/费曼→创造
  const skills = load('skills', { focus: 0, memory: 0, logic: 0, creative: 0 });
  skills.focus = Math.min(200, skills.focus + Math.floor(amount / 3));
  skills.memory = Math.min(200, skills.memory + Math.floor(amount / 5));
  skills.logic = Math.min(200, skills.logic + Math.floor(amount / 6));
  skills.creative = Math.min(200, skills.creative + Math.floor(amount / 5));
  save('skills', skills);
  // 检查是否解锁新阶段
  const newStage = PLANT_STAGES.filter(s => xp >= s.minXP).pop();
  const oldXp = xp - amount;
  const oldStage = PLANT_STAGES.filter(s => oldXp >= s.minXP).pop();
  if(newStage && oldStage && newStage.name !== oldStage.name) {
    toast(`🎉 植物成长为「${newStage.name}」！`, 4000);
  }
}

function initGardenXP() {} // 预留

// =========================================
//  学习统计
// =========================================
function buildStatsPage(mc) {
  // 计算本周数据
  const today = new Date();
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - today.getDay());
  weekStart.setHours(0,0,0,0);
  const weekStartStr = weekStart.toLocaleDateString('zh-CN');

  const reviews = load('daily_reviews', []);
  const immerses = load('immerse_records', []);
  const tasks = load('gtd_tasks', []);
  const weekReviews = reviews.filter(r => new Date(r.date) >= weekStart).length;
  const weekImmerses = immerses.filter(r => new Date(r.date) >= weekStart).length;
  const weekTasks = tasks.filter(t => t.created && new Date(t.created) >= weekStart).length;

  mc.innerHTML = `
    <div class="page-title">📊 学习统计</div>
    <div class="stats-grid">
      <div class="card">
        <div class="section-title">🔥 学习热力图（近60天）</div>
        <div class="heatmap-row" id="heatmap-row"></div>
        <div style="display:flex;gap:0.5rem;margin-top:0.8rem;align-items:center;font-size:0.72rem;color:var(--text-secondary);">
          <span>少</span>
          <div style="width:12px;height:12px;border-radius:2px;background:var(--border-color);"></div>
          <div style="width:12px;height:12px;border-radius:2px;" class="heatmap-cell l1"></div>
          <div style="width:12px;height:12px;border-radius:2px;" class="heatmap-cell l2"></div>
          <div style="width:12px;height:12px;border-radius:2px;" class="heatmap-cell l3"></div>
          <div style="width:12px;height:12px;border-radius:2px;" class="heatmap-cell l4"></div>
          <span>多</span>
        </div>
      </div>
      <div class="card">
        <div class="section-title">📈 本周学习总览</div>
        <div style="display:flex;flex-direction:column;gap:0.8rem;">
          ${[
            ['🍅 本周番茄', APP.pomoCount + ' 个'],
            ['📋 本周新增任务', weekTasks + ' 项'],
            ['📚 错题收录', load('wrong_cards',[]).length + ' 道'],
            ['📝 本周复盘', weekReviews + ' 天'],
            ['💧 本周沉浸', weekImmerses + ' 次'],
            ['⚡ 累计XP', load('xp',0) + ' pts'],
          ].map(([label, val]) => `
            <div style="display:flex;justify-content:space-between;align-items:center;padding:10px;background:var(--bg-body);border-radius:8px;">
              <span style="font-size:0.88rem;">${label}</span>
              <span style="font-size:1rem;font-weight:800;color:var(--accent);">${val}</span>
            </div>
          `).join('')}
        </div>
      </div>
      <div class="card">
        <div class="section-title">🎯 学科分布（已收集任务）</div>
        <div style="display:flex;flex-direction:column;gap:0.5rem;">
          ${buildSubjectBar(tasks)}
        </div>
      </div>
      <div class="card">
        <div class="section-title">📅 连续打卡</div>
        ${buildStreakDisplay()}
      </div>
    </div>
  `;
  initHeatmap();
}

function buildSubjectBar(tasks) {
  const subs = { 数学:0, 语文:0, 英语:0, 科学:0, 其他:0 };
  tasks.forEach(t => { if(subs[t.subject] !== undefined) subs[t.subject]++; else subs['其他']++; });
  const total = Object.values(subs).reduce((a,b)=>a+b,0) || 1;
  const colors = { 数学:'#3b82f6', 语文:'#ec4899', 英语:'#10b981', 科学:'#f59e0b', 其他:'#8b5cf6' };
  return Object.entries(subs).filter(([,v])=>v>0).map(([k,v]) => `
    <div style="display:flex;align-items:center;gap:0.6rem;">
      <span style="width:36px;font-size:0.78rem;color:var(--text-secondary);">${k}</span>
      <div style="flex:1;height:10px;background:var(--border-color);border-radius:5px;overflow:hidden;">
        <div style="width:${Math.round(v/total*100)}%;height:100%;background:${colors[k]};border-radius:5px;transition:width 0.6s;"></div>
      </div>
      <span style="font-size:0.78rem;color:var(--text-secondary);width:20px;text-align:right;">${v}</span>
    </div>
  `).join('') || '<div style="color:var(--text-secondary);font-size:0.82rem;">暂无数据</div>';
}

function buildStreakDisplay() {
  const reviews = load('daily_reviews', []);
  let streak = 0;
  const today = new Date();
  for(let i = 0; i < 30; i++) {
    const d = new Date(today); d.setDate(today.getDate() - i);
    if(reviews.find(r => r.date === d.toLocaleDateString('zh-CN'))) streak++;
    else break;
  }
  let fireHTML = '';
  if(streak >= 21) {
    fireHTML = '<span class="fire-streak intense streak-glow">🔥🔥🔥🔥</span>';
  } else if(streak >= 14) {
    fireHTML = '<span class="fire-streak intense streak-glow">🔥🔥🔥</span>';
  } else if(streak >= 7) {
    fireHTML = '<span class="fire-streak streak-glow">🔥🔥</span>';
  } else if(streak >= 3) {
    fireHTML = '<span class="fire-streak">🔥</span>';
  } else if(streak > 0) {
    fireHTML = '🔥';
  } else {
    fireHTML = '⚓';
  }
  let milestone = '';
  if(streak >= 30) milestone = '<div style="margin-top:0.5rem;font-size:0.8rem;color:#f59e0b;">🏆 传奇航海家！连续30天！</div>';
  else if(streak >= 21) milestone = '<div style="margin-top:0.5rem;font-size:0.8rem;color:#f59e0b;">🌟 三周不断！你的坚持令人敬佩</div>';
  else if(streak >= 14) milestone = '<div style="margin-top:0.5rem;font-size:0.8rem;color:var(--success);">已获得「双周航行」成就！</div>';
  else if(streak >= 7) milestone = '<div style="margin-top:0.5rem;font-size:0.8rem;color:var(--success);">已获得「七日航行」成就！</div>';

  return `
    <div style="text-align:center;padding:2rem;">
      <div style="font-size:4rem;">${fireHTML}</div>
      <div style="font-size:2.5rem;font-weight:900;color:var(--accent);">${streak}</div>
      <div style="font-size:0.9rem;color:var(--text-secondary);">连续复盘天数</div>
      ${milestone}
    </div>
  `;
}

function initHeatmap() {
  const row = document.getElementById('heatmap-row');
  if(!row) return;
  const reviews = load('daily_reviews', []);
  const immerses = load('immerse_records', []);
  const tasks = load('gtd_tasks', []);
  const today = new Date();
  row.innerHTML = '';
  for(let i = 59; i >= 0; i--) {
    const d = new Date(today); d.setDate(today.getDate() - i);
    const ds = d.toLocaleDateString('zh-CN');
    const hasReview = reviews.some(r => r.date === ds) ? 1 : 0;
    const immCount = immerses.filter(r => r.date === ds).length;
    const tskCount = tasks.filter(t => t.created === ds || (t.done && t.created === ds)).length;
    // 综合评分
    let score = hasReview * 3 + immCount * 2 + Math.min(tskCount, 5);
    let level = 0;
    if(score >= 1) level = 1;
    if(score >= 4) level = 2;
    if(score >= 8) level = 3;
    if(score >= 15) level = 4;
    const cell = document.createElement('div');
    cell.className = `heatmap-cell ${level > 0 ? 'l'+level : ''}`;
    cell.title = `${ds} 综合活跃: ${score}pts`;
    row.appendChild(cell);
  }
}

// =========================================
//  成就徽章
// =========================================
const BADGES = [
  { id: 'first_pomo', icon: '🍅', name: '第一个番茄', desc: '完成第一个番茄钟' },
  { id: 'first_task', icon: '✅', name: '行动派', desc: '完成第一个GTD任务' },
  { id: 'first_review', icon: '📝', name: '复盘达人', desc: '完成第一次每日复盘' },
  { id: 'first_wrong', icon: '📕', name: '错题猎手', desc: '收录第一道错题' },
  { id: 'first_immerse', icon: '💧', name: '初入心流', desc: '完成第一次沉浸学习' },
  { id: 'streak_3', icon: '🔥', name: '连续出航', desc: '连续复盘3天' },
  { id: 'streak_7', icon: '🔥🔥', name: '七日航行', desc: '连续复盘7天' },
  { id: 'streak_14', icon: '🌟', name: '双周航行', desc: '连续复盘14天' },
  { id: 'streak_30', icon: '👑', name: '月度传奇', desc: '连续复盘30天' },
  { id: 'pomo_10', icon: '🍎', name: '番茄大丰收', desc: '累计完成10个番茄钟' },
  { id: 'pomo_50', icon: '🍊', name: '番茄果园', desc: '累计完成50个番茄钟' },
  { id: 'xp_100', icon: '⭐', name: '初级航海士', desc: '积累100 XP' },
  { id: 'xp_500', icon: '🌟', name: '资深航海士', desc: '积累500 XP' },
  { id: 'xp_1200', icon: '✨', name: '传说航海士', desc: '积累1200 XP（植物满级）' },
  { id: 'quadrant_all', icon: '🪞', name: '四象皆通', desc: '四个象限各有任务' },
  { id: 'quadrant_clear', icon: '🧹', name: '四象归零', desc: '一天内清空四个象限所有任务' },
  { id: 'feynman', icon: '🧠', name: '费曼门徒', desc: '复盘中完成费曼输出' },
  { id: 'wrong_10', icon: '📚', name: '错题收藏家', desc: '收录10道错题' },
  { id: 'wrong_review_10', icon: '🎯', name: '温故知新', desc: '复习错题并答对10次' },
  { id: 'plant_grow', icon: '🌳', name: '园丁', desc: '植物成长到"大树"阶段' },
  { id: 'plant_legend', icon: '✨🌲✨', name: '森林之王', desc: '植物达到传说之树' },
  { id: 'immerse_5', icon: '🌊', name: '深海探索者', desc: '完成5次沉浸学习' },
  { id: 'immerse_15', icon: '🌌', name: '深渊潜航者', desc: '完成15次沉浸学习' },
  { id: 'dark_mode', icon: '🌙', name: '夜行者', desc: '开启夜间模式学习' },
  { id: 'export_data', icon: '📤', name: '数据守护者', desc: '导出学习数据' },
  { id: 'all_basics', icon: '🏅', name: '全能航海家', desc: '解锁所有基础成就（开局10枚）' },
  { id: 'login_3', icon: '🚢', name: '三日船员', desc: '连续登录3天' },
  { id: 'login_7', icon: '🎖️', name: '忠诚船员', desc: '连续登录7天' },
  { id: 'login_14', icon: '🎖️', name: '资深船员', desc: '连续登录14天' },
  { id: 'login_30', icon: '🏅', name: '传奇船长', desc: '连续登录30天' },
];

function buildAchievementsPage(mc) {
  const unlocked = computeUnlocked();
  mc.innerHTML = `
    <div class="page-title">🏆 成就徽章 <span class="badge">${unlocked.size}/${BADGES.length} 已解锁</span></div>
    <div class="badges-grid">
      ${BADGES.map(b => `
        <div class="badge-card ${unlocked.has(b.id) ? 'unlocked' : 'locked'}">
          ${unlocked.has(b.id) ? '<div class="badge-unlock">✓ 已解锁</div>' : ''}
          <div class="badge-icon">${b.icon}</div>
          <div class="badge-name">${b.name}</div>
          <div class="badge-desc">${b.desc}</div>
        </div>
      `).join('')}
    </div>
  `;
}

function computeUnlocked() {
  const s = new Set();
  const xp = load('xp', 0);
  const wrongs = load('wrong_cards', []);
  const reviews = load('daily_reviews', []);
  const immerses = load('immerse_records', []);
  const tasks = load('gtd_tasks', []);
  const q1 = load('q1', []), q2 = load('q2', []), q3 = load('q3', []), q4 = load('q4', []);

  if(APP.pomoCount >= 1) s.add('first_pomo');
  if(APP.pomoCount >= 10) s.add('pomo_10');
  if(APP.pomoCount >= 50) s.add('pomo_50');
  if(tasks.some(t => t.done)) s.add('first_task');
  if(reviews.length >= 1) s.add('first_review');
  if(wrongs.length >= 1) s.add('first_wrong');
  if(wrongs.length >= 10) s.add('wrong_10');
  if(immerses.length >= 1) s.add('first_immerse');
  if(immerses.length >= 5) s.add('immerse_5');
  if(immerses.length >= 15) s.add('immerse_15');
  if(xp >= 100) s.add('xp_100');
  if(xp >= 500) s.add('xp_500');
  if(xp >= 1200) s.add('xp_1200');
  if(q1.length > 0 && q2.length > 0 && q3.length > 0 && q4.length > 0) s.add('quadrant_all');
  if(reviews.some(r => r.feynman && r.feynman.length > 10)) s.add('feynman');
  if(xp >= 350) s.add('plant_grow');
  if(xp >= 1200) s.add('plant_legend');
  if(APP.dark) s.add('dark_mode');

  // 检查是否导出了数据
  const hasExport = load('exported', null);
  if(hasExport) s.add('export_data');

  // 错题复习计数
  const reviewCorrect = load('wrong_review_correct', 0);
  if(reviewCorrect >= 10) s.add('wrong_review_10');

  // 四象限清零（当天所有象限曾有过任务且全部清空）
  const today = new Date().toLocaleDateString('zh-CN');
  if(q1.length === 0 && q2.length === 0 && q3.length === 0 && q4.length === 0) {
    const allCleared = load('quad_all_cleared_' + today, false);
    if(allCleared || (load('q1_history',[]).length+load('q2_history',[]).length+load('q3_history',[]).length+load('q4_history',[]).length > 0)) {
      // 简化判断：如果有过任务但现在都空了
    }
  }

  // 计算连续天数
  const todayD = new Date();
  let streak = 0;
  for(let i = 0; i < 31; i++) {
    const d = new Date(todayD); d.setDate(todayD.getDate() - i);
    if(reviews.find(r => r.date === d.toLocaleDateString('zh-CN'))) streak++;
    else break;
  }
  if(streak >= 3) s.add('streak_3');
  if(streak >= 7) s.add('streak_7');
  if(streak >= 14) s.add('streak_14');
  if(streak >= 30) s.add('streak_30');

  // 全能航海家：解锁所有基础成就
  const basics = ['first_pomo','first_task','first_review','first_wrong','first_immerse','streak_3','pomo_10','xp_100','quadrant_all','plant_grow'];
  if(basics.every(b => s.has(b))) s.add('all_basics');

  // 连续登录天数成就
  const loginDays = LoginManager.getLoginDays();
  if(loginDays >= 3) s.add('login_3');
  if(loginDays >= 7) s.add('login_7');
  if(loginDays >= 14) s.add('login_14');
  if(loginDays >= 30) s.add('login_30');

  return s;
}

// =========================================
//  数据导出导入
// =========================================
function exportData() {
  const data = {};
  const keys = ['gtd_tasks','q1','q2','q3','q4','wrong_cards','daily_reviews','immerse_records','immerse_theme','xp','skills','dark','wrong_review_correct','login_days','last_login_date'];
  keys.forEach(k => data[k] = load(k, null));
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `学海方舟_${LoginManager.getCurrentUser()||'guest'}_${new Date().toLocaleDateString('zh-CN')}.json`;
  a.click(); URL.revokeObjectURL(url);
  save('exported', Date.now());
  toast('📤 数据已导出');
}

function importData() {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = '.json';
  input.onchange = e => {
    const file = e.target.files[0];
    if(!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const data = JSON.parse(ev.target.result);
        Object.entries(data).forEach(([k, v]) => { if(v !== null) save(k, v); });
        toast('📥 数据已导入，正在刷新…');
        setTimeout(() => showPage(APP.currentPage), 500);
      } catch { toast('⚠️ 文件格式错误'); }
    };
    reader.readAsText(file);
  };
  input.click();
}

// =========================================
//  登录界面 UI
// =========================================
let _loginMode = 'login';

function switchLoginTab(mode) {
  _loginMode = mode;
  document.querySelectorAll('.login-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === mode));
  document.getElementById('login-submit-btn').textContent = mode === 'login' ? '⚓ 登船' : '🚢 注册新船';
  document.getElementById('login-error').textContent = '';
}

function handleLoginSubmit() {
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  const err = document.getElementById('login-error');
  err.textContent = '';

  if(!username) { err.textContent = '请输入昵称'; return; }
  if(!/^\d{4}$/.test(password)) { err.textContent = '密码必须是 4 位数字'; return; }

  if(_loginMode === 'register') {
    const r = LoginManager.register(username, password);
    if(!r.success) { err.textContent = r.msg; return; }
    toast('🎉 注册成功！正在登船…');
  }

  const r = LoginManager.login(username, password);
  if(!r.success) { err.textContent = r.msg; return; }
  onLoginSuccess();
}

function enterAsGuest() {
  LoginManager.loginAsGuest();
  toast('👀 游客模式启动，数据将保存在本地');
  onLoginSuccess();
}

function onLoginSuccess() {
  restoreUserSettings();
  updateUserMenu();
  document.documentElement.classList.add('logged-in');
  const overlay = document.getElementById('login-overlay');
  overlay.classList.add('hide');
  setTimeout(() => { overlay.style.display = 'none'; overlay.classList.remove('hide'); }, 600);
  document.removeEventListener('keydown', _loginKeyHandler);
}

function logoutUser() {
  LoginManager.logout();
  document.getElementById('user-dropdown').classList.remove('show');
  document.getElementById('main-app').style.display = 'none';
  document.documentElement.classList.remove('logged-in');
  const cover = document.getElementById('cover-page');
  cover.style.display = 'flex'; cover.style.opacity = '1';
  // 重置表单
  document.getElementById('login-username').value = '';
  document.getElementById('login-password').value = '';
  document.getElementById('login-error').textContent = '';
  switchLoginTab('login');
  // 显示登录遮罩
  const overlay = document.getElementById('login-overlay');
  overlay.style.display = 'flex'; overlay.classList.remove('hide');
  document.addEventListener('keydown', _loginKeyHandler);
}

function toggleUserMenu(e) {
  if(e) e.stopPropagation();
  document.getElementById('user-dropdown').classList.toggle('show');
}
document.addEventListener('click', () => {
  const dd = document.getElementById('user-dropdown');
  if(dd) dd.classList.remove('show');
});

function updateUserMenu() {
  const u = LoginManager.getCurrentUser();
  const isGuest = LoginManager.isGuest();
  const avatar = document.getElementById('user-avatar');
  const nameEl = document.getElementById('user-name-text');
  const ddAvatar = document.getElementById('user-dd-avatar');
  const ddName = document.getElementById('user-dd-name');
  const ddType = document.getElementById('user-dd-type');
  if(!u) return;
  const display = isGuest ? '游客' : u;
  const initial = isGuest ? '⛵' : u.charAt(0).toUpperCase();
  if(avatar) avatar.textContent = initial;
  if(nameEl) nameEl.textContent = display;
  if(ddAvatar) ddAvatar.textContent = initial;
  if(ddName) ddName.textContent = display;
  if(ddType) ddType.textContent = isGuest ? '游客模式' : '已登录船员';
}

function restoreUserSettings() {
  const dark = load('dark', false);
  APP.dark = !!dark;
  document.body.classList.toggle('dark', APP.dark);
  const btn = document.getElementById('dark-btn');
  if(btn) btn.textContent = APP.dark ? '☀️' : '🌙';
}

function _loginKeyHandler(e) {
  if(e.key === 'Enter') handleLoginSubmit();
}

// =========================================
//  AI 按钮交互
// =========================================
async function aiPolishInsight(evt) {
  const ta = document.getElementById('rv-insight');
  if(!ta) return;
  const text = ta.value;
  if(!text || text.trim().length < 3) { toast('⚠️ 请先写一些感悟内容'); return; }
  const btn = evt ? evt.target.closest('.btn-ai') : null;
  if(btn) { btn.disabled = true; btn.textContent = '✨ 润色中…'; }
  toast('✨ AI 正在润色…', 3000);
  const result = await AIAssistant.polishInsight(text);
  if(btn) { btn.disabled = false; btn.textContent = '✨ AI 帮我润色'; }
  if(result) {
    ta.value = result;
    toast('AI 已润色✨');
  } else {
    toast('⚠️ AI 暂时无法使用，请稍后再试');
  }
}

async function aiRecommendTheme(evt) {
  const btn = evt ? evt.target.closest('.btn-ai') : null;
  if(btn) { btn.disabled = true; btn.textContent = '🧠 思考中…'; }
  toast('🧠 AI 正在推荐主题…', 3000);
  const result = await AIAssistant.recommendTheme();
  if(btn) { btn.disabled = false; btn.textContent = '🧠 AI 推荐主题'; }
  const input = document.getElementById('immerse-theme');
  if(input && result) {
    input.value = result;
    save('immerse_theme', result);
    toast(`AI 为你推荐了：${result}`);
  }
}

// =========================================
//  初始化
// =========================================
(function init() {
  if(LoginManager.getCurrentUser()) {
    // 已登录 → 恢复设置
    restoreUserSettings();
    updateUserMenu();
  } else {
    // 未登录 → 显示登录遮罩 & 绑定回车
    const overlay = document.getElementById('login-overlay');
    if(overlay) overlay.style.display = 'flex';
    document.addEventListener('keydown', _loginKeyHandler);
  }
})();
