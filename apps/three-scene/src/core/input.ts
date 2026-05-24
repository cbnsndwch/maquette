import { CATEGORIES } from '@cbnsndwch/scene-author';
import type { Game, Tool } from './game.js';
import type { EditTool } from './tile-editor.js';

const TAP_SLOP = 5; // px of drift still treated as a click on release
const EDIT_MOVE_THRESHOLD = 6; // px the cursor must travel before the next edit

/** Tile-editor tool keyboard shortcuts (must match EditorPanel's tooltips). */
const EDIT_KEYS: Record<string, EditTool> = {
    a: 'add',
    d: 'delete',
    p: 'paint',
    i: 'eyedropper',
    s: 'select'
};

/**
 * Translates pointer + keyboard input into game intents. Camera orbit/pan/zoom
 * is handled by OrbitControls (see {@link SceneView.setCameraButtons}); here we
 * own left-button placement + brush, right-click erase, wheel-driven tile
 * rotation (Place mode only), and the spacebar hold-to-pan override.
 */
export class Input {
    private downX = 0;
    private downY = 0;
    private brushing = false;
    private editing = false;
    private lastEditX = 0;
    private lastEditY = 0;
    private lastBrushKey: string | null = null;

    /** Tool to restore when the spacebar (temporary pan) is released. */
    private spacePrevTool: Tool | null = null;

    constructor(
        private readonly canvas: HTMLElement,
        private readonly game: Game
    ) {
        canvas.addEventListener('pointerdown', e => this.onDown(e));
        window.addEventListener('pointermove', e => this.onMove(e));
        window.addEventListener('pointerup', e => this.onUp(e));
        canvas.addEventListener('pointerleave', () => this.game.onHover(null));
        canvas.addEventListener('contextmenu', e => e.preventDefault());
        // Capture phase + window target so we intercept the wheel before
        // OrbitControls' own listener can zoom (Place mode rotates instead).
        window.addEventListener('wheel', e => this.onWheel(e), {
            capture: true,
            passive: false
        });
        window.addEventListener('keydown', e => this.onKey(e));
        window.addEventListener('keyup', e => this.onKeyUp(e));
    }

    private isBrushTool(): boolean {
        return this.game.tool === 'place' || this.game.tool === 'erase';
    }

    private cell(e: PointerEvent) {
        return this.game.sceneView.cellFromClient(e.clientX, e.clientY);
    }

    private onDown(e: PointerEvent): void {
        this.downX = e.clientX;
        this.downY = e.clientY;
        if (e.button !== 0) return;

        // Edit mode: left button edits voxels (camera orbit stays on right-drag).
        if (this.game.mode === 'edit') {
            this.editing = true;
            this.lastEditX = e.clientX;
            this.lastEditY = e.clientY;
            this.game.beginEditStroke();
            this.game.editAt(e.clientX, e.clientY, e.shiftKey || e.altKey);
            return;
        }

        // Build mode: left button paints cells (the camera owns it in pan mode).
        if (this.isBrushTool()) {
            this.brushing = true;
            this.lastBrushKey = null;
            this.game.beginStroke();
            this.brush(e);
        }
    }

    private onMove(e: PointerEvent): void {
        if (this.game.mode === 'edit') {
            // Debounce: only edit once the cursor has travelled past the
            // threshold, so a press doesn't cascade through voxels.
            if (
                this.editing &&
                Math.hypot(
                    e.clientX - this.lastEditX,
                    e.clientY - this.lastEditY
                ) > EDIT_MOVE_THRESHOLD
            ) {
                this.lastEditX = e.clientX;
                this.lastEditY = e.clientY;
                this.game.editAt(e.clientX, e.clientY, e.shiftKey || e.altKey);
            }
            return;
        }
        const c = this.cell(e);
        this.game.onHover(c);
        if (this.brushing && c) this.brush(e);
    }

