import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, "..");
const outputPath = path.join(projectRoot, "ios", "App", "App", "Assets.xcassets", "AppIcon.appiconset", "AppIcon-512@2x.png");
const SIZE = 1024;
const pixels = Buffer.alloc(SIZE * SIZE * 4, 255);

function setPixel(x, y, [red, green, blue, alpha = 255]) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
  const offset = (y * SIZE + x) * 4;
  pixels[offset] = red;
  pixels[offset + 1] = green;
  pixels[offset + 2] = blue;
  pixels[offset + 3] = alpha;
}

function fillRect(left, top, width, height, color) {
  for (let y = Math.max(0, top); y < Math.min(SIZE, top + height); y += 1) {
    for (let x = Math.max(0, left); x < Math.min(SIZE, left + width); x += 1) setPixel(x, y, color);
  }
}

function fillRoundedRect(left, top, width, height, radius, color) {
  const right = left + width - 1;
  const bottom = top + height - 1;
  const radiusSquared = radius * radius;
  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) {
      const nearestX = Math.max(left + radius, Math.min(x, right - radius));
      const nearestY = Math.max(top + radius, Math.min(y, bottom - radius));
      const dx = x - nearestX;
      const dy = y - nearestY;
      if (dx * dx + dy * dy <= radiusSquared) setPixel(x, y, color);
    }
  }
}

const GLYPHS = {
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  C: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  N: ["10001", "11001", "10101", "10101", "10011", "10001", "10001"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  " ": ["000", "000", "000", "000", "000", "000", "000"],
};

function textWidth(text, scale, spacing) {
  return [...text].reduce((total, letter, index) => {
    const glyph = GLYPHS[letter] || GLYPHS[" "];
    return total + glyph[0].length * scale + (index === text.length - 1 ? 0 : spacing);
  }, 0);
}

function drawText(text, centerX, top, scale, spacing, color) {
  let x = Math.round(centerX - textWidth(text, scale, spacing) / 2);
  for (const letter of text) {
    const glyph = GLYPHS[letter] || GLYPHS[" "];
    glyph.forEach((row, rowIndex) => {
      [...row].forEach((value, columnIndex) => {
        if (value === "1") fillRect(x + columnIndex * scale, top + rowIndex * scale, scale, scale, color);
      });
    });
    x += glyph[0].length * scale + spacing;
  }
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const value of buffer) {
    crc ^= value;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

fillRoundedRect(52, 52, 920, 920, 210, [8, 36, 91, 255]);
drawText("ARK", SIZE / 2, 300, 46, 34, [255, 255, 255, 255]);
drawText("CLIENT CENTER", SIZE / 2, 630, 13, 8, [220, 230, 247, 255]);

const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
for (let y = 0; y < SIZE; y += 1) {
  const rowStart = y * (SIZE * 4 + 1);
  raw[rowStart] = 0;
  pixels.copy(raw, rowStart + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
}

const header = Buffer.alloc(13);
header.writeUInt32BE(SIZE, 0);
header.writeUInt32BE(SIZE, 4);
header[8] = 8;
header[9] = 6;
header[10] = 0;
header[11] = 0;
header[12] = 0;

const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk("IHDR", header),
  chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, png);
console.log(`Generated iOS app icon: ${path.relative(projectRoot, outputPath)}`);
