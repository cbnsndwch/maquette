import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { getEngine } from '@/bootstrap';
import { cn } from '@/lib/utils';
import { useEngineSelector } from '@/store';

const DRAG_SLOP = 5; // px; a right-drag past this is an orbit, not a menu open

const MOVES: [string, number, number, number][] = [
    ['-X', -1, 0, 0],
    ['+X', 1, 0, 0],
    ['-Y', 0, -1, 0],
    ['+Y', 0, 1, 0],
    ['-Z', 0, 0, -1],
    ['+Z', 0, 0, 1]
];

/**
 * Right-click context menu for the editor's multi-voxel selection: Delete /
 * Recolor / Move. A right-*drag* orbits the camera, so the menu is suppressed
 * once the pointer travels past {@link DRAG_SLOP}. Most actions keep the menu
 * open (only Delete and outside-interaction dismiss it), so this is a plain
 * cursor-anchored menu rather than a Base UI Menu (whose items auto-close).
 */
export function EditContextMenu(): React.JSX.Element | null {
    const { game, editor, sceneView } = getEngine();
    const selectionSize = useEngineSelector(() => editor.selection.size);

    const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const down = useRef({ x: 0, y: 0 });

    // Open on a (non-drag) right-click over a selection; dismiss on outside
    // pointerdown, Escape, or wheel.
    useEffect(() => {
        const canvas = sceneView.renderer.domElement;
        const onPointerDown = (e: PointerEvent): void => {
            if (e.button === 2) down.current = { x: e.clientX, y: e.clientY };
        };
        const onContextMenu = (e: MouseEvent): void => {
            if (game.mode !== 'edit' || editor.selection.size === 0) return;
            if (
                Math.hypot(
                    e.clientX - down.current.x,
                    e.clientY - down.current.y
                ) > DRAG_SLOP
            ) {
                return; // a right-drag is a camera orbit
            }
            e.preventDefault();
            setPos({ x: e.clientX, y: e.clientY });
        };
        const onWindowDown = (e: PointerEvent): void => {
            if (
                menuRef.current &&
                !menuRef.current.contains(e.target as Node)
            ) {
                setPos(null);
            }
        };
        const onKey = (e: KeyboardEvent): void => {
            if (e.key === 'Escape') setPos(null);
        };
        const onWheel = (): void => setPos(null);

        canvas.addEventListener('pointerdown', onPointerDown);
        canvas.addEventListener('contextmenu', onContextMenu);
        window.addEventListener('pointerdown', onWindowDown);
        window.addEventListener('keydown', onKey);
        window.addEventListener('wheel', onWheel, { passive: true });
        return () => {
            canvas.removeEventListener('pointerdown', onPointerDown);
            canvas.removeEventListener('contextmenu', onContextMenu);
            window.removeEventListener('pointerdown', onWindowDown);
            window.removeEventListener('keydown', onKey);
            window.removeEventListener('wheel', onWheel);
        };
    }, [game, editor, sceneView]);

    // Close if the selection emptied out from under an open menu.
    useEffect(() => {
        if (selectionSize === 0) setPos(null);
    }, [selectionSize]);

    // Clamp inside the viewport once the menu has a measured size.
    useLayoutEffect(() => {
        const el = menuRef.current;
        if (!el || !pos) return;
        const r = el.getBoundingClientRect();
        el.style.left = `${Math.max(8, Math.min(pos.x, window.innerWidth - r.width - 8))}px`;
        el.style.top = `${Math.max(8, Math.min(pos.y, window.innerHeight - r.height - 8))}px`;
    }, [pos]);

    if (!pos) return null;

    const itemCls =
        'flex cursor-pointer items-center justify-between gap-2 rounded-lg bg-transparent px-2.5 py-[7px] text-left text-[13px] font-semibold text-ink-deep hover:bg-[rgba(27,91,168,0.1)]';

    return (
        <div
            ref={menuRef}
            className="fixed z-50 flex min-w-[168px] flex-col gap-0.5 rounded-xl bg-panel p-1.5 text-[13px] shadow-panel backdrop-blur-[8px]"
            style={{ left: pos.x, top: pos.y }}
        >
            <div className="px-2 py-1 text-[11px] font-bold uppercase tracking-[0.4px] text-ink-deep opacity-60">
                {selectionSize} selected
            </div>
            <button
                type="button"
                onClick={() => {
                    editor.deleteSelection();
                    setPos(null);
                }}
                className={cn(
                    itemCls,
                    'text-[#b3403f] hover:bg-[rgba(216,91,91,0.14)]'
                )}
            >
                Delete
            </button>
            <label className={itemCls}>
                Recolor
                <input
                    type="color"
                    aria-label="Recolor selection"
                    defaultValue={editor.activeColor}
                    onInput={e =>
                        editor.recolorSelection(
                            (e.target as HTMLInputElement).value
                        )
                    }
                    className="h-5 w-7 cursor-pointer border-none bg-none p-0"
                />
            </label>
            <div className="px-2.5 pb-0.5 pt-1 text-[11px] font-bold uppercase tracking-[0.4px] opacity-60">
                Move
            </div>
            <div className="grid grid-cols-2 gap-1 px-1.5 pb-1 pt-0.5">
                {MOVES.map(([label, dx, dy, dz]) => (
                    <button
                        key={label}
                        type="button"
                        onClick={() => editor.moveSelection(dx, dy, dz)}
                        className="cursor-pointer rounded-lg border border-[rgba(27,91,168,0.25)] bg-white/60 py-1.5 text-xs font-bold text-ink-deep hover:bg-[rgba(27,91,168,0.12)]"
                    >
                        {label}
                    </button>
                ))}
            </div>
        </div>
    );
}
