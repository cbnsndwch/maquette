import {
    listPalettes,
    paletteId,
    savePalette,
    type SavedPalette
} from '../core/palette-store.js';
import type { TileEditor } from '../core/tile-editor.js';

const HEX_RE = /^#?[0-9a-f]{6}$/i;

function hex2(n: number): string {
    return n.toString(16).padStart(2, '0');
}

/**
 * Left-side color panel for the tile editor. Shows the full **256-slot** palette
 * as an 8-wide swatch grid; unassigned slots render as a white box with a red
 * diagonal. Clicking a swatch opens a popover color selector for that slot, and
 * a whole palette can be imported from an 8×32 image.
 */
export class EditorColors {
    private readonly swatchesEl: HTMLElement;
    private readonly swatchEls: HTMLButtonElement[] = [];
    private readonly fileInput: HTMLInputElement;
    private readonly trimBtn: HTMLButtonElement;
    private readonly compactBtn: HTMLButtonElement;
    private readonly libSelect: HTMLSelectElement;
    private readonly libNameInput: HTMLInputElement;
    private saved: SavedPalette[] = [];
    private compact = true;
    /** Slot index being dragged for reorder, or null. */
    private dragSrc: number | null = null;
    private readonly popover: HTMLElement;
    private readonly cpColor: HTMLInputElement;
    private readonly cpHex: HTMLInputElement;
    private readonly cpClear: HTMLButtonElement;
    private activeSlot = 0;
    private popoverOpen = false;

    constructor(
        private readonly root: HTMLElement,
        private readonly editor: TileEditor
    ) {
        root.innerHTML = `
            <div class="ed-head">Colors</div>
            <div class="edc-bar">
                <button type="button" class="ed-tool active" id="edc-compact"
                    title="Show only assigned colors (toggle to the full 256-slot grid)">Compact</button>
                <button type="button" class="ed-btn" id="edc-sort-hue"
                    title="Sort colors by hue">Hue</button>
                <button type="button" class="ed-btn" id="edc-sort-light"
                    title="Sort colors by lightness">Light</button>
            </div>
            <div class="ed-swatches compact" id="edc-swatches"></div>
            <button type="button" class="ed-btn" id="edc-add"
                title="Assign a new color to the first free slot">+ Add color</button>
            <button type="button" class="ed-btn" id="edc-trim" hidden
                title="Remove palette colors no voxel uses"></button>
            <button type="button" class="ed-btn" id="edc-import"
                title="Load a 256-color palette from an 8×32 image">Import 8×32 image</button>
            <input type="file" id="edc-file" accept="image/png,image/jpeg,image/bmp,image/webp" hidden />
            <div class="edc-lib">
                <select id="edc-lib-select" title="Saved palettes"></select>
                <button type="button" class="ed-btn" id="edc-lib-load"
                    title="Apply the selected palette to this tile">Load</button>
            </div>
            <div class="edc-lib">
                <input type="text" id="edc-lib-name" placeholder="save palette as…" spellcheck="false" />
                <button type="button" class="ed-btn" id="edc-lib-save"
                    title="Save the current palette to the shared library">Save</button>
            </div>
        `;
        this.swatchesEl = root.querySelector('#edc-swatches')!;
        this.fileInput = root.querySelector('#edc-file')!;
        this.trimBtn = root.querySelector('#edc-trim')!;
        this.compactBtn = root.querySelector('#edc-compact')!;
        this.libSelect = root.querySelector('#edc-lib-select')!;
        this.libNameInput = root.querySelector('#edc-lib-name')!;
        this.buildSwatches();

        this.compactBtn.addEventListener('click', () => this.toggleCompact());
        root.querySelector('#edc-sort-hue')!.addEventListener('click', () =>
            this.editor.sortPalette('hue')
        );
        root.querySelector('#edc-sort-light')!.addEventListener('click', () =>
            this.editor.sortPalette('light')
        );
        root.querySelector('#edc-add')!.addEventListener('click', () =>
            this.addColor()
        );
        root.querySelector('#edc-lib-load')!.addEventListener('click', () =>
            this.loadSelected()
        );
        root.querySelector('#edc-lib-save')!.addEventListener('click', () =>
            void this.saveCurrent()
        );
        void this.refreshLibrary();

        this.trimBtn.addEventListener('click', () =>
            this.editor.removeUnusedColors()
        );
        root.querySelector('#edc-import')!.addEventListener('click', () =>
            this.fileInput.click()
        );
        this.fileInput.addEventListener('change', () => {
            const file = this.fileInput.files?.[0];
            if (file) this.importImage(file);
            this.fileInput.value = '';
        });

        // Popover color selector (one instance, repositioned per swatch).
        this.popover = document.createElement('div');
        this.popover.className = 'color-popover';
        this.popover.style.display = 'none';
        this.popover.innerHTML = `
            <input type="color" id="cp-color" />
            <input type="text" id="cp-hex" maxlength="7" spellcheck="false" />
            <div class="cp-actions">
                <button type="button" class="ed-btn" id="cp-clear">Clear</button>
                <button type="button" class="ed-btn ed-primary" id="cp-close">Done</button>
            </div>
        `;
        document.body.appendChild(this.popover);
        this.cpColor = this.popover.querySelector('#cp-color')!;
        this.cpHex = this.popover.querySelector('#cp-hex')!;
        this.cpClear = this.popover.querySelector('#cp-clear')!;

        this.cpColor.addEventListener('input', () =>
            this.apply(this.cpColor.value)
        );
        this.cpHex.addEventListener('change', () => {
            if (HEX_RE.test(this.cpHex.value)) {
                this.apply('#' + this.cpHex.value.replace('#', ''));
            }
        });
        this.cpClear.addEventListener('click', () => {
            if (this.cpClear.disabled) return;
            this.editor.clearSlot(this.activeSlot);
            this.closePopover();
        });
        this.popover
            .querySelector('#cp-close')!
            .addEventListener('click', () => this.closePopover());
        window.addEventListener('pointerdown', e => {
            const t = e.target as HTMLElement;
            if (
                this.popoverOpen &&
                !this.popover.contains(t) &&
                !t.closest('.ed-swatch')
            ) {
                this.closePopover();
            }
        });

        this.refresh();
    }

