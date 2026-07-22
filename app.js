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
      'immerse_records','immerse_theme','xp','skills','dark','wrong_review_correct',
      'exam_records','exam_categories','backpack','active_items','shop_history','export_history',
      'user_likes','user_collections','user_groups','profile','checkin'];
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
//  AI 助手（多模型统一接口）
//  支持：硅基流动 / DeepSeek / OpenAI / 智谱AI / Ollama
// =========================================
const AI_PROVIDERS = {
  siliconflow: {
    name: '硅基流动',
    baseURL: 'https://api.siliconflow.cn/v1/chat/completions',
    models: ['Qwen/Qwen2.5-7B-Instruct', 'Qwen/Qwen2.5-14B-Instruct', 'deepseek-ai/DeepSeek-V3'],
    defaultModel: 'Qwen/Qwen2.5-7B-Instruct',
    apiKey: '',
  },
  deepseek: {
    name: 'DeepSeek',
    baseURL: 'https://api.deepseek.com/v1/chat/completions',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    defaultModel: 'deepseek-chat',
    apiKey: '',
  },
  openai: {
    name: 'OpenAI',
    baseURL: 'https://api.openai.com/v1/chat/completions',
    models: ['gpt-4o-mini', 'gpt-4o'],
    defaultModel: 'gpt-4o-mini',
    apiKey: '',
  },
  zhipu: {
    name: '智谱AI',
    baseURL: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    models: ['glm-4-flash', 'glm-4'],
    defaultModel: 'glm-4-flash',
    apiKey: '',
  },
  ollama: {
    name: 'Ollama (本地)',
    baseURL: 'http://localhost:11434/v1/chat/completions',
    models: ['qwen2.5:7b', 'llama3.1:8b'],
    defaultModel: 'qwen2.5:7b',
    apiKey: 'ollama',
  },
};

// 获取 AI 配置
function getAIConfig() {
  return load('ai_config', {
    provider: 'siliconflow',
    apiKey: '',
    model: AI_PROVIDERS.siliconflow.defaultModel,
  });
}
function saveAIConfig(cfg) { save('ai_config', cfg); }

const AIAssistant = {
  getProvider() {
    const cfg = getAIConfig();
    return AI_PROVIDERS[cfg.provider] || AI_PROVIDERS.siliconflow;
  },

  getApiKey() {
    const cfg = getAIConfig();
    return cfg.apiKey || this.getProvider().apiKey || '';
  },

  getModel() {
    const cfg = getAIConfig();
    return cfg.model || this.getProvider().defaultModel;
  },

  async ask(prompt, systemPrompt, options = {}) {
    const provider = this.getProvider();
    const apiKey = options.apiKey || this.getApiKey();
    const model = options.model || this.getModel();
    const stream = options.stream !== false;

    if(!apiKey && provider.name !== 'Ollama (本地)') {
      console.warn('AI API Key 未配置');
      return null;
    }

    const messages = [];
    if(systemPrompt) messages.push({ role: 'system', content: systemPrompt });
    messages.push({ role: 'user', content: prompt });

    try {
      const resp = await fetch(provider.baseURL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + apiKey,
        },
        body: JSON.stringify({
          model: model,
          messages: messages,
          stream: stream,
          max_tokens: options.maxTokens || 1024,
          temperature: options.temperature || 0.7,
        }),
      });

      if(!resp.ok) {
        const err = await resp.text();
        console.warn('AI API error:', resp.status, err);
        return null;
      }

      if(stream) {
        return await this._parseStream(resp, options.onToken);
      } else {
        const data = await resp.json();
        return data.choices?.[0]?.message?.content?.trim() || null;
      }
    } catch(e) {
      console.warn('AI call failed:', e.message);
      return null;
    }
  },

  async _parseStream(resp, onToken) {
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';
    let buffer = '';

    while(true) {
      const { done, value } = await reader.read();
      if(done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for(const line of lines) {
        const trimmed = line.trim();
        if(!trimmed || !trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6);
        if(data === '[DONE]') continue;
        try {
          const json = JSON.parse(data);
          const content = json.choices?.[0]?.delta?.content;
          if(content) {
            fullText += content;
            if(onToken) onToken(content, fullText);
          }
        } catch(e) { /* skip malformed */ }
      }
    }
    return fullText.trim() || null;
  },

  async askStream(prompt, systemPrompt, onToken, options = {}) {
    return await this.ask(prompt, systemPrompt, { ...options, stream: true, onToken });
  },

  async polishInsight(text) {
    const prompt = `请把这段学习感悟改写成一段更有感染力、更简洁的文字，保留原意，字数不超过50字。只输出改写后的文字，不要加任何解释或引号。\n\n原文：${text}`;
    return await this.ask(prompt, '你是一个文学润色助手，擅长把文字改写得更优美简洁。', { stream: false, maxTokens: 200 });
  },

  async recommendTheme() {
    const records = load('immerse_records', []);
    const kws = records.slice(-5).flatMap(r => r.keywords || []);
    if(kws.length === 0) {
      const d = ['数学思维训练','英语阅读突破','科学实验探究'];
      return d[Math.floor(Math.random()*d.length)];
    }
    const prompt = `根据以下学习关键词，推荐1个适合小学生的新学习主题（用中文，不超过10个字）。只输出主题名称，不要加解释。\n\n关键词：${kws.join('、')}`;
    const result = await this.ask(prompt, '你是一个教育顾问，擅长为小学生推荐学习主题。', { stream: false, maxTokens: 50 });
    if(result) return result.replace(/["'""''「」\n]/g, '').trim().slice(0, 15);
    const d = ['数学思维训练','英语阅读突破','科学实验探究'];
    return d[Math.floor(Math.random()*d.length)];
  },

  // 检查是否可用
  isAvailable() {
    const cfg = getAIConfig();
    const provider = AI_PROVIDERS[cfg.provider];
    if(!provider) return false;
    if(provider.name === 'Ollama (本地)') return true;
    return !!(cfg.apiKey);
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
// 全局数据（跨用户共享）
function saveGlobal(key, val) {
  localStorage.setItem('ark_global_' + key, JSON.stringify(val));
}
function loadGlobal(key, def) {
  try { const v = localStorage.getItem('ark_global_' + key); return v ? JSON.parse(v) : def; }
  catch(e) { return def; }
}
// 开发者检测 — 硬编码：徐楷荃为唯一开发者
const DEVELOPER_ACCOUNTS = ['徐楷荃'];
function isDeveloper(username) {
  return DEVELOPER_ACCOUNTS.includes(username);
}

// ===== 权限体系 v4.0 =====
// 用户档案：ark_{用户名}_profile
function getUserProfile(username) {
  return loadByUser(username, 'profile', {
    nickname: username,
    avatar: '⛵',
    title: null,       // 特殊称号，如"学海之星"
    role: isDeveloper(username) ? 'developer' : 'user',
    isBanned: false,
    bio: '',
    xp: 0,
    studyHours: 0,
    completedPlans: 0,
  });
}

function saveUserProfile(username, profile) {
  saveByUser(username, 'profile', profile);
}

// 跨用户读写辅助
function loadByUser(username, key, def) {
  try { const v = localStorage.getItem('ark_' + username + '_' + key); return v ? JSON.parse(v) : def; }
  catch(e) { return def; }
}
function saveByUser(username, key, val) {
  localStorage.setItem('ark_' + username + '_' + key, JSON.stringify(val));
}

// ===== IndexedDB 封装（反馈截图 + 用户头像） =====
function openIDB(dbName, version, stores) {
  return new Promise(function(resolve, reject) {
    var req = indexedDB.open(dbName, version);
    req.onupgradeneeded = function(e) {
      var db = e.target.result;
      stores.forEach(function(storeName) {
        if(!db.objectStoreNames.contains(storeName)) {
          db.createObjectStore(storeName);
        }
      });
    };
    req.onsuccess = function(e) { resolve(e.target.result); };
    req.onerror = function(e) { reject(e.target.error); };
  });
}
function idbGet(db, storeName, key) {
  return new Promise(function(resolve, reject) {
    try {
      var tx = db.transaction(storeName, 'readonly');
      var req = tx.objectStore(storeName).get(key);
      req.onsuccess = function(e) { resolve(e.target.result || null); };
      req.onerror = function(e) { reject(e.target.error); };
    } catch(e) { resolve(null); }
  });
}
function idbPut(db, storeName, key, value) {
  return new Promise(function(resolve, reject) {
    try {
      var tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).put(value, key);
      tx.oncomplete = function() { resolve(true); };
      tx.onerror = function(e) { reject(e.target.error); };
    } catch(e) { reject(e); }
  });
}
function idbDelete(db, storeName, key) {
  return new Promise(function(resolve, reject) {
    try {
      var tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).delete(key);
      tx.oncomplete = function() { resolve(true); };
      tx.onerror = function(e) { reject(e.target.error); };
    } catch(e) { reject(e); }
  });
}

// 数据库实例缓存
var _feedbackDB = null;
var _avatarDB = null;
function getFeedbackDB() {
  if(_feedbackDB) return Promise.resolve(_feedbackDB);
  return openIDB('FeedbackDB', 1, ['FeedbackImages']).then(function(db) {
    _feedbackDB = db; return db;
  });
}
function getAvatarDB() {
  if(_avatarDB) return Promise.resolve(_avatarDB);
  return openIDB('AvatarDB', 1, ['UserAvatars']).then(function(db) {
    _avatarDB = db; return db;
  });
}

// 全局封禁列表 ark_global_banned
function getGlobalBanned() {
  return loadGlobal('banned', []);
}
function saveGlobalBanned(list) {
  saveGlobal('banned', list);
}
function isUserBanned(username) {
  // 开发者永不被封
  if(isDeveloper(username)) return false;
  return getGlobalBanned().includes(username);
}
function banUser(username) {
  if(isDeveloper(username)) { toast('不能封禁开发者'); return; }
  const list = getGlobalBanned();
  if(!list.includes(username)) {
    list.push(username);
    saveGlobalBanned(list);
    // 更新其档案
    const p = getUserProfile(username);
    p.isBanned = true;
    saveUserProfile(username, p);
    toast('⛔ 已封禁用户：' + username);
  }
}
function unbanUser(username) {
  const list = getGlobalBanned().filter(n => n !== username);
  saveGlobalBanned(list);
  const p = getUserProfile(username);
  p.isBanned = false;
  saveUserProfile(username, p);
  toast('✅ 已解封用户：' + username);
}

// 获取用户显示名称（含称号标签HTML）
function getUserDisplayName(username) {
  const profile = getUserProfile(username);
  let html = escapeHTML(username);
  if(isDeveloper(username)) html += ' <span class="user-badge-role developer">👑 开发者</span>';
  else if(profile.role === 'special') html += ' <span class="user-badge-role special">⭐ 特殊用户</span>';
  if(profile.title) html += ' <span class="user-badge-title">' + escapeHTML(profile.title) + '</span>';
  return html;
}

// 获取用户称号纯文本
function getUserTitle(username) {
  const profile = getUserProfile(username);
  return profile.title || null;
}

// 检测当前用户是否为开发者
function currentIsDeveloper() {
  const u = LoginManager.getCurrentUser();
  return u && isDeveloper(u);
}

// ===== Toast =====
function toast(msg, dur = 2200) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), dur);
}

// ===== 清空输入框 =====
function clearInput(id) {
  const el = document.getElementById(id);
  if(!el) return;
  el.value = '';
  el.focus();
}

// ===== 清空所有数据 =====
function clearAllData() {
  if(!confirm('⚠️ 确定要清空所有学习数据吗？\n\n此操作不可撤销！将删除：\n• 所有任务（GTD + 四象限）\n• 所有错题记录\n• 所有复盘记录\n• 所有沉浸学习记录\n• 所有考试记录与错题本\n• 所有背包物品与积分\n• 所有导出历史\n• 所有XP和技能数据\n• 所有成就进度\n\n账号信息和主题设置将保留。')) return;
  const u = LoginManager.getCurrentUser();
  if(!u) return;
  const prefix = 'ark_' + u + '_';
  const keysToRemove = [];
  for(let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if(key.startsWith(prefix) && !key.endsWith('_dark')) {
      keysToRemove.push(key);
    }
  }
  keysToRemove.forEach(k => localStorage.removeItem(k));
  // 重置APP状态
  APP.pomoCount = 0;
  APP.immerseSec = 0;
  APP.immerseRunning = false;
  APP.pomoRunning = false;
  APP.pomoSec = 25 * 60;
  APP.pomoPhase = 'work';
  APP.timerSec = 0;
  APP.timerRunning = false;
  clearInterval(APP.pomoInterval);
  clearInterval(APP.immerseInterval);
  clearInterval(APP.timerInterval);
  APP.pomoInterval = null;
  APP.immerseInterval = null;
  APP.timerInterval = null;
  // 清理考试计时器
  if(EXAM_STATE.running) {
    clearInterval(EXAM_STATE.intervalId);
    EXAM_STATE.running = false;
    EXAM_STATE.intervalId = null;
    const timerOverlay = document.getElementById('exam-timer-overlay');
    if(timerOverlay) timerOverlay.style.display = 'none';
  }
  // 更新UI
  document.getElementById('pomo-count').textContent = '0';
  document.getElementById('pomo-display').textContent = '25:00';
  document.getElementById('pomo-btn').textContent = '▶';
  document.getElementById('timer-display').textContent = '00:00:00';
  document.getElementById('timer-btn').textContent = '▶';
  toast('🧹 所有学习数据已清空，重新出发吧！', 3000);
  showPage(APP.currentPage);
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
  // 更新侧栏 nav active
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.page === name);
  });
  // 同步移动端导航抽屉
  document.querySelectorAll('.mobile-nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.mnav === name);
  });
  const mc = document.getElementById('main-content');
  mc.innerHTML = '';
  mc.className = 'main-content fade-in';
  // 移动端自适应 padding
  if(window.innerWidth <= 1023) mc.classList.add('mobile-mode');
  const builders = {
    home: buildHomePage,
    zhixing: buildZhixingPage,
    mingjing: buildMingjingPage,
    modi: buildModiPage,
    aitutor: buildAITutorPage,
    wrongbook: buildWrongbookPage,
    review: buildReviewPage,
    knowledge: buildKnowledgePage,
    garden: buildGardenPage,
    stats: buildStatsPage,
    achievements: buildAchievementsPage,
    exam: buildExamPage,
    shop: buildShopPage,
    space: buildSpacePage,
    groups: function(mc) { buildSpacePage(mc); setTimeout(openGroupDrawer, 300); },
    classes: buildClassesPage,
    leaderboard: buildLeaderboardPage,
    profile: buildProfilePage,
    feedback: buildFeedbackPage,
    'feedback-records': buildFeedbackRecordsPage,
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
  // v3.0: 更新商店积分
  if(name === 'shop') { setTimeout(updateShopXP, 50); }
  // 关闭汉堡菜单
  closeHamburgerMenu();
  // 滚动到顶部
  mc.scrollTop = 0;
  window.scrollTo(0, 0);
}

const pad = n => String(n).padStart(2, '0');

// ===== 汉堡菜单 =====
function toggleHamburgerMenu() {
  const menu = document.getElementById('slide-menu');
  const overlay = document.getElementById('menu-overlay');
  const btn = document.getElementById('hamburger-btn');
  const isOpen = menu.classList.contains('open');
  if(isOpen) {
    closeHamburgerMenu();
  } else {
    menu.style.display = 'flex';
    // 触发重排后再添加 class，确保动画生效
    menu.offsetHeight;
    menu.classList.add('open');
    overlay.classList.add('show');
    btn.classList.add('active');
    // 同步当前页高亮
    document.querySelectorAll('#slide-menu .nav-item').forEach(el => {
      el.classList.toggle('active', el.dataset.page === APP.currentPage);
    });
  }
}

function closeHamburgerMenu() {
  const menu = document.getElementById('slide-menu');
  const overlay = document.getElementById('menu-overlay');
  const btn = document.getElementById('hamburger-btn');
  menu.classList.remove('open');
  overlay.classList.remove('show');
  btn.classList.remove('active');
  // 动画结束后隐藏
  setTimeout(() => { if(!menu.classList.contains('open')) menu.style.display = 'none'; }, 300);
}

function toggleDarkFromMenu() {
  toggleDark();
  closeHamburgerMenu();
}

// =========================================
//  移动端导航浮窗
// =========================================
function toggleMobileNav() {
  const drawer = document.getElementById('mobile-nav-drawer');
  const overlay = document.getElementById('mobile-nav-overlay');
  const isActive = drawer.classList.contains('active');
  if(isActive) { closeMobileNav(); }
  else {
    drawer.classList.add('active');
    overlay.classList.add('active');
    // 同步高亮
    document.querySelectorAll('.mobile-nav-item').forEach(el => {
      el.classList.toggle('active', el.dataset.mnav === APP.currentPage);
    });
  }
}
function closeMobileNav() {
  const drawer = document.getElementById('mobile-nav-drawer');
  const overlay = document.getElementById('mobile-nav-overlay');
  drawer.classList.remove('active');
  overlay.classList.remove('active');
}
function mobileNavTo(page) {
  closeMobileNav();
  setTimeout(() => showPage(page), 250);
}

// =========================================
//  移动端触摸优化
// =========================================
(function initMobileTouch() {
  // 输入框聚焦自动滚到可见区
  document.addEventListener('focusin', function(e) {
    if(window.innerWidth > 1023) return;
    const tag = e.target.tagName;
    if(tag === 'INPUT' || tag === 'TEXTAREA') {
      setTimeout(() => {
        e.target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 300);
    }
  });

  // 全局长按模拟上下文菜单（移动端无右键）
  let longPressTimer = null;
  document.addEventListener('touchstart', function(e) {
    const el = e.target.closest('[data-longpress]');
    if(!el || !currentIsDeveloper()) return;
    longPressTimer = setTimeout(() => {
      const event = new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true,
        clientX: e.touches[0].clientX, clientY: e.touches[0].clientY
      });
      el.dispatchEvent(event);
    }, 500);
  }, { passive: false });
  document.addEventListener('touchend', function() { clearTimeout(longPressTimer); });
  document.addEventListener('touchmove', function() { clearTimeout(longPressTimer); });

  // 全局关闭上下文菜单
  document.addEventListener('click', function(e) {
    const existing = document.getElementById('mobile-ctx-menu');
    if(existing && !existing.contains(e.target)) {
      existing.remove();
    }
  });
})();

// =========================================
//  图片懒加载（Intersection Observer）
// =========================================
(function initLazyImages() {
  const observer = new IntersectionObserver(function(entries) {
    entries.forEach(entry => {
      if(entry.isIntersecting) {
        const img = entry.target;
        const src = img.getAttribute('data-src');
        if(src) {
          img.src = src;
          img.removeAttribute('data-src');
          img.classList.add('loaded');
        }
        observer.unobserve(img);
      }
    });
  }, { rootMargin: '200px' });

  // 在渲染完成后扫描懒加载图片
  const scanInterval = setInterval(() => {
    document.querySelectorAll('img[data-src]').forEach(img => {
      observer.observe(img);
    });
  }, 1000);
  // 5分钟后停止持续扫描
  setTimeout(() => clearInterval(scanInterval), 300000);

  // 暴露手动触发接口
  window._scanLazyImages = function() {
    document.querySelectorAll('img[data-src]').forEach(img => {
      observer.observe(img);
    });
  };
})();

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
//  每日签到系统
// =========================================
function getCheckinStreak(dates) {
  if(!dates || dates.length === 0) return 0;
  const sorted = [...dates].sort().reverse();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let checkDate = new Date(today);
  if(sorted[0] !== today.toISOString().slice(0, 10)) {
    checkDate.setDate(checkDate.getDate() - 1);
  }
  let streak = 0;
  const dateSet = new Set(dates);
  while(streak < 365) {
    const ds = checkDate.toISOString().slice(0, 10);
    if(dateSet.has(ds)) { streak++; checkDate.setDate(checkDate.getDate() - 1); }
    else break;
  }
  return streak;
}

function getTodayCheckinReward(streak) {
  const base = 10;
  const bonus = Math.floor(streak / 3) * 2;
  return Math.min(base + bonus, 30);
}

function doDailyCheckin() {
  const todayStr = new Date().toISOString().slice(0, 10);
  const dates = load('checkin_dates', []);
  if(dates.includes(todayStr)) { toast('✅ 今天已经签到过了！'); return; }
  dates.push(todayStr);
  dates.sort();
  save('checkin_dates', dates);
  const streak = getCheckinStreak(dates);
  const reward = getTodayCheckinReward(streak);
  const meta = load('checkin', { streakDays: 0, totalCheckins: 0 });
  meta.streakDays = streak;
  meta.totalCheckins = dates.length;
  save('checkin', meta);
  addXP(reward, '每日签到');
  let milestoneMsg = '';
  if(streak === 7) milestoneMsg = ' 🎉 连续7天！解锁"周常打卡"成就！';
  else if(streak === 30) milestoneMsg = ' 🏆 连续30天！获得"月度之星"称号！';
  else if(streak === 100) milestoneMsg = ' 👑 连续100天！你是真正的"百日行动派"！';
  toast(`✅ 签到成功！+${reward} ⚡ 积分${milestoneMsg}`);
  buildHomePage(document.getElementById('main-content'));
}

