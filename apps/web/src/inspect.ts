import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import {
    VoxelBatch,
    decodeVox,
    getBiomeRenderer,
    mergeVoxels,
    voxelsToSmoothMesh,
    type Voxel
} from '@cbnsndwch/world-core';
import { listBiomes } from '@cbnsndwch/world-gen';

type Category = 'surfaces' | 'props' | 'structures';
type Tool = 'add' | 'delete' | 'repaint' | 'eyedropper' | 'fill';
type RenderMode = 'cubes' | 'smooth';

// ── DOM refs ──────────────────────────────────────────────────────────────

const biomeSel = document.getElementById('biome') as HTMLSelectElement;
const catSel = document.getElementById('category') as HTMLSelectElement;
const objSel = document.getElementById('object') as HTMLSelectElement;
const renderSel = document.getElementById('render') as HTMLSelectElement;
const info = document.getElementById('info')!;
const toolBtns = [
    ...document.querySelectorAll<HTMLButtonElement>('[data-tool]')
];
const paletteEl = document.getElementById('palette')!;
const colorPicker = document.getElementById('colorPicker') as HTMLInputElement;
const colorHexEl = document.getElementById('colorHex')!;
const fillHueEl = document.getElementById('fillHue') as HTMLInputElement;
const fillHueOut = document.getElementById('fillHueOut')!;
const fillStdEl = document.getElementById('fillStd') as HTMLInputElement;
const fillStdOut = document.getElementById('fillStdOut')!;
const fillSatEl = document.getElementById('fillSat') as HTMLInputElement;
const fillSatOut = document.getElementById('fillSatOut')!;
const fillLitEl = document.getElementById('fillLit') as HTMLInputElement;
const fillLitOut = document.getElementById('fillLitOut')!;
const fillWEl = document.getElementById('fillW') as HTMLInputElement;
const fillDEl = document.getElementById('fillD') as HTMLInputElement;
const fillHEl = document.getElementById('fillH') as HTMLInputElement;
const loadFileEl = document.getElementById('loadFile') as HTMLInputElement;
const params = new URLSearchParams(location.search);

// ── Editor state ──────────────────────────────────────────────────────────

let editorVoxels: Voxel[] = [];
let palette: string[] = [];
let activePaletteIdx = 0;
let activeTool: Tool = 'add';
let renderMode: RenderMode = 'cubes';

/** Centering locked at asset-load time so edits don't cause the model to jump. */
interface Layout {
    snapX: number;
    snapZ: number;
    offsetY: number;
}
let lockedLayout: Layout = { snapX: 0, snapZ: 0, offsetY: 0 };

// ── Three.js scene ────────────────────────────────────────────────────────

const container = document.getElementById('app')!;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#e7ebee');
scene.add(new THREE.GridHelper(12, 1, 0x6a7278, 0x8a929a));
scene.add(new THREE.GridHelper(12, 12, 0x8a929a, 0xc4c9ce));

// Lights for the smooth-mesh render mode (the cube path uses an unlit
// MeshBasicMaterial and ignores these).
const hemi = new THREE.HemisphereLight(0xffffff, 0x60708a, 1.6);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 2.0);
sun.position.set(6, 12, 8);
scene.add(sun);

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

/** Parent group for both display mesh and hitboxes — positioned by lockedLayout. */
const modelGroup = new THREE.Group();
/** Child group holding the VoxelBatch display output (rebuilt on each edit). */
const displayGroup = new THREE.Group();
modelGroup.add(displayGroup);
scene.add(modelGroup);

/** Shared unit-box geometry for the InstancedMesh hitbox — never disposed. */
const hitGeo = new THREE.BoxGeometry(1, 1, 1);
/** Opaque material on the hitbox; invisible because the mesh lives on layer 1. */
const hitMat = new THREE.MeshBasicMaterial();

/** Single InstancedMesh on layer 1 (camera sees layer 0 only). Rebuilt on each edit. */
let editorHitMesh: THREE.InstancedMesh | null = null;

const raycaster = new THREE.Raycaster();
raycaster.layers.set(1); // only intersect layer-1 objects (the hitbox mesh)

// ── Math / color helpers ──────────────────────────────────────────────────

