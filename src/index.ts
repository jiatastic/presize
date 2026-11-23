import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Worker } from "node:worker_threads";

export { widthsFor } from "./encode.ts";

export type Format = "avif" | "webp";

export type Options = {
  /** Folder of source images. Read only. */
  input: string;
  /** Folder for the generated files and presize.json. */
  out: string;
  /** Exact output widths in pixels. Overrides `display`. */
  widths?: number[];
  /** Width the image is shown at, in CSS pixels. Outputs one file per `dpr`. */
  display?: number;
  /** Device pixel ratios for `display`. Default [1, 2]. */
  dpr?: number[];
  formats?: Format[];
  /** Fixed quality per format. Used when there's no `target`, and for images under 8x8. */
  quality?: Partial<Record<Format, number>>;
  /**
   * SSIMULACRA2 score each file must reach (90 ≈ visually lossless, 70 ≈ high quality). Each
   * image and width then gets the lowest quality that reaches it, instead of one fixed
   * quality for all. Slower: several encodes per file.
   */
  target?: number;
  effort?: Partial<Record<Format, number>>;
  /** URL prefix for `src` in the manifest. Inferred when `out` is inside ./public. */
  base?: string;
  /** Images encoded at once, each in a worker thread. Default: a quarter of the cores, half with `target`. */
  concurrency?: number;
  onImage?: (event: { file: string; done: number; total: number; status: "made" | "kept" | "failed"; error?: string }) => void;
};

export type Variant = {
  width: number;
  height: number;
  /** URL to put in srcset: `base` + `file`. */
  src: string;
  /** Path inside the out folder. */
  file: string;
  bytes: number;
  /** Encoder quality used. Absent on a kept original. */
  quality?: number;
  /** SSIMULACRA2 against the source resized to this width, when a `target` was set. */
  score?: number;
};

export type Entry = {
  width: number;
  height: number;
  bytes: number;
  /** Content hash of the source file. */
  hash: string;
  /** Base64 ThumbHash; decode with thumbHashToDataURL from the thumbhash package. */
  thumbhash: string;
  /** Smallest width first. */
  sources: Partial<Record<Format, Variant[]>>;
  /**
   * A copy of the source, made when re-encoding it at full size came out bigger (common for
   * small PNG logos). Serve it in place of the missing full-size variants.
   */
  original?: Variant;
};

export type Manifest = {
  version: 1;
  /** Hash of the settings that produced these files. A change re-encodes everything. */
  settings: string;
  images: Record<string, Entry>;
};

export type Result = {
  manifest: Manifest;
  made: number;
  kept: number;
  failed: { file: string; error: string }[];
  removed: number;
};

export const MANIFEST = "presize.json";
/** Bump when the encoding logic changes, so old outputs are redone. */
const VERSION = "2";
const IMAGE = /\.(jpe?g|png|webp|avif|tiff?|gif)$/i;
const DEFAULT_QUALITY: Record<Format, number> = { avif: 50, webp: 75 };
const DEFAULT_EFFORT: Record<Format, number> = { avif: 4, webp: 4 };

export type Resolved = {
  input: string;
  out: string;
  widths: number[];
  formats: Format[];
  quality: Record<Format, number>;
  effort: Record<Format, number>;
  target?: number;
  base: string;
  concurrency: number;
};

export function resolve(o: Options): Resolved {
  const input = path.resolve(o.input);
  const out = path.resolve(o.out);
  const dpr = o.dpr?.length ? o.dpr : [1, 2];
  const widths = o.widths?.length
    ? o.widths
    : o.display
      ? dpr.map((d) => Math.round(o.display! * d))
      : [640, 1280];
  for (const w of widths) {
    if (!Number.isInteger(w) || w < 1) throw new Error(`Bad width: ${w}`);
  }
  if (o.target !== undefined && !(o.target > 0 && o.target < 100)) throw new Error(`Bad target: ${o.target}`);
  const formats = o.formats?.length ? o.formats : (["avif", "webp"] as Format[]);
  return {
    input,
    out,
    widths: [...new Set(widths)].sort((a, b) => a - b),
    formats,
    quality: { ...DEFAULT_QUALITY, ...o.quality },
    effort: { ...DEFAULT_EFFORT, ...o.effort },
    target: o.target,
    base: o.base ?? inferBase(out),
    // Fixed-quality runs are bound by the encoders, which use several threads each; scoring
    // runs on one thread per image, so more images at once pay off.
    concurrency: o.concurrency ?? Math.max(1, Math.floor(os.availableParallelism() / (o.target === undefined ? 4 : 2))),
  };
}

