'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const ds = require('../src/engine/datastore');
const { compilePrompt, compileBatch, TARGETS, RATING_TAGS } = require('../src/engine/prompt');
const { Story } = require('../src/engine/story');
const V = require('../src/engine/validate');
const { Rng } = require('../src/util/rng');
const { wordCount, joinTags } = require('../src/util/text');

// ── 年龄锁 ───────────────────────────────────────────────

test('卡池全员成年且带 ageLock', () => {
  const list = ds.characters();
  assert.ok(list.length >= 8, '角色卡数量应 >= 8');
  for (const c of list) {
    assert.equal(typeof c.age, 'number', `${c.id} age 必须是数字`);
    assert.ok(c.age >= 18, `${c.id} age=${c.age} 必须 >= 18`);
    assert.equal(c.ageLock, true, `${c.id} ageLock 必须为 true`);
  }
});

test('年龄锁门禁：17 岁卡被拒', () => {
  const fake = { id: 'X', name: 'T', age: 17, ageLock: true, appearance: { tags: ['a'] }, body: {}, personality: { core: 'x' }, voice: { register: 'slow-tease' } };
  const r = V.validateCharacter(fake);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /17/.test(e)));
});

test('年龄锁门禁：age 缺失被拒', () => {
  const fake = { id: 'X', name: 'T', ageLock: true, appearance: { tags: ['a'] }, body: {}, personality: { core: 'x' }, voice: { register: 'slow-tease' } };
  assert.equal(V.validateCharacter(fake).ok, false);
});

test('绘图引擎拒绝未成年卡（抛错）', () => {
  const minor = { id: 'X', name: 'T', age: 16, ageLock: true, appearance: { tags: [], quality: [], negative: [], loraAnchors: [] }, body: {} };
  assert.throws(() => compilePrompt({ character: minor, target: 'sdxl' }), /age-gate|18/);
});

test('文本扫描：幼态词 + 无成年锚点 → reject', () => {
  const r = V.scanText('loli, 小学生, flat chest child');
  assert.equal(r.ok, false);
  assert.equal(r.level, 'reject');
});

test('文本扫描：幼态造型词 + 成年锚点 → 放行但标记 review', () => {
  const r = V.scanText('18 years old, petite, small frame, 幼态妆', { hasAgeLock: true });
  assert.equal(r.ok, true);
  assert.equal(r.level, 'review');
});

test('全部角色卡通过校验', () => {
  const report = V.validateAll();
  assert.equal(report.ok, true, `未通过项：${JSON.stringify(report.failed)}`);
  assert.equal(report.summary.minAge >= 18, true);
});

// ── 提示词编译 ───────────────────────────────────────────

test('SDXL 提示词结构完整', () => {
  const c = ds.characterById('C01');
  const p = compilePrompt({ character: c, heat: 4, rating: 'explicit', target: 'sdxl', seed: 1 });
  assert.match(p.positive, /nsfw/);
  assert.match(p.positive, /26 years old/);
  assert.match(p.positive, /mature female/);
  assert.ok(p.positive.split(', ').length >= 25);
  assert.match(p.negative, /child/);
  assert.match(p.negative, /loli/);
  assert.ok(p.params.steps > 0 && p.params.cfg > 0);
  assert.equal(V.validatePrompt(p).ok, true);
});

test('四个目标格式都能编译', () => {
  const c = ds.characterById('C02');
  const sc = ds.sceneById('S02');
  for (const t of Object.keys(TARGETS)) {
    const p = compilePrompt({ character: c, scene: sc, cast: [c], heat: 5, rating: 'explicit', target: t, seed: 2 });
    assert.ok(p.positive.length > 50, `${t} 正向太短`);
    if (t === 'midjourney') assert.match(p.mjCommand, /--ar \d+:\d+/);
    if (t === 'novelai') assert.ok(p.nai.prompt && p.nai.characterPrompts.length >= 1);
    if (t === 'comfyui') assert.ok(p.workflow['3'].class_type === 'KSampler');
    if (t === 'pony') assert.match(p.positive, /^score_9/);
  }
});

test('safe 评级会清掉显式词', () => {
  const c = ds.characterById('C01');
  const p = compilePrompt({ character: c, heat: 1, rating: 'safe', target: 'sdxl', seed: 3 });
  assert.doesNotMatch(p.positive, /penetration|nude|nipples/);
  assert.match(p.negative, /nsfw/);
});

test('批量编译：角色 × 场景 × 目标 = 笛卡尔积', () => {
  const c = ds.characterById('C03');
  const items = compileBatch({ character: c, scenes: ds.scenes().slice(0, 3), targets: ['sdxl', 'novelai'], heat: 4 });
  assert.equal(items.length, 6);
  assert.equal(new Set(items.map((i) => i.id)).size, 6);
});