function snapToHalfInt(n: number): number {
    return Math.round(n - 0.5) + 0.5;
}

function boxMuller(): number {
    return (
        Math.sqrt(-2 * Math.log(Math.max(1e-10, Math.random()))) *
        Math.cos(2 * Math.PI * Math.random())
    );
}

function sampleHue(mean: number, std: number): number {
    return (((mean + boxMuller() * std) % 360) + 360) % 360;
}

function hslToHex(h: number, s: number, l: number): string {
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    let r = 0,
        g = 0,
        b = 0;
    if (h < 60) {
        r = c;
        g = x;
    } else if (h < 120) {
        r = x;
        g = c;
    } else if (h < 180) {
        g = c;
        b = x;
    } else if (h < 240) {
        g = x;
        b = c;
    } else if (h < 300) {
        r = x;
        b = c;
    } else {
        r = c;
        b = x;
    }
    const hex = (n: number) =>
        Math.round((n + m) * 255)
            .toString(16)
            .padStart(2, '0');
    return `#${hex(r)}${hex(g)}${hex(b)}`;
}

// ── Layout computation ────────────────────────────────────────────────────

function computeLayout(voxels: Voxel[]): Layout {
    if (voxels.length === 0) return { snapX: 0, snapZ: 0, offsetY: 0 };
    let minX = Infinity,
        maxX = -Infinity;
    let minY = Infinity,
        maxY = -Infinity;
    let minZ = Infinity;
    for (const v of voxels) {
        if (v.x < minX) minX = v.x;
        if (v.x > maxX) maxX = v.x;
        if (v.y < minY) minY = v.y;
        if (v.y > maxY) maxY = v.y;
        if (v.z < minZ) minZ = v.z;
    }
    // VoxelBatch maps voxel (x,y,z) → Three.js (x+0.5, z+0.5, y+0.5)
    // Bounding box centre in Three.js X = (minX + maxX + 1) / 2
    //                                 Z = (minY + maxY + 1) / 2
    const centerX = (minX + maxX + 1) / 2;
    const centerZ = (minY + maxY + 1) / 2;
    return {
        snapX: snapToHalfInt(centerX),
        snapZ: snapToHalfInt(centerZ),
        offsetY: -minZ // seat lowest voxel layer on y = 0
    };
}

function applyLayout(layout: Layout): void {
    modelGroup.position.set(-layout.snapX, layout.offsetY, -layout.snapZ);
}

// ── Scene rebuild ─────────────────────────────────────────────────────────

function rebuildDisplay(): void {
    displayGroup.traverse(o => {
        if (o === displayGroup) return;
        const m = o as Partial<THREE.Mesh>;
        m.geometry?.dispose();
        const mat = m.material;
        if (Array.isArray(mat)) mat.forEach(x => x.dispose());
        else mat?.dispose();
    });
    displayGroup.clear();

    if (editorVoxels.length === 0) return;

    if (renderMode === 'smooth') {
        displayGroup.add(voxelsToSmoothMesh(editorVoxels, { size: 1 }));
        return;
    }

    const batch = new VoxelBatch(1);
    batch.add(editorVoxels, { origin: [0, 0, 0] });
    displayGroup.add(batch.build());
}