/** `public/img` under the working directory is served at `/img`. */
function inferBase(out: string) {
  const rel = path.relative(path.resolve("public"), out);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return "";
  return "/" + rel.split(path.sep).filter(Boolean).join("/");
}

export async function presize(options: Options): Promise<Result> {
  const r = resolve(options);
  const settings = hash(
    JSON.stringify({ v: VERSION, w: r.widths, f: r.formats, q: r.quality, e: r.effort, t: r.target, b: r.base }),
  );
  const previous = await readManifest(r.out);
  const files = await walk(r.input, r.out);
  const manifest: Manifest = { version: 1, settings, images: {} };
  const result: Result = { manifest, made: 0, kept: 0, failed: [], removed: 0 };

  let done = 0;
  const workers = new Workers(r.concurrency);
  try {
    await pool(files, r.concurrency, async (file) => {
      const key = toPosix(path.relative(r.input, file));
      try {
        const buf = await readFile(file);
        const h = hash(buf);
        const old = previous?.images[key];
        if (old && previous?.settings === settings && old.hash === h && (await allExist(r, old))) {
          manifest.images[key] = old;
          result.kept++;
          options.onImage?.({ file: key, done: ++done, total: files.length, status: "kept" });
          return;
        }
        manifest.images[key] = await workers.run(r, key, buf, h);
        result.made++;
        options.onImage?.({ file: key, done: ++done, total: files.length, status: "made" });
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        result.failed.push({ file: key, error });
        // Keep the last good output so a bad edit doesn't break the page.
        const old = previous?.images[key];
        if (old) manifest.images[key] = old;
        options.onImage?.({ file: key, done: ++done, total: files.length, status: "failed", error });
      }
    });
  } finally {
    await workers.close();
  }

  // Stable key order keeps the manifest diff-friendly.
  manifest.images = Object.fromEntries(
    Object.entries(manifest.images).sort(([a], [b]) => (a < b ? -1 : 1)),
  );

  // Only files an earlier run wrote, and that this run no longer uses.
  if (previous) {
    const live = new Set(Object.values(manifest.images).flatMap((e) => outputFiles(e)));
    for (const e of Object.values(previous.images)) {
      for (const rel of outputFiles(e)) {
        if (live.has(rel)) continue;
        await rm(path.join(r.out, rel), { force: true });
        result.removed++;
      }
    }
  }

  await mkdir(r.out, { recursive: true });
  const target = path.join(r.out, MANIFEST);
  await writeFile(target + ".tmp", JSON.stringify(manifest, null, 1) + "\n");
  await rename(target + ".tmp", target);
  return result;
}

/**
 * `srcset` for one format, ready for <source>. Pass no format for the <img>: WebP plus the
 * kept original, which every browser can show.
 */
export function srcset(entry: Entry, format?: Format) {
  const list = format
    ? (entry.sources[format] ?? [])
    : [...(entry.sources.webp ?? []), ...(entry.original ? [entry.original] : [])];
  return list.map((v) => `${v.src} ${v.width}w`).join(", ");
}

/** A <picture> as an HTML string: an AVIF <source>, and an <img> with WebP and the original. */
export function picture(entry: Entry, attrs: { alt: string; sizes: string; loading?: "lazy" | "eager"; class?: string }) {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  const img = entry.original ?? entry.sources.webp?.at(-1) ?? entry.sources.avif?.at(-1);
  // An AVIF source without the full size would make 2x screens settle for a smaller file.
  const avif = entry.sources.avif?.length && !entry.original ? entry.sources.avif : null;
  const sources = avif
    ? `<source type="image/avif" srcset="${esc(srcset(entry, "avif"))}" sizes="${esc(attrs.sizes)}">`
    : "";
  const fallback = srcset(entry) || srcset(entry, "avif");
  return (
    `<picture>${sources}<img src="${esc(img?.src ?? "")}" srcset="${esc(fallback)}" sizes="${esc(attrs.sizes)}"` +
    ` width="${entry.width}" height="${entry.height}" alt="${esc(attrs.alt)}" loading="${attrs.loading ?? "lazy"}" decoding="async"` +
    (attrs.class ? ` class="${esc(attrs.class)}"` : "") +
    `></picture>`
  );
}

