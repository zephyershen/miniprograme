const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const SIZE = 81;
const SCALE = 4;
const CANVAS_SIZE = SIZE * SCALE;
const STROKE = 2.4;
const OUTPUT_ROOT = path.resolve(__dirname, '..', 'assets', 'tabbar');
const COLORS = {
  default: '#536471',
  selected: '#1d9bf0'
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function parseColor(value) {
  return [
    Number.parseInt(value.slice(1, 3), 16),
    Number.parseInt(value.slice(3, 5), 16),
    Number.parseInt(value.slice(5, 7), 16)
  ];
}

function createMask() {
  return new Uint8Array(CANVAS_SIZE * CANVAS_SIZE);
}

function paint(mask, x, y, alpha = 255) {
  if (x < 0 || y < 0 || x >= CANVAS_SIZE || y >= CANVAS_SIZE) return;
  const index = y * CANVAS_SIZE + x;
  mask[index] = Math.max(mask[index], alpha);
}

function drawDisk(mask, cx, cy, radius) {
  const centerX = cx * SCALE;
  const centerY = cy * SCALE;
  const scaledRadius = radius * SCALE;
  const minX = Math.floor(centerX - scaledRadius - 1);
  const maxX = Math.ceil(centerX + scaledRadius + 1);
  const minY = Math.floor(centerY - scaledRadius - 1);
  const maxY = Math.ceil(centerY + scaledRadius + 1);

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const distance = Math.hypot(x + 0.5 - centerX, y + 0.5 - centerY);
      if (distance <= scaledRadius) paint(mask, x, y);
    }
  }
}

function drawLine(mask, x1, y1, x2, y2, width = STROKE) {
  const startX = x1 * SCALE;
  const startY = y1 * SCALE;
  const endX = x2 * SCALE;
  const endY = y2 * SCALE;
  const radius = (width * SCALE) / 2;
  const deltaX = endX - startX;
  const deltaY = endY - startY;
  const lengthSquared = deltaX * deltaX + deltaY * deltaY;
  const minX = Math.floor(Math.min(startX, endX) - radius - 1);
  const maxX = Math.ceil(Math.max(startX, endX) + radius + 1);
  const minY = Math.floor(Math.min(startY, endY) - radius - 1);
  const maxY = Math.ceil(Math.max(startY, endY) + radius + 1);

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const pointX = x + 0.5;
      const pointY = y + 0.5;
      const projection = lengthSquared
        ? clamp(
            ((pointX - startX) * deltaX + (pointY - startY) * deltaY) /
              lengthSquared,
            0,
            1
          )
        : 0;
      const closestX = startX + projection * deltaX;
      const closestY = startY + projection * deltaY;
      if (Math.hypot(pointX - closestX, pointY - closestY) <= radius) {
        paint(mask, x, y);
      }
    }
  }
}

function drawPolyline(mask, points, width = STROKE, closed = false) {
  const pairs = closed ? [...points, points[0]] : points;
  for (let index = 1; index < pairs.length; index += 1) {
    drawLine(
      mask,
      pairs[index - 1][0],
      pairs[index - 1][1],
      pairs[index][0],
      pairs[index][1],
      width
    );
  }
}

function drawCircle(mask, cx, cy, radius, width = STROKE) {
  const points = [];
  const segments = 64;
  for (let index = 0; index < segments; index += 1) {
    const angle = (Math.PI * 2 * index) / segments;
    points.push([cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius]);
  }
  drawPolyline(mask, points, width, true);
}

function drawRoundedRect(mask, left, top, right, bottom, radius, width = STROKE) {
  const points = [];
  const corners = [
    [right - radius, top + radius, -Math.PI / 2],
    [right - radius, bottom - radius, 0],
    [left + radius, bottom - radius, Math.PI / 2],
    [left + radius, top + radius, Math.PI]
  ];

  corners.forEach(([cx, cy, startAngle]) => {
    for (let index = 0; index <= 8; index += 1) {
      const angle = startAngle + (Math.PI / 2) * (index / 8);
      points.push([cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius]);
    }
  });
  drawPolyline(mask, points, width, true);
}

