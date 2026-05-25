import sharp from 'sharp';

export interface RGBAImage {
    data: Uint8Array;
    width: number;
    height: number;
}

// Decode any sharp-supported format to a flat RGBA buffer. Optionally downscale
// the longest side to `maxDim` first (never enlarges).
export async function loadRGBA(file: string, maxDim?: number): Promise<RGBAImage> {
    let pipeline = sharp(file).ensureAlpha();
    if (maxDim && maxDim > 0) {
        pipeline = pipeline.resize({
            width: maxDim,
            height: maxDim,
            fit: 'inside',
            withoutEnlargement: true
        });
    }
    const { data, info } = await pipeline.raw().toBuffer({ resolveWithObject: true });
    return {
        data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
        width: info.width,
        height: info.height
    };
}

export async function writeRGBA(
    file: string,
    data: Uint8Array,
    width: number,
    height: number
): Promise<void> {
    await sharp(Buffer.from(data.buffer, data.byteOffset, data.byteLength), {
        raw: { width, height, channels: 4 }
    })
        .png()
        .toFile(file);
}
