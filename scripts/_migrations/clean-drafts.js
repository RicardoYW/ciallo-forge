'use strict';

/** 列出并清理误建的草稿 release（只删 draft 且 name 含 probe 的） */
const TOKEN = process.env.GH_TOKEN;
const OWNER = 'RicardoYW';
const REPO = 'ciallo-forge';
const H = { authorization: `token ${TOKEN}`, accept: 'application/vnd.github+json', 'user-agent': 'ciallo-cleanup' };

(async () => {
  const res = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/releases`, { headers: H });
  const list = await res.json();
  console.log(`现有 release ${list.length} 个：`);
  for (const r of list) {
    console.log(`  · id=${r.id} tag=${r.tag_name} draft=${r.draft} assets=${r.assets.length} name=${r.name}`);
  }
  const junk = list.filter((r) => r.draft === true && /probe/i.test(r.name || ''));
  for (const r of junk) {
    const d = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/releases/${r.id}`, { method: 'DELETE', headers: H });
    console.log(`删除草稿 id=${r.id}（${r.name}）→ HTTP ${d.status}`);
  }
  if (!junk.length) console.log('没有需要清理的草稿。');
})();