// =========================================
//  首页
// =========================================
function buildHomePage(mc) {
  const gtdTasks = load('gtd_tasks', []);
  const quadTasks = { q1: load('q1', []), q2: load('q2', []), q3: load('q3', []), q4: load('q4', []) };
  const totalQ = Object.values(quadTasks).reduce((a, b) => a + b.length, 0);
  const wrongs = load('wrong_cards', []);
  // 签到数据
  const checkinDates = load('checkin_dates', []);
  const todayStr = new Date().toISOString().slice(0, 10);
  const checkedInToday = checkinDates.includes(todayStr);
  const checkinStreak = getCheckinStreak(checkinDates);
  const checkinMeta = load('checkin', { streakDays: 0, totalCheckins: 0 });
  const checkinReward = getTodayCheckinReward(checkinMeta.streakDays || checkinStreak);
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

  // 全服公告
  let announcementHTML = '';
  const ann = getAnnouncement();
  if(ann.text && !sessionStorage.getItem('ark_ann_dismissed')) {
    const fmtText = ann.text
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\[color\](.+?)\[\/color\]/g, '<span style="color:var(--accent);">$1</span>');
    announcementHTML = `
      <div class="announcement-banner" id="announcement-banner">
        <div class="announcement-scroll">
          <span class="announcement-icon">📢</span>
          <span class="announcement-text">${fmtText}</span>
        </div>
        <button class="announcement-close" onclick="dismissAnnouncement()" title="关闭">✕</button>
      </div>`;
  }

  // 全局推荐笔记
  let recommendedHTML = '';
  const recommended = getRecommended();
  if(recommended.length > 0) {
    const posts = getPosts();
    const recPosts = recommended.map(id => posts.find(p => p.id === id)).filter(Boolean).slice(0, 3);
    if(recPosts.length > 0) {
      recommendedHTML = `
        <div class="home-recommended">
          <div class="home-rec-title">⭐ 岛主推荐</div>
          <div class="home-rec-cards">
            ${recPosts.map(p => `
              <div class="home-rec-card" onclick="showPage('space')" style="cursor:pointer;">
                <div class="home-rec-author">${escapeHTML(p.author)}</div>
                <div class="home-rec-content">${escapeHTML(p.content.slice(0, 60))}${p.content.length > 60 ? '...' : ''}</div>
                <div style="display:flex;justify-content:space-between;font-size:0.65rem;color:var(--text-secondary);">
                  <span>❤️ ${p.likes.length || 0}</span>
                  <span class="rec-badge">⭐ 岛主推荐</span>
                </div>
              </div>
            `).join('')}
          </div>
        </div>`;
    }
  }

  mc.innerHTML = `
    ${announcementHTML}
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
    ${recommendedHTML}
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
    <div style="text-align:right;margin:0.3rem 0 0.8rem;">
      <a style="font-size:0.78rem;color:var(--accent);cursor:pointer;text-decoration:underline;" onclick="showPage('stats')">📊 查看完整数据报告 →</a>
    </div>
    <!-- 每日签到 -->
    <div class="checkin-section">
      ${checkedInToday ? `
      <div class="checkin-card checked-in">
        <div class="checkin-left">
          <div class="checkin-icon">✅</div>
          <div>
            <div class="checkin-title">今日已签到</div>
            <div class="checkin-sub">已连续打卡 <strong>${checkinStreak}</strong> 天 · 累计 <strong>${checkinMeta.totalCheckins || checkinDates.length}</strong> 天</div>
          </div>
        </div>
        <div class="checkin-reward">+${checkinReward} ⚡ 已到账</div>
      </div>
      ` : `
      <div class="checkin-card" onclick="doDailyCheckin()">
        <div class="checkin-left">
          <div class="checkin-icon pulse">📅</div>
          <div>
            <div class="checkin-title">每日签到领积分</div>
            <div class="checkin-sub">${checkinStreak > 0 ? `当前连续 <strong>${checkinStreak}</strong> 天 · ` : ''}今日可领 <strong>+${checkinReward}</strong> 积分</div>
          </div>
        </div>
        <button class="checkin-btn">🎯 签到</button>
      </div>
      `}
      ${checkinStreak >= 5 ? `<div class="checkin-streak-bar"><div class="checkin-streak-fill" style="width:${Math.min(checkinStreak * 10, 100)}%"></div><span class="checkin-streak-text">🔥 ${checkinStreak}天连续打卡 · 明天再签+${getTodayCheckinReward(checkinStreak + 1)}积分</span></div>` : ''}
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
            <div class="input-clear-wrap">
              <input class="inbox-input" id="gtd-input" placeholder="把脑海里所有任务都扔进来…" onkeydown="if(event.key==='Enter')addGTDTask()">
              <button class="input-clear-btn" onclick="clearInput('gtd-input')" title="清空">✕</button>
            </div>
            <select id="gtd-subject" style="border:1px solid var(--border-color);border-radius:8px;padding:0 10px;background:var(--bg-body);color:var(--text-primary);font-size:0.85rem;">
              <option value="数学">数学</option>
              <option value="语文">语文</option>
              <option value="英语">英语</option>
              <option value="科学">科学</option>
              <option value="其他">其他</option>
            </select>
            <div class="input-clear-wrap" style="flex:0 0 auto;">
              <input type="number" id="gtd-pomo" placeholder="🍅数" min="1" max="10" style="width:70px;border:1px solid var(--border-color);border-radius:8px;padding:0 8px;background:var(--bg-body);color:var(--text-primary);">
              <button class="input-clear-btn" onclick="clearInput('gtd-pomo')" title="清空">✕</button>
            </div>
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
        <div class="input-clear-wrap">
          <input class="q-input" id="qi-${qid}" placeholder="${action}" onkeydown="if(event.key==='Enter')addQuadTask('${qid}')">
          <button class="input-clear-btn" onclick="clearInput('qi-${qid}')" title="清空">✕</button>
        </div>
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
          <div class="input-clear-wrap">
            <input class="theme-input" id="immerse-theme" placeholder="输入本次学习主题（如：分数加减法、古诗背诵…）" value="${load('immerse_theme', '')}">
            <button class="input-clear-btn" onclick="clearInput('immerse-theme')" title="清空">✕</button>
          </div>
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
          <div class="input-clear-wrap textarea-wrap">
            <textarea id="immerse-keywords-input" class="review-textarea" style="height:80px;" placeholder="输入本次学习关键词（用逗号分隔）…"></textarea>
            <button class="input-clear-btn" onclick="clearInput('immerse-keywords-input')" title="清空">✕</button>
          </div>
          <div class="input-clear-wrap textarea-wrap" style="margin-top:0.5rem;">
            <textarea id="immerse-notes-input" class="review-textarea" style="height:80px;" placeholder="记录知识关联和新发现…"></textarea>
            <button class="input-clear-btn" onclick="clearInput('immerse-notes-input')" title="清空">✕</button>
          </div>
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
//  AI 导师 · 小海
// =========================================
let _aiChatHistory = [];

function buildAITutorPage(mc) {
  const cfg = getAIConfig();
  const provider = AI_PROVIDERS[cfg.provider] || AI_PROVIDERS.siliconflow;
  const available = AIAssistant.isAvailable();

  mc.innerHTML = `
    <div class="page-title">🤖 AI导师 · 小海 <span class="badge">多模型 · 流式响应</span></div>
    <div class="ai-tutor-layout">
      <!-- 左侧：设置面板 -->
      <div class="ai-settings-panel">
        <div class="card" style="margin-bottom:1rem;">
          <div class="section-title">⚙️ AI 设置</div>
          <div style="font-size:0.8rem;color:var(--text-secondary);margin-bottom:0.5rem;">
            ${available ? '✅ AI 已就绪' : '⚠️ 请配置 API Key'}
          </div>
          <div class="ai-config-row">
            <label>提供商</label>
            <select id="ai-provider" onchange="onAIProviderChange()" class="profile-motto-input" style="flex:1;">
              ${Object.entries(AI_PROVIDERS).map(([k, v]) =>
                `<option value="${k}" ${cfg.provider === k ? 'selected' : ''}>${v.name}</option>`
              ).join('')}
            </select>
          </div>
          <div class="ai-config-row" id="ai-key-row" style="${cfg.provider === 'ollama' ? 'display:none;' : ''}">
            <label>API Key</label>
            <div class="input-clear-wrap" style="flex:1;">
              <input id="ai-apikey" type="password" class="profile-motto-input" placeholder="输入 API Key…" value="${cfg.apiKey || ''}">
              <button class="input-clear-btn" onclick="clearInput('ai-apikey')">✕</button>
            </div>
          </div>
          <div class="ai-config-row">
            <label>模型</label>
            <select id="ai-model" class="profile-motto-input" style="flex:1;">
              ${(provider.models || []).map(m =>
                `<option value="${m}" ${cfg.model === m ? 'selected' : ''}>${m}</option>`
              ).join('')}
            </select>
          </div>
          <button class="btn-primary" style="width:100%;margin-top:0.5rem;" onclick="saveAISettings()">💾 保存设置</button>
        </div>
        <div class="card">
          <div class="section-title">💡 快捷指令</div>
          <div class="ai-quick-prompts">
            <button class="ai-quick-btn" onclick="sendQuickPrompt('帮我讲解一下分数的加减法')">🧮 分数加减法</button>
            <button class="ai-quick-btn" onclick="sendQuickPrompt('如何用费曼学习法学习新知识？')">🧠 费曼学习法</button>
            <button class="ai-quick-btn" onclick="sendQuickPrompt('给我一些高效记单词的方法')">📝 记单词技巧</button>
            <button class="ai-quick-btn" onclick="sendQuickPrompt('如何制定一个好的学习计划？')">📋 制定学习计划</button>
            <button class="ai-quick-btn" onclick="sendQuickPrompt('什么是番茄工作法？如何用？')">🍅 番茄工作法</button>
            <button class="ai-quick-btn" onclick="sendQuickPrompt('帮我解一道数学应用题')">🔢 解数学题</button>
          </div>
        </div>
      </div>

      <!-- 右侧：聊天区域 -->
      <div class="ai-chat-panel">
        <div class="ai-chat-header">
          <span class="ai-chat-avatar">🤖</span>
          <div>
            <div style="font-weight:700;font-size:0.9rem;">AI导师 · 小海</div>
            <div style="font-size:0.7rem;color:var(--text-secondary);">${provider.name} · ${cfg.model || provider.defaultModel}</div>
          </div>
          <button class="ai-clear-btn" onclick="clearAIChat()">🗑 清空</button>
        </div>
        <div class="ai-chat-messages" id="ai-chat-msgs">
          <div class="ai-msg ai-msg-bot">
            <div class="ai-msg-avatar">🤖</div>
            <div class="ai-msg-bubble">
              👋 你好！我是你的 AI 导师<strong>小海</strong>！<br><br>
              ${available ? '我已经准备好了，你可以：<br>• 问我任何学习问题<br>• 让我帮你讲解知识点<br>• 让我推荐学习方法<br>• 帮你制定学习计划<br><br>直接在下方输入你的问题吧！' : '⚠️ 请先在左侧<strong>配置 API Key</strong>，推荐使用<strong>硅基流动</strong>（免费额度充足）。<br><br>配置后可免费使用多种大模型！'}
            </div>
          </div>
        </div>
        <div class="ai-chat-input">
          <input id="ai-chat-input" placeholder="输入你的问题…" maxlength="500" onkeydown="if(event.key==='Enter' && !event.shiftKey){event.preventDefault();sendAIMessage();}">
          <button onclick="sendAIMessage()" id="ai-send-btn">发送</button>
        </div>
        <div style="font-size:0.65rem;color:var(--text-secondary);text-align:center;margin-top:0.25rem;">
          按 Enter 发送 · Shift+Enter 换行 · AI回答仅供参考
        </div>
      </div>
    </div>
  `;
  if(_aiChatHistory.length > 0) {
    restoreAIChat();
  }
}

function onAIProviderChange() {
  const sel = document.getElementById('ai-provider');
  if(!sel) return;
  const provider = AI_PROVIDERS[sel.value];
  if(!provider) return;
  // 显示/隐藏 API Key 输入
  const keyRow = document.getElementById('ai-key-row');
  if(keyRow) keyRow.style.display = sel.value === 'ollama' ? 'none' : '';
  // 更新模型列表
  const modelSel = document.getElementById('ai-model');
  if(modelSel) {
    modelSel.innerHTML = (provider.models || []).map(m =>
      `<option value="${m}">${m}</option>`
    ).join('');
  }
}

function saveAISettings() {
  const provider = document.getElementById('ai-provider')?.value || 'siliconflow';
  const apiKey = document.getElementById('ai-apikey')?.value?.trim() || '';
  const model = document.getElementById('ai-model')?.value || AI_PROVIDERS[provider]?.defaultModel || '';
  const cfg = { provider, apiKey, model };
  saveAIConfig(cfg);
  toast('✅ AI 设置已保存');
  buildAITutorPage(document.getElementById('main-content'));
}

function clearAIChat() {
  _aiChatHistory = [];
  const msgs = document.getElementById('ai-chat-msgs');
  if(msgs) {
    msgs.innerHTML = `
      <div class="ai-msg ai-msg-bot">
        <div class="ai-msg-avatar">🤖</div>
        <div class="ai-msg-bubble">聊天已清空，有什么想问的吗？</div>
      </div>
    `;
  }
}

function restoreAIChat() {
  const msgs = document.getElementById('ai-chat-msgs');
  if(!msgs || !_aiChatHistory.length) return;
  msgs.innerHTML = _aiChatHistory.map(h => `
    <div class="ai-msg ${h.role === 'user' ? 'ai-msg-user' : 'ai-msg-bot'}">
      <div class="ai-msg-avatar">${h.role === 'user' ? '👤' : '🤖'}</div>
      <div class="ai-msg-bubble">${formatAIText(h.content)}</div>
    </div>
  `).join('');
  setTimeout(() => { msgs.scrollTop = msgs.scrollHeight; }, 50);
}

function sendQuickPrompt(text) {
  const input = document.getElementById('ai-chat-input');
  if(input) { input.value = text; sendAIMessage(); }
}

async function sendAIMessage() {
  const input = document.getElementById('ai-chat-input');
  if(!input || !input.value.trim()) return;
  const text = input.value.trim();
  input.value = '';
  input.disabled = true;
  document.getElementById('ai-send-btn').disabled = true;

  // 添加用户消息
  _aiChatHistory.push({ role: 'user', content: text });
  appendAIMessage('user', text);

  // 添加机器人占位
  const botId = 'ai-msg-' + Date.now();
  appendAIMessage('bot', '<span class="ai-typing">思考中…</span>', botId);
  const msgsDiv = document.getElementById('ai-chat-msgs');

  // 构建上下文
  const recentHistory = _aiChatHistory.slice(-10);
  const systemPrompt = `你是"小海"，学海方舟学习平台的 AI 导师。你擅长用简单易懂、生动有趣的方式为小学生讲解知识。回答要简洁、鼓励性强，多用比喻和例子。如果被问到不确定的问题，诚实地说不知道并建议向老师请教。`;
  const contextMessages = recentHistory.map(h => h.content).join('\n\n');
  const fullPrompt = contextMessages;

  const botEl = document.getElementById(botId);
  let fullText = '';

  try {
    await AIAssistant.askStream(
      fullPrompt,
      systemPrompt,
      (token, accumulated) => {
        fullText = accumulated;
        if(botEl) {
          botEl.querySelector('.ai-msg-bubble').innerHTML = formatAIText(fullText);
        }
        if(msgsDiv) msgsDiv.scrollTop = msgsDiv.scrollHeight;
      }
    );

    if(!fullText) fullText = '抱歉，AI 暂时无法回答。请检查 API 设置或稍后再试。';
    _aiChatHistory.push({ role: 'assistant', content: fullText });
    if(botEl) {
      botEl.querySelector('.ai-msg-bubble').innerHTML = formatAIText(fullText);
    }
  } catch(e) {
    if(botEl) {
      botEl.querySelector('.ai-msg-bubble').textContent = '⚠️ 请求失败，请检查网络和 API Key 设置。';
    }
  }

  input.disabled = false;
  document.getElementById('ai-send-btn').disabled = false;
  input.focus();
  if(msgsDiv) msgsDiv.scrollTop = msgsDiv.scrollHeight;
}

function appendAIMessage(role, content, id) {
  const msgs = document.getElementById('ai-chat-msgs');
  if(!msgs) return;
  const div = document.createElement('div');
  div.className = 'ai-msg ' + (role === 'user' ? 'ai-msg-user' : 'ai-msg-bot');
  if(id) div.id = id;
  div.innerHTML = `
    <div class="ai-msg-avatar">${role === 'user' ? '👤' : '🤖'}</div>
    <div class="ai-msg-bubble">${role === 'user' ? escapeHTML(content) : content}</div>
  `;
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
}

function formatAIText(text) {
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br>');
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
        <div class="input-clear-wrap">
          <input class="inbox-input" id="wq-q" placeholder="错题题目…">
          <button class="input-clear-btn" onclick="clearInput('wq-q')" title="清空">✕</button>
        </div>
        <div class="input-clear-wrap">
          <input class="inbox-input" id="wq-a" placeholder="正确答案…">
          <button class="input-clear-btn" onclick="clearInput('wq-a')" title="清空">✕</button>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.8rem;margin-bottom:0.8rem;">
        <div class="input-clear-wrap">
          <input class="inbox-input" id="wq-note" placeholder="错误原因 / 学习笔记…">
          <button class="input-clear-btn" onclick="clearInput('wq-note')" title="清空">✕</button>
        </div>
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
          <div class="input-clear-wrap textarea-wrap">
            <textarea class="review-textarea" id="rv-goals" placeholder="今天完成了哪些目标？有什么遗留的？">${todayReview.goals||''}</textarea>
            <button class="input-clear-btn" onclick="clearInput('rv-goals')" title="清空">✕</button>
          </div>
        </div>
        <div class="card" style="margin-bottom:1rem;">
          <div class="section-title">💭 学习收获与感悟</div>
          <div class="input-clear-wrap textarea-wrap">
            <textarea class="review-textarea" id="rv-insight" placeholder="今天学到了什么？有什么新的想法？">${todayReview.insight||''}</textarea>
            <button class="input-clear-btn" onclick="clearInput('rv-insight')" title="清空">✕</button>
          </div>
          <button class="btn-ai" style="margin-top:0.5rem;" onclick="aiPolishInsight(event)">✨ AI 帮我润色</button>
        </div>
        <div class="feynman-box">
          <div class="feynman-box-title">🧠 费曼输出：用大白话解释今天学到的核心概念</div>
          <div style="font-size:0.72rem;color:var(--text-secondary);margin-bottom:0.5rem;line-height:1.5;">
            💡 <strong>试试这样写：</strong>「如果我要教给一个8岁的小朋友<em>${getRandomConcept()}</em>，我会这样说——」
          </div>
          <div class="input-clear-wrap textarea-wrap">
            <textarea class="review-textarea" id="rv-feynman" style="border-color:var(--accent);background:transparent;" placeholder="先写下你要解释的概念……&#10;&#10;然后用最简单的话、最生活化的例子来教"它"……&#10;&#10;如果发现自己讲不清楚，恭喜你——你找到了知识盲点！标记它，然后回头查漏补缺。">${todayReview.feynman||''}</textarea>
            <button class="input-clear-btn" onclick="clearInput('rv-feynman')" title="清空">✕</button>
          </div>
        </div>
        <div style="margin-top:1rem;">
          <div class="section-title">📅 明日计划</div>
          <div class="input-clear-wrap textarea-wrap">
            <textarea class="review-textarea" id="rv-plan" placeholder="明天最重要的3件事是什么？">${todayReview.plan||''}</textarea>
            <button class="input-clear-btn" onclick="clearInput('rv-plan')" title="清空">✕</button>
          </div>
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

function addXP(amount, reason) {
  updateXP(amount);
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
  const today = new Date();
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - today.getDay());
  weekStart.setHours(0,0,0,0);
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

  const reviews = load('daily_reviews', []);
  const immerses = load('immerse_records', []);
  const tasks = load('gtd_tasks', []);
  const weekReviews = reviews.filter(r => new Date(r.date) >= weekStart).length;
  const weekImmerses = immerses.filter(r => new Date(r.date) >= weekStart).length;
  const weekTasks = tasks.filter(t => t.created && new Date(t.created) >= weekStart).length;
  const checkin = load('checkin_dates', []);

  // 本月学习数据
  const monthReviews = reviews.filter(r => new Date(r.date) >= monthStart).length;
  const monthImmerses = immerses.filter(r => new Date(r.date) >= monthStart).length;
  const monthTotalMins = monthImmerses * 25 + monthReviews * 15 + weekTasks * 5; // 估算

  // 上月（用于对比）
  const lastMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const lastMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0);
  const lastMonthImmerses = immerses.filter(r => { const d = new Date(r.date); return d >= lastMonthStart && d <= lastMonthEnd; }).length;
  const lastMonthReviews = reviews.filter(r => { const d = new Date(r.date); return d >= lastMonthStart && d <= lastMonthEnd; }).length;
  const lastMonthMins = lastMonthImmerses * 25 + lastMonthReviews * 15;
  const monthChange = lastMonthMins > 0 ? Math.round((monthTotalMins - lastMonthMins) / lastMonthMins * 100) : null;

  // 本周学科分布（用于雷达图）
  const weekTasksData = tasks.filter(t => t.created && new Date(t.created) >= weekStart);
  const subs = { 语文: 0, 数学: 0, 英语: 0, 科学: 0, '社会/其他': 0 };
  weekTasksData.forEach(t => {
    const s = t.subject || '社会/其他';
    if(subs[s] !== undefined) subs[s]++;
    else subs['社会/其他']++;
  });
  const subKeys = Object.keys(subs);
  const subVals = Object.values(subs);
  const maxSubVal = Math.max(...subVals, 1);
  const subPercents = subVals.map(v => Math.round(v / maxSubVal * 100));

  // 近期周报摘要
  const completedTasks = tasks.filter(t => t.completed).length;
  const totalTasks = tasks.length;
  const thisWeekCompleted = tasks.filter(t => t.completed && new Date(t.completed) >= weekStart).length;

  mc.innerHTML = `
    <div class="page-title">📊 学习数据中心</div>

    <!-- 本月总览 -->
    <div class="card" style="margin-bottom:1rem;">
      <div class="section-title">📅 本月学习总览</div>
      <div style="display:flex;align-items:center;gap:1.5rem;flex-wrap:wrap;">
        <div>
          <div style="font-size:2.5rem;font-weight:900;color:var(--accent);">${Math.floor(monthTotalMins / 60)}<span style="font-size:1rem;">h</span> ${monthTotalMins % 60}<span style="font-size:1rem;">min</span></div>
          <div style="font-size:0.82rem;color:var(--text-secondary);">本月学习总时长</div>
        </div>
        ${monthChange !== null ? `
          <div style="padding:0.4rem 0.8rem;border-radius:1rem;font-size:0.82rem;font-weight:700;background:${monthChange >= 0 ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)'};color:${monthChange >= 0 ? 'var(--success)' : 'var(--danger)'};">
            ${monthChange >= 0 ? '↑' : '↓'} ${Math.abs(monthChange)}% 较上月
          </div>
        ` : ''}
      </div>
      <div style="display:flex;gap:1rem;margin-top:1rem;flex-wrap:wrap;">
        <div class="mini-stat"><span class="mini-stat-num">${monthReviews}</span><span class="mini-stat-label">复盘天</span></div>
        <div class="mini-stat"><span class="mini-stat-num">${monthImmerses}</span><span class="mini-stat-label">番茄次</span></div>
        <div class="mini-stat"><span class="mini-stat-num">${checkin.length}</span><span class="mini-stat-label">打卡天</span></div>
        <div class="mini-stat"><span class="mini-stat-num">${load('xp',0)}</span><span class="mini-stat-label">总XP</span></div>
      </div>
    </div>

    <!-- 热力图 -->
    <div class="card" style="margin-bottom:1rem;">
      <div class="section-title">🔥 学习热力图（近60天）</div>
      <div class="heatmap-row" id="heatmap-row"></div>
      <div style="display:flex;gap:0.5rem;margin-top:0.8rem;align-items:center;font-size:0.72rem;color:var(--text-secondary);">
        <span>少</span>
        <div style="width:12px;height:12px;border-radius:2px;background:var(--border-color);"></div><div class="heatmap-cell l1" style="width:12px;height:12px;border-radius:2px;"></div><div class="heatmap-cell l2" style="width:12px;height:12px;border-radius:2px;"></div><div class="heatmap-cell l3" style="width:12px;height:12px;border-radius:2px;"></div><div class="heatmap-cell l4" style="width:12px;height:12px;border-radius:2px;"></div>
        <span>多</span>
      </div>
    </div>

    <!-- 雷达图 + 本周数据 -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1rem;">
      <div class="card">
        <div class="section-title">🎯 本周学科雷达</div>
        <canvas id="radar-canvas" width="300" height="300" style="width:100%;max-width:300px;display:block;margin:0 auto;"></canvas>
        <div style="display:flex;justify-content:center;gap:1.2rem;margin-top:0.5rem;flex-wrap:wrap;">
          ${subKeys.map((k, i) => `<span style="font-size:0.72rem;color:var(--text-secondary);">${['🔴','🔵','🟢','🟡','🟣'][i]} ${k} ${subVals[i]}</span>`).join('')}
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
    </div>

    <!-- 近期周报 -->
    <div class="card" style="margin-bottom:1rem;">
      <div class="section-title">📋 近期周报摘要</div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.8rem;">
        <span style="font-size:0.85rem;color:var(--text-secondary);">本周 ${thisWeekCompleted} / ${weekTasks} 项任务完成</span>
        <span style="font-size:0.82rem;color:var(--accent);font-weight:600;">${weekTasks > 0 ? Math.round(thisWeekCompleted/weekTasks*100) : 0}%</span>
      </div>
      <div style="height:8px;background:var(--border-color);border-radius:4px;overflow:hidden;margin-bottom:1rem;">
        <div style="width:${weekTasks > 0 ? Math.round(thisWeekCompleted/weekTasks*100) : 0}%;height:100%;background:linear-gradient(90deg,var(--accent),var(--success));border-radius:4px;transition:width 0.6s;"></div>
      </div>
      <div style="display:flex;gap:1.5rem;flex-wrap:wrap;font-size:0.82rem;color:var(--text-secondary);">
        <div>✅ 已完成 ${completedTasks} / ${totalTasks} 项总任务</div>
        <div>📊 完成率 ${totalTasks > 0 ? Math.round(completedTasks/totalTasks*100) : 0}%</div>
      </div>
    </div>

    <!-- 连续打卡 -->
    <div class="card">
      <div class="section-title">📅 连续打卡</div>
      ${buildStreakDisplay()}
    </div>

    ${currentIsDeveloper() ? buildDevAdminPanel() : ''}
  `;
  initHeatmap();
  // 延迟绘制雷达图（等DOM渲染）
  setTimeout(() => drawRadarChart(subPercents, subVals), 100);
  // 异步加载反馈管理列表中的头像
  if(currentIsDeveloper() && _adminTab === 'feedback') {
    setTimeout(function() {
      document.querySelectorAll('.feedback-admin-avatar').forEach(function(el) {
        var id = el.id || '';
        var fbId = id.replace('fb-avatar-', '');
        if(fbId) {
          var allFbs = getFeedbacks();
          var fb = allFbs.find(function(f) { return f.id === fbId; });
          if(fb) renderAvatar(fb.userId, el, 32, true);
        }
      });
    }, 100);
  }
}

// ===== Canvas 雷达图 =====
function drawRadarChart(values, rawVals) {
  const canvas = document.getElementById('radar-canvas');
  if(!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  const cx = w / 2, cy = h / 2;
  const r = 100;
  const n = values.length;

  ctx.clearRect(0, 0, w, h);

  // 背景网格
  for(let level = 1; level <= 4; level++) {
    ctx.beginPath();
    for(let i = 0; i < n; i++) {
      const angle = (Math.PI * 2 / n) * i - Math.PI / 2;
      const lr = r * level / 4;
      const x = cx + Math.cos(angle) * lr;
      const y = cy + Math.sin(angle) * lr;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.strokeStyle = 'var(--border-color)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // 轴线
  const colors = ['#ef4444', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6'];
  for(let i = 0; i < n; i++) {
    const angle = (Math.PI * 2 / n) * i - Math.PI / 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r);
    ctx.strokeStyle = 'var(--border-color)';
    ctx.lineWidth = 0.5;
    ctx.stroke();
  }

  // 数据区域
  ctx.beginPath();
  for(let i = 0; i < n; i++) {
    const angle = (Math.PI * 2 / n) * i - Math.PI / 2;
    const dr = r * values[i] / 100;
    const x = cx + Math.cos(angle) * dr;
    const y = cy + Math.sin(angle) * dr;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = 'rgba(249,115,22,0.2)';
  ctx.fill();
  ctx.strokeStyle = 'var(--accent)';
  ctx.lineWidth = 2;
  ctx.stroke();

  // 数据点
  for(let i = 0; i < n; i++) {
    const angle = (Math.PI * 2 / n) * i - Math.PI / 2;
    const dr = r * values[i] / 100;
    const x = cx + Math.cos(angle) * dr;
    const y = cy + Math.sin(angle) * dr;
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fillStyle = colors[i];
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  // 标签
  const labels = ['语文', '数学', '英语', '科学', '社会/其他'];
  ctx.font = 'bold 12px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for(let i = 0; i < n; i++) {
    const angle = (Math.PI * 2 / n) * i - Math.PI / 2;
    const lx = cx + Math.cos(angle) * (r + 25);
    const ly = cy + Math.sin(angle) * (r + 25);
    ctx.fillStyle = 'var(--text-primary)';
    ctx.fillText(labels[i] + '(' + rawVals[i] + ')', lx, ly);
  }
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

// ===== 开发者管理后台 =====
// ---- 5页式管理后台 ----
let _adminTab = 'users';

function buildDevAdminPanel() {
  return `
    <div class="card admin-main-card" style="margin-top:1rem;border:2px solid var(--warning);">
      <div class="section-title" style="color:var(--warning);">⚙️ 方舟岛主管理后台</div>
      <div class="admin-tabs">
        <button class="admin-tab ${_adminTab === 'users' ? 'active' : ''}" onclick="_adminTab='users';buildStatsPage(document.getElementById('main-content'))">👥 用户管理</button>
        <button class="admin-tab ${_adminTab === 'shop' ? 'active' : ''}" onclick="_adminTab='shop';buildStatsPage(document.getElementById('main-content'))">🛒 商品管理</button>
        <button class="admin-tab ${_adminTab === 'ops' ? 'active' : ''}" onclick="_adminTab='ops';buildStatsPage(document.getElementById('main-content'))">📢 内容运营</button>
        <button class="admin-tab ${_adminTab === 'events' ? 'active' : ''}" onclick="_adminTab='events';buildStatsPage(document.getElementById('main-content'))">🎁 活动中心</button>
        <button class="admin-tab ${_adminTab === 'tools' ? 'active' : ''}" onclick="_adminTab='tools';buildStatsPage(document.getElementById('main-content'))">⚙️ 系统工具</button>
        <button class="admin-tab ${_adminTab === 'feedback' ? 'active' : ''}" onclick="_adminTab='feedback';buildStatsPage(document.getElementById('main-content'))">📋 反馈管理</button>
      </div>
      <div class="admin-tab-content" id="admin-tab-content">
        ${buildAdminTabContent()}
      </div>
    </div>
  `;
}

function buildAdminTabContent() {
  switch(_adminTab) {
    case 'users': return buildAdminUsersTab();
    case 'shop': return buildAdminShopTab();
    case 'ops': return buildAdminOpsTab();
    case 'events': return buildAdminEventsTab();
    case 'tools': return buildAdminToolsTab();
    case 'feedback': return buildAdminFeedbackTab();
    default: return '';
  }
}

// Tab 1: 用户管理
function buildAdminUsersTab() {
  const allUsers = getAllUsers();
  const bannedList = getGlobalBanned();
  const specialUsers = allUsers.filter(name => {
    if(isDeveloper(name)) return false;
    const p = getUserProfile(name);
    return p.role === 'special' || p.title;
  });

  return `
    <div class="admin-search-bar">
      <input type="text" id="admin-user-search" placeholder="🔍 搜索用户名..." oninput="filterAdminUsers()" style="width:100%;padding:0.6rem 0.8rem;border:1px solid var(--border-color);border-radius:10px;background:var(--bg-body);color:var(--text-primary);font-size:0.85rem;">
    </div>
    <div style="display:flex;gap:0.5rem;margin-bottom:0.8rem;flex-wrap:wrap;">
      <span style="font-size:0.8rem;color:var(--text-secondary);">全部用户：<strong>${allUsers.length}</strong> 人</span>
      <span style="font-size:0.8rem;color:var(--danger);">封禁：<strong>${bannedList.length}</strong> 人</span>
      <span style="font-size:0.8rem;color:var(--accent);">特殊：<strong>${specialUsers.length}</strong> 人</span>
    </div>
    <div class="admin-user-grid" id="admin-user-grid">
      ${allUsers.map(name => {
        const p = getUserProfile(name);
        const isDev = isDeveloper(name);
        const isBanned = bannedList.includes(name);
        return `
          <div class="admin-user-card" data-username="${escapeHTML(name)}" style="cursor:pointer;" onclick="showUserProfile('${escapeHTML(name)}')">
            <div style="display:flex;align-items:center;gap:0.6rem;">
              <span style="font-size:1.5rem;">${p.avatar || (isDev ? '👑' : '👤')}</span>
              <div>
                <div style="font-weight:700;font-size:0.85rem;">${escapeHTML(name)} ${isDev ? '<span class="user-badge-role developer">👑开发者</span>' : ''} ${isBanned ? '<span style="color:#dc2626;font-size:0.65rem;">⛔封禁</span>' : ''}</div>
                <div style="font-size:0.7rem;color:var(--text-secondary);">${p.title || '普通用户'} · XP: ${p.xp || 0} · 📖 ${p.studyHours || 0}h</div>
              </div>
            </div>
            <div style="display:flex;gap:0.3rem;margin-top:0.4rem;">
              <button class="btn-secondary btn-sm" onclick="event.stopPropagation();showUserProfile('${escapeHTML(name)}')">👤</button>
              ${!isDev ? `<button class="btn-secondary btn-sm" onclick="event.stopPropagation();openRenameUser('${escapeHTML(name)}')" title="改名">✏️</button>` : ''}
              ${!isDev ? (isBanned ? `<button class="btn-secondary btn-sm" onclick="event.stopPropagation();doUnbanFromPanel('${escapeHTML(name)}')">✅</button>` : `<button class="btn-secondary btn-sm" onclick="event.stopPropagation();doBanUserConfirm('${escapeHTML(name)}')" style="color:var(--danger);">⛔</button>`) : ''}
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function filterAdminUsers() {
  const q = (document.getElementById('admin-user-search').value || '').toLowerCase();
  document.querySelectorAll('.admin-user-card').forEach(card => {
    const name = (card.dataset.username || '').toLowerCase();
    card.style.display = !q || name.includes(q) ? '' : 'none';
  });
}

// Tab 2: 商品管理
function buildAdminShopTab() {
  const allItems = [];
  Object.entries(STORE_CATALOG).forEach(([type, list]) => {
    list.forEach(item => allItems.push({ ...item, type }));
  });
  const offItems = allItems.filter(i => i.status === 'off');

  return `
    <div style="margin-bottom:0.8rem;font-size:0.85rem;color:var(--text-secondary);">
      总商品：<strong>${allItems.length}</strong> 件 · 已下架：<strong style="color:var(--danger);">${offItems.length}</strong> 件
    </div>
    <div class="admin-list">
      ${allItems.map(item => {
        const isOff = item.status === 'off';
        return `
          <div class="admin-row">
            <span>${item.icon} ${item.name} <span style="color:${isOff ? 'var(--danger)' : 'var(--success)'};font-size:0.65rem;">${isOff ? '已下架' : '上架中'}</span> · ⚡${item.price}</span>
            <div style="display:flex;gap:0.3rem;">
              <button class="btn-secondary btn-sm" onclick="toggleItemStatusAdmin('${item.id}','${item.type}', this)">${isOff ? '✅ 上架' : '📦 下架'}</button>
            </div>
          </div>
        `;
      }).join('')}
    </div>
    <div style="margin-top:0.5rem;">
      <button class="btn-primary btn-sm" onclick="showPage('shop')">🛍️ 进入商店（右键商品可管理）→</button>
    </div>
  `;
}

// Tab 3: 内容运营
function buildAdminOpsTab() {
  const ann = getAnnouncement();
  const recommended = getRecommended();
  const posts = getPosts();

  return `
    <div class="admin-section">
      <div class="admin-section-title">📢 全服公告</div>
      <div style="padding:0.5rem 0.8rem;background:var(--bg-body);border-radius:8px;margin-bottom:0.5rem;font-size:0.8rem;">
        当前公告：${ann.text ? '<span style="color:var(--accent);">' + ann.text + '</span>' : '<span style="color:var(--text-secondary);">暂无</span>'}
      </div>
      <button class="btn-primary btn-sm" onclick="openPublishAnnouncement()">📢 发布/修改公告</button>
    </div>

    <div class="admin-section">
      <div class="admin-section-title">⭐ 全局推荐笔记（${recommended.length}篇）</div>
      ${recommended.length === 0 ? '<span style="font-size:0.8rem;color:var(--text-secondary);">暂无推荐</span>' :
        recommended.map(postId => {
          const post = posts.find(p => p.id === postId);
          if(!post) return '';
          return `
            <div class="admin-row">
              <span style="font-size:0.8rem;">⭐ ${escapeHTML(post.content.slice(0, 40))}... by ${escapeHTML(post.author)}</span>
              <button class="btn-secondary btn-sm" onclick="recommendPost('${postId}');buildStatsPage(document.getElementById('main-content'))">取消推荐</button>
            </div>
          `;
        }).join('')
      }
    </div>

    <div class="admin-section">
      <div class="admin-section-title">⭐ 特殊用户名单</div>
      <div class="admin-list" id="admin-special-list">
        ${(() => {
          const allUsers = getAllUsers();
          const specialUsers = allUsers.filter(name => {
            if(isDeveloper(name)) return false;
            const p = getUserProfile(name);
            return p.role === 'special' || p.title;
          });
          return specialUsers.length === 0 ? '<span style="font-size:0.8rem;color:var(--text-secondary);">暂无特殊用户</span>' :
            specialUsers.map(name => {
              const p = getUserProfile(name);
              return `
                <div class="admin-row">
                  <span>⭐ ${escapeHTML(name)} ${p.title ? '<span class="user-badge-title" style="display:inline-block;margin-left:4px;font-size:0.65rem;">'+escapeHTML(p.title)+'</span>' : ''}</span>
                  <div style="display:flex;gap:0.3rem;">
                    <button class="btn-secondary btn-sm" onclick="showUserProfile('${escapeHTML(name)}')">👤</button>
                    <button class="btn-secondary btn-sm" onclick="doRevokeTitle('${escapeHTML(name)}')" style="color:var(--danger);">🗑️</button>
                  </div>
                </div>
              `;
            }).join('');
        })()}
      </div>
    </div>
  `;
}

// Tab 4: 活动中心
function buildAdminEventsTab() {
  const codes = getExchangeCodes();
  const codeEntries = Object.entries(codes);
  const activeCodes = codeEntries.filter(([, r]) => !r.used);

  return `
    <div class="admin-section">
      <div class="admin-section-title">🎫 兑换码管理（${activeCodes.length}个有效）</div>
      <button class="btn-primary btn-sm" onclick="generateExchangeCode()" style="margin-bottom:0.8rem;">🎫 生成新兑换码</button>
      ${codeEntries.length === 0 ? '<div style="font-size:0.8rem;color:var(--text-secondary);">暂无兑换码</div>' :
        `<div class="admin-list">
          ${codeEntries.slice(0, 20).map(([code, r]) => `
            <div class="admin-row">
              <span style="font-family:monospace;font-weight:700;${r.used ? 'opacity:0.5;text-decoration:line-through;' : ''}">🎫 ${code}</span>
              <span style="font-size:0.75rem;">
                ${r.reward.type === 'points' ? '💰 ' + r.reward.value + '积分' : '🎁 ' + r.reward.value}
                ${r.used ? '<span style="color:var(--danger);">已用('+r.usedBy+')</span>' : '<span style="color:var(--success);">可用</span>'}
                ${r.expire ? '· ⏰' + r.expire : ''}
              </span>
            </div>
          `).join('')}
        </div>`
      }
    </div>

    <div class="admin-section">
      <div class="admin-section-title">💰 发放积分红包</div>
      <div style="display:flex;gap:0.5rem;align-items:center;">
        <input type="text" id="admin-give-user" placeholder="输入目标用户名" style="flex:1;padding:0.5rem 0.8rem;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-body);color:var(--text-primary);font-size:0.85rem;">
        <button class="btn-primary btn-sm" onclick="openGivePoints(document.getElementById('admin-give-user').value)">💰 前往发放</button>
      </div>
    </div>
  `;
}

// Tab 5: 系统工具
function buildAdminToolsTab() {
  const log = getAdminLog().slice(0, 50);
  const canExport = typeof Blob !== 'undefined';

  return `
    <div class="admin-section">
      <div class="admin-section-title">🤖 冷启动机器人</div>
      <div style="font-size:0.8rem;color:var(--text-secondary);margin-bottom:0.5rem;">
        生成虚拟用户并自动在学友群发送打招呼消息。<br>机器人用户会被标注"🤖 机器人模拟用户"。
      </div>
      <div style="display:flex;gap:0.5rem;margin-bottom:0.5rem;">
        <button class="btn-secondary btn-sm" onclick="generateBotUsers(1)">🤖 生成1名</button>
        <button class="btn-secondary btn-sm" onclick="generateBotUsers(3)">🤖 生成3名</button>
        <button class="btn-secondary btn-sm" onclick="generateBotUsers(5)">🤖 生成5名</button>
      </div>
    </div>

    <div class="admin-section">
      <div class="admin-section-title">📋 操作日志（最近50条）</div>
      ${log.length === 0 ? '<span style="font-size:0.8rem;color:var(--text-secondary);">暂无日志</span>' :
        `<div class="admin-list">
          ${log.map(l => `
            <div class="admin-row" style="flex-direction:column;align-items:flex-start;gap:0.2rem;">
              <div style="display:flex;justify-content:space-between;width:100%;">
                <span style="font-weight:700;font-size:0.8rem;">📌 ${escapeHTML(l.action)}</span>
                <span style="font-size:0.65rem;color:var(--text-secondary);">${getRelativeTime(l.time)}</span>
              </div>
              <span style="font-size:0.75rem;color:var(--text-secondary);">${escapeHTML(l.detail || '')}</span>
              <span style="font-size:0.65rem;color:var(--text-secondary);">操作人：${escapeHTML(l.operator)} ${l.target ? '· 目标：' + escapeHTML(l.target) : ''}</span>
            </div>
          `).join('')}
        </div>`
      }
    </div>

    <div class="admin-section">
      <div class="admin-section-title">📤 数据管理</div>
      <button class="btn-secondary btn-sm" onclick="exportData()">📤 导出全部数据</button>
      ${canExport ? `<button class="btn-secondary btn-sm" onclick="exportAdminLog()" style="margin-left:0.5rem;">📋 导出操作日志</button>` : ''}
    </div>
  `;
}

function exportAdminLog() {
  const log = getAdminLog();
  const text = log.map(l => `[${l.time}] ${l.action} | ${l.detail || ''} | 操作人:${l.operator} | 目标:${l.target || ''}`).join('\n');
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'admin-log-' + new Date().toISOString().slice(0, 10) + '.txt';
  a.click();
  toast('📋 操作日志已导出');
}

// 从管理面板操作（保留兼容）
function doUnbanFromPanel(name) { unbanUser(name); buildStatsPage(document.getElementById('main-content')); }
function toggleItemStatusAdmin(id, type, btn) {
  toggleItemStatus(id, type);
  btn.textContent = btn.textContent === '📦 下架' ? '✅ 上架' : '📦 下架';
  setTimeout(() => buildStatsPage(document.getElementById('main-content')), 300);
}
function doRevokeTitle(name) {
  if(!confirm('确定撤销用户「' + name + '」的特殊称号吗？')) return;
  const p = getUserProfile(name);
  p.title = null;
  p.role = 'user';
  saveUserProfile(name, p);
  adminLog('撤销称号', `撤销 ${name} 的特殊称号`);
  toast('🗑️ 已撤销 ' + name + ' 的称号');
  buildStatsPage(document.getElementById('main-content'));
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
  const keys = ['gtd_tasks','q1','q2','q3','q4','wrong_cards','daily_reviews','immerse_records','immerse_theme','xp','skills','dark','wrong_review_correct','login_days','last_login_date','exam_records','exam_categories','backpack','active_items','shop_history','export_history','user_likes','user_collections','user_groups','profile','checkin'];
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
  // 确保默认头像存在
  var cu = LoginManager.getCurrentUser();
  if(cu && cu !== 'guest') ensureDefaultAvatar(cu);
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

function confirmLogout() {
  if(confirm('确定要退出登录吗？\n\n退出后需要重新输入账号和密码才能登船。')) {
    sessionStorage.removeItem('ark_ann_dismissed');
    logoutUser();
  }
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
  // 异步加载头像（非游客）
  if(!isGuest && u) {
    setTimeout(function() {
      if(avatar) renderAvatar(u, avatar, 28, true);
      if(ddAvatar) renderAvatar(u, ddAvatar, 36, true);
    }, 50);
  }
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
//  v3.0 通用弹窗
// =========================================
function openModal(id) {
  const m = document.getElementById(id);
  if(m) m.style.display = 'flex';
}
function closeModal(id) {
  const m = document.getElementById(id);
  if(m) m.style.display = 'none';
}

// =========================================
//  v3.0 模拟考场
// =========================================
const EXAM_CATEGORIES_PRESET = [
  { id: 'contest',  name: '竞赛模考', icon: '🏆', color: '#f97316' },
  { id: 'unit',     name: '单元测试', icon: '📝', color: '#3b82f6' },
  { id: 'monthly',  name: '月考',     icon: '📅', color: '#8b5cf6' },
  { id: 'midterm',  name: '期中考试', icon: '📖', color: '#ec4899' },
  { id: 'final',    name: '期末考试', icon: '📚', color: '#ef4444' },
  { id: 'mock',     name: '模拟考',   icon: '🎯', color: '#14b8a6' },
];
const EXAM_DURATION_OPTIONS = [10, 15, 30, 45, 60, 90, 120, 180];
const EXAM_QUESTION_TYPES = ['选择', '填空', '简答', '混合'];

// 考试状态
const EXAM_STATE = {
  running: false,
  startTime: 0,
  duration: 0,
  config: null,
  intervalId: null,
  elapsed: 0,
};

// 获取分类列表（含自定义）
function getExamCategories() {
  const custom = load('exam_categories', []);
  return [...EXAM_CATEGORIES_PRESET, ...custom];
}

function buildExamPage(mc) {
  const records = load('exam_records', []);
  mc.innerHTML = `
    <div class="page-title">✏️ 模拟考场 <span class="badge">计时 · 分类 · 分析</span></div>
    <div class="exam-sub-tabs">
      <button class="exam-sub-tab active" onclick="examSwitchTab('start')">📝 开始考试</button>
      <button class="exam-sub-tab" onclick="examSwitchTab('analysis')">📊 考试分析</button>
      <button class="exam-sub-tab" onclick="examSwitchTab('category')">📂 分类管理</button>
    </div>
    <div id="exam-tab-content"></div>
  `;
  examSwitchTab('start');
}

function examSwitchTab(tab) {
  document.querySelectorAll('.exam-sub-tab').forEach(b => b.classList.remove('active'));
  // 根据 tab 参数查找对应按钮并高亮
  const tabMap = { start: 0, analysis: 1, category: 2 };
  const btns = document.querySelectorAll('.exam-sub-tab');
  if(btns[tabMap[tab]]) btns[tabMap[tab]].classList.add('active');
  const content = document.getElementById('exam-tab-content');
  if(!content) return;
  if(tab === 'start') content.innerHTML = buildExamStartTab();
  else if(tab === 'analysis') { content.innerHTML = buildExamAnalysisTab(); setTimeout(drawExamCharts, 100); }
  else if(tab === 'category') content.innerHTML = buildExamCategoryTab();
}

function buildExamStartTab() {
  const records = load('exam_records', []);
  const cats = getExamCategories();
  const recent = records.slice(-5).reverse();
  const avgScore = records.length > 0
    ? Math.round(records.reduce((sum, r) => sum + (r.score / r.totalScore * 100), 0) / records.length * 10) / 10
    : 0;

  return `
    <div class="exam-config-card">
      <div class="exam-config-row">
        <span class="exam-config-label">📘 学科</span>
        <select class="exam-config-select" id="exam-subject">
          <option value="数学">数学</option>
          <option value="语文">语文</option>
          <option value="英语">英语</option>
          <option value="科学">科学</option>
        </select>
      </div>
      <div class="exam-config-row">
        <span class="exam-config-label">📂 分类</span>
        <select class="exam-config-select" id="exam-category">
          ${cats.map(c => `<option value="${c.id}">${c.icon} ${c.name}</option>`).join('')}
        </select>
      </div>
      <div class="exam-config-row">
        <span class="exam-config-label">📋 名称</span>
        <div class="input-clear-wrap" style="flex:1;min-width:120px;">
          <input class="exam-config-input" id="exam-name" placeholder="输入考试名称…">
          <button class="input-clear-btn" onclick="clearInput('exam-name')">✕</button>
        </div>
      </div>
      <div class="exam-config-row">
        <span class="exam-config-label">📊 总分</span>
        <input class="exam-config-input" id="exam-total-score" type="number" value="100" min="10" max="300" style="max-width:100px;">
      </div>
      <div class="exam-config-row">
        <span class="exam-config-label">⏱️ 时长</span>
        <select class="exam-config-select" id="exam-duration">
          ${EXAM_DURATION_OPTIONS.map(d => `<option value="${d}" ${d===90?'selected':''}>${d} 分钟</option>`).join('')}
        </select>
      </div>
      <div class="exam-config-row">
        <span class="exam-config-label">📝 题型</span>
        <select class="exam-config-select" id="exam-qtype">
          ${EXAM_QUESTION_TYPES.map(t => `<option value="${t}">${t}</option>`).join('')}
        </select>
      </div>
      <div class="exam-config-row">
        <span class="exam-config-label">📚 题量</span>
        <input class="exam-config-input" id="exam-qcount" type="number" value="10" min="1" max="50" style="max-width:100px;">
      </div>
      <button class="btn-primary" style="width:100%;margin-top:0.5rem;font-size:1rem;padding:12px;" onclick="startExam()">🚀 开始考试</button>
    </div>

    <div class="card" style="margin-top:1.2rem;">
      <div class="section-title">📊 最近战绩</div>
      ${recent.length ? recent.map(r => {
        const cat = cats.find(c => c.id === r.categoryId) || { icon: '📝', name: '未知', color: '#64748b' };
        const pct = Math.round(r.score / r.totalScore * 100);
        return `
          <div class="exam-recent-item" onclick="viewExamDetail(${r.id})">
            <span class="exam-category-tag" style="background:${cat.color}20;color:${cat.color};">${cat.icon} ${cat.name}</span>
            <span style="flex:1;font-size:0.82rem;">${r.subject} · ${r.name}</span>
            <span style="font-weight:700;color:${pct>=85?'#10b981':pct>=60?'#f59e0b':'#ef4444'};">${r.score}/${r.totalScore}</span>
            <span style="font-size:0.72rem;color:var(--text-secondary);">${r.date}</span>
          </div>
        `;
      }).join('') : '<div style="text-align:center;padding:1.5rem;color:var(--text-secondary);font-size:0.85rem;">还没有考试记录，开始你的第一场考试吧！</div>'}
      ${records.length > 0 ? `<div style="text-align:center;margin-top:0.8rem;font-size:0.82rem;color:var(--text-secondary);">平均分：<strong style="color:var(--accent);">${avgScore}</strong> 分</div>` : ''}
    </div>
  `;
}

function startExam() {
  const subject = document.getElementById('exam-subject').value;
  const categoryId = document.getElementById('exam-category').value;
  const name = document.getElementById('exam-name').value.trim() || `${subject}测验`;
  const totalScore = parseInt(document.getElementById('exam-total-score').value) || 100;
  const duration = parseInt(document.getElementById('exam-duration').value) || 90;
  const qtype = document.getElementById('exam-qtype').value;
  const qcount = parseInt(document.getElementById('exam-qcount').value) || 10;

  EXAM_STATE.config = { subject, categoryId, name, totalScore, duration, qtype, qcount };
  EXAM_STATE.running = true;
  EXAM_STATE.startTime = Date.now();
  EXAM_STATE.elapsed = 0;
  EXAM_STATE.duration = duration * 60;

  // 显示全屏计时器
  const overlay = document.getElementById('exam-timer-overlay');
  overlay.style.display = 'flex';
  document.getElementById('et-subject').textContent = `📘 ${subject}`;
  document.getElementById('et-name').textContent = name;
  document.getElementById('et-total').textContent = `共 ${duration} 分钟`;

  updateExamTimer();
  EXAM_STATE.intervalId = setInterval(updateExamTimer, 1000);
}

function updateExamTimer() {
  EXAM_STATE.elapsed = Math.floor((Date.now() - EXAM_STATE.startTime) / 1000);
  const remaining = Math.max(0, EXAM_STATE.duration - EXAM_STATE.elapsed);
  const m = Math.floor(remaining / 60);
  const s = remaining % 60;
  const clockEl = document.getElementById('et-clock');
  if(clockEl) clockEl.textContent = `${pad(m)}:${pad(s)}`;

  const progress = Math.min(100, (EXAM_STATE.elapsed / EXAM_STATE.duration) * 100);
  const bar = document.getElementById('et-progress');
  if(bar) bar.style.width = progress + '%';

  if(remaining <= 0) {
    finishExam();
  }
}

function finishExam() {
  clearInterval(EXAM_STATE.intervalId);
  EXAM_STATE.running = false;
  document.getElementById('exam-timer-overlay').style.display = 'none';

  // 弹出批改界面
  const cfg = EXAM_STATE.config;
  const usedTime = EXAM_STATE.elapsed;
  const minutes = Math.floor(usedTime / 60);
  const seconds = usedTime % 60;
  const timeStr = `${minutes}分${seconds}秒`;

  const content = document.getElementById('exam-modal-content');
  content.innerHTML = `
    <button class="modal-close" onclick="closeModal('exam-modal')">✕</button>
    <div class="modal-title">📝 考试批改 — ${cfg.name}</div>
    <div style="font-size:0.82rem;color:var(--text-secondary);margin-bottom:0.8rem;">
      📘 ${cfg.subject} · ⏱️ 用时 ${timeStr} / ${cfg.duration}分钟 · 📊 总分 ${cfg.totalScore}分
    </div>
    <div class="exam-score-input-grid">
      ${Array.from({length: cfg.qcount}, (_, i) => `
        <div class="exam-score-cell">
          <div>第${i+1}题</div>
          <input type="number" id="exam-q-${i}" placeholder="0" min="0" max="${cfg.totalScore}" value="0">
        </div>
      `).join('')}
    </div>
    <div style="display:flex;gap:0.5rem;margin-top:1rem;">
      <button class="btn-primary" style="flex:1;" onclick="saveExamResult('${timeStr}')">💾 保存成绩</button>
      <button class="sidebar-btn" style="flex:1;min-height:auto;background:var(--bg-body);border:1px solid var(--border-color);padding:10px;border-radius:8px;cursor:pointer;color:var(--text-primary);" onclick="closeModal('exam-modal')">取消</button>
    </div>
  `;
  openModal('exam-modal');
}

function saveExamResult(timeStr) {
  const cfg = EXAM_STATE.config;
  const qcount = cfg.qcount;
  const scores = [];
  for(let i = 0; i < qcount; i++) {
    const el = document.getElementById('exam-q-' + i);
    scores.push(el ? parseInt(el.value) || 0 : 0);
  }
  const totalScored = scores.reduce((a, b) => a + b, 0);
  const records = load('exam_records', []);
  const record = {
    id: Date.now(),
    subject: cfg.subject,
    categoryId: cfg.categoryId,
    name: cfg.name,
    totalScore: cfg.totalScore,
    score: totalScored,
    duration: cfg.duration,
    usedTime: timeStr,
    usedSeconds: EXAM_STATE.elapsed,
    qtype: cfg.qtype,
    qcount: cfg.qcount,
    scores: scores,
    wrongQuestions: scores.map((s, i) => ({ q: i+1, score: s, full: cfg.totalScore / cfg.qcount })).filter(q => q.score < q.full),
    date: new Date().toLocaleDateString('zh-CN'),
    createdAt: Date.now(),
  };
  records.push(record);
  save('exam_records', records);

  // 自动加入错题本
  const wrongCards = load('wrong_cards', []);
  record.wrongQuestions.forEach(wq => {
    wrongCards.unshift({
      question: `${cfg.name} 第${wq.q}题`,
      answer: `得分 ${wq.score}/${wq.full}`,
      note: `来自${cfg.subject}考试`,
      subject: cfg.subject === '数学' ? 'math' : cfg.subject === '语文' ? 'chinese' : cfg.subject === '英语' ? 'english' : 'science',
      interval: 1, efactor: 2.5,
      nextReview: new Date().toLocaleDateString('zh-CN'),
      created: record.date,
    });
  });
  if(record.wrongQuestions.length > 0) save('wrong_cards', wrongCards);

  updateXP(25);
  closeModal('exam-modal');
  toast(`✅ 考试成绩已保存！得分 ${totalScored}/${cfg.totalScore}${record.wrongQuestions.length > 0 ? `，${record.wrongQuestions.length}道错题已自动加入错题本` : ''}`, 4000);
  showPage('exam');
}

function viewExamDetail(id) {
  const records = load('exam_records', []);
  const r = records.find(e => e.id === id);
  if(!r) return;
  const cats = getExamCategories();
  const cat = cats.find(c => c.id === r.categoryId) || { icon: '📝', name: '未知', color: '#64748b' };
  const pct = Math.round(r.score / r.totalScore * 100);
  const stars = pct >= 90 ? '⭐⭐⭐' : pct >= 75 ? '⭐⭐' : pct >= 60 ? '⭐' : '💔';
  const wrongCount = r.wrongQuestions ? r.wrongQuestions.length : 0;

  const content = document.getElementById('exam-modal-content');
  content.innerHTML = `
    <button class="modal-close" onclick="closeModal('exam-modal')">✕</button>
    <div class="modal-title">📄 考试详情</div>
    <div style="font-size:0.9rem;margin-bottom:0.8rem;">
      <strong>${r.subject}</strong> · ${r.name} · ${r.date}
    </div>
    <div class="item-detail-row"><span class="item-detail-label">📂 分类</span><span class="item-detail-value"><span class="exam-category-tag" style="background:${cat.color}20;color:${cat.color};">${cat.icon} ${cat.name}</span></span></div>
    <div class="item-detail-row"><span class="item-detail-label">⏱️ 用时</span><span class="item-detail-value">${r.usedTime} / ${r.duration}分钟</span></div>
    <div class="item-detail-row"><span class="item-detail-label">📊 得分</span><span class="item-detail-value" style="font-size:1.2rem;color:${pct>=85?'#10b981':pct>=60?'#f59e0b':'#ef4444'};font-weight:800;">${r.score} / ${r.totalScore} (${pct}%) ${stars}</span></div>
    <div class="item-detail-row"><span class="item-detail-label">📝 题型/题量</span><span class="item-detail-value">${r.qtype} · ${r.qcount}题</span></div>

    ${r.scores && r.scores.length ? `
      <div style="margin-top:1rem;">
        <div class="section-title">📋 各题得分</div>
        <div class="exam-score-input-grid">
          ${r.scores.map((s, i) => {
            const full = r.totalScore / r.qcount;
            const isWrong = s < full;
            return `<div class="exam-score-cell" style="${isWrong ? 'border-color:#ef4444;' : ''}">
              <div>第${i+1}题</div>
              <div style="font-size:0.9rem;font-weight:700;color:${isWrong ? '#ef4444' : '#10b981'};margin-top:2px;">${s}/${Math.round(full*10)/10} ${isWrong ? '❌' : '✅'}</div>
            </div>`;
          }).join('')}
        </div>
      </div>
    ` : ''}

    <div class="item-detail-row" style="margin-top:1rem;">
      <span class="item-detail-label">错题统计</span>
      <span class="item-detail-value">共 ${wrongCount} 题 ｜ ${wrongCount > 0 ? '已收录错题本 ' + wrongCount + ' 题' : '全部正确 🎉'}</span>
    </div>

    <div style="display:flex;gap:0.5rem;margin-top:1rem;">
      <button class="btn-primary" style="flex:1;" onclick="closeModal('exam-modal')">✅ 关闭</button>
    </div>
  `;
  openModal('exam-modal');
}

function buildExamAnalysisTab() {
  const records = load('exam_records', []);
  const cats = getExamCategories();
  const subjects = ['数学', '语文', '英语', '科学'];

  // 按学科分组
  const bySubject = {};
  subjects.forEach(s => bySubject[s] = []);
  records.forEach(r => {
    if(!bySubject[r.subject]) bySubject[r.subject] = [];
    bySubject[r.subject].push(r);
  });

  // 按分类分组
  const byCategory = {};
  records.forEach(r => {
    if(!byCategory[r.categoryId]) byCategory[r.categoryId] = [];
    byCategory[r.categoryId].push(r);
  });

  // 最近10次
  const recent10 = records.slice(-10);

  return `
    <div style="display:flex;gap:0.3rem;margin-bottom:1rem;flex-wrap:wrap;">
      <button class="shop-cat-tab active" onclick="examFilterSubject('all')">📘 全部</button>
      ${subjects.map(s => `<button class="shop-cat-tab" onclick="examFilterSubject('${s}')">📘 ${s}</button>`).join('')}
    </div>

    <div class="card" style="margin-bottom:1rem;">
      <div class="section-title">📈 成绩趋势图（最近${recent10.length}次）</div>
      <canvas id="exam-trend-canvas" style="width:100%;height:200px;"></canvas>
    </div>

    <div class="card" style="margin-bottom:1rem;">
      <div class="section-title">📊 各科平均分对比</div>
      <div style="display:flex;flex-direction:column;gap:0.5rem;">
        ${subjects.map(s => {
          const subs = bySubject[s] || [];
          if(subs.length === 0) return '';
          const avg = Math.round(subs.reduce((sum, r) => sum + (r.score / r.totalScore * 100), 0) / subs.length * 10) / 10;
          const colors = { 数学:'#3b82f6', 语文:'#ec4899', 英语:'#10b981', 科学:'#f59e0b' };
          return `
            <div style="display:flex;align-items:center;gap:0.6rem;">
              <span style="width:36px;font-size:0.78rem;color:var(--text-secondary);">${s}</span>
              <div style="flex:1;height:14px;background:var(--border-color);border-radius:7px;overflow:hidden;">
                <div style="width:${avg}%;height:100%;background:${colors[s]};border-radius:7px;transition:width 0.6s;"></div>
              </div>
              <span style="font-size:0.78rem;font-weight:700;min-width:60px;text-align:right;">${avg}分</span>
            </div>
          `;
        }).join('') || '<div style="color:var(--text-secondary);font-size:0.85rem;text-align:center;padding:1rem;">还没有考试数据</div>'}
      </div>
    </div>

    <div class="card" style="margin-bottom:1rem;">
      <div class="section-title">📂 各分类平均分</div>
      <div style="display:flex;flex-direction:column;gap:0.5rem;">
        ${cats.map(c => {
          const catRecords = byCategory[c.id] || [];
          if(catRecords.length === 0) return '';
          const avg = Math.round(catRecords.reduce((sum, r) => sum + (r.score / r.totalScore * 100), 0) / catRecords.length * 10) / 10;
          return `
            <div style="display:flex;align-items:center;gap:0.6rem;">
              <span class="exam-category-tag" style="background:${c.color}20;color:${c.color};min-width:80px;justify-content:center;">${c.icon} ${c.name}</span>
              <div style="flex:1;height:14px;background:var(--border-color);border-radius:7px;overflow:hidden;">
                <div style="width:${avg}%;height:100%;background:${c.color};border-radius:7px;transition:width 0.6s;"></div>
              </div>
              <span style="font-size:0.78rem;font-weight:700;min-width:60px;text-align:right;">${avg}分</span>
              <span style="font-size:0.68rem;color:var(--text-secondary);min-width:30px;">${catRecords.length}次</span>
            </div>
          `;
        }).join('') || '<div style="color:var(--text-secondary);font-size:0.85rem;text-align:center;padding:1rem;">还没有考试数据</div>'}
      </div>
    </div>

    <div class="card">
      <div class="section-title">📋 最近考试记录</div>
      ${recent10.slice().reverse().map(r => {
        const cat = cats.find(c => c.id === r.categoryId) || { icon: '📝', name: '未知', color: '#64748b' };
        const pct = Math.round(r.score / r.totalScore * 100);
        const stars = pct >= 90 ? '⭐⭐⭐' : pct >= 75 ? '⭐⭐' : pct >= 60 ? '⭐' : '💔';
        return `
          <div class="exam-record-card" onclick="viewExamDetail(${r.id})">
            <div class="exam-record-info">
              <span class="exam-record-date">${r.date}</span>
              <span class="exam-record-name">${r.subject} · ${r.name}</span>
              <span class="exam-category-tag" style="background:${cat.color}20;color:${cat.color};">${cat.icon} ${cat.name}</span>
            </div>
            <div class="exam-record-score">
              <div class="exam-record-score-val">${r.score}/${r.totalScore}</div>
              <div class="exam-record-score-label">${stars} ${pct}%</div>
            </div>
          </div>
        `;
      }).join('') || '<div style="text-align:center;padding:1.5rem;color:var(--text-secondary);font-size:0.85rem;">还没有考试记录</div>'}
    </div>
  `;
}

function drawExamCharts() {
  const canvas = document.getElementById('exam-trend-canvas');
  if(!canvas) return;
  const records = load('exam_records', []);
  const recent = records.slice(-10);
  if(recent.length === 0) {
    const ctx = canvas.getContext('2d');
    ctx.font = '14px sans-serif';
    ctx.fillStyle = '#8899b4';
    ctx.textAlign = 'center';
    ctx.fillText('还没有考试数据', canvas.width/2, canvas.height/2);
    return;
  }

  const W = canvas.offsetWidth * 2;
  const H = 400;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.scale(2, 2);
  const w = W/2, h = H/2;
  const pad = 30;
  const chartW = w - pad * 2;
  const chartH = h - pad * 2;

  // 网格
  ctx.strokeStyle = isDark() ? '#1e2d45' : '#dce3eb';
  ctx.lineWidth = 1;
  for(let i = 0; i <= 5; i++) {
    const y = pad + (chartH / 5) * i;
    ctx.beginPath();
    ctx.moveTo(pad, y); ctx.lineTo(w - pad, y);
    ctx.stroke();
    ctx.fillStyle = isDark() ? '#8899b4' : '#4a5b6e';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(100 - i * 20, pad - 4, y + 3);
  }

  // X轴标签
  recent.forEach((r, i) => {
    const x = pad + (chartW / Math.max(recent.length, 1)) * (i + 0.5);
    ctx.fillStyle = isDark() ? '#8899b4' : '#4a5b6e';
    ctx.font = '8px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(i + 1, x, h - pad + 14);
  });

  // 折线
  ctx.strokeStyle = '#f97316';
  ctx.lineWidth = 2;
  ctx.beginPath();
  recent.forEach((r, i) => {
    const x = pad + (chartW / Math.max(recent.length, 1)) * (i + 0.5);
    const pct = r.score / r.totalScore * 100;
    const y = pad + chartH * (1 - pct / 100);
    if(i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
    // 点
    ctx.fillStyle = pct >= 85 ? '#10b981' : pct >= 60 ? '#f59e0b' : '#ef4444';
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.stroke();

  // 标题
  ctx.fillStyle = isDark() ? '#e2e8f0' : '#1a2639';
  ctx.font = 'bold 12px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('得分率趋势 (%)', pad, pad - 8);
}

function examFilterSubject(subject) {
  document.querySelectorAll('.shop-cat-tab').forEach(b => b.classList.remove('active'));
  // 根据 subject 查找对应按钮并高亮
  const btns = document.querySelectorAll('.shop-cat-tab');
  const targetText = subject === 'all' ? '📘 全部' : '📘 ' + subject;
  btns.forEach(b => { if(b.textContent.trim() === targetText) b.classList.add('active'); });
  // 简化实现：直接刷新
  if(subject === 'all') {
    showPage('exam');
  } else {
    // 按学科过滤显示（简化：仅提示）
    toast(`筛选：${subject}（请查看全部记录中的${subject}数据）`);
  }
}

function buildExamCategoryTab() {
  const cats = getExamCategories();
  const records = load('exam_records', []);
  return `
    <div class="card">
      <div class="section-title">📂 考试分类管理</div>
      <div style="display:flex;flex-direction:column;gap:0.5rem;margin-bottom:1.5rem;">
        ${cats.map(c => {
          const count = records.filter(r => r.categoryId === c.id).length;
          return `
            <div style="display:flex;align-items:center;gap:0.6rem;padding:10px 12px;background:var(--bg-body);border-radius:8px;border-left:4px solid ${c.color};">
              <span style="font-size:1.4rem;">${c.icon}</span>
              <span style="flex:1;font-size:0.85rem;font-weight:600;">${c.name}</span>
              <span style="font-size:0.72rem;color:var(--text-secondary);">${count} 次考试</span>
              ${!EXAM_CATEGORIES_PRESET.find(p => p.id === c.id) ? `<button onclick="deleteExamCategory('${c.id}')" style="border:none;background:none;cursor:pointer;color:#ef4444;font-size:0.9rem;">🗑️</button>` : ''}
            </div>
          `;
        }).join('')}
      </div>
      <div class="section-title" style="font-size:0.9rem;">➕ 添加自定义分类</div>
      <div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
        <div class="input-clear-wrap" style="flex:1;min-width:120px;">
          <input class="exam-config-input" id="new-cat-name" placeholder="分类名称…">
          <button class="input-clear-btn" onclick="clearInput('new-cat-name')">✕</button>
        </div>
        <input class="exam-config-input" id="new-cat-icon" placeholder="图标Emoji" style="max-width:80px;" value="⭐">
        <input class="exam-config-input" id="new-cat-color" type="color" value="#64748b" style="max-width:50px;height:38px;padding:4px;">
        <button class="btn-primary" onclick="addExamCategory()">添加</button>
      </div>
    </div>
  `;
}

function addExamCategory() {
  const name = document.getElementById('new-cat-name').value.trim();
  const icon = document.getElementById('new-cat-icon').value.trim() || '⭐';
  const color = document.getElementById('new-cat-color').value || '#64748b';
  if(!name) { toast('请输入分类名称'); return; }
  const custom = load('exam_categories', []);
  custom.push({ id: 'custom_' + Date.now(), name, icon, color });
  save('exam_categories', custom);
  toast('✅ 分类已添加');
  examSwitchTab('category');
}

function deleteExamCategory(id) {
  const custom = load('exam_categories', []);
  const filtered = custom.filter(c => c.id !== id);
  save('exam_categories', filtered);
  toast('🗑️ 分类已删除');
  examSwitchTab('category');
}

// =========================================
//  v3.0 积分商店 · 背包系统
// =========================================
const STORE_CATALOG = {
  themes: [
    { id: 'theme_dawn',    name: '破晓启航', icon: '🌅', price: 0,   default: true,  desc: '默认主题，温暖明亮的晨间配色' },
    { id: 'theme_starry',  name: '星海巡航', icon: '🌌', price: 200, desc: '深空暗黑背景，金色星辰点缀，科幻沉浸感' },
    { id: 'theme_matcha',  name: '抹茶森林', icon: '🍵', price: 150, desc: '护眼抹茶绿系，柔和清新，长时间学习不疲劳' },
    { id: 'theme_sakura',  name: '樱花粉黛', icon: '🌸', price: 200, desc: '粉嫩樱花色调，温暖治愈，少女心爆棚' },
    { id: 'theme_autumn',  name: '秋意浓',   icon: '🍁', price: 200, desc: '橙黄秋日系，温馨怀旧' },
    { id: 'theme_ice',     name: '冰雪奇缘', icon: '❄️', price: 200, desc: '冷色调冰雪系，清透干净' },
    { id: 'theme_guofeng', name: '国风雅韵', icon: '🏮', price: 250, desc: '中国风配色，古典优雅' },
  ],
  frames: [
    { id: 'frame_default',  name: '默认头像框', icon: '⚪', price: 0,   default: true, desc: '无装饰的基础头像框' },
    { id: 'frame_dolphin',  name: '小海豚头像框', icon: '🐬', price: 100, desc: '可爱小海豚环绕头像，萌趣十足' },
    { id: 'frame_scholar',  name: '学霸金边框',   icon: '🏆', price: 120, desc: '金色光芒学霸专属边框，身份的象征' },
    { id: 'frame_rainbow',  name: '彩虹昵称特效', icon: '🌈', price: 80,  desc: '昵称显示彩虹渐变流动特效，炫彩夺目' },
  ],
  sounds: [
    { id: 'sound_default', name: '默认铃声', icon: '🔔', price: 0,  default: true, desc: '标准提示铃声' },
    { id: 'sound_page',   name: '翻书白噪音', icon: '📖', price: 50, desc: '舒缓的翻书声，模拟图书馆氛围' },
    { id: 'sound_wave',   name: '海浪专注音', icon: '🌊', price: 50, desc: '温柔海浪拍岸，沉浸式专注音乐' },
    { id: 'sound_birds',  name: '森林鸟鸣',   icon: '🐦', price: 50, desc: '清晨森林鸟鸣，自然的唤醒闹铃' },
  ],
  functions: [
    { id: 'func_rescue',   name: '每日补签卡', icon: '📅', price: 80,  desc: '补上昨天漏掉的打卡，保持连续记录', consumable: true },
    { id: 'func_ai_ask',   name: 'AI追问卡(10次)', icon: '🤖', price: 150, desc: '获得10次额外AI追问机会，深入探索知识点', consumable: true },
    { id: 'func_dnd',      name: '免打扰模式', icon: '🔕', price: 100, desc: '开启后屏蔽所有非必要通知，沉浸学习不被打扰', consumable: false },
  ],
  rewards: [
    { id: 'reward_badge',    name: '专属尊贵铭牌',   icon: '🔰', price: 300, desc: '个人主页展示专属金色铭牌徽章，身份的象征' },
    { id: 'reward_star',     name: '首页置顶表扬位', icon: '⭐', price: 250, desc: '你的学习宣言将出现在首页表扬栏，激励全船同学' },
    { id: 'reward_cert',     name: '荣誉证书生成器', icon: '📜', price: 200, desc: '一键生成精美荣誉证书图片，记录学习里程碑', consumable: true },
  ],
};

const SHOP_TABS = ['theme', 'frame', 'sound', 'function', 'reward'];
const SHOP_TAB_LABELS = { theme: '🎨 主题', frame: '🖼️ 装扮', sound: '🎵 音效', function: '🚀 功能', reward: '🎁 权益' };

// 自定义商品系统（开发者可新增/删除）
function loadCustomItems() {
  try {
    return JSON.parse(localStorage.getItem('ark_global_custom_items') || '[]');
  } catch(e) { return []; }
}
function saveCustomItems(items) {
  localStorage.setItem('ark_global_custom_items', JSON.stringify(items));
}
// 获取合并后的全部商品（内置 + 自定义）
function getMergedCatalog() {
  const custom = loadCustomItems();
  const merged = {};
  // 先复制内置
  Object.keys(STORE_CATALOG).forEach(k => { merged[k] = [...STORE_CATALOG[k]]; });
  // 合并自定义
  custom.forEach(item => {
    const key = item.type + 's'; // type是单数，key是复数
    if(!merged[key]) merged[key] = [];
    merged[key].push(item);
  });
  return merged;
}

// 弹出新增商品弹窗
function openAddCustomItem() {
  const modalHTML = `
    <div class="modal-overlay" id="add-item-modal" onclick="if(event.target===this)closeModal('add-item-modal')">
      <div class="modal-card" style="max-width:420px;">
        <div class="modal-header">
          <span>🛒 新增自定义商品</span>
          <button class="modal-close" onclick="closeModal('add-item-modal')">✕</button>
        </div>
        <div class="modal-body" style="display:flex;flex-direction:column;gap:0.7rem;">
          <div>
            <label style="font-size:0.8rem;font-weight:600;display:block;margin-bottom:0.3rem;">商品名称</label>
            <input id="ci-name" type="text" placeholder="如：深海潜水镜" style="width:100%;padding:0.5rem;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-body);color:var(--text-primary);">
          </div>
          <div style="display:flex;gap:0.6rem;">
            <div style="flex:1;">
              <label style="font-size:0.8rem;font-weight:600;display:block;margin-bottom:0.3rem;">图标（Emoji）</label>
              <input id="ci-icon" type="text" placeholder="🤿" maxlength="4" style="width:100%;padding:0.5rem;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-body);color:var(--text-primary);font-size:1.2rem;text-align:center;">
            </div>
            <div style="flex:1;">
              <label style="font-size:0.8rem;font-weight:600;display:block;margin-bottom:0.3rem;">积分价格</label>
              <input id="ci-price" type="number" placeholder="100" min="0" max="9999" style="width:100%;padding:0.5rem;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-body);color:var(--text-primary);">
            </div>
          </div>
          <div>
            <label style="font-size:0.8rem;font-weight:600;display:block;margin-bottom:0.3rem;">商品类型</label>
            <select id="ci-type" style="width:100%;padding:0.5rem;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-body);color:var(--text-primary);">
              <option value="theme">🎨 主题皮肤</option>
              <option value="frame">🖼️ 头像装扮</option>
              <option value="sound">🎵 提示音效</option>
              <option value="function">🚀 功能道具</option>
              <option value="reward">🎁 荣誉权益</option>
            </select>
          </div>
          <div>
            <label style="font-size:0.8rem;font-weight:600;display:block;margin-bottom:0.3rem;">商品描述</label>
            <input id="ci-desc" type="text" placeholder="简短描述这件商品..." style="width:100%;padding:0.5rem;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-body);color:var(--text-primary);">
          </div>
          <div style="display:flex;gap:0.5rem;align-items:center;">
            <input type="checkbox" id="ci-consumable" style="width:16px;height:16px;">
            <label for="ci-consumable" style="font-size:0.8rem;">可消耗道具（使用后从背包消失）</label>
          </div>
          <button class="btn-primary" onclick="saveCustomItem()" style="width:100%;margin-top:0.3rem;">✅ 上架商品</button>
        </div>
      </div>
    </div>
  `;
  document.getElementById('main-content').insertAdjacentHTML('beforeend', modalHTML);
}

function saveCustomItem() {
  const name = (document.getElementById('ci-name').value || '').trim();
  const icon = (document.getElementById('ci-icon').value || '📦').trim();
  const price = parseInt(document.getElementById('ci-price').value) || 0;
  const type = document.getElementById('ci-type').value;
  const desc = (document.getElementById('ci-desc').value || '').trim();
  const consumable = document.getElementById('ci-consumable').checked;
  if(!name) { toast('⚠️ 请输入商品名称'); return; }
  if(price < 0) { toast('⚠️ 价格不能为负数'); return; }
  const id = 'custom_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
  const newItem = { id, name, icon, price, type, desc, status: 'on', default: false, consumable, isCustom: true };
  const items = loadCustomItems();
  items.push(newItem);
  saveCustomItems(items);
  toast(`✅ 「${name}」已上架！`);
  closeModal('add-item-modal');
  buildStatsPage(document.getElementById('main-content'));
}

function deleteCustomItem(id) {
  if(!confirm('确定删除这个自定义商品吗？已有用户购买的不会被影响。')) return;
  let items = loadCustomItems();
  const item = items.find(i => i.id === id);
  items = items.filter(i => i.id !== id);
  saveCustomItems(items);
  toast(`🗑️ 「${item ? item.name : '商品'}」已删除`);
  buildStatsPage(document.getElementById('main-content'));
}

function buildShopPage(mc) {
  const xp = load('xp', 0);
  mc.innerHTML = `
    <div class="page-title">🛍️ 积分商店 <span class="badge">积分 · 背包 · 兑换</span></div>
    <div class="shop-header">
      <div class="exam-sub-tabs" style="margin-bottom:0;border:none;">
        <button class="exam-sub-tab active" onclick="shopSwitchTab('store')">🏪 商店</button>
        <button class="exam-sub-tab" onclick="shopSwitchTab('backpack')">🎒 我的背包</button>
        <button class="exam-sub-tab" onclick="shopSwitchTab('history')">📜 兑换记录</button>
      </div>
      <div class="shop-points">⚡ 当前积分: <span id="shop-xp">${xp}</span></div>
    </div>
    <div id="shop-tab-content"></div>
    <div class="redeem-bar">
      <button class="btn-primary" onclick="openRedeemCodeModal()" style="width:100%;">🎫 输入兑换码兑换奖励</button>
    </div>
  `;
  shopSwitchTab('store');
}

function shopSwitchTab(tab) {
  document.querySelectorAll('#shop-tab-content').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.exam-sub-tab').forEach(b => b.classList.remove('active'));
  // 根据 tab 参数查找对应按钮并高亮
  const btnMap = { store: 0, backpack: 1, history: 2 };
  const btns = document.querySelectorAll('.shop-header .exam-sub-tab');
  if(btns[btnMap[tab]]) btns[btnMap[tab]].classList.add('active');
  const content = document.getElementById('shop-tab-content');
  if(!content) return;
  if(tab === 'store') content.innerHTML = buildShopStoreTab();
  else if(tab === 'backpack') content.innerHTML = buildShopBackpackTab();
  else if(tab === 'history') content.innerHTML = buildShopHistoryTab();
}

function buildShopStoreTab() {
  const backpack = load('backpack', []);
  const ownedIds = backpack.map(b => b.id);

  let catFilter = 'all';
  return `
    <div class="shop-category-tabs" id="shop-cat-tabs">
      <button class="shop-cat-tab active" onclick="shopFilterCategory('all')">全部</button>
      ${Object.entries(SHOP_TAB_LABELS).map(([k, v]) =>
        `<button class="shop-cat-tab" onclick="shopFilterCategory('${k}')">${v}</button>`
      ).join('')}
    </div>
    <div id="shop-grid-container">
      ${renderShopGrid('all', ownedIds)}
    </div>
  `;
}

// 复数→单数映射：renderShopGrid 用复数key迭代，需转单数type供后续查找
const CAT_TYPE_MAP = { themes:'theme', frames:'frame', sounds:'sound', functions:'function', rewards:'reward' };
const CAT_LOOKUP = (type) => {
  const merged = getMergedCatalog();
  return merged[type] || merged[type + 's'] || STORE_CATALOG[type] || STORE_CATALOG[type + 's'] || [];
};

function renderShopGrid(cat, ownedIds) {
  let items = [];
  const isDev = currentIsDeveloper();
  const catalog = getMergedCatalog();
  Object.entries(catalog).forEach(([catalogKey, list]) => {
    const singularType = CAT_TYPE_MAP[catalogKey] || catalogKey;
    list.forEach(item => {
      items.push({ ...item, type: singularType });
    });
  });
  if(cat !== 'all') items = items.filter(i => i.type === cat);
  // 非开发者：过滤下架商品
  if(!isDev) items = items.filter(i => i.status !== 'off');

  return `
    <div class="shop-grid">
      ${items.map(item => {
        const owned = ownedIds.includes(item.id);
        const active = isItemActive(item.id);
        const isDefault = item.default || item.price === 0;
        const isOff = item.status === 'off';
        return `
          <div class="shop-card ${owned ? 'owned' : ''} ${active ? 'active-item' : ''} ${isOff ? 'off-shelf' : ''}"
               onclick="viewShopItem('${item.id}','${item.type}')"
               ${isDev ? `oncontextmenu="event.preventDefault();showItemManageMenu(event,'${item.id}','${item.type}')"` : ''}
               ${isDev ? `onmousedown="if(event.button===2)event.preventDefault()"` : ''}>
            <div class="shop-card-icon">${item.icon}</div>
            <div class="shop-card-name">${item.name}</div>
            <div class="shop-card-price">${isDefault ? '免费' : item.price + ' 积分'}</div>
            ${isDev ? `<div style="font-size:0.6rem;color:${isOff ? 'var(--danger)' : 'var(--success)'};margin-top:2px;">${isOff ? '📦 已下架' : '✅ 上架中'}</div>` : (isOff ? '<div style="font-size:0.65rem;color:var(--text-secondary);margin-top:2px;">已售罄</div>' : '')}
            <span class="shop-card-btn ${owned ? 'owned' : 'buy'}">
              ${isOff && !isDev ? '暂不可兑换' : (owned ? (active ? '✅ 使用中' : '已拥有') : (isDefault ? '默认' : '查看'))}
            </span>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function shopFilterCategory(cat) {
  document.querySelectorAll('.shop-cat-tab').forEach(b => b.classList.remove('active'));
  // 根据 cat 参数查找对应按钮并高亮
  const catMap = { all: '全部', theme: '🎨 主题', frame: '🖼️ 装扮', sound: '🎵 音效', function: '🚀 功能', reward: '🎁 权益' };
  const targetText = catMap[cat] || '全部';
  const btns = document.querySelectorAll('.shop-cat-tab');
  btns.forEach(b => { if(b.textContent.trim() === targetText) b.classList.add('active'); });
  const backpack = load('backpack', []);
  const ownedIds = backpack.map(b => b.id);
  document.getElementById('shop-grid-container').innerHTML = renderShopGrid(cat, ownedIds);
}

// ===== 商品管理菜单（开发者右键/长按） =====
function showItemManageMenu(e, id, type) {
  e.preventDefault();
  closeItemManageMenu();
  const item = CAT_LOOKUP(type).find(i => i.id === id);
  if(!item) return;

  const menu = document.createElement('div');
  menu.id = 'item-manage-menu';
  menu.style.cssText = `position:fixed;top:${Math.min(e.clientY, window.innerHeight - 200)}px;left:${Math.min(e.clientX, window.innerWidth - 180)}px;z-index:10001;background:var(--card-bg);border:1px solid var(--border-color);border-radius:12px;padding:0.5rem;min-width:160px;box-shadow:0 8px 30px rgba(0,0,0,0.25);`;
  const currentStatus = item.status || 'on';
  const currentPrice = item.price;

  menu.innerHTML = `
    <div style="font-size:0.8rem;font-weight:600;padding:0.5rem 0.8rem;border-bottom:1px solid var(--border-color);margin-bottom:0.3rem;">${item.icon} ${item.name}</div>
    <button class="menu-item" onclick="toggleItemStatus('${id}','${type}')">${currentStatus === 'off' ? '✅ 上架此商品' : '📦 下架此商品'}</button>
    <button class="menu-item" onclick="editItemPrice('${id}','${type}')">✏️ 修改价格（当前 ${currentPrice} 积分）</button>
    <button class="menu-item" style="color:var(--text-secondary);" onclick="closeItemManageMenu()">❌ 取消</button>
  `;
  document.body.appendChild(menu);
  // 点击其他地方关闭
  setTimeout(() => document.addEventListener('click', closeItemManageMenu), 0);
}

function closeItemManageMenu() {
  const m = document.getElementById('item-manage-menu');
  if(m) { m.remove(); document.removeEventListener('click', closeItemManageMenu); }
}

function toggleItemStatus(id, type) {
  const list = CAT_LOOKUP(type);
  const item = list.find(i => i.id === id);
  if(!item) return;
  item.status = item.status === 'off' ? 'on' : 'off';
  closeItemManageMenu();
  toast(item.status === 'off' ? '📦 已下架：' + item.name : '✅ 已上架：' + item.name);
  shopSwitchTab('store');
}

function editItemPrice(id, type) {
  const list = CAT_LOOKUP(type);
  const item = list.find(i => i.id === id);
  if(!item) return;
  const newPrice = prompt(`修改「${item.name}」的价格（当前 ${item.price} 积分）：`, item.price);
  if(newPrice === null || isNaN(parseInt(newPrice)) || parseInt(newPrice) < 0) return;
  item.price = parseInt(newPrice);
  closeItemManageMenu();
  toast('✅ 价格已更新为 ' + newPrice + ' 积分');
  shopSwitchTab('store');
}

function viewShopItem(id, type) {
  const list = CAT_LOOKUP(type);
  const item = list.find(i => i.id === id);
  if(!item) return;
  const backpack = load('backpack', []);
  const owned = backpack.find(b => b.id === id);
  const active = isItemActive(id);
  const xp = load('xp', 0);
  const isDefault = item.default || item.price === 0;
  const typeLabels = { theme: '🎨 主题', frame: '🖼️ 装扮', sound: '🎵 音效', function: '🚀 功能', reward: '🎁 权益' };

  const content = document.getElementById('item-modal-content');
  content.innerHTML = `
    <button class="modal-close" onclick="closeModal('item-modal')">✕</button>
    <div class="modal-title">${item.icon} ${item.name}</div>
    <div class="item-preview" style="background:${getThemePreviewColor(id)};">
      <span style="font-size:3rem;">${item.icon}</span>
    </div>
    <div class="item-detail-row"><span class="item-detail-label">类型</span><span class="item-detail-value">${typeLabels[type] || type}</span></div>
    <div class="item-detail-row"><span class="item-detail-label">价格</span><span class="item-detail-value">${isDefault ? '免费' : item.price + ' 积分'}</span></div>
    <div class="item-detail-row"><span class="item-detail-label">效果</span><span class="item-detail-value">${item.desc || '—'}</span></div>
    <div class="item-detail-row"><span class="item-detail-label">状态</span><span class="item-detail-value">
      ${owned ? (active ? '✅ 使用中' : '✅ 已拥有') : (isDefault ? '默认拥有' : '🔒 未解锁')}
    </span></div>
    ${owned && !active ? `<div class="item-detail-row"><span class="item-detail-label">获取时间</span><span class="item-detail-value">${owned.unlockedAt}</span></div>` : ''}

    <div style="display:flex;gap:0.5rem;margin-top:1.5rem;">
      ${!owned && !isDefault ? `
        <button class="btn-primary" style="flex:1;" onclick="buyShopItem('${id}','${type}')" ${xp < item.price ? 'disabled style="opacity:0.5;cursor:not-allowed;"' : ''}>
          🔓 立即兑换 (${item.price} 积分)
        </button>
      ` : ''}
      ${owned && !active ? `<button class="btn-primary" style="flex:1;" onclick="useShopItem('${id}','${type}')">🎯 使用此${type==='theme'?'主题':type==='frame'?'装扮':type==='sound'?'音效':'功能'}</button>` : ''}
      ${active ? `<button class="sidebar-btn" style="flex:1;min-height:auto;padding:10px;cursor:pointer;" onclick="unuseShopItem('${id}','${type}')">⏸️ 停用</button>` : ''}
      <button class="sidebar-btn" style="flex:1;min-height:auto;padding:10px;cursor:pointer;" onclick="closeModal('item-modal')">💔 关闭</button>
    </div>
  `;
  openModal('item-modal');
}

function getThemePreviewColor(id) {
  const colors = {
    theme_dawn: 'linear-gradient(135deg, #f4f7fc, #fff5ed)',
    theme_starry: 'linear-gradient(135deg, #0a0f1c, #1a1520)',
    theme_matcha: 'linear-gradient(135deg, #d4f4dd, #e8f5e9)',
    theme_sakura: 'linear-gradient(135deg, #fce4ec, #fff0f5)',
    theme_autumn: 'linear-gradient(135deg, #fff3e0, #ffe0b2)',
    theme_ice: 'linear-gradient(135deg, #e3f2fd, #f0f4ff)',
    theme_guofeng: 'linear-gradient(135deg, #fff3e0, #ffe0b2)',
  };
  return colors[id] || 'var(--bg-body)';
}

function buyShopItem(id, type) {
  const list = CAT_LOOKUP(type);
  const item = list.find(i => i.id === id);
  if(!item) return;
  let xp = load('xp', 0);
  if(xp < item.price) { toast('⚠️ 积分不足！还需要 ' + (item.price - xp) + ' 积分'); return; }

  // 扣积分
  xp -= item.price;
  save('xp', xp);

  // 加入背包
  const backpack = load('backpack', []);
  backpack.push({
    id: item.id,
    type: type,
    name: item.name,
    icon: item.icon,
    unlockedAt: new Date().toLocaleDateString('zh-CN'),
    isActive: false,
    isUsed: false,
  });
  save('backpack', backpack);

  // 记录兑换历史
  const history = load('shop_history', []);
  history.push({
    id: Date.now(),
    itemId: item.id,
    itemName: item.name,
    icon: item.icon,
    cost: item.price,
    date: new Date().toLocaleDateString('zh-CN'),
    action: '兑换',
  });
  save('shop_history', history);

  toast(`🎉 兑换成功！已获得 ${item.icon} ${item.name}`);
  closeModal('item-modal');
  updateShopXP();
  shopSwitchTab('store');
}

function useShopItem(id, type) {
  const activeItems = load('active_items', {});
  // 一次性物品
  const backpack = load('backpack', []);
  const item = backpack.find(b => b.id === id);
  if(!item) return;

  // 查catalog判断是否为消耗品（支持functions和rewards中的consumable）
  const catalogItem = CAT_LOOKUP(type).find(i => i.id === id);
  if(catalogItem && catalogItem.consumable) {
    // === 消耗品处理 ===
    if(id === 'func_rescue') {
      // 补签卡：补上最近一次漏掉的打卡日
      const checkin = load('checkin_dates', []);
      const today = new Date().toISOString().slice(0, 10);
      if(checkin.includes(today)) { toast('✅ 今天已经打过卡了，补签卡留着下次用吧！'); closeModal('item-modal'); return; }
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      if(!checkin.includes(yesterday)) {
        checkin.push(yesterday);
        checkin.sort();
        save('checkin_dates', checkin);
        toast(`📅 补签成功！已补上 ${yesterday} 的打卡 ✅`);
        addXP(5, '补签卡');
      } else {
        toast('✅ 昨天已经打过卡了，补签卡留着下次用吧！');
        closeModal('item-modal'); return;
      }
    } else if(id === 'func_ai_ask') {
      // AI追问卡：增加10次AI追问额度
      let aiExtra = load('ai_extra_asks', 0);
      aiExtra += 10;
      save('ai_extra_asks', aiExtra);
      toast(`🤖 AI追问次数 +10！当前额外追问额度：${aiExtra} 次`);
    } else if(id === 'reward_cert') {
      // 荣誉证书生成器
      generateCertificate();
    }
    item.isUsed = true;
    item.isActive = true;
    save('backpack', backpack);
  } else {
    // 非消耗品：切换使用状态
    backpack.forEach(b => {
      if(b.type === type && b.isActive) b.isActive = false;
    });
    item.isActive = true;
    save('backpack', backpack);
    activeItems[type] = id;
    save('active_items', activeItems);

    // 主题切换
    if(type === 'theme') {
      applyTheme(id);
    }

    // 免打扰模式
    if(id === 'func_dnd') {
      toast('🔕 免打扰模式已开启！通知将静默处理');
    }

    // 专属铭牌
    if(id === 'reward_badge') {
      toast('🔰 尊贵铭牌已装备！快去个人中心看看');
    }

    // 首页表扬位
    if(id === 'reward_star') {
      save('homepage_star', { enabled: true, user: LoginManager.getCurrentUser() });
      toast('⭐ 你的学习宣言将出现在首页表扬栏！');
    }

    toast(`✅ 已切换为 ${item.name}`);
  }
  closeModal('item-modal');
  shopSwitchTab('backpack');
}

// ===== 荣誉证书生成 =====
function generateCertificate() {
  const u = LoginManager.getCurrentUser();
  const xp = load('xp', 0);
  const checkin = load('checkin_dates', []);
  const days = checkin ? checkin.length : 0;
  const today = new Date().toLocaleDateString('zh-CN', { year:'numeric', month:'long', day:'numeric' });

  // 用modal展示证书预览
  const content = document.getElementById('item-modal-content');
  content.innerHTML = `
    <button class="modal-close" onclick="closeModal('item-modal')">✕</button>
    <div style="text-align:center;padding:1.5rem;background:linear-gradient(135deg,#fff8e1,#fff3e0);border-radius:1rem;border:3px solid #f59e0b;">
      <div style="font-size:0.8rem;color:#b45309;letter-spacing:2px;margin-bottom:0.5rem;">学海方舟 · 荣誉证书</div>
      <div style="font-size:3rem;margin:0.5rem 0;">📜</div>
      <div style="font-size:1.3rem;font-weight:800;color:#92400e;margin-bottom:0.3rem;">${u}</div>
      <div style="font-size:0.85rem;color:#b45309;">在学海方舟累计航行 <b>${days}</b> 天</div>
      <div style="font-size:0.85rem;color:#b45309;">获得 <b>${xp}</b> 点学习积分</div>
      <div style="font-size:0.85rem;color:#b45309;margin-bottom:0.8rem;">特发此证，以资鼓励！</div>
      <div style="font-size:0.7rem;color:#d97706;">颁发日期：${today}</div>
      <div style="margin-top:1rem;font-size:0.8rem;color:#f59e0b;">⭐ 学海无涯苦作舟 ⭐</div>
    </div>
    <div style="display:flex;gap:0.5rem;margin-top:1rem;">
      <button class="btn-primary" style="flex:1;" onclick="closeModal('item-modal')">💾 已保存</button>
    </div>
  `;
  openModal('item-modal');
}

function unuseShopItem(id, type) {
  const backpack = load('backpack', []);
  const item = backpack.find(b => b.id === id);
  if(!item) return;
  item.isActive = false;
  save('backpack', backpack);
  const activeItems = load('active_items', {});
  if(activeItems[type] === id) delete activeItems[type];
  save('active_items', activeItems);

  if(type === 'theme') {
    applyTheme('theme_dawn');
  }
  if(id === 'func_dnd') {
    toast('🔔 免打扰模式已关闭');
  }
  if(id === 'reward_star') {
    save('homepage_star', { enabled: false });
    toast('⭐ 已取消首页展示');
  }
  if(id === 'reward_badge') {
    toast('🔰 尊贵铭牌已卸下');
  }

  toast(`⏸️ 已停用 ${item.name}`);
  closeModal('item-modal');
  shopSwitchTab('backpack');
}

function isItemActive(id) {
  const backpack = load('backpack', []);
  const item = backpack.find(b => b.id === id);
  return item ? item.isActive : false;
}

function applyTheme(themeId) {
  const themes = {
    theme_dawn: { bg: '#f4f7fc', card: '#ffffff', sidebar: '#0c1a2b', text: '#1a2639', accent: '#f97316' },
    theme_starry: { bg: '#0a0f1c', card: '#151d2e', sidebar: '#050a14', text: '#e2e8f0', accent: '#fbbf24' },
    theme_matcha: { bg: '#f2f7f0', card: '#ffffff', sidebar: '#1a3a20', text: '#1a3a20', accent: '#4ade80' },
    theme_sakura: { bg: '#fdf0f5', card: '#ffffff', sidebar: '#3a1a2e', text: '#3a1a2e', accent: '#ec4899' },
    theme_autumn: { bg: '#fdf6e8', card: '#ffffff', sidebar: '#3a2a0c', text: '#3a2a0c', accent: '#f59e0b' },
    theme_ice: { bg: '#eef4ff', card: '#ffffff', sidebar: '#0c1a2e', text: '#1a2a4e', accent: '#06b6d4' },
    theme_guofeng: { bg: '#fdf6ec', card: '#fffaf0', sidebar: '#3a2a10', text: '#3a2a10', accent: '#dc2626' },
  };
  const t = themes[themeId];
  if(!t) return;
  const root = document.documentElement;
  root.style.setProperty('--bg-body', t.bg);
  root.style.setProperty('--bg-card', t.card);
  root.style.setProperty('--bg-sidebar', t.sidebar);
  root.style.setProperty('--text-primary', t.text);
  root.style.setProperty('--accent', t.accent);
  toast(`🎨 已切换为「${STORE_CATALOG.themes.find(th => th.id === themeId)?.name || '新主题'}」`);
}

function buildShopBackpackTab() {
  const backpack = load('backpack', []);
  const catalog = getMergedCatalog();
  const defaults = [];
  Object.entries(catalog).forEach(([catalogKey, list]) => {
    const singularType = CAT_TYPE_MAP[catalogKey] || catalogKey;
    list.forEach(item => {
      if(item.default || item.price === 0) {
        if(!backpack.find(b => b.id === item.id)) {
          defaults.push({ id: item.id, type: singularType, name: item.name, icon: item.icon, unlockedAt: '默认', isActive: true, isUsed: false });
        }
      }
    });
  });
  const allItems = [...backpack, ...defaults];
  // 使用中的置顶
  const using = allItems.filter(b => b.isActive);
  const notUsing = allItems.filter(b => !b.isActive);

  const typeLabels = { theme: '🎨 主题', frame: '🖼️ 装扮', sound: '🎵 音效', function: '🚀 功能', reward: '🎁 权益' };

  return `
    <div style="margin-bottom:0.8rem;font-size:0.85rem;color:var(--text-secondary);">
      🎒 共 <strong style="color:var(--accent);">${allItems.length}</strong> 件物品
    </div>
    ${using.length > 0 ? `
      <div class="section-title" style="font-size:0.9rem;">✅ 使用中</div>
      <div class="backpack-grid" style="margin-bottom:1.2rem;">
        ${using.map(b => `
          <div class="backpack-item using" onclick="viewShopItem('${b.id}','${b.type}')">
            <span class="backpack-item-icon">${b.icon}</span>
            <div class="backpack-item-info">
              <div class="backpack-item-name">${b.name}</div>
              <div class="backpack-item-type">${typeLabels[b.type] || b.type}</div>
            </div>
            <span class="backpack-item-status using">使用中</span>
          </div>
        `).join('')}
      </div>
    ` : ''}
    <div class="section-title" style="font-size:0.9rem;">📦 全部物品</div>
    <div class="backpack-grid">
      ${notUsing.map(b => `
        <div class="backpack-item ${b.isUsed ? 'used-up' : ''}" onclick="viewShopItem('${b.id}','${b.type}')">
          <span class="backpack-item-icon">${b.icon}</span>
          <div class="backpack-item-info">
            <div class="backpack-item-name">${b.name}</div>
            <div class="backpack-item-type">${typeLabels[b.type] || b.type} · ${b.unlockedAt}</div>
          </div>
          <span class="backpack-item-status ${b.isUsed ? 'used' : ''}">${b.isUsed ? '已使用' : '未使用'}</span>
        </div>
      `).join('') || '<div style="text-align:center;padding:2rem;color:var(--text-secondary);font-size:0.85rem;">背包空空如也，去商店兑换一些道具吧！</div>'}
    </div>
  `;
}

function buildShopHistoryTab() {
  const history = load('shop_history', []);
  const totalCost = history.reduce((sum, h) => sum + h.cost, 0);

  return `
    <div style="margin-bottom:1rem;font-size:0.85rem;color:var(--text-secondary);">
      📜 共兑换 <strong style="color:var(--accent);">${history.length}</strong> 件 ｜ 累计花费 <strong style="color:var(--danger);">${totalCost}</strong> 积分
    </div>
    ${history.slice().reverse().map(h => `
      <div class="exchange-record">
        <span class="exchange-record-date">${h.date}</span>
        <span style="font-size:1.2rem;">${h.icon}</span>
        <span class="exchange-record-name">${h.action} ${h.itemName}</span>
        <span class="exchange-record-cost">-${h.cost} 积分</span>
      </div>
    `).join('') || '<div style="text-align:center;padding:2rem;color:var(--text-secondary);font-size:0.85rem;">还没有兑换记录，去商店看看吧！</div>'}
  `;
}

function updateShopXP() {
  const el = document.getElementById('shop-xp');
  if(el) el.textContent = load('xp', 0);
}

// =========================================
//  v3.0 数据下载中心
// =========================================
function openDataCenter() {
  const content = document.getElementById('data-modal-content');
  const history = load('export_history', []);

  content.innerHTML = `
    <button class="modal-close" onclick="closeModal('data-modal')">✕</button>
    <div class="modal-title">📥 数据下载中心</div>

    <div class="section-title" style="font-size:0.9rem;">选择导出数据</div>
    <div class="data-check-list">
      <label class="data-check-item">
        <input type="checkbox" id="dc-all" onchange="toggleAllDataTypes(this.checked)">
        <span class="data-check-label">☑️ 全部数据</span>
      </label>
      <label class="data-check-item">
        <input type="checkbox" class="dc-type" data-type="plan" checked>
        <span class="data-check-label">📋 计划数据（GTD + 四象限 + 沉浸 + 主题）</span>
      </label>
      <label class="data-check-item">
        <input type="checkbox" class="dc-type" data-type="study" checked>
        <span class="data-check-label">📚 学习记录（错题本 + 每日复盘 + 考试记录）</span>
      </label>
      <label class="data-check-item">
        <input type="checkbox" class="dc-type" data-type="growth" checked>
        <span class="data-check-label">🌱 成长数据（XP + 技能 + 成就）</span>
      </label>
      <label class="data-check-item">
        <input type="checkbox" class="dc-type" data-type="shop" checked>
        <span class="data-check-label">🛍️ 商店数据（背包 + 兑换记录）</span>
      </label>
      <label class="data-check-item">
        <input type="checkbox" class="dc-type" data-type="settings">
        <span class="data-check-label">⚙️ 个人设置（主题 + 配置）</span>
      </label>
    </div>

    <div class="section-title" style="font-size:0.9rem;">导出格式</div>
    <div class="data-format-row">
      <button class="data-format-btn active" data-format="json" onclick="selectFormat(this)">📄 JSON</button>
      <button class="data-format-btn" data-format="csv" onclick="selectFormat(this)">📊 CSV</button>
      <button class="data-format-btn" data-format="txt" onclick="selectFormat(this)">📋 TXT</button>
      <button class="data-format-btn" data-format="html" onclick="selectFormat(this)">📈 HTML报告</button>
    </div>

    <div class="section-title" style="font-size:0.9rem;">时间范围</div>
    <div class="data-range-row">
      <button class="data-range-btn active" data-range="all" onclick="selectRange(this)">全部</button>
      <button class="data-range-btn" data-range="30" onclick="selectRange(this)">最近30天</button>
      <button class="data-range-btn" data-range="90" onclick="selectRange(this)">最近90天</button>
    </div>

    <div style="display:flex;gap:0.5rem;margin-top:1rem;">
      <button class="btn-primary" style="flex:1;" onclick="executeExport()">📤 导出数据</button>
      <button class="sidebar-btn" style="flex:1;min-height:auto;padding:10px;cursor:pointer;" onclick="closeModal('data-modal')">关闭</button>
    </div>

    ${history.length > 0 ? `
      <div class="data-export-history">
        <div class="section-title" style="font-size:0.9rem;">📋 导出历史</div>
        ${history.slice().reverse().map(h => `
          <div class="data-export-record">
            <span style="color:var(--text-secondary);min-width:80px;">${h.date}</span>
            <span style="flex:1;">${h.label}</span>
            <span style="font-size:0.72rem;color:var(--text-secondary);">${h.format.toUpperCase()}</span>
            <span style="font-size:0.72rem;color:var(--text-secondary);">${h.size}</span>
            <button class="data-export-record-download" onclick="reDownloadExport(${h.id})">下载</button>
          </div>
        `).join('')}
      </div>
    ` : ''}
  `;
  openModal('data-modal');
}

function toggleAllDataTypes(checked) {
  document.querySelectorAll('.dc-type').forEach(cb => cb.checked = checked);
}

let _selectedFormat = 'json';
let _selectedRange = 'all';

function selectFormat(btn) {
  document.querySelectorAll('.data-format-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  _selectedFormat = btn.dataset.format;
}

function selectRange(btn) {
  document.querySelectorAll('.data-range-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  _selectedRange = btn.dataset.range;
}

function collectExportData() {
  const types = [];
  document.querySelectorAll('.dc-type:checked').forEach(cb => types.push(cb.dataset.type));
  const data = {};

  if(types.includes('plan') || types.length === 0) {
    data.gtd_tasks = load('gtd_tasks', []);
    data.q1 = load('q1', []); data.q2 = load('q2', []);
    data.q3 = load('q3', []); data.q4 = load('q4', []);
    data.immerse_records = load('immerse_records', []);
    data.immerse_theme = load('immerse_theme', '');
  }
  if(types.includes('study') || types.length === 0) {
    data.wrong_cards = load('wrong_cards', []);
    data.daily_reviews = load('daily_reviews', []);
    data.exam_records = load('exam_records', []);
  }
  if(types.includes('growth') || types.length === 0) {
    data.xp = load('xp', 0);
    data.skills = load('skills', {});
    data.login_days = load('login_days', 0);
  }
  if(types.includes('shop') || types.length === 0) {
    data.backpack = load('backpack', []);
    data.shop_history = load('shop_history', []);
    data.active_items = load('active_items', {});
  }
  if(types.includes('settings') || types.length === 0) {
    data.dark = load('dark', false);
  }

  // 时间范围过滤
  if(_selectedRange !== 'all') {
    const days = parseInt(_selectedRange);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    if(data.daily_reviews) data.daily_reviews = data.daily_reviews.filter(r => new Date(r.date) >= cutoff);
    if(data.immerse_records) data.immerse_records = data.immerse_records.filter(r => new Date(r.date) >= cutoff);
    if(data.exam_records) data.exam_records = data.exam_records.filter(r => new Date(r.date) >= cutoff);
    if(data.gtd_tasks) data.gtd_tasks = data.gtd_tasks.filter(t => !t.created || new Date(t.created) >= cutoff);
  }

  return { data, types };
}

function executeExport() {
  const { data, types } = collectExportData();
  const format = _selectedFormat;
  const user = LoginManager.getCurrentUser() || 'guest';
  const dateStr = new Date().toLocaleDateString('zh-CN').replace(/\//g, '-');
  let content = '';
  let filename = '';
  let mimeType = '';
  let label = '';

  const typeLabels = { plan: '计划', study: '学习', growth: '成长', shop: '商店', settings: '设置' };
  label = types.length > 0 ? types.map(t => typeLabels[t] || t).join('+') : '全部';

  if(format === 'json') {
    content = JSON.stringify(data, null, 2);
    filename = `学海方舟_${user}_${label}_${dateStr}.json`;
    mimeType = 'application/json';
  } else if(format === 'csv') {
    content = convertToCSV(data);
    filename = `学海方舟_${user}_${label}_${dateStr}.csv`;
    mimeType = 'text/csv';
  } else if(format === 'txt') {
    content = convertToTXT(data);
    filename = `学海方舟_${user}_${label}_${dateStr}.txt`;
    mimeType = 'text/plain';
  } else if(format === 'html') {
    content = convertToHTML(data);
    filename = `学海方舟_${user}_学习报告_${dateStr}.html`;
    mimeType = 'text/html';
    label = '学习报告';
  }

  const blob = new Blob([content], { type: mimeType + ';charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  a.click(); URL.revokeObjectURL(url);

  // 记录导出历史
  const history = load('export_history', []);
  const sizeKB = Math.round(blob.size / 1024 * 10) / 10;
  history.push({
    id: Date.now(),
    date: new Date().toLocaleDateString('zh-CN'),
    label: label + '数据',
    format: format,
    size: sizeKB + 'KB',
    filename: filename,
    content: content,
    mimeType: mimeType,
  });
  // 最多保留20条
  if(history.length > 20) history.shift();
  save('export_history', history);
  save('exported', Date.now());

  toast(`📤 已导出 ${label}数据 (${format.toUpperCase()}, ${sizeKB}KB)`);
  closeModal('data-modal');
  openDataCenter();
}

function convertToCSV(data) {
  let csv = '';
  // 考试记录
  if(data.exam_records && data.exam_records.length) {
    csv += '日期,学科,分类,考试名称,得分,总分,正确率,用时,题量\n';
    const cats = getExamCategories();
    data.exam_records.forEach(r => {
      const cat = cats.find(c => c.id === r.categoryId);
      const pct = Math.round(r.score / r.totalScore * 100);
      csv += `${r.date},${r.subject},${cat ? cat.name : '未知'},${r.name},${r.score},${r.totalScore},${pct}%,${r.usedTime || '-'},${r.qcount || '-'}\n`;
    });
    csv += '\n';
  }
  // 错题本
  if(data.wrong_cards && data.wrong_cards.length) {
    csv += '日期,学科,题目,答案,笔记,下次复习\n';
    const subNames = { math: '数学', chinese: '语文', english: '英语', science: '科学' };
    data.wrong_cards.forEach(c => {
      csv += `${c.created || '-'},${subNames[c.subject] || c.subject},"${(c.question || '').replace(/"/g, '""')}","${(c.answer || '').replace(/"/g, '""')}","${(c.note || '').replace(/"/g, '""')}",${c.nextReview || '-'}\n`;
    });
    csv += '\n';
  }
  // 每日复盘
  if(data.daily_reviews && data.daily_reviews.length) {
    csv += '日期,心情,目标完成,收获感悟,费曼输出,明日计划\n';
    data.daily_reviews.forEach(r => {
      csv += `${r.date},${r.mood || '-'},"${(r.goals || '').replace(/"/g, '""').replace(/\n/g, ' ')}","${(r.insight || '').replace(/"/g, '""').replace(/\n/g, ' ')}","${(r.feynman || '').replace(/"/g, '""').replace(/\n/g, ' ')}","${(r.plan || '').replace(/"/g, '""').replace(/\n/g, ' ')}"\n`;
    });
  }
  return csv || '暂无数据';
}

