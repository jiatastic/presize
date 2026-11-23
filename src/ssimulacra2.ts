/**
 * SSIMULACRA 2 in plain TypeScript: a perceptual score where 100 is identical, ~90 is
 * visually lossless at normal viewing, ~70 is "high quality", ~50 is "medium".
 *
 * Ported from the `ssimulacra2` Rust crate 0.5.1 (rust-av, BSD-2-Clause; license notice in
 * THIRD_PARTY.md) and its `yuvxyb` color conversion (MIT). The metric was designed by Jon
 * Sneyers at Cloudinary; the reference is in libjxl.
 *
 * The source side is prepared once (`prepare`) and reused for every distorted candidate,
 * because a quality search compares many encodes against the same original.
 */

/** Pixels as sRGB-encoded floats in 0..1, three planes. */
export type Planes = { width: number; height: number; r: Float32Array; g: Float32Array; b: Float32Array };

const SCALES = 6;
const C2 = Math.fround(0.0009);

// ---- sRGB → linear (yuvxyb transfer.rs) ----

const SRGB_ALPHA = 1.0550107;
const SRGB_BETA = 0.0030412825;
const LUT = new Float32Array(65536);
for (let i = 0; i < LUT.length; i++) {
  const x = i / 65535;
  LUT[i] = x < 12.92 * SRGB_BETA ? x / 12.92 : Math.pow((x + (SRGB_ALPHA - 1)) / SRGB_ALPHA, 2.4);
}

/**
 * Interleaved 16-bit RGB (or 8-bit, `max` 255) to linear-light planes. 16-bit input goes
 * through a lookup table; that's exact for both depths.
 */
export function linearPlanes(data: Uint16Array | Uint8Array, width: number, height: number, channels: number): Planes {
  const n = width * height;
  const r = new Float32Array(n);
  const g = new Float32Array(n);
  const b = new Float32Array(n);
  const scale = data instanceof Uint8Array ? 257 : 1;
  for (let i = 0, j = 0; i < n; i++, j += channels) {
    r[i] = LUT[data[j]! * scale]!;
    g[i] = LUT[data[j + 1]! * scale]!;
    b[i] = LUT[data[j + 2]! * scale]!;
  }
  return { width, height, r, g, b };
}

// ---- linear RGB → XYB, then shifted to be positive (yuvxyb rgb_xyb.rs, ssimulacra2 lib.rs) ----

// All in f32, as the reference computes them.
const fr = Math.fround;
const M02 = fr(0.078), M00 = fr(0.3), M01 = fr(fr(1 - M02) - M00);
const M12 = fr(0.078), M10 = fr(0.23), M11 = fr(fr(1 - M12) - M10);
const M20 = fr(0.24342269), M21 = fr(0.20476745), M22 = fr(fr(1 - M20) - M21);
const BIAS = fr(0.0037930734);
const BIAS_CBRT = fr(Math.cbrt(BIAS));

function toXyb(p: Planes): [Float32Array, Float32Array, Float32Array] {
  const f = Math.fround;
  const n = p.width * p.height;
  const X = new Float32Array(n);
  const Y = new Float32Array(n);
  const B = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const r = p.r[i]!, g = p.g[i]!, b = p.b[i]!;
    // Fused multiply-adds: m0*r + (m1*g + (m2*b + bias)).
    const m0 = f(f(Math.cbrt(Math.max(0, f(M00 * r + f(M01 * g + f(M02 * b + BIAS)))))) - BIAS_CBRT);
    const m1 = f(f(Math.cbrt(Math.max(0, f(M10 * r + f(M11 * g + f(M12 * b + BIAS)))))) - BIAS_CBRT);
    const m2 = f(f(Math.cbrt(Math.max(0, f(M20 * r + f(M21 * g + f(M22 * b + BIAS)))))) - BIAS_CBRT);
    const x = f(0.5 * f(m0 - m1));
    const y = f(0.5 * f(m0 + m1));
    X[i] = f(x * 14 + fr(0.42));
    Y[i] = f(y + fr(0.01));
    B[i] = f(f(m2 - y) + fr(0.55));
  }
  return [X, Y, B];
}

