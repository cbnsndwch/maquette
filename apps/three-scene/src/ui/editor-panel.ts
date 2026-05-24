import { CATEGORIES, type Category, type TerrainDef } from '../config.js';
import type { EditTool, TileEditor } from '../core/tile-editor.js';
import type { TileMeta } from '../core/tile-save.js';

const TOOLS: { id: EditTool; label: string }[] = [
    { id: 'add', label: 'Add' },
    { id: 'delete', label: 'Delete' },
    { id: 'paint', label: 'Paint' },
    { id: 'eyedropper', label: 'Pick' },
    { id: 'select', label: 'Select' }
];

export interface EditorPanelHooks {
    onSave: (meta: TileMeta) => void;
    onDone: () => void;
}

/**
 * Right-side editor panel: tools (incl. multi-voxel Select), bulk clear actions,
 * and the save form. The color palette lives in its own left panel
 * ({@link EditorColors}).
 */
export class EditorPanel {
    private readonly toolBtns = new Map<EditTool, HTMLButtonElement>();
    private readonly headEl: HTMLElement;
    private readonly nameInput: HTMLInputElement;
    private readonly catSelect: HTMLSelectElement;
    private readonly stackInput: HTMLInputElement;
    private readonly clearSelBtn: HTMLButtonElement;
    private readonly infoEl: HTMLElement;
    private readonly floorValEl: HTMLElement;
    private readonly gridBtn: HTMLButtonElement;
    private readonly edgesBtn: HTMLButtonElement;
    private readonly explodeValEl: HTMLElement;
    private readonly focusValEl: HTMLElement;
    private readonly voxFile: HTMLInputElement;

    constructor(
        private readonly root: HTMLElement,
        private readonly editor: TileEditor,
        hooks: EditorPanelHooks
    ) {
        root.innerHTML = `
            <div class="ed-head" id="ed-head">New Tile</div>
            <div class="ed-tools" id="ed-tools"></div>
            <button type="button" class="ed-btn" id="ed-base">Fill base</button>
            <div class="ed-label">Clear</div>
            <div class="ed-clear">
                <button type="button" class="ed-btn" id="ed-clear-base">Base</button>
                <button type="button" class="ed-btn" id="ed-clear-top">Top</button>
                <button type="button" class="ed-btn" id="ed-clear-all">All</button>
            </div>
            <button type="button" class="ed-btn" id="ed-clear-sel">Clear selection</button>
            <div class="ed-label">View</div>
            <div class="ed-floor">
                <button type="button" class="ed-btn" id="ed-floor-down">−</button>
                <span class="ed-floor-val" id="ed-floor-val">Floor 4</span>
                <button type="button" class="ed-btn" id="ed-floor-up">+</button>
            </div>
            <div class="ed-tools">
                <button type="button" class="ed-tool" id="ed-grid">Grid</button>
                <button type="button" class="ed-tool" id="ed-edges">Edges</button>
            </div>
            <div class="ed-floor">
                <button type="button" class="ed-btn" id="ed-explode-down">−</button>
                <span class="ed-floor-val" id="ed-explode-val">Explode 0</span>
                <button type="button" class="ed-btn" id="ed-explode-up">+</button>
            </div>
            <div class="ed-floor">
                <button type="button" class="ed-btn" id="ed-focus-down">−</button>
                <span class="ed-floor-val" id="ed-focus-val">Layer all</span>
                <button type="button" class="ed-btn" id="ed-focus-up">+</button>
            </div>
            <div class="ed-label">Import</div>
            <button type="button" class="ed-btn" id="ed-import-vox">Import .vox file</button>
            <input type="file" id="ed-vox-file"
                accept=".vox,application/octet-stream" hidden />
            <div class="ed-label">Save as tile</div>
            <input type="text" id="ed-name" placeholder="tile name" />
            <select id="ed-cat"></select>
            <label class="ed-check"><input type="checkbox" id="ed-stack" /> Stackable</label>
            <div class="ed-actions">
                <button type="button" class="ed-btn ed-primary" id="ed-save">Save</button>
                <button type="button" class="ed-btn" id="ed-done">Done</button>
            </div>
            <div class="ed-info" id="ed-info"></div>
        `;

        const toolsEl = root.querySelector('#ed-tools')!;
        for (const def of TOOLS) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'ed-tool';
            btn.textContent = def.label;
            btn.addEventListener('click', () => this.editor.setTool(def.id));
            toolsEl.appendChild(btn);
            this.toolBtns.set(def.id, btn);
        }