    show(): void {
        this.root.style.display = '';
        this.refresh();
    }

    hide(): void {
        this.closePopover();
        this.root.style.display = 'none';
    }

    refresh(): void {
        for (let i = 0; i < this.swatchEls.length; i++) {
            const sw = this.swatchEls[i]!;
            const c = this.editor.palette[i] ?? null;
            sw.classList.toggle('empty', c == null);
            sw.classList.toggle('active', i === this.editor.activeColorIdx);
            sw.style.background = c ?? '';
            sw.title = c ?? `slot ${i} — empty`;
        }
        const unused = this.editor.unusedColorCount();
        this.trimBtn.hidden = unused === 0;
        this.trimBtn.textContent = `Trim ${unused} unused`;
    }

    private buildSwatches(): void {
        for (let i = 0; i < this.editor.palette.length; i++) {
            const sw = document.createElement('button');
            sw.type = 'button';
            sw.className = 'ed-swatch';
            sw.draggable = true;
            sw.addEventListener('click', () => this.onSwatchClick(i));
            sw.addEventListener('dragstart', e => {
                this.dragSrc = i;
                e.dataTransfer!.effectAllowed = 'move';
                sw.classList.add('dragging');
            });
            sw.addEventListener('dragend', () => sw.classList.remove('dragging'));
            sw.addEventListener('dragover', e => {
                if (this.dragSrc != null) e.preventDefault(); // allow drop
            });
            sw.addEventListener('drop', e => {
                e.preventDefault();
                this.onDrop(i);
            });
            this.swatchesEl.appendChild(sw);
            this.swatchEls.push(sw);
        }
    }

    private onSwatchClick(i: number): void {
        this.editor.selectColorIdx(i); // no-op for an empty slot
        this.openPopover(i);
    }

    private toggleCompact(): void {
        this.compact = !this.compact;
        this.swatchesEl.classList.toggle('compact', this.compact);
        this.compactBtn.classList.toggle('active', this.compact);
    }

    /** Open the popover on the first free slot so the user can assign a new color. */
    private addColor(): void {
        const free = this.editor.palette.indexOf(null);
        if (free < 0) return; // palette full
        this.openPopover(free);
    }