function rebuildHitboxes(): void {
    if (editorHitMesh) {
        modelGroup.remove(editorHitMesh);
        editorHitMesh = null;
    }
    if (editorVoxels.length === 0) return;

    const mesh = new THREE.InstancedMesh(hitGeo, hitMat, editorVoxels.length);
    mesh.layers.set(1); // invisible to camera (layer 0), hit by raycaster (layer 1)
    const m = new THREE.Matrix4();
    for (let i = 0; i < editorVoxels.length; i++) {
        const v = editorVoxels[i]!;
        // Same offset as VoxelBatch: threejs=(vx+0.5, vz+0.5, vy+0.5)
        m.setPosition(v.x + 0.5, v.z + 0.5, v.y + 0.5);
        mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
    editorHitMesh = mesh;
    modelGroup.add(mesh);
}

function rebuildScene(): void {
    applyLayout(lockedLayout);
    rebuildDisplay();
    rebuildHitboxes();
    scene.updateMatrixWorld(true); // ensure fresh matrices for same-frame raycasting
    updateInfo();
}

function updateInfo(): void {
    if (editorVoxels.length === 0) {
        info.textContent = 'no voxels';
        return;
    }
    let minX = Infinity,
        maxX = -Infinity,
        minY = Infinity,
        maxY = -Infinity,
        minZ = Infinity,
        maxZ = -Infinity;
    for (const v of editorVoxels) {
        if (v.x < minX) minX = v.x;
        if (v.x > maxX) maxX = v.x;
        if (v.y < minY) minY = v.y;
        if (v.y > maxY) maxY = v.y;
        if (v.z < minZ) minZ = v.z;
        if (v.z > maxZ) maxZ = v.z;
    }
    info.textContent = `${editorVoxels.length} voxels · ${maxX - minX + 1}×${maxY - minY + 1} footprint · ${maxZ - minZ + 1} tall`;
}

// ── Asset loading ─────────────────────────────────────────────────────────

function voxelsFor(biome: string, category: Category, id: string): Voxel[] {
    const vox = getBiomeRenderer(biome).voxels;
    if (!vox || !id) return [];
    if (category === 'surfaces') return vox.surface(id, 0, 0);
    if (category === 'structures') return vox.structure?.(id) ?? [];
    return vox.prop(id);
}

function loadAsset(): void {
    editorVoxels = [
        ...voxelsFor(biomeSel.value, catSel.value as Category, objSel.value)
    ];
    lockedLayout = computeLayout(editorVoxels);
    palette = extractPalette(editorVoxels);
    activePaletteIdx = 0;
    renderPalette();
    syncColorPicker();

    // Reset camera to frame the asset
    const span = Math.max(
        lockedLayout.snapX * 2 || 12,
        editorVoxels.reduce((m, v) => Math.max(m, v.z), 0) + 1,
        12
    );
    const dist = span * 2.0;
    camera.position.set(dist, dist * 0.85, dist);
    controls.target.set(0, span * 0.3, 0);
    controls.update();

    rebuildScene();
    syncUrl();
}

/** Load a baked `.vox` (e.g. pipeline output) by URL instead of a biome recipe. */
async function loadVoxUrl(url: string): Promise<void> {
    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`${res.status}`);
        editorVoxels = decodeVox(await res.arrayBuffer()).voxels;
    } catch (e) {
        info.textContent = `failed to load ${url}: ${String(e)}`;
        return;
    }
    lockedLayout = computeLayout(editorVoxels);
    palette = extractPalette(editorVoxels);
    activePaletteIdx = 0;
    renderPalette();
    syncColorPicker();

    const span = Math.max(
        lockedLayout.snapX * 2 || 12,
        editorVoxels.reduce((m, v) => Math.max(m, v.z), 0) + 1,
        12
    );
    const dist = span * 2.0;
    camera.position.set(dist, dist * 0.85, dist);
    controls.target.set(0, span * 0.3, 0);
    controls.update();
    rebuildScene();
}

// ── Palette helpers ───────────────────────────────────────────────────────

function extractPalette(voxels: Voxel[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const v of voxels) {
        const c = v.c.toLowerCase();
        if (!seen.has(c)) {
            seen.add(c);
            out.push(c);
        }
    }
    return out.slice(0, 24);
}

function ensureInPalette(hex: string): void {
    const c = hex.toLowerCase();
    if (!palette.includes(c)) palette = [...palette, c].slice(0, 24);
    activePaletteIdx = palette.indexOf(c);
    renderPalette();
}

function syncColorPicker(): void {
    const c = palette[activePaletteIdx] ?? '#ffffff';
    colorPicker.value = c;
    colorHexEl.textContent = c;
}

function renderPalette(): void {
    paletteEl.innerHTML = '';
    palette.forEach((c, i) => {
        const btn = document.createElement('button');
        btn.className = 'swatch' + (i === activePaletteIdx ? ' active' : '');
        btn.style.background = c;
        btn.title = c;
        btn.onclick = () => {
            activePaletteIdx = i;
            syncColorPicker();
            renderPalette();
        };
        paletteEl.append(btn);
    });
    const addBtn = document.createElement('button');
    addBtn.className = 'swatch-add';
    addBtn.textContent = '+';
    addBtn.title = 'add / edit color';
    addBtn.onclick = () => colorPicker.click();
    paletteEl.append(addBtn);
}

