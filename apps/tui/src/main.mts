import type { WorldSpec } from '@cbnsndwch/contracts';
import { generateLlmWorld, generateWfcWorld } from '@cbnsndwch/world-gen';

import { renderAscii, type AsciiMode } from './ascii.mjs';

/**
 * Musicologia terminal render target.
 *
 *   musicologia-tui [seed] [--llm] [--ascii] [--glyph] [--biome=<id>]
 *
 * Generates a track's world and renders it. By default the 3D renderer
 * (`@opentui/three` via Bun/WebGPU) is used; `--ascii` or `--glyph` force
 * the 2D fallback. The 2D path also activates automatically when the 3D
 * runtime is unavailable.
 */
async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const flags = new Set(args.filter(a => a.startsWith('--')));
    const seed =
        args.find(a => !a.startsWith('--')) ?? 'spotify:track:musicologia-demo';

    const useLlm = flags.has('--llm');
    const forceAscii = flags.has('--ascii') || flags.has('--glyph');
    const mode: AsciiMode = flags.has('--glyph') ? 'glyph' : 'color';
    const biomeId = args
        .find(a => a.startsWith('--biome='))
        ?.slice('--biome='.length);

    const spec: WorldSpec = useLlm
        ? await generateLlmWorld(seed)
        : generateWfcWorld(seed, { biomeId });

    const header = `musicologia · ${seed} · ${spec.biome} · ${spec.paradigm} · ${spec.timeOfDay} · ${spec.weather} · ${spec.props.length} props`;

    if (!forceAscii) {
        const ok = await tryRender3d(spec, header);
        if (ok) return;
    }

    process.stdout.write(`${header}\n\n${renderAscii(spec, { mode })}\n`);
}

async function tryRender3d(spec: WorldSpec, header: string): Promise<boolean> {
    try {
        const { render3d } = await import('./render3d.mjs');
        await render3d(spec, header);
        return true;
    } catch (err: unknown) {
        process.stderr.write(
            `[tui] 3D renderer unavailable (${String(err)}); falling back to 2D.\n`
        );
        return false;
    }
}

main().catch((err: unknown) => {
    process.stderr.write(`${String(err)}\n`);
    process.exitCode = 1;
});
