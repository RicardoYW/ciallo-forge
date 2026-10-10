'use strict';

/**
 * Token 解析器。
 * 语法：{name} / {name:arg1|arg2}
 * 带 `min` 字段的条目要满足 min <= heat 才可被选中；`weight` 参与加权。
 */

const { Rng } = require('../util/rng');

const TOKEN_OPEN = /[{｛]/;
const MAX_DEPTH = 6;

function pickWeighted(rng, list) {
  if (!list || list.length === 0) return undefined;
  const total = list.reduce((s, x) => s + Math.max(0.0001, num(x.weight, 1)), 0);
  let r = rng.next() * total;
  for (const x of list) {
    r -= Math.max(0.0001, num(x.weight, 1));
    if (r <= 0) return x;
  }
  return list[list.length - 1];
}

function num(v, dflt) {
  const n = Number(v);
  return Number.isFinite(n) ? n : dflt;
}

/** 池子条目里是否引用了「对方」；无 B 时必须跳过这些条目 */
const PARTNER_TOKEN = /\{(\/?)(B|target|pronB|pronB2)\}/;

/**
 * 从带 min/weight 的池子里按 heat 过滤后取一条。
 * 无候选时只放宽到该池的最低档（绝不回退到全池，否则高热词会漏进低热场景）。
 * uniqueKey：同一个 beat 内不重复；unique：整篇不重复（用完返回空串，让调用方停止补写）。
 * 单人卡司（scope.noPartner）时自动剔除引用对方的条目。
 */
function fromPool(scope, pool, { budgetKey = null, avoid = null, uniqueKey = null, unique = false } = {}) {
  if (!Array.isArray(pool) || !pool.length) return '';
  const heat = num(scope.ctx && scope.ctx.heat, 3);
  const minOf = (x) => (typeof x === 'object' ? num(x.min, 1) : 1);

  let base = pool;
  if (scope.noPartner) {
    const solo = pool.filter((x) => !PARTNER_TOKEN.test(str(x)));
    if (solo.length) base = solo;
  }

  let cands = base.filter((x) => minOf(x) <= heat);
  if (!cands.length) {
    const floor = Math.min(...base.map(minOf));
    cands = base.filter((x) => minOf(x) === floor);
  }

  if (avoid && avoid.size) {
    const filtered = cands.filter((x) => !avoid.has(str(x)));
    if (filtered.length) cands = filtered;
  }
  if (uniqueKey) {
    if (!scope.used) scope.used = {};
    const seen = scope.used[uniqueKey] || (scope.used[uniqueKey] = new Set());
    const filtered = cands.filter((x) => !seen.has(str(x)));
    if (filtered.length) cands = filtered;
  }
  if (unique) {
    if (!scope.used) scope.used = {};
    const seen = scope.used.__global || (scope.used.__global = new Set());
    const filtered = cands.filter((x) => !seen.has(str(x)));
    if (!filtered.length) return '';
    cands = filtered;
  }

  const out = str(pickWeighted(scope.rng, cands));
  if (budgetKey && scope.budget) {
    if (!scope.budget[budgetKey]) scope.budget[budgetKey] = new Set();
    scope.budget[budgetKey].add(out);
  }
  if (uniqueKey) scope.used[uniqueKey].add(out);
  if (unique) scope.used.__global.add(out);
  if (avoid && out) avoid.add(out);
  return out;
}

/** 不重复取 n 条并拼接 */
function fromPoolN(scope, pool, n, join = '，', opts = {}) {
  const picked = [];
  const avoid = new Set();
  const times = Math.max(1, num(n, 1));
  for (let i = 0; i < times; i++) {
    const v = fromPool(scope, pool, { ...opts, avoid });
    if (!v) break;
    picked.push(v);
  }
  return picked.join(join);
}

function str(x) {
  if (x == null) return '';
  if (typeof x === 'object') return String(x.text ?? x.value ?? '');
  return String(x);
}

const PRONOUN_BY_GENDER = { female: '她', male: '他', neutral: '对方' };

function pron(character, dflt = '她') {
  if (!character) return dflt;
  if (character.pronoun) return character.pronoun;
  if (character.gender) {
    const g = String(character.gender).toLowerCase();
    for (const [k, v] of Object.entries(PRONOUN_BY_GENDER)) {
      if (g.startsWith(k) || g === v) return v;
    }
  }
  return dflt;
}

function plainList(scope, list, key) {
  if (!Array.isArray(list) || !list.length) return '';
  const used = (scope.budget && scope.budget[key]) || new Set();
  let cands = list.filter((x) => !used.has(str(x)));
  if (!cands.length) cands = list;
  const v = str(scope.rng.pick(cands));
  if (scope.budget) {
    if (!scope.budget[key]) scope.budget[key] = new Set();
    scope.budget[key].add(v);
  }
  return v;
}

/** 建立 scope：绑定两个角色、场景、rng、词预算 */
function makeScope({ rng, heat = 3, scene = {}, cast = [], prose = {}, index = 0 } = {}) {
  const [A, B] = cast.length ? cast : [null, null];
  const h = Number(heat);
  const scope = {
    rng: rng instanceof Rng ? rng : new Rng(rng),
    ctx: {
      heat: Number.isFinite(h) ? h : 3,
      index,
      scene,
      cast,
      prose,
      loc: (scene && scene.location) || '房间',
      mood: Array.isArray(scene && scene.mood) ? scene.mood : [],
    },
    A,
    B,
    // 单人卡司：没有第二个角色时，跳过所有引用「对方」的池子条目
    noPartner: !B || (!!A && B === A),
    budget: {},
    used: {},
  };
  return scope;
}

const RESOLVERS = {
  // 场景/散文池里的主导方与对方：{A} {B}
  A(args, scope) {
    return scope.A ? scope.A.name : '她';
  },

  B(args, scope) {
    const c = scope.B || scope.A;
    return c ? c.name : '她';
  },

  /** 当前说话人（台词 beat 里可能与 A 不同） */
  V(args, scope) {
    const c = scope.V || scope.A;
    return c ? c.name : '她';
  },

  /** 代词：随角色卡 pronoun 字段自动适配（默认女她） */
  pronA(args, scope) {
    return pron(scope.A, '她');
  },

  pronB(args, scope) {
    return pron(scope.B || scope.A, '她');
  },

  /** 宾语形：她 → 她（中文同形，保留接口以便英文卡扩展） */
  pronA2(args, scope) {
    return pron(scope.A, '她');
  },

  pronB2(args, scope) {
    return pron(scope.B || scope.A, '她');
  },

  name(args, scope) {
    const which = (args[0] || 'A').toUpperCase();
    const c = which === 'B' ? scope.B : scope.A;
    return c ? c.name : '那个人';
  },

  // 场景文本里的 {who} = 主导方，{target} = 对方
  who(args, scope) {
    return scope.A ? scope.A.name : '她';
  },

  target(args, scope) {
    const c = scope.B || scope.A;
    return c ? c.name : '她';
  },

  age(args, scope) {
    const which = (args[0] || 'A').toUpperCase();
    const c = which === 'B' ? scope.B : scope.A;
    return c ? String(c.age) : '18';
  },

  loc(args, scope) {
    return scope.ctx.loc;
  },

  time() {
    return '';
  },

  prop(args, scope) {
    const c = scope[args[0] === 'B' ? 'B' : 'A'] || scope.A || {};
    const pools = [];
    if (c.imagery && c.imagery.props) pools.push(...c.imagery.props);
    if (scope.ctx.scene && scope.ctx.scene.props) pools.push(...scope.ctx.scene.props);
    if (!pools.length) return '手边的东西';
    return plainList(scope, pools, 'prop');
  },

  sensory(args, scope) {
    const pools = [];
    for (const c of [scope.A, scope.B]) {
      if (c && c.imagery && c.imagery.sensory) pools.push(...c.imagery.sensory);
    }
    if (!pools.length) return '淡淡的空气味';
    return plainList(scope, pools, 'sensory');
  },

  light(args, scope) {
    const pools = [];
    for (const c of [scope.A, scope.B]) {
      if (c && c.imagery && c.imagery.light) pools.push(...c.imagery.light);
    }
    if (scope.ctx.scene && scope.ctx.scene.light) pools.push(...scope.ctx.scene.light);
    if (!pools.length) return '一盏台灯';
    return plainList(scope, pools, 'light');
  },

  intensityWord(args, scope) {
    const heat = String(num(scope.ctx.heat, 3));
    const table = scope.ctx.prose.intensityWord || {};
    const list = table[heat] || table['3'] || [];
    if (!list.length) return '急而重';
    return fromPool(scope, list.map((t) => ({ text: t })), { uniqueKey: 'intensity' });
  },

  body(args, scope) {
    const n = args[0] ? num(args[0], 1) : 1;
    const pool = (scope.ctx.prose.bodyPart || []).map((x) => ({ ...x, text: x.text }));
    if (n <= 1) return fromPool(scope, pool, { budgetKey: 'body', uniqueKey: 'body' });
    return fromPoolN(scope, pool, n, '和', { budgetKey: 'body', uniqueKey: 'body' });
  },

  garment(args, scope) {
    const pool = scope.ctx.prose.garment || [];
    if (args[0] === 'char') {
      const c = scope.A || {};
      const tag = c.appearance && c.appearance.tags ? scope.rng.pick(c.appearance.tags) : '';
      return tag || fromPool(scope, pool, { budgetKey: 'garment', uniqueKey: 'garment' });
    }
    return fromPool(scope, pool, { budgetKey: 'garment', uniqueKey: 'garment' });
  },

  reaction(args, scope) {
    const p = scope.ctx.prose.reaction || {};
    const heat = num(scope.ctx.heat, 3);
    const merged = [];
    for (const [k, arr] of Object.entries(p)) {
      if (num(k, 1) <= heat) merged.push(...arr.map((t) => ({ min: num(k, 1), text: t })));
    }
    if (!merged.length) return '呼吸乱了一拍';
    return fromPool(scope, merged, { budgetKey: 'reaction', uniqueKey: 'reaction' });
  },

  fluid(args, scope) {
    return fromPool(scope, scope.ctx.prose.fluid || [], { budgetKey: 'fluid', uniqueKey: 'fluid' });
  },

  verb(args, scope) {
    const pool = scope.ctx.prose.verb || [];
    if (!Array.isArray(pool) || !pool.length) return '贴着';
    // 兼容两种形态：字符串数组 / 带 min 的对象数组
    return fromPool(scope, pool.map((x) => (typeof x === 'string' ? { text: x } : x)), { uniqueKey: 'verb' });
  },

  aftermath(args, scope) {
    return fromPool(scope, scope.ctx.prose.aftermath || [], { budgetKey: 'aftermath', uniqueKey: 'aftermath' });
  },

  intent(args, scope) {
    const p = scope.ctx.prose.intent || {};
    const heat = num(scope.ctx.heat, 3);
    const merged = [];
    for (const [k, arr] of Object.entries(p)) {
      if (num(k, 1) <= heat) merged.push(...arr.map((t) => ({ min: num(k, 1), text: t })));
    }
    if (!merged.length) return '她说不清自己在做什么';
    return fromPool(scope, merged, { budgetKey: 'intent', uniqueKey: 'intent' });
  },

  voice(args, scope) {
    const speaker = scope.V || scope.speaker || scope.A || {};
    const reg = (speaker.voice && speaker.voice.register) || (scope.A && scope.A.voice && scope.A.voice.register) || 'slow-tease';
    const leadReg = scope.A && scope.A.voice && scope.A.voice.register;
    // 说话人 ≠ 主导方时，用中性侧写，避免把 A 的声线安到 B 的台词上
    if (leadReg && reg !== leadReg) {
      const neutral = scope.ctx.prose.dialogueNeutral || [];
      if (neutral.length) return fromPool(scope, neutral, { unique: true });
    }
    const pool = (scope.ctx.prose.dialogueVoice || {})[reg] || [];
    if (!pool.length) return '';
    return fromPool(scope, pool, { budgetKey: 'voice', uniqueKey: 'voice:' + reg });
  },

  line(args, scope) {
    return scope.line || '';
  },

  mood(args, scope) {
    const moods = scope.ctx.mood || [];
    if (!moods.length) return '';
    const colorMap = scope.ctx.prose.moodColor || {};
    return scope.rng.pick(moods.filter((m) => colorMap[m])) || '';
  },

  moodColor(args, scope) {
    const moods = (scope.ctx.mood || []).filter((m) => (scope.ctx.prose.moodColor || {})[m]);
    if (!moods.length) return '';
    return (scope.ctx.prose.moodColor || {})[scope.rng.pick(moods)] || '';
  },

  kink(args, scope) {
    const fam = scope.ctx.scene && scope.ctx.scene.kinkFamily;
    const note = (scope.ctx.prose.kinkNote || {})[fam];
    if (note) return note;
    const c = scope.A || {};
    return (c.kinks || [])[0] || '';
  },
};

/** 深度解析：模板 → 文本，最多 MAX_DEPTH 轮，覆盖池子条目里嵌套的 token */
function resolve(tpl, scope, depth = 0) {
  if (tpl == null) return '';
  let s = String(tpl);
  for (let round = 0; round <= MAX_DEPTH; round++) {
    if (!TOKEN_OPEN.test(s)) break;
    const next = s.replace(/[{｛]\s*([^{}｛｝]+?)\s*[}｝]/g, (m, expr) => {
      const [rawName, argStr] = String(expr).split(':');
      const key = rawName.trim();
      // 支持命名空间写法：{heat:intensityWord} → 查 intensityWord
      const fn = RESOLVERS[key] || (argStr ? RESOLVERS[String(argStr).trim().split('|')[0]] : null);
      if (!fn) return m;
      const args = fn === RESOLVERS[key] && argStr ? argStr.split('|').map((x) => x.trim()) : [];
      const val = fn(args, scope);
      return val == null ? '' : String(val);
    });
    if (next === s) break;
    s = next;
  }
  return s;
}

module.exports = { resolve, makeScope, RESOLVERS, fromPool, fromPoolN, str };
