'use strict';

/**
 * 提交前扫描：入库内容里不能有本地路径、用户名、密钥，也不能有露骨词库。
 * 只读 git 暂存区（必须先 git add）。用法：node scripts/precommit-scan.js
 */

const { execFileSync } = require('child_process');
const path = require('path');

function sh(args, opts = {}) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });
}

const staged = sh(['diff', '--cached', '--name-only']).split(/\r?\n/).filter(Boolean);
const TEXT = /\.(js|mjs|json|md|css|html|bat|cmd|yml|yaml|txt)$/i;

const RULES = [
  { name: '本地绝对路径（E:\\harness 之类）', re: /[A-Za-z]:\\(?:harness|Users\\[A-Za-z]|deepseek)/i },
  { name: 'Windows 用户名', re: /\bRicardo\b/ },
  { name: 'AppData 绝对路径泄漏', re: /AppData\\+Roaming\\+[a-z]/i },
  { name: '临时目录绝对路径', re: /C:\\+Users\\+[^\\\s]+\\+AppData\\+Local\\+Temp/i },
  { name: '密钥/令牌赋值', re: /(api[_-]?key|apikey|secret|access[_-]?token|auth[_-]?token|password|passwd)\s*[:=]\s*['"][^'"]{12,}['"]/i },
  { name: '私钥块', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: '内网 IP', re: /\b(?:192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d+\.\d+\.\d+\b/ },
  { name: '邮箱地址', re: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-z]{2,}/ },
];

/**
 * 自扫描豁免：
 *  - precommit-scan.js 里全是规则本身，必然命中自己
 *  - scrub.js 是脱敏工具，注释里写了示例路径与用户名（那是它的用法说明）
 */
const SKIP = new Set(['scripts/precommit-scan.js', 'src/util/scrub.js']);

/** 数据文件里不应该出现的露骨词（词库类关键词） */
const HEAVY = /穴口|乳尖|乳肉|臀缝|甬道深处|花心|抽送|精液|潮喷|内射/;

let problems = 0;
const rows = [];

for (const f of staged) {
  if (SKIP.has(f)) continue;
  let content = '';
  try {
    // 用 --text 避免二进制判定；把 bytes 交给 Node 解码，中文文件名也安全
    const buf = execFileSync('git', ['show', '--text', ':' + f], { maxBuffer: 64 * 1024 * 1024 });
    content = buf.toString('utf8');
  } catch {
    continue; // 真正读不到的（如二进制资源）跳过
  }

  for (const rule of RULES) {
    if (rule.name === '邮箱地址' && /^data\//.test(f)) continue; // 数据里可能有示例邮箱字段
    const m = content.match(new RegExp(rule.re.source, 'gi'));
    if (m) {
      problems++;
      rows.push({ f, rule: rule.name, sample: [...new Set(m)].slice(0, 3).join(' | ') });
    }
  }

  if (/^data\/.*\.json$/.test(f) && HEAVY.test(content)) {
    const hits = content.match(new RegExp(HEAVY.source, 'g')) || [];
    problems++;
    rows.push({ f, rule: '入库数据含露骨词', sample: `${hits.length} 处: ${[...new Set(hits)].join('、')}` });
  }
}

console.log('# 提交前扫描');
console.log('');
console.log(`- 暂存文件：${staged.length} 个`);
console.log(`- 文本类：${staged.filter((f) => TEXT.test(f)).length} 个`);
console.log(`- 数据类：${staged.filter((f) => /^data\//.test(f)).length} 个`);
console.log('');

if (problems === 0) {
  console.log('✅ 未发现本地路径、用户名、密钥、内网 IP、邮箱或露骨词库。');
  console.log('');
  console.log('（说明：`C:\\Program Files` 这类标准安装路径是浏览器探测逻辑的一部分，不算泄漏；');
  console.log('  规则里只拦「用户名 / AppData / Temp / 项目绝对路径」这些真正带个人信息的形态。）');
} else {
  console.log(`❌ 发现 ${problems} 处需要处理：`);
  console.log('');
  for (const r of rows) console.log(`- ${r.f} → ${r.rule}\n    ${r.sample.slice(0, 120)}`);
}

process.exitCode = problems ? 1 : 0;
