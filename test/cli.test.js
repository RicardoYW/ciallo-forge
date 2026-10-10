'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const BIN = path.join(ROOT, 'bin', 'ciallo.js');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ciallo-cli-'));

/** 用 inherit 避免管道捕获限制；每次调用先清空日志，保证只看到本次输出 */
function runCli(args) {
  const log = path.join(TMP, 'cli.log');
  fs.writeFileSync(log, '', 'utf8');
  const r = spawnSync(process.execPath, [BIN, ...args], {
    cwd: ROOT,
    stdio: ['ignore', fs.openSync(log, 'a'), fs.openSync(log, 'a')],
    env: { ...process.env, NO_COLOR: '1' },
  });
  const out = fs.readFileSync(log, 'utf8');
  return { status: r.status, out };
}

test('cli: chars 列出全部角色', () => {
  const r = runCli(['chars']);
  assert.equal(r.status, 0);
  assert.match(r.out, /苏晚/);
  assert.match(r.out, /顾清欢/);
});

test('cli: stats 输出规模', () => {
  const r = runCli(['stats']);
  assert.equal(r.status, 0);
  assert.match(r.out, /角色卡\s+16/);
  assert.match(r.out, /场景\s+16/);
});

test('cli: validate --gate 通过并演示门禁', () => {
  const r = runCli(['validate', '--gate']);
  assert.equal(r.status, 0);
  assert.match(r.out, /全部通过/);
  assert.match(r.out, /门禁生效/);
  assert.match(r.out, /文本扫描生效/);
});

test('cli: prompt --out 写出 json + md', () => {
  const outFile = path.join(TMP, 'prompt.json');
  const r = runCli(['prompt', '--char', 'C02', '--scene', 'S02', '--target', 'sdxl', '--heat', '5', '--out', outFile]);
  assert.equal(r.status, 0);
  assert.ok(fs.existsSync(outFile), 'json 未生成');
  const payload = JSON.parse(fs.readFileSync(outFile, 'utf8'));
  assert.equal(payload.items.length, 1);
  assert.match(payload.items[0].positive, /33 years old/);
  assert.ok(fs.existsSync(outFile.replace(/\.json$/, '.md')), 'md 未生成');
});

test('cli: prompt --target all 覆盖 6 个目标', () => {
  const outFile = path.join(TMP, 'batch.json');
  const r = runCli(['prompt', '--char', 'C01', '--target', 'all', '--out', outFile]);
  assert.equal(r.status, 0);
  const payload = JSON.parse(fs.readFileSync(outFile, 'utf8'));
  assert.equal(payload.items.length, 6);
  assert.equal(new Set(payload.items.map((i) => i.target)).size, 6);
});

test('cli: prompt --char all 覆盖 16 张卡', () => {
  const outFile = path.join(TMP, 'all.json');
  const r = runCli(['prompt', '--char', 'all', '--target', 'sdxl', '--out', outFile]);
  assert.equal(r.status, 0);
  const payload = JSON.parse(fs.readFileSync(outFile, 'utf8'));
  assert.equal(payload.items.length, 16);
  assert.ok(payload.items.every((i) => i.validation.ok));
});

test('cli: chars --male / --female 分流', () => {
  const male = runCli(['chars', '--male']);
  assert.equal(male.status, 0);
  assert.match(male.out, /江彻/);
  assert.doesNotMatch(male.out, /苏晚/);
  const female = runCli(['chars', '--female']);
  assert.match(female.out, /苏晚/);
  assert.doesNotMatch(female.out, /沈聿/);
});

test('cli: story 单篇写出且字数达标', () => {
  const outFile = path.join(TMP, 'story.md');
  const r = runCli(['story', '--scene', 'S05', '--cast', 'C05', '--heat', '5', '--words', '1200', '--pacing', 'balanced', '--seed', '7', '--out', outFile]);
  assert.equal(r.status, 0);
  const md = fs.readFileSync(outFile, 'utf8');
  assert.match(md, /全员成年（年龄锁 18\+）/);
  assert.match(md, /## 附录 · 配图提示词/);
  assert.ok(md.length > 1200, `正文过短：${md.length}`);
});

test('cli: story 多场景导出为目录 + INDEX', () => {
  const dir = path.join(TMP, 'multi');
  const r = runCli(['story', '--scene', 'S03,S04', '--words', '600', '--pacing', 'fast', '--seed', '1,2', '--out', dir]);
  assert.equal(r.status, 0);
  const files = fs.readdirSync(dir);
  assert.equal(files.filter((f) => f.endsWith('.md')).length, 5, `期望 4 篇 + INDEX，实际 ${files.join(',')}`);
  assert.ok(files.includes('INDEX.md'));
});

test('cli: 未知命令返回 2', () => {
  const r = runCli(['nope']);
  assert.equal(r.status, 2);
});

test('cli: export 产出完整导出包', () => {
  const dir = path.join(TMP, 'exp');
  const r = runCli(['export', '--out', dir]);
  assert.equal(r.status, 0);
  for (const f of ['characters.json', 'prompts.json', 'prompts.csv', 'prompts.md', 'INDEX.md']) {
    assert.ok(fs.existsSync(path.join(dir, f)), `缺 ${f}`);
  }
  assert.ok(fs.readdirSync(path.join(dir, 'stories')).length >= 16);
  const csv = fs.readFileSync(path.join(dir, 'prompts.csv'), 'utf8');
  assert.match(csv, /^character,age,scene,heat,target,positive,negative/);
  assert.ok(csv.split('\r\n').length > 100);
});
