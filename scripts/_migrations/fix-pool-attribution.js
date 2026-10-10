'use strict';

/**
 * 质量修正（幂等）：把散文池里「把 A 的身体部位/服饰当成 B 的」这类错位写法收敛掉。
 *
 * 背景：`{body}`、`{garment}` 抽出来的默认属于 B（对方）；当模板写成
 * 「{A}……{body}」时就会出现「沈聿做出 沈芷的动作」这种归属混乱。
 * 修法：这些位置一律显式写成 {B} 的，或改成不指定归属的动作。
 *
 * 用法：node scripts/_migrations/fix-pool-attribution.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const file = path.join(ROOT, 'data', 'prose.json');
const data = JSON.parse(fs.readFileSync(file, 'utf8'));

/** 精确替换表：key = 原句（含 token），value = 修正后 */
const FIX = {
  '{A}用牙齿叼住{garment}的边，把它从{B}肩上带下来，落在地上没有声音。':
    '{A}用牙齿叼住{B}身上那件{garment}的边，把它带下来，落在地上没有声音。',
  '{A}去倒了杯水，回来的时候{B}已经把自己裹回了{garment}里，只露出眼睛。':
    '{A}去倒了杯水，回来的时候{B}已经把那件{garment}裹在身上，只露出眼睛。',
  '{fluid}，{B}伸手去抓{A}的{body}，指甲留下几道浅浅的红。':
    '{fluid}，{B}伸手去抓{A}的小臂，指甲留下几道浅浅的红。',
  '{A}把{garment}一点一点解开，动作慢得像在做很精密的活。':
    '{A}把{B}身上的{garment}一点一点解开，动作慢得像在做很精密的活。',
  '{A}把{garment}又推高了一寸，看着那块皮肤慢慢泛起颜色。':
    '{A}把{B}身上的{garment}又推高了一寸，看着那块皮肤慢慢泛起颜色。',
  '{A}低头咬住{garment}的一角，把它扯到一边；{B}没有阻止。':
    '{A}低头咬住{B}身上{garment}的一角，把它扯到一边；{B}没有阻止。',
  '{A}重新把手机开了静音，随手扣好{garment}，一切恢复成能出门的样子。':
    '{A}重新把手机开了静音，随手替{B}扣好{garment}，一切恢复成能出门的样子。',
};

/**
 * 白名单：这些句子里 {body}/{garment} 明确属于「被动作的一方」，语义正确。
 * 扫描器不该把它们报成问题，否则每跑一次都要人工看一遍。
 */
const ALLOW = new Set([
  '{A}先注意到了温度：对方的指尖比自己凉半度，落在{body}上像一小块冰。',
  '{A}的手停在{body}上，没有往前，也没有收回去。',
  '{A}不急着动，只是把重量压上去一点点，让{body}先感觉到存在。',
  '{A}故意在{body}上停住，等{B}自己动——等的那几秒比任何动作都长。',
  '{A}把{garment}捡起来搭在{B}肩上，动作比刚才轻得多。',
  '{A}重新把手机开了静音，随手替{B}扣好{garment}，一切恢复成能出门的样子。',
  '{A}去倒了杯水，回来的时候{B}已经把那件{garment}裹在身上，只露出眼睛。',
]);

/**
 * 真正的错位判定：一个动作直接落在「没有标明归属」的 {body}/{garment} 上。
 * 例如 {A}把{garment}解开 → 谁的 garment 不明；写了 {B}身上 就没有歧义。
 */
const BAD_PATTERN = /\{A\}[^。；]{0,10}(把|叼|咬|扯|解|推|含|按|压|盖)\{(body|garment)\}/;

let fixed = 0;
const misses = [];
for (const [key, arr] of Object.entries(data.pool)) {
  if (!Array.isArray(arr)) continue;
  data.pool[key] = arr.map((item) => {
    if (typeof item !== 'string') return item;
    if (FIX[item]) {
      fixed++;
      return FIX[item];
    }
    return item;
  });
}
for (const key of Object.keys(FIX)) {
  const present = Object.values(data.pool).some((arr) => Array.isArray(arr) && arr.includes(FIX[key]));
  if (!present) misses.push(key.slice(0, 28));
}

fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
console.log(`[OK] 散文池归属修正：${fixed} 条`);
if (misses.length) console.log(`[i]  未命中（可能已改或句子不同）：${misses.join(' | ')}`);

// 复核：用「动作直接落在未标归属的部位/服饰上」判定错位
const suspicious = [];
for (const [key, arr] of Object.entries(data.pool)) {
  if (!Array.isArray(arr)) continue;
  for (const item of arr) {
    if (typeof item !== 'string') continue;
    if (ALLOW.has(item)) continue;
    if (BAD_PATTERN.test(item)) suspicious.push(`pool.${key}: ${item.slice(0, 44)}`);
  }
}
console.log(suspicious.length ? `[!] 仍需人工确认 ${suspicious.length} 条：\n     ` + suspicious.join('\n     ') : '[OK] 无未标归属的错位句（白名单外）');
