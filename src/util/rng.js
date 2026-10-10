'use strict';

/**
 * 确定性随机数：同 seed 同输出。
 * 用 splitmix32，够快、分布够好、无依赖。
 */

function hashSeed(seed) {
  const s = String(seed);
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

class Rng {
  constructor(seed = Date.now()) {
    this.seed = seed;
    this.state = hashSeed(seed) || 1;
  }

  /** 下一个 uint32 */
  nextU32() {
    let z = (this.state += 0x9e3779b9) >>> 0;
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0;
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0;
    return (z ^ (z >>> 15)) >>> 0;
  }

  /** [0,1) */
  next() {
    return this.nextU32() / 4294967296;
  }

  /** [min,max] 整数 */
  int(min, max) {
    if (max < min) [min, max] = [max, min];
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** [min,max) 浮点 */
  float(min, max) {
    return min + this.next() * (max - min);
  }

  /** 数组取一 */
  pick(arr) {
    if (!Array.isArray(arr) || arr.length === 0) return undefined;
    return arr[Math.floor(this.next() * arr.length)];
  }

  /** 按 weight 字段加权取一；元素可为 {weight:n,...} 或裸值（裸值权重 1） */
  weighted(arr, weightOf = (x) => (x && typeof x === 'object' ? x.weight ?? 1 : 1)) {
    if (!Array.isArray(arr) || arr.length === 0) return undefined;
    const total = arr.reduce((s, x) => s + Math.max(0, weightOf(x)), 0);
    if (total <= 0) return this.pick(arr);
    let r = this.next() * total;
    for (const x of arr) {
      r -= Math.max(0, weightOf(x));
      if (r <= 0) return x;
    }
    return arr[arr.length - 1];
  }

  /** Fisher-Yates 洗牌（返回新数组） */
  shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /** 不重复取 n 个 */
  sample(arr, n) {
    return this.shuffle(arr).slice(0, Math.max(0, Math.min(n, arr.length)));
  }

  /** 概率为 p 返回 true */
  chance(p) {
    return this.next() < p;
  }

  /** 派生一个独立子流，保证局部改动不污染全局序列 */
  derive(tag) {
    return new Rng(`${this.seed}::${tag}`);
  }
}

module.exports = { Rng, hashSeed };
