import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';

import { deleteTileFlow } from '@/actions';
import { getEngine } from '@/bootstrap';
import {
    assetsForCategory,
    CATEGORIES,
    TERRAIN_MANIFEST,
    type TerrainDef
} from '@/config';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { useEngineSelector } from '@/store';

const ED_BTN =
    'flex-1 cursor-pointer rounded-[10px] border-[1.5px] border-ink bg-transparent px-2 py-2 text-xs font-semibold text-ink-deep hover:bg-[rgba(27,91,168,0.08)]';

function TileCard({
    def,
    thumb,
    onOpen
}: {
    def: TerrainDef;
    thumb: string | undefined;
    onOpen: () => void;
}): React.JSX.Element {
    return (
        <button
            type="button"
            onClick={onOpen}
            className="flex cursor-pointer flex-col gap-1.5 rounded-xl border-[1.5px] border-transparent bg-white/70 p-2.5 transition-[border-color,transform] duration-100 hover:border-ink active:scale-[0.97]"
        >
            <img
                src={thumb}
                alt={def.name}
                className="aspect-square w-full rounded-lg bg-black/[0.03]"
            />
            <span className="text-xs font-semibold capitalize text-ink-deep">
                {def.name}
            </span>
        </button>
    );
}

function TileDetailModal({
    def,
    onClose,
    onEdit,
    onDelete
}: {
    def: TerrainDef;
    onClose: () => void;
    onEdit: () => void;
    onDelete: () => void;
}): React.JSX.Element {
    const { assets, thumbnails } = getEngine();
    const [dx, dy, dz] = assets.dims(def.id);
    const voxelCount = assets.get(def.id).length;
    const thumb = thumbnails.get(def.id);

    return (
        <Dialog open onOpenChange={o => !o && onClose()}>
            <DialogContent className="max-h-[88vh] w-[min(560px,92vw)] overflow-y-auto">
                <DialogTitle className="sr-only">{def.name}</DialogTitle>
                <div className="flex gap-[18px]">
                    <img
                        src={thumb}
                        alt={def.name}
                        className="h-[200px] w-[200px] shrink-0 rounded-xl bg-black/[0.04]"
                    />
                    <div>
                        <h3 className="mb-2.5 text-[20px] capitalize text-ink-deep">
                            {def.name}
                        </h3>
                        <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3.5 gap-y-[5px] text-[13px]">
                            <dt className="font-bold opacity-60">ID</dt>
                            <dd className="m-0 text-ink-deep">{def.id}</dd>
                            <dt className="font-bold opacity-60">Category</dt>
                            <dd className="m-0 text-ink-deep">
                                {def.category}
                            </dd>
                            <dt className="font-bold opacity-60">Stackable</dt>
                            <dd className="m-0 text-ink-deep">
                                {def.stackable ? 'Yes' : 'No'}
                            </dd>
                            <dt className="font-bold opacity-60">Voxels</dt>
                            <dd className="m-0 text-ink-deep">{voxelCount}</dd>
                            <dt className="font-bold opacity-60">Size</dt>
                            <dd className="m-0 text-ink-deep">
                                {dx} × {dy} × {dz}
                            </dd>
                        </dl>
                    </div>
                </div>
                <div className="flex justify-end gap-2">
                    <button
                        type="button"
                        onClick={onDelete}
                        className={cn(
                            ED_BTN,
                            'border-[#d85b5b] text-[#b3403f] hover:bg-[rgba(216,91,91,0.12)]'
                        )}
                    >
                        Delete
                    </button>
                    <button type="button" onClick={onClose} className={ED_BTN}>
                        Close
                    </button>
                    <button
                        type="button"
                        onClick={onEdit}
                        className={cn(
                            ED_BTN,
                            'bg-ink text-white hover:bg-ink-deep'
                        )}
                    >
                        Edit
                    </button>
                </div>
            </DialogContent>
        </Dialog>
    );
}

/** Full-screen tile library (the /inspect route). */
export function Inspector(): React.JSX.Element {
    const { thumbnails } = getEngine();
    const navigate = useNavigate();
    const [selected, setSelected] = useState<TerrainDef | null>(null);
    // Re-render after a delete changes the catalog.
    useEngineSelector(() => TERRAIN_MANIFEST.length);

    // Escape leaves the overlay (the modal handles its own Escape when open).
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && !selected) navigate('/');
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [selected, navigate]);

    return (
        <section className="fixed inset-0 z-40 flex flex-col bg-[rgba(244,236,217,0.96)] backdrop-blur-[4px]">
            <header className="flex items-baseline gap-3 border-b border-[rgba(27,91,168,0.15)] px-[22px] py-4">
                <h2 className="text-[18px] text-ink-deep">Tile Library</h2>
                <span className="text-xs opacity-60">
                    Click a tile for details
                </span>
                <button
                    type="button"
                    onClick={() => navigate('/')}
                    className={cn(ED_BTN, 'ml-auto flex-none px-3')}
                >
                    Close
                </button>
            </header>

            <div className="mx-auto w-full max-w-[980px] flex-1 overflow-y-auto px-[22px] pb-10 pt-[18px]">
                {CATEGORIES.map(c => {
                    const items = assetsForCategory(c);
                    return (
                        <details
                            key={c}
                            open={items.length > 0}
                            className="mb-3 overflow-hidden rounded-xl border border-[rgba(27,91,168,0.12)] bg-white/50 [&[open]_.insp-chev]:rotate-90"
                        >
                            <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-bold capitalize text-ink-deep hover:bg-[rgba(27,91,168,0.06)]">
                                <span>{c}</span>
                                <span className="rounded-full bg-[rgba(27,91,168,0.1)] px-[7px] py-px text-[11px] font-semibold opacity-70">
                                    {items.length}
                                </span>
                                <span
                                    className="insp-chev ml-auto opacity-60 transition-transform duration-200"
                                    aria-hidden="true"
                                >
                                    ▸
                                </span>
                            </summary>
                            {items.length === 0 ? (
                                <div className="p-3.5 italic opacity-50">
                                    No tiles in this category
                                </div>
                            ) : (
                                <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-3 p-3.5">
                                    {items.map(def => (
                                        <TileCard
                                            key={def.id}
                                            def={def}
                                            thumb={thumbnails.get(def.id)}
                                            onOpen={() => setSelected(def)}
                                        />
                                    ))}
                                </div>
                            )}
                        </details>
                    );
                })}
            </div>

            {selected && (
                <TileDetailModal
                    def={selected}
                    onClose={() => setSelected(null)}
                    onEdit={() => navigate(`/tile/${selected.id}`)}
                    onDelete={() => {
                        void deleteTileFlow(selected.id);
                        setSelected(null);
                    }}
                />
            )}
        </section>
    );
}