test('提示词可复现：同 seed 同输出', () => {
  const c = ds.characterById('C04');
  const a = compilePrompt({ character: c, heat: 4, rating: 'explicit', target: 'sdxl', seed: 99 });
  const b = compilePrompt({ character: c, heat: 4, rating: 'explicit', target: 'sdxl', seed: 99 });
  assert.equal(a.positive, b.positive);
});

// ── 故事引擎 ─────────────────────────────────────────────

test('故事生成达标字数且无残留 token', () => {
  const s = new Story({ scene: 'S01', cast: ['C01', 'C08'], heat: 4, words: 800, seed: 5, pacing: 'balanced' });
  const md = s.markdown();
  const body = md.slice(md.indexOf('## 第一幕'), md.indexOf('## 附录'));
  assert.equal(/[{｛][^{}｛｝]{2,}[}｝]/.test(body), false, '正文里有未解析 token');
  assert.equal(/\{(A|B|who|target|body|prop|line|voice)\}/.test(body), false, '正文里有变量名残留');
  const meta = s.json();
  assert.ok(meta.words >= 400, `字数 ${meta.words} 偏低`);
  assert.equal(meta.cast.length, 2);
});

test('同 seed 完全复现，不同 seed 文本不同', () => {
  const mk = (seed) => new Story({ scene: 'S05', cast: ['C05'], heat: 5, words: 500, seed, pacing: 'balanced' }).markdown();
  assert.equal(mk(11), mk(11));
  assert.notEqual(mk(11), mk(12));
});

test('全部 16 场景都能出稿且带角色名', () => {
  for (const sc of ds.scenes()) {
    const s = new Story({ scene: sc.id, heat: sc.heatBase, words: 400, pacing: 'fast', seed: 3 });
    const md = s.markdown();
    const meta = s.json();
    assert.ok(md.includes('## 附录 · 出场角色卡'), `${sc.id} 缺附录`);
    assert.ok(meta.cast.length >= 1, `${sc.id} 无卡司`);
    assert.ok(meta.cast.every((c) => c.age >= 18), `${sc.id} 卡司年龄异常`);
  }
});

test('热度分级影响用词：heat 2 不出现器官名词', () => {
  for (const seed of [8, 9, 10, 11, 12]) {
    const low = new Story({ scene: 'S16', cast: ['C02'], heat: 2, words: 700, seed, pacing: 'balanced' }).markdown();
    const body = low.slice(low.indexOf('## 第一幕'), low.indexOf('## 附录'));
    for (const w of ['穴口', '乳尖', '甬道', '抽送', '分身', '臀肉']) {
      assert.equal(body.includes(w), false, `heat 2 (seed ${seed}) 正文出现了 ${w}`);
    }
  }
});

test('热度分级影响用词：heat 5 会用到露骨词库（未加载内容包时跳过）', (t) => {
  const prose = ds.prose();
  const explicitAvailable = (prose.fluid || []).length > 0
    && (prose.bodyPart || []).some((x) => (x.min || 1) >= 4);
  if (!explicitAvailable) {
    t.skip('当前是基础版数据（无 heat 4-5 档词库），加载内容包后再跑');
    return;
  }
  const hits = new Set();
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const md = new Story({ scene: 'S02', cast: ['C02'], heat: 5, words: 900, seed, pacing: 'balanced' }).markdown();
    const body = md.slice(md.indexOf('## 第一幕'), md.indexOf('## 附录'));
    for (const w of ['穴口', '乳尖', '甬道', '抽送', '臀肉', '腿根']) if (body.includes(w)) hits.add(w);
  }
  assert.ok(hits.size >= 2, `heat 5 的露骨词覆盖不足：${[...hits].join('、')}`);
});

test('pacing=pwp 比 slow 短', () => {
  const pwp = new Story({ scene: 'S02', cast: ['C02'], heat: 5, words: 600, seed: 9, pacing: 'pwp' }).json();
  const slow = new Story({ scene: 'S02', cast: ['C02'], heat: 5, words: 600, seed: 9, pacing: 'slow' }).json();
  assert.ok(pwp.words < slow.words, `pwp=${pwp.words} slow=${slow.words}`);
});

test('正文无重复段落、无过短残句', () => {
  for (const sc of ['S01', 'S05', 'S09', 'S14', 'S16']) {
    for (const seed of [3, 7, 11]) {
      const meta = new Story({ scene: sc, cast: [], heat: 4, words: 900, seed, pacing: 'balanced' }).json();
      assert.equal(meta.duplicateParagraphs, 0, `${sc} seed${seed} 有 ${meta.duplicateParagraphs} 段重复`);
      assert.equal(meta.shortParagraphs, 0, `${sc} seed${seed} 有 ${meta.shortParagraphs} 段短残句`);
    }
  }
});

