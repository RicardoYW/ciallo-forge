'use strict';

/**
 * 场景性别适配（幂等）：
 *  1) S11 由「沈芷被按在消防栓箱」主导 → leadGender 改为 male，服饰改中性黑话术
 *  2) 去掉场景模板里与单一性别绑定的服饰词（高跟鞋 / 铅笔裙 → 鞋跟 / 裙料）
 *
 * 用法：node scripts/_migrations/fix-scene-gender.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const file = path.join(ROOT, 'data', 'scenes.json');
const data = JSON.parse(fs.readFileSync(file, 'utf8'));

const LEAD_OVERRIDE = {
  // S02：沈芷把对方的手腕绑到背后 / 主动解扣 —— 女性主导成立，保持 female
  // S11：原第三幕是「{who} 被按在消防栓箱上」，{who} 是 A —— 男女向下 A 应为男性
  S11: 'male',
};

/** 与单一性别绑定的词 → 中性说法 */
const WORD_FIX = [
  [/高跟鞋/g, '鞋跟'],
  [/铅笔裙/g, '裙料'],
];

let leadFixed = 0;
let textFixed = 0;
for (const scene of data.scenes) {
  const want = LEAD_OVERRIDE[scene.id];
  if (want && scene.leadGender !== want) {
    scene.leadGender = want;
    leadFixed++;
  }
  for (const act of scene.acts) {
    for (const beat of act.beats) {
      for (const field of ['text']) {
        if (!beat[field]) continue;
        for (const [re, rep] of WORD_FIX) {
          const before = beat[field];
          beat[field] = beat[field].replace(re, rep);
          if (beat[field] !== before) textFixed++;
        }
      }
      if (Array.isArray(beat.tags)) {
        beat.tags = beat.tags.map((t) => t.replace(/stiletto heels/g, 'heels').replace(/pencil skirt/g, 'skirt'));
      }
    }
  }
}

fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
console.log(`[OK] leadGender 修正 ${leadFixed} 个 / 服饰词中性化 ${textFixed} 处`);
for (const s of data.scenes) {
  console.log(`  ${s.id} leadGender=${String(s.leadGender).padEnd(6)} autoCast=${(s.autoCast || []).join(',')}`);
}
