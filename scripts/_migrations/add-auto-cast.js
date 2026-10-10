'use strict';

/**
 * 场景默认配对补齐（幂等）：给每个场景加 autoCast = [A, B]。
 * 未显式指定 --cast 时，引擎用 autoCast 组装卡司（A 为 {who} 主导方，B 为 {target}）。
 * 依据场景动作方向 + 职业/性格契合，见 docs「场景配对表」。
 *
 * 用法：node scripts/_migrations/add-auto-cast.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

/** 场景 → [主导方, 对方] */
const AUTO = {
  S01: ['C11', 'C08'], // 夜班查房之后 · 医师 × 护士
  S02: ['C02', 'C12'], // 落地窗前的契约 · 冷艳上司 × 商界合伙人
  S03: ['C14', 'C03'], // 终点线之后 · 直球学弟 × 元气学姐
  S04: ['C15', 'C04'], // 松节油与台灯 · 修复师 × 美院生
  S05: ['C13', 'C05'], // 镜子是给我看的 · 康复教练 × 健身教练
  S06: ['C12', 'C06'], // 学姐的规矩 · 合伙人 × 腹黑学姐
  S07: ['C16', 'C07'], // 闭馆之后 · 消防员 × 图书馆
  S08: ['C11', 'C08'], // 草莓糖的协议 · 医师 × 护士
  S09: ['C09', 'C07'], // 雨夜引擎 · 修车 × 人妻
  S10: ['C15', 'C10'], // 古籍修复室的午后 · 修复师 × 古籍
  S11: ['C12', 'C02'], // 走廊尽头的声控灯 · 合伙人 × 上司
  S12: ['C15', 'C04'], // 毕业画室的最后一夜 · 修复师 × 美院生
  S13: ['C11', 'C07'], // 冬夜的暖炉与毛毯 · 医师 × 人妻
  S14: ['C16', 'C08'], // 深夜便利店遇见 · 消防员 × 护士
  S15: ['C14', 'C03'], // 器材室的三十七度 · 体育生 × 学姐
  S16: ['C12', 'C02'], // 跨年夜的最后一支舞 · 合伙人 × 上司
};

const file = path.join(ROOT, 'data', 'scenes.json');
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const chars = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'characters.json'), 'utf8'));
const byId = Object.fromEntries(chars.characters.map((c) => [c.id, c]));

let added = 0;
let changed = 0;
for (const scene of data.scenes) {
  const want = AUTO[scene.id];
  if (!want) continue;
  for (const id of want) {
    if (!byId[id]) throw new Error(`${scene.id} 的 autoCast 成员 ${id} 不存在`);
  }
  if (byId[want[0]].gender === byId[want[1]].gender) {
    throw new Error(`${scene.id} 的 autoCast 不是男女组合：${want.join(',')}`);
  }
  const cur = (scene.autoCast || []).join(',');
  if (cur !== want.join(',')) {
    scene.autoCast = want;
    if (cur) changed++;
    else added++;
  }
}

fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
console.log(`[OK] autoCast：新增 ${added} 个 / 修正 ${changed} 个`);
for (const s of data.scenes) {
  const a = byId[s.autoCast[0]];
  const b = byId[s.autoCast[1]];
  console.log(`  ${s.id} ${a.name}(${a.gender === 'male' ? '♂' : '♀'}) × ${b.name}(${b.gender === 'male' ? '♂' : '♀'})  leadGender=${s.leadGender}`);
}
