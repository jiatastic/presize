import { existsSync, realpathSync } from "node:fs";
import { cp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { Manifest } from "./manifest.ts";

export type PresizeNextOptions = {
  /** Folder of source images. Default "public". */
  input?: string;
  /** Where the copies go; must be inside public/. Default "public/_presize". */
  out?: string;
  /** Widths to make, each capped at the image's own width. Default [256, 640, 1080, 1920]. */
  widths?: number[];
  /** SSIMULACRA2 score each copy must reach, or false for a fixed `quality`. Default 80. */
  target?: number | false;
  /** WebP quality when `target` is false. Default 75. */
  quality?: number;
  /** WebP effort, 0 to 6. Default 4. */
  effort?: number;
  concurrency?: number;
  /** Keep a copy of the output in .next/cache, so CI builds only encode new images. Default: on in CI. */
  cache?: boolean;
};

export type LoaderData = {
  base: string;
  prefix: string;
  /** "/photos/a.jpg" → "<hash8> <width> <width> … [o<width>]", smallest first. */
  images: Record<string, string>;
};

// biome-ignore lint/suspicious/noExplicitAny: a Next config has many shapes
type Config = Record<string, any>;
// biome-ignore lint/suspicious/noExplicitAny: Next passes { defaultConfig }
type ConfigFn<C> = (phase: string, ctx: any) => C | Promise<C>;

const BUILD = "phase-production-build";
const ENV = "PRESIZE_NEXT";
/** Set once a build process has encoded, so the workers Next starts don't encode again. */
const DONE = "PRESIZE_NEXT_DONE";

export function withPresize<C extends Config>(config: C | ConfigFn<C> = {} as C, options: PresizeNextOptions = {}) {
  // biome-ignore lint/suspicious/noExplicitAny: see ConfigFn
  return async (phase: string, ctx: any): Promise<C> => {
    const user = typeof config === "function" ? await config(phase, ctx) : config;
    const input = path.resolve(options.input ?? "public");
    const out = path.resolve(options.out ?? "public/_presize");
    const served = path.relative(path.resolve("public"), out);
    if (served.startsWith("..") || path.isAbsolute(served) || !served) {
      throw new Error(`presize: out must be a folder inside public/, got ${options.out}`);
    }
    const url = `/${served.split(path.sep).join("/")}`;
    const basePath: string = user.basePath ?? "";

    if (phase === BUILD && !process.env[DONE]) {
      await encode(input, out, url, path.resolve(user.distDir ?? ".next", "cache", "presize"), options);
      process.env[DONE] = "1";
    }
    const manifest = await readManifest(out);
    const data = loaderData(manifest, basePath, `${basePath}${url}`);
    return withImages(user, data, options.widths ?? DEFAULT_WIDTHS, `${url}/:path*`) as C;
  };
}

const DEFAULT_WIDTHS = [256, 640, 1080, 1920];

async function encode(input: string, out: string, url: string, cache: string, o: PresizeNextOptions) {
  const useCache = o.cache ?? Boolean(process.env.CI || process.env.VERCEL);
  if (useCache && !existsSync(path.join(out, "presize.json")) && existsSync(path.join(cache, "presize.json"))) {
    await cp(cache, out, { recursive: true });
  }
  const { presize } = await import("./index.ts");
  const started = Date.now();
  let last = started;
  const target = o.target === undefined ? 80 : o.target === false ? undefined : o.target;
  const result = await presize({
    input,
    out,
    base: url,
    widths: o.widths ?? DEFAULT_WIDTHS,
    formats: ["webp"],
    target,
    quality: o.quality === undefined ? undefined : { webp: o.quality },
    effort: o.effort === undefined ? undefined : { webp: o.effort },
    concurrency: o.concurrency,
    onImage: ({ done, total, status, file, error }) => {
      if (status === "failed") console.warn(`presize: ${file} failed, served as is: ${error}`);
      if (Date.now() - last > 5000) {
        last = Date.now();
        console.log(`presize: ${done}/${total} images`);
      }
    },
  });
  console.log(
    `presize: ${result.made} encoded, ${result.kept} unchanged, ${result.failed.length} failed` +
      ` in ${((Date.now() - started) / 1000).toFixed(1)}s`,
  );
  if (useCache) {
    await rm(cache, { recursive: true, force: true });
    await cp(out, cache, { recursive: true });
  }
}

async function readManifest(out: string): Promise<Manifest | null> {
  try {
    const m = JSON.parse(await readFile(path.join(out, "presize.json"), "utf8")) as Manifest;
    return m.version === 1 ? m : null;
  } catch {
    return null;
  }
}

export function loaderData(manifest: Manifest | null, base: string, prefix: string): LoaderData {
  const images: Record<string, string> = {};
  for (const [key, e] of Object.entries(manifest?.images ?? {})) {
    if (/\.gif$/i.test(key)) continue;
    const widths = (e.sources.webp ?? []).map((v) => String(v.width));
    if (e.original && !e.sources.webp?.some((v) => v.width === e.original?.width)) widths.push(`o${e.original.width}`);
    if (widths.length) images[`/${key}`] = [e.hash.slice(0, 8), ...widths].join(" ");
  }
  return { base, prefix, images };
}

function withImages(user: Config, data: LoaderData, widths: number[], cached: string): Config {
  const images = { ...user.images };
  const loaderFile = loaderPath();
  if (images.loaderFile && path.resolve(images.loaderFile) !== path.resolve(loaderFile)) {
    throw new Error(`presize: images.loaderFile is already set (${images.loaderFile}); withPresize sets its own`);
  }
  if (images.loader && images.loader !== "custom" && images.loader !== "default") {
    throw new Error(`presize: images.loader is "${images.loader}"; withPresize needs it to be its own custom loader`);
  }
  const sorted = [...new Set(widths)].sort((a, b) => a - b);
  const device = sorted.filter((w) => w >= 640);
  const deviceSizes = device.length ? device : sorted.slice(-1);
  return {
    ...user,
    env: { ...user.env, [ENV]: JSON.stringify(data) },
    images: {
      deviceSizes,
      imageSizes: sorted.filter((w) => !deviceSizes.includes(w)),
      ...images,
      loader: "custom",
      loaderFile,
      unoptimized: false,
    },
    ...(user.output === "export"
      ? {}
      : {
          async headers() {
            const own = (await user.headers?.()) ?? [];
            const immutable = [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }];
            return [...own, { source: cached, headers: immutable }];
          },
        }),
  };
}

function loaderPath() {
  const linked = path.join("node_modules", "presize", "dist", "next-loader.js");
  if (existsSync(linked)) return `./${linked.split(path.sep).join("/")}`;
  const here = fileURLToPath(
    new URL(import.meta.url.endsWith(".ts") ? "./next-loader.ts" : "./next-loader.js", import.meta.url),
  );
  const rel = path.relative(process.cwd(), realpathSync(here));
  // On Windows, a loader on another drive has no relative path.
  if (path.isAbsolute(rel)) throw new Error(`presize: install presize inside the project; found it at ${here}`);
  return `./${rel.split(path.sep).join("/")}`;
}
