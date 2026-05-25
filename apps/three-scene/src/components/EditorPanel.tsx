import { Accordion } from '@base-ui-components/react/accordion';
import { type ReactNode, useRef, useState } from 'react';
import { useNavigate } from 'react-router';

import { saveTileFlow } from '@/actions';
import { getEngine } from '@/bootstrap';
import {
    CATEGORIES,
    type Category,
    type TerrainDef
} from '@cbnsndwch/scene-author';
import type { EditTool } from '@/core/tile-editor';
import type { TileMeta } from '@/core/tile-save';
import { cn } from '@/lib/utils';
import { useEngineSelector } from '@/store';

const TOOLS: { id: EditTool; label: string; key: string }[] = [
    { id: 'add', label: 'Add', key: 'A' },
    { id: 'delete', label: 'Delete', key: 'D' },
    { id: 'paint', label: 'Paint', key: 'P' },
    { id: 'eyedropper', label: 'Pick', key: 'I' },
    { id: 'select', label: 'Select', key: 'S' }
];

const ED_BTN =
    'flex-1 cursor-pointer rounded-[10px] border-[1.5px] border-ink bg-transparent p-2 text-xs font-semibold text-ink-deep hover:bg-[rgba(27,91,168,0.08)] disabled:cursor-default disabled:opacity-30';

function EdBtn({
    className,
    ...props
}: React.ComponentProps<'button'>): React.JSX.Element {
    return (
        <button type="button" className={cn(ED_BTN, className)} {...props} />
    );
}

function EdTool({
    label,
    title,
    active,
    onClick
}: {
    label: string;
    title: string;
    active?: boolean;
    onClick: () => void;
}): React.JSX.Element {
    return (
        <button
            type="button"
            title={title}
            onClick={onClick}
            className={cn(
                'cursor-pointer rounded-[10px] border-[1.5px] border-transparent bg-white/55 px-1 py-2 text-xs font-semibold text-ink-deep hover:bg-white/85',
                active && 'border-ink bg-[rgba(27,91,168,0.12)]'
            )}
        >
            {label}
        </button>
    );
}

/** ±-stepper row (floor / spread / explode / focus). */
function Stepper({
    value,
    onDown,
    onUp,
    downTitle,
    upTitle
}: {
    value: string;
    onDown: () => void;
    onUp: () => void;
    downTitle: string;
    upTitle: string;
}): React.JSX.Element {
    const stepBtn = 'flex-[0_0_38px] px-0 py-[5px] text-base leading-none';
    return (
        <div className="flex items-center gap-1.5">
            <EdBtn className={stepBtn} title={downTitle} onClick={onDown}>
                −
            </EdBtn>
            <span className="flex-1 text-center text-xs font-bold text-ink-deep">
                {value}
            </span>
            <EdBtn className={stepBtn} title={upTitle} onClick={onUp}>
                +
            </EdBtn>
        </div>
    );
}

function Section({
    value,
    title,
    children
}: {
    value: string;
    title: string;
    children: ReactNode;
}): React.JSX.Element {
    return (
        <Accordion.Item
            value={value}
            className="border-b border-[rgba(27,91,168,0.12)] last:border-b-0"
        >
            <Accordion.Header>
                <Accordion.Trigger className="group flex w-full cursor-pointer items-center justify-between py-[7px] text-[11px] font-bold uppercase tracking-[0.4px] text-ink-deep opacity-65 aria-expanded:opacity-100">
                    <span>{title}</span>
                    <span
                        aria-hidden="true"
                        className="text-[10px] transition-transform duration-150 group-aria-expanded:rotate-90"
                    >
                        ▸
                    </span>
                </Accordion.Trigger>
            </Accordion.Header>
            <Accordion.Panel className="flex flex-col gap-1.5 pb-2.5">
                {children}
            </Accordion.Panel>
        </Accordion.Item>
    );
}

const slug = (name: string): string =>
    name
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '_')
        .replace(/^_+|_+$/g, '');

