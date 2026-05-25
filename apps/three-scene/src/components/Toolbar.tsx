import type { ReactNode } from 'react';

import { reloadCatalogFlow } from '@/actions';
import { getEngine } from '@/bootstrap';
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useEngineSelector } from '@/store';

/** 24×24 stroke glyphs, one visual language for the rail. */
const ICONS: Record<string, ReactNode> = {
    place: (
        <>
            <path d="M12 2C8.7 2 6 4.7 6 8c0 4.5 6 12 6 12s6-7.5 6-12c0-3.3-2.7-6-6-6z" />
            <circle cx="12" cy="8" r="2.2" fill="#fff" />
        </>
    ),
    erase: (
        <>
            <path d="M4 15.5 12 7.5l5 5-5 5H7z" />
            <path d="M9 20h11" />
        </>
    ),
    pan: (
        <>
            <path d="M12 3v18M3 12h18" />
            <path d="M12 3 9.5 5.5M12 3l2.5 2.5M12 21l-2.5-2.5M12 21l2.5-2.5M3 12l2.5-2.5M3 12l2.5 2.5M21 12l-2.5-2.5M21 12l-2.5 2.5" />
        </>
    ),
    rotate: (
        <>
            <rect x="8.5" y="9" width="7" height="7" rx="1" />
            <path d="M5 9a8 8 0 0 1 13-2.5" />
            <path d="M18 2.5v4h-4" />
        </>
    ),
    fill: (
        <>
            <path d="M5 9l6-6 7 7-6 6a2 2 0 0 1-2.8 0L5 11.8A2 2 0 0 1 5 9z" />
            <path d="M19 14s2 2.5 2 4a2 2 0 1 1-4 0c0-1.5 2-4 2-4z" />
        </>
    ),
    undo: (
        <>
            <path d="M9 14 4 9l5-5" />
            <path d="M4 9h11a6 6 0 0 1 0 12H9" />
        </>
    ),
    redo: (
        <>
            <path d="M15 14l5-5-5-5" />
            <path d="M20 9H9a6 6 0 0 0 0 12h6" />
        </>
    ),
    orbit: (
        <>
            <circle cx="12" cy="12" r="3" />
            <path d="M12 3a9 9 0 0 1 8 5M21 9l-1 -1l-2 1M12 21a9 9 0 0 1-8-5M3 15l1 1l2-1" />
        </>
    ),
    grid: (
        <>
            <path d="M4 4h16v16H4z" />
            <path d="M9 4v16M15 4v16M4 9h16M4 15h16" />
        </>
    ),
    save: (
        <>
            <path d="M5 4h11l3 3v13H5z" />
            <path d="M8 4v5h7V4M8 20v-6h8v6" />
        </>
    ),
    export: (
        <>
            <path d="M12 3v12M8 11l4 4 4-4" />
            <path d="M5 17v2a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2" />
        </>
    ),
    reset: (
        <>
            <path d="M19 12a7 7 0 1 1-2.3-5.2" />
            <path d="M19 4v4h-4" />
        </>
    ),
    sync: (
        <>
            <path d="M21 12a9 9 0 0 0-9-9 9 9 0 0 0-6.2 2.5L3 8" />
            <path d="M3 3v5h5" />
            <path d="M3 12a9 9 0 0 0 9 9 9 9 0 0 0 6.2-2.5L21 16" />
            <path d="M16 16h5v5" />
        </>
    )
};

interface ToolButtonProps {
    icon: ReactNode;
    label: string;
    title: string;
    active?: boolean;
    disabled?: boolean;
    onClick: () => void;
}

