// 把 dist-single 的构建产物内联成一个独立 html 文件（双击即可离线使用）
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('../dist-single', import.meta.url));
const out = process.argv[2] || fileURLToPath(new URL('../排班管家.html', import.meta.url));

let html = readFileSync(join(dir, 'index.html'), 'utf8');
const assets = readdirSync(join(dir, 'assets'));

// 内联 CSS
for (const f of assets.filter((f) => f.endsWith('.css'))) {
  const css = readFileSync(join(dir, 'assets', f), 'utf8');
  html = html.replace(new RegExp(`<link[^>]*href="[^"]*${f}"[^>*/?]*/?>`), () => `<style>${css}</style>`);
}

// 内联 JS
for (const f of assets.filter((f) => f.endsWith('.js'))) {
  const js = readFileSync(join(dir, 'assets', f), 'utf8');
  html = html.replace(
    new RegExp(`<script[^>]*src="[^"]*${f}"[^>]*></script>`),
    () => `<script type="module">${js.replace(/<\/script>/g, '<\\/script>')}</script>`
  );
}

// 兜底检查：不允许残留外部资源引用
const leftover = html.match(/(src|href)="\.?\/assets\//);
if (leftover) {
  console.error('仍有未内联的资源引用:', leftover[0]);
  process.exit(1);
}

writeFileSync(out, html);
console.log(`单文件已生成: ${out} (${(html.length / 1024 / 1024).toFixed(1)} MB)`);
