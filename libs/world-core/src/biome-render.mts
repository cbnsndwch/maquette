import * as THREE from 'three';

/**
 * Per-biome rendering: how a biome's tile ids map to palette slots, and how its
 * prop ids become meshes. This is the *view* half of a biome (the *generation*
 * half lives in `@cbnsndwch/world-gen`), kept here so the renderer owns all the
 * `three` code. `buildScene` dispatches on `WorldSpec.biome` through this registry.
 */

export interface BiomeRenderer {
    /** Palette slot index that colors a given tile id. */
    tilePaletteIndex(tileId: string): number;
    /** Build a prop mesh for a biome-local prop id. */
    buildProp(propId: string, palette: THREE.Color[]): THREE.Object3D;
}

function standard(
    color: THREE.Color,
    emissive = 0
): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
        color,
        flatShading: true,
        emissive: new THREE.Color(emissive),
        emissiveIntensity: emissive ? 1 : 0
    });
}

// ---------------------------------------------------------------------------
// Mykonos
// ---------------------------------------------------------------------------

const MYKONOS_TILE_SLOT: Record<string, number> = {
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
};

function mykonosProp(propId: string, palette: THREE.Color[]): THREE.Object3D {
    const group = new THREE.Group();
    const olive = new THREE.Color('#6b7a3a');
    const trunk = new THREE.Color('#7a5a3a');
    const stone = palette[4] ?? new THREE.Color('#cdbfa3');
    const terracotta = palette[2] ?? new THREE.Color('#c66b3d');

    switch (propId) {
        case 'olive-tree': {
            const t = new THREE.Mesh(
                new THREE.CylinderGeometry(0.06, 0.08, 0.5, 6),
                standard(trunk)
            );
            t.position.y = 0.25;
            const leaves = new THREE.Mesh(
                new THREE.IcosahedronGeometry(0.32, 0),
                standard(olive)
            );
            leaves.position.y = 0.6;
            group.add(t, leaves);
            break;
        }
        case 'cypress': {
            const body = new THREE.Mesh(
                new THREE.ConeGeometry(0.18, 1.1, 7),
                standard(new THREE.Color('#3f5a2e'))
            );
            body.position.y = 0.55;
            group.add(body);
            break;
        }
        case 'lamp': {
            const post = new THREE.Mesh(
                new THREE.CylinderGeometry(0.03, 0.03, 0.7, 6),
                standard(stone)
            );
            post.position.y = 0.35;
            const bulb = new THREE.Mesh(
                new THREE.SphereGeometry(0.08, 8, 8),
                standard(new THREE.Color('#fff3c4'), 0xffcc66)
            );
            bulb.position.y = 0.75;
            group.add(post, bulb);
            break;
        }
        case 'pot': {
            const body = new THREE.Mesh(
                new THREE.CylinderGeometry(0.12, 0.08, 0.22, 8),
                standard(terracotta)
            );
            body.position.y = 0.11;
            const plant = new THREE.Mesh(
                new THREE.IcosahedronGeometry(0.14, 0),
                standard(olive)
            );
            plant.position.y = 0.3;
            group.add(body, plant);
            break;
        }
        case 'well': {
            const ring = new THREE.Mesh(
                new THREE.CylinderGeometry(0.22, 0.24, 0.3, 10),
                standard(stone)
            );
            ring.position.y = 0.15;
            group.add(ring);
            break;
        }
        default: {
            const box = new THREE.Mesh(
                new THREE.BoxGeometry(0.3, 0.3, 0.3),
                standard(stone)
            );
            box.position.y = 0.15;
            group.add(box);
        }
    }
    return group;
}

const mykonosRenderer: BiomeRenderer = {
    tilePaletteIndex: id => MYKONOS_TILE_SLOT[id] ?? 0,
    buildProp: mykonosProp
};

// ---------------------------------------------------------------------------
// Cyberpunk
// ---------------------------------------------------------------------------

const CYBERPUNK_TILE_SLOT: Record<string, number> = {
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
};