function ToolButton({
    icon,
    label,
    title,
    active = false,
    disabled = false,
    onClick
}: ToolButtonProps): React.JSX.Element {
    return (
        <Tooltip>
            <TooltipTrigger
                type="button"
                onClick={onClick}
                disabled={disabled}
                className={cn(
                    'flex h-[50px] w-[52px] shrink-0 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-xl border-[1.5px] border-transparent bg-transparent transition-[background,border-color,transform] duration-100',
                    'hover:bg-[rgba(27,91,168,0.08)] active:scale-95',
                    'disabled:pointer-events-none disabled:opacity-30',
                    active && 'border-ink bg-[rgba(27,91,168,0.14)]'
                )}
            >
                <svg
                    className="h-[26px] w-[26px]"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#1b5ba8"
                    strokeWidth={1.8}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                >
                    {icon}
                </svg>
                <span className="text-[10px] font-semibold tracking-[0.2px] text-ink-deep">
                    {label}
                </span>
            </TooltipTrigger>
            <TooltipContent side="right">{title}</TooltipContent>
        </Tooltip>
    );
}

/** Left-rail build-mode tools. Reads engine state; actions call engine intents. */
export function Toolbar(): React.JSX.Element {
    const { game } = getEngine();
    const tool = useEngineSelector(() => game.tool);
    const rotation = useEngineSelector(() => game.rotation);
    const gridVisible = useEngineSelector(() => game.gridVisible);
    const autoRotate = useEngineSelector(() => game.autoRotate);
    const canUndo = useEngineSelector(() => game.canUndo);
    const canRedo = useEngineSelector(() => game.canRedo);

    return (
        <aside className="fixed left-4 top-4 bottom-[calc(1.5rem+40px)] z-10 flex max-h-[calc(100vh-28px)] flex-col gap-1.5 overflow-y-auto rounded-lg bg-panel p-2 shadow-panel backdrop-blur-[8px] [scrollbar-width:thin]">
            <ToolButton
                icon={ICONS.place}
                label="Place"
                title="Place terrain (P)"
                active={tool === 'place'}
                onClick={() => game.setTool('place')}
            />
            <ToolButton
                icon={ICONS.erase}
                label="Erase"
                title="Erase cell (E)"
                active={tool === 'erase'}
                onClick={() => game.setTool('erase')}
            />
            <ToolButton
                icon={ICONS.pan}
                label="Pan"
                title="Pan camera (H, or hold Space)"
                active={tool === 'pan'}
                onClick={() => game.setTool('pan')}
            />
            <ToolButton
                icon={ICONS.rotate}
                label={`${rotation * 90}°`}
                title="Rotate tile (R, or Ctrl+Wheel)"
                onClick={() => game.rotateBrush(1)}
            />
            <ToolButton
                icon={ICONS.fill}
                label="Fill"
                title="Fill empty cells (F)"
                onClick={() => game.fillTerrain()}
            />
            <ToolButton
                icon={ICONS.undo}
                label="Undo"
                title="Undo (Ctrl+Z)"
                disabled={!canUndo}
                onClick={() => game.undo()}
            />
            <ToolButton
                icon={ICONS.redo}
                label="Redo"
                title="Redo (Ctrl+Shift+Z)"
                disabled={!canRedo}
                onClick={() => game.redo()}
            />
            <ToolButton
                icon={ICONS.orbit}
                label="Orbit"
                title="Auto-rotate camera (O)"
                active={autoRotate}
                onClick={() => game.toggleAutoRotate()}
            />
            <ToolButton
                icon={ICONS.grid}
                label="Grid"
                title="Toggle grid (G)"
                active={gridVisible}
                onClick={() => game.toggleGrid()}
            />
            <ToolButton
                icon={ICONS.save}
                label="Save"
                title="Save scene (S)"
                onClick={() => game.save()}
            />
            <ToolButton
                icon={ICONS.export}
                label="Export"
                title="Export scene .vox (X)"
                onClick={() => game.exportScene()}
            />
            <ToolButton
                icon={ICONS.sync}
                label="Sync"
                title="Reload tile catalog from disk"
                onClick={() => void reloadCatalogFlow()}
            />
            <ToolButton
                icon={ICONS.reset}
                label="Reset"
                title="Reset scene"
                onClick={() => game.reset()}
            />
        </aside>
    );
}
