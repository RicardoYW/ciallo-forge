'use strict';

/** 把 .bat 的行尾统一成 CRLF（cmd.exe 对 LF 批处理容错差） */
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', '启动.bat');
const raw = fs.readFileSync(file, 'utf8');
const crlf = raw.replace(/\r?\n/g, '\r\n');
if (crlf !== raw) {
  fs.writeFileSync(file, crlf, 'utf8');
  console.log('[OK] 启动.bat 行尾已转为 CRLF');
} else {
  console.log('[i] 启动.bat 已是 CRLF，无需改动');
}
