import { GRID_SIZE, type TileType, type WorldSpec } from '@cbnsndwch/contracts';

/**
 * Render a {@link WorldSpec} as a top-down terminal map.
 *
 * This is the zero-dependency terminal render target the research doc proposes
 * as the robust fallback to `@opentui/three`: instead of rasterizing a 3D scene
 * to ASCII (CPU-heavy, experimental), it draws the island directly from the spec
 * as colored partial-blocks (24-bit ANSI) or plain glyphs. It needs no GPU and
 * no native deps, so it runs anywhere a terminal does.
 */

export type AsciiMode = 'color' | 'glyph';

export interface RenderAsciiOptions {
    /** 'color' = 24-bit ANSI block map; 'glyph' = plain-text glyph map. */
    mode?: AsciiMode;
}

interface BiomePresentation {
    /** Palette slot per tile id (mirrors the 3D renderer). */
    paletteIndex: Record<string, number>;
    /** Plain-text glyph per tile id for the no-color mode. */
    glyph: Record<string, string>;
}

/** Per-biome presentation, keyed by `WorldSpec.biome`. */
const PRESENTATION: Record<string, BiomePresentation> = {
    mykonos: {
        paletteIndex: {
            water: 6,
            sand: 5,
            grass: 3,
            rock: 4,
            plaza: 0,
            path: 4,
            wall: 0,
            rooftop: 2,
            dome: 1,
            stairs: 0
        },
        glyph: {
            water: '~',
            sand: '.',
            grass: ',',
            rock: '^',
            plaza: '+',
            path: '-',
            wall: '#',
            rooftop: 'R',
            dome: 'O',
            stairs: '='
        }
    },
    cyberpunk: {
        paletteIndex: {
            canal: 6,
            quay: 5,
            street: 5,
            plaza: 3,
            market: 2,
            rubble: 4,
            scaffold: 4,
            tower: 0,
            highrise: 0,
            spire: 1
        },
        glyph: {
            canal: '~',
            quay: '_',
            street: '=',
            plaza: '+',
            market: 'm',
            rubble: '%',
            scaffold: 'x',
            tower: '#',
            highrise: 'H',
            spire: '!'
        }
    }
};

function presentationFor(biome: string): BiomePresentation {
    return PRESENTATION[biome] ?? PRESENTATION.mykonos!;
}

const ESC = String.fromCharCode(27);
const RESET = ESC + '[0m';

interface Rgb {
    r: number;
    g: number;
    b: number;
}

export function hexToRgb(hex: string): Rgb {
    const h = hex.startsWith('#') ? hex.slice(1) : hex;
    return {
        r: parseInt(h.slice(0, 2), 16),
        g: parseInt(h.slice(2, 4), 16),
        b: parseInt(h.slice(4, 6), 16)
    };
}

function fg({ r, g, b }: Rgb): string {
    return ESC + `[38;2;${r};${g};${b}m`;
}

/**
 * Render the spec's tile grid. In `color` mode each tile becomes two
 * full-block characters (so the map looks roughly square in a terminal) tinted
 * with its palette color; in `glyph` mode each tile is a single ASCII glyph and
 * props are overlaid.
 */
export function renderAscii(
    spec: WorldSpec,
    options: RenderAsciiOptions = {}
): string {
    const mode = options.mode ?? 'color';

    if (mode === 'glyph') {
        return renderGlyphs(spec);
    }

    const palette = spec.palette;
    const pres = presentationFor(spec.biome);
    const lines: string[] = [];
    for (let y = 0; y < GRID_SIZE; y++) {
        let line = '';
        for (let x = 0; x < GRID_SIZE; x++) {
            const tile = spec.tiles[y]?.[x];
            const type: TileType = tile?.type ?? 'water';
            const color = palette[pres.paletteIndex[type] ?? 0] ?? '#000000';
            line += fg(hexToRgb(color)) + '██';
        }
        lines.push(line + RESET);
    }
    return lines.join('\n');
}

function renderGlyphs(spec: WorldSpec): string {
    const pres = presentationFor(spec.biome);
    const glyphs: string[][] = spec.tiles.map(row =>
        row.map(tile => pres.glyph[tile.type] ?? '?')
    );

    for (const prop of spec.props) {
        const x = Math.round(prop.x);
        const y = Math.round(prop.y);
        const row = glyphs[y];
        if (row && x >= 0 && x < row.length) {
            row[x] = propGlyph(prop.type);
        }
    }

    return glyphs.map(row => row.join('')).join('\n');
}

function propGlyph(type: string): string {
    switch (type) {
        case 'olive-tree':
        case 'cypress':
            return 'T';
        case 'windmill':
            return 'W';
        case 'boat':
            return 'b';
        case 'lamp':
        case 'neon-lamp':
        case 'beacon':
            return 'i';
        case 'neon-sign':
            return 'S';
        case 'antenna':
            return 'Y';
        case 'holo':
            return 'o';
        case 'drone':
            return 'd';
        case 'barrier':
            return 'H';
        default:
            return '*';
    }
}
