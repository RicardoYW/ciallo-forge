'use strict';
// 临时冒烟测试：引擎自检（正式测试在 test/ 下）
const ds = require('../src/engine/datastore');
const { compilePrompt } = require('../src/engine/prompt');
const { Story } = require('../src/engine/story');

const c1 = ds.characterById('C01');
const c8 = ds.characterById('C08');
const sc = ds.sceneById('S01');

const p = compilePrompt({ character: c1, scene: sc, cast: [c1, c8], heat: 4, rating: 'explicit', target: 'sdxl', seed: 7 });
console.log('=== PROMPT tokens:', JSON.stringify(p.tokenCount), '===');
console.log(p.positive.slice(0, 200) + ' ...');

const s = new Story({ scene: 'S01', cast: ['C01', 'C08'], heat: 4, words: 600, seed: 7, pacing: 'balanced' });
const md = s.markdown();
console.log('=== STORY ===');
console.log(md.slice(md.indexOf('## 第一幕'), md.indexOf('## 附录')));
const meta = s.json();
console.log('=== meta ===', JSON.stringify({ heat: meta.heat, words: meta.words, cast: meta.cast.map((c) => c.name + '/' + c.age) }));
const leftover = md.slice(md.indexOf('## 第一幕'), md.indexOf('## 附录')).match(/[{｛][^{}｛｝]*[}｝]/g);
console.log('=== 正文残留 token:', leftover ? leftover : 'none', '===');

const a = new Story({ scene: 'S02', cast: ['C02'], heat: 5, words: 400, seed: 42 }).markdown();
const b = new Story({ scene: 'S02', cast: ['C02'], heat: 5, words: 400, seed: 42 }).markdown();
console.log('=== 复现性:', a === b ? 'OK' : 'FAIL', '=== 长度', a.length);
