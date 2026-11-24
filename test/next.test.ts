import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { Entry, Manifest } from "../src/manifest.ts";
import { loaderData, withPresize } from "../src/next.ts";

const v = (width: number, file: string) => ({ width, height: width, src: `/_presize/${file}`, file, bytes: 1 });
const entry = (e: Partial<Entry>): Entry => ({
  width: 1000,
  height: 1000,
  bytes: 9,
  hash: "abcdef0123456789",
  thumbhash: "t",
  sources: {},
  ...e,
});

const manifest: Manifest = {
  version: 1,
  settings: "s",
  images: {
    "photos/a b.jpg": entry({ sources: { webp: [v(640, "x"), v(1000, "y")] } }),
    "logo.png": entry({ width: 300, sources: { webp: [v(256, "z")] }, original: v(300, "o") }),
    "spin.gif": entry({ sources: { webp: [v(640, "g")] } }),
  },
};

test("loaderData keeps what the loader needs", () => {
  assert.deepEqual(loaderData(manifest, "", "/_presize").images, {
    "/photos/a b.jpg": "abcdef01 640 1000",
    "/logo.png": "abcdef01 256 o300",
  });
});

test("the loader picks the smallest copy at least as wide as asked for", async () => {
  process.env.PRESIZE_NEXT = JSON.stringify(loaderData(manifest, "/docs", "/docs/_presize"));
  const { default: load } = await import("../src/next-loader.ts");
  const at = (src: string, width: number) => load({ src, width });
  assert.equal(at("/docs/photos/a%20b.jpg", 300), "/docs/_presize/photos/a%20b.abcdef01.640.webp");
  assert.equal(at("/photos/a b.jpg?v=2", 800), "/docs/_presize/photos/a%20b.abcdef01.1000.webp");
  assert.equal(at("/photos/a b.jpg", 4000), "/docs/_presize/photos/a%20b.abcdef01.1000.webp");
  assert.equal(at("/logo.png", 128), "/docs/_presize/logo.abcdef01.256.webp");
  // Wider than any WebP: the source itself, with a dev-only fragment so Next doesn't warn.
  assert.equal(at("/logo.png", 640), "/logo.png#w=640");
  assert.equal(at("https://cdn.example.com/a.jpg", 640), "https://cdn.example.com/a.jpg#w=640");
});

test("withPresize sets up next/image and keeps the user's config", async () => {
  // Inside the repository, so the loader has a relative path from it (the system temp folder
  // can be on another drive on Windows).
  const tmp = new URL("../node_modules/.cache/", import.meta.url);
  await mkdir(tmp, { recursive: true });
  const dir = await mkdtemp(path.join(fileURLToPath(tmp), "presize-next-"));
  const cwd = process.cwd();
  try {
    process.chdir(dir);
    await mkdir("public/_presize", { recursive: true });
    await writeFile("public/_presize/presize.json", JSON.stringify(manifest));
    const config = await withPresize(
      { basePath: "/docs", reactStrictMode: true, images: { remotePatterns: [] } },
      { widths: [256, 640, 1080] },
    )("phase-development-server", {});
    assert.equal(config.reactStrictMode, true);
    assert.equal(config.images.loader, "custom");
    assert.deepEqual(config.images.remotePatterns, []);
    assert.deepEqual(config.images.deviceSizes, [640, 1080]);
    assert.deepEqual(config.images.imageSizes, [256]);
    assert.match(config.images.loaderFile, /^\.\/.*next-loader\.ts$/);
    assert.ok(await readFile(path.resolve(config.images.loaderFile)));
    const data = JSON.parse(config.env.PRESIZE_NEXT);
    assert.equal(data.prefix, "/docs/_presize");
    assert.equal(data.images["/logo.png"], "abcdef01 256 o300");
    assert.equal((await config.headers()).at(-1).source, "/_presize/:path*");

    await assert.rejects(
      withPresize({ images: { loaderFile: "./my-loader.ts" } })("phase-development-server", {}),
      /loaderFile is already set/,
    );
    await assert.rejects(withPresize({}, { out: "dist/img" })("phase-development-server", {}), /inside public/);
  } finally {
    process.chdir(cwd);
    await rm(dir, { recursive: true, force: true });
  }
});