function activeColor(): string {
    return palette[activePaletteIdx] ?? '#ffffff';
}

// ── Edit operations ───────────────────────────────────────────────────────

function occupied(): Set<string> {
    return new Set(editorVoxels.map(v => `${v.x},${v.y},${v.z}`));
}

function addVoxel(x: number, y: number, z: number): void {
    if (occupied().has(`${x},${y},${z}`)) return;
    editorVoxels = [...editorVoxels, { x, y, z, c: activeColor() }];
    rebuildScene();
}

function deleteVoxel(idx: number): void {
    editorVoxels = editorVoxels.filter((_, i) => i !== idx);
    rebuildScene();
}

function repaintVoxel(idx: number): void {
    editorVoxels = editorVoxels.map((v, i) =>
        i === idx ? { ...v, c: activeColor() } : v
    );
    rebuildScene();
}

function fillVolume(x0: number, y0: number, z0: number): void {
    const w = Math.max(1, parseInt(fillWEl.value) || 3);
    const d = Math.max(1, parseInt(fillDEl.value) || 3);
    const h = Math.max(1, parseInt(fillHEl.value) || 3);
    const hue = parseFloat(fillHueEl.value);
    const std = parseFloat(fillStdEl.value);
    const sat = parseFloat(fillSatEl.value) / 100;
    const lit = parseFloat(fillLitEl.value) / 100;

    const occ = occupied();
    const fresh: Voxel[] = [];
    for (let dx = 0; dx < w; dx++)
        for (let dy = 0; dy < d; dy++)
            for (let dz = 0; dz < h; dz++) {
                const pos = { x: x0 + dx, y: y0 + dy, z: z0 + dz };
                if (!occ.has(`${pos.x},${pos.y},${pos.z}`)) {
                    fresh.push({
                        ...pos,
                        c: hslToHex(sampleHue(hue, std), sat, lit)
                    });
                }
            }
    editorVoxels = [...editorVoxels, ...fresh];
    rebuildScene();
}

// ── Click / raycast ───────────────────────────────────────────────────────

let mouseDownX = 0,
    mouseDownY = 0;

renderer.domElement.addEventListener('mousedown', e => {
    mouseDownX = e.clientX;
    mouseDownY = e.clientY;
});

renderer.domElement.addEventListener('mouseup', e => {
    // Skip drags (orbit / pan)
    const dx = e.clientX - mouseDownX,
        dy = e.clientY - mouseDownY;
    if (Math.sqrt(dx * dx + dy * dy) > 4 || e.button !== 0) return;

    const rect = renderer.domElement.getBoundingClientRect();
    raycaster.setFromCamera(
        new THREE.Vector2(
            ((e.clientX - rect.left) / rect.width) * 2 - 1,
            -((e.clientY - rect.top) / rect.height) * 2 + 1
        ),
        camera
    );

    if (!editorHitMesh) return;
    const hits = raycaster.intersectObject(editorHitMesh, false);
    if (hits.length === 0) return;

    const hit = hits[0]!;
    const idx = hit.instanceId ?? -1;
    if (idx < 0 || idx >= editorVoxels.length) return;
    const v = editorVoxels[idx]!;

    // Face normal in Three.js local/world axes → voxel-space delta
    // VoxelBatch: threejs.x=voxel.x, threejs.y=voxel.z, threejs.z=voxel.y
    const n = hit.face!.normal;
    const ax = v.x + Math.round(n.x);
    const ay = v.y + Math.round(n.z); // threejs.z → voxel.y
    const az = v.z + Math.round(n.y); // threejs.y → voxel.z

    switch (activeTool) {
        case 'add':
            addVoxel(ax, ay, az);
            break;
        case 'delete':
            deleteVoxel(idx);
            break;
        case 'repaint':
            repaintVoxel(idx);
            break;
        case 'fill':
            fillVolume(ax, ay, az);
            break;
        case 'eyedropper':
            ensureInPalette(v.c);
            syncColorPicker();
            break;
    }
});

// ── Tool selector ─────────────────────────────────────────────────────────

