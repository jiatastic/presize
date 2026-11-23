// Summarizes equal-quality.ts output. node bench/report.ts <file.jsonl>...
// [--min-px N] keeps only images of at least N pixels at the output width.
import { readFile } from "node:fs/promises";

type Cell = { q: number; bytes: number; score: number; tries?: number; ms?: number };
type Row = Record<string, Cell> & { file: string; w: number; h: number; ms: number };

const args = process.argv.slice(2);
const mi = args.indexOf("--min-px");
const minPx = mi >= 0 ? Number(args.splice(mi, 2)[1]) : 0;
let rows: Row[] = [];
for (const f of args) for (const line of (await readFile(f, "utf8")).split("\n")) if (line) rows.push(JSON.parse(line));
rows = rows.filter((r) => r.w * r.h >= minPx);

const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))]!;
const kib = (b: number) => `${(b / 1024).toFixed(0)} KiB`.padStart(9);
const sum = (k: string) => rows.reduce((s, r) => s + r[k]!.bytes, 0);
const keys = (re: RegExp) => Object.keys(rows[0]!).filter((k) => re.test(k));
const targets = [...new Set(keys(/_t\d+$/).map((k) => Number(k.split("_t")[1])))];

console.log(`${rows.length} images${minPx ? ` of ≥${minPx} px` : ""}, median ${pct(rows.map((r) => r.w * r.h), 0.5)} px\n`);

for (const f of ["avif", "webp"]) {
  console.log(`${f.toUpperCase()}  fixed quality: bytes, and the score each file actually got`);
  const fixed = keys(new RegExp(`^${f}_q\\d+$`));
  for (const k of fixed) {
    const s = rows.map((r) => r[k]!.score);
    console.log(`  q${String(rows[0]![k]!.q).padEnd(3)} ${kib(sum(k))}   min ${Math.min(...s).toFixed(1).padStart(5)}  p5 ${pct(s, 0.05).toFixed(1).padStart(5)}  p10 ${pct(s, 0.1).toFixed(1).padStart(5)}  median ${pct(s, 0.5).toFixed(1)}`);
  }
  console.log(`${f.toUpperCase()}  searched per image: every file reaches the target`);
  for (const t of targets) {
    const k = `${f}_t${t}`;
    const q = rows.map((r) => r[k]!.q);
    const s = rows.map((r) => r[k]!.score);
    const missed = rows.filter((r) => r[k]!.score < t).length;
    const ms = rows.reduce((a, r) => a + (r[k]!.ms ?? 0), 0) / rows.length;
    const tries = rows.reduce((a, r) => a + (r[k]!.tries ?? 0), 0) / rows.length;
    // The cheapest fixed quality whose p5 also reaches t, i.e. what a fixed setting must spend
    // to get 95% of files to the same floor.
    const match = fixed.find((fk) => pct(rows.map((r) => r[fk]!.score), 0.05) >= t);
    const vs = match ? `  vs fixed q${rows[0]![match]!.q} (p5 ≥ ${t}) ${kib(sum(match)).trim()}: ${(((sum(k) - sum(match)) / sum(match)) * 100).toFixed(0)}%` : "  (no fixed quality in the sweep gets p5 there)";
    console.log(`  t${t} ${kib(sum(k))}   median ${pct(s, 0.5).toFixed(1)}  q ${pct(q, 0.1)}–${pct(q, 0.9)} (p10–p90)  ${tries.toFixed(1)} tries ${ms.toFixed(0)} ms${missed ? `  ${missed} can't reach` : ""}${vs}`);
  }
  console.log();
}
console.log("Equal quality, AVIF vs WebP bytes (searched):");
for (const t of targets) console.log(`  t${t}: AVIF ${((sum(`avif_t${t}`) / sum(`webp_t${t}`)) * 100).toFixed(0)}% of WebP`);