function drawNews(mask) {
  drawRoundedRect(mask, 15, 18, 66, 63, 5);
  drawRoundedRect(mask, 22, 26, 35, 39, 2, 2.1);
  drawLine(mask, 42, 27, 58, 27, 2.1);
  drawLine(mask, 42, 35, 58, 35, 2.1);
  drawLine(mask, 22, 47, 59, 47, 2.1);
  drawLine(mask, 22, 55, 52, 55, 2.1);
}

function drawBook(mask) {
  drawPolyline(mask, [
    [14, 23],
    [26, 20],
    [40.5, 26],
    [40.5, 62],
    [27, 56],
    [14, 59]
  ]);
  drawLine(mask, 14, 23, 14, 59);
  drawPolyline(mask, [
    [67, 23],
    [55, 20],
    [40.5, 26],
    [40.5, 62],
    [54, 56],
    [67, 59]
  ]);
  drawLine(mask, 67, 23, 67, 59);
  drawLine(mask, 21, 31, 34, 35, 1.9);
  drawLine(mask, 21, 39, 34, 43, 1.9);
  drawLine(mask, 60, 31, 47, 35, 1.9);
  drawLine(mask, 60, 39, 47, 43, 1.9);
}

function drawBriefing(mask) {
  drawRoundedRect(mask, 18, 14, 63, 67, 5);
  drawLine(mask, 27, 25, 54, 25, 2.1);
  drawLine(mask, 27, 33, 48, 33, 2.1);
  drawLine(mask, 27, 57, 27, 49, 4);
  drawLine(mask, 37, 57, 37, 44, 4);
  drawLine(mask, 47, 57, 47, 39, 4);
  drawLine(mask, 57, 57, 57, 34, 4);
}

function drawProfile(mask) {
  drawCircle(mask, 40.5, 29, 10.5);
  const shoulders = [];
  for (let index = 0; index <= 32; index += 1) {
    const ratio = index / 32;
    const x = 16 + ratio * 49;
    const centered = (ratio - 0.5) * 2;
    const y = 64 - 17 * (1 - centered * centered);
    shoulders.push([x, y]);
  }
  drawPolyline(mask, shoulders);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([length, typeBuffer, data, checksum]);
}

function encodePng(mask, color) {
  const [red, green, blue] = parseColor(color);
  const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);

  for (let y = 0; y < SIZE; y += 1) {
    const rowOffset = y * (SIZE * 4 + 1);
    raw[rowOffset] = 0;
    for (let x = 0; x < SIZE; x += 1) {
      let alphaTotal = 0;
      for (let subY = 0; subY < SCALE; subY += 1) {
        for (let subX = 0; subX < SCALE; subX += 1) {
          const sourceX = x * SCALE + subX;
          const sourceY = y * SCALE + subY;
          alphaTotal += mask[sourceY * CANVAS_SIZE + sourceX];
        }
      }
      const target = rowOffset + 1 + x * 4;
      raw[target] = red;
      raw[target + 1] = green;
      raw[target + 2] = blue;
      raw[target + 3] = Math.round(alphaTotal / (SCALE * SCALE));
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(SIZE, 0);
  header.writeUInt32BE(SIZE, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

const icons = {
  news: drawNews,
  column: drawBook,
  briefing: drawBriefing,
  profile: drawProfile
};

fs.mkdirSync(OUTPUT_ROOT, { recursive: true });
Object.entries(icons).forEach(([name, draw]) => {
  const mask = createMask();
  draw(mask);
  Object.entries(COLORS).forEach(([state, color]) => {
    const suffix = state === 'selected' ? '-selected' : '';
    fs.writeFileSync(
      path.join(OUTPUT_ROOT, `${name}${suffix}.png`),
      encodePng(mask, color)
    );
  });
});

console.log(`Generated ${Object.keys(icons).length * 2} tab icons in ${OUTPUT_ROOT}.`);
