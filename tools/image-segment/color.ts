// Color space helpers. HSL is stored as h ∈ [0,360), s ∈ [0,100], l ∈ [0,100]
// so the σ flags (--sigma-h in degrees, --sigma-s/--sigma-l in 0–100) map
// directly onto channel units.

export interface HSL {
    h: number;
    s: number;
    l: number;
}

export interface Sigma {
    h: number;
    s: number;
    l: number;
}

export function rgbToHsl(r: number, g: number, b: number): HSL {
    const rn = r / 255;
    const gn = g / 255;
    const bn = b / 255;
    const max = Math.max(rn, gn, bn);
    const min = Math.min(rn, gn, bn);
    const l = (max + min) / 2;
    const d = max - min;

    let h = 0;
    let s = 0;
    if (d > 1e-9) {
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
        else if (max === gn) h = (bn - rn) / d + 2;
        else h = (rn - gn) / d + 4;
        h *= 60;
    }

    return { h, s: s * 100, l: l * 100 };
}

export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
    const sn = s / 100;
    const ln = l / 100;
    if (sn <= 1e-9) {
        const v = Math.round(ln * 255);
        return [v, v, v];
    }
    const c = (1 - Math.abs(2 * ln - 1)) * sn;
    const hp = (((h % 360) + 360) % 360) / 60;
    const x = c * (1 - Math.abs((hp % 2) - 1));
    let r1 = 0;
    let g1 = 0;
    let b1 = 0;
    if (hp < 1) [r1, g1, b1] = [c, x, 0];
    else if (hp < 2) [r1, g1, b1] = [x, c, 0];
    else if (hp < 3) [r1, g1, b1] = [0, c, x];
    else if (hp < 4) [r1, g1, b1] = [0, x, c];
    else if (hp < 5) [r1, g1, b1] = [x, 0, c];
    else [r1, g1, b1] = [c, 0, x];
    const m = ln - c / 2;
    return [
        Math.round((r1 + m) * 255),
        Math.round((g1 + m) * 255),
        Math.round((b1 + m) * 255)
    ];
}

// Shortest angular distance between two hues, in [0,180].
export function hueDelta(a: number, b: number): number {
    const d = Math.abs(a - b);
    return d > 180 ? 360 - d : d;
}

// Mahalanobis-style distance in σ units across the diagonal HSL covariance —
// i.e. the radius of a 3D gaussian over HSL. Returns how many σ apart the two
// colors are; callers accept when this is ≤ threshold.
//
// Hue is weighted by the lower of the two saturations: hue is meaningless for
// near-gray colors, so grays are compared almost entirely on lightness.
export function colorDist(
    h1: number,
    s1: number,
    l1: number,
    h2: number,
    s2: number,
    l2: number,
    sig: Sigma
): number {
    const satW = Math.min(s1, s2) / 100;
    const dh = (hueDelta(h1, h2) * satW) / sig.h;
    const ds = (s1 - s2) / sig.s;
    const dl = (l1 - l2) / sig.l;
    return Math.sqrt(dh * dh + ds * ds + dl * dl);
}

export interface Lab {
    L: number;
    a: number;
    b: number;
}

export interface LabWeights {
    l: number;
    a: number;
    b: number;
}

function srgbToLinear(c: number): number {
    const cn = c / 255;
    return cn <= 0.04045 ? cn / 12.92 : ((cn + 0.055) / 1.055) ** 2.4;
}

// sRGB → CIELAB (D65). L* ∈ [0,100]; a*/b* ≈ [-128,127]. b* is the warm–cool
// (yellow–blue) axis that cleanly separates warm neutrals from cool ones even
// when both are desaturated — where HSL hue becomes unreliable.
export function rgbToLab(r: number, g: number, b: number): Lab {
    const rl = srgbToLinear(r);
    const gl = srgbToLinear(g);
    const bl = srgbToLinear(b);

    const x = (rl * 0.4124 + gl * 0.3576 + bl * 0.1805) / 0.95047;
    const y = rl * 0.2126 + gl * 0.7152 + bl * 0.0722;
    const z = (rl * 0.0193 + gl * 0.1192 + bl * 0.9505) / 1.08883;

    const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    const fx = f(x);
    const fy = f(y);
    const fz = f(z);

    return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

// Weighted ΔE: a plain euclidean distance in CIELAB with a per-axis weight, so
// callers can emphasize warmth (a*/b*) over lightness (L*) shading.
export function labDist(
    L1: number,
    a1: number,
    b1: number,
    L2: number,
    a2: number,
    b2: number,
    w: LabWeights
): number {
    const dL = (L1 - L2) * w.l;
    const da = (a1 - a2) * w.a;
    const db = (b1 - b2) * w.b;
    return Math.sqrt(dL * dL + da * da + db * db);
}

export function toHex(r: number, g: number, b: number): string {
    const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
    return `#${c(r)}${c(g)}${c(b)}`;
}

export function parseHex(hex: string): [number, number, number] {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
    if (!m) throw new Error(`invalid hex color: ${hex}`);
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
