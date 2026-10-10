#!/usr/bin/env node
'use strict';

/**
 * ciallo-forge CLI
 * 用法：node bin/ciallo.js <command> [options]
 */

const path = require('path');
const fs = require('fs');
const io = require('../src/util/io');
const ds = require('../src/engine/datastore');
const promptEngine = require('../src/engine/prompt');
const { Story } = require('../src/engine/story');
const V = require('../src/engine/validate');

const C = {
  reset: '\u001b[0m', dim: '\u001b[2m', bold: '\u001b[1m',
  red: '\u001b[31m', green: '\u001b[32m', yellow: '\u001b[33m', cyan: '\u001b[36m', magenta: '\u001b[35m',
};
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (k, s) => (useColor ? C[k] + s + C.reset : s);

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next == null || next.startsWith('--')) out[key] = true;
      else {
        out[key] = next;
        i++;
      }
    } else if (a.startsWith('-') && a.length === 2) {
      out[a.slice(1)] = true;
    } else {
      out._.push(a);
    }
  }
  return out;
}

function slug(s) {
  return String(s || 'out')
    .replace(/[^\w\u4e00-\u9fff-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'out';
}

function bar() {
  return c('dim', '─'.repeat(64));
}

function header(title, sub) {
  console.log('');
  console.log(c('magenta', ' 夜织 CialloForge ') + c('dim', '· ' + title));
  if (sub) console.log(c('dim', ' ' + sub));
  console.log(bar());
}

// ─────────────────────────── 命令 ───────────────────────────

function cmdChars(args) {
  const all = ds.characters();
  // --female 优先于 --male（两个都给时以更具体的筛选为准）
  const wantFemale = args.gender === 'female' || args.female;
  const wantMale = !wantFemale && (args.gender === 'male' || args.male);
  const filter = wantFemale ? 'female' : wantMale ? 'male' : null;
  const list = filter ? all.filter((c) => (c.gender || 'female') === filter) : all;
  const men = all.filter((c) => c.gender === 'male').length;
  const women = all.filter((c) => c.gender === 'female').length;
  header('卡池', `${all.length} 张角色卡（♂${men} / ♀${women}）· 全员成年锁（最小 ${Math.min(...all.map((x) => x.age))} 岁）${filter ? ` · 仅显示${filter === 'male' ? '男' : '女'}性` : ''}`);
  for (const ch of list) {
    const v = V.validateCharacter(ch);
    const mark = v.ok ? c('green', '✔') : c('red', '✘');
    const g = ch.gender === 'male' ? c('cyan', '♂') : c('magenta', '♀');
    console.log(
      `${mark} ${g} ${c('bold', ch.id)} ${c('cyan', ch.name.padEnd(4, '　'))} ${String(ch.age).padStart(2)}岁 ${c('dim', ch.role)} ` +
      c('dim', `· ${ch.voice.register} · ${(ch.kinks || []).slice(0, 3).join('/')}`),
    );
    if (args.verbose) {
      console.log(c('dim', `    定位：${ch.personality.core}`));
      console.log(c('dim', `    外观：${ch.appearance.tags.slice(0, 10).join(', ')}...`));
      console.log(c('dim', `    台词：${ch.voice.samples[0]}`));
    }
  }
  console.log(bar());
  console.log(c('dim', '  加 --verbose 看每张卡的定位/外观/台词 · 加 --male / --female 只看一边'));
  return 0;
}

function cmdScenes(args) {
  const list = ds.scenes();
  header('场景库', `${list.length} 个场景 · ${list.reduce((n, s) => n + s.acts.reduce((m, a) => m + a.beats.length, 0), 0)} 个 beat`);
  for (const s of list) {
    const beats = s.acts.reduce((n, a) => n + a.beats.length, 0);
    console.log(
      `${c('bold', s.id)} ${c('cyan', s.title.padEnd(12, '　'))} ${c('yellow', 'heat ' + s.heatBase)} ` +
      c('dim', `· ${s.kinkFamily} · ${beats} beats · ${s.location}`),
    );
    if (args.verbose) {
      console.log(c('dim', `    幕：${s.acts.map((a) => a.name).join(' / ')}`));
      console.log(c('dim', `    氛围：${(s.mood || []).join('、')}`));
      console.log(c('dim', `    卡司提示：${(s.castHint || []).join(', ')}`));
    }
  }
  console.log(bar());
  return 0;
}

function cmdPrompt(args) {
  const allTargets = Object.keys(promptEngine.TARGETS);
  const targets = args.target === 'all' || args.batch === 'all'
    ? allTargets
    : [args.target || 'sdxl'];
  const heat = Number(args.heat || 4);
  const rating = args.rating || (heat >= 4 ? 'explicit' : heat >= 3 ? 'nsfw' : 'suggestive');
  const seed = args.seed != null && args.seed !== true ? Number(args.seed) : 20250101;

  let chars;
  const charSpec = args.char || args.c || 'C01';
  if (charSpec === 'all') chars = ds.characters();
  else {
    const { hit } = ds.resolveCharacters(String(charSpec).split(','));
    if (!hit.length) {
      console.error(c('red', `找不到角色：${charSpec}`));
      return 2;
    }
    chars = hit;
  }

  header('绘图提示词编译', `${chars.length} 角色 × ${targets.length} 目标 × heat ${heat} · 评级 ${rating}`);
  const results = [];
  for (const ch of chars) {
    const scene = args.scene ? ds.sceneById(args.scene) : null;
    for (const target of targets) {
      const p = promptEngine.compilePrompt({
        character: ch, scene, cast: [ch], heat, rating, target, seed,
        extras: args.extra ? String(args.extra).split(';').map((s) => s.trim()) : [],
      });
      const v = V.validatePrompt(p);
      results.push({ p, v });
      console.log('');
      console.log(`${v.ok ? c('green', '✔') : c('red', '✘')} ${c('bold', ch.id + ' ' + ch.name)} → ${c('cyan', target)} ${c('dim', p.label)} ${c('dim', `[${p.tokenCount.positive} tok]`)}`);
      console.log(c('dim', '  正向：') + p.positive.slice(0, 220) + (p.positive.length > 220 ? c('dim', ' …') : ''));
      console.log(c('dim', '  负向：') + p.negative.slice(0, 160) + c('dim', ' …'));
      if (p.mjCommand) console.log(c('dim', '  MJ  ：') + p.mjCommand.slice(0, 200));
      if (p.nai) console.log(c('dim', '  NAI ：') + c('dim', `sampler=${p.nai.sampler} scale=${p.nai.scale} ucPreset=${p.nai.ucPreset}`));
      if (p.workflow) console.log(c('dim', '  CF  ：') + c('dim', '已生成 workflow JSON（--out 导出）'));
      if (v.errors.length) console.log(c('red', '  校验：' + v.errors.join('；')));
    }
  }

  if (args.out) {
    const outPath = path.resolve(io.ROOT, args.out);
    const payload = {
      generatedAt: new Date().toISOString(),
      heat, rating, targets,
      items: results.map(({ p, v }) => ({ ...p, validation: v })),
    };
    io.writeJSON(outPath, payload);
    const md = renderPromptMarkdown(payload);
    io.writeText(outPath.replace(/\.json$/i, '.md'), md);
    console.log('');
    console.log(c('green', ' 已导出 ') + c('cyan', outPath) + c('dim', ' + .md'));
  }
  console.log(bar());
  return results.every((r) => r.v.ok) ? 0 : 1;
}

function renderPromptMarkdown(payload) {
  const L = ['# 夜织 · 绘图提示词包', '', `> 生成时间 ${payload.generatedAt} · heat ${payload.heat} · 评级 ${payload.rating}`, ''];
  for (const it of payload.items) {
    L.push(`## ${it.character}${it.scene ? ' × ' + it.scene : ''} → ${it.target}`);
    L.push('');
    L.push('**正向**');
    L.push('```');
    L.push(it.positive);
    L.push('```');
    L.push('**负向**');
    L.push('```');
    L.push(it.negative);
    L.push('```');
    L.push(`**参数**：\`${JSON.stringify(it.params)}\``);
    if (it.mjCommand) {
      L.push('');
      L.push('**Midjourney**');
      L.push('```');
      L.push(it.mjCommand);
      L.push('```');
    }
    if (it.nai) {
      L.push('');
      L.push('**NovelAI**');
      L.push('```json');
      L.push(JSON.stringify(it.nai, null, 2));
      L.push('```');
    }
    if (it.workflow) {
      L.push('');
      L.push('**ComfyUI workflow**');
      L.push('```json');
      L.push(JSON.stringify(it.workflow, null, 2));
      L.push('```');
    }
    L.push('');
  }
  return L.join('\n');
}

function cmdStory(args) {
  const scenesRefs = args.scene ? String(args.scene).split(',') : [];
  const cast = args.cast ? String(args.cast).split(',') : [];
  const seeds = args.seed ? String(args.seed).split(',').map(Number) : [args.seedAll ? 1 : 20250101];
  const pacing = args.pacing || 'slow';
  const words = Number(args.words || 1500);
  const lead = args.lead || (args.male ? 'male' : args.female ? 'female' : 'auto');
  const list = scenesRefs.length ? scenesRefs : ds.scenes().map((s) => s.id);

  header('故事生成', `${list.length} 场景 × ${seeds.length} seed · 卡司 ${cast.length ? cast.join('+') : '自动'} · 主导 ${lead} · 目标 ${words} 字 · 节奏 ${pacing}`);

  const outputs = [];
  for (const sc of list) {
    for (const seed of seeds) {
      const story = new Story({ scene: sc, cast, heat: args.heat, words, pacing, seed, title: args.title, lead });
      const md = story.markdown();
      const meta = story.json();
      outputs.push({ scene: sc, seed, md, meta });
      const pair = meta.pairing === 'mixed' ? '男女' : meta.pairing === 'same-sex' ? '同性' : '单人';
      console.log(
        `${c('green', '✔')} ${c('bold', String(sc))} seed=${String(seed).padEnd(8)} ` +
        c('dim', `${meta.words} 字 / 目标 ${words} · ${meta.cast.map((x) => x.name).join('×')} · ${pair}`),
      );
      if (args.verbose) console.log(c('dim', '  ' + (md.split('\n').find((l) => l.startsWith('**配对**')) || '')));
    }
  }

  if (args.out) {
    const outArg = path.resolve(io.ROOT, args.out);
    if (outputs.length === 1) {
      io.writeText(outArg, outputs[0].md);
      console.log('');
      console.log(c('green', ' 已写出 ') + c('cyan', outArg));
    } else {
      io.ensureDir(outArg);
      for (const o of outputs) {
        const f = path.join(outArg, `${slug(o.scene)}-seed${o.seed}.md`);
        io.writeText(f, o.md);
      }
      const index = outputs.map((o) => `- [${o.scene} · seed ${o.seed}](${slug(o.scene)}-seed${o.seed}.md) — ${o.meta.words} 字 · ${o.meta.title}`).join('\n');
      io.writeText(path.join(outArg, 'INDEX.md'), `# 夜织 · 故事合集\n\n生成时间 ${new Date().toISOString()}\n\n${index}\n`);
      console.log('');
      console.log(c('green', ` 已写出 ${outputs.length} 篇 → `) + c('cyan', outArg));
    }
  } else if (args.print && outputs.length) {
    console.log('');
    console.log(outputs[0].md);
  }
  console.log(bar());
  return 0;
}

function cmdValidate(args) {
  const report = V.validateAll();
  header('校验', `角色 ${report.summary.characters} · 场景 ${report.summary.scenes} · 最小年龄 ${report.summary.minAge}`);
  for (const ch of report.characters) {
    const mark = ch.ok ? c('green', '✔') : c('red', '✘');
    const lv = ch.scanLevel === 'review' ? c('yellow', ' [造型词放行]') : '';
    console.log(`${mark} ${c('bold', ch.id)} ${ch.name} · ${ch.age}岁 · ageLock=${ch.ageLock}${lv}`);
    for (const e of ch.errors) console.log(c('red', '    ✘ ' + e));
    for (const w of ch.warnings) console.log(c('yellow', '    ! ' + w));
  }
  console.log('');
  for (const s of report.scenes) {
    const mark = s.ok ? c('green', '✔') : c('red', '✘');
    console.log(`${mark} ${c('bold', s.id)} ${s.title} · heat ${s.heatBase} · ${s.beats} beats`);
    for (const e of s.errors) console.log(c('red', '    ✘ ' + e));
    for (const w of s.warnings) console.log(c('yellow', '    ! ' + w));
  }
  if (report.structural.length) {
    console.log('');
    console.log(c('dim', ' 结构检查：'));
    for (const i of report.structural) {
      console.log((i.level === 'error' ? c('red', '  ✘ ') : c('yellow', '  ! ')) + c('dim', `[${i.code}] ${i.target} ${i.msg}`));
    }
  }
  console.log('');
  console.log(report.ok
    ? c('green', ' 结论：全部通过 — 所有角色走 ageLock 18+ 通道')
    : c('red', ` 结论：${report.failed.length} 项未通过`));

  if (args.gate) {
    console.log('');
    console.log(c('dim', ' 门禁演练：构造一张 17 岁卡，验证是否被拦'));
    const fake = { id: 'X99', name: '测试', age: 17, ageLock: true, appearance: { tags: ['x'] }, body: {}, personality: { core: 'x' }, voice: { register: 'slow-tease' } };
    const r = V.validateCharacter(fake);
    console.log(r.ok ? c('red', ' ✘ 门禁失效：17 岁被放行') : c('green', ' ✔ 门禁生效：') + c('dim', r.errors.join('；')));
    const scan = V.scanText('loli, 小学生, child', { hasAgeLock: false });
    console.log(scan.ok ? c('red', ' ✘ 文本扫描失效') : c('green', ' ✔ 文本扫描生效：') + c('dim', scan.reason));
    return report.ok && !r.ok && !scan.ok ? 0 : 1;
  }

  if (args.json) {
    const out = path.resolve(io.ROOT, args.json === true ? io.outFile('validate-report.json') : args.json);
    io.writeJSON(out, report);
    console.log(c('green', ' 报告已写出 ') + c('cyan', out));
  }
  console.log(bar());
  return report.ok ? 0 : 1;
}

function cmdExport(args) {
  const outDir = path.resolve(io.ROOT, args.out || io.outFile('export'));
  io.ensureDir(outDir);
  header('导出', outDir);

  const chars = args.char ? ds.resolveCharacters(String(args.char).split(',')).hit : ds.characters();
  const heat = Number(args.heat || 4);
  const targets = Object.keys(promptEngine.TARGETS);
  const written = [];

  // 1. 卡池 JSON（含校验）
  const charPayload = {
    exportedAt: new Date().toISOString(),
    characters: chars.map((c) => ({ ...c, validation: V.validateCharacter(c) })),
  };
  written.push(io.writeJSON(path.join(outDir, 'characters.json'), charPayload));

  // 2. 提示词包（每角色 × 每场景 × 每目标）
  const items = [];
  for (const ch of chars) {
    for (const scene of ds.scenes()) {
      for (const target of targets) {
        const p = promptEngine.compilePrompt({ character: ch, scene, cast: [ch], heat: Math.max(heat, scene.heatBase), rating: 'explicit', target, seed: 1000 + items.length });
        items.push({ ...p, validation: V.validatePrompt(p) });
      }
    }
  }
  written.push(io.writeJSON(path.join(outDir, 'prompts.json'), { exportedAt: new Date().toISOString(), count: items.length, items }));
  written.push(io.writeText(path.join(outDir, 'prompts.md'), renderPromptMarkdown({ generatedAt: new Date().toISOString(), heat, rating: 'explicit', items: items.filter((i) => i.target === 'sdxl') })));

  // 3. 提示词 CSV（方便表格筛选）
  const csvRows = [['character', 'age', 'scene', 'heat', 'target', 'positive', 'negative']];
  for (const it of items.filter((i) => i.target === 'sdxl')) {
    csvRows.push([it.character, String(chars.find((x) => x.name === it.character).age), it.scene || '', String(it.heat), it.target, it.positive, it.negative]);
  }
  written.push(io.writeText(path.join(outDir, 'prompts.csv'), csvRows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n'));

  // 4. 样例故事（每场景一篇）
  const storyFiles = [];
  for (const scene of ds.scenes()) {
    const s = new Story({ scene: scene.id, heat: scene.heatBase, words: 1200, pacing: 'balanced', seed: 20250101 });
    const f = path.join(outDir, 'stories', `${scene.id}-${slug(scene.title)}.md`);
    io.writeText(f, s.markdown());
    storyFiles.push(f);
  }

  // 5. 索引
  const idx = [
    '# 夜织 CialloForge · 导出包',
    '',
    `导出时间：${new Date().toISOString()}`,
    '',
    `- 角色卡：${chars.length} 张（characters.json 含逐卡校验结果）`,
    `- 绘图提示词：${items.length} 条（prompts.json / prompts.md / prompts.csv）`,
    `- 样例故事：${storyFiles.length} 篇（stories/）`,
    '',
    '## 故事索引',
    '',
    ...storyFiles.map((f) => `- [${path.basename(f)}](stories/${path.basename(f)})`),
    '',
    '## 路径',
    '',
    ...written.map((w) => `- ${path.relative(outDir, w)}`),
    '',
  ].join('\n');
  written.push(io.writeText(path.join(outDir, 'INDEX.md'), idx));

  console.log(` ${c('green', '✔')} characters.json  ${c('dim', chars.length + ' 张卡')}`);
  console.log(` ${c('green', '✔')} prompts.json    ${c('dim', items.length + ' 条提示词 × ' + targets.length + ' 目标')}`);
  console.log(` ${c('green', '✔')} prompts.csv / prompts.md`);
  console.log(` ${c('green', '✔')} stories/        ${c('dim', storyFiles.length + ' 篇')}`);
  console.log(` ${c('green', '✔')} INDEX.md`);
  console.log('');
  console.log(c('green', ' 导出完成 → ') + c('cyan', outDir));
  console.log(bar());
  return 0;
}

function csvCell(v) {
  const s = String(v == null ? '' : v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function cmdStats(args) {
  const st = ds.stats();
  header('统计');
  console.log(` 角色卡      ${c('bold', String(st.characters))} 张  ${c('dim', `年龄区间 ${st.minAge}-${st.maxAge}`)}`);
  console.log(` 场景        ${c('bold', String(st.scenes))} 个 / ${st.beats} beats`);
  console.log(` 绘图标签    ${c('bold', String(st.tags))} 条`);
  console.log(` 癖好族      ${c('bold', String(st.kinkCount))} 个`);
  console.log(` 声线寄存器  ${c('bold', String(st.registers.length))} 种  ${c('dim', st.registers.join(', '))}`);
  console.log(` 散文池      ${c('bold', String(st.prosePools))} 族 / 热度 ${st.heatTiers} 档`);
  console.log(` 场景族      ${c('dim', st.kinkFamilies.join(', '))}`);
  console.log(bar());
  return 0;
}

function cmdPack(args) {
  const sub = (args._[1] || 'status').toLowerCase();
  const pack = require('../src/util/content-pack');
  const ds = require('../src/engine/datastore');

  header('内容包', '把露骨词库与仓库本体解耦：基础版（heat 1-3）+ 内容包（heat 4-5）');

  if (sub === 'status' || sub === 'info') {
    const st = ds.contentPackStatus();
    const nChars = ds.characters().length;
    const nScenes = ds.scenes().length;
    const prose = ds.prose();
    if (!st.available) {
      console.log(c('yellow', ' 未发现内容包 —— 当前为基础版（heat ≤ 3）'));
      console.log(c('dim', '  查找位置：'));
      for (const d of st.candidates || []) console.log(c('dim', `    · ${d}`));
      console.log('');
      console.log(`  当前规模：${c('bold', String(nChars))} 卡 / ${c('bold', String(nScenes))} 场景 / 部位词 ${(prose.bodyPart || []).length} 条`);
      if (st.hint) console.log(c('dim', '  提示：' + st.hint));
      console.log(bar());
      return 0;
    }
    const on = st.active;
    console.log(` ${on ? c('green', '● 已启用') : c('dim', '○ 已关闭')}  ${c('bold', st.name || st.id)} ${st.version ? c('dim', 'v' + st.version) : ''}`);
    console.log(c('dim', `  目录：${st.dir}`));
    if (st.rating) console.log(c('dim', `  评级：${st.rating}`));
    console.log(`  当前规模：${c('bold', String(nChars))} 卡 / ${c('bold', String(nScenes))} 场景 / 部位词 ${c('bold', String((prose.bodyPart || []).length))} 条 / 体液词 ${c('bold', String((prose.fluid || []).length))} 条`);
    if (st.files) console.log(c('dim', '  包内文件：' + Object.entries(st.files).map(([f, n]) => `${f}(${n})`).join(' · ')));
    if (st.error) console.log(c('red', '  最近一次合并出错：' + st.error));
    if (st.hint) console.log(c('yellow', '  ' + st.hint));
    console.log('');
    console.log(c('dim', '  命令：ciallo pack on | off | status | dir'));
    console.log(bar());
    return 0;
  }

  if (sub === 'on') {
    const st = ds.setContentPack(true);
    console.log(` ${c('green', '✔ 已启用')} ${st.name || st.id} · 部位词 ${(ds.prose().bodyPart || []).length} 条`);
    console.log(bar());
    return 0;
  }

  if (sub === 'off') {
    ds.setContentPack(false);
    const prose = ds.prose();
    const heats = Object.keys(prose.heat || { 1: 1 }).map(Number).filter(Number.isFinite);
    console.log(` ${c('green', '✔ 已关闭内容包')} —— 数据目录恢复为基础版`);
    console.log(c('dim', `  当前：部位词 ${(prose.bodyPart || []).length} 条 / 体液词 ${(prose.fluid || []).length} 条 / 最大尺度 heat ${Math.max(...heats)}`));
    console.log(bar());
    return 0;
  }

  if (sub === 'dir') {
    const st = pack.status();
    console.log(st.dir || c('dim', '（未发现内容包）'));
    return 0;
  }

  console.error(c('red', `未知子命令：pack ${sub}`));
  console.log(c('dim', '  用法：ciallo pack [status|on|off|dir]'));
  console.log(bar());
  return 2;
}

function cmdHelp() {
  header('用法', 'node bin/ciallo.js <command> [options]');
  const rows = [
    ['chars', '[--verbose] [--male|--female]', '列卡池（16 张成年卡：♂7 / ♀9）'],
    ['scenes', '[--verbose]', '列场景库（16 场景）'],
    ['prompt', '--char C01|all [--scene S01] [--target sdxl|novelai|midjourney|comfyui|pony|generic|all] [--heat 4] [--rating explicit] [--extra "tag1;tag2"] [--out out/x.json]', '编译绘图提示词'],
    ['story', '--scene S01 [--cast C01,C08] [--lead male|female|auto] [--heat 4] [--words 1500] [--pacing slow|balanced|fast|pwp] [--seed 7] [--out out/x.md] [--print]', '生成成人虚构正文（--lead 控制主导方性别）'],
    ['validate', '[--gate] [--json out/report.json]', '校验年龄锁与数据完整性'],
    ['export', '[--out out/export] [--char C01] [--heat 4]', '导出全套（卡+提示词+CSV+样例故事）'],
    ['pack', '[status|on|off|dir]', '内容包：基础版 heat 1-3 ⇄ 加载内容包到 heat 5'],
    ['stats', '', '统计概览'],
    ['help', '', '这份帮助'],
  ];
  for (const [cmd, opt, desc] of rows) {
    console.log(` ${c('cyan', cmd.padEnd(9))} ${c('dim', opt)}`);
    console.log(` ${' '.repeat(9)} ${desc}`);
  }
  console.log('');
  console.log(c('dim', ' 例：node bin/ciallo.js story --scene S05 --cast C05 --heat 5 --words 2000 --pacing fast --out out/gym.md'));
  console.log(c('dim', ' 例：node bin/ciallo.js prompt --char C02 --scene S02 --target midjourney --out out/c02.json'));
  console.log(bar());
  return 0;
}

// ─────────────────────────── 入口 ───────────────────────────

function main() {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);
  const cmd = args._[0] || 'help';

  try {
    switch (cmd) {
      case 'chars': case 'characters': return cmdChars(args);
      case 'scenes': return cmdScenes(args);
      case 'prompt': case 'prompts': return cmdPrompt(args);
      case 'story': case 'stories': return cmdStory(args);
      case 'validate': case 'check': return cmdValidate(args);
      case 'export': return cmdExport(args);
      case 'pack': case 'contentpack': return cmdPack(args);
      case 'stats': return cmdStats(args);
      case 'help': case '--help': case '-h': return cmdHelp();
      default:
        console.error(c('red', `未知命令：${cmd}`));
        cmdHelp();
        return 2;
    }
  } catch (err) {
    console.error(c('red', ' 错误：') + err.message);
    if (process.env.DEBUG) console.error(err.stack);
    return 1;
  }
}

process.exitCode = main();
