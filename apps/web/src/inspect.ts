import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import {
    VoxelBatch,
    getBiomeRenderer,
    type Voxel
} from '@cbnsndwch/world-core';
import { listBiomes } from '@cbnsndwch/world-gen';

/**
 * Standalone object inspector: render a single biome object (tile surface, prop,
 * or building) on its own with full pan/zoom/rotate, to compare against the
 * reference assets in isolation. Dev-only page at /inspect.html.
 */

type Category = 'surfaces' | 'props' | 'structures';

const container = document.getElementById('app')!;
const biomeSel = document.getElementById('biome') as HTMLSelectElement;
const catSel = document.getElementById('category') as HTMLSelectElement;
const objSel = document.getElementById('object') as HTMLSelectElement;
const info = document.getElementById('info')!;

const params = new URLSearchParams(location.search);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#e7ebee');
scene.add(new THREE.GridHelper(48, 48, 0x8a929a, 0xc4c9ce));

const camera = new THREE.PerspectiveCamera(
    45,
    window.innerWidth / window.innerHeight,
    0.1,
    2000
);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.enablePan = true;
controls.screenSpacePanning = true;

let current: THREE.Group | null = null;

function voxelsFor(biome: string, category: Category, id: string): Voxel[] {
    const vox = getBiomeRenderer(biome).voxels;
    if (!vox || !id) return [];
    if (category === 'surfaces') return vox.surface(id, 0, 0);
    if (category === 'structures') return vox.structure?.(id) ?? [];
    return vox.prop(id);
}

function disposeGroup(g: THREE.Group): void {
    g.traverse(o => {
        const mesh = o as Partial<THREE.Mesh>;
        mesh.geometry?.dispose();
        const mat = mesh.material;
        if (Array.isArray(mat)) mat.forEach(m => m.dispose());
        else mat?.dispose();
    });
}

function show(): void {
    if (current) {
        scene.remove(current);
        disposeGroup(current);
        current = null;
    }

    const voxels = voxelsFor(
        biomeSel.value,
        catSel.value as Category,
        objSel.value
    );
    const batch = new VoxelBatch(1);
    batch.add(voxels, { origin: [0, 0, 0] });
    const group = batch.build();

    const box = new THREE.Box3().setFromObject(group);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    // Center on the grid (XZ) and seat the base on y=0.
    group.position.set(-center.x, -box.min.y, -center.z);
    scene.add(group);
    current = group;

    const maxDim = Math.max(size.x, size.y, size.z, 1);
    const dist = maxDim * 2.4;
    camera.position.set(dist, dist * 0.85, dist);
    controls.target.set(0, size.y / 2, 0);
    controls.update();

    info.textContent = voxels.length
        ? `${voxels.length} voxels · ${Math.round(size.x)}×${Math.round(size.z)} footprint · ${Math.round(size.y)} tall`
        : 'no voxels';
}

function populateObjects(): void {
    const cat = catSel.value as Category;
    const ids = getBiomeRenderer(biomeSel.value).voxels?.catalog?.[cat] ?? [];
    objSel.replaceChildren(
        ...ids.map(id => {
            const o = document.createElement('option');
            o.value = id;
            o.textContent = id;
            return o;
        })
    );
}

function populateBiomes(): void {
    for (const id of listBiomes()) {
        if (!getBiomeRenderer(id).voxels?.catalog) continue;
        const o = document.createElement('option');
        o.value = id;
        o.textContent = id;
        biomeSel.append(o);
    }
}

/** Mirror the current selection into the URL so a specific object is linkable. */
function syncUrl(): void {
    const p = new URLSearchParams();
    p.set('biome', biomeSel.value);
    p.set('cat', catSel.value);
    p.set('obj', objSel.value);
    history.replaceState({}, '', `?${p.toString()}`);
}

biomeSel.addEventListener('change', () => {
    populateObjects();
    show();
    syncUrl();
});
catSel.addEventListener('change', () => {
    populateObjects();
    show();
    syncUrl();
});
objSel.addEventListener('change', () => {
    show();
    syncUrl();
});

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

function animate(): void {
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
}

// Restore selection from the URL (?biome=&cat=&obj=) so renders are linkable.
populateBiomes();
if (params.get('biome')) biomeSel.value = params.get('biome')!;
if (params.get('cat')) catSel.value = params.get('cat')!;
populateObjects();
if (params.get('obj')) objSel.value = params.get('obj')!;
show();
syncUrl();
animate();
