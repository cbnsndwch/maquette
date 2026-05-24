import { CATEGORIES, type Category } from '../config.js';
import type { EditTool, TileEditor } from '../core/tile-editor.js';
import type { TileMeta } from '../core/tile-save.js';

const TOOLS: { id: EditTool; label: string }[] = [
    { id: 'add', label: 'Add' },
    { id: 'delete', label: 'Delete' },
    { id: 'paint', label: 'Paint' },
    { id: 'eyedropper', label: 'Pick' }
];

export interface EditorPanelHooks {
    onSave: (meta: TileMeta) => void;
    onDone: () => void;
}

/**
 * Right-side panel shown while editing a tile: tool buttons, a color palette +
 * picker, a "fill base" shortcut, and the save form (name / category / stackable).
 */
export class EditorPanel {
    private readonly toolBtns = new Map<EditTool, HTMLButtonElement>();
    private readonly swatchesEl: HTMLElement;
    private readonly colorInput: HTMLInputElement;
    private readonly nameInput: HTMLInputElement;
    private readonly catSelect: HTMLSelectElement;
    private readonly stackInput: HTMLInputElement;
    private readonly infoEl: HTMLElement;

    constructor(
        private readonly root: HTMLElement,
        private readonly editor: TileEditor,
        hooks: EditorPanelHooks
    ) {
        root.innerHTML = `
            <div class="ed-head">Edit Tile</div>
            <div class="ed-tools" id="ed-tools"></div>
            <button type="button" class="ed-btn" id="ed-base">Fill base (4 layers)</button>
            <div class="ed-label">Color</div>
            <div class="ed-swatches" id="ed-swatches"></div>
            <input type="color" id="ed-color" value="#fafaf5" />
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

        this.swatchesEl = root.querySelector('#ed-swatches')!;
        this.colorInput = root.querySelector('#ed-color')!;
        this.nameInput = root.querySelector('#ed-name')!;
        this.catSelect = root.querySelector('#ed-cat')!;
        this.stackInput = root.querySelector('#ed-stack')!;
        this.infoEl = root.querySelector('#ed-info')!;

        for (const c of CATEGORIES) {
            const opt = document.createElement('option');
            opt.value = c;
            opt.textContent = c[0]!.toUpperCase() + c.slice(1);
            this.catSelect.appendChild(opt);
        }

        this.colorInput.addEventListener('input', () =>
            this.editor.setColor(this.colorInput.value)
        );
        root.querySelector('#ed-base')!.addEventListener('click', () =>
            this.editor.fillBase()
        );
        root.querySelector('#ed-save')!.addEventListener('click', () =>
            hooks.onSave(this.meta())
        );
        root.querySelector('#ed-done')!.addEventListener('click', hooks.onDone);

        this.editor.onChange = () => this.refresh();
        this.refresh();
    }

    show(): void {
        this.root.style.display = '';
        this.refresh();
    }

    hide(): void {
        this.root.style.display = 'none';
    }

    private meta(): TileMeta {
        const name = this.nameInput.value.trim() || 'untitled';
        const id =
            name
                .toLowerCase()
                .replace(/[^a-z0-9_-]+/g, '_')
                .replace(/^_+|_+$/g, '') || `tile_${Date.now()}`;
        return {
            id,
            name,
            category: this.catSelect.value as Category,
            stackable: this.stackInput.checked
        };
    }

    private refresh(): void {
        for (const [id, btn] of this.toolBtns) {
            btn.classList.toggle('active', this.editor.tool === id);
        }
        this.colorInput.value = this.editor.activeColor;

        this.swatchesEl.innerHTML = '';
        this.editor.palette.forEach((c, i) => {
            const sw = document.createElement('button');
            sw.type = 'button';
            sw.className =
                'ed-swatch' +
                (i === this.editor.activeColorIdx ? ' active' : '');
            sw.style.background = c;
            sw.title = c;
            sw.addEventListener('click', () => this.editor.selectColorIdx(i));
            this.swatchesEl.appendChild(sw);
        });

        this.infoEl.textContent = `${this.editor.voxels.length} voxels`;
    }
}
