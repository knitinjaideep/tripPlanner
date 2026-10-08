/**
 * Builds the web copies of the Atlas backgrounds. Originals live (untouched)
 * in assets/backgrounds-src/ as <id>.jpg + <id>-thumb.jpg; this writes real
 * WebP conversions to public/backgrounds/ (1920 px wide photo, 480 px thumb)
 * and prints per-image luminance stats used to pick the registry overlays.
 *
 *   node scripts/optimize-backgrounds.mjs
 */
import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const src = path.resolve("assets/backgrounds-src");
const out = path.resolve("public/backgrounds");
await mkdir(out, { recursive: true });

const stems = (await readdir(src)).filter((f) => f.endsWith(".jpg") && !f.endsWith("-thumb.jpg")).map((f) => f.replace(/\.jpg$/, ""));
for (const stem of stems) {
  const input = path.join(src, `${stem}.jpg`);
  const full = await sharp(input).resize({ width: 1920, withoutEnlargement: true }).webp({ quality: 76, effort: 6 }).toFile(path.join(out, `${stem}.webp`));
  const thumb = await sharp(input).resize({ width: 480, height: 270, fit: "cover" }).webp({ quality: 72, effort: 6 }).toFile(path.join(out, `${stem}-thumb.webp`));
  // Mean luminance overall and per horizontal third (left / centre / right), 0-255.
  const { data, info } = await sharp(input).resize(96, 54).greyscale().raw().toBuffer({ resolveWithObject: true });
  const third = (i) => {
    let s = 0, n = 0;
    for (let y = 0; y < info.height; y++) for (let x = Math.floor((info.width * i) / 3); x < Math.floor((info.width * (i + 1)) / 3); x++) { s += data[y * info.width + x]; n++; }
    return Math.round(s / n);
  };
  const mean = Math.round(data.reduce((a, b) => a + b, 0) / data.length);
  const min = Math.min(...data), max = Math.max(...data);
  console.log(`${stem.padEnd(16)} full ${(full.size / 1024).toFixed(0)}KB thumb ${(thumb.size / 1024).toFixed(0)}KB  lum mean ${mean} L/C/R ${third(0)}/${third(1)}/${third(2)} min ${min} max ${max}`);
}
