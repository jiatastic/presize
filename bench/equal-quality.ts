// Equal-quality comparison on a folder of images, at one output width:
//   - a sweep of fixed qualities: bytes and the score each file actually got
//   - per-image search for each target score: bytes and the quality chosen
// node bench/equal-quality.ts <dir> <out.jsonl> [--every 12] [--width 640] [--targets 70,80] [--shard 0/4]
import { appendFile, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import sharp from "sharp";
import { encodeAt, judge, reference, search } from "../src/quality.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { every: { type: "string" }, width: { type: "string" }, targets: { type: "string" }, shard: { type: "string" } },
});
const [dir, out] = positionals as [string, string];
const every = Number(values.every ?? 12);
const width = Number(values.width ?? 640);
const targets = (values.targets ?? "70,80").split(",").map(Number);
const [k, n] = (values.shard ?? "0/1").split("/").map(Number) as [number, number];

const SWEEP = [["avif", [30, 40, 50, 60, 70, 80]], ["webp", [50, 60, 75, 85, 90, 95]]] as const;

const files: string[] = [];
const walk = async (d: string) => {
  for (const f of await readdir(d, { withFileTypes: true })) {
    const p = path.join(d, f.name);
    if (f.isDirectory()) await walk(p);
    else if (/\.(png|jpe?g|webp|gif)$/i.test(f.name)) files.push(p);
  }
};
await walk(dir);
files.sort();
const sample = files.filter((_, i) => i % every === 0).filter((_, i) => i % n === k);

for (const file of sample) {
  const buf = await readFile(file);
  let img = sharp(buf, { failOn: "none" }).rotate();
  const meta = await sharp(buf).metadata();
  if ((meta.width ?? 0) > width) img = img.resize({ width, kernel: "lanczos3" });
  const t0 = performance.now();
  const ref = await reference(img, true);
  if (!ref.views.length) continue;
  const row: Record<string, unknown> = { file: path.relative(dir, file), w: ref.width, h: ref.height, alpha: ref.channels === 4 };
  for (const [format, qs] of SWEEP) {
    for (const q of qs) {
      const e = await encodeAt(ref, format, q, 4);
      row[`${format}_q${q}`] = { q, bytes: e.data.length, score: await judge(ref, e.data) };
    }
  }
  for (const t of targets) {
    for (const format of ["avif", "webp"] as const) {
      const s = Date.now();
      const e = await search(ref, format, t, 4);
      row[`${format}_t${t}`] = { q: e.quality, bytes: e.data.length, score: e.score, tries: e.tries, ms: Date.now() - s };
    }
  }
  row.ms = Math.round(performance.now() - t0);
  await appendFile(out, JSON.stringify(row) + "\n");
}
