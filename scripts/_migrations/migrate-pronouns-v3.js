'use strict';

/**
 * 代词归属迁移（幂等，可反复跑）
 *
 * 场景模板里的第三人称代词必须写成 token，否则在性别混合卡司下会打架：
 *   {pronA} / {pronB} —— 按角色卡 gender 输出「她/他」
 *   {A} / {B}         —— 直接出名字（更安全，优先用这个）
 *
 * 判定策略（两层）：
 *   1) beat 级投票：把整段 beat.text 与 A/B 的特征词表比对，命中权重大的一方拥有多数代词
 *   2) 代词级修正：某个代词所在子句明显偏向另一方（差值 ≥ 6）时单独改判
 * 特征词表 = 角色卡姓名/别名/道具/气味/中文外观标签 + EXTRA 手工补充的场景专属词
 *
 * 用法：
 *   node scripts/_migrations/reset-pronouns.js              # 先还原成显式「他/她」
 *   node scripts/_migrations/migrate-pronouns-v3.js --check # 预演，不改文件
 *   node scripts/_migrations/migrate-pronouns-v3.js         # 落盘
 *
 * 注意：跑完不需要重复执行；`--check` 在已迁移的数据上会显示 0 处改动（幂等）。
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const CHECK_ONLY = process.argv.includes('--check');

const charData = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'characters.json'), 'utf8'));
const sceneData = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'scenes.json'), 'utf8'));
const byId = Object.fromEntries(charData.characters.map((c) => [c.id, c]));

const EXTRA = {
  C01: ['听诊器', '白大褂', '值夜班', '挂号', '剂量', '六年', '早七点', '针', '医生', '查房'],
  C02: ['合同', '百叶窗', '落地窗', '钢笔', '袖扣', '定价', '三十层', '会议', '报表', '催'],
  C03: ['跑道', '秒表', '五点', '最后一圈', '加练', '运动员', '一百五十', '训练', '起跑', '冰', '系鞋带'],
  C04: ['画室', '画布', '松节油', '颜料', '钛白', '赭石', '十七张', '画笔', '洗笔筒', '同一个人'],
  C05: ['镜子', '镜面', '教练', '倒数', '腹直肌', '助力带', '镁粉', '学员', '最后一组', '肩胛', '过关'],
  C06: ['投影', '粉笔', '讲台', '空教室', '评职称', '大衣', '数数', '三十九', '砖红', '讲课'],
  C07: ['图书馆', '闭馆', '薄荷', '围裙', '借书卡', '被炉', '橘子', '旧疤', '推椅子', '借书', '理好'],
  C08: ['护士服', '体温计', '草莓', '值班室', '交班', '输液', '白炽灯管', '扎针', '护士', '纽扣'],
  C09: ['修理厂', '机油', '扳手', '引擎', '头盔', '皮夹克', '卷帘门', '排气管', '九年', '离家', '烟', '修车', '外套', '按灭', '推车', '坐好'],
  C10: ['古籍', '宣纸', '糨糊', '镊子', '木簪', '木珠', '修复台', '北窗', '七个月', '万历', '修复', '旧书'],
};

/** 自动判定之后的显式修正：只放启发式确实无从判断的地方（同性别、双方特征均不出现） */
const OVERRIDES = [
  // S01 第一幕：苏晚心里想的是「他（=对方夏栖）乖不乖」，指 B
  { scene: 'S01', from: '{pronA}乖不乖', to: '{pronB}乖不乖' },
  // S14 第一幕：主语是罗砚（A）——他不会说「我担心你」，他只会把外套扔过来
  { scene: 'S14', from: '{pronB}不会说『我担心你』', to: '{pronA}不会说『我担心你』' },
  { scene: 'S14', from: '{pronB}只会把外套扔过来', to: '{pronA}只会把外套扔过来' },
  // S14 第二幕：下颌与短须属于罗砚（A）
  { scene: 'S14', from: '{pronB}的下颌', to: '{pronA}的下颌' },
  // S14 第三幕：外套披回对方（B）身上；淋雨推车的是 A
  { scene: 'S14', from: '{pronA}把外套披在{pronA}身上', to: '{pronA}把外套披回{B}身上' },
  { scene: 'S14', from: '这一次{pronA}没顶嘴', to: '这一次{B}没顶嘴' },
];

