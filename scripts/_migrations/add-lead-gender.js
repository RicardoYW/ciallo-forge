'use strict';

/**
 * 场景元数据补齐（幂等）：给每个场景加 leadGender 字段。
 * leadGender 表示该场景里 A（主导方 = {who}）应该是男性还是女性；
 * 引擎在组装卡司时会按这个字段调整顺序（必要时把第一张卡换到 B 位）。
 *
 * 依据：场景第三幕的动作方向 —— 谁压着谁，谁就是 A。
 *   S03 林小满跨坐在长椅上 → A 是男性
 *   S07 阿沅被抵在书架上   → A 是男性
 *   S11 沈芷被按在消防栓箱上 → A 是男性
 * 其余场景女性主导成立，标注 female 保持原有观感。
 *
 * 用法：node scripts/_migrations/add-lead-gender.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

/** 场景 → 该场景 A 位性别 */
const LEAD = {
  S01: 'male',
  S02: 'female',
  S03: 'male',
  S04: 'male',
  S05: 'male',
  S06: 'male',
  S07: 'male',
  S08: 'male',
  S09: 'male',
  S10: 'male',
  S11: 'male',
  S12: 'male',
  S13: 'male',
  S14: 'male',
  S15: 'male',
  S16: 'male',
};

const file = path.join(ROOT, 'data', 'scenes.json');
const data = JSON.parse(fs.readFileSync(file, 'utf8'));

let added = 0;
let changed = 0;
for (const scene of data.scenes) {
  const want = LEAD[scene.id];
  if (!want) continue;
  if (!scene.leadGender) {
    scene.leadGender = want;
    added++;
  } else if (scene.leadGender !== want) {
    scene.leadGender = want;
    changed++;
  }
}

fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
console.log(`[OK] leadGender：新增 ${added} 个 / 修正 ${changed} 个`);
for (const s of data.scenes) {
  console.log(`  ${s.id} leadGender=${String(s.leadGender).padEnd(6)} castHint=${(s.castHint || []).join(',')}`);
}