export async function readManifest(out: string): Promise<Manifest | null> {
  try {
    const m = JSON.parse(await readFile(path.join(out, MANIFEST), "utf8")) as Manifest;
    return m.version === 1 ? m : null;
  } catch {
    return null;
  }
}

async function walk(dir: string, skip: string): Promise<string[]> {
  const found: string[] = [];
  const visit = async (d: string) => {
    if (d === skip) return;
    for (const f of await readdir(d, { withFileTypes: true })) {
      if (f.name.startsWith(".")) continue;
      const p = path.join(d, f.name);
      if (f.isDirectory()) await visit(p);
      else if (f.isFile() && IMAGE.test(f.name)) found.push(p);
    }
  };
  await visit(dir);
  return found.sort();
}

async function pool<T>(items: T[], n: number, run: (item: T) => Promise<void>) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) await run(items[i++]!);
    }),
  );
}

/** Output paths of an entry, relative to the out folder. */
function outputFiles(e: Entry): string[] {
  return [
    ...Object.values(e.sources).flatMap((list) => (list ?? []).map((v) => v.file)),
    ...(e.original ? [e.original.file] : []),
  ];
}

async function allExist(r: Resolved, e: Entry) {
  for (const rel of outputFiles(e)) {
    try {
      await stat(path.join(r.out, rel));
    } catch {
      return false;
    }
  }
  return true;
}

function hash(data: string | Buffer) {
  return createHash("sha256").update(data).digest("hex").slice(0, 16);
}

function toPosix(p: string) {
  return p.split(path.sep).join("/");
}

export type Job = { id: number; r: Resolved; key: string; buf: Uint8Array; hash: string };
export type Reply = { id: number; entry?: Entry; error?: string };

/** Up to `max` worker threads, started on first use; each takes one image at a time. */
class Workers {
  private idle: Worker[] = [];
  private waiting: ((w: Worker) => void)[] = [];
  private all = new Set<Worker>();
  private next = 0;
  private max: number;

  constructor(max: number) {
    this.max = max;
  }

  private spawn() {
    // Run from source (.ts) in development, from dist (.js) when built.
    const url = new URL(import.meta.url.endsWith(".ts") ? "./worker.ts" : "./worker.js", import.meta.url);
    const w = new Worker(url);
    this.all.add(w);
    return w;
  }

  private take() {
    const w = this.idle.pop();
    if (w) return Promise.resolve(w);
    if (this.all.size < this.max) return Promise.resolve(this.spawn());
    return new Promise<Worker>((res) => this.waiting.push(res));
  }

  private give(w: Worker) {
    const next = this.waiting.shift();
    if (next) next(w);
    else this.idle.push(w);
  }

  async run(r: Resolved, key: string, buf: Buffer, hash: string): Promise<Entry> {
    let w = await this.take();
    const id = this.next++;
    let crashed = false;
    try {
      return await new Promise<Entry>((res, rej) => {
        const onMessage = (m: Reply) => {
          if (m.id !== id) return;
          off();
          if (m.entry) res(m.entry);
          else rej(new Error(m.error ?? "Worker failed"));
        };
        const onError = (e: Error) => {
          crashed = true;
          off();
          rej(e);
        };
        const off = () => (w.off("message", onMessage), w.off("error", onError));
        w.on("message", onMessage);
        w.on("error", onError);
        const job: Job = { id, r, key, buf: new Uint8Array(buf.buffer, buf.byteOffset, buf.length), hash };
        w.postMessage(job);
      });
    } finally {
      if (crashed) {
        this.all.delete(w);
        void w.terminate();
        w = this.spawn();
      }
      this.give(w);
    }
  }

  async close() {
    await Promise.all([...this.all].map((w) => w.terminate()));
  }
}
