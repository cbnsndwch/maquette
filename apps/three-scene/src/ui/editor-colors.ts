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
    private readonly popover: HTMLElement;
    private readonly cpColor: HTMLInputElement;
    private readonly cpHex: HTMLInputElement;
    private activeSlot = 0;
    private popoverOpen = false;

    constructor(
        private readonly root: HTMLElement,
        private readonly editor: TileEditor
    ) {
        root.innerHTML = `
            <div class="ed-head">Colors</div>
            <div class="ed-swatches" id="edc-swatches"></div>
            <button type="button" class="ed-btn" id="edc-import">Import 8×32 image</button>
            <input type="file" id="edc-file" accept="image/png,image/jpeg,image/bmp,image/webp" hidden />
        `;
        this.swatchesEl = root.querySelector('#edc-swatches')!;
        this.fileInput = root.querySelector('#edc-file')!;
        this.buildSwatches();

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

        this.cpColor.addEventListener('input', () =>
            this.apply(this.cpColor.value)
        );
        this.cpHex.addEventListener('change', () => {
            if (HEX_RE.test(this.cpHex.value)) {
                this.apply('#' + this.cpHex.value.replace('#', ''));
            }
        });
        this.popover
            .querySelector('#cp-clear')!
            .addEventListener('click', () => {
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
    }

    private buildSwatches(): void {
        for (let i = 0; i < this.editor.palette.length; i++) {
            const sw = document.createElement('button');
            sw.type = 'button';
            sw.className = 'ed-swatch';
            sw.addEventListener('click', () => this.onSwatchClick(i));
            this.swatchesEl.appendChild(sw);
            this.swatchEls.push(sw);
        }
    }

    private onSwatchClick(i: number): void {
        this.editor.selectColorIdx(i); // no-op for an empty slot
        this.openPopover(i);
    }

    private openPopover(i: number): void {
        this.activeSlot = i;
        const c = this.editor.palette[i] ?? '#ffffff';
        this.cpColor.value = c;
        this.cpHex.value = c;
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