test('场景模板层：beat.text 与散文池不含裸的性别代词', () => {
  const poolStrings = [];
  for (const arr of Object.values(ds.prose().pool)) for (const x of arr) poolStrings.push(String(x));
  for (const s of ds.scenes()) {
    for (const a of s.acts) {
      for (const b of a.beats) {
        if (b.text) assert.doesNotMatch(b.text, /[他她]/, `场景 ${s.id} 「${a.name}」的 beat.text 含裸代词`);
      }
    }
  }
  for (const line of poolStrings) {
    assert.doesNotMatch(line, /[他她]/, `散文池含裸代词：${line.slice(0, 40)}`);
  }
});

test('性别混合卡司：引擎抽样的段不泄漏裸代词', () => {
  const poolStrings = new Set();
  for (const arr of Object.values(ds.prose().pool)) for (const x of arr) poolStrings.add(String(x));

  for (const [sc, cast] of [['S09', ['C09', 'C08']], ['S14', ['C09', 'C08']], ['S01', ['C01', 'C08']], ['S02', ['C02', 'C09']]]) {
    for (const seed of [5, 6, 7, 8]) {
      const built = new Story({ scene: sc, cast, heat: 4, words: 900, seed, pacing: 'balanced' });
      const json = built.json();
      for (const sec of json.sections) {
        for (const para of sec.paras) {
          if (!/[他她]/.test(para)) continue;
          // 判定这条段落是否由引擎从池子抽样而来（池子句子是模板，解析后仍能对应上）
          const fromPool = [...poolStrings].some((tpl) => {
            const parts = tpl.split(/\{[^}]*\}/).filter((x) => x.length >= 6);
            return parts.length > 0 && parts.every((x) => para.includes(x));
          });
          assert.equal(fromPool, false, `${sc} seed${seed} 抽样段泄漏裸代词：${para.slice(0, 50)}`);
        }
      }
    }
  }
});

test('质量指标：无重复段 / 无短残句 / 无空插槽', () => {
  for (const sc of ['S01', 'S05', 'S09', 'S12', 'S14', 'S16']) {
    for (const seed of [3, 7, 11]) {
      const built = new Story({ scene: sc, cast: [], heat: 4, words: 900, seed, pacing: 'balanced' });
      const meta = built.json();
      assert.equal(meta.duplicateParagraphs, 0, `${sc} seed${seed} 有 ${meta.duplicateParagraphs} 段重复`);
      assert.equal(meta.shortParagraphs, 0, `${sc} seed${seed} 有 ${meta.shortParagraphs} 段短残句`);
      // 空插槽：token 被清空后留下的断裂（只查结构性特征，避免误伤正常中文）
      for (const sec of meta.sections) {
        for (const para of sec.paras) {
          assert.doesNotMatch(para, /^[，、。；：]/, `${sc} seed${seed} 段首标点：${para.slice(0, 30)}`);
          for (const bad of ['变成，', '变成。', '从 到', '，，', '，。', '，、', '  ']) {
            assert.equal(para.includes(bad), false, `${sc} seed${seed} 出现空插槽「${bad}」：${para.slice(0, 40)}`);
          }
        }
      }
    }
  }
});

test('卡司可用名字/别名/癖好解析', () => {
  assert.equal(ds.resolveCharacters(['晚晚']).hit[0].id, 'C01');
  assert.equal(ds.resolveCharacters(['C09']).hit[0].name, '罗砚');
  assert.equal(ds.resolveCharacters(['不存在的角色']).misses.length, 1);
});

// ── 工具 ─────────────────────────────────────────────────

test('RNG 同 seed 同序列，int 在界内', () => {
  const a = new Rng('x') ; const b = new Rng('x');
  for (let i = 0; i < 50; i++) {
    const v = a.int(1, 6);
    assert.equal(v, b.int(1, 6));
    assert.ok(v >= 1 && v <= 6);
  }
});

test('wordCount：中文按字，英文按词', () => {
  assert.equal(wordCount('你好世界'), 4);
  assert.equal(wordCount('hello world'), 2);
  assert.equal(wordCount('你好 hello'), 3);
});

test('joinTags 去重且去空', () => {
  assert.equal(joinTags(['a', 'b', 'a', '', null, ' c ']), 'a, b, c');
});

test('声线寄存器覆盖所有角色的 register', () => {
  for (const c of ds.characters()) {
    assert.ok(ds.registerByName(c.voice.register), `${c.id} 的 register 未注册：${c.voice.register}`);
  }
});

