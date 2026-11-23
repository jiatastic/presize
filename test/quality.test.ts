import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import sharp from "sharp";
import { type Manifest, presize } from "../src/index.ts";
import { encodeAt, judge, RANGE, reference, search } from "../src/quality.ts";

const photo = () =>
  sharp({ create: { width: 160, height: 120, channels: 3, noise: { type: "gaussian", mean: 128, sigma: 40 } } })
    .blur(2)
    .composite([
      { input: Buffer.from('<svg width="160" height="120"><text x="8" y="60" font-size="28">Sale 40%</text></svg>') },
    ])
    .png();

test("search finds the lowest quality that reaches the target", async () => {
  const ref = await reference(sharp(await photo().toBuffer()), true);
  for (const format of ["avif", "webp"] as const) {
    const got = await search(ref, format, 75, 4);
    assert.ok(got.score! >= 75 || got.quality === RANGE[format][1], `${format} q${got.quality} scored ${got.score}`);
    if (got.quality > RANGE[format][0]) {
      const below = await encodeAt(ref, format, got.quality - 1, 4);
      assert.ok((await judge(ref, below.data)) < 75, `${format} q${got.quality - 1} also passes`);
    }
  }
});

test("a higher target never picks a lower quality", async () => {
  const ref = await reference(sharp(await photo().toBuffer()), true);
  const low = await search(ref, "avif", 60, 4);
  const high = await search(ref, "avif", 85, 4);
  assert.ok(high.quality >= low.quality, `${high.quality} >= ${low.quality}`);
});

test("transparent images are judged on light and dark", async () => {
  const png = await sharp({
    create: { width: 64, height: 64, channels: 4, background: { r: 200, g: 30, b: 30, alpha: 0.5 } },
  })
    .png()
    .toBuffer();
  const ref = await reference(sharp(png), true);
  assert.equal(ref.views.length, 2);
});

test("presize records quality and score per file with a target", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "presize-"));
  try {
    await mkdir(path.join(dir, "in"));
    await writeFile(path.join(dir, "in", "a.png"), await photo().toBuffer());
    await writeFile(
      path.join(dir, "in", "dot.png"),
      await sharp({ create: { width: 4, height: 4, channels: 3, background: "#09f" } })
        .png()
        .toBuffer(),
    );
    const res = await presize({
      input: path.join(dir, "in"),
      out: path.join(dir, "out"),
      widths: [80, 160],
      target: 70,
      concurrency: 2,
    });
    assert.equal(res.failed.length, 0, JSON.stringify(res.failed));
    const m = JSON.parse(await readFile(path.join(dir, "out", "presize.json"), "utf8")) as Manifest;
    for (const v of [...m.images["a.png"]!.sources.avif!, ...m.images["a.png"]!.sources.webp!]) {
      assert.ok(typeof v.quality === "number" && typeof v.score === "number", JSON.stringify(v));
    }
    // Too small to score: fixed quality, no score.
    const dot = m.images["dot.png"]!;
    for (const v of Object.values(dot.sources).flat()) assert.equal(v!.score, undefined);
    // A second run reuses everything.
    const again = await presize({
      input: path.join(dir, "in"),
      out: path.join(dir, "out"),
      widths: [80, 160],
      target: 70,
    });
    assert.equal(again.kept, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