function convertToTXT(data) {
  let txt = '================================\n';
  txt += '   学海方舟 · 学习数据导出\n';
  txt += '   导出时间：' + new Date().toLocaleString('zh-CN') + '\n';
  txt += '================================\n\n';

  if(data.xp !== undefined) {
    txt += `【成长数据】\n累计XP: ${data.xp}\n`;
    if(data.skills) txt += `技能: 专注${data.skills.focus||0} / 记忆${data.skills.memory||0} / 逻辑${data.skills.logic||0} / 创造${data.skills.creative||0}\n`;
    if(data.login_days) txt += `连续登录: ${data.login_days}天\n`;
    txt += '\n';
  }

  if(data.exam_records && data.exam_records.length) {
    txt += `【考试记录】共${data.exam_records.length}次\n`;
    data.exam_records.slice(-10).forEach(r => {
      const pct = Math.round(r.score / r.totalScore * 100);
      txt += `  ${r.date} ${r.subject} ${r.name} → ${r.score}/${r.totalScore} (${pct}%) 用时:${r.usedTime || '-'}\n`;
    });
    txt += '\n';
  }

  if(data.wrong_cards && data.wrong_cards.length) {
    txt += `【错题本】共${data.wrong_cards.length}道\n`;
    data.wrong_cards.slice(-10).forEach(c => {
      txt += `  [${c.subject}] ${c.question}\n    答案: ${c.answer}\n`;
    });
    txt += '\n';
  }

  if(data.daily_reviews && data.daily_reviews.length) {
    txt += `【每日复盘】共${data.daily_reviews.length}天\n`;
    data.daily_reviews.slice(-7).forEach(r => {
      txt += `  ${r.date} ${r.mood || '😊'}\n`;
      if(r.insight) txt += `    收获: ${r.insight.slice(0, 50)}...\n`;
    });
  }

  return txt;
}

