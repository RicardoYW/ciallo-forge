'use strict';

/**
 * 声线寄存器：把任意台词种子改写成角色的说话方式。
 * 管线有序执行：truncate / stutter / particle / echo / breath / terminal
 */

const { Rng } = require('../util/rng');
const { squeeze } = require('../util/text');

const END_PUNCT = /[。！？!?…~～，,、；;：:]+$/u;
const TERMINALS = ['。', '！', '!', '?', '？', '…', '……', '——'];

function stripEnd(s) {
  return String(s || '').trim().replace(END_PUNCT, '');
}

function splitSentences(text) {
  const parts = String(text || '')
    .split(/(?<=[。！？!?…])/u)
    .map((x) => x.trim())
    .filter(Boolean);
  return parts.length ? parts : [String(text || '').trim()].filter(Boolean);
}

/** 把逗号处换成停顿符 */
function softPause(text, mark, rate, rng) {
  return String(text).replace(/[，,]/gu, (m) => (rng.chance(rate) ? mark : m));
}

/** 拉长元音/尾字，制造拖音 */
function elongation(text, rng) {
  return String(text).replace(/([啊呀呢吧嘛哦啦呀哈嗯呜诶欸])(?=[。！？…，,!?]|$)/gu, (m, ch) =>
    rng.chance(0.6) ? ch + ch : ch,
  );
}

/** 插入呼吸记号 */
function breathMarks(text, mark, rate, rng) {
  const parts = splitSentences(text);
  const out = [];
  for (const p of parts) {
    const core = stripEnd(p);
    const tail = p.slice(core.length) || '。';
    if (rng.chance(rate) && core.length > 4) {
      const cut = Math.max(2, Math.floor(core.length * (0.45 + rng.next() * 0.25)));
      out.push(`${core.slice(0, cut)}${mark}${core.slice(cut)}${tail}`);
    } else {
      out.push(p);
    }
  }
  return out.join('');
}

/** 结巴/重音：重复前一到两个字 */
function stutter(text, rng) {
  const parts = splitSentences(text);
  const out = [];
  for (const p of parts) {
    const core = stripEnd(p);
    if (core.length >= 3 && rng.chance(0.45)) {
      const n = rng.chance(0.5) ? 1 : 2;
      out.push(`${core.slice(0, n)}、${p}`);
    } else {
      out.push(p);
    }
  }
  return out.join('');
}

/** 句尾助词 */
function addParticle(text, particles, rng) {
  if (!particles || !particles.length) return text;
  const parts = splitSentences(text);
  return parts
    .map((p) => {
      const core = stripEnd(p);
      if (!core || core.length < 2) return p;
      if (rng.chance(0.45)) {
        const par = rng.pick(particles);
        const tail = p.slice(core.length) || '。';
        return `${core}${par}${tail === '。' ? '。' : tail}`;
      }
      return p;
    })
    .join('');
}

/** 口气词前插 */
function addEcho(text, ticks, rng) {
  if (!ticks || !ticks.length || !rng.chance(0.4)) return text;
  const t = rng.pick(ticks);
  if (/[，,。！？…]$/u.test(t)) return `${t}${stripEnd(text)}。`;
  return `${t}${text.startsWith('，') ? '' : '，'}${text}`;
}

/** 末端标点收束 */
function setTerminal(text, terminals, rng) {
  if (!terminals || !terminals.length) return text;
  const parts = splitSentences(text);
  return parts
    .map((p, i) => {
      const core = stripEnd(p);
      if (!core) return '';
      if (i === parts.length - 1) return core + rng.pick(terminals);
      const existing = p.slice(core.length);
      return core + (TERMINALS.includes(existing) ? existing : '，');
    })
    .join('');
}

/** 压短：只保留前 n 句与末句的关键部分 */
function truncateSentences(text, dropRate, rng, maxLen = 12) {
  const parts = splitSentences(text);
  if (parts.length <= 1) {
    const core = stripEnd(text);
    if (core.length > maxLen && rng.chance(0.6)) {
      const cut = core.slice(0, maxLen);
      return cut + '。';
    }
    return text;
  }
  const keep = parts.filter((p, i) => i === 0 || i === parts.length - 1 || !rng.chance(dropRate));
  return keep.join('');
}

/**
 * 主入口：寄存器改写
 * @param {string} line 台词种子
 * @param {object} voice 角色 voice 块
 * @param {Rng} rng
 */
function renderLine(line, voice, rng) {
  const { registerByName } = require('./datastore');
  const reg = (voice && registerByName(voice.register)) || null;
  const tickPool = (voice && voice.tic) || [];
  const particlePool = (voice && voice.particles) || (reg && reg.particles) || [];

  let text = stripEnd(line);
  if (!text) return '';

  const pipeline = (reg && reg.pipeline) || ['terminal'];
  const pauseMark = (reg && reg.pauseMark) || '…';
  const breathRate = reg ? (reg.breathRate ?? 0.3) : 0.2;
  const dropRate = reg ? (reg.dropRate ?? 0.15) : 0.15;

  for (const stage of pipeline) {
    switch (stage) {
      case 'truncate':
        text = truncateSentences(text, dropRate, rng);
        break;
      case 'stutter':
        text = stutter(text, rng);
        break;
      case 'particle':
        text = addParticle(text, particlePool, rng);
        break;
      case 'echo':
        text = addEcho(text, tickPool, rng);
        break;
      case 'breath':
        text = softPause(text, pauseMark, breathRate, rng);
        text = breathMarks(text, pauseMark, breathRate * 0.6, rng);
        break;
      case 'terminal':
        text = setTerminal(text, (reg && reg.terminal) || ['。'], rng);
        break;
      default:
        break;
    }
  }

  if (rng.chance(0.35)) text = elongation(text, rng);
  return squeeze(text);
}

/** 采样一条角色口中的台词（不经过场景种子时使用） */
function sampleByVoice(voice, rng) {
  const pool = (voice && voice.samples) || [];
  return pool.length ? rng.pick(pool) : '';
}

module.exports = { renderLine, sampleByVoice, splitSentences, stripEnd };