function downscale(p: Planes): Planes {
  const w = p.width, h = p.height;
  const ow = Math.ceil(w / 2), oh = Math.ceil(h / 2);
  const out: Planes = {
    width: ow,
    height: oh,
    r: new Float32Array(ow * oh),
    g: new Float32Array(ow * oh),
    b: new Float32Array(ow * oh),
  };
  for (const c of ["r", "g", "b"] as const) {
    const src = p[c], dst = out[c];
    for (let oy = 0; oy < oh; oy++) {
      const y0 = 2 * oy, y1 = Math.min(2 * oy + 1, h - 1);
      for (let ox = 0; ox < ow; ox++) {
        const x0 = 2 * ox, x1 = Math.min(2 * ox + 1, w - 1);
        const f = Math.fround;
        dst[oy * ow + ox] = f(f(f(f(src[y0 * w + x0]! + src[y0 * w + x1]!) + src[y1 * w + x0]!) + src[y1 * w + x1]!) * 0.25);
      }
    }
  }
  return out;
}

// ---- Recursive Gaussian, sigma 1.5 (Charalampidis 2016; ssimulacra2 build.rs + gaussian.rs) ----

const K = (() => {
  const SIGMA = 1.5;
  const radius = Math.round(3.2795 * SIGMA + 0.2546);
  const w = [Math.PI / (2 * radius), (3 * Math.PI) / (2 * radius), (5 * Math.PI) / (2 * radius)] as const;
  const p1 = 1 / Math.tan(0.5 * w[0]);
  const p3 = -1 / Math.tan(0.5 * w[1]);
  const p5 = 1 / Math.tan(0.5 * w[2]);
  const r1 = (p1 * p1) / Math.sin(w[0]);
  const r3 = (-p3 * p3) / Math.sin(w[1]);
  const r5 = (p5 * p5) / Math.sin(w[2]);
  const rho = w.map((o) => Math.exp(-0.5 * SIGMA * SIGMA * o * o) / radius);
  const d13 = p1 * r3 - r1 * p3;
  const d35 = p3 * r5 - r3 * p5;
  const d51 = p5 * r1 - r5 * p1;
  const z15 = d35 / d13;
  const z35 = d51 / d13;
  const beta = solve3(
    [
      [p1, p3, p5],
      [r1, r3, r5],
      [z15, z35, 1],
    ],
    [1, radius * radius - SIGMA * SIGMA, z15 * rho[0]! + z35 * rho[1]! + rho[2]!],
  );
  // The filter weights must be normalized.
  if (Math.abs(beta[0] * p1 + beta[1] * p3 + beta[2] * p5 - 1) > 1e-12) throw new Error("gaussian");
  const f = Math.fround;
  return {
    radius,
    n2: w.map((o, i) => f(-beta[i]! * Math.cos(o * (radius + 1)))) as [number, number, number],
    d1: w.map((o) => f(-2 * Math.cos(o))) as [number, number, number],
  };
})();

function solve3(a: number[][], y: number[]): [number, number, number] {
  const m = (r: number, c: number) => a[r]![c]!;
  const det =
    m(0, 0) * (m(1, 1) * m(2, 2) - m(1, 2) * m(2, 1)) -
    m(0, 1) * (m(1, 0) * m(2, 2) - m(1, 2) * m(2, 0)) +
    m(0, 2) * (m(1, 0) * m(2, 1) - m(1, 1) * m(2, 0));
  const col = (k: number) => a.map((row, r) => row.map((v, c) => (c === k ? y[r]! : v)));
  const d = (b: number[][]) =>
    b[0]![0]! * (b[1]![1]! * b[2]![2]! - b[1]![2]! * b[2]![1]!) -
    b[0]![1]! * (b[1]![0]! * b[2]![2]! - b[1]![2]! * b[2]![0]!) +
    b[0]![2]! * (b[1]![0]! * b[2]![1]! - b[1]![1]! * b[2]![0]!);
  return [d(col(0)) / det, d(col(1)) / det, d(col(2)) / det];
}