    /* ── Saved-palette library ────────────────────────────────────── */

    /** Fetch the library and (re)populate the select, keeping the selection. */
    private async refreshLibrary(): Promise<void> {
        this.saved = await listPalettes();
        const cur = this.libSelect.value;
        this.libSelect.replaceChildren(new Option('— saved palettes —', ''));
        for (const p of this.saved) this.libSelect.add(new Option(p.name, p.id));
        if (this.saved.some(p => p.id === cur)) this.libSelect.value = cur;
    }

    /** Apply the selected saved palette; voxels recolor against it by slot index. */
    private loadSelected(): void {
        const p = this.saved.find(s => s.id === this.libSelect.value);
        if (p) this.editor.setPalette(p.colors);
    }

    /** Save the current palette to the shared library under the typed name. */
    private async saveCurrent(): Promise<void> {
        const name = this.libNameInput.value.trim();
        if (!name) {
            this.libNameInput.focus();
            return;
        }
        const saved = await savePalette(
            paletteId(name),
            name,
            this.editor.palette
        );
        if (!saved) return;
        this.libNameInput.value = '';
        await this.refreshLibrary();
        this.libSelect.value = saved.id;
    }

    /** Move the dragged assigned color to the dropped-on slot's position. */
    private onDrop(target: number): void {
        const src = this.dragSrc;
        this.dragSrc = null;
        if (src == null || src === target) return;
        const assigned: number[] = [];
        const empty: number[] = [];
        for (let i = 0; i < this.editor.palette.length; i++) {
            if (this.editor.palette[i] != null) assigned.push(i);
            else empty.push(i);
        }
        const from = assigned.indexOf(src);
        const to = assigned.indexOf(target);
        if (from < 0 || to < 0) return; // only reorder among assigned colors
        assigned.splice(to, 0, assigned.splice(from, 1)[0]!);
        this.editor.reorderPalette([...assigned, ...empty]);
    }

    private openPopover(i: number): void {
        this.activeSlot = i;
        const c = this.editor.palette[i] ?? '#ffffff';
        this.cpColor.value = c;
        this.cpHex.value = c;
        // Clearing an in-use slot would orphan its voxels; block it here.
        const inUse = this.editor.slotInUse(i);
        this.cpClear.disabled = inUse;
        this.cpClear.title = inUse
            ? 'In use — recolor or delete those voxels first'
            : 'Unassign this slot';
        this.popover.style.display = '';
        this.popoverOpen = true;
        const r = this.swatchEls[i]!.getBoundingClientRect();
        const pr = this.popover.getBoundingClientRect();
        const x = Math.min(r.right + 8, window.innerWidth - pr.width - 8);
        const y = Math.min(r.top, window.innerHeight - pr.height - 8);
        this.popover.style.left = `${Math.max(8, x)}px`;
        this.popover.style.top = `${Math.max(8, y)}px`;
    }

    private closePopover(): void {
        this.popoverOpen = false;
        this.popover.style.display = 'none';
    }

    private apply(hex: string): void {
        this.editor.setSlotColor(this.activeSlot, hex);
        this.cpColor.value = hex;
        this.cpHex.value = hex;
    }

    /** Read an 8×32 image into the 256 palette slots (transparent → unassigned). */
    private importImage(file: File): void {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            const cv = document.createElement('canvas');
            cv.width = 8;
            cv.height = 32;
            const ctx = cv.getContext('2d')!;
            ctx.imageSmoothingEnabled = false;
            ctx.clearRect(0, 0, 8, 32);
            ctx.drawImage(img, 0, 0, 8, 32);
            const data = ctx.getImageData(0, 0, 8, 32).data;
            const colors: (string | null)[] = [];
            for (let r = 0; r < 32; r++) {
                for (let c = 0; c < 8; c++) {
                    const o = (r * 8 + c) * 4;
                    if (data[o + 3]! < 8) {
                        colors.push(null);
                    } else {
                        colors.push(
                            `#${hex2(data[o]!)}${hex2(data[o + 1]!)}${hex2(data[o + 2]!)}`
                        );
                    }
                }
            }
            this.editor.setPalette(colors);
            URL.revokeObjectURL(url);
            this.refresh();
        };
        img.src = url;
    }
}
