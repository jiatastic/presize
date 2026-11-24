import sharp from "sharp";
import { linearPlanes, type Planes } from "./ssimulacra2.ts";

type Sharp = ReturnType<typeof sharp>;

export async function planesOf(
  input: Buffer | string | Sharp,
  opts: { background?: string; ignoreIcc?: boolean } = {},
): Promise<Planes> {
  let img =
    typeof input === "string" || Buffer.isBuffer(input)
      ? sharp(input, { failOn: "none", ignoreIcc: opts.ignoreIcc })
      : input;
  if (opts.background) img = img.flatten({ background: opts.background });
  // libvips widens 8-bit by ×256 (white = 65280), and raw({ depth }) alone drops to 8 bits.
  const deep = (await img.clone().metadata()).depth === "ushort";
  img = img.removeAlpha();
  const { data, info } = deep
    ? await img.toColourspace("rgb16").raw({ depth: "ushort" }).toBuffer({ resolveWithObject: true })
    : await img.toColourspace("srgb").raw().toBuffer({ resolveWithObject: true });
  const px = deep ? new Uint16Array(data.buffer, data.byteOffset, data.length / 2) : data;
  return linearPlanes(px, info.width, info.height, info.channels);
}