function featWords(c) {
  if (!c) return [];
  const bag = new Set(EXTRA[c.id] || []);
  bag.add(c.name);
  for (const a of c.alias || []) bag.add(a);
  for (const p of c.imagery?.props || []) if (p.length <= 8) bag.add(p);
  for (const s of c.imagery?.sensory || []) if (s.length <= 8) bag.add(s);
  for (const t of c.appearance?.tags || []) if (/^[\u4e00-\u9fff]+$/.test(t)) bag.add(t);
  return [...bag].filter((w) => w && w.length >= 2);
}

const FEATS = Object.fromEntries(charData.characters.map((c) => [c.id, featWords(c)]));
const PRON_OF = (c) => (c && c.gender === 'male' ? '他' : c && c.gender === 'female' ? '她' : null);

function score(text, feats) {
  let s = 0;
  for (const w of feats) if (text.includes(w)) s += w.length;
  return s;
}

function clauseOf(text, idx) {
  const left = /[，。！？；：、\n『』「」（）]/g;
  let start = 0;
  let m;
  while ((m = left.exec(text))) {
    if (m.index >= idx) break;
    start = m.index + m[0].length;
  }
  const right = /[，。！？；：、\n『』「」（）]/g;
  right.lastIndex = idx;
  const r = right.exec(text);
  return text.slice(start, r ? r.index : text.length);
}

const DIFF_THRESHOLD = 6;
let beatsTouched = 0;
let tokensTouched = 0;
const owners = { A: 0, B: 0 };
const report = [];

for (const scene of sceneData.scenes) {
  const [idA, idB] = scene.castHint || [];
  const A = byId[idA];
  const B = byId[idB];
  if (!A) continue;
  const fA = FEATS[A.id] || [];
  const fB = B ? FEATS[B.id] || [] : [];

  for (const act of scene.acts) {
    for (const beat of act.beats) {
      if (!beat.text || !/[他她]/.test(beat.text)) continue;
      const original = beat.text;

      const beatA = score(original, fA);
      const beatB = B ? score(original, fB) : -1;
      const defaultOwner = beatB > beatA ? 'B' : 'A';

      const idxs = [];
      for (let i = 0; i < original.length; i++) if (original[i] === '他' || original[i] === '她') idxs.push(i);

      let out = original;
      const picks = [];
      for (const idx of idxs.reverse()) {
        const clause = clauseOf(out, idx);
        const cA = score(clause, fA);
        const cB = B ? score(clause, fB) : -1;
        let owner = defaultOwner;
        if (cB - cA >= DIFF_THRESHOLD) owner = 'B';
        else if (cA - cB >= DIFF_THRESHOLD) owner = 'A';
        else if (cA === cB) {
          // 子句没有判别信息：男女搭配时按性别匹配最可靠；同性别沿用段级判定
          const pA = PRON_OF(A);
          const pB = PRON_OF(B);
          const orig = original[idx];
          if (pB && pB === orig && pA !== orig) owner = 'B';
          else if (pA && pA === orig && pB !== orig) owner = 'A';
        }
        out = out.slice(0, idx) + `{pron${owner}}` + out.slice(idx + 1);
        owners[owner]++;
        picks.push(owner);
      }

      if (out !== original) {
        beatsTouched++;
        tokensTouched += picks.length;
        report.push({ scene: scene.id, act: act.name, type: beat.type, beatA, beatB, picks: picks.reverse().join(''), text: out.slice(0, 64) });
        if (!CHECK_ONLY) beat.text = out;
      }
    }
  }
}

let fixCount = 0;
if (!CHECK_ONLY) {
  for (const ov of OVERRIDES) {
    const scene = sceneData.scenes.find((s) => s.id === ov.scene);
    if (!scene) continue;
    for (const act of scene.acts) {
      for (const beat of act.beats) {
        if (beat.text && beat.text.includes(ov.from)) {
          beat.text = beat.text.split(ov.from).join(ov.to);
          fixCount++;
        }
      }
    }
  }
  fs.writeFileSync(path.join(ROOT, 'data', 'scenes.json'), JSON.stringify(sceneData, null, 2) + '\n', 'utf8');
}

console.log(`${CHECK_ONLY ? '[CHECK]' : '[OK]'} beat：${beatsTouched} 个 / 代词：${tokensTouched} 处 | A=${owners.A} B=${owners.B}${CHECK_ONLY ? '' : ` | 显式修正 ${fixCount} 处`}`);
for (const r of report) {
  console.log(`  ${r.scene} [${r.type}] 段级 A${r.beatA}/B${r.beatB} 代词序列 ${r.picks} | ${r.text}…`);
}
