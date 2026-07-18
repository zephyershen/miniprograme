const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('../cloudrun/source-preview-renderer/node_modules/playwright');
const { selectFocusCandidate } = require('../cloudrun/source-preview-renderer/src/focus-policy');
const { stabilizeFocusedContent } = require('../cloudrun/source-preview-renderer/src/media-stability');
const { captureFocusedSegments } = require('../cloudrun/source-preview-renderer/src/capture-focused');

function svgData(label, width, height, color) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" rx="32" fill="${color}"/><circle cx="${width / 2}" cy="${height / 2}" r="${Math.min(width, height) / 5}" fill="#5457df"/><title>${label}</title></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROME_PATH
      || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
  });
  const page = await browser.newPage({ viewport: { width: 1080, height: 1350 } });
  try {
    await page.setContent(`
      <style>
        body{margin:0;background:#f3f4f8;font:24px system-ui;color:#20222b}
        header{height:90px;background:white}.layout{display:grid;grid-template-columns:300px 680px;gap:28px;padding:30px}
        aside{height:980px;background:white;border-radius:28px;padding:24px;box-sizing:border-box}
        article{background:white;border-radius:32px;padding:30px;box-sizing:border-box}
        .author{display:flex;align-items:center;gap:14px}.avatar{width:52px;height:52px;border-radius:50%;background:#e4e5eb}
        h1{font-size:42px;line-height:1.2}.hero{display:block;width:100%;height:390px;margin-top:24px;border-radius:28px;background:#e8e9ef}
        p{line-height:1.7}.side-link{margin:22px 0;color:#5457df}
      </style>
      <header></header><div class="layout"><aside>${'<div class="side-link">导航与推荐</div>'.repeat(12)}</aside>
      <article><div class="author"><img class="avatar" data-src="avatar"><strong>加载完成的作者头像</strong></div>
      <h1>真正有用的正文内容</h1><p>${'这里是文章摘要，用来验证正文容器会被选中，而导航侧栏不会进入最终截图。'.repeat(5)}</p>
      <img class="hero" data-src="hero"><p>${'图片加载完成后再截图，避免头像、主图和图标出现空白。'.repeat(12)}</p></article></div>
      <script>
        setTimeout(() => {
          document.querySelector('[data-src="avatar"]').src = '${svgData('avatar', 80, 80, '#e8e8ff')}';
          document.querySelector('[data-src="hero"]').src = '${svgData('hero', 900, 560, '#eef1ff')}';
        }, 550);
      </script>
    `);
    const focus = await selectFocusCandidate(page, 'https://public.example/article');
    const stable = await stabilizeFocusedContent(page);
    const capture = await captureFocusedSegments(page, stable.box, 12);
    if (!focus || focus.kind !== 'article') throw new Error('ARTICLE_NOT_FOCUSED');
    if (!capture || capture.screenshots[0].width >= 1000) throw new Error('FOCUS_CROP_NOT_APPLIED');
    if (stable.media.pending !== 0 || stable.media.ready < 2) throw new Error('MEDIA_NOT_STABLE');
    const output = path.resolve(__dirname, '../../output/playwright/focus-renderer-proof.jpg');
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, Buffer.from(capture.screenshots[0].data, 'base64'));
    console.log(JSON.stringify({ focus, media: stable.media, segmentCount: capture.segmentCount, width: capture.screenshots[0].width, output }));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
