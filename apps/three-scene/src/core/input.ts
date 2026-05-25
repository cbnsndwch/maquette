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
    s: 'select',
    f: 'face-select'
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
    /** True while Space holds a temporary left-drag pan in tile-edit mode. */
    private editPanning = false;

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
            // Space held → the left button is the camera's pan (OrbitControls).
            if (this.editPanning) return;
            this.editing = true;
            this.lastEditX = e.clientX;
            this.lastEditY = e.clientY;
            this.game.beginEditStroke();
            this.game.editAt(e.clientX, e.clientY, e.altKey, e.shiftKey);
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
                this.game.editAt(e.clientX, e.clientY, e.altKey, e.shiftKey);
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
            if (e.button === 2 && !this.editPanning) this.inverseClick(e);
            else this.game.endEditStroke();
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

    /**
     * Right-click (no drag) in edit mode inverts the sculpt tool: Add removes,
     * Delete adds. A right-*drag* is a camera orbit, so we only act within the tap
     * slop; with a live selection the right-click belongs to the context menu.
     */
    private inverseClick(e: PointerEvent): void {
        const ed = this.game.editor;
        if (!ed || ed.selection.size > 0) return;
        const moved =
            Math.hypot(e.clientX - this.downX, e.clientY - this.downY) >
            TAP_SLOP;
        if (moved) return;
        const inverse =
            ed.tool === 'add' ? 'delete' : ed.tool === 'delete' ? 'add' : null;
        if (!inverse) return;
        this.game.beginEditStroke();
        this.game.editAt(e.clientX, e.clientY, false, false, inverse);
        this.game.endEditStroke();
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
        // Tile-editor mode: undo/redo, per-voxel tool shortcuts, hold-Space pan.
        if (this.game.mode === 'edit') {
            const ed = this.game.editor;
            if (!ed) return;
            if (e.ctrlKey || e.metaKey) {
                const k = e.key.toLowerCase();
                if (k === 'z' && !e.shiftKey) {
                    ed.undo();
                    e.preventDefault();
                } else if ((k === 'z' && e.shiftKey) || k === 'y') {
                    ed.redo();
                    e.preventDefault();
                }
                return;
            }
            if (e.code === 'Space') {
                if (!e.repeat && !this.editPanning) {
                    this.editPanning = true;
                    this.editing = false; // drop any in-progress brush stroke
                    this.game.setEditPan(true);
                }
                e.preventDefault();
                return;
            }
            if (e.code === 'KeyV' && !e.repeat) {
                ed.setSelectionPeek(true);
                e.preventDefault();
                return;
            }
            if (
                (e.key === 'Delete' || e.key === 'Backspace') &&
                ed.selection.size > 0
            ) {
                ed.deleteSelection();
                e.preventDefault();
                return;
            }
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
        if (this.game.mode === 'edit' && e.code === 'KeyV') {
            this.game.editor?.setSelectionPeek(false);
            e.preventDefault();
            return;
        }
        if (e.code !== 'Space') return;
        if (this.editPanning) {
            this.editPanning = false;
            this.game.setEditPan(false);
            e.preventDefault();
        } else if (this.spacePrevTool) {
            this.game.setTool(this.spacePrevTool);
            this.spacePrevTool = null;
            e.preventDefault();
        }
    }
}