function cyberpunkProp(propId: string, palette: THREE.Color[]): THREE.Object3D {
    const group = new THREE.Group();
    const magenta = palette[1] ?? new THREE.Color('#ff2e88');
    const cyan = palette[2] ?? new THREE.Color('#00e5ff');
    const purple = palette[3] ?? new THREE.Color('#7a3cff');
    const steel = palette[5] ?? new THREE.Color('#2a3550');
    const neon = (c: THREE.Color) =>
        new THREE.MeshStandardMaterial({
            color: c,
            emissive: c,
            emissiveIntensity: 0.9,
            flatShading: true
        });

    switch (propId) {
        case 'neon-sign': {
            const sign = new THREE.Mesh(
                new THREE.BoxGeometry(0.08, 0.5, 0.18),
                neon(magenta)
            );
            sign.position.y = 0.5;
            group.add(sign);
            break;
        }
        case 'antenna': {
            const mast = new THREE.Mesh(
                new THREE.CylinderGeometry(0.02, 0.03, 0.9, 6),
                standard(steel)
            );
            mast.position.y = 0.45;
            const tip = new THREE.Mesh(
                new THREE.SphereGeometry(0.05, 8, 8),
                neon(cyan)
            );
            tip.position.y = 0.95;
            group.add(mast, tip);
            break;
        }
        case 'beacon': {
            const post = new THREE.Mesh(
                new THREE.CylinderGeometry(0.04, 0.04, 0.5, 6),
                standard(steel)
            );
            post.position.y = 0.25;
            const light = new THREE.Mesh(
                new THREE.SphereGeometry(0.1, 10, 10),
                neon(magenta)
            );
            light.position.y = 0.6;
            group.add(post, light);
            break;
        }
        case 'holo': {
            const cone = new THREE.Mesh(
                new THREE.ConeGeometry(0.18, 0.5, 12, 1, true),
                new THREE.MeshStandardMaterial({
                    color: cyan,
                    emissive: cyan,
                    emissiveIntensity: 0.7,
                    transparent: true,
                    opacity: 0.5,
                    flatShading: true
                })
            );
            cone.position.y = 0.3;
            group.add(cone);
            break;
        }
        case 'drone': {
            const body = new THREE.Mesh(
                new THREE.BoxGeometry(0.16, 0.05, 0.16),
                standard(steel)
            );
            body.position.y = 0.6;
            const dot = new THREE.Mesh(
                new THREE.SphereGeometry(0.03, 6, 6),
                neon(magenta)
            );
            dot.position.y = 0.57;
            group.add(body, dot);
            break;
        }
        case 'barrier': {
            const bar = new THREE.Mesh(
                new THREE.BoxGeometry(0.4, 0.16, 0.1),
                standard(steel)
            );
            bar.position.y = 0.08;
            const stripe = new THREE.Mesh(
                new THREE.BoxGeometry(0.42, 0.03, 0.02),
                neon(cyan)
            );
            stripe.position.y = 0.12;
            stripe.position.z = 0.06;
            group.add(bar, stripe);
            break;
        }
        case 'neon-lamp': {
            const post = new THREE.Mesh(
                new THREE.CylinderGeometry(0.03, 0.03, 0.7, 6),
                standard(steel)
            );
            post.position.y = 0.35;
            const bulb = new THREE.Mesh(
                new THREE.SphereGeometry(0.08, 8, 8),
                neon(purple)
            );
            bulb.position.y = 0.75;
            group.add(post, bulb);
            break;
        }
        default: {
            const box = new THREE.Mesh(
                new THREE.BoxGeometry(0.25, 0.25, 0.25),
                neon(cyan)
            );
            box.position.y = 0.13;
            group.add(box);
        }
    }
    return group;
}

const cyberpunkRenderer: BiomeRenderer = {
    tilePaletteIndex: id => CYBERPUNK_TILE_SLOT[id] ?? 0,
    buildProp: cyberpunkProp
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const registry = new Map<string, BiomeRenderer>([
    ['mykonos', mykonosRenderer],
    ['cyberpunk', cyberpunkRenderer]
]);

export function registerBiomeRenderer(
    id: string,
    renderer: BiomeRenderer
): void {
    registry.set(id, renderer);
}

/** Resolve a biome's renderer, falling back to Mykonos for unknown biomes. */
export function getBiomeRenderer(id: string): BiomeRenderer {
    return registry.get(id) ?? mykonosRenderer;
}
