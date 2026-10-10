'use strict';

/** 隔离测试：确认 GitHub API 与 uploads 域名在当前网络/代理下是否可达 */
const TOKEN = process.env.GH_TOKEN;
if (!TOKEN) { console.error('缺少 GH_TOKEN'); process.exit(2); }

const H = {
  authorization: `token ${TOKEN}`,
  accept: 'application/vnd.github+json',
  'user-agent': 'ciallo-forge-probe',
  'content-type': 'application/json',
};

async function probe(label, url, init = {}) {
  const t = Date.now();
  try {
    const res = await fetch(url, { ...init, headers: { ...H, ...(init.headers || {}) } });
    const text = await res.text();
    console.log(`  ${label}: HTTP ${res.status}  ${Date.now() - t}ms  ${text.slice(0, 120).replace(/\s+/g, ' ')}`);
    return { status: res.status, text };
  } catch (err) {
    console.log(`  ${label}: 失败 ${Date.now() - t}ms → ${err.message}${err.cause ? ' / cause=' + err.cause.message : ''}`);
    return { error: err };
  }
}

(async () => {
  console.log('代理环境：HTTP_PROXY=' + (process.env.HTTP_PROXY || '-') + '  HTTPS_PROXY=' + (process.env.HTTPS_PROXY || '-'));
  console.log('');
  await probe('GET /user', 'https://api.github.com/user');
  await probe('GET /repos/.../releases', 'https://api.github.com/repos/RicardoYW/ciallo-forge/releases');
  await probe('GET uploads 域名（探测连通）', 'https://uploads.github.com/');
  await probe('POST /releases（重复标签，预期 422）', 'https://api.github.com/repos/RicardoYW/ciallo-forge/releases', {
    method: 'POST',
    body: JSON.stringify({ tag_name: 'v1.0.0', name: 'probe', draft: true }),
  });
  console.log('');
  console.log('探测结束');
})();
