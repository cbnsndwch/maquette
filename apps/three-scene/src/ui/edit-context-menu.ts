import type { Game } from '../core/game.js';
import type { TileEditor } from '../core/tile-editor.js';

const DRAG_SLOP = 5; // px; a right-drag past this is an orbit, not a menu open

/**
 * Right-click context menu for the tile editor's multi-voxel selection. When a
 * selection exists, right-clicking the canvas opens Delete / Recolor / Move
 * (±x, ±y, ±z) actions at the cursor. A right-*drag* orbits the camera instead,
 * so the menu is suppressed once the pointer travels past {@link DRAG_SLOP}.
 */
export class EditContextMenu {
    private readonly root: HTMLElement;
    private open = false;
    private downX = 0;
    private downY = 0;
    private countEl!: HTMLElement;
    private colorInput!: HTMLInputElement;

    constructor(
        private readonly canvas: HTMLElement,
        private readonly game: Game,
        private readonly editor: TileEditor
    ) {
        this.root = document.createElement('div');
        this.root.className = 'ctx-menu';
        this.root.style.display = 'none';
        this.build();
        document.body.appendChild(this.root);

        this.canvas.addEventListener('pointerdown', e => {
            if (e.button === 2) {
                this.downX = e.clientX;
                this.downY = e.clientY;
            }
        });
        this.canvas.addEventListener('contextmenu', e => this.onContextMenu(e));
        // Dismiss on outside click, Escape, or wheel/scroll.
        window.addEventListener('pointerdown', e => {
            if (this.open && !this.root.contains(e.target as Node)) this.hide();
        });
        window.addEventListener('keydown', e => {
            if (e.key === 'Escape') this.hide();
        });
        window.addEventListener('wheel', () => this.hide(), { passive: true });
    }

    /** Hide if the selection emptied out from under an open menu. */
    refresh(): void {
        if (this.open && this.editor.selection.size === 0) this.hide();
    }

    private onContextMenu(e: MouseEvent): void {
        if (this.game.mode !== 'edit' || this.editor.selection.size === 0) {
            return;
        }
        // A right-drag is a camera orbit — don't hijack it with the menu.
        if (
            Math.hypot(e.clientX - this.downX, e.clientY - this.downY) >
            DRAG_SLOP
        ) {
            return;
        }
        e.preventDefault();
        this.show(e.clientX, e.clientY);
    }

    private show(x: number, y: number): void {
        this.countEl.textContent = `${this.editor.selection.size} selected`;
        this.colorInput.value = this.editor.activeColor;
        this.root.style.display = '';
        this.open = true;
        // Clamp inside the viewport once the menu has a measured size.
        const r = this.root.getBoundingClientRect();
        const px = Math.min(x, window.innerWidth - r.width - 8);
        const py = Math.min(y, window.innerHeight - r.height - 8);
        this.root.style.left = `${Math.max(8, px)}px`;
        this.root.style.top = `${Math.max(8, py)}px`;
    }

    private hide(): void {
        if (!this.open) return;
        this.open = false;
        this.root.style.display = 'none';
    }

    private build(): void {
        const count = document.createElement('div');
        count.className = 'ctx-count';
        this.root.appendChild(count);
        this.countEl = count;

        const del = this.item('Delete', () => {
            this.editor.deleteSelection();
            this.hide();
        });
        del.classList.add('ctx-danger');
        this.root.appendChild(del);

        // Recolor: an inline color input applies on pick; the menu stays open.
        const recolor = document.createElement('label');
        recolor.className = 'ctx-item ctx-recolor';
        recolor.textContent = 'Recolor';
        const color = document.createElement('input');
        color.type = 'color';
        color.addEventListener('input', () =>
            this.editor.recolorSelection(color.value)
        );
        recolor.appendChild(color);
        this.root.appendChild(recolor);
        this.colorInput = color;

        const moveLabel = document.createElement('div');
        moveLabel.className = 'ctx-section';
        moveLabel.textContent = 'Move';
        this.root.appendChild(moveLabel);

        const grid = document.createElement('div');
        grid.className = 'ctx-move';
        const steps: [string, number, number, number][] = [
            ['-X', -1, 0, 0],
            ['+X', 1, 0, 0],
            ['-Y', 0, -1, 0],
            ['+Y', 0, 1, 0],
            ['-Z', 0, 0, -1],
            ['+Z', 0, 0, 1]
        ];
        for (const [label, dx, dy, dz] of steps) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'ctx-move-btn';
            btn.textContent = label;
            btn.addEventListener('click', () =>
                this.editor.moveSelection(dx, dy, dz)
            );
            grid.appendChild(btn);
        }
        this.root.appendChild(grid);
    }

    private item(label: string, onClick: () => void): HTMLButtonElement {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'ctx-item';
        btn.textContent = label;
        btn.addEventListener('click', onClick);
        return btn;
    }
}
