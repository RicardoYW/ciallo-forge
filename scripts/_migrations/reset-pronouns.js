'use strict';

/**
 * 把 data/scenes.json 里的 {pronA}/{pronB} 还原成显式「他/她」（按该场景卡司性别），
 * 得到一份干净的输入，供 migrate-pronouns-v3.js 重新按子句归属判定。
 * 幂等：没有 token 时不做任何事。
 *
 * 用法：node scripts/_migrations/reset-pronouns.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const charData = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'characters.json'), 'utf8'));
const byId = Object.fromEntries(charData.characters.map((c) => [c.id, c]));
const pronOf = (c) => (c && c.gender === 'male' ? '他' : '她');

const scenePath = path.join(ROOT, 'data', 'scenes.json');
const sceneData = JSON.parse(fs.readFileSync(scenePath, 'utf8'));
let n = 0;
for (const scene of sceneData.scenes) {
  const [idA, idB] = scene.castHint || [];
  const pa = pronOf(byId[idA]);
  const pb = pronOf(byId[idB] || byId[idA]);
  for (const act of scene.acts) {
    for (const beat of act.beats) {
      if (!beat.text || !beat.text.includes('{pron')) continue;
      const before = beat.text;
      beat.text = before.replace(/\{pronA\}/g, pa).replace(/\{pronB\}/g, pb);
      if (beat.text !== before) n++;
    }
  }
}
fs.writeFileSync(scenePath, JSON.stringify(sceneData, null, 2) + '\n', 'utf8');
console.log(`[OK] 还原 ${n} 个 beat 的代词 token → 显式「他/她」`);