        this.headEl = root.querySelector('#ed-head')!;
        this.nameInput = root.querySelector('#ed-name')!;
        this.catSelect = root.querySelector('#ed-cat')!;
        this.stackInput = root.querySelector('#ed-stack')!;
        this.clearSelBtn = root.querySelector('#ed-clear-sel')!;
        this.infoEl = root.querySelector('#ed-info')!;
        this.floorValEl = root.querySelector('#ed-floor-val')!;
        this.gridBtn = root.querySelector('#ed-grid')!;
        this.edgesBtn = root.querySelector('#ed-edges')!;
        this.explodeValEl = root.querySelector('#ed-explode-val')!;
        this.focusValEl = root.querySelector('#ed-focus-val')!;
        this.voxFile = root.querySelector('#ed-vox-file')!;

        for (const c of CATEGORIES) {
            const opt = document.createElement('option');
            opt.value = c;
            opt.textContent = c[0]!.toUpperCase() + c.slice(1);
            this.catSelect.appendChild(opt);
        }

        const on = (id: string, fn: () => void) =>
            root.querySelector(`#${id}`)!.addEventListener('click', fn);
        on('ed-base', () => this.editor.fillBase());
        on('ed-clear-base', () => this.editor.clearBase());
        on('ed-clear-top', () => this.editor.clearTop());
        on('ed-clear-all', () => this.editor.clearAll());
        on('ed-clear-sel', () => this.editor.clearSelection());
        on('ed-floor-down', () => this.editor.lowerGround());
        on('ed-floor-up', () => this.editor.raiseGround());
        on('ed-grid', () => this.editor.setGridVisible(!this.editor.gridOn));
        on('ed-edges', () => this.editor.setEdgesVisible(!this.editor.edgesOn));
        on('ed-explode-down', () => this.editor.lowerExplode());
        on('ed-explode-up', () => this.editor.raiseExplode());
        on('ed-focus-down', () => this.editor.focusDown());
        on('ed-focus-up', () => this.editor.focusUp());
        on('ed-import-vox', () => this.voxFile.click());
        this.voxFile.addEventListener('change', () => {
            const file = this.voxFile.files?.[0];
            this.voxFile.value = '';
            if (file) void this.importVox(file);
        });
        on('ed-save', () => hooks.onSave(this.meta()));
        root.querySelector('#ed-done')!.addEventListener('click', hooks.onDone);

        this.refresh();
    }

    show(): void {
        this.root.style.display = '';
        this.refresh();
    }

    hide(): void {
        this.root.style.display = 'none';
    }

    /** Prefill the save form from an existing tile (entering edit-an-existing). */
    loadMeta(def: TerrainDef): void {
        this.headEl.textContent = 'Edit Tile';
        this.nameInput.value = def.name;
        this.catSelect.value = def.category;
        this.stackInput.checked = def.stackable;
        this.refresh();
    }

    /** Decode an imported `.vox` into the editor as a new tile (prefill name). */
    private async importVox(file: File): Promise<void> {
        const ok = this.editor.importVoxBuffer(await file.arrayBuffer());
        if (!ok) return;
        this.resetMeta();
        this.nameInput.value = file.name.replace(/\.vox$/i, '');
    }

    /** Clear the save form for authoring a brand-new tile. */
    resetMeta(): void {
        this.headEl.textContent = 'New Tile';
        this.nameInput.value = '';
        this.catSelect.value = CATEGORIES[0]!;
        this.stackInput.checked = false;
        this.refresh();
    }

    private meta(): TileMeta {
        const name = this.nameInput.value.trim() || 'untitled';
        // When editing an existing tile, keep its id so the save overwrites it
        // (a renamed tile updates in place rather than spawning a duplicate).
        const id =
            this.editor.editingId ??
            (name
                .toLowerCase()
                .replace(/[^a-z0-9_-]+/g, '_')
                .replace(/^_+|_+$/g, '') ||
                `tile_${Date.now()}`);
        return {
            id,
            name,
            category: this.catSelect.value as Category,
            stackable: this.stackInput.checked
        };
    }

    refresh(): void {
        for (const [id, btn] of this.toolBtns) {
            btn.classList.toggle('active', this.editor.tool === id);
        }
        const sel = this.editor.selection.size;
        this.clearSelBtn.disabled = sel === 0;
        this.floorValEl.textContent = `Floor ${this.editor.groundLevel}`;
        this.gridBtn.classList.toggle('active', this.editor.gridOn);
        this.edgesBtn.classList.toggle('active', this.editor.edgesOn);
        this.explodeValEl.textContent = `Explode ${this.editor.explode}`;
        this.focusValEl.textContent =
            this.editor.focusLayer == null
                ? 'Layer all'
                : `Layer ${this.editor.focusLayer}`;
        this.infoEl.textContent =
            `${this.editor.voxels.length} voxels` +
            (sel > 0 ? ` · ${sel} selected` : '');
    }
}
