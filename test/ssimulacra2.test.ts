import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { planesOf } from "../src/pixels.ts";
import { prepare, score, ssimulacra2 } from "../src/ssimulacra2.ts";

const fixture = (f: string) => fileURLToPath(new URL(`./fixtures/${f}`, import.meta.url));

// The Rust crate's test images. tank_*.png are 6.6 MB, so they're not in this repo: get them
// from rust-av/ssimulacra2 (ssimulacra2/test_data) and set PRESIZE_TANK to their folder.
const TANK = process.env.PRESIZE_TANK;

test("matches the Rust crate on its reference pair", {
  skip: !TANK || !existsSync(path.join(TANK, "tank_source.png")),
}, async () => {
  // The crate expects 17.398505 and allows 0.25 (its CI wobbles). The distorted file carries
  // a non-sRGB profile that the crate ignores, so this reads it the same way.
  const s = ssimulacra2(
    await planesOf(path.join(TANK!, "tank_source.png"), { ignoreIcc: true }),
    await planesOf(path.join(TANK!, "tank_distorted.png"), { ignoreIcc: true }),
  );
  assert.ok(Math.abs(s - 17.398505) < 0.005, `got ${s}`);
});

test("stays near the crate on a tiny pair", async () => {
  // ssimulacra2_bin expects 95.30053. At 64x64 the coarsest scales are 8 and 4 pixels wide,
  // where rounding differences between implementations move the score more.
  const s = ssimulacra2(await planesOf(fixture("untagged.png")), await planesOf(fixture("untagged_distorted.png")));
  assert.ok(Math.abs(s - 95.30053) < 0.05, `got ${s}`);
});

test("identical images score 100", async () => {
  const p = await planesOf(fixture("untagged.png"));
  assert.equal(ssimulacra2(p, p), 100);
});

test("more compression scores lower", async () => {
  const src = await sharp({
    create: { width: 96, height: 96, channels: 3, background: "#fff" },
  })
    .composite([
      {
        input: Buffer.from(
          '<svg width="96" height="96"><text x="4" y="40" font-size="22">Hello</text><circle cx="60" cy="70" r="18" fill="#c33"/></svg>',
        ),
      },
    ])
    .png()
    .toBuffer();
  const ref = prepare(await planesOf(src));
  const at = async (q: number) => score(ref, await planesOf(await sharp(src).jpeg({ quality: q }).toBuffer()));
  const [hi, mid, lo] = [await at(95), await at(60), await at(15)];
  assert.ok(hi > mid && mid > lo, `${hi} > ${mid} > ${lo}`);
});

test("refuses images smaller than 8x8", () => {
  const tiny = { width: 4, height: 4, r: new Float32Array(16), g: new Float32Array(16), b: new Float32Array(16) };
  assert.throws(() => prepare(tiny));
});
