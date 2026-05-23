import { GRID_SIZE } from '@cbnsndwch/contracts';
import { generateWfcWorld } from '@cbnsndwch/world-gen';
import { describe, expect, it } from 'vitest';

import { hexToRgb, renderAscii } from './ascii.mjs';

const ESC = String.fromCharCode(27);

describe('hexToRgb', () => {
    it('parses with and without a leading hash', () => {
        expect(hexToRgb('#ff8000')).toEqual({ r: 255, g: 128, b: 0 });
        expect(hexToRgb('00ff10')).toEqual({ r: 0, g: 255, b: 16 });
    });
});

describe('renderAscii', () => {
    const spec = generateWfcWorld('track:tui');

    it('glyph mode emits one line per row and no ANSI codes', () => {
        const out = renderAscii(spec, { mode: 'glyph' });
        const lines = out.split('\n');
        expect(lines).toHaveLength(GRID_SIZE);
        for (const line of lines) {
            expect(line).toHaveLength(GRID_SIZE);
        }
        expect(out).not.toContain(ESC);
        // The island is ringed in water → top row is all '~'.
        expect(lines[0]).toBe('~'.repeat(GRID_SIZE));
    });

    it('color mode emits ANSI 24-bit color and two cells per tile', () => {
        const out = renderAscii(spec, { mode: 'color' });
        const lines = out.split('\n');
        expect(lines).toHaveLength(GRID_SIZE);
        expect(out).toContain(`${ESC}[38;2;`);
        // Each line resets color at the end.
        for (const line of lines) {
            expect(line.endsWith(`${ESC}[0m`)).toBe(true);
        }
    });

    it('defaults to color mode', () => {
        expect(renderAscii(spec)).toContain(`${ESC}[38;2;`);
    });

    it('renders a non-Mykonos biome with its own glyphs', () => {
        const cyber = generateWfcWorld('track:neon', { biomeId: 'cyberpunk' });
        const lines = renderAscii(cyber, { mode: 'glyph' }).split('\n');
        // Cyberpunk's border tile is 'canal' (glyph '~'); towers use '#'.
        expect(lines[0]).toBe('~'.repeat(GRID_SIZE));
        const used = new Set(lines.join('').split(''));
        // At least one cyberpunk-specific glyph shows up somewhere.
        expect(['#', 'H', '!', 'm', 'x', '%', '='].some(g => used.has(g))).toBe(
            true
        );
    });
});