/** Blurs `src` into a new plane. `tmp` must be at least width*height long. */
function blur(src: Float32Array, width: number, height: number, tmp: Float32Array): Float32Array {
  const N = K.radius;
  const [a1, a3, a5] = K.n2;
  const [b1, b3, b5] = K.d1;

  // Single-precision throughout, rounding where the reference's f32 math rounds (fused
  // multiply-adds round once). The published scores come from f32 implementations, and
  // f32 rounding noise is part of them; f64 here scored ~0.1 high.
  const f = Math.fround;
  const na1 = -b1, na3 = -b3, na5 = -b5;

  // Rows.
  for (let y = 0; y < height; y++) {
    const row = y * width;
    let p1 = 0, p3 = 0, p5 = 0, q1 = 0, q3 = 0, q5 = 0;
    for (let n = -N + 1; n < width; n++) {
      const left = n - N - 1, right = n + N - 1;
      const sum = f((left >= 0 ? src[row + left]! : 0) + (right < width ? src[row + right]! : 0));
      const o1 = f(na1 * p1 + f(f(sum * a1) - q1));
      const o3 = f(na3 * p3 + f(f(sum * a3) - q3));
      const o5 = f(na5 * p5 + f(f(sum * a5) - q5));
      q1 = p1; q3 = p3; q5 = p5;
      p1 = o1; p3 = o3; p5 = o5;
      if (n >= 0) tmp[row + n] = f(o1 + o3) + o5;
    }
  }

  // Columns, all at once so memory is read row by row.
  const out = new Float32Array(width * height);
  const P = new Float32Array(3 * width);
  const Q = new Float32Array(3 * width);
  for (let n = -N + 1; n < height; n++) {
    const top = n - N - 1, bottom = n + N - 1;
    const tRow = top >= 0 ? top * width : -1;
    const bRow = bottom < height ? bottom * width : -1;
    for (let x = 0; x < width; x++) {
      const sum = f((tRow >= 0 ? tmp[tRow + x]! : 0) + (bRow >= 0 ? tmp[bRow + x]! : 0));
      const i3 = x + width, i5 = x + 2 * width;
      const o1 = f(sum * a1 - f(P[x]! * b1 + Q[x]!));
      const o3 = f(sum * a3 - f(P[i3]! * b3 + Q[i3]!));
      const o5 = f(sum * a5 - f(P[i5]! * b5 + Q[i5]!));
      Q[x] = P[x]!; Q[i3] = P[i3]!; Q[i5] = P[i5]!;
      P[x] = o1; P[i3] = o3; P[i5] = o5;
      if (n >= 0) out[n * width + x] = f(o1 + o3) + o5;
    }
  }
  return out;
}

function multiply(a: Float32Array, b: Float32Array, out: Float32Array) {
  for (let i = 0; i < a.length; i++) out[i] = a[i]! * b[i]!;
  return out;
}

// ---- Scoring ----

type SourceScale = {
  width: number;
  height: number;
  xyb: Float32Array[];
  mu: Float32Array[];
  sigmaSq: Float32Array[];
};

export type Prepared = { width: number; height: number; scales: SourceScale[] };

/** Does the source-side work once: XYB, local means and variances at every scale. */
export function prepare(source: Planes): Prepared {
  if (source.width < 8 || source.height < 8) throw new Error("SSIMULACRA2 needs at least 8x8 pixels");
  const scales: SourceScale[] = [];
  const tmp = new Float32Array(source.width * source.height);
  const mul = new Float32Array(source.width * source.height);
  let img = source;
  for (let s = 0; s < SCALES; s++) {
    // The size check comes before the downscale, as in the reference: an 8-pixel scale is
    // still halved once more and scored at 4 pixels.
    if (img.width < 8 || img.height < 8) break;
    if (s > 0) img = downscale(img);
    const { width, height } = img;
    const n = width * height;
    const xyb = toXyb(img);
    scales.push({
      width,
      height,
      xyb,
      mu: xyb.map((p) => blur(p, width, height, tmp)),
      sigmaSq: xyb.map((p) => blur(multiply(p, p, mul.subarray(0, n)), width, height, tmp)),
    });
  }
  return { width: source.width, height: source.height, scales };
}

