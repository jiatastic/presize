#!/usr/bin/env node
import { parseArgs } from "node:util";
import { type Format, type Manifest, presize, resolve } from "./index.ts";

const HELP = `presize <input> --out <dir> [options]

Makes AVIF and WebP copies of every image in <input> at the widths you show them,
and writes <out>/presize.json with srcset data and a ThumbHash placeholder per image.
Unchanged images are skipped on the next run.

  --out <dir>          where files and presize.json go (required)
  --display <px>       CSS width the images are shown at; outputs 1x and 2x
  --dpr <list>         pixel ratios for --display (default 1,2)
  --widths <list>      exact pixel widths instead, e.g. 320,640 (default 640,1280)
  --formats <list>     avif,webp (default both)
  --quality <list>     fixed quality, e.g. avif=50,webp=75 (the defaults)
  --target <score>     instead pick the lowest quality per image that reaches this
                       SSIMULACRA2 score (90 visually lossless, 70 high quality); slower
  --base <url>         URL prefix for src (inferred when --out is in ./public)
  --concurrency <n>    images at once (default a quarter of the cores, half with --target)
  --quiet              only the summary
`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: "string", short: "o" },
    display: { type: "string" },
    dpr: { type: "string" },
    widths: { type: "string", short: "w" },
    formats: { type: "string", short: "f" },
    quality: { type: "string", short: "q" },
    target: { type: "string", short: "t" },
    base: { type: "string" },
    concurrency: { type: "string", short: "c" },
    quiet: { type: "boolean" },
    help: { type: "boolean", short: "h" },
  },
});

const input = positionals[0];
if (values.help || !input || !values.out) {
  process.stdout.write(HELP);
  process.exit(values.help ? 0 : 1);
}

const nums = (s?: string) => s?.split(",").map((x) => Number(x.trim()));
const formats = values.formats?.split(",").map((f) => f.trim()) as Format[] | undefined;
for (const f of formats ?? []) {
  if (f !== "avif" && f !== "webp") fail(`Unknown format: ${f}`);
}
const quality: Partial<Record<Format, number>> = {};
for (const pair of values.quality?.split(",") ?? []) {
  const [f, q] = pair.split("=");
  if ((f !== "avif" && f !== "webp") || !(Number(q) >= 1 && Number(q) <= 100)) fail(`Bad --quality: ${pair}`);
  quality[f as Format] = Number(q);
}

const options = {
  input,
  out: values.out,
  widths: nums(values.widths),
  display: values.display ? Number(values.display) : undefined,
  dpr: nums(values.dpr),
  formats,
  quality,
  target: values.target ? Number(values.target) : undefined,
  base: values.base,
  concurrency: values.concurrency ? Number(values.concurrency) : undefined,
};

let r: ReturnType<typeof resolve>;
try {
  r = resolve(options);
} catch (e) {
  fail(e instanceof Error ? e.message : String(e));
}
if (!values.quiet) {
  const q =
    r.target !== undefined ? `target score ${r.target}` : r.formats.map((f) => `${f} q${r.quality[f]}`).join(", ");
  console.log(`widths ${r.widths.join(", ")} · ${r.formats.join(" + ")} · ${q} · base "${r.base || "(none)"}"`);
}

const started = Date.now();
const result = await presize({
  ...options,
  onImage: ({ file, done, total, status, error }) => {
    if (status === "failed") console.error(`  failed ${file}: ${error}`);
    else if (!values.quiet && status === "made" && process.stdout.isTTY) {
      process.stdout.write(`\r  ${done}/${total} ${file.slice(-60).padEnd(60)}`);
    }
  },
});
if (process.stdout.isTTY && !values.quiet) process.stdout.write(`\r${" ".repeat(80)}\r`);

summary(result.manifest, r.formats);
console.log(
  `${result.made} made, ${result.kept} unchanged, ${result.failed.length} failed, ${result.removed} old files removed · ${((Date.now() - started) / 1000).toFixed(1)}s`,
);
process.exit(result.failed.length ? 1 : 0);

function summary(m: Manifest, fs: Format[]) {
  const entries = Object.values(m.images);
  const src = entries.reduce((s, e) => s + e.bytes, 0);
  console.log(`${entries.length} images, ${mb(src)} as sources`);
  for (const f of fs) {
    const parts = r.widths.map((w) => {
      const b = entries.reduce((s, e) => {
        const v = e.sources[f]?.find((x) => x.width === Math.min(w, e.width));
        return s + (v?.bytes ?? e.original?.bytes ?? 0);
      }, 0);
      return `${w}w ${mb(b)} (${((b / src) * 100).toFixed(1)}%)`;
    });
    console.log(`  ${f.padEnd(4)}  ${parts.join("  ")}${qualities(entries, f)}`);
  }
}

function qualities(entries: Manifest["images"][string][], f: Format) {
  const vs = entries.flatMap((e) => e.sources[f] ?? []).filter((v) => v.score !== undefined);
  if (!vs.length) return "";
  const med = (xs: number[]) => xs.sort((a, b) => a - b)[xs.length >> 1]!;
  return `  · median q${med(vs.map((v) => v.quality!))}, score ${med(vs.map((v) => v.score!)).toFixed(1)}`;
}

function mb(b: number) {
  return b >= 1 << 20 ? `${(b / (1 << 20)).toFixed(1)} MiB` : `${(b / 1024).toFixed(0)} KiB`;
}

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}
