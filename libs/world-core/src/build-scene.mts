import * as THREE from 'three';
import {
    GRID_SIZE,
    type TimeOfDay,
    type WorldSpec
} from '@cbnsndwch/contracts';

import { getBiomeRenderer } from './biome-render.mjs';

/**
 * Builds a `THREE.Scene` from a {@link WorldSpec}.
 *
 * This is deliberately renderer-agnostic: it constructs only the scene graph
 * (geometry, materials, lights) and never creates a renderer or camera, so the
 * same scene can be drawn by a WebGL renderer in the browser/Tauri or by a
 * terminal renderer. Tile colors and prop meshes are dispatched per `spec.biome`
 * through the {@link getBiomeRenderer} registry. Call {@link disposeScene} when
 * swapping worlds.
 */

export interface BuildSceneOptions {
    /** World units per grid tile. */
    tileSize?: number;
    /** World units corresponding to a normalized height of 1. */
    heightScale?: number;
}

const DEFAULT_TILE_SIZE = 1;
const DEFAULT_HEIGHT_SCALE = 3;

const AMBIENT_INTENSITY: Record<TimeOfDay, number> = {
    dawn: 0.6,
    day: 0.9,
    dusk: 0.5,
    night: 0.25
};

const SUN_INTENSITY: Record<TimeOfDay, number> = {
    dawn: 0.8,
    day: 1.1,
    dusk: 0.7,
    night: 0.3
};

const SUN_COLOR: Record<TimeOfDay, number> = {
    dawn: 0xffd9a0,
    day: 0xffffff,
    dusk: 0xff9e6d,
    night: 0x9fb4ff
};

function toColor(hex: string): THREE.Color {
    return new THREE.Color(hex.startsWith('#') ? hex : `#${hex}`);
}

function paletteColors(spec: WorldSpec): THREE.Color[] {
    return spec.palette.map(toColor);
}

function applyLighting(
    scene: THREE.Scene,
    spec: WorldSpec,
    palette: THREE.Color[]
): void {
    const sky = palette[7] ?? new THREE.Color('#9fd4e0');
    const ground = palette[4] ?? new THREE.Color('#cdbfa3');

    scene.add(
        new THREE.AmbientLight(0xffffff, AMBIENT_INTENSITY[spec.timeOfDay])
    );
    scene.add(new THREE.HemisphereLight(sky.getHex(), ground.getHex(), 0.4));

    const sun = new THREE.DirectionalLight(
        SUN_COLOR[spec.timeOfDay],
        SUN_INTENSITY[spec.timeOfDay]
    );
    sun.position.set(GRID_SIZE, GRID_SIZE * 1.5, GRID_SIZE * 0.6);
    scene.add(sun);
}

function sampleHeight(spec: WorldSpec, gx: number, gy: number): number {
    const x = Math.max(0, Math.min(GRID_SIZE - 1, Math.round(gx)));
    const y = Math.max(0, Math.min(GRID_SIZE - 1, Math.round(gy)));
    return spec.terrain.heightmap[y]?.[x] ?? 0;
}

export function buildScene(
    spec: WorldSpec,
    options: BuildSceneOptions = {}
): THREE.Scene {
    const tileSize = options.tileSize ?? DEFAULT_TILE_SIZE;
    const heightScale = options.heightScale ?? DEFAULT_HEIGHT_SCALE;

    const scene = new THREE.Scene();
    const palette = paletteColors(spec);
    const biome = getBiomeRenderer(spec.biome);
    scene.background = palette[7] ?? new THREE.Color('#9fd4e0');

    applyLighting(scene, spec, palette);

    const half = (GRID_SIZE * tileSize) / 2;
    const world = new THREE.Group();
    world.name = 'world';

    const tileGeo = new THREE.BoxGeometry(tileSize, 1, tileSize);

    for (let y = 0; y < GRID_SIZE; y++) {
        for (let x = 0; x < GRID_SIZE; x++) {
            const tile = spec.tiles[y]?.[x];
            if (!tile) {
                continue;
            }
            const h = spec.terrain.heightmap[y]?.[x] ?? 0;
            const colorIndex = biome.tilePaletteIndex(tile.type);
            const color = palette[colorIndex] ?? palette[0]!;
            const tileHeight = Math.max(0.1, h * heightScale);

            const mesh = new THREE.Mesh(
                tileGeo,
                new THREE.MeshStandardMaterial({ color, flatShading: true })
            );
            mesh.scale.y = tileHeight;
            mesh.position.set(
                x * tileSize - half + tileSize / 2,
                tileHeight / 2,
                y * tileSize - half + tileSize / 2
            );
            world.add(mesh);
        }
    }

    for (const prop of spec.props) {
        const obj = biome.buildProp(prop.type, palette);
        const top = Math.max(
            0.1,
            sampleHeight(spec, prop.x, prop.y) * heightScale
        );
        obj.scale.setScalar(prop.scale);
        obj.rotation.y = (prop.rotation * Math.PI) / 180;
        obj.position.set(
            prop.x * tileSize - half + tileSize / 2,
            top,
            prop.y * tileSize - half + tileSize / 2
        );
        world.add(obj);
    }

    scene.add(world);
    return scene;
}

/** Recommended camera placement for an isometric-ish view of the world. */
export function suggestCameraPosition(options: BuildSceneOptions = {}): {
    position: [number, number, number];
    target: [number, number, number];
} {
    const tileSize = options.tileSize ?? DEFAULT_TILE_SIZE;
    const span = GRID_SIZE * tileSize;
    return {
        position: [span * 0.7, span * 0.7, span * 0.7],
        target: [0, 0, 0]
    };
}

/** Recursively dispose of geometries and materials in a scene. */
export function disposeScene(scene: THREE.Scene): void {
    scene.traverse(obj => {
        const mesh = obj as Partial<THREE.Mesh>;
        mesh.geometry?.dispose();
        const material = mesh.material;
        if (Array.isArray(material)) {
            for (const m of material) {
                m.dispose();
            }
        } else {
            material?.dispose();
        }
    });
}
