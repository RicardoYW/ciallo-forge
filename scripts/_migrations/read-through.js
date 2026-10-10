'use strict';

/**
 * 代词巡检（只读）：把若干篇出稿打出来，人工核对代词一致性。
 * 用法：node scripts/_migrations/read-through.js
 */

const { Story } = require('../../src/engine/story');

const cases = [
  ['S14', 'C09,C08', 4],
  ['S09', 'C09,C08', 4],
  ['S01', 'C01,C08', 4],
  ['S02', 'C02,C09', 4],
];

for (const [sc, castRef, heat] of cases) {
  const md = new Story({ scene: sc, cast: castRef.split(','), heat, words: 900, pacing: 'balanced', seed: 5 }).markdown();
  const body = md.slice(md.indexOf('## 第一幕'), md.indexOf('## 附录 · 出场角色卡'));
  const bare = (body.match(/[他她]/g) || []).length;
  console.log('='.repeat(72));
  console.log(`# ${sc} ${castRef} | 裸性别代词出现次数：${bare}（作者手写模板里的代词属正常）`);
  console.log(body.trim());
  console.log('');
}