/** Right-side tile editor panel: tools, geometry, shade, floor, view, import, save. */
export function EditorPanel({
    def
}: {
    def: TerrainDef | null;
}): React.JSX.Element {
    const { editor } = getEngine();
    const navigate = useNavigate();
    const voxFileRef = useRef<HTMLInputElement>(null);

    const tool = useEngineSelector(() => editor.tool);
    const canUndo = useEngineSelector(() => editor.canUndo);
    const canRedo = useEngineSelector(() => editor.canRedo);
    const selectionSize = useEngineSelector(() => editor.selection.size);
    const voxelCount = useEngineSelector(() => editor.voxels.length);
    const floorOffset = useEngineSelector(() => editor.floorOffset);
    const gridOn = useEngineSelector(() => editor.gridOn);
    const edgesOn = useEngineSelector(() => editor.edgesOn);
    const explode = useEngineSelector(() => editor.explode);
    const focusLayer = useEngineSelector(() => editor.focusLayer);
    const editingId = useEngineSelector(() => editor.editingId);

    const [spread, setSpreadRaw] = useState(30);
    const [shadeNotice, setShadeNotice] = useState<{
        msg: string;
        resolveLabel: string | null;
    } | null>(null);

    const [name, setName] = useState(def?.name ?? '');
    const [category, setCategory] = useState<Category>(
        def?.category ?? CATEGORIES[0]!
    );
    const [stackable, setStackable] = useState(
        def ? def.stackable : true // terrain default
    );
    const [footprint, setFootprintState] = useState<[number, number]>(
        def?.footprint ?? [1, 1]
    );

    /** Resize the author grid for a building footprint. */
    function setFootprint(w: number, d: number): void {
        const fp: [number, number] = [w, d];
        setFootprintState(fp);
        editor.setFootprint(fp);
    }

    const setSpread = (v: number): void =>
        setSpreadRaw(Math.max(0, Math.min(100, v)));

    function doShade(): void {
        if (editor.applyShading(spread)) {
            setShadeNotice(null);
            return;
        }
        const need = editor.shadeSlotsNeeded(spread);
        const free = editor.freeSlotCount();
        const unused = editor.unusedColorCount();
        setShadeNotice({
            msg:
                `Palette full: shading needs ${need} free slot${need === 1 ? '' : 's'}, ${free} available.` +
                (unused === 0 ? ' Clear some swatches first.' : ''),
            resolveLabel: unused > 0 ? `Trim ${unused} unused & retry` : null
        });
    }

    function resolveShade(): void {
        editor.removeUnusedColors();
        doShade();
    }

    async function importVox(file: File): Promise<void> {
        const ok = editor.importVoxBuffer(await file.arrayBuffer());
        if (!ok) return;
        setName(file.name.replace(/\.vox$/i, ''));
        setCategory(CATEGORIES[0]!);
        setStackable(true);
    }

    function save(): void {
        const cleanName = name.trim() || 'untitled';
        const meta: TileMeta = {
            id: editingId ?? (slug(cleanName) || `tile_${Date.now()}`),
            name: cleanName,
            category,
            stackable,
            footprint: category === 'buildings' ? footprint : [1, 1]
        };
        void saveTileFlow(meta);
    }

    return (
        <section className="fixed right-[14px] top-4 bottom-4 z-10 flex w-[220px] flex-col overflow-y-auto rounded-2xl bg-panel p-[12px_14px] px-3.5 py-3 shadow-panel backdrop-blur-[8px] [scrollbar-width:thin]">
            <div className="mb-1 text-sm font-bold text-ink-deep">
                {editingId ? 'Edit Tile' : 'New Tile'}
            </div>

            <Accordion.Root multiple defaultValue={['tools', 'save']}>
                <Section value="tools" title="Tools">
                    <div className="grid grid-cols-2 gap-1.5">
                        {TOOLS.map(t => (
                            <EdTool
                                key={t.id}
                                label={t.label}
                                title={`${t.label} (${t.key})`}
                                active={tool === t.id}
                                onClick={() => editor.setTool(t.id)}
                            />
                        ))}
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                        <EdBtn
                            title="Undo (Ctrl+Z)"
                            disabled={!canUndo}
                            onClick={() => editor.undo()}
                        >
                            Undo
                        </EdBtn>
                        <EdBtn
                            title="Redo (Ctrl+Shift+Z)"
                            disabled={!canRedo}
                            onClick={() => editor.redo()}
                        >
                            Redo
                        </EdBtn>
                    </div>
                    <div className="text-[11px] opacity-60">
                        Hold Space to pan · right-click inverts Add/Delete
                    </div>
                </Section>

                <Section value="geometry" title="Geometry">
                    <div className="grid grid-cols-2 gap-1.5">
                        <EdBtn
                            title="Fill the buried base layers with the active color"
                            onClick={() => editor.fillBase()}
                        >
                            Fill base
                        </EdBtn>
                        <EdBtn
                            title="Remove hidden interior voxels (Hull)"
                            onClick={() => editor.hull()}
                        >
                            Hull
                        </EdBtn>
                    </div>
                    <div className="grid grid-cols-3 gap-1.5">
                        <EdBtn
                            title="Clear buried base layers"
                            onClick={() => editor.clearBase()}
                        >
                            Base
                        </EdBtn>
                        <EdBtn
                            title="Clear everything above ground"
                            onClick={() => editor.clearTop()}
                        >
                            Top
                        </EdBtn>
                        <EdBtn
                            title="Clear all voxels"
                            onClick={() => editor.clearAll()}
                        >
                            All
                        </EdBtn>
                    </div>
                    <EdBtn
                        title="Clear the current selection"
                        disabled={selectionSize === 0}
                        onClick={() => editor.clearSelection()}
                    >
                        Clear selection
                    </EdBtn>
                </Section>

                <Section value="shade" title="Shade">
                    <Stepper
                        value={`Spread ${spread}%`}
                        downTitle="Less shading variance"
                        upTitle="More shading variance"
                        onDown={() => setSpread(spread - 10)}
                        onUp={() => setSpread(spread + 10)}
                    />
                    <EdBtn
                        title="Shade voxels from the active color (normal distribution)"
                        onClick={doShade}
                    >
                        Shade from color
                    </EdBtn>
                    {shadeNotice && (
                        <div className="flex flex-col gap-1.5 rounded-[10px] border border-[rgba(216,91,91,0.4)] bg-[rgba(216,91,91,0.12)] px-2.5 py-2 text-[11px] leading-[1.35] text-[#8a3a3a]">
                            <span>{shadeNotice.msg}</span>
                            {shadeNotice.resolveLabel && (
                                <EdBtn onClick={resolveShade}>
                                    {shadeNotice.resolveLabel}
                                </EdBtn>
                            )}
                        </div>
                    )}
                </Section>

                <Section value="floor" title="Floor">
                    <Stepper
                        value={
                            floorOffset == null
                                ? 'Base —'
                                : `Base ${floorOffset > 0 ? '+' : ''}${floorOffset}`
                        }
                        downTitle="Lower the model (more buried)"
                        upTitle="Raise the model (less buried)"
                        onDown={() => editor.lowerFloor()}
                        onUp={() => editor.raiseFloor()}
                    />
                </Section>

                <Section value="view" title="View">
                    <div className="grid grid-cols-2 gap-1.5">
                        <EdTool
                            label="Grid"
                            title="Toggle floor grid"
                            active={gridOn}
                            onClick={() =>
                                editor.setGridVisible(!editor.gridOn)
                            }
                        />
                        <EdTool
                            label="Edges"
                            title="Toggle voxel edges"
                            active={edgesOn}
                            onClick={() =>
                                editor.setEdgesVisible(!editor.edgesOn)
                            }
                        />
                    </div>
                    <Stepper
                        value={`Explode ${explode}`}
                        downTitle="Less exploded spacing"
                        upTitle="More exploded spacing"
                        onDown={() => editor.lowerExplode()}
                        onUp={() => editor.raiseExplode()}
                    />
                    <Stepper
                        value={
                            focusLayer == null
                                ? 'Layer all'
                                : `Layer ${focusLayer}`
                        }
                        downTitle="Focus a lower layer (or show all)"
                        upTitle="Focus a higher layer"
                        onDown={() => editor.focusDown()}
                        onUp={() => editor.focusUp()}
                    />
                </Section>

                <Section value="import" title="Import">
                    <EdBtn
                        title="Import a MagicaVoxel .vox file as a new tile"
                        onClick={() => voxFileRef.current?.click()}
                    >
                        Import .vox file
                    </EdBtn>
                    <input
                        ref={voxFileRef}
                        type="file"
                        aria-label="Import .vox file"
                        accept=".vox,application/octet-stream"
                        hidden
                        onChange={e => {
                            const file = e.target.files?.[0];
                            e.target.value = '';
                            if (file) void importVox(file);
                        }}
                    />
                </Section>

                <Section value="save" title="Save as tile">
                    <input
                        type="text"
                        placeholder="tile name"
                        aria-label="Tile name"
                        value={name}
                        onChange={e => setName(e.target.value)}
                        className="w-full rounded-lg border border-[rgba(27,91,168,0.3)] bg-white/70 px-2 py-1.5 text-ink-deep"
                    />
                    <select
                        aria-label="Tile category"
                        value={category}
                        onChange={e => {
                            const c = e.target.value as Category;
                            setCategory(c);
                            setStackable(c === 'terrain');
                            // Footprint applies to buildings only; reset otherwise.
                            if (c !== 'buildings') setFootprint(1, 1);
                        }}
                        className="w-full rounded-lg border border-[rgba(27,91,168,0.3)] bg-white/70 px-2 py-1.5 text-ink-deep"
                    >
                        {CATEGORIES.map(c => (
                            <option key={c} value={c}>
                                {c[0]!.toUpperCase() + c.slice(1)}
                            </option>
                        ))}
                    </select>
                    {category === 'buildings' && (
                        <div className="flex items-center gap-1.5">
                            <span className="text-[11px] font-semibold text-ink-deep opacity-70">
                                Footprint
                            </span>
                            <select
                                aria-label="Footprint width"
                                value={footprint[0]}
                                onChange={e =>
                                    setFootprint(Number(e.target.value), footprint[1])
                                }
                                className="flex-1 rounded-lg border border-[rgba(27,91,168,0.3)] bg-white/70 px-2 py-1.5 text-ink-deep"
                            >
                                {[1, 2, 3, 4].map(n => (
                                    <option key={n} value={n}>
                                        {n}
                                    </option>
                                ))}
                            </select>
                            <span className="text-xs text-ink-deep opacity-70">×</span>
                            <select
                                aria-label="Footprint depth"
                                value={footprint[1]}
                                onChange={e =>
                                    setFootprint(footprint[0], Number(e.target.value))
                                }
                                className="flex-1 rounded-lg border border-[rgba(27,91,168,0.3)] bg-white/70 px-2 py-1.5 text-ink-deep"
                            >
                                {[1, 2, 3, 4].map(n => (
                                    <option key={n} value={n}>
                                        {n}
                                    </option>
                                ))}
                            </select>
                        </div>
                    )}
                    <label className="flex cursor-pointer items-center gap-1.5 text-xs font-semibold text-ink-deep">
                        <input
                            type="checkbox"
                            aria-label="Stackable"
                            checked={stackable}
                            onChange={e => setStackable(e.target.checked)}
                        />{' '}
                        Stackable
                    </label>
                    <div className="mt-1 flex gap-1.5">
                        <EdBtn
                            title="Save the tile (stays in the editor)"
                            className="bg-ink text-white hover:bg-ink-deep"
                            onClick={save}
                        >
                            Save
                        </EdBtn>
                        <EdBtn
                            title="Return to the scene editor"
                            onClick={() => navigate('/')}
                        >
                            Done
                        </EdBtn>
                    </div>
                    <div className="text-center text-[11px] opacity-60">
                        {voxelCount} voxels
                        {selectionSize > 0 && ` · ${selectionSize} selected`}
                    </div>
                </Section>
            </Accordion.Root>
        </section>
    );
}
