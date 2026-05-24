import { Accordion } from '@base-ui-components/react/accordion';
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router';

import { getEngine } from '@/bootstrap';
import {
    assetsForCategory,
    CATEGORIES,
    TERRAIN_MANIFEST,
    type TerrainDef
} from '@cbnsndwch/scene-author';
import { cn } from '@/lib/utils';
import { useEngineSelector } from '@/store';

function Swatch({
    def,
    thumb,
    selected,
    onSelect
}: {
    def: TerrainDef;
    thumb: string | undefined;
    selected: boolean;
    onSelect: () => void;
}): React.JSX.Element {
    return (
        <button
            type="button"
            onClick={onSelect}
            className={cn(
                'flex cursor-pointer flex-col items-center gap-1 rounded-xl border-[1.5px] border-transparent bg-white/55 p-1.5 transition-[border-color,transform,background] duration-100',
                'hover:bg-white/85 active:scale-[0.96]',
                selected && 'border-ink bg-[rgba(27,91,168,0.08)]'
            )}
        >
            {thumb ? (
                <img
                    className="aspect-square w-full rounded-lg"
                    src={thumb}
                    alt={def.name}
                />
            ) : (
                <div className="aspect-square w-full rounded-lg" />
            )}
            <span className="text-[11px] font-semibold capitalize text-ink-deep">
                {def.name}
            </span>
        </button>
    );
}

const SearchIcon = (
    <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="#1b5ba8"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-[18px] w-[18px]"
        aria-hidden="true"
    >
        <circle cx="11" cy="11" r="7" />
        <path d="M21 21l-4.3-4.3" />
    </svg>
);

const TileIcon = (
    <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="#1b5ba8"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-[18px] w-[18px]"
        aria-hidden="true"
    >
        <path d="M12 2 3 7v10l9 5 9-5V7z" />
        <path d="M3 7l9 5 9-5M12 12v10" />
    </svg>
);

/** Right-dock palette: collapsible, one accordion per category. */
export function Palette(): React.JSX.Element {
    const { game, thumbnails } = getEngine();
    const navigate = useNavigate();

    const category = useEngineSelector(() => game.category);
    const selectedAssetId = useEngineSelector(() => game.selectedAssetId);
    // Re-render when the catalog grows/shrinks (tiles added or deleted).
    useEngineSelector(() => TERRAIN_MANIFEST.length);

    const [collapsed, setCollapsed] = useState(false);
    const [open, setOpen] = useState<string[]>([category]);

    // Keep the active category revealed (e.g. after a 1–4 key switch or a save).
    const prevCategory = useRef(category);
    if (prevCategory.current !== category) {
        prevCategory.current = category;
        setOpen(o => (o.includes(category) ? o : [...o, category]));
    }

    return (
        <section className="fixed right-[14px] top-[14px] z-10 flex max-h-[calc(100vh-28px)] w-[212px] flex-col overflow-hidden rounded-lg bg-panel shadow-panel backdrop-blur-[8px]">
            <header className="flex items-center bg-[rgba(27,91,168,0.08)]">
                <button
                    type="button"
                    aria-expanded={!collapsed}
                    onClick={() => setCollapsed(c => !c)}
                    className="flex flex-1 cursor-pointer items-center gap-2 px-3.5 py-[11px] text-[13px] font-bold tracking-[0.2px] text-ink-deep"
                >
                    <span
                        aria-hidden="true"
                        className={cn(
                            'opacity-70 transition-transform duration-200',
                            collapsed ? 'rotate-0' : 'rotate-90'
                        )}
                    >
                        ▸
                    </span>
                    <span>Palette</span>
                </button>
                <div className="flex gap-1 pr-2">
                    <button
                        type="button"
                        title="Inspect tiles"
                        aria-label="Inspect tiles"
                        onClick={() => navigate('/inspect')}
                        className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border-[1.5px] border-transparent transition-[background,border-color] duration-100 hover:bg-[rgba(27,91,168,0.14)]"
                    >
                        {SearchIcon}
                    </button>
                    <button
                        type="button"
                        title="New tile editor"
                        aria-label="New tile editor"
                        onClick={() => navigate('/tile')}
                        className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border-[1.5px] border-transparent transition-[background,border-color] duration-100 hover:bg-[rgba(27,91,168,0.14)]"
                    >
                        {TileIcon}
                    </button>
                </div>
            </header>

            {!collapsed && (
                <Accordion.Root
                    value={open}
                    onValueChange={v => setOpen(v as string[])}
                    multiple
                    className="flex min-h-0 flex-col overflow-y-auto [scrollbar-width:thin]"
                >
                    {CATEGORIES.map((c, i) => {
                        const items = assetsForCategory(c);
                        const isOpen = open.includes(c);
                        return (
                            <Accordion.Item
                                key={c}
                                value={c}
                                className={cn(
                                    i > 0 &&
                                        'border-t border-[rgba(27,91,168,0.08)]'
                                )}
                            >
                                <Accordion.Header>
                                    <Accordion.Trigger className="flex w-full cursor-pointer items-center gap-2 px-3 py-[9px] text-xs font-bold text-ink-deep hover:bg-[rgba(27,91,168,0.06)]">
                                        <span
                                            className={cn(
                                                'flex-1 text-left',
                                                c === category && 'text-ink'
                                            )}
                                        >
                                            {c[0]!.toUpperCase() + c.slice(1)}
                                        </span>
                                        <span className="rounded-full bg-[rgba(27,91,168,0.1)] px-[7px] py-px text-[11px] font-semibold opacity-70">
                                            {items.length}
                                        </span>
                                        <span
                                            className={cn(
                                                'opacity-60 transition-transform duration-200',
                                                isOpen && 'rotate-90'
                                            )}
                                            aria-hidden="true"
                                        >
                                            ▸
                                        </span>
                                    </Accordion.Trigger>
                                </Accordion.Header>
                                <Accordion.Panel>
                                    {items.length === 0 ? (
                                        <div className="flex items-center justify-center px-2 py-[18px] text-center text-xs italic opacity-50">
                                            No tiles yet
                                        </div>
                                    ) : (
                                        <div className="grid grid-cols-2 gap-2 px-3 pb-3 pt-1">
                                            {items.map(def => (
                                                <Swatch
                                                    key={def.id}
                                                    def={def}
                                                    thumb={thumbnails.get(
                                                        def.id
                                                    )}
                                                    selected={
                                                        def.id ===
                                                        selectedAssetId
                                                    }
                                                    onSelect={() =>
                                                        game.selectAsset(def.id)
                                                    }
                                                />
                                            ))}
                                        </div>
                                    )}
                                </Accordion.Panel>
                            </Accordion.Item>
                        );
                    })}
                </Accordion.Root>
            )}
        </section>
    );
}