function setTool(tool: Tool): void {
    activeTool = tool;
    toolBtns.forEach(b =>
        b.classList.toggle('active', b.dataset.tool === tool)
    );
    (document.getElementById('fillSettings') as HTMLDetailsElement).open =
        tool === 'fill';
}

toolBtns.forEach(btn =>
    btn.addEventListener('click', () => setTool(btn.dataset.tool as Tool))
);
setTool('add');

// ── Color picker ──────────────────────────────────────────────────────────

colorPicker.addEventListener('input', () => {
    const c = colorPicker.value.toLowerCase();
    colorHexEl.textContent = c;
    ensureInPalette(c);
});

// ── Fill param displays ───────────────────────────────────────────────────

fillHueEl.addEventListener(
    'input',
    () => (fillHueOut.textContent = `${fillHueEl.value}°`)
);
fillStdEl.addEventListener(
    'input',
    () => (fillStdOut.textContent = `${fillStdEl.value}°`)
);
fillSatEl.addEventListener(
    'input',
    () => (fillSatOut.textContent = `${fillSatEl.value}%`)
);
fillLitEl.addEventListener(
    'input',
    () => (fillLitOut.textContent = `${fillLitEl.value}%`)
);

// ── Save / Load ───────────────────────────────────────────────────────────

document.getElementById('saveBtn')!.addEventListener('click', () => {
    const json = JSON.stringify(editorVoxels, null, 2);
    navigator.clipboard.writeText(json).catch(() => {});
    const url = URL.createObjectURL(
        new Blob([json], { type: 'application/json' })
    );
    const a = Object.assign(document.createElement('a'), {
        href: url,
        download: `${biomeSel.value}-${catSel.value}-${objSel.value}.json`
    });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
});

document
    .getElementById('loadBtn')!
    .addEventListener('click', () => loadFileEl.click());

loadFileEl.addEventListener('change', () => {
    const file = loadFileEl.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = evt => {
        try {
            const parsed: Voxel[] = JSON.parse(evt.target!.result as string);
            if (!Array.isArray(parsed)) throw new Error();
            editorVoxels = mergeVoxels(editorVoxels, parsed);
            palette = extractPalette(editorVoxels);
            activePaletteIdx = 0;
            renderPalette();
            syncColorPicker();
            rebuildScene();
        } catch {
            alert('Not a valid Voxel[] JSON file.');
        }
    };
    reader.readAsText(file);
    loadFileEl.value = '';
});

// ── Asset selectors ───────────────────────────────────────────────────────

function populateObjects(): void {
    const cat = catSel.value as Category;
    const ids = getBiomeRenderer(biomeSel.value).voxels?.catalog?.[cat] ?? [];
    objSel.replaceChildren(
        ...ids.map(id => {
            const o = document.createElement('option');
            o.value = o.textContent = id;
            return o;
        })
    );
}

function populateBiomes(): void {
    for (const id of listBiomes()) {
        if (!getBiomeRenderer(id).voxels?.catalog) continue;
        const o = document.createElement('option');
        o.value = o.textContent = id;
        biomeSel.append(o);
    }
}

function syncUrl(): void {
    const p = new URLSearchParams();
    p.set('biome', biomeSel.value);
    p.set('cat', catSel.value);
    p.set('obj', objSel.value);
    p.set('render', renderMode);
    history.replaceState({}, '', `?${p.toString()}`);
}

biomeSel.addEventListener('change', () => {
    populateObjects();
    loadAsset();
});
catSel.addEventListener('change', () => {
    populateObjects();
    loadAsset();
});
objSel.addEventListener('change', () => {
    loadAsset();
});
renderSel.addEventListener('change', () => {
    renderMode = renderSel.value === 'smooth' ? 'smooth' : 'cubes';
    rebuildScene();
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

// ── Boot ──────────────────────────────────────────────────────────────────

populateBiomes();
if (params.get('biome')) biomeSel.value = params.get('biome')!;
if (params.get('cat')) catSel.value = params.get('cat')!;
if (params.get('render') === 'smooth') renderMode = 'smooth';
renderSel.value = renderMode;
populateObjects();
if (params.get('obj')) objSel.value = params.get('obj')!;
if (params.get('voxurl')) {
    void loadVoxUrl(params.get('voxurl')!);
} else {
    loadAsset();
    syncUrl();
}
animate();
