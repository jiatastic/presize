import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { type Entry, picture, pictureSources } from "../src/manifest.ts";

const v = (width: number, format: string) => ({
  width,
  height: width / 2,
  src: `/img/a.${width}.${format}`,
  file: `a.${width}.${format}`,
  bytes: 1,
});

test("presize/manifest imports nothing at runtime", async () => {
  const src = await readFile(new URL("../src/manifest.ts", import.meta.url), "utf8");
  assert.deepEqual(src.match(/^\s*(import|export .* from)\b(?!\s+type\b).*$/gm), null);
});

test("pictureSources offers AVIF only when it has the full size", () => {
  const full: Entry = {
    width: 640,
    height: 320,
    bytes: 9,
    hash: "h",
    thumbhash: "t",
    sources: { avif: [v(320, "avif"), v(640, "avif")], webp: [v(320, "webp"), v(640, "webp")] },
  };
  assert.deepEqual(pictureSources(full), {
    avif: "/img/a.320.avif 320w, /img/a.640.avif 640w",
    srcset: "/img/a.320.webp 320w, /img/a.640.webp 640w",
    src: "/img/a.640.webp",
  });
  const kept: Entry = {
    ...full,
    original: { ...v(640, "png") },
    sources: { avif: [v(320, "avif")], webp: [v(320, "webp")] },
  };
  const p = pictureSources(kept);
  assert.equal(p.avif, null);
  assert.equal(p.src, "/img/a.640.png");
  assert.match(picture(kept, { alt: 'a "b"', sizes: "320px" }), /alt="a &quot;b&quot;"/);
});

test("srcset never lists a width twice", () => {
  const e: Entry = {
    width: 64,
    height: 32,
    bytes: 9,
    hash: "h",
    thumbhash: "t",
    sources: { webp: [v(64, "webp")] },
    original: v(64, "png"),
  };
  assert.equal(pictureSources(e).srcset, "/img/a.64.webp 64w");
});
