import sharp from "sharp";
import type { Format } from "./index.ts";
import { planesOf } from "./pixels.ts";
import { type Prepared, prepare, score } from "./ssimulacra2.ts";

/** Quality settings tried by the search, per format. Outside these the search gives up. */
export const RANGE: Record<Format, [number, number]> = { avif: [10, 90], webp: [20, 95] };

/** Raw 8-bit sRGB pixels of one output size: the image the encodes are judged against. */
export type Reference = {
  data: Buffer;
  width: number;
  height: number;
  channels: 3 | 4;
  /** One prepared view per background; transparent images are judged on light and dark. */
  views: { background?: string; prepared: Prepared }[];
};

export type Encoded = { data: Buffer; width: number; height: number; quality: number; score?: number };

/** `scored` false skips the metric's setup, for fixed-quality runs. */
export async function reference(img: ReturnType<typeof sharp>, scored: boolean): Promise<Reference> {
  const { data, info } = await img.toColourspace("srgb").raw().toBuffer({ resolveWithObject: true });
  const channels = info.channels as 3 | 4;
  const ref: Reference = { data, width: info.width, height: info.height, channels, views: [] };
  // The metric needs 8x8. Smaller images keep the fixed quality.
  if (!scored || info.width < 8 || info.height < 8) return ref;
  const backgrounds = channels === 4 ? ["#ffffff", "#000000"] : [undefined];
  for (const background of backgrounds) {
    ref.views.push({ background, prepared: prepare(await planesOf(raw(ref), { background })) });
  }
  return ref;
}

function raw(ref: Reference) {
  return sharp(ref.data, { raw: { width: ref.width, height: ref.height, channels: ref.channels } });
}

export async function encodeAt(ref: Reference, format: Format, quality: number, effort: number): Promise<Encoded> {
  const img = raw(ref);
  const data =
    format === "avif"
      ? await img.avif({ quality, effort }).toBuffer()
      : await img.webp({ quality, effort, smartSubsample: true }).toBuffer();
  return { data, width: ref.width, height: ref.height, quality };
}

/** SSIMULACRA2 of an encode against the reference; the worst background counts. */
export async function judge(ref: Reference, data: Buffer) {
  let worst = Infinity;
  for (const v of ref.views) {
    worst = Math.min(worst, score(v.prepared, await planesOf(data, { background: v.background })));
  }
  return worst;
}

/**
 * The lowest quality whose score reaches `target`, by bisection. Scores rise with quality
 * nearly always; where they don't, this still lands on a quality that passes next to one
 * that fails. When even the top of the range misses, the top is used.
 *
 * `hint` (say, the answer at another width) is tried first to narrow the range.
 */
export async function search(
  ref: Reference,
  format: Format,
  target: number,
  effort: number,
  hint?: number,
): Promise<Encoded & { tries: number }> {
  const tried = new Map<number, Encoded & { score: number }>();
  const at = async (q: number) => {
    let e = tried.get(q);
    if (!e) {
      const enc = await encodeAt(ref, format, q, effort);
      e = { ...enc, score: await judge(ref, enc.data) };
      tried.set(q, e);
    }
    return e;
  };
  let [lo, hi] = RANGE[format];
  if (hint !== undefined && hint > lo && hint < hi) {
    if ((await at(hint)).score >= target) hi = hint;
    else lo = hint + 1;
  }
  if (hi === RANGE[format][1] && (await at(hi)).score < target) return { ...(await at(hi)), tries: tried.size };
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((await at(mid)).score >= target) hi = mid;
    else lo = mid + 1;
  }
  return { ...(await at(hi)), tries: tried.size };
}
