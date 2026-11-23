import sharp from "sharp";
import { linearPlanes, type Planes } from "./ssimulacra2.ts";

type Sharp = ReturnType<typeof sharp>;

/**
 * Decodes any image sharp reads to linear-light planes for scoring, at its own bit depth with
 * no color conversion beyond sharp's usual move to sRGB.
 *
 * Transparent images are flattened onto `background` first: the metric has no alpha, and what
 * matters is how the pixels look where they're shown.
 *
 * `ignoreIcc` reads the stored values as sRGB whatever the embedded profile says. Only for
 * matching reference tools that do the same; real comparisons want the profile applied.
 */
export async function planesOf(
  input: Buffer | string | Sharp,
  opts: { background?: string; ignoreIcc?: boolean } = {},
): Promise<Planes> {
  let img =
    typeof input === "string" || Buffer.isBuffer(input)
      ? sharp(input, { failOn: "none", ignoreIcc: opts.ignoreIcc })
      : input;
  if (opts.background) img = img.flatten({ background: opts.background });
  // 8-bit stays 8-bit (libvips widens to 16 bits by ×256, which puts white at 65280, not
  // 65535). 16-bit needs rgb16: `raw({ depth })` on its own quietly drops to 8 bits.
  const deep = (await img.clone().metadata()).depth === "ushort";
  img = img.removeAlpha();
  const { data, info } = deep
    ? await img.toColourspace("rgb16").raw({ depth: "ushort" }).toBuffer({ resolveWithObject: true })
    : await img.toColourspace("srgb").raw().toBuffer({ resolveWithObject: true });
  const px = deep ? new Uint16Array(data.buffer, data.byteOffset, data.length / 2) : data;
  return linearPlanes(px, info.width, info.height, info.channels);
}
