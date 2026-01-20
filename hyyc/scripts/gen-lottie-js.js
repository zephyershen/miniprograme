// 简单工具脚本：把 Lottie 的 json 文件转成 JS 模块：module.exports = {...}
// 只在开发环境（Node）里跑一次即可。

const fs = require('fs');
const path = require('path');

// loading 组件用到的动画数据
const src = path.join(__dirname, '..', 'assets', 'loading', 'shopping-bag.json');
const dest = path.join(__dirname, '..', 'assets', 'loading', 'shopping-bag.js');

const json = fs.readFileSync(src, 'utf8');

// 直接把原始 json 字符串拼进 module.exports，避免解析/重排
const out = 'module.exports = ' + json.trim() + ';\n';

fs.writeFileSync(dest, out, 'utf8');
console.log('generated', path.relative(process.cwd(), dest));
