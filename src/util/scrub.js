'use strict';

/**
 * 报告脱敏：这些报告会随仓库公开，不能带本机用户名与绝对路径。
 *   C:\Users\Ricardo\AppData\... → %USERPROFILE%\AppData\...
 *   E:\harness 破甲\ciallo-forge    → <project>
 */

const os = require('os');
const path = require('path');
const io = require('./io');

function scrub(text) {
  const home = os.homedir();
  const user = path.basename(home);
  let out = String(text == null ? '' : text);

  const pairs = [
    [io.ROOT, '<project>'],
    [home, '%USERPROFILE%'],
    [home.replace(/\\/g, '/'), '%USERPROFILE%'],
    [io.ROOT.replace(/\\/g, '/'), '<project>'],
  ];
  for (const [from, to] of pairs) {
    if (from) out = out.split(from).join(to);
  }
  if (user && user.length > 2) {
    out = out.split(new RegExp(`\\b${user.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g')).join('%USER%');
  }
  return out;
}

module.exports = { scrub };