/** Score of `distorted` against a prepared source of the same size. */
export function score(ref: Prepared, distorted: Planes): number {
  if (distorted.width !== ref.width || distorted.height !== ref.height) {
    throw new Error("Source and distorted image sizes differ");
  }
  const tmp = new Float32Array(ref.width * ref.height);
  const mul = new Float32Array(ref.width * ref.height);
  const ssim: number[][] = [];
  const edge: number[][] = [];
  let img = distorted;
  for (let s = 0; s < ref.scales.length; s++) {
    const S = ref.scales[s]!;
    if (s > 0) img = downscale(img);
    const { width, height } = S;
    const n = width * height;
    const xyb2 = toXyb(img);
    const ss = [0, 0, 0, 0, 0, 0];
    const ed = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (let c = 0; c < 3; c++) {
      const x1 = S.xyb[c]!, m1 = S.mu[c]!, s11 = S.sigmaSq[c]!;
      const x2 = xyb2[c]!;
      const m2 = blur(x2, width, height, tmp);
      const s22 = blur(multiply(x2, x2, mul.subarray(0, n)), width, height, tmp);
      const s12 = blur(multiply(x1, x2, mul.subarray(0, n)), width, height, tmp);
      const f = Math.fround;
      let a = 0, a4 = 0, art = 0, art4 = 0, det = 0, det4 = 0;
      for (let i = 0; i < n; i++) {
        // f32 like the reference, then f64 for the sums.
        const mu1 = m1[i]!, mu2 = m2[i]!;
        const diff = f(mu1 - mu2);
        const numM = f(1 - diff * diff);
        const numS = f(2 * f(s12[i]! - f(mu1 * mu2)) + C2);
        const denS = f(f(f(s11[i]! - f(mu1 * mu1)) + f(s22[i]! - f(mu2 * mu2))) + C2);
        const d = Math.max(0, 1 - f(f(numM * numS) / denS));
        a += d;
        a4 += d * d * d * d;
        const d1 = (1 + Math.abs(f(x2[i]! - mu2))) / (1 + Math.abs(f(x1[i]! - mu1))) - 1;
        if (d1 > 0) {
          art += d1;
          art4 += d1 * d1 * d1 * d1;
        } else {
          det -= d1;
          det4 += d1 * d1 * d1 * d1;
        }
      }
      ss[c * 2] = a / n;
      ss[c * 2 + 1] = Math.sqrt(Math.sqrt(a4 / n));
      ed[c * 4] = art / n;
      ed[c * 4 + 1] = Math.sqrt(Math.sqrt(art4 / n));
      ed[c * 4 + 2] = det / n;
      ed[c * 4 + 3] = Math.sqrt(Math.sqrt(det4 / n));
    }
    ssim.push(ss);
    edge.push(ed);
  }
  return combine(ssim, edge);
}

/** One-shot score, for tests and tools. */
export function ssimulacra2(source: Planes, distorted: Planes) {
  return score(prepare(source), distorted);
}

function combine(ssim: number[][], edge: number[][]) {
  let s = 0;
  let i = 0;
  for (let c = 0; c < 3; c++) {
    for (let k = 0; k < ssim.length; k++) {
      for (let n = 0; n < 2; n++) {
        s += WEIGHT[i++]! * Math.abs(ssim[k]![c * 2 + n]!);
        s += WEIGHT[i++]! * Math.abs(edge[k]![c * 4 + n]!);
        s += WEIGHT[i++]! * Math.abs(edge[k]![c * 4 + n + 2]!);
      }
    }
  }
  s *= 0.9562382616834844;
  s = 6.248496625763138e-5 * s * s * s + 2.326765642916932 * s - 0.020884521182843837 * s * s;
  return s > 0 ? 100 - 10 * Math.pow(s, 0.6276336467831387) : 100;
}

// 108 weights: 3 channels × 6 scales × 2 norms × (SSIM, ringing, blurring).
const WEIGHT = [
  0.0, 0.0007376606707406586, 0.0, 0.0, 0.0007793481682867309, 0.0, 0.0, 0.0004371155730107379, 0.0,
  1.1041726426657346, 0.00066284834129271, 0.00015231632783718752, 0.0, 0.0016406437456599754, 0.0,
  1.8422455520539298, 11.441172603757666, 0.0, 0.0007989109436015163, 0.000176816438078653, 0.0,
  1.8787594979546387, 10.94906990605142, 0.0, 0.0007289346991508072, 0.9677937080626833, 0.0,
  0.00014003424285435884, 0.9981766977854967, 0.00031949755934435053, 0.0004550992113792063, 0.0, 0.0,
  0.0013648766163243398, 0.0, 0.0, 0.0, 0.0, 0.0, 7.466890328078848, 0.0, 17.445833984131262,
  0.0006235601634041466, 0.0, 0.0, 6.683678146179332, 0.00037724407979611296, 1.027889937768264,
  225.20515300849274, 0.0, 0.0, 19.213238186143016, 0.0011401524586618361, 0.001237755635509985,
  176.39317598450694, 0.0, 0.0, 24.43300999870476, 0.28520802612117757, 0.0004485436923833408, 0.0, 0.0,
  0.0, 34.77906344483772, 44.835625328877896, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
  0.0008680556573291698, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0005313191874358747, 0.0, 0.00016533814161379112, 0.0,
  0.0, 0.0, 0.0, 0.0, 0.0004179171803251336, 0.0017290828234722833, 0.0, 0.0020827005846636437, 0.0, 0.0,
  8.826982764996862, 23.19243343998926, 0.0, 95.1080498811086, 0.9863978034400682, 0.9834382792465353,
  0.0012286405048278493, 171.2667255897307, 0.9807858872435379, 0.0, 0.0, 0.0, 0.0005130064588990679, 0.0,
  0.00010854057858411537,
];
if (WEIGHT.length !== 108) throw new Error("weights");