    private onUp(e: PointerEvent): void {
        if (this.game.mode === 'edit') {
            this.editing = false;
            return;
        }
        const moved =
            Math.hypot(e.clientX - this.downX, e.clientY - this.downY) >
            TAP_SLOP;
        if (this.brushing) {
            this.brushing = false;
            this.lastBrushKey = null;
            this.game.endStroke();
            return;
        }
        // Right-click (no drag) erases; right-drag is an orbit and is ignored.
        if (e.button === 2 && !moved) {
            const c = this.cell(e);
            if (c) {
                this.game.beginStroke();
                this.game.eraseCell(c.gx, c.gy);
                this.game.endStroke();
            }
        }
    }

    private brush(e: PointerEvent): void {
        const c = this.cell(e);
        if (!c) return;
        const key = `${c.gx},${c.gy}`;
        if (key === this.lastBrushKey) return;
        this.lastBrushKey = key;
        this.game.onPrimaryClick(c.gx, c.gy);
    }

    private onWheel(e: WheelEvent): void {
        // Free wheel zooms (handled by OrbitControls). Ctrl/Cmd + wheel rotates
        // the tile brush while placing; we intercept only that case.
        if (this.game.mode !== 'build' || this.game.tool !== 'place') return;
        if (!e.ctrlKey && !e.metaKey) return;
        e.preventDefault();
        e.stopPropagation();
        this.game.rotateBrush(e.deltaY > 0 ? 1 : 3);
    }

    private onKey(e: KeyboardEvent): void {
        if (
            e.target instanceof HTMLInputElement ||
            e.target instanceof HTMLTextAreaElement
        ) {
            return;
        }
        // Tile-editor mode: only the per-voxel tool shortcuts apply.
        if (this.game.mode === 'edit') {
            const ed = this.game.editor;
            if (!ed || e.ctrlKey || e.metaKey) return;
            const tool = EDIT_KEYS[e.key.toLowerCase()];
            if (tool) {
                ed.setTool(tool);
                e.preventDefault();
            }
            return;
        }

        // Undo / redo.
        if (e.ctrlKey || e.metaKey) {
            const k = e.key.toLowerCase();
            if (k === 'z' && !e.shiftKey) {
                this.game.undo();
                e.preventDefault();
            } else if ((k === 'z' && e.shiftKey) || k === 'y') {
                this.game.redo();
                e.preventDefault();
            }
            return;
        }

        // Spacebar → temporary pan; reverted on key release.
        if (e.code === 'Space') {
            if (!e.repeat && this.game.tool !== 'pan') {
                this.spacePrevTool = this.game.tool;
                this.game.setTool('pan');
            }
            e.preventDefault();
            return;
        }

        const k = e.key.toLowerCase();
        const num = Number(k);
        if (num >= 1 && num <= CATEGORIES.length) {
            this.game.setCategory(CATEGORIES[num - 1]!);
            e.preventDefault();
            return;
        }
        switch (k) {
            case 'p':
                this.game.setTool('place');
                break;
            case 'e':
                this.game.setTool(
                    this.game.tool === 'erase' ? 'place' : 'erase'
                );
                break;
            case 'h':
                this.game.setTool(this.game.tool === 'pan' ? 'place' : 'pan');
                break;
            case 'r':
                this.game.rotateBrush(1);
                break;
            case 'o':
                this.game.toggleAutoRotate();
                break;
            case 'f':
                this.game.fillTerrain();
                break;
            case 'g':
                this.game.toggleGrid();
                break;
            case 's':
                this.game.save();
                break;
            case 'x':
                this.game.exportScene();
                break;
            default:
                return;
        }
        e.preventDefault();
    }

    private onKeyUp(e: KeyboardEvent): void {
        if (e.code === 'Space' && this.spacePrevTool) {
            this.game.setTool(this.spacePrevTool);
            this.spacePrevTool = null;
            e.preventDefault();
        }
    }
}