function convertToHTML(data) {
  const xp = data.xp || 0;
  const reviews = data.daily_reviews || [];
  const wrongs = data.wrong_cards || [];
  const exams = data.exam_records || [];
  const immerses = data.immerse_records || [];
  const gtd = data.gtd_tasks || [];

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>学海方舟 · 学习报告</title>
<style>
  body { font-family: 'PingFang SC','Microsoft YaHei',sans-serif; margin: 0; padding: 2rem; background: #f4f7fc; color: #1a2639; }
  h1 { color: #f97316; border-bottom: 3px solid #f97316; padding-bottom: 0.5rem; }
  h2 { color: #1a2639; margin-top: 2rem; }
  .card { background: #fff; border-radius: 12px; padding: 1.5rem; margin: 1rem 0; box-shadow: 0 2px 8px rgba(0,0,0,0.06); }
  .stat { display: inline-block; margin: 0.5rem 2rem 0.5rem 0; }
  .stat-num { font-size: 2rem; font-weight: 800; color: #f97316; }
  .stat-label { font-size: 0.85rem; color: #666; }
  table { width: 100%; border-collapse: collapse; margin: 1rem 0; }
  th, td { padding: 8px 12px; text-align: left; border-bottom: 1px solid #eee; font-size: 0.85rem; }
  th { background: #f8f9fa; font-weight: 600; }
  .footer { margin-top: 2rem; padding-top: 1rem; border-top: 1px solid #eee; font-size: 0.75rem; color: #999; }
</style>
</head>
<body>
  <h1>⛵ 学海方舟 · 学习报告</h1>
  <p style="color:#666;">生成时间：${new Date().toLocaleString('zh-CN')}</p>

  <div class="card">
    <h2>📊 学习总览</h2>
    <div class="stat"><div class="stat-num">${xp}</div><div class="stat-label">累计XP</div></div>
    <div class="stat"><div class="stat-num">${gtd.length}</div><div class="stat-label">任务总数</div></div>
    <div class="stat"><div class="stat-num">${wrongs.length}</div><div class="stat-label">错题数</div></div>
    <div class="stat"><div class="stat-num">${reviews.length}</div><div class="stat-label">复盘天数</div></div>
    <div class="stat"><div class="stat-num">${exams.length}</div><div class="stat-label">考试次数</div></div>
    <div class="stat"><div class="stat-num">${immerses.length}</div><div class="stat-label">沉浸次数</div></div>
  </div>

  ${exams.length > 0 ? `
  <div class="card">
    <h2>📝 考试记录</h2>
    <table>
      <tr><th>日期</th><th>学科</th><th>名称</th><th>得分</th><th>正确率</th></tr>
      ${exams.slice(-10).map(r => {
        const pct = Math.round(r.score / r.totalScore * 100);
        return `<tr><td>${r.date}</td><td>${r.subject}</td><td>${r.name}</td><td>${r.score}/${r.totalScore}</td><td>${pct}%</td></tr>`;
      }).join('')}
    </table>
  </div>` : ''}

  ${wrongs.length > 0 ? `
  <div class="card">
    <h2>📕 错题统计</h2>
    <table>
      <tr><th>学科</th><th>题目</th><th>答案</th><th>下次复习</th></tr>
      ${wrongs.slice(-10).map(c => `<tr><td>${c.subject}</td><td>${c.question}</td><td>${c.answer}</td><td>${c.nextReview || '-'}</td></tr>`).join('')}
    </table>
  </div>` : ''}

  ${reviews.length > 0 ? `
  <div class="card">
    <h2>📝 每日复盘</h2>
    <table>
      <tr><th>日期</th><th>心情</th><th>收获</th></tr>
      ${reviews.slice(-7).map(r => `<tr><td>${r.date}</td><td>${r.mood || '😊'}</td><td>${(r.insight || '').slice(0, 60)}${(r.insight || '').length > 60 ? '...' : ''}</td></tr>`).join('')}
    </table>
  </div>` : ''}

  <div class="footer">学海方舟 v3.0 · 学习报告由系统自动生成 · 可直接打印为PDF</div>
</body>
</html>`;
}

function reDownloadExport(id) {
  const history = load('export_history', []);
  const record = history.find(h => h.id === id);
  if(!record) { toast('⚠️ 记录不存在'); return; }
  const blob = new Blob([record.content], { type: record.mimeType + ';charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = record.filename;
  a.click(); URL.revokeObjectURL(url);
  toast(`📥 重新下载 ${record.filename}`);
}

// =========================================
//  v3.0 方舟社区：学海空间
// =========================================

// ===== IndexedDB 图片存储 =====
const IMG_DB_NAME = 'XueHaiDB';
const IMG_STORE = 'post_images';
let _imgDB = null;

function openImgDB() {
  return new Promise((resolve, reject) => {
    if(_imgDB) return resolve(_imgDB);
    const req = indexedDB.open(IMG_DB_NAME, 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if(!db.objectStoreNames.contains(IMG_STORE))
        db.createObjectStore(IMG_STORE);
    };
    req.onsuccess = (e) => { _imgDB = e.target.result; resolve(_imgDB); };
    req.onerror = () => reject(req.error);
  });
}

async function saveImageData(id, dataUrl) {
  const db = await openImgDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IMG_STORE, 'readwrite');
    tx.objectStore(IMG_STORE).put(dataUrl, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getImageData(id) {
  const db = await openImgDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IMG_STORE, 'readonly');
    const req = tx.objectStore(IMG_STORE).get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function deleteImageData(id) {
  const db = await openImgDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IMG_STORE, 'readwrite');
    tx.objectStore(IMG_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ===== Canvas 图片压缩 =====
function compressImage(file, maxW = 1200, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let w = img.width, h = img.height;
        if(w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => reject(new Error('图片加载失败'));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

let SPACE_TAB = 'recommend'; // recommend | following
let SPACE_COMPOSING = false;
let SPACE_UPLOAD_IMAGES = []; // 当前编辑中的图片 dataURL 数组

function getPosts() { return loadGlobal('posts', []); }
function savePosts(posts) { saveGlobal('posts', posts); }
function getUserLikes() { return load('user_likes', []); }
function getUserCollections() { return load('user_collections', []); }

function buildSpacePage(mc) {
  mc.innerHTML = `
    <div class="space-header">
      <div class="space-title">🌊 学海空间</div>
      <div style="display:flex;align-items:center;gap:0.5rem;">
        <button class="space-chat-btn" onclick="openGroupDrawer()" title="学友群聊">
          👥 <span id="chat-badge" class="chat-badge"></span>
        </button>
        <button class="space-post-btn" onclick="openCompose()">✍️ 发布笔记</button>
      </div>
    </div>
    <div class="space-tabs">
      <button class="space-tab active" onclick="spaceSwitchTab('recommend')" data-stab="recommend">🔥 推荐</button>
      <button class="space-tab" onclick="spaceSwitchTab('following')" data-stab="following">👁️ 关注</button>
    </div>
    <div id="space-feed"></div>
  `;
  renderSpaceFeed();
  // 更新群聊小红点
  updateChatBadge();
}

function spaceSwitchTab(tab) {
  SPACE_TAB = tab;
  document.querySelectorAll('.space-tab').forEach(el => el.classList.toggle('active', el.dataset.stab === tab));
  renderSpaceFeed();
}

function openCompose() {
  if(SPACE_COMPOSING) { SPACE_COMPOSING = false; SPACE_UPLOAD_IMAGES = []; renderSpaceFeed(); return; }
  SPACE_COMPOSING = true;
  SPACE_UPLOAD_IMAGES = [];
  const feed = document.getElementById('space-feed');
  if(!feed) return;
  const u = LoginManager.getCurrentUser();
  feed.innerHTML = `
    <div class="space-post-card">
      <div style="font-weight:700;margin-bottom:0.5rem;color:var(--text-primary);">✍️ 发布学习笔记</div>
      <textarea id="compose-text" class="space-compose-textarea" placeholder="分享你的学习心得、计划进展或有趣发现...支持插入图片哦 📸" maxlength="500"></textarea>
      <div class="space-compose-images" id="compose-images"></div>
      <div class="space-compose-actions">
        <label class="space-img-upload-btn" title="添加图片">
          📷 添加图片
          <input type="file" id="compose-img-input" accept="image/*" multiple style="display:none;" onchange="handleComposeImageUpload(event)">
        </label>
        <span style="font-size:0.7rem;color:var(--text-secondary);align-self:center;" id="compose-count">0/500</span>
        <button class="btn-secondary" onclick="SPACE_COMPOSING=false;SPACE_UPLOAD_IMAGES=[];renderSpaceFeed();" style="padding:0.4rem 1rem;border-radius:8px;">取消</button>
        <button class="btn-primary" onclick="publishPost()" style="padding:0.4rem 1rem;border-radius:8px;">📤 发布</button>
      </div>
    </div>
  ` + feed.innerHTML;
  const ta = document.getElementById('compose-text');
  if(ta) {
    ta.addEventListener('input', () => { document.getElementById('compose-count').textContent = ta.value.length + '/500'; });
    setTimeout(() => ta.focus(), 100);
  }
}

async function handleComposeImageUpload(event) {
  const files = event.target.files;
  if(!files || !files.length) return;
  for(const file of files) {
    if(!file.type.startsWith('image/')) { toast('⚠️ 仅支持图片格式'); continue; }
    if(file.size > 10 * 1024 * 1024) { toast('⚠️ 图片不能超过10MB'); continue; }
    try {
      toast('📷 压缩中…', 1500);
      const dataUrl = await compressImage(file, 1200, 0.7);
      SPACE_UPLOAD_IMAGES.push(dataUrl);
      renderComposeImages();
    } catch(e) {
      toast('⚠️ 图片处理失败');
    }
  }
  event.target.value = '';
}

function renderComposeImages() {
  const div = document.getElementById('compose-images');
  if(!div) return;
  div.innerHTML = SPACE_UPLOAD_IMAGES.map((img, i) => `
    <div class="space-compose-img-item">
      <img src="${img}" alt="图片${i+1}">
      <button class="space-compose-img-remove" onclick="SPACE_UPLOAD_IMAGES.splice(${i},1);renderComposeImages();">✕</button>
    </div>
  `).join('');
}

async function publishPost() {
  const ta = document.getElementById('compose-text');
  if(!ta || !ta.value.trim()) { toast('请写点什么吧'); return; }
  const u = LoginManager.getCurrentUser();
  if(!u) return;
  const profile = load('profile', {});
  const posts = getPosts();
  const postId = 'p' + Date.now();

  // 保存图片到 IndexedDB
  const imageIds = [];
  if(SPACE_UPLOAD_IMAGES.length > 0) {
    for(let i = 0; i < SPACE_UPLOAD_IMAGES.length; i++) {
      const imgId = postId + '_img_' + i;
      try { await saveImageData(imgId, SPACE_UPLOAD_IMAGES[i]); imageIds.push(imgId); }
      catch(e) { console.warn('图片保存失败:', e); }
    }
  }

  const post = {
    id: postId,
    author: u,
    avatar: profile.avatar || '⛵',
    badge: profile.badgeTag || '',
    content: ta.value.trim(),
    images: imageIds,
    likes: [],
    collections: [],
    comments: [],
    createdAt: new Date().toISOString(),
    isOfficial: isDeveloper(u),
  };
  posts.unshift(post);
  savePosts(posts);
  SPACE_COMPOSING = false;
  SPACE_UPLOAD_IMAGES = [];
  addXP(5, '发布笔记');
  toast('✅ 笔记发布成功！+5 XP');
  renderSpaceFeed();
}

function toggleLike(postId) {
  const u = LoginManager.getCurrentUser(); if(!u) return;
  const likes = getUserLikes();
  const posts = getPosts();
  const post = posts.find(p => p.id === postId);
  if(!post) return;
  const idx = likes.indexOf(postId);
  if(idx > -1) { likes.splice(idx, 1); post.likes = post.likes.filter(l => l !== u); }
  else { likes.push(postId); post.likes.push(u); }
  save('user_likes', likes);
  savePosts(posts);
  renderSpaceFeed();
}

function toggleCollect(postId) {
  const u = LoginManager.getCurrentUser(); if(!u) return;
  const cols = getUserCollections();
  const posts = getPosts();
  const post = posts.find(p => p.id === postId);
  if(!post) return;
  const idx = cols.indexOf(postId);
  if(idx > -1) { cols.splice(idx, 1); post.collections = post.collections.filter(c => c !== u); }
  else { cols.push(postId); post.collections.push(u); addXP(2, '收藏笔记'); }
  save('user_collections', cols);
  savePosts(posts);
  renderSpaceFeed();
}

async function renderSpaceFeed() {
  const feed = document.getElementById('space-feed');
  if(!feed) return;
  if(SPACE_COMPOSING) { openCompose(); return; }
  let posts = getPosts();
  const u = LoginManager.getCurrentUser();
  const likes = getUserLikes();
  const cols = getUserCollections();

  if(posts.length === 0) {
    feed.innerHTML = `<div class="space-empty">🌊 学海空间还没有笔记<br>成为第一个分享的人吧！</div>`;
    return;
  }

  // 批量加载图片
  const imageCache = {};
  for(const p of posts) {
    if(p.images && p.images.length > 0) {
      for(const imgId of p.images) {
        if(!imageCache[imgId]) {
          try { imageCache[imgId] = await getImageData(imgId); }
          catch(e) { imageCache[imgId] = null; }
        }
      }
    }
  }

  feed.innerHTML = posts.map(p => {
    const isLiked = likes.includes(p.id);
    const isCollected = cols.includes(p.id);
    const time = getRelativeTime(p.createdAt);
    const authorIsBanned = isUserBanned(p.author);
    let imagesHTML = '';
    if(p.images && p.images.length > 0) {
      imagesHTML = `<div class="space-post-images">` +
        p.images.map(imgId => {
          const src = imageCache[imgId] || '';
          return src ? `<img src="${src}" alt="图片" class="space-post-img" onclick="viewSpaceImage(this.src)">` : '';
        }).join('') +
        `</div>`;
    }
    return `
      <div class="space-post-card ${authorIsBanned ? 'banned-post' : ''}" oncontextmenu="event.preventDefault();showPostContextMenu(event,'${p.id}')">
        ${getRecommended().includes(p.id) ? '<div class="rec-badge-banner">⭐ 岛主推荐</div>' : ''}
        <div class="space-post-header">
          <div class="space-post-avatar" onclick="showUserProfile('${escapeHTML(p.author)}')" title="查看 ${escapeHTML(p.author)} 的主页" style="cursor:pointer;">${p.avatar}</div>
          <div style="cursor:pointer;" onclick="showUserProfile('${escapeHTML(p.author)}')">
            <div class="space-post-user">
              ${getUserDisplayName(p.author)}
              ${p.isOfficial ? '<span class="space-post-badge">🛠️ 官方</span>' : ''}
            </div>
            <div class="space-post-time">${time}</div>
          </div>
        </div>
        <div class="space-post-content">${authorIsBanned ? '<span style="color:var(--text-secondary);font-style:italic;">⛔ 该用户已被屏蔽</span>' : escapeHTML(p.content)}</div>
        ${authorIsBanned ? '' : imagesHTML}
        <div class="space-post-actions">
          ${!authorIsBanned ? `
          <button class="space-post-action ${isLiked ? 'liked' : ''}" onclick="toggleLike('${p.id}')">
            ${isLiked ? '❤️' : '🤍'} ${p.likes.length || ''}
          </button>
          <button class="space-post-action ${isCollected ? 'collected' : ''}" onclick="toggleCollect('${p.id}')">
            ${isCollected ? '⭐' : '☆'} ${p.collections.length || ''}
          </button>
          ` : ''}
          <button class="space-post-action" onclick="toggleComment('${p.id}')">
            💬 ${(p.comments || []).length || ''}
          </button>
        </div>
        <div id="comments-${p.id}" class="space-comments" style="display:none;"></div>
      </div>
    `;
  }).join('');
}

// 查看大图
function viewSpaceImage(src) {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.85);z-index:10000;display:flex;align-items:center;justify-content:center;cursor:pointer;';
  overlay.innerHTML = `<img src="${src}" style="max-width:90%;max-height:90%;border-radius:12px;object-fit:contain;">`;
  overlay.onclick = () => overlay.remove();
  document.body.appendChild(overlay);
}

// ===== 学海空间评论 =====
function toggleComment(postId) {
  const div = document.getElementById('comments-' + postId);
  if(!div) return;
  if(div.style.display === 'none') {
    div.style.display = 'block';
    renderComments(postId, div);
  } else {
    div.style.display = 'none';
  }
}

function renderComments(postId, container) {
  const posts = getPosts();
  const post = posts.find(p => p.id === postId);
  if(!post) return;
  const comments = post.comments || [];
  const u = LoginManager.getCurrentUser();

  container.innerHTML = `
    <div class="comment-list">
      ${comments.length === 0 ? '<div style="font-size:0.78rem;color:var(--text-secondary);padding:0.6rem 0;">还没有评论，来说点什么吧</div>' :
        comments.map((c, i) => {
          const cBanned = isUserBanned(c.author);
          const cRevoked = c.revoked;
          const cid = postId + '---' + i;
          return `
          <div class="comment-item ${cBanned ? 'banned-msg' : ''} ${cRevoked ? 'revoked' : ''}" oncontextmenu="${currentIsDeveloper() ? `event.preventDefault();showMsgContextMenu(event,'comment','${cid}','${escapeHTML(c.author)}')` : ''}">
            <span class="comment-avatar" onclick="showUserProfile('${escapeHTML(c.author)}')" style="cursor:pointer;" title="查看 ${escapeHTML(c.author)} 的主页">${c.avatar || '⛵'}</span>
            <div class="comment-body">
              <div class="comment-author" style="cursor:pointer;" onclick="showUserProfile('${escapeHTML(c.author)}')">
                ${getUserDisplayName(c.author)}
                <span class="comment-time">${getRelativeTime(c.time)}</span>
              </div>
              <div class="comment-text">${cRevoked ? '<span style="color:var(--text-secondary);font-style:italic;">🗑 该评论已被撤回</span>' : (cBanned ? '<span style="color:var(--text-secondary);font-style:italic;">⛔ 已被屏蔽</span>' : escapeHTML(c.text))}</div>
            </div>
          </div>
        `}).join('')
      }
    </div>
    <div class="comment-input-wrap">
      <input class="comment-input" id="comment-input-${postId}" placeholder="发表评论…" maxlength="300" onkeydown="if(event.key==='Enter')addComment('${postId}')">
      <button class="btn-primary btn-sm" onclick="addComment('${postId}')">发送</button>
    </div>
  `;
}

function addComment(postId) {
  const u = LoginManager.getCurrentUser();
  if(!u || u === 'guest') { toast('⚠️ 请先登录'); return; }
  if(isUserBanned(u)) { toast('⛔ 你已被禁止发言，无法评论'); return; }
  const input = document.getElementById('comment-input-' + postId);
  if(!input || !input.value.trim()) return;
  const text = input.value.trim();
  if(text.length < 1) return;
  if(text.length > 300) { toast('⚠️ 评论不能超过300字'); return; }

  const posts = getPosts();
  const post = posts.find(p => p.id === postId);
  if(!post) return;
  if(!post.comments) post.comments = [];
  const profile = load('profile', {});
  post.comments.push({
    id: 'c' + Date.now(),
    author: u,
    avatar: profile.avatar || '⛵',
    text: text,
    time: new Date().toISOString(),
  });
  savePosts(posts);

  input.value = '';
  addXP(1, '发表评论');
  // 重新渲染评论区
  const container = document.getElementById('comments-' + postId);
  if(container) renderComments(postId, container);
  // 更新评论计数
  const postCard = document.getElementById('comments-' + postId).closest('.space-post-card');
  if(postCard) {
    const commentBtn = postCard.querySelector('.space-post-action:last-child');
    if(commentBtn) commentBtn.innerHTML = '💬 ' + post.comments.length;
  }
}

// =========================================
//  v3.0 方舟社区：学友群（全员大群）
// =========================================
// 全员大群 — 所有注册用户自动加入的公共聊天室
const GLOBAL_GROUP_ID = 'ark_global_group';
const MSG_MAX_LENGTH = 500;
const MSG_INTERVAL = 10000; // 10秒发言间隔
const DAILY_MSG_LIMIT = 30;
const ONLINE_TIMEOUT = 5 * 60 * 1000; // 5分钟无心跳视为离线
const HEARTBEAT_INTERVAL = 30000; // 30秒心跳

function getGlobalGroup() {
  return loadGlobal('global_group', {
    id: GLOBAL_GROUP_ID,
    name: '学海方舟 · 全员大群',
    desc: '所有船员自动加入的公共频道，分享学习心得，互相鼓励！',
    messages: [],
    memberCount: 0,
  });
}
function saveGlobalGroup(g) { saveGlobal('global_group', g); }

function getOnlineUsers() { return loadGlobal('online_users', {}); }
function saveOnlineUsers(u) { saveGlobal('online_users', u); }

// 心跳：标记当前用户在线
function heartbeatOnline() {
  const u = LoginManager.getCurrentUser();
  if(!u || u === 'guest') return;
  const online = getOnlineUsers();
  online[u] = Date.now();
  // 清理超时用户
  const cutoff = Date.now() - ONLINE_TIMEOUT;
  for(const [name, time] of Object.entries(online)) {
    if(time < cutoff) delete online[name];
  }
  saveOnlineUsers(online);
}

// 获取在线人数
function getOnlineCount() {
  const online = getOnlineUsers();
  return Object.keys(online).length;
}

// 获取在线用户列表
function getOnlineUserList() {
  const online = getOnlineUsers();
  const cutoff = Date.now() - ONLINE_TIMEOUT;
  return Object.entries(online)
    .filter(([, time]) => time >= cutoff)
    .map(([name]) => name);
}

// 每日发言计数
function getDailyMsgCount() {
  const u = LoginManager.getCurrentUser();
  if(!u) return 0;
  const today = new Date().toLocaleDateString('zh-CN');
  const daily = load('daily_msg', { date: today, count: 0 });
  if(daily.date !== today) return 0;
  return daily.count;
}
function incrementDailyMsg() {
  const u = LoginManager.getCurrentUser();
  if(!u) return;
  const today = new Date().toLocaleDateString('zh-CN');
  const daily = load('daily_msg', { date: today, count: 0 });
  if(daily.date !== today) { daily.date = today; daily.count = 1; }
  else daily.count++;
  save('daily_msg', daily);
  return daily.count;
}

// 上次发言时间（防止刷屏）
let _lastMsgTime = 0;

function buildGroupsPage(mc) {
  // 自动心跳
  heartbeatOnline();
  const group = getGlobalGroup();
  const u = LoginManager.getCurrentUser();
  const onlineCount = getOnlineCount();
  const onlineUsers = getOnlineUserList();

  // 注册自动加入群
  if(u && u !== 'guest' && !group.memberCount) {
    group.memberCount = 1;
    saveGlobalGroup(group);
  }

  mc.innerHTML = `
    <div class="group-chat">
      <div class="group-chat-header">
        <div class="group-card-icon" style="font-size:1.5rem;">⛵</div>
        <div class="group-chat-name">${group.name}</div>
        <div class="group-chat-online" id="group-online-count" title="${onlineUsers.slice(0,5).join('、')}${onlineUsers.length>5?'…':''}">
          🟢 ${onlineCount} 人在线
        </div>
      </div>
      <div class="group-chat-messages" id="group-chat-msgs"></div>
      <div class="group-chat-input">
        <input id="group-chat-input" placeholder="和大家聊聊学习心得吧…" maxlength="${MSG_MAX_LENGTH}" onkeydown="if(event.key==='Enter')sendGlobalMessage()">
        <button onclick="sendGlobalMessage()">发送</button>
      </div>
    </div>
  `;
  renderGlobalChat();
  setTimeout(() => {
    const input = document.getElementById('group-chat-input');
    if(input) input.focus();
    const msgsDiv = document.getElementById('group-chat-msgs');
    if(msgsDiv) msgsDiv.scrollTop = msgsDiv.scrollHeight;
  }, 100);
}

function renderGlobalChat() {
  const msgsDiv = document.getElementById('group-chat-msgs');
  if(!msgsDiv) return;
  const group = getGlobalGroup();
  const u = LoginManager.getCurrentUser();
  const msgs = group.messages || [];

  // 更新在线人数
  const onlineEl = document.getElementById('group-online-count');
  if(onlineEl) {
    const onlineUsers = getOnlineUserList();
    onlineEl.textContent = '🟢 ' + onlineUsers.length + ' 人在线';
    onlineEl.title = onlineUsers.slice(0, 5).join('、') + (onlineUsers.length > 5 ? '…' : '');
  }

  if(msgs.length === 0) {
    msgsDiv.innerHTML = `<div class="space-empty" style="padding:2rem;">💬 学海方舟全员大群<br>欢迎所有船员！来打个招呼吧 ⛵</div>`;
    return;
  }

  // 只显示最近100条
  const recentMsgs = msgs.slice(-100);
  msgsDiv.innerHTML = recentMsgs.map((m, i) => {
    const isSelf = m.author === u;
    const time = new Date(m.time).toLocaleTimeString('zh-CN', {hour:'2-digit',minute:'2-digit'});
    const likeCount = (m.likes || []).length;
    const isLiked = (m.likes || []).includes(u);
    const replyCount = (m.replies || []).length;
    const authorIsBanned = isUserBanned(m.author);
    const authorTitle = getUserTitle(m.author);
    const msgId = m.id || ('m' + i);
    return `
      <div class="chat-msg ${isSelf ? 'self' : ''} ${authorIsBanned ? 'banned-msg' : ''}" id="msg-${msgId}" data-msg-id="${msgId}" data-msg-author="${escapeHTML(m.author)}" data-msg-type="global">
        <div class="chat-msg-avatar" onclick="showUserProfile('${escapeHTML(m.author)}')" title="查看 ${escapeHTML(m.author)} 的主页" style="cursor:pointer;">${m.avatar || '⛵'}</div>
        <div style="flex:1;min-width:0;" oncontextmenu="event.preventDefault();showMsgContextMenu(event, 'global', '${msgId}', '${escapeHTML(m.author)}')">
          ${!isSelf ? `<div style="font-size:0.7rem;color:var(--text-secondary);margin-bottom:2px;cursor:pointer;" onclick="showUserProfile('${escapeHTML(m.author)}')">
            ${getUserDisplayName(m.author)}
          </div>` : ''}
          <div class="chat-msg-bubble">${m.revoked ? '<span style="font-style:italic;color:var(--text-secondary);">🗑 该消息已被撤回</span>' : (authorIsBanned ? '<span style="color:var(--text-secondary);font-style:italic;">⛔ 该用户已被屏蔽</span>' : escapeHTML(m.text))}</div>
          <div class="chat-msg-meta">
            <span class="chat-msg-time">${time}</span>
            ${!authorIsBanned && !m.revoked ? `
            <button class="chat-msg-like ${isLiked ? 'liked' : ''}" onclick="toggleMsgLike('${msgId}')">
              ${isLiked ? '❤️' : '🤍'} ${likeCount || ''}
            </button>
            <button class="chat-msg-reply-btn" onclick="replyToMsg('${msgId}', '${escapeHTML(m.author)}')">
              💬 ${replyCount || ''}
            </button>
            ` : ''}
          </div>
          ${m.replies && m.replies.length > 0 ? `
            <div class="chat-msg-replies">
              ${m.replies.slice(-3).map(r => {
                const replyIsBanned = isUserBanned(r.author);
                return `
                <div class="chat-msg-reply">
                  <span class="chat-msg-reply-author" style="cursor:pointer;" onclick="showUserProfile('${escapeHTML(r.author)}')">${replyIsBanned ? r.author + ' ⛔' : r.author}:</span>
                  ${replyIsBanned ? '<span style="color:var(--text-secondary);font-style:italic;">已被屏蔽</span>' : escapeHTML(r.text)}
                </div>
              `}).join('')}
              ${m.replies.length > 3 ? `<div style="font-size:0.65rem;color:var(--text-secondary);">…还有 ${m.replies.length - 3} 条回复</div>` : ''}
            </div>
          ` : ''}
        </div>
      </div>
    `;
  }).join('');
  setTimeout(() => { if(msgsDiv) msgsDiv.scrollTop = msgsDiv.scrollHeight; }, 50);
}

function sendGlobalMessage() {
  const input = document.getElementById('group-chat-input');
  if(!input || !input.value.trim()) return;
  const text = input.value.trim();
  const u = LoginManager.getCurrentUser();
  if(!u) return;
  if(u === 'guest') { toast('⚠️ 游客模式不支持发言，请先注册登船！'); return; }

  // 封禁检查
  if(isUserBanned(u)) {
    toast('⛔ 你已被禁止发言，无法发送消息');
    input.value = '';
    return;
  }

  // 发言长度检查
  if(text.length < 2) { toast('⚠️ 消息太短了，多说几句吧（至少2个字）'); return; }
  if(text.length > MSG_MAX_LENGTH) { toast('⚠️ 消息不能超过' + MSG_MAX_LENGTH + '字'); return; }

  // 发言间隔（10秒）
  const now = Date.now();
  if(now - _lastMsgTime < MSG_INTERVAL) {
    toast('⏳ 发得太快了！请等' + Math.ceil((MSG_INTERVAL - (now - _lastMsgTime)) / 1000) + '秒再发');
    return;
  }

  // 每日上限
  const dailyCount = incrementDailyMsg();
  if(dailyCount > DAILY_MSG_LIMIT) {
    toast('📊 今日发言已达上限（' + DAILY_MSG_LIMIT + '条），明天再来吧！');
    return;
  }

  _lastMsgTime = now;

  // 检查是否是回复
  if(_replyingTo) {
    const group = getGlobalGroup();
    const msg = group.messages.find(m => (m.id || 'm' + m.time) === _replyingTo.msgId);
    if(msg) {
      if(!msg.replies) msg.replies = [];
      msg.replies.push({ author: u, text: text, time: new Date().toISOString() });
      if(msg.replies.length > 20) msg.replies = msg.replies.slice(-20);
      addXP(1, '回复消息');
      saveGlobalGroup(group);
      input.value = '';
      input.placeholder = '和大家聊聊学习心得吧…';
      _replyingTo = null;
      heartbeatOnline();
      renderGlobalChat();
      return;
    }
    _replyingTo = null;
    input.placeholder = '和大家聊聊学习心得吧…';
  }

  // 正常发消息
  const group = getGlobalGroup();
  if(!group.messages) group.messages = [];

  const msg = {
    id: 'm' + Date.now(),
    author: u,
    avatar: (load('profile', {})).avatar || '⛵',
    text: text,
    time: new Date().toISOString(),
    likes: [],
    replies: [],
  };
  group.messages.push(msg);

  // 限制总消息数
  if(group.messages.length > 500) group.messages = group.messages.slice(-500);
  saveGlobalGroup(group);

  addXP(2, '群聊发言');
  heartbeatOnline();

  input.value = '';
  renderGlobalChat();
  setTimeout(() => {
    const inp = document.getElementById('group-chat-input');
    if(inp) inp.focus();
  }, 50);
}

// 消息点赞
function toggleMsgLike(msgId) {
  const u = LoginManager.getCurrentUser();
  if(!u || u === 'guest') { toast('⚠️ 游客不能点赞，请先登船'); return; }
  const group = getGlobalGroup();
  const msg = group.messages.find(m => (m.id || 'm' + m.time) === msgId);
  if(!msg) return;
  if(!msg.likes) msg.likes = [];
  const idx = msg.likes.indexOf(u);
  if(idx > -1) msg.likes.splice(idx, 1);
  else {
    msg.likes.push(u);
    addXP(1, '点赞他人');
  }
  saveGlobalGroup(group);
  renderGlobalChat();
}

// 回复消息
let _replyingTo = null;
function replyToMsg(msgId, author) {
  _replyingTo = { msgId, author };
  const input = document.getElementById('group-chat-input');
  if(input) {
    input.placeholder = '回复 ' + author + '：';
    input.focus();
  }
  toast('💬 正在回复 ' + author);
}

// ===== 学友群右侧抽屉 =====
function openGroupDrawer() {
  heartbeatOnline();
  const group = getGlobalGroup();
  const u = LoginManager.getCurrentUser();
  const onlineUsers = getOnlineUserList();
  const onlineCount = onlineUsers.length;

  // 自动加入群
  if(u && u !== 'guest' && !group.memberCount) {
    group.memberCount = 1;
    saveGlobalGroup(group);
  }

  // 渲染抽屉内容
  const content = document.getElementById('group-drawer-content');
  content.innerHTML = `
    <div class="group-chat">
      <div class="group-chat-header">
        <div class="group-card-icon" style="font-size:1.4rem;">⛵</div>
        <div class="group-chat-name">${group.name}</div>
        <div class="group-chat-online" id="drawer-online-count" title="${onlineUsers.slice(0,5).join('、')}${onlineUsers.length>5?'…':''}">
          🟢 ${onlineCount} 人在线
        </div>
      </div>
      <div class="group-chat-messages" id="drawer-chat-msgs"></div>
      <div class="group-chat-input">
        <input id="drawer-chat-input" placeholder="和大家聊聊学习心得吧…" maxlength="${MSG_MAX_LENGTH}" onkeydown="if(event.key==='Enter')sendDrawerMessage()">
        <button onclick="sendDrawerMessage()">发送</button>
      </div>
    </div>
  `;

  // 开抽屉
  document.getElementById('group-drawer').classList.add('open');
  document.getElementById('group-drawer-overlay').classList.add('open');
  document.body.style.overflow = 'hidden';

  renderDrawerChat();
  setTimeout(() => {
    const input = document.getElementById('drawer-chat-input');
    if(input) input.focus();
    const msgsDiv = document.getElementById('drawer-chat-msgs');
    if(msgsDiv) msgsDiv.scrollTop = msgsDiv.scrollHeight;
  }, 150);

  // 清除小红点
  document.getElementById('chat-badge')?.classList.remove('show');
  save('drawer_last_read', Date.now());
}

function closeGroupDrawer() {
  document.getElementById('group-drawer').classList.remove('open');
  document.getElementById('group-drawer-overlay').classList.remove('open');
  document.body.style.overflow = '';
  _replyingTo = null;
}

function renderDrawerChat() {
  const msgsDiv = document.getElementById('drawer-chat-msgs');
  if(!msgsDiv) return;
  const group = getGlobalGroup();
  const u = LoginManager.getCurrentUser();
  const msgs = group.messages || [];

  // 更新在线人数
  const onlineEl = document.getElementById('drawer-online-count');
  if(onlineEl) {
    const onlineUsers = getOnlineUserList();
    onlineEl.textContent = '🟢 ' + onlineUsers.length + ' 人在线';
    onlineEl.title = onlineUsers.slice(0, 5).join('、') + (onlineUsers.length > 5 ? '…' : '');
  }

  if(msgs.length === 0) {
    msgsDiv.innerHTML = `<div class="space-empty" style="padding:2rem;">💬 学海方舟全员大群<br>欢迎所有船员！来打个招呼吧 ⛵</div>`;
    return;
  }

  const recentMsgs = msgs.slice(-100);
  msgsDiv.innerHTML = recentMsgs.map((m, i) => {
    const isSelf = m.author === u;
    const time = new Date(m.time).toLocaleTimeString('zh-CN', {hour:'2-digit',minute:'2-digit'});
    const likeCount = (m.likes || []).length;
    const isLiked = (m.likes || []).includes(u);
    const replyCount = (m.replies || []).length;
    const msgId = m.id || ('dm' + i);
    return `
      <div class="chat-msg ${isSelf ? 'self' : ''}" id="drawer-msg-${msgId}">
        <div class="chat-msg-avatar">${m.avatar || '⛵'}</div>
        <div style="flex:1;min-width:0;" oncontextmenu="${currentIsDeveloper() ? `event.preventDefault();showMsgContextMenu(event,'global','${msgId}','${escapeHTML(m.author)}')` : ''}">
          ${!isSelf ? '<div style="font-size:0.7rem;color:var(--text-secondary);margin-bottom:2px;">'+m.author+'</div>' : ''}
          <div class="chat-msg-bubble">${m.revoked ? '<span style="font-style:italic;color:var(--text-secondary);">🗑 该消息已被撤回</span>' : escapeHTML(m.text)}</div>
          <div class="chat-msg-meta">
            <span class="chat-msg-time">${time}</span>
            ${!m.revoked ? `
            <button class="chat-msg-like ${isLiked ? 'liked' : ''}" onclick="toggleDrawerMsgLike('${msgId}')">
              ${isLiked ? '❤️' : '🤍'} ${likeCount || ''}
            </button>
            <button class="chat-msg-reply-btn" onclick="replyToDrawerMsg('${msgId}', '${escapeHTML(m.author)}')">
              💬 ${replyCount || ''}
            </button>
            ` : ''}
          </div>
          ${m.replies && m.replies.length > 0 ? `
            <div class="chat-msg-replies">
              ${m.replies.slice(-3).map(r => `
                <div class="chat-msg-reply">
                  <span class="chat-msg-reply-author">${r.author}:</span> ${escapeHTML(r.text)}
                </div>
              `).join('')}
              ${m.replies.length > 3 ? `<div style="font-size:0.65rem;color:var(--text-secondary);">…还有 ${m.replies.length - 3} 条回复</div>` : ''}
            </div>
          ` : ''}
        </div>
      </div>
    `;
  }).join('');
  setTimeout(() => { if(msgsDiv) msgsDiv.scrollTop = msgsDiv.scrollHeight; }, 50);
}

function sendDrawerMessage() {
  const input = document.getElementById('drawer-chat-input');
  if(!input || !input.value.trim()) return;
  const text = input.value.trim();
  const u = LoginManager.getCurrentUser();
  if(!u) return;
  if(u === 'guest') { toast('⚠️ 游客模式不支持发言，请先注册登船！'); return; }

  if(text.length < 2) { toast('⚠️ 消息太短了，多说几句吧（至少2个字）'); return; }
  if(text.length > MSG_MAX_LENGTH) { toast('⚠️ 消息不能超过' + MSG_MAX_LENGTH + '字'); return; }

  const now = Date.now();
  if(now - _lastMsgTime < MSG_INTERVAL) {
    toast('⏳ 发得太快了！请等' + Math.ceil((MSG_INTERVAL - (now - _lastMsgTime)) / 1000) + '秒再发');
    return;
  }

  const dailyCount = incrementDailyMsg();
  if(dailyCount > DAILY_MSG_LIMIT) {
    toast('📊 今日发言已达上限（' + DAILY_MSG_LIMIT + '条），明天再来吧！');
    return;
  }

  _lastMsgTime = now;

  const group = getGlobalGroup();
  if(!group.messages) group.messages = [];

  // 回复逻辑
  if(_replyingTo) {
    const msg = group.messages.find(m => (m.id || 'dm' + m.time) === _replyingTo.msgId);
    if(msg) {
      if(!msg.replies) msg.replies = [];
      msg.replies.push({ author: u, text: text, time: new Date().toISOString() });
      if(msg.replies.length > 20) msg.replies = msg.replies.slice(-20);
      addXP(1, '回复消息');
      saveGlobalGroup(group);
      input.value = '';
      input.placeholder = '和大家聊聊学习心得吧…';
      _replyingTo = null;
      heartbeatOnline();
      renderDrawerChat();
      return;
    }
    _replyingTo = null;
    input.placeholder = '和大家聊聊学习心得吧…';
  }

  const msg = {
    id: 'dm' + Date.now(),
    author: u,
    avatar: (load('profile', {})).avatar || '⛵',
    text: text,
    time: new Date().toISOString(),
    likes: [],
    replies: [],
  };
  group.messages.push(msg);
  if(group.messages.length > 500) group.messages = group.messages.slice(-500);
  saveGlobalGroup(group);

  addXP(2, '群聊发言');
  heartbeatOnline();

  input.value = '';
  renderDrawerChat();
  setTimeout(() => {
    const inp = document.getElementById('drawer-chat-input');
    if(inp) inp.focus();
  }, 50);
}

function toggleDrawerMsgLike(msgId) {
  const u = LoginManager.getCurrentUser();
  if(!u || u === 'guest') { toast('⚠️ 游客不能点赞，请先登船'); return; }
  const group = getGlobalGroup();
  const msg = group.messages.find(m => (m.id || 'dm' + m.time) === msgId);
  if(!msg) return;
  if(!msg.likes) msg.likes = [];
  const idx = msg.likes.indexOf(u);
  if(idx > -1) msg.likes.splice(idx, 1);
  else { msg.likes.push(u); addXP(1, '点赞他人'); }
  saveGlobalGroup(group);
  renderDrawerChat();
}

function replyToDrawerMsg(msgId, author) {
  _replyingTo = { msgId, author };
  const input = document.getElementById('drawer-chat-input');
  if(input) {
    input.placeholder = '回复 ' + author + '：';
    input.focus();
  }
  toast('💬 正在回复 ' + author);
}

function updateChatBadge() {
  const badge = document.getElementById('chat-badge');
  if(!badge) return;
  const lastRead = load('drawer_last_read', 0);
  const group = getGlobalGroup();
  const msgs = group.messages || [];
  if(msgs.length === 0) { badge.classList.remove('show'); return; }
  const lastMsgTime = new Date(msgs[msgs.length - 1].time).getTime();
  if(lastMsgTime > lastRead) {
    badge.classList.add('show');
  } else {
    badge.classList.remove('show');
  }
}

// =========================================
//  v3.0 方舟社区：排行榜
// =========================================
let LEADERBOARD_TAB = 'xp'; // xp | pomodoro | checkin | weekly

function buildLeaderboardPage(mc) {
  mc.innerHTML = `
    <div class="leaderboard-header">
      <div class="leaderboard-title">🏅 排行榜</div>
    </div>
    <div class="leaderboard-tabs">
      <button class="leaderboard-tab active" onclick="leaderboardSwitchTab('xp')" data-ltab="xp">⭐ XP总榜</button>
      <button class="leaderboard-tab" onclick="leaderboardSwitchTab('pomodoro')" data-ltab="pomodoro">🍅 番茄榜</button>
      <button class="leaderboard-tab" onclick="leaderboardSwitchTab('checkin')" data-ltab="checkin">🔥 打卡榜</button>
      <button class="leaderboard-tab" onclick="leaderboardSwitchTab('weekly')" data-ltab="weekly">📅 周榜</button>
    </div>
    <div id="leaderboard-list"></div>
  `;
  renderLeaderboard();
}

function leaderboardSwitchTab(tab) {
  LEADERBOARD_TAB = tab;
  document.querySelectorAll('.leaderboard-tab').forEach(el => el.classList.toggle('active', el.dataset.ltab === tab));
  renderLeaderboard();
}

function getAllUsers() {
  const users = new Set();
  for(let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if(key.startsWith('ark_') && !key.includes('global_')) {
      const parts = key.split('_');
      if(parts.length >= 2) users.add(parts[1]);
    }
  }
  return [...users];
}

function getLeaderboardData(tab) {
  const users = getAllUsers();
  const currentUser = LoginManager.getCurrentUser();
  let data = [];

  users.forEach(username => {
    const prefix = 'ark_' + username + '_';
    switch(tab) {
      case 'xp': {
        const xpRaw = localStorage.getItem(prefix + 'xp');
        const xp = xpRaw ? parseInt(xpRaw) || 0 : 0;
        data.push({ username, value: xp, detail: '积分: ' + (parseInt(localStorage.getItem(prefix+'shop_points')||'0')||0) });
        break;
      }
      case 'pomodoro': {
        let count = 0;
        const tasksRaw = localStorage.getItem(prefix + 'gtd_tasks');
        if(tasksRaw) {
          try { const tasks = JSON.parse(tasksRaw); if(Array.isArray(tasks)) count = tasks.filter(t => t.done && (t.pomos > 0)).reduce((s,t) => s + (t.pomos||0), 0); } catch(e) {}
        }
        data.push({ username, value: count, detail: '完成任务: ' + (JSON.parse(localStorage.getItem(prefix+'gtd_tasks')||'[]')).filter(t=>t.done).length });
        break;
      }
      case 'checkin': {
        const checkinRaw = localStorage.getItem(prefix + 'checkin');
        let streak = 0; let total = 0;
        if(checkinRaw) {
          try { const c = JSON.parse(checkinRaw); streak = c.streakDays || 0; total = c.totalCheckins || 0; } catch(e) {}
        }
        data.push({ username, value: streak, detail: '总签到: ' + total + ' 天' });
        break;
      }
      case 'weekly': {
        let weekXP = 0;
        const xpRaw = localStorage.getItem(prefix + 'xp');
        if(xpRaw) weekXP = parseInt(xpRaw) || 0;
        const records = load('exam_records', []);
        const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);
        const recentExams = records.filter(r => new Date(r.date) >= weekAgo);
        data.push({ username, value: weekXP, detail: '本周考试: ' + recentExams.length + ' 次' });
        break;
      }
    }
  });

  data.sort((a, b) => b.value - a.value);
  return { data, currentUser };
}

function renderLeaderboard() {
  const list = document.getElementById('leaderboard-list');
  if(!list) return;
  const { data, currentUser } = getLeaderboardData(LEADERBOARD_TAB);

  if(data.length === 0) {
    list.innerHTML = `<div class="space-empty">📊 暂无排行数据</div>`;
    return;
  }

  const myRank = data.findIndex(d => d.username === currentUser) + 1;

  const medals = ['🥇', '🥈', '🥉'];
  list.innerHTML = data.map((d, i) => {
    const isMe = d.username === currentUser;
    let rankClass = 'normal';
    if(i === 0) rankClass = 'gold';
    else if(i === 1) rankClass = 'silver';
    else if(i === 2) rankClass = 'bronze';
    const rankDisplay = i < 3 ? medals[i] : '#' + (i + 1);

    return `
      <div class="leaderboard-rank-card ${isMe ? 'me' : ''}">
        <div class="leaderboard-rank-num ${rankClass}">${rankDisplay}</div>
        <div class="leaderboard-rank-avatar">${i < 3 ? '' : '⛵'}</div>
        <div class="leaderboard-rank-info">
          <div class="leaderboard-rank-name">
            ${d.username}
            ${isDeveloper(d.username) ? '<span style="font-size:0.65rem;background:gold;color:#333;padding:1px 6px;border-radius:4px;">🛠️ 开发者</span>' : ''}
            ${isMe ? '<span style="font-size:0.7rem;color:var(--accent);">(我)</span>' : ''}
          </div>
          <div class="leaderboard-rank-detail">${d.detail}</div>
        </div>
        <div class="leaderboard-rank-score">${d.value.toLocaleString()}</div>
      </div>
    `;
  }).join('');

  if(myRank > 0) {
    list.innerHTML += `
      <div class="leaderboard-my-rank">
        <div class="leaderboard-my-rank-label">🏅 我的排名</div>
        <div class="leaderboard-my-rank-value">第 ${myRank} 名 / ${data.length} 人</div>
      </div>
    `;
  }
}

// =========================================
//  v3.0 方舟社区：个人中心
// =========================================
const TITLE_RULES = [
  { id: 'math_master', icon: '🧮', name: '数学达人', check: () => countSubjectTasks('数学') >= 50 },
  { id: 'chinese_master', icon: '📝', name: '语文才子', check: () => countSubjectTasks('语文') >= 50 },
  { id: 'english_master', icon: '🌍', name: '英语学霸', check: () => countSubjectTasks('英语') >= 50 },
  { id: 'science_master', icon: '🔬', name: '科学先锋', check: () => countSubjectTasks('科学') >= 50 },
  { id: 'pomo_god', icon: '🍅', name: '番茄大神', check: () => APP.pomoCount >= 100 },
  { id: 'wrong_killer', icon: '📕', name: '错题收割机', check: () => load('wrong_cards', []).length >= 50 },
  { id: 'checkin_king', icon: '🔥', name: '打卡狂人', check: () => (load('checkin', {})).streakDays >= 30 },
  { id: 'all_rounder', icon: '⭐', name: '全能选手', check: () => countSubjectTasks('数学') >= 20 && countSubjectTasks('语文') >= 20 && countSubjectTasks('英语') >= 20 && countSubjectTasks('科学') >= 20 },
  { id: 'feynman_heir', icon: '🧠', name: '费曼传人', check: () => load('daily_reviews', []).filter(r => r.feynman).length >= 30 },
  { id: 'flow_master', icon: '💧', name: '心流大师', check: () => load('immerse_records', []).length >= 20 },
  { id: 'social_star', icon: '📖', name: '社交达人', check: () => getPosts().filter(p => p.author === LoginManager.getCurrentUser()).length >= 20 },
  { id: 'exam_god', icon: '📝', name: '考试战神', check: () => load('exam_records', []).length >= 20 },
  { id: 'ark_pilot', icon: '⛵', name: '方舟领航员', check: () => (parseInt(load('xp','0')) || 0) >= 5000 },
];

function countSubjectTasks(subject) {
  return load('gtd_tasks', []).filter(t => t.subject === subject && t.done).length;
}

function getUnlockedTitles() {
  return TITLE_RULES.filter(t => t.check()).map(t => ({ id: t.id, icon: t.icon, name: t.name }));
}

let _viewingUser = null;

function showUserProfile(targetUser) {
  _viewingUser = targetUser;
  showPage('profile');
}

function buildProfilePage(mc) {
  const viewing = _viewingUser;
  _viewingUser = null;
  const u = LoginManager.getCurrentUser();
  const isOwn = !viewing || viewing === u;
  const targetUser = isOwn ? u : viewing;
  const isDev = isDeveloper(u);
  const targetIsDev = isDeveloper(targetUser);

  if(!targetUser) {
    mc.innerHTML = '<div class="space-empty">找不到该用户</div>';
    return;
  }

  const targetProfile = getUserProfile(targetUser);
  const profile = isOwn ? load('profile', {}) : targetProfile;
  const motto = profile.motto || '计划不白写 · 扬帆起航';
  const xp = isOwn ? (parseInt(load('xp', '0')) || 0) : (targetProfile.xp || 0);
  const points = isOwn ? (parseInt(load('shop_points', '0')) || 0) : 0;
  const pomos = isOwn ? APP.pomoCount : 0;
  const tasks = isOwn ? load('gtd_tasks', []) : [];
  const doneTasks = isOwn ? tasks.filter(t => t.done).length : (targetProfile.completedPlans || 0);
  const exams = isOwn ? load('exam_records', []).length : 0;
  const unlockedTitles = isOwn ? getUnlockedTitles() : [];
  const activeTitle = isOwn ? (profile.activeTitle || '') : '';
  const isBanned = isUserBanned(targetUser);

  // 获取该用户发布的笔记
  const allPosts = getPosts().filter(p => p.author === targetUser).slice(0, 6);
  // 获取该用户最近的评论
  const allComments = [];
  getPosts().forEach(p => {
    if(p.comments) {
      p.comments.filter(c => c.author === targetUser).forEach(c => {
        allComments.push({ ...c, postId: p.id, postContent: p.content });
      });
    }
  });
  const recentComments = allComments.slice(-3).reverse();

  // 该用户的学习时长（从pomo估算）
  const studyHours = isOwn ? Math.round(pomos * 25 / 60) : (targetProfile.studyHours || Math.round(xp / 10));

  mc.innerHTML = `
    <div class="profile-card">
      <div class="profile-header">
        <div class="profile-avatar" id="profile-avatar-display" style="position:relative;cursor:${isOwn ? 'pointer' : 'default'};" ${isOwn ? 'onclick="openAvatarActionSheet()"' : ''}>${targetProfile.avatar || '⛵'}${isOwn ? '<div class="profile-avatar-edit-hint">📷</div>' : ''}</div>
        <div class="profile-info">
          <div class="profile-name">
            ${targetUser}
            ${targetIsDev ? '<span class="profile-badge">👑 开发者</span>' : ''}
            ${targetProfile.role === 'special' ? '<span class="profile-badge">⭐ 特殊用户</span>' : ''}
            ${targetProfile.title ? '<span class="user-badge-title" style="display:inline-block;margin-left:4px;">' + escapeHTML(targetProfile.title) + '</span>' : ''}
            ${isBanned ? '<span style="display:inline-block;margin-left:4px;background:#dc2626;color:#fff;padding:2px 8px;border-radius:10px;font-size:0.7rem;">⛔ 已封禁</span>' : ''}
          </div>
          <div class="profile-motto">${isOwn && activeTitle ? activeTitle + ' · ' : ''}"${motto}"</div>
        </div>
        ${!isOwn ? '<button class="btn-secondary btn-sm" onclick="showPage(\'profile\')">← 返回我的主页</button>' : ''}
      </div>
      <div class="profile-stats">
        <div class="profile-stat"><div class="profile-stat-num">${xp.toLocaleString()}</div><div class="profile-stat-label">总 XP</div></div>
        <div class="profile-stat"><div class="profile-stat-num">${studyHours}h</div><div class="profile-stat-label">学习时长</div></div>
        <div class="profile-stat"><div class="profile-stat-num">${doneTasks}</div><div class="profile-stat-label">完成计划</div></div>
        ${isOwn ? `<div class="profile-stat"><div class="profile-stat-num">${points.toLocaleString()}</div><div class="profile-stat-label">积分</div></div>` : ''}
      </div>
    </div>

    ${!isOwn ? `
    <div class="profile-section">
      <div class="profile-section-title">📖 ${targetUser} 发布的笔记</div>
      <div style="display:flex;flex-wrap:wrap;gap:0.6rem;">
        ${allPosts.length === 0 ? '<span style="font-size:0.8rem;color:var(--text-secondary);">还没有发布过笔记</span>' : allPosts.map(p => `
          <div class="card" style="width:calc(50% - 0.3rem);min-width:140px;padding:0.6rem;cursor:pointer;" onclick="showPage('space')">
            <div style="font-size:0.8rem;font-weight:600;margin-bottom:0.3rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHTML(p.content.slice(0, 30))}${p.content.length > 30 ? '...' : ''}</div>
            <div style="font-size:0.65rem;color:var(--text-secondary);">❤️ ${p.likes.length || 0} · 💬 ${(p.comments || []).length || 0} · ${getRelativeTime(p.createdAt)}</div>
          </div>
        `).join('')}
      </div>
    </div>

    <div class="profile-section">
      <div class="profile-section-title">💬 ${targetUser} 最近的评论</div>
      ${recentComments.length === 0 ? '<span style="font-size:0.8rem;color:var(--text-secondary);">暂无评论</span>' : recentComments.map(c => `
        <div style="padding:0.5rem 0;border-bottom:1px solid var(--border-color);font-size:0.8rem;">
          <div style="color:var(--accent);margin-bottom:0.2rem;">${escapeHTML(c.text)}</div>
          <div style="color:var(--text-secondary);font-size:0.65rem;">回复了：${escapeHTML(c.postContent.slice(0, 40))}...</div>
        </div>
      `).join('')}
    </div>
    ` : ''}

    ${isOwn ? `
    <div class="profile-section">
      <div class="profile-section-title">🏷️ 学习称号 <span style="font-size:0.7rem;color:var(--text-secondary);">（${unlockedTitles.length}个已解锁）</span></div>
      <div class="profile-title-list">
        ${unlockedTitles.length > 0 ? unlockedTitles.map(t => `
          <span class="profile-title-tag ${activeTitle === t.name ? 'equipped' : ''}">${t.icon} ${t.name}</span>
        `).join('') : '<span style="font-size:0.8rem;color:var(--text-secondary);">继续努力解锁称号吧！</span>'}
      </div>
      ${unlockedTitles.length > 0 ? `
        <div class="profile-title-select">
          <select id="title-select">
            <option value="">-- 选择展示称号 --</option>
            ${unlockedTitles.map(t => `<option value="${t.name}" ${activeTitle === t.name ? 'selected' : ''}>${t.icon} ${t.name}</option>`).join('')}
          </select>
          <button onclick="equipTitle()">✅ 设置</button>
        </div>
      ` : ''}
    </div>

    <div class="profile-section">
      <div class="profile-section-title">📝 学习宣言</div>
      <input id="profile-motto-input" class="profile-motto-input" placeholder="${motto}" value="${motto}" maxlength="40">
      <button class="profile-motto-save" onclick="updateProfileMotto()">💾 保存宣言</button>
    </div>

    <div class="profile-section">
      <div class="profile-section-title">📊 学习数据</div>
      <div class="profile-action-list">
        <button class="profile-action-item" onclick="showPage('stats')"><span class="profile-action-icon">📈</span> 学习统计</button>
        <button class="profile-action-item" onclick="showPage('achievements')"><span class="profile-action-icon">🏆</span> 成就徽章</button>
        <button class="profile-action-item" onclick="showPage('exam')"><span class="profile-action-icon">📝</span> 考试记录 (${exams}次)</button>
        <button class="profile-action-item" onclick="showPage('shop')"><span class="profile-action-icon">🛍️</span> 背包物品</button>
        <button class="profile-action-item" onclick="showPage('feedback')"><span class="profile-action-icon">📝</span> 问题反馈</button>
        <button class="profile-action-item" onclick="showPage('feedback-records')"><span class="profile-action-icon">📋</span> 我的反馈记录</button>
      </div>
    </div>
    ` : ''}

    ${!isOwn ? `
    <div class="profile-section" style="display:flex;gap:0.6rem;flex-wrap:wrap;">
      <button class="btn-secondary btn-sm" onclick="showPage('space')">📖 查看全部笔记</button>
      ${isDev ? `<button class="btn-primary btn-sm" onclick="openGivePoints('${targetUser}')">💰 发放积分</button>` : ''}
      ${isDev ? `<button class="btn-primary btn-sm" onclick="openGrantTitle('${targetUser}')">🏷️ 授予称号</button>` : ''}
      ${isDev ? `<button class="btn-secondary btn-sm" onclick="openRenameUser('${targetUser}')">✏️ 修改名称</button>` : ''}
      ${isDev && !targetIsDev ? (isBanned ? `<button class="btn-secondary btn-sm" onclick="doUnbanUser('${targetUser}')">✅ 解除封禁</button>` : `<button class="btn-secondary btn-sm" onclick="doBanUserConfirm('${targetUser}')" style="background:#dc2626;color:#fff;">⛔ 封禁用户</button>`) : ''}
    </div>
    ` : ''}

    ${isDev ? `
    <div class="profile-section">
      <div class="profile-section-title">🛠️ 开发者面板</div>
      <div class="profile-action-list" id="dev-panel"></div>
    </div>
    ` : ''}
  `;

  if(isDev) {
    setTimeout(() => {
      const panel = document.getElementById('dev-panel');
      if(!panel) return;
      const totalUsers = getAllUsers().length;
      const totalPosts = getPosts().length;
      const totalClasses = getGlobalClasses().length;
      const bannedCount = getGlobalBanned().length;
      panel.innerHTML = `
        <div style="font-size:0.85rem;padding:0.3rem 0;">👥 总用户数：<strong>${totalUsers}</strong></div>
        <div style="font-size:0.85rem;padding:0.3rem 0;">📝 总笔记数：<strong>${totalPosts}</strong></div>
        <div style="font-size:0.85rem;padding:0.3rem 0;">🎓 总小班数：<strong>${totalClasses}</strong></div>
        <div style="font-size:0.85rem;padding:0.3rem 0;">⛔ 封禁用户：<strong>${bannedCount}</strong></div>
        <button class="btn-secondary btn-sm" style="margin-top:0.5rem;" onclick="showPage('stats')">⚙️ 完整管理后台 →</button>
      `;
    }, 50);
  }

  // 异步加载头像
  setTimeout(function() {
    var avatarEl = document.getElementById('profile-avatar-display');
    if(avatarEl) renderAvatar(targetUser, avatarEl, 64, true);
  }, 50);
}

// ===== 用户操作（称号/封禁确认） =====
function openGrantTitle(targetUser) {
  const title = prompt('请输入要授予「' + targetUser + '」的称号（如：学海之星、早起冠军）：');
  if(!title || !title.trim()) return;
  const p = getUserProfile(targetUser);
  p.title = title.trim();
  p.role = 'special';
  saveUserProfile(targetUser, p);
  toast('✅ 已授予「' + title.trim() + '」给 ' + targetUser);
  _viewingUser = targetUser;
  buildProfilePage(document.getElementById('main-content'));
}

function doBanUserConfirm(targetUser) {
  if(!confirm('确定要封禁用户「' + targetUser + '」吗？\n封禁后该用户将无法发言，已有消息将被折叠。')) return;
  banUser(targetUser);
  _viewingUser = targetUser;
  buildProfilePage(document.getElementById('main-content'));
}

function doUnbanUser(targetUser) {
  unbanUser(targetUser);
  _viewingUser = targetUser;
  buildProfilePage(document.getElementById('main-content'));
}

function equipTitle() {
  const sel = document.getElementById('title-select');
  if(!sel) return;
  const title = sel.value;
  const profile = load('profile', {});
  if(title) {
    profile.activeTitle = title;
    save('profile', profile);
    toast('✅ 称号已设置为：' + title);
  } else {
    profile.activeTitle = null;
    save('profile', profile);
    toast('已移除展示称号');
  }
  buildProfilePage(document.getElementById('main-content'));
}

function updateProfileMotto() {
  const input = document.getElementById('profile-motto-input');
  if(!input) return;
  const motto = input.value.trim();
  const profile = load('profile', {});
  profile.motto = motto || '计划不白写 · 扬帆起航';
  save('profile', profile);
  toast('✅ 学习宣言已保存');
  buildProfilePage(document.getElementById('main-content'));
}

function getRelativeTime(isoString) {
  const now = new Date();
  const then = new Date(isoString);
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMs / 3600000);
  const diffDay = Math.floor(diffMs / 86400000);
  if(diffMin < 1) return '刚刚';
  if(diffMin < 60) return diffMin + '分钟前';
  if(diffHr < 24) return diffHr + '小时前';
  if(diffDay < 7) return diffDay + '天前';
  return then.toLocaleDateString('zh-CN');
}

function escapeHTML(str) {
  if(!str && str !== 0) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// =========================================
//  v5.0 开发者特权系统 · 岛主工具箱
// =========================================

// ---- 操作日志 ----
function getAdminLog() { return loadGlobal('admin_log', []); }
function saveAdminLog(log) { saveGlobal('admin_log', log); }
function adminLog(action, detail, target) {
  const log = getAdminLog();
  log.unshift({ action, detail, target, operator: LoginManager.getCurrentUser(), time: new Date().toISOString() });
  if(log.length > 500) log.length = 500;
  saveAdminLog(log);
}

// ---- 积分流水 ----
function getPointLog(username) { return loadByUser(username, 'point_log', []); }
function savePointLog(username, log) { saveByUser(username, 'point_log', log); }
function recordPointFlow(username, amount, reason, operator) {
  const log = getPointLog(username);
  log.unshift({ amount, reason, operator, time: new Date().toISOString() });
  if(log.length > 200) log.length = 200;
  savePointLog(username, log);
}

// ---- 积分红包发放 ----
function openGivePoints(targetUser) {
  const modal = document.getElementById('modal-give-points');
  if(modal) modal.remove();
  const div = document.createElement('div');
  div.id = 'modal-give-points';
  div.className = 'modal-overlay';
  div.innerHTML = `
    <div class="modal-box" style="max-width:420px;" onclick="event.stopPropagation()">
      <div class="modal-title">💰 发放积分</div>
      <div style="margin-bottom:0.8rem;font-size:0.85rem;color:var(--text-secondary);">发放对象：<strong style="color:var(--text-primary);">${escapeHTML(targetUser)}</strong></div>
      <div style="margin-bottom:0.6rem;">
        <label style="font-size:0.8rem;color:var(--text-secondary);">积分数量</label>
        <input type="number" id="give-points-amount" class="give-points-input" placeholder="输入积分数量" value="100" min="1" max="99999" style="width:100%;padding:0.6rem 0.8rem;border:1px solid var(--border-color);border-radius:10px;font-size:1rem;background:var(--bg-body);color:var(--text-primary);margin-top:0.3rem;">
      </div>
      <div style="margin-bottom:1rem;">
        <label style="font-size:0.8rem;color:var(--text-secondary);">发放理由</label>
        <input type="text" id="give-points-reason" class="give-points-input" placeholder="如：全勤奖🏆" maxlength="30" style="width:100%;padding:0.6rem 0.8rem;border:1px solid var(--border-color);border-radius:10px;font-size:0.9rem;background:var(--bg-body);color:var(--text-primary);margin-top:0.3rem;">
      </div>
      <div style="font-size:0.7rem;color:var(--text-secondary);margin-bottom:1rem;">积分将直接计入对方余额，并记录流水</div>
      <div style="display:flex;gap:0.6rem;">
        <button class="btn-primary" onclick="doGivePoints('${escapeHTML(targetUser)}')" style="flex:1;">✅ 确认发放</button>
        <button class="btn-secondary" onclick="document.getElementById('modal-give-points').remove()" style="flex:1;">取消</button>
      </div>
    </div>
  `;
  div.onclick = function() { this.remove(); };
  document.body.appendChild(div);
}

function doGivePoints(targetUser) {
  const amountEl = document.getElementById('give-points-amount');
  const reasonEl = document.getElementById('give-points-reason');
  const amount = parseInt(amountEl.value) || 0;
  const reason = reasonEl.value.trim() || '岛主红包';
  if(amount <= 0) { toast('请输入有效积分数量'); return; }
  if(amount > 99999) { toast('单次最多发放 99999 积分'); return; }

  const currentPoints = loadByUser(targetUser, 'shop_points', 0);
  saveByUser(targetUser, 'shop_points', currentPoints + amount);
  recordPointFlow(targetUser, amount, reason, LoginManager.getCurrentUser());
  adminLog('发放积分', `向 ${targetUser} 发放 ${amount} 积分，理由：${reason}`, targetUser);

  document.getElementById('modal-give-points').remove();
  toast(`✅ 已向 ${targetUser} 发放 ${amount} 积分！`);
  _viewingUser = targetUser;
  buildProfilePage(document.getElementById('main-content'));
}

// ---- 全服公告 ----
function getAnnouncement() { return loadGlobal('announcement', { text: '', time: 0, author: '' }); }
function saveAnnouncement(ann) { saveGlobal('announcement', ann); }
function publishAnnouncement(text) {
  if(!text || !text.trim()) { toast('公告内容不能为空'); return; }
  saveAnnouncement({ text: text.trim(), time: Date.now(), author: LoginManager.getCurrentUser() });
  adminLog('发布公告', text.trim().slice(0, 100));
  document.getElementById('modal-publish-ann').remove();
  toast('📢 全服公告已发布！');
  // 刷新首页
  if(APP.currentPage === 'home') buildHomePage(document.getElementById('main-content'));
  if(APP.currentPage === 'stats') buildStatsPage(document.getElementById('main-content'));
}

function openPublishAnnouncement() {
  const modal = document.getElementById('modal-publish-ann');
  if(modal) modal.remove();
  const ann = getAnnouncement();
  const div = document.createElement('div');
  div.id = 'modal-publish-ann';
  div.className = 'modal-overlay';
  div.innerHTML = `
    <div class="modal-box" style="max-width:500px;" onclick="event.stopPropagation()">
      <div class="modal-title">📢 发布全服公告</div>
      <div style="margin-bottom:0.6rem;">
        <label style="font-size:0.8rem;color:var(--text-secondary);">公告内容 <span style="font-size:0.65rem;">（支持加粗 **文字**，彩色 [color]文字）</span></label>
        <textarea id="ann-text" class="give-points-input" placeholder="输入公告内容..." maxlength="200" style="width:100%;padding:0.6rem 0.8rem;border:1px solid var(--border-color);border-radius:10px;font-size:0.9rem;background:var(--bg-body);color:var(--text-primary);margin-top:0.3rem;resize:vertical;min-height:80px;">${ann.text || ''}</textarea>
      </div>
      <div style="font-size:0.7rem;color:var(--text-secondary);margin-bottom:0.8rem;">当前公告：${ann.text ? '<span style="color:var(--accent);">' + ann.text.slice(0, 40) + (ann.text.length > 40 ? '...' : '') + '</span>' : '暂无公告'} ${ann.time ? '· ' + getRelativeTime(new Date(ann.time).toISOString()) : ''}</div>
      <div style="display:flex;gap:0.6rem;">
        <button class="btn-primary" onclick="publishAnnouncement(document.getElementById('ann-text').value)" style="flex:1;">✅ 发布公告</button>
        <button class="btn-danger btn-sm" onclick="clearAnnouncement()">🗑 清除</button>
        <button class="btn-secondary btn-sm" onclick="document.getElementById('modal-publish-ann').remove()">取消</button>
      </div>
    </div>
  `;
  div.onclick = function() { this.remove(); };
  document.body.appendChild(div);
}

function clearAnnouncement() {
  saveAnnouncement({ text: '', time: 0, author: '' });
  adminLog('清除公告');
  document.getElementById('modal-publish-ann').remove();
  toast('🗑 公告已清除');
  if(APP.currentPage === 'home') buildHomePage(document.getElementById('main-content'));
}

function dismissAnnouncement() {
  const banner = document.getElementById('announcement-banner');
  if(banner) banner.style.display = 'none';
  sessionStorage.setItem('ark_ann_dismissed', '1');
}

// ---- 兑换码系统 ----
function getExchangeCodes() { return loadGlobal('exchange_codes', {}); }
function saveExchangeCodes(codes) { saveGlobal('exchange_codes', codes); }

function generateExchangeCode() {
  const modal = document.getElementById('modal-gen-code');
  if(modal) modal.remove();
  const div = document.createElement('div');
  div.id = 'modal-gen-code';
  div.className = 'modal-overlay';
  div.innerHTML = `
    <div class="modal-box" style="max-width:420px;" onclick="event.stopPropagation()">
      <div class="modal-title">🎫 生成兑换码</div>
      <div style="margin-bottom:0.6rem;">
        <label style="font-size:0.8rem;color:var(--text-secondary);">奖励类型</label>
        <select id="code-type" style="width:100%;padding:0.6rem;border:1px solid var(--border-color);border-radius:10px;background:var(--bg-body);color:var(--text-primary);margin-top:0.3rem;">
          <option value="points">💰 积分</option>
          <option value="item">🎁 道具</option>
        </select>
      </div>
      <div style="margin-bottom:0.6rem;" id="code-amount-wrap">
        <label style="font-size:0.8rem;color:var(--text-secondary);">积分数量</label>
        <input type="number" id="code-amount" value="50" min="1" max="99999" style="width:100%;padding:0.6rem;border:1px solid var(--border-color);border-radius:10px;background:var(--bg-body);color:var(--text-primary);margin-top:0.3rem;">
      </div>
      <div style="margin-bottom:0.6rem;" id="code-item-wrap" style="display:none;">
        <label style="font-size:0.8rem;color:var(--text-secondary);">道具ID</label>
        <input type="text" id="code-item-id" placeholder="如: cat_husky_icon" style="width:100%;padding:0.6rem;border:1px solid var(--border-color);border-radius:10px;background:var(--bg-body);color:var(--text-primary);margin-top:0.3rem;">
      </div>
      <div style="margin-bottom:0.8rem;">
        <label style="font-size:0.8rem;color:var(--text-secondary);">过期日期（可选）</label>
        <input type="date" id="code-expire" style="width:100%;padding:0.6rem;border:1px solid var(--border-color);border-radius:10px;background:var(--bg-body);color:var(--text-primary);margin-top:0.3rem;">
      </div>
      <div style="display:flex;gap:0.6rem;">
        <button class="btn-primary" onclick="doGenerateCode()" style="flex:1;">🎫 生成兑换码</button>
        <button class="btn-secondary" onclick="document.getElementById('modal-gen-code').remove()" style="flex:1;">取消</button>
      </div>
    </div>
  `;
  div.onclick = function() { this.remove(); };
  document.body.appendChild(div);

  // 切换奖励类型
  setTimeout(() => {
    const typeSel = document.getElementById('code-type');
    const itemWrap = document.getElementById('code-item-wrap');
    const amountWrap = document.getElementById('code-amount-wrap');
    if(typeSel) typeSel.onchange = function() {
      if(this.value === 'item') {
        amountWrap.style.display = 'none';
        itemWrap.style.display = 'block';
      } else {
        amountWrap.style.display = 'block';
        itemWrap.style.display = 'none';
      }
    };
  }, 50);
}

function doGenerateCode() {
  const type = document.getElementById('code-type').value;
  const expire = document.getElementById('code-expire').value;
  const codes = getExchangeCodes();

  let code;
  do { code = generateRandomCode(); } while(codes[code]);

  const reward = {};
  if(type === 'points') {
    const amount = parseInt(document.getElementById('code-amount').value) || 50;
    reward.type = 'points';
    reward.value = amount;
  } else {
    const itemId = document.getElementById('code-item-id').value.trim();
    if(!itemId) { toast('请输入道具ID'); return; }
    reward.type = 'item';
    reward.value = itemId;
  }

  codes[code] = {
    reward,
    used: false,
    usedBy: null,
    expire: expire || '',
    created: Date.now(),
    creator: LoginManager.getCurrentUser()
  };
  saveExchangeCodes(codes);
  adminLog('生成兑换码', `生成 ${code}（${type === 'points' ? reward.value + '积分' : '道具' + reward.value}）`);

  document.getElementById('modal-gen-code').remove();
  toast(`🎫 兑换码已生成：${code}`);
  if(APP.currentPage === 'stats') buildStatsPage(document.getElementById('main-content'));
}

function generateRandomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for(let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function openRedeemCodeModal() {
  const modal = document.getElementById('modal-redeem-code');
  if(modal) modal.remove();
  const div = document.createElement('div');
  div.id = 'modal-redeem-code';
  div.className = 'modal-overlay';
  div.innerHTML = `
    <div class="modal-box" style="max-width:400px;" onclick="event.stopPropagation()">
      <div class="modal-title">🎫 兑换码</div>
      <div style="margin-bottom:1rem;">
        <input type="text" id="redeem-code-input" placeholder="输入6位兑换码" maxlength="6" style="width:100%;padding:0.7rem;border:2px solid var(--accent);border-radius:12px;font-size:1.2rem;text-align:center;letter-spacing:4px;background:var(--bg-body);color:var(--text-primary);text-transform:uppercase;">
      </div>
      <div style="display:flex;gap:0.6rem;">
        <button class="btn-primary" onclick="doRedeemCode()" style="flex:1;">✅ 兑换</button>
        <button class="btn-secondary" onclick="document.getElementById('modal-redeem-code').remove()" style="flex:1;">取消</button>
      </div>
    </div>
  `;
  div.onclick = function() { this.remove(); };
  document.body.appendChild(div);
  setTimeout(() => {
    const inp = document.getElementById('redeem-code-input');
    if(inp) {
      inp.focus();
      inp.addEventListener('keydown', function(e) { if(e.key === 'Enter') doRedeemCode(); });
    }
  }, 100);
}

function doRedeemCode() {
  const input = document.getElementById('redeem-code-input');
  if(!input) return;
  const code = input.value.toUpperCase().trim();
  if(code.length < 4) { toast('请输入完整的兑换码'); return; }

  const codes = getExchangeCodes();
  const record = codes[code];
  if(!record) { toast('❌ 兑换码不存在'); return; }
  if(record.used) { toast('❌ 该兑换码已被使用'); return; }
  if(record.expire) {
    const expDate = new Date(record.expire + 'T23:59:59');
    if(new Date() > expDate) { toast('❌ 该兑换码已过期'); return; }
  }

  const u = LoginManager.getCurrentUser();
  if(!u || u === 'guest') { toast('请先登录'); return; }

  if(record.reward.type === 'points') {
    const currentPoints = load('shop_points', 0);
    save('shop_points', currentPoints + record.reward.value);
    recordPointFlow(u, record.reward.value, '兑换码: ' + code, 'SYSTEM');
  } else if(record.reward.type === 'item') {
    const backpack = load('backpack', []).filter(b => b.type !== 'default');
    backpack.push({ id: record.reward.value, name: '兑换道具', type: 'function', icon: '🎁', obtained: Date.now() });
    save('backpack', backpack);
  }

  record.used = true;
  record.usedBy = u;
  codes[code] = record;
  saveExchangeCodes(codes);
  adminLog('兑换码被使用', `${u} 使用了兑换码 ${code}`, u);

  document.getElementById('modal-redeem-code').remove();
  const rewardDesc = record.reward.type === 'points' ? `${record.reward.value} 积分` : '专属道具';
  toast(`🎉 兑换成功！获得 ${rewardDesc}！`);
}

// ---- 消息撤回 ----
function revokeGlobalMessage(msgId) {
  const group = getGlobalGroup();
  const idx = group.messages.findIndex(m => m.id === msgId);
  if(idx === -1) return;
  group.messages[idx].revoked = true;
  group.messages[idx].revokedBy = LoginManager.getCurrentUser();
  saveGlobalGroup(group);
  adminLog('撤回消息', `撤回全局消息 ${msgId}（作者：${group.messages[idx].author}）`, group.messages[idx].author);
  renderGlobalChat();
  renderDrawerChat();
  toast('🗑 消息已撤回');
}

function revokeComment(postId, commentIndex) {
  const posts = getPosts();
  const post = posts.find(p => p.id === postId);
  if(!post || !post.comments) return;
  if(commentIndex < 0 || commentIndex >= post.comments.length) return;
  const comment = post.comments[commentIndex];
  post.comments[commentIndex].revoked = true;
  post.comments[commentIndex].revokedBy = LoginManager.getCurrentUser();
  savePosts(posts);
  adminLog('撤回评论', `撤回评论（作者：${comment.author}）`, comment.author);
  // 刷新评论区
  const section = document.getElementById('comments-' + postId);
  if(section) renderComments(postId, section);
  toast('🗑 评论已撤回');
}

function revokeClassMessage(classId, msgId) {
  const cls = getClassById(classId);
  if(!cls) return;
  const idx = cls.messages.findIndex(m => m.id === msgId);
  if(idx === -1) return;
  cls.messages[idx].revoked = true;
  cls.messages[idx].revokedBy = LoginManager.getCurrentUser();
  updateClassById(classId, () => {});
  adminLog('撤回班级消息', `撤回 ${classId} 班消息（作者：${cls.messages[idx].author}）`);
  renderClassChat();
  toast('🗑 消息已撤回');
}

// ---- 全局推荐 ----
function getRecommended() { return loadGlobal('recommended_posts', []); }
function saveRecommended(list) { saveGlobal('recommended_posts', list); }

function recommendPost(postId) {
  const posts = getPosts();
  const post = posts.find(p => p.id === postId);
  if(!post) { toast('笔记不存在'); return; }
  const recommended = getRecommended();
  const idx = recommended.indexOf(postId);
  if(idx >= 0) {
    recommended.splice(idx, 1);
    saveRecommended(recommended);
    adminLog('取消推荐', `取消推荐笔记 - ${post.content.slice(0, 30)}`);
    toast('已取消推荐');
  } else {
    recommended.push(postId);
    saveRecommended(recommended);
    adminLog('推荐笔记', `推荐笔记到首页 - ${post.content.slice(0, 30)}`, post.author);
    toast('⭐ 已推荐到首页！');
  }
}

// ---- 冷启动机器人 ----
const BOT_NAMES = ['小海豹', '企鹅同学', '海豚学霸', '星鱼学姐', '章鱼哥', '贝壳妹妹', '珊瑚学友', '海龟大哥', '鲸鱼老师', '海马小弟'];
const BOT_AVATARS = ['🦭', '🐧', '🐬', '🌟', '🐙', '🐚', '🪸', '🐢', '🐋', '🦑'];
const BOT_GREETINGS = [
  '大家好呀，今天开始一起学习！📚',
  '初来乍到，请多关照～一起加油！💪',
  '刚加入学海方舟，感觉好棒啊！⛵',
  '今天学习了2小时，打卡！📝',
  '有没有一起背单词的小伙伴？📖',
  '数学题好难，但我要坚持！🚀',
  '今天番茄钟完成了4个，开心！🍅',
];

function generateBotUsers(count) {
  if(!currentIsDeveloper()) return;
  count = Math.min(count || 3, 10);

  const users = JSON.parse(localStorage.getItem('ark_users') || '[]');
  const existingBots = users.filter(u => u.username && u.username.startsWith('🤖'));
  let botCount = 0;

  const newBots = [];
  const group = getGlobalGroup();

  for(let i = 0; i < count; i++) {
    const nameIdx = (existingBots.length + i) % BOT_NAMES.length;
    const botName = '🤖 ' + BOT_NAMES[nameIdx];
    if(users.find(u => u.username === botName)) continue;
    botCount++;
    newBots.push(botName);
    users.push({ username: botName, password: '0000', created: Date.now() });
    // 创建档案
    saveUserProfile(botName, {
      nickname: BOT_NAMES[nameIdx],
      avatar: BOT_AVATARS[nameIdx],
      role: 'user',
      title: '🤖 机器人模拟用户',
      isBanned: false,
      bio: '学海方舟自动生成的模拟用户',
      xp: Math.floor(Math.random() * 500),
      studyHours: Math.floor(Math.random() * 20),
      completedPlans: Math.floor(Math.random() * 15),
      isBot: true,
    });
    // 初始化积分
    saveByUser(botName, 'shop_points', Math.floor(Math.random() * 200) + 50);
  }

  localStorage.setItem('ark_users', JSON.stringify(users));

  // 自动发送打招呼消息
  newBots.forEach((botName, idx) => {
    setTimeout(() => {
      const g = getGlobalGroup();
      const msg = BOT_GREETINGS[Math.floor(Math.random() * BOT_GREETINGS.length)];
      g.messages.push({
        id: 'bot-' + Date.now() + '-' + idx,
        author: botName,
        text: msg,
        time: new Date().toISOString(),
        likes: [],
        replies: [],
        isBot: true,
      });
      saveGlobalGroup(g);
    }, idx * 2000 + 500);
  });

  adminLog('生成机器人', `生成了 ${botCount} 名机器人用户`);
  toast(`🤖 已生成 ${botCount} 名机器人用户！他们马上就会在学友群打招呼~`);
  if(APP.currentPage === 'stats') buildStatsPage(document.getElementById('main-content'));
}

// ---- 用户改名 ----
function openRenameUser(targetUser) {
  if(!currentIsDeveloper()) return;
  const newName = prompt(`请输入「${targetUser}」的新名称：`, targetUser.replace(/^🤖 /, ''));
  if(!newName || !newName.trim() || newName.trim() === targetUser) return;
  const trimmed = newName.trim();
  if(trimmed.length < 1) { toast('名称不能为空'); return; }
  const users = JSON.parse(localStorage.getItem('ark_users') || '[]');
  if(users.find(u => u.username === trimmed)) { toast('该名称已被使用'); return; }
  doRenameUser(targetUser, trimmed);
}

function doRenameUser(oldName, newName) {
  const users = JSON.parse(localStorage.getItem('ark_users') || '[]');
  const user = users.find(u => u.username === oldName);
  if(!user) { toast('用户不存在'); return; }
  user.username = newName;
  localStorage.setItem('ark_users', JSON.stringify(users));

  // 迁移所有该用户的localStorage数据
  const oldPrefix = 'ark_' + oldName + '_';
  const newPrefix = 'ark_' + newName + '_';
  const keysToMigrate = [];
  for(let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if(key.startsWith(oldPrefix)) keysToMigrate.push(key);
  }
  keysToMigrate.forEach(key => {
    const newKey = newPrefix + key.slice(oldPrefix.length);
    if(localStorage.getItem(newKey) === null)
      localStorage.setItem(newKey, localStorage.getItem(key));
  });

  // 更新全局数据中的引用（消息、笔记、评论、封禁列表等）
  // 封禁列表
  const banned = getGlobalBanned();
  const bIdx = banned.indexOf(oldName);
  if(bIdx >= 0) { banned[bIdx] = newName; saveGlobalBanned(banned); }

  // 学友群消息
  const group = getGlobalGroup();
  group.messages.forEach(m => { if(m.author === oldName) m.author = newName; if(m.replies) m.replies.forEach(r => { if(r.author === oldName) r.author = newName; }); });
  saveGlobalGroup(group);

  // 笔记和评论
  const posts = getPosts();
  posts.forEach(p => { if(p.author === oldName) p.author = newName; if(p.comments) p.comments.forEach(c => { if(c.author === oldName) c.author = newName; }); });
  savePosts(posts);

  // 小班成员
  const classes = getGlobalClasses();
  classes.forEach(c => {
    const mIdx = c.members.indexOf(oldName);
    if(mIdx >= 0) c.members[mIdx] = newName;
    if(c.creator === oldName) c.creator = newName;
    c.messages.forEach(m => { if(m.author === oldName) m.author = newName; });
  });
  saveGlobalClasses(classes);

  // 在线用户
  const onlineUsers = getOnlineUsers();
  if(onlineUsers[oldName]) { onlineUsers[newName] = onlineUsers[oldName]; delete onlineUsers[oldName]; saveOnlineUsers(onlineUsers); }

  adminLog('用户改名', `${oldName} 改名为 ${newName}`, newName);
  toast('✅ 用户名称已更改为：' + newName);
  _viewingUser = newName;
  buildProfilePage(document.getElementById('main-content'));
}

// ---- 消息/评论右键撤回菜单 ----
function showMsgContextMenu(e, type, msgId, author) {
  if(!currentIsDeveloper()) return;
  const menu = document.getElementById('msg-context-menu');
  if(menu) menu.remove();
  const div = document.createElement('div');
  div.id = 'msg-context-menu';
  div.className = 'msg-context-menu';
  div.style.left = e.pageX + 'px';
  div.style.top = e.pageY + 'px';
  div.innerHTML = `
    <div class="msg-context-item" onclick="closeMsgContextMenu();doRevokeByType('${type}','${msgId}','${escapeHTML(author)}')">🗑️ 撤回此消息</div>
    <div class="msg-context-item" onclick="closeMsgContextMenu();showUserProfile('${escapeHTML(author)}')">👤 查看用户</div>
    <div class="msg-context-item" onclick="closeMsgContextMenu();openGivePoints('${escapeHTML(author)}')">💰 发放积分</div>
    <div class="msg-context-item" style="color:var(--danger);" onclick="closeMsgContextMenu();doBanUserConfirm('${escapeHTML(author)}')">⛔ 封禁用户</div>
  `;
  document.body.appendChild(div);
  setTimeout(() => document.addEventListener('click', closeMsgContextMenu, { once: true }), 50);
}

function closeMsgContextMenu() {
  const menu = document.getElementById('msg-context-menu');
  if(menu) menu.remove();
}

function doRevokeByType(type, msgId, author) {
  if(type === 'global') revokeGlobalMessage(msgId);
  else if(type === 'comment') {
    // msgId format: postId-commentIndex
    const parts = msgId.split('---');
    revokeComment(parts[0], parseInt(parts[1]));
  }
  else if(type === 'class') {
    const parts = msgId.split('---');
    revokeClassMessage(parts[0], parts[1]);
  }
}

// ---- 空间笔记推荐（右键菜单） ----
function showPostContextMenu(e, postId) {
  if(!currentIsDeveloper()) return;
  const menu = document.getElementById('msg-context-menu');
  if(menu) menu.remove();
  const recommended = getRecommended();
  const isRecommended = recommended.includes(postId);
  const div = document.createElement('div');
  div.id = 'msg-context-menu';
  div.className = 'msg-context-menu';
  div.style.left = e.pageX + 'px';
  div.style.top = e.pageY + 'px';
  div.innerHTML = `
    <div class="msg-context-item" onclick="closeMsgContextMenu();recommendPost('${postId}')">${isRecommended ? '⭐ 取消推荐' : '⭐ 推荐到首页'}</div>
  `;
  document.body.appendChild(div);
  setTimeout(() => document.addEventListener('click', closeMsgContextMenu, { once: true }), 50);
}

// 小班全局存储
const CLASSES_KEY = 'global_classes';

function getGlobalClasses() {
  return loadGlobal(CLASSES_KEY, []);
}

function saveGlobalClasses(classes) {
  saveGlobal(CLASSES_KEY, classes);
}

function getClassById(id) {
  const classes = getGlobalClasses();
  return classes.find(c => c.id === id);
}

function getClassByCode(code) {
  const classes = getGlobalClasses();
  return classes.find(c => c.inviteCode === code.toUpperCase());
}

function updateClassById(id, updater) {
  const classes = getGlobalClasses();
  const idx = classes.findIndex(c => c.id === id);
  if(idx === -1) return null;
  updater(classes[idx]);
  saveGlobalClasses(classes);
  return classes[idx];
}

// 邀请码生成
function generateInviteCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for(let i = 0; i < 5; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  // 确保唯一
  const existing = getGlobalClasses();
  if(existing.find(c => c.inviteCode === code)) return generateInviteCode();
  return code;
}

// 复制邀请码
function copyInviteCode(classId) {
  const cls = getClassById(classId);
  if(!cls || !cls.inviteCode) { toast('⚠️ 未找到邀请码'); return; }
  const inviteText = `🏫 加入我的学海方舟小班「${cls.name}」！\n邀请码：${cls.inviteCode}\n打开学海方舟 → 设置页 → 加入小班 → 粘贴邀请码`;
  navigator.clipboard.writeText(inviteText).then(() => {
    toast('📋 邀请文案已复制！发送给好友即可');
  }).catch(() => {
    // 降级：显示邀请码
    const ta = document.createElement('textarea');
    ta.value = inviteText;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    toast('📋 邀请文案已复制！发送给好友即可');
  });
}

// 粘贴邀请码入班
function openJoinByCodeModal() {
  const content = document.getElementById('class-modal-content');
  content.innerHTML = `
    <div class="modal-header">🔑 加入小班</div>
    <div class="form-group">
      <label>输入邀请码</label>
      <input id="join-code-input" class="login-input" placeholder="5位邀请码，如 A3B9K" maxlength="5" style="text-transform:uppercase;letter-spacing:4px;text-align:center;font-size:1.3rem;font-weight:700;font-family:monospace;" oninput="this.value=this.value.toUpperCase().replace(/[^A-Z0-9]/g,'')">
    </div>
    <div style="font-size:0.75rem;color:var(--text-secondary);text-align:center;margin-bottom:0.5rem;">
      好友分享的5位邀请码，区分大小写
    </div>
    <div style="display:flex;gap:0.5rem;">
      <button class="btn-primary" onclick="joinByCode()" style="flex:1;">🔑 立即加入</button>
      <button class="btn-secondary" onclick="closeModal('class-modal')" style="flex:1;">取消</button>
    </div>
  `;
  document.getElementById('class-modal').style.display = 'flex';
  setTimeout(() => document.getElementById('join-code-input')?.focus(), 100);
}

function joinByCode() {
  const code = (document.getElementById('join-code-input')?.value || '').trim().toUpperCase();
  if(code.length !== 5) { toast('⚠️ 请输入5位邀请码'); return; }

  const cls = getClassByCode(code);
  if(!cls) { toast('⚠️ 未找到该邀请码对应的小班'); return; }

  const u = LoginManager.getCurrentUser();
  if(!u || u === 'guest') { toast('⚠️ 游客不能加入小班，请先登船！'); return; }
  if(cls.members.includes(u)) { toast('ℹ️ 你已在这个小班中'); closeModal('class-modal'); return; }
  if(cls.members.length >= cls.maxMembers) { toast('⚠️ 小班已满'); return; }

  const classes = getGlobalClasses();
  const myCount = classes.filter(c => c.members.includes(u)).length;
  if(myCount >= 5) { toast('⚠️ 每人最多加入5个小班'); return; }

  cls.members.push(u);
  saveGlobalClasses(classes);

  cls.messages.push({
    id: 'sys_' + Date.now(),
    author: '系统',
    avatar: '🤖',
    text: '👋 ' + u + ' 通过邀请码加入了小班，大家欢迎！',
    time: new Date().toISOString(),
    likes: [],
    replies: [],
    isSystem: true,
  });

  addXP(3, '加入小班');
  closeModal('class-modal');
  toast('🎉 成功加入「' + cls.name + '」！');
  _currentClassId = cls.id;

  const mc = document.getElementById('main-content');
  if(mc) buildClassesPage(mc);
}

// 当前小班视图状态
let _currentClassId = null;
let _currentClassTab = 'chat'; // chat | progress | members
let _classReplyingTo = null;

// 小班学科图标映射
const SUBJECT_ICONS = {
  '语文': '📖', '数学': '🧮', '英语': '🔤', '科学': '🔬',
  '编程': '💻', '美术': '🎨', '音乐': '🎵', '历史': '📜',
  '地理': '🌍', '体育': '⚽', '综合': '📚'
};

function getSubjectIcon(subject) {
  return SUBJECT_ICONS[subject] || '📚';
}

// ===== 小班列表页 =====
function buildClassesPage(mc) {
  _currentClassId = null;
  const classes = getGlobalClasses();
  const u = LoginManager.getCurrentUser();
  const searchQuery = _classSearchQuery || '';

  const myClasses = classes.filter(c => c.members.includes(u));
  const otherClasses = classes.filter(c => !c.members.includes(u));

  const filterClasses = (list) => {
    if(!searchQuery) return list;
    const q = searchQuery.toLowerCase();
    return list.filter(c =>
      c.name.toLowerCase().includes(q) ||
      c.subject.toLowerCase().includes(q) ||
      c.desc.toLowerCase().includes(q)
    );
  };

  const filteredMy = filterClasses(myClasses);
  const filteredOther = filterClasses(otherClasses);

  mc.innerHTML = `
    <div class="classes-page">
      <div class="classes-header">
        <div class="classes-title">🎓 学习小班</div>
        <div class="classes-header-desc">加入或创建学习小组，和同学一起进步</div>
        ${u && u !== 'guest' ? `<button class="btn-primary" onclick="openClassCreateModal()">＋ 创建小班</button>` : ''}
        ${u && u !== 'guest' ? `<button class="btn-secondary" onclick="openJoinByCodeModal()" style="margin-left:0.5rem;">🔑 加入小班</button>` : ''}
      </div>

      <div class="classes-search-wrap">
        <input class="classes-search" id="class-search-input" type="text" placeholder="🔍 搜索小班名称、学科…" value="${escapeHTML(searchQuery)}" oninput="onClassSearch(this.value)">
        ${searchQuery ? `<button class="classes-search-clear" onclick="onClassSearch('');document.getElementById('class-search-input').value='';">✕</button>` : ''}
      </div>

      ${filteredMy.length > 0 ? `
        <div class="classes-section">
          <div class="classes-section-title">⭐ 我的小班</div>
          <div class="classes-grid" id="my-classes-grid">
            ${filteredMy.map(c => renderClassCard(c, u, true)).join('')}
          </div>
        </div>
      ` : ''}

      <div class="classes-section">
        <div class="classes-section-title">🌊 可加入的小班</div>
        ${filteredOther.length === 0 ? `
          <div class="space-empty">${searchQuery ? '没有找到匹配的小班' : '还没有其他小班，来创建第一个吧！'}</div>
        ` : `
          <div class="classes-grid">
            ${filteredOther.map(c => renderClassCard(c, u, false)).join('')}
          </div>
        `}
      </div>
    </div>
  `;
}

let _classSearchQuery = '';

function onClassSearch(val) {
  _classSearchQuery = val;
  const mc = document.getElementById('main-content');
  if(mc && APP.currentPage === 'classes') buildClassesPage(mc);
}

function renderClassCard(c, u, isMember) {
  const memberCount = c.members.length;
  const max = c.maxMembers || 10;
  const isFull = memberCount >= max;
  const isCreator = c.creator === u;

  return `
    <div class="class-card ${isMember ? 'member' : ''}" onclick="${isMember ? `openClassDetail('${c.id}')` : ''}">
      <div class="class-card-icon">${c.icon || getSubjectIcon(c.subject)}</div>
      <div class="class-card-body">
        <div class="class-card-name">${escapeHTML(c.name)}</div>
        <div class="class-card-subject">${c.subject || ''}</div>
        <div class="class-card-desc">${escapeHTML(c.desc || '')}</div>
        <div class="class-card-meta">
          <span>👥 ${memberCount}/${max}</span>
          <span>👤 创建者: ${c.creator}</span>
          ${c.messages ? `<span>💬 ${c.messages.length}条消息</span>` : ''}
        </div>
      </div>
      <div class="class-card-actions">
        ${isMember ? `
          <button class="btn-primary btn-sm" onclick="event.stopPropagation();openClassDetail('${c.id}')">进入</button>
        ` : `
          ${isFull ? `<span class="class-full-badge">已满</span>` : `<button class="btn-secondary btn-sm" onclick="event.stopPropagation();joinClass('${c.id}')">加入</button>`}
        `}
      </div>
    </div>
  `;
}

// ===== 创建小班 =====
function openClassCreateModal() {
  const u = LoginManager.getCurrentUser();
  if(!u || u === 'guest') { toast('⚠️ 游客不能创建小班，请先登船！'); return; }

  const modal = document.getElementById('class-modal');
  const content = document.getElementById('class-modal-content');
  content.innerHTML = `
    <div class="modal-header">🎓 创建小班</div>
    <div class="form-group">
      <label>小班名称 <span style="color:var(--danger);">*</span></label>
      <input id="cc-name" class="login-input" placeholder="给你们的班级起个名字吧" maxlength="20">
    </div>
    <div class="form-group">
      <label>学科标签</label>
      <div class="subject-picker" id="subject-picker">
        ${Object.keys(SUBJECT_ICONS).map(s => `
          <button class="subject-chip" data-subject="${s}" onclick="pickSubject('${s}', this)">${SUBJECT_ICONS[s]} ${s}</button>
        `).join('')}
      </div>
      <input type="hidden" id="cc-subject" value="">
    </div>
    <div class="form-group">
      <label>班级图标</label>
      <div class="emoji-picker" id="emoji-picker">
        ${['🧮','📖','🔤','🔬','💻','🎨','🎵','📜','🌍','⚽','📚','⭐','🚀','🎯','🌈','🔥'].map(e => `
          <button class="emoji-chip" data-emoji="${e}" onclick="pickClassEmoji('${e}', this)">${e}</button>
        `).join('')}
      </div>
      <input type="hidden" id="cc-icon" value="📚">
    </div>
    <div class="form-group">
      <label>描述</label>
      <textarea id="cc-desc" class="login-input" placeholder="简单介绍一下这个班级…" maxlength="200" style="min-height:60px;resize:vertical;"></textarea>
    </div>
    <div class="form-group">
      <label>人数上限</label>
      <select id="cc-max" class="login-input">
        <option value="5">5 人</option>
        <option value="10" selected>10 人</option>
        <option value="20">20 人</option>
        <option value="30">30 人</option>
        <option value="50">50 人</option>
      </select>
    </div>
    <div style="display:flex;gap:0.5rem;margin-top:1rem;">
      <button class="btn-primary" onclick="createClass()" style="flex:1;">✅ 创建</button>
      <button class="btn-secondary" onclick="closeModal('class-modal')" style="flex:1;">取消</button>
    </div>
  `;
  modal.style.display = 'flex';
  // 默认选中第一个emoji
  setTimeout(() => {
    const firstEmoji = document.querySelector('.emoji-chip');
    if(firstEmoji) firstEmoji.classList.add('selected');
  }, 50);
}

let _pickedSubject = '';

function pickSubject(subject, el) {
  _pickedSubject = subject;
  document.getElementById('cc-subject').value = subject;
  document.querySelectorAll('.subject-chip').forEach(b => b.classList.remove('selected'));
  el.classList.add('selected');
}

function pickClassEmoji(emoji, el) {
  document.getElementById('cc-icon').value = emoji;
  document.querySelectorAll('.emoji-chip').forEach(b => b.classList.remove('selected'));
  el.classList.add('selected');
}

function createClass() {
  const u = LoginManager.getCurrentUser();
  const name = (document.getElementById('cc-name')?.value || '').trim();
  const subject = document.getElementById('cc-subject')?.value || '';
  const icon = document.getElementById('cc-icon')?.value || '📚';
  const desc = (document.getElementById('cc-desc')?.value || '').trim();
  const maxMembers = parseInt(document.getElementById('cc-max')?.value || '10');

  if(!name) { toast('⚠️ 请输入小班名称'); return; }
  if(name.length < 2) { toast('⚠️ 名称至少2个字'); return; }

  const classes = getGlobalClasses();
  if(classes.find(c => c.name === name)) { toast('⚠️ 已有同名小班'); return; }

  // 每人最多创建3个小班
  const myClasses = classes.filter(c => c.creator === u);
  if(myClasses.length >= 3) { toast('⚠️ 每人最多创建3个小班'); return; }

  const newClass = {
    id: 'class_' + Date.now(),
    name,
    subject,
    icon,
    desc,
    creator: u,
    members: [u],
    maxMembers,
    messages: [],
    tasks: [],
    createdAt: new Date().toISOString(),
    inviteCode: generateInviteCode(),
  };

  classes.push(newClass);
  saveGlobalClasses(classes);

  closeModal('class-modal');
  addXP(5, '创建小班');
  toast('🎉 小班「' + name + '」创建成功！');

  // 刷新列表
  const mc = document.getElementById('main-content');
  if(mc) buildClassesPage(mc);
}

// ===== 加入/退出小班 =====
function joinClass(classId) {
  const u = LoginManager.getCurrentUser();
  if(!u || u === 'guest') { toast('⚠️ 游客不能加入小班，请先登船！'); return; }

  const cls = getClassById(classId);
  if(!cls) { toast('⚠️ 小班不存在'); return; }
  if(cls.members.includes(u)) { toast('ℹ️ 你已在这个小班中'); return; }
  if(cls.members.length >= cls.maxMembers) { toast('⚠️ 小班已满'); return; }

  // 每人最多加入5个小班
  const classes = getGlobalClasses();
  const myCount = classes.filter(c => c.members.includes(u)).length;
  if(myCount >= 5) { toast('⚠️ 每人最多加入5个小班'); return; }

  cls.members.push(u);
  saveGlobalClasses(classes);

  // 自动发送系统消息
  cls.messages.push({
    id: 'sys_' + Date.now(),
    author: '系统',
    avatar: '🤖',
    text: '👋 ' + u + ' 加入了小班，大家欢迎！',
    time: new Date().toISOString(),
    likes: [],
    replies: [],
    isSystem: true,
  });

  addXP(3, '加入小班');
  toast('🎉 成功加入「' + cls.name + '」！');

  const mc = document.getElementById('main-content');
  if(mc) buildClassesPage(mc);
}

function leaveClass(classId) {
  const u = LoginManager.getCurrentUser();
  const cls = getClassById(classId);
  if(!cls) return;
  if(cls.creator === u) {
    toast('⚠️ 你是创建者，不能退出。如需解散小班请联系开发者');
    return;
  }

  cls.members = cls.members.filter(m => m !== u);
  const classes = getGlobalClasses();
  const idx = classes.findIndex(c => c.id === classId);
  if(idx !== -1) { classes[idx] = cls; saveGlobalClasses(classes); }

  // 系统消息
  cls.messages.push({
    id: 'sys_' + Date.now(),
    author: '系统',
    avatar: '🤖',
    text: '👋 ' + u + ' 离开了小班',
    time: new Date().toISOString(),
    likes: [],
    replies: [],
    isSystem: true,
  });

  toast('已退出小班「' + cls.name + '」');
  _currentClassId = null;

  const mc = document.getElementById('main-content');
  if(mc) buildClassesPage(mc);
}

// ===== 小班详情页 =====
function openClassDetail(classId) {
  _currentClassId = classId;
  _currentClassTab = 'chat';
  const mc = document.getElementById('main-content');
  if(mc) buildClassDetail(mc);
}

function buildClassDetail(mc) {
  const classId = _currentClassId;
  if(!classId) { buildClassesPage(mc); return; }

  const cls = getClassById(classId);
  if(!cls) { toast('⚠️ 小班不存在'); _currentClassId = null; buildClassesPage(mc); return; }

  const u = LoginManager.getCurrentUser();
  const isMember = cls.members.includes(u);
  const isCreator = cls.creator === u;

  if(!isMember) { toast('⚠️ 你没有加入这个小班'); _currentClassId = null; buildClassesPage(mc); return; }

  const tab = _currentClassTab;

  mc.innerHTML = `
    <div class="class-detail">
      <div class="class-detail-header">
        <button class="btn-back" onclick="backToClassList()">← 返回</button>
        <div class="class-detail-icon">${cls.icon || '📚'}</div>
        <div class="class-detail-info">
          <div class="class-detail-name">${escapeHTML(cls.name)}</div>
          <div class="class-detail-meta">
            <span>${cls.subject || ''}</span>
            <span>👥 ${cls.members.length}/${cls.maxMembers}人</span>
            <span>${cls.creator === u ? '👑 创建者' : '👤 成员'}</span>
          </div>
        </div>
        ${!isCreator ? `<button class="btn-secondary btn-sm" onclick="leaveClass('${classId}')">退出</button>` : ''}
      </div>

      <!-- 邀请码区 -->
      ${cls.inviteCode ? `
      <div class="class-invite-bar">
        <span class="class-invite-label">🔑 邀请码</span>
        <span class="class-invite-code">${cls.inviteCode}</span>
        <button class="btn-primary btn-sm" onclick="copyInviteCode('${classId}')">📋 复制邀请</button>
      </div>
      ` : ''}

      <div class="class-detail-tabs">
        <button class="class-tab ${tab === 'chat' ? 'active' : ''}" onclick="switchClassTab('chat')">💬 讨论区</button>
        <button class="class-tab ${tab === 'progress' ? 'active' : ''}" onclick="switchClassTab('progress')">📋 进度看板</button>
        <button class="class-tab ${tab === 'members' ? 'active' : ''}" onclick="switchClassTab('members')">👥 成员 (${cls.members.length})</button>
      </div>

      <div class="class-detail-body" id="class-detail-body">
        ${tab === 'chat' ? buildClassChatHTML(cls, u) : ''}
        ${tab === 'progress' ? buildClassProgressHTML(cls, u) : ''}
        ${tab === 'members' ? buildClassMembersHTML(cls, u) : ''}
      </div>
    </div>
  `;

  if(tab === 'chat') {
    setTimeout(() => {
      renderClassChat();
      const input = document.getElementById('class-chat-input');
      if(input) input.focus();
    }, 100);
  }
}

function backToClassList() {
  _currentClassId = null;
  const mc = document.getElementById('main-content');
  if(mc) buildClassesPage(mc);
}

function switchClassTab(tab) {
  _currentClassTab = tab;
  const mc = document.getElementById('main-content');
  if(mc) buildClassDetail(mc);
}

// ===== 小班讨论区 =====
function buildClassChatHTML(cls, u) {
  return `
    <div class="class-chat">
      <div class="class-chat-messages" id="class-chat-msgs"></div>
      <div class="class-chat-input-wrap">
        <input id="class-chat-input" class="class-chat-input" placeholder="在小班里聊聊学习…" maxlength="500" onkeydown="if(event.key==='Enter')sendClassMessage()">
        <button class="btn-primary" onclick="sendClassMessage()" style="border-radius:0 8px 8px 0;">发送</button>
      </div>
    </div>
  `;
}

function renderClassChat() {
  const msgsDiv = document.getElementById('class-chat-msgs');
  if(!msgsDiv) return;
  const classId = _currentClassId;
  const cls = getClassById(classId);
  if(!cls) return;
  const u = LoginManager.getCurrentUser();
  const msgs = cls.messages || [];

  if(msgs.length === 0) {
    msgsDiv.innerHTML = `<div class="space-empty" style="padding:2rem;">💬 还没有消息<br>来开始小班的第一条讨论吧！</div>`;
    return;
  }

  const recentMsgs = msgs.slice(-100);
  msgsDiv.innerHTML = recentMsgs.map((m, i) => {
    const isSelf = m.author === u;
    const isSystem = m.isSystem;
    const time = new Date(m.time).toLocaleTimeString('zh-CN', {hour:'2-digit',minute:'2-digit'});
    const likeCount = (m.likes || []).length;
    const isLiked = (m.likes || []).includes(u);
    const replyCount = (m.replies || []).length;

    if(isSystem) {
      return `<div class="chat-msg system"><div class="chat-msg-system">${escapeHTML(m.text)} <span class="chat-msg-time">${time}</span></div></div>`;
    }

    return `
      <div class="chat-msg ${isSelf ? 'self' : ''}" id="class-msg-${m.id || i}">
        <div class="chat-msg-avatar">${m.avatar || '⛵'}</div>
        <div style="flex:1;min-width:0;" oncontextmenu="${currentIsDeveloper() && !isSystem ? `event.preventDefault();showMsgContextMenu(event,'class','${classId}---${m.id || ('cm'+i)}','${escapeHTML(m.author)}')` : ''}">
          ${!isSelf ? '<div style="font-size:0.7rem;color:var(--text-secondary);margin-bottom:2px;">'+m.author+'</div>' : ''}
          <div class="chat-msg-bubble">${m.revoked ? '<span style="font-style:italic;color:var(--text-secondary);">🗑 该消息已被撤回</span>' : escapeHTML(m.text)}</div>
          <div class="chat-msg-meta">
            <span class="chat-msg-time">${time}</span>
            ${!m.revoked ? `
            <button class="chat-msg-like ${isLiked ? 'liked' : ''}" onclick="toggleClassMsgLike('${m.id || 'cm' + m.time}')">
              ${isLiked ? '❤️' : '🤍'} ${likeCount || ''}
            </button>
            <button class="chat-msg-reply-btn" onclick="replyToClassMsg('${m.id || 'cm' + m.time}', '${escapeHTML(m.author)}')">
              💬 ${replyCount || ''}
            </button>
            ` : ''}
          </div>
          ${m.replies && m.replies.length > 0 ? `
            <div class="chat-msg-replies">
              ${m.replies.slice(-3).map(r => `
                <div class="chat-msg-reply">
                  <span class="chat-msg-reply-author">${r.author}:</span> ${escapeHTML(r.text)}
                </div>
              `).join('')}
              ${m.replies.length > 3 ? `<div style="font-size:0.65rem;color:var(--text-secondary);">…还有 ${m.replies.length - 3} 条回复</div>` : ''}
            </div>
          ` : ''}
        </div>
      </div>
    `;
  }).join('');

  setTimeout(() => { if(msgsDiv) msgsDiv.scrollTop = msgsDiv.scrollHeight; }, 50);
}

function sendClassMessage() {
  const input = document.getElementById('class-chat-input');
  if(!input || !input.value.trim()) return;
  const text = input.value.trim();
  const classId = _currentClassId;
  if(!classId) return;
  const u = LoginManager.getCurrentUser();
  if(!u || u === 'guest') { toast('⚠️ 游客不能发言'); return; }

  if(text.length < 1) return;
  if(text.length > 500) { toast('⚠️ 消息不能超过500字'); return; }

  const cls = getClassById(classId);
  if(!cls) return;
  if(!cls.messages) cls.messages = [];

  // 回复逻辑
  if(_classReplyingTo) {
    const msg = cls.messages.find(m => (m.id || 'cm' + m.time) === _classReplyingTo.msgId);
    if(msg) {
      if(!msg.replies) msg.replies = [];
      msg.replies.push({ author: u, text, time: new Date().toISOString() });
      if(msg.replies.length > 20) msg.replies = msg.replies.slice(-20);
      addXP(1, '小班回复');
      updateClassById(classId, () => {});
      input.value = '';
      input.placeholder = '在小班里聊聊学习…';
      _classReplyingTo = null;
      renderClassChat();
      return;
    }
    _classReplyingTo = null;
    input.placeholder = '在小班里聊聊学习…';
  }

  const msg = {
    id: 'cm' + Date.now(),
    author: u,
    avatar: (load('profile', {})).avatar || '⛵',
    text,
    time: new Date().toISOString(),
    likes: [],
    replies: [],
  };

  cls.messages.push(msg);
  if(cls.messages.length > 500) cls.messages = cls.messages.slice(-500);

  const classes = getGlobalClasses();
  const idx = classes.findIndex(c => c.id === classId);
  if(idx !== -1) { classes[idx] = cls; saveGlobalClasses(classes); }

  addXP(2, '小班发言');
  input.value = '';
  renderClassChat();
  setTimeout(() => {
    const inp = document.getElementById('class-chat-input');
    if(inp) inp.focus();
  }, 50);
}

function toggleClassMsgLike(msgId) {
  const u = LoginManager.getCurrentUser();
  if(!u || u === 'guest') { toast('⚠️ 游客不能点赞，请先登船'); return; }
  const classId = _currentClassId;
  const cls = getClassById(classId);
  if(!cls) return;
  const msg = cls.messages.find(m => (m.id || 'cm' + m.time) === msgId);
  if(!msg) return;
  if(!msg.likes) msg.likes = [];
  const idx2 = msg.likes.indexOf(u);
  if(idx2 > -1) msg.likes.splice(idx2, 1);
  else { msg.likes.push(u); addXP(1, '小班点赞'); }
  updateClassById(classId, () => {});
  renderClassChat();
}

function replyToClassMsg(msgId, author) {
  _classReplyingTo = { msgId, author };
  const input = document.getElementById('class-chat-input');
  if(input) {
    input.placeholder = '回复 ' + author + '：';
    input.focus();
  }
}

// ===== 小班进度看板 =====
function buildClassProgressHTML(cls, u) {
  const tasks = cls.tasks || [];
  const done = tasks.filter(t => t.status === 'done').length;
  const total = tasks.length;
  const progress = total > 0 ? Math.round(done / total * 100) : 0;

  // 计算本周开始时间
  const today = new Date();
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - today.getDay());
  weekStart.setHours(0,0,0,0);

  // 获取所有成员的周学习时长（按周完成的任务数+番茄数估算）
  const memberWeeklyStats = cls.members.map(m => {
    const doneCount = tasks.filter(t => t.assignee === m && t.status === 'done').length;
    const totalCount = tasks.filter(t => t.assignee === m).length;
    const weekDone = tasks.filter(t => t.assignee === m && t.status === 'done' && new Date(t.createdAt) >= weekStart).length;
    // 周学习时长估算：本周完成任务 × 25分钟（番茄）
    const weeklyMins = weekDone * 25;
    return { name: m, doneCount, totalCount, weekDone, weeklyMins, isCreator: cls.creator === m };
  });

  // 按周学习时长排序
  memberWeeklyStats.sort((a, b) => b.weeklyMins - a.weeklyMins);

  return `
    <div class="class-progress">
      <div class="class-progress-bar-wrap">
        <div class="class-progress-label">班级总进度：${done}/${total} 完成 (${progress}%)</div>
        <div class="class-progress-bar-bg">
          <div class="class-progress-bar-fill" style="width:${progress}%"></div>
        </div>
      </div>

      <div class="class-progress-actions">
        <button class="btn-primary btn-sm" onclick="openAddTaskModal()">＋ 添加任务</button>
        <div class="class-progress-filter">
          <button class="class-task-filter active" onclick="filterClassTasks('all', this)" data-tfilter="all">全部</button>
          <button class="class-task-filter" onclick="filterClassTasks('todo', this)" data-tfilter="todo">待开始</button>
          <button class="class-task-filter" onclick="filterClassTasks('doing', this)" data-tfilter="doing">进行中</button>
          <button class="class-task-filter" onclick="filterClassTasks('done', this)" data-tfilter="done">已完成</button>
        </div>
      </div>

      <div class="class-task-list" id="class-task-list">
        ${tasks.length === 0 ? `<div class="space-empty">📋 还没有任务，添加第一个班级任务吧！</div>` : renderClassTasks(tasks, u, 'all')}
      </div>

      <div class="class-progress-members">
        <div class="class-progress-label">🏆 本周排行榜（按学习时长排序）</div>
        <div class="class-member-progress-list">
          ${memberWeeklyStats.map((s, i) => `
            <div class="class-member-progress">
              <span class="class-member-rank ${i < 3 ? 'top' + (i+1) : ''}">${i < 3 ? ['🥇','🥈','🥉'][i] : '#'+(i+1)}</span>
              <span class="class-member-progress-name">${s.name} ${s.isCreator ? '👑' : ''}</span>
              <span class="class-member-progress-stat">${s.weeklyMins}分钟</span>
              ${`<div class="class-member-progress-bar"><div style="width:${memberWeeklyStats[0].weeklyMins > 0 ? Math.round(s.weeklyMins/memberWeeklyStats[0].weeklyMins*100) : 0}%"></div></div>`}
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `;
}

let _classTaskFilter = 'all';

function filterClassTasks(filter, el) {
  _classTaskFilter = filter;
  if(el) {
    el.parentElement.querySelectorAll('.class-task-filter').forEach(b => b.classList.remove('active'));
    el.classList.add('active');
  }
  const tasks = getClassById(_currentClassId)?.tasks || [];
  const u = LoginManager.getCurrentUser();
  const taskList = document.getElementById('class-task-list');
  if(taskList) taskList.innerHTML = renderClassTasks(tasks, u, filter);
}

function renderClassTasks(tasks, u, filter) {
  const filtered = filter === 'all' ? tasks : tasks.filter(t => t.status === filter);
  if(filtered.length === 0) return `<div class="space-empty">暂无${filter === 'all' ? '' : statusLabel(filter) + '的'}任务</div>`;

  return filtered.map(t => {
    const statusLabels = { todo: '📌 待开始', doing: '🔄 进行中', done: '✅ 已完成' };
    const statusColors = { todo: 'var(--text-secondary)', doing: 'var(--chart-1)', done: 'var(--success)' };
    return `
      <div class="class-task-card ${t.status}" id="class-task-${t.id}">
        <div class="class-task-status" style="color:${statusColors[t.status]}">${statusLabels[t.status]}</div>
        <div class="class-task-title">${escapeHTML(t.title)}</div>
        ${t.desc ? `<div class="class-task-desc">${escapeHTML(t.desc)}</div>` : ''}
        <div class="class-task-meta">
          <span>👤 ${t.assignee}</span>
          <span>📅 ${new Date(t.createdAt).toLocaleDateString('zh-CN')}</span>
        </div>
        <div class="class-task-actions">
          ${t.status !== 'done' ? `<button class="btn-primary btn-xs" onclick="updateClassTask('${t.id}','done')">✅ 完成</button>` : `<button class="btn-secondary btn-xs" onclick="updateClassTask('${t.id}','todo')">↩ 重开</button>`}
          ${t.status === 'todo' ? `<button class="btn-secondary btn-xs" onclick="updateClassTask('${t.id}','doing')">▶ 开始</button>` : ''}
          ${t.status === 'doing' ? `<button class="btn-secondary btn-xs" onclick="updateClassTask('${t.id}','todo')">⏸ 暂停</button>` : ''}
          ${t.assignee === u || getClassById(_currentClassId)?.creator === u ? `<button class="btn-danger btn-xs" onclick="deleteClassTask('${t.id}')">🗑</button>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

function statusLabel(s) { return { todo: '待开始', doing: '进行中', done: '已完成' }[s] || s; }

function openAddTaskModal() {
  const u = LoginManager.getCurrentUser();
  const cls = getClassById(_currentClassId);
  if(!cls) return;

  const modal = document.getElementById('class-modal');
  const content = document.getElementById('class-modal-content');
  content.innerHTML = `
    <div class="modal-header">📋 添加班级任务</div>
    <div class="form-group">
      <label>任务标题 <span style="color:var(--danger);">*</span></label>
      <input id="addtask-title" class="login-input" placeholder="例如：完成数学作业第3页" maxlength="100">
    </div>
    <div class="form-group">
      <label>任务描述</label>
      <textarea id="addtask-desc" class="login-input" placeholder="可选的详细描述…" maxlength="300" style="min-height:50px;resize:vertical;"></textarea>
    </div>
    <div class="form-group">
      <label>分配给</label>
      <select id="addtask-assignee" class="login-input">
        ${cls.members.map(m => `<option value="${m}" ${m === u ? 'selected' : ''}>${m}</option>`).join('')}
      </select>
    </div>
    <div style="display:flex;gap:0.5rem;margin-top:1rem;">
      <button class="btn-primary" onclick="addClassTask()" style="flex:1;">✅ 添加</button>
      <button class="btn-secondary" onclick="closeModal('class-modal')" style="flex:1;">取消</button>
    </div>
  `;
  modal.style.display = 'flex';
}

function addClassTask() {
  const title = (document.getElementById('addtask-title')?.value || '').trim();
  const desc = (document.getElementById('addtask-desc')?.value || '').trim();
  const assignee = document.getElementById('addtask-assignee')?.value || '';

  if(!title) { toast('⚠️ 请输入任务标题'); return; }

  const cls = getClassById(_currentClassId);
  if(!cls) return;
  if(!cls.tasks) cls.tasks = [];

  cls.tasks.push({
    id: 'ct' + Date.now(),
    title,
    desc,
    assignee,
    status: 'todo',
    createdAt: new Date().toISOString(),
  });

  updateClassById(_currentClassId, () => {});
  closeModal('class-modal');
  addXP(2, '添加班级任务');
  toast('✅ 任务已添加');

  const mc = document.getElementById('main-content');
  if(mc) buildClassDetail(mc);
}

function updateClassTask(taskId, newStatus) {
  const cls = getClassById(_currentClassId);
  if(!cls) return;
  const task = cls.tasks.find(t => t.id === taskId);
  if(!task) return;
  task.status = newStatus;
  updateClassById(_currentClassId, () => {});

  if(newStatus === 'done') addXP(3, '完成班级任务');

  const taskList = document.getElementById('class-task-list');
  if(taskList) {
    const tasks = cls.tasks;
    const u = LoginManager.getCurrentUser();
    taskList.innerHTML = renderClassTasks(tasks, u, _classTaskFilter);
  }

  // 更新进度条
  const progressBar = document.querySelector('.class-progress-bar-fill');
  const progressLabel = document.querySelector('.class-progress-label');
  if(progressBar && progressLabel) {
    const done = cls.tasks.filter(t => t.status === 'done').length;
    const total = cls.tasks.length;
    const progress = total > 0 ? Math.round(done / total * 100) : 0;
    progressBar.style.width = progress + '%';
    progressLabel.textContent = '班级总进度：' + done + '/' + total + ' 完成 (' + progress + '%)';
  }
}

function deleteClassTask(taskId) {
  const cls = getClassById(_currentClassId);
  if(!cls) return;
  cls.tasks = cls.tasks.filter(t => t.id !== taskId);
  updateClassById(_currentClassId, () => {});

  const taskList = document.getElementById('class-task-list');
  if(taskList) {
    const tasks = cls.tasks;
    const u = LoginManager.getCurrentUser();
    taskList.innerHTML = renderClassTasks(tasks, u, _classTaskFilter);
  }
  toast('🗑 任务已删除');
}

// ===== 小班成员列表 =====
function buildClassMembersHTML(cls, u) {
  return `
    <div class="class-members-list">
      ${cls.members.map(m => {
        const mTitle = getUserTitle(m);
        const mIsDev = isDeveloper(m);
        return `
        <div class="class-member-card" style="cursor:pointer;" onclick="showUserProfile('${escapeHTML(m)}')" title="查看 ${escapeHTML(m)} 的主页">
          <div class="class-member-avatar">${cls.creator === m ? '👑' : (mIsDev ? '👑' : '👤')}</div>
          <div class="class-member-info">
            <div class="class-member-name">
              ${m}
              ${cls.creator === m ? '<span style="font-size:0.7rem;color:var(--warning);">创建者</span>' : ''}
              ${mTitle ? '<span class="user-badge-title" style="display:inline-block;margin-left:4px;font-size:0.6rem;">'+escapeHTML(mTitle)+'</span>' : ''}
            </div>
            <div class="class-member-role">${cls.creator === m ? '小班创始人' : (mIsDev ? '开发者' : '小班成员')}</div>
          </div>
          ${m === u ? '<span class="class-member-badge">我</span>' : ''}
        </div>
      `}).join('')}
    </div>
  `;
}

// =========================================
//  v6.0 问题反馈中心
// =========================================

// 反馈类型配置
var FEEDBACK_TYPES = {
  bug:        { icon: '🐛', label: 'Bug/报错',  color: '#ef4444' },
  suggestion: { icon: '💡', label: '功能建议',   color: '#f59e0b' },
  question:   { icon: '❓', label: '使用咨询',   color: '#3b82f6' },
  report:     { icon: '📖', label: '内容举报',   color: '#8b5cf6' },
  praise:     { icon: '❤️', label: '夸夸岛主',   color: '#ec4899' },
  other:      { icon: '📦', label: '其他',       color: '#6b7280' },
};

// 反馈状态配置
var FEEDBACK_STATUS = {
  pending:  { label: '待处理', color: '#6b7280', bg: 'rgba(107,114,128,0.12)' },
  read:     { label: '已读',   color: '#3b82f6', bg: 'rgba(59,130,246,0.12)' },
  replied:  { label: '已回复', color: '#10b981', bg: 'rgba(16,185,129,0.12)' },
  resolved: { label: '已解决', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
  closed:   { label: '已关闭', color: '#6b7280', bg: 'rgba(107,114,128,0.12)' },
};

// 优先级配置
var FEEDBACK_PRIORITY = {
  emergency: { icon: '🔴', label: '紧急', color: '#dc2626' },
  high:      { icon: '🟠', label: '高',   color: '#ea580c' },
  medium:    { icon: '🔵', label: '中',   color: '#3b82f6' },
  low:       { icon: '⚪', label: '低',   color: '#9ca3af' },
};

// 反馈数据读写
function getFeedbacks() { return loadGlobal('feedback', []); }
function saveFeedbacks(list) { saveGlobal('feedback', list); }
function getFeedbackStatusLog() { return loadGlobal('feedback_status_log', []); }
function saveFeedbackStatusLog(log) { saveGlobal('feedback_status_log', log); }

// 生成反馈ID
function generateFeedbackId() {
  var d = new Date();
  var dateStr = d.getFullYear() + pad(d.getMonth()+1) + pad(d.getDate());
  var existing = getFeedbacks();
  var seq = existing.filter(function(f) { return f.id.indexOf('fb_' + dateStr) === 0; }).length + 1;
  return 'fb_' + dateStr + '_' + String(seq).padStart(3, '0');
}

// 解析设备信息
function getDeviceInfo() {
  var ua = navigator.userAgent;
  var os = '未知系统';
  var browser = '未知浏览器';
  var version = '';
  // 系统
  if(/iPhone|iPad|iPod/.test(ua)) {
    var m = ua.match(/OS (\d+[_\d]*)/);
    os = 'iOS ' + (m ? m[1].replace(/_/g, '.') : '');
  } else if(/Android/.test(ua)) {
    var am = ua.match(/Android (\d+[\.\d]*)/);
    os = 'Android ' + (am ? am[1] : '');
  } else if(/Windows/.test(ua)) {
    var wm = ua.match(/Windows NT (\d+\.\d+)/);
    var winVer = wm ? wm[1] : '';
    var winMap = {'10.0':'10/11','6.3':'8.1','6.2':'8','6.1':'7'};
    os = 'Windows ' + (winMap[winVer] || winVer);
  } else if(/Mac/.test(ua)) {
    os = 'macOS';
  } else if(/Linux/.test(ua)) {
    os = 'Linux';
  }
  // 浏览器
  if(/Edg\//.test(ua)) { browser = 'Edge'; var em = ua.match(/Edg\/(\d+)/); version = em ? em[1] : ''; }
  else if(/Chrome\//.test(ua)) { browser = 'Chrome'; var cm = ua.match(/Chrome\/(\d+)/); version = cm ? cm[1] : ''; }
  else if(/Firefox\//.test(ua)) { browser = 'Firefox'; var fm = ua.match(/Firefox\/(\d+)/); version = fm ? fm[1] : ''; }
  else if(/Safari\//.test(ua)) { browser = 'Safari'; var sm = ua.match(/Version\/(\d+)/); version = sm ? sm[1] : ''; }
  return os + ' / ' + browser + (version ? ' ' + version : '');
}

// 构建反馈提交页
function buildFeedbackPage(mc) {
  var u = LoginManager.getCurrentUser();
  if(!u || u === 'guest') {
    mc.innerHTML = '<div class="card" style="text-align:center;padding:3rem;"><div style="font-size:3rem;margin-bottom:1rem;">💬</div><p style="color:var(--text-secondary);">请先登录后再提交反馈</p></div>';
    return;
  }
  // 重置状态
  _feedbackImages = [];
  _selectedFeedbackType = null;
  // 检查是否被限制
  var banUntil = loadByUser(u, 'feedback_ban_until', 0);
  if(banUntil && Date.now() < banUntil) {
    var banDate = new Date(banUntil);
    mc.innerHTML = '<div class="card" style="text-align:center;padding:3rem;"><div style="font-size:3rem;margin-bottom:1rem;">⛔</div><p style="color:var(--danger);font-weight:700;">您的反馈权限已被限制</p><p style="color:var(--text-secondary);margin-top:0.5rem;">解封时间：' + banDate.toLocaleString('zh-CN') + '</p><button class="btn-primary" style="margin-top:1rem;" onclick="showPage(\'feedback-records\')">📋 查看我的反馈记录</button></div>';
    return;
  }
  var deviceInfo = getDeviceInfo();
  mc.innerHTML = `
    <div class="page-title">📝 问题反馈 <span class="badge">您的声音我们倾听</span></div>
    <div class="card feedback-form-card">
      <div class="feedback-form-section">
        <div class="feedback-form-label">反馈类型 <span style="color:var(--danger);">*</span></div>
        <div class="feedback-type-grid" id="feedback-type-grid">
          ${Object.entries(FEEDBACK_TYPES).map(function(entry) {
            var key = entry[0], t = entry[1];
            return '<div class="feedback-type-card" data-type="' + key + '" onclick="selectFeedbackType(\'' + key + '\')">' +
              '<span class="feedback-type-icon">' + t.icon + '</span>' +
              '<span class="feedback-type-label">' + t.label + '</span></div>';
          }).join('')}
        </div>
      </div>
      <div class="feedback-form-section">
        <div class="feedback-form-label">问题标题 <span style="color:var(--danger);">*</span></div>
        <div class="input-clear-wrap">
          <input type="text" id="feedback-title" class="feedback-input" placeholder="简要描述问题（限50字）" maxlength="50" oninput="updateFeedbackCharCount('title', 50)">
          <button class="input-clear-btn" onclick="clearInput('feedback-title');updateFeedbackCharCount('title',50)">✕</button>
        </div>
        <div class="feedback-char-count"><span id="feedback-title-count">0</span>/50</div>
      </div>
      <div class="feedback-form-section">
        <div class="feedback-form-label">详细描述 <span style="color:var(--danger);">*</span></div>
        <div class="input-clear-wrap textarea-wrap">
          <textarea id="feedback-content" class="feedback-textarea" placeholder="请详细描述问题的情况、复现步骤等（限1000字）" maxlength="1000" oninput="updateFeedbackCharCount('content', 1000)"></textarea>
          <button class="input-clear-btn" onclick="document.getElementById('feedback-content').value='';updateFeedbackCharCount('content',1000)">✕</button>
        </div>
        <div class="feedback-char-count"><span id="feedback-content-count">0</span>/1000</div>
      </div>
      <div class="feedback-form-section">
        <div class="feedback-form-label">上传截图（可选，最多3张）</div>
        <div class="feedback-image-upload" id="feedback-image-upload">
          <div class="feedback-image-add" onclick="document.getElementById('feedback-file-input').click()">
            <span>📷</span>
            <span style="font-size:0.7rem;color:var(--text-secondary);">添加截图</span>
          </div>
        </div>
        <input type="file" id="feedback-file-input" accept="image/*" multiple style="display:none;" onchange="handleFeedbackImageUpload(event)">
      </div>
      <div class="feedback-form-section">
        <div class="feedback-form-label">联系方式（选填）</div>
        <div class="input-clear-wrap">
          <input type="text" id="feedback-contact" class="feedback-input" placeholder="微信号/QQ/邮箱，方便我们联系您" maxlength="50">
          <button class="input-clear-btn" onclick="clearInput('feedback-contact')">✕</button>
        </div>
      </div>
      <div class="feedback-form-section">
        <div class="feedback-form-label">设备信息（自动检测）</div>
        <div class="feedback-device-info">💻 ${escapeHTML(deviceInfo)}</div>
      </div>
      <button class="btn-primary feedback-submit-btn" id="feedback-submit-btn" onclick="submitFeedback()" style="width:100%;padding:0.8rem;font-size:1rem;">
        📤 提交反馈
      </button>
    </div>
    <div style="text-align:center;margin-top:1rem;">
      <button class="btn-secondary btn-sm" onclick="showPage('feedback-records')">📋 查看我的反馈记录</button>
    </div>
  `;
}

// 选择反馈类型
var _selectedFeedbackType = null;
function selectFeedbackType(type) {
  _selectedFeedbackType = type;
  document.querySelectorAll('.feedback-type-card').forEach(function(card) {
    card.classList.toggle('selected', card.dataset.type === type);
  });
}

// 字数统计
function updateFeedbackCharCount(field, max) {
  var el = document.getElementById('feedback-' + field);
  var countEl = document.getElementById('feedback-' + field + '-count');
  if(el && countEl) countEl.textContent = el.value.length;
}

// 反馈图片上传处理
var _feedbackImages = [];
function handleFeedbackImageUpload(event) {
  var files = event.target.files;
  if(!files || files.length === 0) return;
  if(_feedbackImages.length + files.length > 3) {
    toast('最多上传3张截图'); return;
  }
  var remaining = 3 - _feedbackImages.length;
  var toProcess = Array.from(files).slice(0, remaining);
  toProcess.forEach(function(file) {
    if(!file.type.startsWith('image/')) { toast('请上传图片文件'); return; }
    var reader = new FileReader();
    reader.onload = function(e) {
      compressImage(e.target.result, 1200, 0.7, function(blob) {
        var imgId = 'fb_img_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
        _feedbackImages.push({ id: imgId, blob: blob, dataUrl: e.target.result });
        renderFeedbackImagePreview();
      });
    };
    reader.readAsDataURL(file);
  });
  event.target.value = '';
}

// Canvas压缩图片
function compressImage(dataUrl, maxWidth, quality, callback) {
  var img = new Image();
  img.onload = function() {
    var canvas = document.createElement('canvas');
    var w = img.width, h = img.height;
    if(w > maxWidth) { h = Math.round(h * maxWidth / w); w = maxWidth; }
    canvas.width = w; canvas.height = h;
    var ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    canvas.toBlob(function(blob) {
      callback(blob || dataURLToBlob(canvas.toDataURL('image/jpeg', quality)));
    }, 'image/jpeg', quality);
  };
  img.src = dataUrl;
}

// dataURL转Blob
function dataURLToBlob(dataURL) {
  var arr = dataURL.split(',');
  var mime = arr[0].match(/:(.*?);/)[1];
  var bstr = atob(arr[1]);
  var n = bstr.length;
  var u8 = new Uint8Array(n);
  for(var i = 0; i < n; i++) u8[i] = bstr.charCodeAt(i);
  return new Blob([u8], { type: mime });
}

// 渲染反馈图片预览
function renderFeedbackImagePreview() {
  var container = document.getElementById('feedback-image-upload');
  if(!container) return;
  var html = _feedbackImages.map(function(img, idx) {
    return '<div class="feedback-image-thumb" style="position:relative;">' +
      '<img src="' + img.dataUrl + '" style="width:100%;height:100%;object-fit:cover;border-radius:8px;">' +
      '<button class="feedback-image-remove" onclick="removeFeedbackImage(' + idx + ')" style="position:absolute;top:-6px;right:-6px;width:20px;height:20px;border-radius:50%;background:#ef4444;color:#fff;border:none;font-size:0.7rem;cursor:pointer;display:flex;align-items:center;justify-content:center;">✕</button>' +
      '</div>';
  }).join('');
  if(_feedbackImages.length < 3) {
    html += '<div class="feedback-image-add" onclick="document.getElementById(\'feedback-file-input\').click()"><span>📷</span><span style="font-size:0.7rem;color:var(--text-secondary);">添加截图</span></div>';
  }
  container.innerHTML = html;
}

// 删除反馈图片
function removeFeedbackImage(idx) {
  _feedbackImages.splice(idx, 1);
  renderFeedbackImagePreview();
}

// 提交反馈
function submitFeedback() {
  var u = LoginManager.getCurrentUser();
  if(!u || u === 'guest') { toast('请先登录'); return; }
  // 防重复点击
  var btn = document.getElementById('feedback-submit-btn');
  if(btn.disabled) return;
  // 验证
  if(!_selectedFeedbackType) { toast('请选择反馈类型'); return; }
  var title = document.getElementById('feedback-title').value.trim();
  if(!title) { toast('请输入问题标题'); return; }
  var content = document.getElementById('feedback-content').value.trim();
  if(!content) { toast('请输入详细描述'); return; }
  var contact = document.getElementById('feedback-contact').value.trim();
  var deviceInfo = getDeviceInfo();
  // 反滥用：30秒内限制1次
  var lastTime = loadByUser(u, 'last_feedback_time', 0);
  if(lastTime && Date.now() - lastTime < 30000) {
    var waitSec = Math.ceil((30000 - (Date.now() - lastTime)) / 1000);
    toast('请等待 ' + waitSec + ' 秒后再提交'); return;
  }
  // loading状态
  btn.disabled = true;
  btn.textContent = '提交中...';
  // 生成ID
  var fbId = generateFeedbackId();
  var now = new Date();
  var nowStr = now.getFullYear() + '-' + pad(now.getMonth()+1) + '-' + pad(now.getDate()) + ' ' + pad(now.getHours()) + ':' + pad(now.getMinutes());
  // 保存图片到IndexedDB
  var imageKeys = _feedbackImages.map(function(img) { return img.id; });
  var savePromises = _feedbackImages.map(function(img) {
    return getFeedbackDB().then(function(db) {
      return idbPut(db, 'FeedbackImages', img.id, img.blob);
    });
  });
  Promise.all(savePromises).then(function() {
    // 创建反馈记录
    var feedback = {
      id: fbId,
      type: _selectedFeedbackType,
      title: title,
      content: content,
      images: imageKeys,
      userId: u,
      contact: contact,
      device: deviceInfo,
      status: 'pending',
      reply: '',
      replyAt: '',
      priority: 'medium',
      createdAt: nowStr,
      updatedAt: nowStr,
      isAbuse: false,
      handler: ''
    };
    var list = getFeedbacks();
    list.unshift(feedback);
    saveFeedbacks(list);
    // 记录用户反馈索引
    var userFbIds = loadByUser(u, 'feedback_ids', []);
    userFbIds.unshift(fbId);
    saveByUser(u, 'feedback_ids', userFbIds);
    // 记录提交时间
    saveByUser(u, 'last_feedback_time', Date.now());
    // 重置状态
    _feedbackImages = [];
    _selectedFeedbackType = null;
    btn.disabled = false;
    btn.textContent = '📤 提交反馈';
    toast('✅ 反馈已提交，感谢您的支持！');
    // 跳转到反馈记录页
    setTimeout(function() { showPage('feedback-records'); }, 800);
  }).catch(function(err) {
    btn.disabled = false;
    btn.textContent = '📤 提交反馈';
    toast('⚠️ 提交失败，请重试');
  });
}

// 构建反馈记录页
function buildFeedbackRecordsPage(mc) {
  var u = LoginManager.getCurrentUser();
  if(!u || u === 'guest') {
    mc.innerHTML = '<div class="card" style="text-align:center;padding:3rem;"><div style="font-size:3rem;margin-bottom:1rem;">📋</div><p style="color:var(--text-secondary);">请先登录</p></div>';
    return;
  }
  var allFbs = getFeedbacks().filter(function(f) { return f.userId === u; });
  mc.innerHTML = `
    <div class="page-title">📋 我的反馈记录 <span class="badge">${allFbs.length} 条</span></div>
    <div class="feedback-records-list">
      ${allFbs.length === 0 ? `
        <div class="card" style="text-align:center;padding:3rem;">
          <div style="font-size:3rem;margin-bottom:1rem;">📭</div>
          <p style="color:var(--text-secondary);margin-bottom:1rem;">还没有反馈记录</p>
          <button class="btn-primary" onclick="showPage('feedback')">📝 我要反馈</button>
        </div>
      ` : allFbs.map(function(fb) {
        var typeCfg = FEEDBACK_TYPES[fb.type] || FEEDBACK_TYPES.other;
        var statusCfg = FEEDBACK_STATUS[fb.status] || FEEDBACK_STATUS.pending;
        var preview = fb.content.slice(0, 80) + (fb.content.length > 80 ? '...' : '');
        return `
          <div class="card feedback-record-card">
            <div class="feedback-record-header">
              <span class="feedback-record-type-icon">${typeCfg.icon}</span>
              <span class="feedback-record-title">${escapeHTML(fb.title)}</span>
              <span class="feedback-status-tag" style="color:${statusCfg.color};background:${statusCfg.bg};">${statusCfg.label}</span>
            </div>
            <div class="feedback-record-preview">${escapeHTML(preview)}</div>
            <div class="feedback-record-meta">
              <span>🕐 ${fb.createdAt}</span>
              ${fb.reply ? '<span style="color:var(--success);">💬 有回复</span>' : ''}
            </div>
            ${fb.reply ? `
              <div class="feedback-record-reply">
                <div style="font-size:0.7rem;color:var(--accent);font-weight:700;margin-bottom:0.3rem;">💬 岛主回复</div>
                <div style="font-size:0.8rem;line-height:1.5;">${escapeHTML(fb.reply)}</div>
                ${fb.replyAt ? '<div style="font-size:0.65rem;color:var(--text-secondary);margin-top:0.3rem;">' + fb.replyAt + '</div>' : ''}
              </div>
            ` : ''}
          </div>
        `;
      }).join('')}
    </div>
    <div class="feedback-records-fab">
      <button class="btn-primary" onclick="showPage('feedback')" style="padding:0.7rem 2rem;font-size:0.9rem;">📝 我要反馈</button>
    </div>
  `;
}

// ===== 管理后台 - 反馈管理Tab =====
var _feedbackFilterStatus = 'all';
var _feedbackSearchKeyword = '';

function buildAdminFeedbackTab() {
  var allFbs = getFeedbacks();
  // 统计各状态数量
  var counts = { all: allFbs.length, pending: 0, read: 0, replied: 0, resolved: 0, closed: 0 };
  allFbs.forEach(function(f) { if(counts[f.status] !== undefined) counts[f.status]++; });
  // 筛选
  var filtered = allFbs.filter(function(f) {
    if(_feedbackFilterStatus !== 'all' && f.status !== _feedbackFilterStatus) return false;
    if(_feedbackSearchKeyword) {
      var kw = _feedbackSearchKeyword.toLowerCase();
      var profile = getUserProfile(f.userId);
      var nickname = (profile.nickname || f.userId).toLowerCase();
      if(!f.title.toLowerCase().includes(kw) && !nickname.includes(kw) && !f.userId.toLowerCase().includes(kw)) return false;
    }
    return true;
  });
  return `
    <div class="admin-section">
      <div class="admin-section-title">📋 反馈管理</div>
      <div class="feedback-admin-tabs">
        ${Object.entries(FEEDBACK_STATUS).map(function(entry) {
          var key = entry[0], s = entry[1];
          return '<button class="feedback-admin-tab ' + (_feedbackFilterStatus === key ? 'active' : '') + '" onclick="_feedbackFilterStatus=\'' + key + '\';buildStatsPage(document.getElementById(\'main-content\'))">' + s.label + ' (' + counts[key] + ')</button>';
        }).join('')}
        <button class="feedback-admin-tab ' + (_feedbackFilterStatus === 'all' ? 'active' : '') + '" onclick="_feedbackFilterStatus=\'all\';buildStatsPage(document.getElementById(\'main-content\'))">全部 (' + counts.all + ')</button>
      </div>
      <div style="margin-bottom:0.8rem;">
        <input type="text" class="feedback-admin-search" placeholder="🔍 搜索提交人昵称或标题..." value="${escapeHTML(_feedbackSearchKeyword)}" oninput="filterAdminFeedback()" style="width:100%;padding:0.6rem 0.8rem;border:1px solid var(--border-color);border-radius:10px;background:var(--bg-body);color:var(--text-primary);font-size:0.85rem;">
      </div>
      <div class="admin-list">
        ${filtered.length === 0 ? '<div style="text-align:center;padding:2rem;color:var(--text-secondary);font-size:0.85rem;">暂无反馈</div>' : filtered.map(function(fb) {
          var typeCfg = FEEDBACK_TYPES[fb.type] || FEEDBACK_TYPES.other;
          var statusCfg = FEEDBACK_STATUS[fb.status] || FEEDBACK_STATUS.pending;
          var prioCfg = FEEDBACK_PRIORITY[fb.priority] || FEEDBACK_PRIORITY.medium;
          var profile = getUserProfile(fb.userId);
          return `
            <div class="admin-row feedback-admin-row" data-fb-title="${escapeHTML(fb.title)}" data-fb-user="${escapeHTML(fb.userId)}" onclick="openFeedbackDetail('${fb.id}')">
              <span class="feedback-admin-avatar" id="fb-avatar-${fb.id}">${profile.avatar || '👤'}</span>
              <div style="flex:1;min-width:0;">
                <div style="display:flex;align-items:center;gap:0.4rem;flex-wrap:wrap;">
                  <span style="font-size:1rem;">${typeCfg.icon}</span>
                  <span style="font-weight:700;font-size:0.82rem;">${escapeHTML(fb.title)}</span>
                  <span class="feedback-priority-tag" style="color:${prioCfg.color};font-size:0.65rem;" title="${prioCfg.label}优先级">${prioCfg.icon}</span>
                </div>
                <div style="font-size:0.7rem;color:var(--text-secondary);margin-top:0.2rem;">
                  ${escapeHTML(fb.userId)} · ${fb.createdAt}
                </div>
              </div>
              <span class="feedback-status-tag" style="color:${statusCfg.color};background:${statusCfg.bg};flex-shrink:0;">${statusCfg.label}</span>
              <button class="btn-secondary btn-sm" onclick="event.stopPropagation();openFeedbackDetail('${fb.id}')">处理</button>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

// 搜索筛选反馈列表（DOM级，不重建页面）
function filterAdminFeedback() {
  var input = document.querySelector('.feedback-admin-search');
  var q = (input || {}).value || '';
  _feedbackSearchKeyword = q;
  q = q.toLowerCase();
  document.querySelectorAll('.feedback-admin-row').forEach(function(row) {
    var title = (row.dataset.fbTitle || '').toLowerCase();
    var user = (row.dataset.fbUser || '').toLowerCase();
    var profile = getUserProfile(row.dataset.fbUser);
    var nickname = (profile.nickname || row.dataset.fbUser || '').toLowerCase();
    row.style.display = (!q || title.includes(q) || user.includes(q) || nickname.includes(q)) ? '' : 'none';
  });
}

// 反馈详情弹窗
function openFeedbackDetail(fbId) {
  var list = getFeedbacks();
  var fb = list.find(function(f) { return f.id === fbId; });
  if(!fb) { toast('反馈不存在'); return; }
  var typeCfg = FEEDBACK_TYPES[fb.type] || FEEDBACK_TYPES.other;
  var statusCfg = FEEDBACK_STATUS[fb.status] || FEEDBACK_STATUS.pending;
  var profile = getUserProfile(fb.userId);
  var content = document.getElementById('feedback-detail-modal-content');
  content.innerHTML = `
    <div class="modal-title">📋 反馈详情</div>
    <div class="feedback-detail-section">
      <div class="feedback-detail-row">
        <span class="feedback-detail-avatar" id="fb-detail-avatar">${profile.avatar || '👤'}</span>
        <div>
          <div style="font-weight:700;font-size:0.9rem;">${escapeHTML(fb.userId)}</div>
          <div style="font-size:0.7rem;color:var(--text-secondary);">${fb.createdAt}</div>
        </div>
      </div>
      <div class="feedback-detail-row">
        <span style="font-size:0.8rem;color:var(--text-secondary);min-width:70px;">类型</span>
        <span>${typeCfg.icon} ${typeCfg.label}</span>
      </div>
      ${fb.contact ? '<div class="feedback-detail-row"><span style="font-size:0.8rem;color:var(--text-secondary);min-width:70px;">联系方式</span><span style="font-size:0.85rem;">' + escapeHTML(fb.contact) + '</span></div>' : ''}
      <div class="feedback-detail-row">
        <span style="font-size:0.8rem;color:var(--text-secondary);min-width:70px;">标题</span>
        <span style="font-weight:600;">${escapeHTML(fb.title)}</span>
      </div>
      <div class="feedback-detail-row" style="flex-direction:column;align-items:flex-start;gap:0.3rem;">
        <span style="font-size:0.8rem;color:var(--text-secondary);">详细描述</span>
        <div style="font-size:0.85rem;line-height:1.6;width:100%;padding:0.6rem;background:var(--bg-body);border-radius:8px;white-space:pre-wrap;">${escapeHTML(fb.content)}</div>
      </div>
      ${fb.images && fb.images.length > 0 ? `
        <div class="feedback-detail-row" style="flex-direction:column;align-items:flex-start;gap:0.3rem;">
          <span style="font-size:0.8rem;color:var(--text-secondary);">截图（${fb.images.length}张）</span>
          <div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
            ${fb.images.map(function(imgId) {
              return '<div class="feedback-detail-image" id="fb-img-' + imgId + '" onclick="viewFeedbackImage(\'' + imgId + '\')" style="width:80px;height:80px;border-radius:8px;background:var(--bg-body);border:1px solid var(--border-color);display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:1.5rem;">🖼️</div>';
            }).join('')}
          </div>
        </div>
      ` : ''}
      <div class="feedback-detail-row">
        <span style="font-size:0.8rem;color:var(--text-secondary);min-width:70px;">设备</span>
        <span style="font-size:0.8rem;color:var(--text-secondary);">💻 ${escapeHTML(fb.device)}</span>
      </div>
    </div>
    <div class="feedback-detail-section">
      <div style="font-size:0.8rem;color:var(--text-secondary);margin-bottom:0.4rem;">状态</div>
      <select id="fb-status-select" class="feedback-detail-select">
        <option value="pending" ${fb.status === 'pending' ? 'selected' : ''}>待处理</option>
        <option value="read" ${fb.status === 'read' ? 'selected' : ''}>已读</option>
        <option value="replied" ${fb.status === 'replied' ? 'selected' : ''}>已回复</option>
        <option value="resolved" ${fb.status === 'resolved' ? 'selected' : ''}>已解决</option>
        <option value="closed" ${fb.status === 'closed' ? 'selected' : ''}>已关闭</option>
      </select>
    </div>
    <div class="feedback-detail-section">
      <div style="font-size:0.8rem;color:var(--text-secondary);margin-bottom:0.4rem;">优先级</div>
      <select id="fb-priority-select" class="feedback-detail-select">
        <option value="emergency" ${fb.priority === 'emergency' ? 'selected' : ''}>🔴 紧急</option>
        <option value="high" ${fb.priority === 'high' ? 'selected' : ''}>🟠 高</option>
        <option value="medium" ${fb.priority === 'medium' ? 'selected' : ''}>🔵 中</option>
        <option value="low" ${fb.priority === 'low' ? 'selected' : ''}>⚪ 低</option>
      </select>
    </div>
    <div class="feedback-detail-section">
      <div style="font-size:0.8rem;color:var(--text-secondary);margin-bottom:0.4rem;">回复内容</div>
      <textarea id="fb-reply-input" class="feedback-detail-textarea" placeholder="输入回复内容..." maxlength="500">${escapeHTML(fb.reply || '')}</textarea>
    </div>
    ${fb.reply ? '<div style="font-size:0.7rem;color:var(--text-secondary);margin-bottom:0.8rem;">上次回复：' + (fb.replyAt || '未知时间') + '</div>' : ''}
    <div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
      <button class="btn-primary" onclick="saveFeedbackReply('${fb.id}')" style="flex:1;">✅ 提交回复</button>
      <button class="btn-secondary btn-sm" onclick="adoptFeedback('${fb.id}')" style="background:rgba(16,185,129,0.15);color:var(--success);border-color:var(--success);">🎁 采纳并奖励</button>
      ${fb.type === 'bug' ? '<button class="btn-secondary btn-sm" onclick="confirmBugFeedback(\'' + fb.id + '\')" style="background:rgba(245,158,11,0.15);color:var(--warning);border-color:var(--warning);">🐛 确认Bug</button>' : ''}
      ${currentIsDeveloper() ? '<button class="btn-secondary btn-sm" onclick="deleteFeedback(\'' + fb.id + '\')" style="color:var(--danger);">🗑 删除</button>' : ''}
      <button class="btn-secondary btn-sm" onclick="markFeedbackAbuse('${fb.id}')" style="color:var(--danger);">⚠️ 标记滥用</button>
    </div>
  `;
  openModal('feedback-detail-modal');
  // 异步加载头像
  setTimeout(function() {
    var avatarEl = document.getElementById('fb-detail-avatar');
    if(avatarEl) renderAvatar(fb.userId, avatarEl, 40, true);
  }, 50);
  // 异步加载截图
  if(fb.images && fb.images.length > 0) {
    fb.images.forEach(function(imgId) {
      getFeedbackDB().then(function(db) {
        return idbGet(db, 'FeedbackImages', imgId);
      }).then(function(blob) {
        if(blob) {
          var url = URL.createObjectURL(blob);
          var el = document.getElementById('fb-img-' + imgId);
          if(el) { el.innerHTML = '<img src="' + url + '" style="width:100%;height:100%;object-fit:cover;border-radius:8px;">'; }
        }
      });
    });
  }
}

// 查看反馈图片大图
function viewFeedbackImage(imgId) {
  getFeedbackDB().then(function(db) {
    return idbGet(db, 'FeedbackImages', imgId);
  }).then(function(blob) {
    if(!blob) { toast('图片加载失败'); return; }
    var url = URL.createObjectURL(blob);
    var content = document.getElementById('feedback-image-modal-content');
    content.innerHTML = '<img src="' + url + '" style="max-width:90vw;max-height:80vh;border-radius:12px;display:block;margin:0 auto;">';
    openModal('feedback-image-modal');
  });
}

// 保存反馈回复
function saveFeedbackReply(fbId) {
  var list = getFeedbacks();
  var fb = list.find(function(f) { return f.id === fbId; });
  if(!fb) return;
  var reply = document.getElementById('fb-reply-input').value.trim();
  var status = document.getElementById('fb-status-select').value;
  var priority = document.getElementById('fb-priority-select').value;
  var now = new Date();
  var nowStr = now.getFullYear() + '-' + pad(now.getMonth()+1) + '-' + pad(now.getDate()) + ' ' + pad(now.getHours()) + ':' + pad(now.getMinutes());
  var changes = [];
  if(reply && reply !== fb.reply) {
    fb.reply = reply;
    fb.replyAt = nowStr;
    if(status === 'pending' || status === 'read') status = 'replied';
    changes.push('回复内容');
  }
  if(status !== fb.status) { changes.push('状态: ' + (FEEDBACK_STATUS[status]||{}).label); }
  if(priority !== fb.priority) { changes.push('优先级: ' + (FEEDBACK_PRIORITY[priority]||{}).label); }
  fb.status = status;
  fb.priority = priority;
  fb.updatedAt = nowStr;
  fb.handler = LoginManager.getCurrentUser();
  saveFeedbacks(list);
  // 记录状态变更日志
  var log = getFeedbackStatusLog();
  log.unshift({ fbId: fbId, action: '回复/更新', changes: changes.join(', '), operator: fb.handler, time: nowStr });
  if(log.length > 500) log.length = 500;
  saveFeedbackStatusLog(log);
  adminLog('处理反馈', '反馈[' + fb.title + '] ' + changes.join('、'), fb.userId);
  closeModal('feedback-detail-modal');
  toast('✅ 已保存回复');
  buildStatsPage(document.getElementById('main-content'));
}

// 采纳并奖励
function adoptFeedback(fbId) {
  var list = getFeedbacks();
  var fb = list.find(function(f) { return f.id === fbId; });
  if(!fb) return;
  var amount = parseInt(prompt('请输入奖励积分数（建议50-200）：', '100'));
  if(!amount || amount <= 0) return;
  // 给用户加积分
  var currentPoints = loadByUser(fb.userId, 'shop_points', 0);
  saveByUser(fb.userId, 'shop_points', currentPoints + amount);
  recordPointFlow(fb.userId, amount, '反馈采纳奖励[' + fb.title + ']', LoginManager.getCurrentUser());
  // 更新反馈状态
  fb.status = 'resolved';
  fb.updatedAt = new Date().toLocaleString('zh-CN');
  fb.handler = LoginManager.getCurrentUser();
  saveFeedbacks(list);
  adminLog('采纳反馈', '反馈[' + fb.title + '] 奖励' + amount + '积分给' + fb.userId, fb.userId);
  // 检查是否解锁共建者称号
  checkCoBuilderTitle(fb.userId);
  closeModal('feedback-detail-modal');
  toast('✅ 已采纳并奖励 ' + amount + ' 积分给 ' + fb.userId);
  buildStatsPage(document.getElementById('main-content'));
}

// 确认Bug奖励
function confirmBugFeedback(fbId) {
  var list = getFeedbacks();
  var fb = list.find(function(f) { return f.id === fbId; });
  if(!fb) return;
  var amount = 30;
  var currentPoints = loadByUser(fb.userId, 'shop_points', 0);
  saveByUser(fb.userId, 'shop_points', currentPoints + amount);
  recordPointFlow(fb.userId, amount, 'Bug确认奖励[' + fb.title + ']', LoginManager.getCurrentUser());
  fb.status = 'resolved';
  fb.updatedAt = new Date().toLocaleString('zh-CN');
  fb.handler = LoginManager.getCurrentUser();
  saveFeedbacks(list);
  adminLog('确认Bug', '反馈[' + fb.title + '] 奖励' + amount + '积分给' + fb.userId, fb.userId);
  checkCoBuilderTitle(fb.userId);
  closeModal('feedback-detail-modal');
  toast('✅ 已确认Bug并奖励 ' + amount + ' 积分给 ' + fb.userId);
  buildStatsPage(document.getElementById('main-content'));
}

// 标记滥用
function markFeedbackAbuse(fbId) {
  if(!confirm('确定要标记此反馈为滥用吗？\n连续3次被标记无效将限制该用户提交3天。')) return;
  var list = getFeedbacks();
  var fb = list.find(function(f) { return f.id === fbId; });
  if(!fb) return;
  fb.isAbuse = true;
  fb.status = 'closed';
  fb.updatedAt = new Date().toLocaleString('zh-CN');
  fb.handler = LoginManager.getCurrentUser();
  saveFeedbacks(list);
  // 检查是否需要封禁
  var abuseCount = list.filter(function(f) { return f.userId === fb.userId && f.isAbuse; }).length;
  if(abuseCount >= 3) {
    var banUntil = Date.now() + 3 * 24 * 60 * 60 * 1000;
    saveByUser(fb.userId, 'feedback_ban_until', banUntil);
    toast('⚠️ 该用户已被标记3次滥用，反馈权限限制3天');
  } else {
    toast('已标记滥用（' + abuseCount + '/3）');
  }
  adminLog('标记滥用', '反馈[' + fb.title + ']被标记滥用', fb.userId);
  closeModal('feedback-detail-modal');
  buildStatsPage(document.getElementById('main-content'));
}

// 删除反馈
function deleteFeedback(fbId) {
  if(!currentIsDeveloper()) { toast('仅开发者可删除'); return; }
  if(!confirm('确定要删除此反馈吗？此操作不可撤销。')) return;
  var list = getFeedbacks();
  var fb = list.find(function(f) { return f.id === fbId; });
  list = list.filter(function(f) { return f.id !== fbId; });
  saveFeedbacks(list);
  // 删除图片
  if(fb && fb.images && fb.images.length > 0) {
    getFeedbackDB().then(function(db) {
      fb.images.forEach(function(imgId) { idbDelete(db, 'FeedbackImages', imgId); });
    });
  }
  adminLog('删除反馈', '删除反馈[' + (fb ? fb.title : fbId) + ']', fb ? fb.userId : '');
  closeModal('feedback-detail-modal');
  toast('🗑 反馈已删除');
  buildStatsPage(document.getElementById('main-content'));
}

// 检查共建者称号
function checkCoBuilderTitle(userId) {
  var userFbIds = loadByUser(userId, 'feedback_ids', []);
  var allFbs = getFeedbacks();
  var validCount = allFbs.filter(function(f) { return f.userId === userId && f.status === 'resolved' && !f.isAbuse; }).length;
  if(validCount >= 10) {
    var profile = getUserProfile(userId);
    if(!profile.unlockedTitles) profile.unlockedTitles = [];
    if(!profile.unlockedTitles.includes('co_builder')) {
      profile.unlockedTitles.push('co_builder');
      profile.title = profile.title || '🤝 共建者';
      saveUserProfile(userId, profile);
      adminLog('授予称号', '授予' + userId + '「🤝 共建者」称号', userId);
    }
  }
}

// =========================================
//  v6.0 头像系统
// =========================================

// 昵称hash → 色相
function hashNickname(nickname) {
  var hash = 0;
  for(var i = 0; i < nickname.length; i++) {
    hash = ((hash << 5) - hash + nickname.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 360;
}

// 生成默认头像Blob
function generateDefaultAvatarBlob(nickname) {
  return new Promise(function(resolve) {
    var canvas = document.createElement('canvas');
    canvas.width = 200; canvas.height = 200;
    var ctx = canvas.getContext('2d');
    // 背景色
    var hue = hashNickname(nickname);
    ctx.fillStyle = 'hsl(' + hue + ', 70%, 45%)';
    ctx.fillRect(0, 0, 200, 200);
    // 文字
    var text = '';
    if(/^[\u4e00-\u9fa5]/.test(nickname)) {
      text = nickname.charAt(0);
    } else {
      text = nickname.charAt(0).toUpperCase();
    }
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 90px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 100, 105);
    canvas.toBlob(function(blob) {
      resolve(blob);
    }, 'image/png');
  });
}

// 生成默认头像dataURL（同步，用于即时显示）
function generateDefaultAvatarDataURL(nickname) {
  var canvas = document.createElement('canvas');
  canvas.width = 200; canvas.height = 200;
  var ctx = canvas.getContext('2d');
  var hue = hashNickname(nickname);
  ctx.fillStyle = 'hsl(' + hue + ', 70%, 45%)';
  ctx.fillRect(0, 0, 200, 200);
  var text = '';
  if(/^[\u4e00-\u9fa5]/.test(nickname)) {
    text = nickname.charAt(0);
  } else {
    text = nickname.charAt(0).toUpperCase();
  }
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 90px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 100, 105);
  return canvas.toDataURL('image/png');
}

// 获取头像元数据
function getAvatarMeta(userId) {
  return loadByUser(userId, 'avatar_meta', null);
}

// 保存头像元数据
function saveAvatarMeta(userId, meta) {
  saveByUser(userId, 'avatar_meta', meta);
}

// 统一头像渲染函数（异步）
function renderAvatar(userId, container, size, isCircle) {
  if(!userId || userId === 'guest' || !container) return;
  size = size || 40;
  // 先显示默认头像占位
  var defaultUrl = generateDefaultAvatarDataURL(userId);
  container.innerHTML = '<img src="' + defaultUrl + '" style="width:' + size + 'px;height:' + size + 'px;' + (isCircle ? 'border-radius:50%;' : '') + 'object-fit:cover;display:block;" alt="' + escapeHTML(userId) + '">';
  // 异步从IndexedDB加载
  getAvatarDB().then(function(db) {
    return idbGet(db, 'UserAvatars', userId + '_avatar');
  }).then(function(blob) {
    if(blob) {
      var url = URL.createObjectURL(blob);
      var img = container.querySelector('img');
      if(img) {
        img.src = url;
        img.onerror = function() { img.src = defaultUrl; };
      }
    }
  }).catch(function() {
    // 失败则保持默认头像
  });
}

// 打开头像Action Sheet
function openAvatarActionSheet() {
  document.getElementById('avatar-action-sheet-overlay').classList.add('active');
  document.getElementById('avatar-action-sheet').classList.add('active');
}

function closeAvatarActionSheet() {
  document.getElementById('avatar-action-sheet-overlay').classList.remove('active');
  document.getElementById('avatar-action-sheet').classList.remove('active');
}

// 拍照
function avatarActionFromCamera() {
  closeAvatarActionSheet();
  var input = document.getElementById('avatar-file-input');
  input.setAttribute('capture', 'environment');
  input.click();
  setTimeout(function() { input.removeAttribute('capture'); }, 500);
}

// 从相册
function avatarActionFromAlbum() {
  closeAvatarActionSheet();
  document.getElementById('avatar-file-input').click();
}

// 恢复默认头像
function avatarActionRestoreDefault() {
  closeAvatarActionSheet();
  var u = LoginManager.getCurrentUser();
  if(!u) return;
  // 删除IndexedDB中的头像
  getAvatarDB().then(function(db) {
    return idbDelete(db, 'UserAvatars', u + '_avatar');
  }).then(function() {
    // 更新元数据
    saveAvatarMeta(u, { userId: u, avatarKey: null, mimeType: 'image/png', size: 0, updatedAt: new Date().toISOString(), isDefault: true });
    // 更新profile中的avatar为空（使用默认生成）
    var profile = getUserProfile(u);
    profile.avatar = null;
    saveUserProfile(u, profile);
    // 刷新头像
    dispatchAvatarUpdate(u);
    toast('✅ 已恢复默认头像');
    buildProfilePage(document.getElementById('main-content'));
  }).catch(function() {
    toast('⚠️ 操作失败');
  });
}

// 处理头像文件选择
function handleAvatarFileSelect(event) {
  var file = event.target.files[0];
  if(!file) return;
  // 验证文件大小（5MB限制）
  if(file.size > 5 * 1024 * 1024) {
    toast('⚠️ 图片不能超过5MB'); return;
  }
  // 验证文件类型
  if(!/image\/(jpeg|png|webp|gif)/.test(file.type)) {
    toast('⚠️ 仅支持 JPEG/PNG/WebP/GIF 格式'); return;
  }
  var reader = new FileReader();
  reader.onload = function(e) {
    openAvatarCropModal(e.target.result);
  };
  reader.readAsDataURL(file);
  event.target.value = '';
}

// 打开头像裁剪弹窗
var _avatarCropState = { img: null, x: 0, y: 0, scale: 1, imgW: 0, imgH: 0 };
function openAvatarCropModal(dataUrl) {
  var content = document.getElementById('avatar-crop-modal-content');
  content.innerHTML = `
    <div class="modal-title">✂️ 裁剪头像</div>
    <div class="avatar-crop-area" id="avatar-crop-area">
      <div class="avatar-crop-circle" id="avatar-crop-circle"></div>
      <img id="avatar-crop-img" src="${dataUrl}" style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%) scale(1);max-width:none;user-select:none;pointer-events:none;" crossorigin="anonymous">
    </div>
    <div style="font-size:0.75rem;color:var(--text-secondary);text-align:center;margin-bottom:0.8rem;">
      拖拽移动 · 滚轮缩放 · 双指缩放（移动端）
    </div>
    <div style="display:flex;gap:0.3rem;margin-bottom:1rem;justify-content:center;">
      <button class="btn-secondary btn-sm" onclick="avatarCropZoom(0.1)">🔍＋</button>
      <button class="btn-secondary btn-sm" onclick="avatarCropZoom(-0.1)">🔍－</button>
      <button class="btn-secondary btn-sm" onclick="avatarCropReset()">↺ 重置</button>
    </div>
    <div style="display:flex;gap:0.6rem;">
      <button class="btn-primary" onclick="confirmAvatarCrop()" style="flex:1;">✅ 确定</button>
      <button class="btn-secondary" onclick="closeModal('avatar-crop-modal')" style="flex:1;">取消</button>
    </div>
  `;
  openModal('avatar-crop-modal');
  // 初始化裁剪状态
  var img = document.getElementById('avatar-crop-img');
  _avatarCropState = { img: img, x: 0, y: 0, scale: 1, imgW: 0, imgH: 0, dataUrl: dataUrl };
  img.onload = function() {
    _avatarCropState.imgW = img.naturalWidth;
    _avatarCropState.imgH = img.naturalHeight;
    // 初始缩放使图片填满裁剪区
    var areaSize = 300;
    var minScale = Math.max(areaSize / img.naturalWidth, areaSize / img.naturalHeight);
    _avatarCropState.scale = minScale;
    _avatarCropState.x = 0;
    _avatarCropState.y = 0;
    updateAvatarCropTransform();
  };
  // 绑定拖拽
  var area = document.getElementById('avatar-crop-area');
  var isDragging = false;
  var dragStartX = 0, dragStartY = 0;
  var startX = 0, startY = 0;
  area.addEventListener('mousedown', function(e) {
    isDragging = true;
    dragStartX = e.clientX; dragStartY = e.clientY;
    startX = _avatarCropState.x; startY = _avatarCropState.y;
    e.preventDefault();
  });
  document.addEventListener('mousemove', function(e) {
    if(!isDragging) return;
    _avatarCropState.x = startX + (e.clientX - dragStartX);
    _avatarCropState.y = startY + (e.clientY - dragStartY);
    updateAvatarCropTransform();
  });
  document.addEventListener('mouseup', function() { isDragging = false; });
  // 触摸事件
  var touchStartDist = 0;
  var touchStartScale = 1;
  area.addEventListener('touchstart', function(e) {
    if(e.touches.length === 1) {
      isDragging = true;
      dragStartX = e.touches[0].clientX; dragStartY = e.touches[0].clientY;
      startX = _avatarCropState.x; startY = _avatarCropState.y;
    } else if(e.touches.length === 2) {
      isDragging = false;
      var dx = e.touches[0].clientX - e.touches[1].clientX;
      var dy = e.touches[0].clientY - e.touches[1].clientY;
      touchStartDist = Math.sqrt(dx*dx + dy*dy);
      touchStartScale = _avatarCropState.scale;
    }
    e.preventDefault();
  }, { passive: false });
  area.addEventListener('touchmove', function(e) {
    if(e.touches.length === 1 && isDragging) {
      _avatarCropState.x = startX + (e.touches[0].clientX - dragStartX);
      _avatarCropState.y = startY + (e.touches[0].clientY - dragStartY);
      updateAvatarCropTransform();
    } else if(e.touches.length === 2) {
      var dx = e.touches[0].clientX - e.touches[1].clientX;
      var dy = e.touches[0].clientY - e.touches[1].clientY;
      var dist = Math.sqrt(dx*dx + dy*dy);
      _avatarCropState.scale = Math.max(0.1, touchStartScale * (dist / touchStartDist));
      updateAvatarCropTransform();
    }
    e.preventDefault();
  }, { passive: false });
  area.addEventListener('touchend', function() { isDragging = false; });
  // 滚轮缩放
  area.addEventListener('wheel', function(e) {
    e.preventDefault();
    _avatarCropState.scale = Math.max(0.1, _avatarCropState.scale + (e.deltaY > 0 ? -0.1 : 0.1));
    updateAvatarCropTransform();
  });
}

function updateAvatarCropTransform() {
  if(!_avatarCropState.img) return;
  _avatarCropState.img.style.transform = 'translate(calc(-50% + ' + _avatarCropState.x + 'px), calc(-50% + ' + _avatarCropState.y + 'px)) scale(' + _avatarCropState.scale + ')';
}

function avatarCropZoom(delta) {
  _avatarCropState.scale = Math.max(0.1, _avatarCropState.scale + delta);
  updateAvatarCropTransform();
}

function avatarCropReset() {
  var img = _avatarCropState.img;
  if(!img || !_avatarCropState.imgW) return;
  var areaSize = 300;
  var minScale = Math.max(areaSize / _avatarCropState.imgW, areaSize / _avatarCropState.imgH);
  _avatarCropState.scale = minScale;
  _avatarCropState.x = 0;
  _avatarCropState.y = 0;
  updateAvatarCropTransform();
}

// 确认裁剪
function confirmAvatarCrop() {
  var u = LoginManager.getCurrentUser();
  if(!u) return;
  var st = _avatarCropState;
  if(!st.img || !st.imgW) { toast('图片未加载'); return; }
  // 裁剪区域尺寸（视觉指引300x300，实际裁剪500x500）
  var areaSize = 300;
  var cropSize = 500;
  // 计算源图像裁剪区域
  // 图片中心在裁剪区域中的位置为 (150 + x, 150 + y)
  // 源裁剪区域 = 300px / scale (转换为原图像素)
  var srcW = areaSize / st.scale;
  var srcH = areaSize / st.scale;
  var srcX = st.imgW / 2 - (areaSize / 2 + st.x) / st.scale;
  var srcY = st.imgH / 2 - (areaSize / 2 + st.y) / st.scale;
  // 边界保护
  srcX = Math.max(0, Math.min(srcX, st.imgW - srcW));
  srcY = Math.max(0, Math.min(srcY, st.imgH - srcH));
  srcW = Math.min(srcW, st.imgW - srcX);
  srcH = Math.min(srcH, st.imgH - srcY);
  // 创建裁剪Canvas
  var canvas = document.createElement('canvas');
  canvas.width = cropSize; canvas.height = cropSize;
  var ctx = canvas.getContext('2d');
  // 绘制裁剪区域
  ctx.drawImage(st.img, srcX, srcY, srcW, srcH, 0, 0, cropSize, cropSize);
  // 导出WebP（不支持则PNG）
  var mimeType = 'image/webp';
  var quality = 0.8;
  var dataUrl = canvas.toDataURL(mimeType, quality);
  if(!dataUrl || dataUrl.indexOf('data:image/webp') !== 0) {
    mimeType = 'image/png';
    dataUrl = canvas.toDataURL(mimeType);
  }
  var blob = dataURLToBlob(dataUrl);
  // 保存到IndexedDB
  getAvatarDB().then(function(db) {
    return idbPut(db, 'UserAvatars', u + '_avatar', blob);
  }).then(function() {
    // 更新元数据
    saveAvatarMeta(u, {
      userId: u,
      avatarKey: u + '_avatar',
      mimeType: mimeType,
      size: blob.size,
      updatedAt: new Date().toISOString(),
      isDefault: false
    });
    // 更新profile
    var profile = getUserProfile(u);
    profile.avatar = null; // 使用自定义头像，不再用emoji
    saveUserProfile(u, profile);
    // 通知头像更新
    dispatchAvatarUpdate(u);
    closeModal('avatar-crop-modal');
    toast('✅ 头像已更新！');
    buildProfilePage(document.getElementById('main-content'));
    updateUserMenu();
  }).catch(function() {
    toast('⚠️ 头像保存失败');
  });
}

// 头像更新事件分发
function dispatchAvatarUpdate(userId) {
  window.dispatchEvent(new CustomEvent('avatar-updated', { detail: { userId: userId } }));
}

// 确保新用户有默认头像
function ensureDefaultAvatar(userId) {
  if(!userId || userId === 'guest') return;
  var meta = getAvatarMeta(userId);
  if(meta) return; // 已有头像
  // 生成默认头像并存入IndexedDB
  generateDefaultAvatarBlob(userId).then(function(blob) {
    getAvatarDB().then(function(db) {
      return idbPut(db, 'UserAvatars', userId + '_avatar', blob);
    }).then(function() {
      saveAvatarMeta(userId, {
        userId: userId,
        avatarKey: userId + '_avatar',
        mimeType: 'image/png',
        size: blob.size,
        updatedAt: new Date().toISOString(),
        isDefault: true
      });
    });
  }).catch(function() {
    // 静默失败，renderAvatar会实时生成
  });
}

// =========================================
//  初始化
// =========================================
(function init() {
  if(LoginManager.getCurrentUser()) {
    // 已登录 → 恢复设置
    restoreUserSettings();
    updateUserMenu();
    // 确保默认头像存在
    ensureDefaultAvatar(LoginManager.getCurrentUser());
    // 启动心跳
    heartbeatOnline();
    setInterval(heartbeatOnline, HEARTBEAT_INTERVAL);
  } else {
    // 未登录 → 显示登录遮罩 & 绑定回车
    const overlay = document.getElementById('login-overlay');
    if(overlay) overlay.style.display = 'flex';
    document.addEventListener('keydown', _loginKeyHandler);
  }
})();