// ── 男女向配对 ───────────────────────────────────────────

test('卡池男女双全且全员成年', () => {
  const list = ds.characters();
  const male = list.filter((c) => c.gender === 'male');
  const female = list.filter((c) => c.gender === 'female');
  assert.ok(male.length >= 6, `男性角色应 >= 6，实际 ${male.length}`);
  assert.ok(female.length >= 8, `女性角色应 >= 8，实际 ${female.length}`);
  for (const c of list) {
    assert.ok(['male', 'female'].includes(c.gender), `${c.id} gender 非法：${c.gender}`);
    assert.ok(c.age >= 18 && c.ageLock === true, `${c.id} 年龄锁异常`);
  }
});

test('每个场景都有男女 autoCast，且 A 位符合 leadGender', () => {
  for (const s of ds.scenes()) {
    assert.ok(Array.isArray(s.autoCast) && s.autoCast.length === 2, `${s.id} 缺 autoCast`);
    const [a, b] = s.autoCast.map((id) => ds.characterById(id));
    assert.ok(a && b, `${s.id} autoCast 成员不存在`);
    assert.notEqual(a.id, b.id, `${s.id} autoCast 重复`);
    assert.notEqual(a.gender, b.gender, `${s.id} autoCast 不是男女组合：${a.name}/${b.name}`);
    assert.equal(a.gender, s.leadGender, `${s.id} 主导方性别与 leadGender 不符`);
  }
});

test('不带 --cast 时自动出男女向正文', () => {
  for (const s of ds.scenes()) {
    const meta = new Story({ scene: s.id, heat: s.heatBase, words: 400, pacing: 'fast', seed: 5 }).json();
    assert.equal(meta.pairing, 'mixed', `${s.id} 自动配对不是男女向：${meta.cast.map((c) => c.name + c.gender).join('/')}`);
    assert.equal(meta.cast[0].gender, s.leadGender, `${s.id} 主导方不是 ${s.leadGender}`);
  }
});

test('显式 --cast 顺序即 A/B 顺序，不被覆盖', () => {
  const meta = new Story({ scene: 'S09', cast: ['C07', 'C09'], heat: 4, words: 400, seed: 6 }).json();
  assert.equal(meta.cast[0].id, 'C07', '显式指定的第一个角色必须留在 A 位');
  assert.equal(meta.cast[1].id, 'C09');
  assert.equal(meta.pairing, 'mixed');
});

test('--lead 覆盖场景默认主导性别', () => {
  const female = new Story({ scene: 'S09', lead: 'female', heat: 4, words: 400, seed: 7 }).json();
  assert.equal(female.cast[0].gender, 'female', '--lead female 未生效');
  const male = new Story({ scene: 'S02', lead: 'male', heat: 4, words: 400, seed: 8 }).json();
  assert.equal(male.cast[0].gender, 'male', '--lead male 未生效');
});

test('绘图提示词带正确性别与配对标记', () => {
  const male = ds.characterById('C12');
  const female = ds.characterById('C06');
  const female2 = ds.characterById('C02');
  const mixed = compilePrompt({ character: male, cast: [male, female], heat: 5, rating: 'explicit', target: 'sdxl', seed: 1 });
  assert.match(mixed.positive, /1boy/);
  assert.match(mixed.positive, /1girl/);
  assert.match(mixed.positive, /hetero/);
  assert.match(mixed.positive, /handsome male/);
  const soloMale = compilePrompt({ character: male, heat: 3, rating: 'nsfw', target: 'sdxl', seed: 2 });
  assert.match(soloMale.positive, /solo male/);
  const femalePair = compilePrompt({ character: female, cast: [female, female2], heat: 4, rating: 'explicit', target: 'sdxl', seed: 3 });
  assert.match(femalePair.positive, /2girls/);
  assert.match(femalePair.positive, /yuri/);
});

test('台词侧写不把主导方声线安到对方嘴里', () => {
  // 沈聿（low-tease）× 沈芷（clipped-command）：第二句是沈芷说的，不能出现沈聿的声线描述
  const md = new Story({ scene: 'S11', cast: ['C12', 'C02'], heat: 5, words: 900, seed: 4, pacing: 'balanced' }).markdown();
  const body = md.slice(md.indexOf('## 第一幕'), md.indexOf('## 附录'));
  const shenZhiLines = body.split('\n').filter((l) => l.startsWith('沈芷：'));
  assert.ok(shenZhiLines.length > 0, '应至少有一句沈芷的台词');
  for (const line of shenZhiLines) {
    assert.doesNotMatch(line, /把问题原样抛回去|用停顿逼/, `沈芷的台词带了沈聿的声线描述：${line}`);
  }
});
