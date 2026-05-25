import { Accordion } from "@base-ui-components/react/accordion";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";

import { saveTileFlow } from "@/actions";
import { getEngine } from "@/bootstrap";
import type { EditTool, EditorLayer } from "@/core/tile-editor";
import type { TileMeta } from "@/core/tile-save";
import { cn } from "@/lib/utils";
import { useEngineSelector } from "@/store";
import {
    ALLOWED_RESOLUTIONS,
    CATEGORIES,
    type Category,
    type TerrainDef,
} from "@cbnsndwch/scene-author";

const TOOLS: { id: EditTool; label: string; key: string }[] = [
    { id: "add", label: "Add", key: "A" },
    { id: "delete", label: "Delete", key: "D" },
    { id: "paint", label: "Paint", key: "P" },
    { id: "eyedropper", label: "Pick", key: "I" },
    { id: "select", label: "Select", key: "S" },
    { id: "face-select", label: "Face", key: "F" },
];

const ED_BTN =
    "flex-1 cursor-pointer rounded-[10px] border-[1.5px] border-ink bg-transparent p-2 text-xs font-semibold text-ink-deep hover:bg-[rgba(27,91,168,0.08)] disabled:cursor-default disabled:opacity-30";

function EdBtn({
    className,
    ...props
}: React.ComponentProps<"button">): React.JSX.Element {
    return (
        <button type="button" className={cn(ED_BTN, className)} {...props} />
    );
}

function EdTool({
    label,
    title,
    active,
    onClick,
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
                "cursor-pointer rounded-[10px] border-[1.5px] border-transparent bg-white/55 px-1 py-2 text-xs font-semibold text-ink-deep hover:bg-white/85",
                active && "border-ink bg-[rgba(27,91,168,0.12)]"
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
    upTitle,
}: {
    value: string;
    onDown: () => void;
    onUp: () => void;
    downTitle: string;
    upTitle: string;
}): React.JSX.Element {
    const stepBtn = "flex-[0_0_38px] px-0 py-[5px] text-base leading-none";
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
    children,
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
        .replace(/[^a-z0-9_-]+/g, "_")
        .replace(/^_+|_+$/g, "");

/** Right-side tile editor panel: tools, geometry, shade, floor, view, import, save. */
export function EditorPanel({
    def,
}: {
    def: TerrainDef | null;
}): React.JSX.Element {
    const { editor } = getEngine();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const voxFileRef = useRef<HTMLInputElement>(null);

    const tool = useEngineSelector(() => editor.tool);
    const canUndo = useEngineSelector(() => editor.canUndo);
    const canRedo = useEngineSelector(() => editor.canRedo);
    const nextUndoIsMilestone = useEngineSelector(
        () => editor.nextUndoIsMilestone
    );
    const nextRedoIsMilestone = useEngineSelector(
        () => editor.nextRedoIsMilestone
    );
    const selectionSize = useEngineSelector(() => editor.selection.size);
    const selectionPeek = useEngineSelector(() => editor.selectionPeek);
    const voxelCount = useEngineSelector(() => editor.voxels.length);
    const floorOffset = useEngineSelector(() => editor.floorOffset);
    const gridOn = useEngineSelector(() => editor.gridOn);
    const edgesOn = useEngineSelector(() => editor.edgesOn);
    const groundGridOn = useEngineSelector(() => editor.groundGridOn);
    const wallsOn = useEngineSelector(() => editor.wallsOn);
    const explode = useEngineSelector(() => editor.explode);
    const focusLayer = useEngineSelector(() => editor.focusLayer);
    const editingId = useEngineSelector(() => editor.editingId);

    const layers = useEngineSelector<EditorLayer[]>(
        () => editor.layers,
        (a, b) =>
            a.length === b.length &&
            a.every(
                (l, i) =>
                    l.id === b[i]!.id &&
                    l.name === b[i]!.name &&
                    l.visible === b[i]!.visible
            )
    );
    const [capturingLayer, setCapturingLayer] = useState(false);
    const [newLayerName, setNewLayerName] = useState("");

    const [spread, setSpreadRaw] = useState(30);
    const [shadeNotice, setShadeNotice] = useState<{
        msg: string;
        resolveLabel: string | null;
    } | null>(null);

    const [name, setName] = useState(def?.name ?? "");
    const [category, setCategory] = useState<Category>(() => {
        if (def?.category) return def.category;
        const qc = searchParams.get("category") as Category | null;
        return qc && (CATEGORIES as readonly string[]).includes(qc)
            ? qc
            : CATEGORIES[0]!;
    });
    const [stackable, setStackable] = useState(
        def ? def.stackable : true // terrain default
    );
    const [footprint, setFootprintState] = useState<[number, number]>(
        def?.footprint ?? [1, 1]
    );
    const [resolution, setResolutionState] = useState<number>(
        def?.resolution ?? 12
    );

    /** Resize the author grid for a building footprint. */
    function setFootprint(w: number, d: number): void {
        const fp: [number, number] = [w, d];
        setFootprintState(fp);
        editor.setFootprint(fp);
    }

    /** Change the per-asset resolution (finer cubes in the same cell). */
    function setResolution(r: number): void {
        setResolutionState(r);
        editor.setResolution(r);
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
                `Palette full: shading needs ${need} free slot${
                    need === 1 ? "" : "s"
                }, ${free} available.` +
                (unused === 0 ? " Clear some swatches first." : ""),
            resolveLabel: unused > 0 ? `Trim ${unused} unused & retry` : null,
        });
    }

    function resolveShade(): void {
        editor.removeUnusedColors();
        doShade();
    }

    function confirmCapture(): void {
        const trimmed = newLayerName.trim();
        if (!trimmed) return;
        editor.captureSelectionAsLayer(trimmed);
        setCapturingLayer(false);
        setNewLayerName("");
    }

    async function importVox(file: File): Promise<void> {
        const ok = editor.importVoxBuffer(await file.arrayBuffer());
        if (!ok) return;
        setName(file.name.replace(/\.vox$/i, ""));
        setCategory(CATEGORIES[0]!);
        setStackable(true);
    }

    function save(): void {
        const cleanName = name.trim() || "untitled";
        const meta: TileMeta = {
            id: editingId ?? (slug(cleanName) || `tile_${Date.now()}`),
            name: cleanName,
            category,
            stackable,
            footprint: category === "buildings" ? footprint : [1, 1],
            resolution,
        };
        void saveTileFlow(meta);
    }

    // Keep a stable ref so the effect closure always calls the latest save().
    const saveRef = useRef(save);
    saveRef.current = save;

    useEffect(() => {
        function onKey(e: KeyboardEvent): void {
            if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "s")
                return;
            e.preventDefault();
            saveRef.current();
        }
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, []);

    return (
        <section className="fixed right-4 top-4 bottom-4 z-10 flex w-62.5 flex-col overflow-y-auto rounded-md bg-panel p-[12px_14px] px-3.5 py-3 shadow-panel backdrop-blur-[8px] [scrollbar-width:thin]">
            <div className="mb-1 text-sm font-bold text-ink-deep">
                {editingId ? "Edit Tile" : "New Tile"}
            </div>

            <Accordion.Root multiple defaultValue={["tools", "layers", "save"]}>
                <Section value="tools" title="Tools">
                    <div className="grid grid-cols-2 gap-1.5">
                        {TOOLS.map((t) => (
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
                            title={
                                nextUndoIsMilestone
                                    ? "Undo save (Ctrl+Z)"
                                    : "Undo (Ctrl+Z)"
                            }
                            disabled={!canUndo}
                            onClick={() => editor.undo()}
                        >
                            Undo{nextUndoIsMilestone ? " ✦" : ""}
                        </EdBtn>
                        <EdBtn
                            title={
                                nextRedoIsMilestone
                                    ? "Redo save (Ctrl+Shift+Z)"
                                    : "Redo (Ctrl+Shift+Z)"
                            }
                            disabled={!canRedo}
                            onClick={() => editor.redo()}
                        >
                            Redo{nextRedoIsMilestone ? " ✦" : ""}
                        </EdBtn>
                    </div>
                    <div className="text-[11px] opacity-60">
                        Hold Space to pan · right-click inverts Add/Delete ·
                        Select: shift-click to range-select on a plane · Face:
                        click to flood-fill by color on a plane · Hold V to peek
                        selection colors
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
                    <div className="grid grid-cols-2 gap-1.5">
                        <EdBtn
                            title="Clear the current selection"
                            disabled={selectionSize === 0}
                            onClick={() => editor.clearSelection()}
                        >
                            Clear sel.
                        </EdBtn>
                        <EdBtn
                            title="Hide selection overlay to preview voxel colors (hold V)"
                            disabled={selectionSize === 0}
                            className={
                                selectionPeek
                                    ? "border-ink bg-[rgba(27,91,168,0.12)]"
                                    : ""
                            }
                            onClick={() =>
                                editor.setSelectionPeek(!selectionPeek)
                            }
                        >
                            Peek{selectionPeek ? " ●" : ""}
                        </EdBtn>
                    </div>
                </Section>

                <Section value="layers" title="Layers">
                    {capturingLayer ? (
                        <div className="flex gap-1.5">
                            <input
                                id="new-layer-name"
                                type="text"
                                autoFocus
                                placeholder="layer name"
                                value={newLayerName}
                                onChange={(e) =>
                                    setNewLayerName(e.target.value)
                                }
                                onKeyDown={(e) => {
                                    if (e.key === "Enter") confirmCapture();
                                    if (e.key === "Escape")
                                        setCapturingLayer(false);
                                }}
                                className="min-w-0 flex-1 rounded-lg border border-[rgba(27,91,168,0.3)] bg-white/70 px-2 py-1.5 text-xs text-ink-deep"
                            />
                            <EdBtn
                                className="flex-none px-2"
                                title="Confirm"
                                onClick={confirmCapture}
                            >
                                ✓
                            </EdBtn>
                        </div>
                    ) : (
                        <EdBtn
                            title="Save selected voxels as a named layer"
                            disabled={selectionSize === 0}
                            onClick={() => {
                                setNewLayerName("");
                                setCapturingLayer(true);
                            }}
                        >
                            Capture selection
                        </EdBtn>
                    )}
                    {layers.length === 0 ? (
                        <div className="text-center text-[11px] opacity-50">
                            No layers
                        </div>
                    ) : (
                        <div className="flex flex-col gap-1">
                            {layers.map((layer) => (
                                <div
                                    key={layer.id}
                                    className="flex items-center gap-1.5"
                                >
                                    <button
                                        type="button"
                                        title={
                                            layer.visible
                                                ? "Hide layer"
                                                : "Show layer"
                                        }
                                        onClick={() =>
                                            editor.setLayerVisible(
                                                layer.id,
                                                !layer.visible
                                            )
                                        }
                                        className="cursor-pointer text-ink-deep opacity-60 hover:opacity-100"
                                    >
                                        {layer.visible ? (
                                            <svg
                                                xmlns="http://www.w3.org/2000/svg"
                                                width="18"
                                                height="18"
                                                viewBox="0 0 24 24"
                                                fill="none"
                                                stroke="currentColor"
                                                strokeWidth="2"
                                                strokeLinecap="round"
                                                strokeLinejoin="round"
                                            >
                                                <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                                                <circle cx="12" cy="12" r="3" />
                                            </svg>
                                        ) : (
                                            <svg
                                                xmlns="http://www.w3.org/2000/svg"
                                                width="18"
                                                height="18"
                                                viewBox="0 0 24 24"
                                                fill="none"
                                                stroke="currentColor"
                                                strokeWidth="2"
                                                strokeLinecap="round"
                                                strokeLinejoin="round"
                                            >
                                                <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
                                                <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
                                                <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
                                                <line
                                                    x1="2"
                                                    x2="22"
                                                    y1="2"
                                                    y2="22"
                                                />
                                            </svg>
                                        )}
                                    </button>
                                    <span className="min-w-0 flex-1 truncate text-xs text-ink-deep">
                                        {layer.name}
                                    </span>
                                    <span className="shrink-0 text-[10px] opacity-50">
                                        {editor.getLayerVoxelCount(layer.id)}
                                    </span>
                                    <button
                                        type="button"
                                        title="Remove layer (voxels remain)"
                                        onClick={() =>
                                            editor.deleteLayer(layer.id)
                                        }
                                        className="shrink-0 cursor-pointer text-sm leading-none opacity-40 hover:opacity-80"
                                    >
                                        ×
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
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
                                ? "Base —"
                                : `Base ${
                                      floorOffset > 0 ? "+" : ""
                                  }${floorOffset}`
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
                            label="Base grid"
                            title="Toggle base grid (ground −4)"
                            active={gridOn}
                            onClick={() =>
                                editor.setGridVisible(!editor.gridOn)
                            }
                        />
                        <EdTool
                            label="Ground grid"
                            title="Toggle ground-level grid"
                            active={groundGridOn}
                            onClick={() =>
                                editor.setGroundGridVisible(
                                    !editor.groundGridOn
                                )
                            }
                        />
                        <EdTool
                            label="Walls"
                            title="Toggle side/back wall grid"
                            active={wallsOn}
                            onClick={() =>
                                editor.setWallsVisible(!editor.wallsOn)
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
                                ? "Layer all"
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
                        onChange={(e) => {
                            const file = e.target.files?.[0];
                            e.target.value = "";
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
                        onChange={(e) => setName(e.target.value)}
                        className="w-full rounded-lg border border-[rgba(27,91,168,0.3)] bg-white/70 px-2 py-1.5 text-ink-deep"
                    />
                    <select
                        id="category-select"
                        aria-label="Tile category"
                        value={category}
                        onChange={(e) => {
                            const c = e.target.value as Category;
                            setCategory(c);
                            setStackable(c === "terrain");
                            // Footprint applies to buildings only; reset otherwise.
                            if (c !== "buildings") setFootprint(1, 1);
                        }}
                        className="w-full rounded-lg border border-[rgba(27,91,168,0.3)] bg-white/70 px-2 py-1.5 text-ink-deep"
                    >
                        {CATEGORIES.map((c) => (
                            <option key={c} value={c}>
                                {c[0]!.toUpperCase() + c.slice(1)}
                            </option>
                        ))}
                    </select>
                    {category === "buildings" && (
                        <div className="flex items-center gap-1.5">
                            <span className="text-[11px] font-semibold text-ink-deep opacity-70">
                                Footprint
                            </span>
                            <select
                                aria-label="Footprint width"
                                value={footprint[0]}
                                onChange={(e) =>
                                    setFootprint(
                                        Number(e.target.value),
                                        footprint[1]
                                    )
                                }
                                className="flex-1 rounded-lg border border-[rgba(27,91,168,0.3)] bg-white/70 px-2 py-1.5 text-ink-deep"
                            >
                                {[1, 2, 3, 4].map((n) => (
                                    <option key={n} value={n}>
                                        {n}
                                    </option>
                                ))}
                            </select>
                            <span className="text-xs text-ink-deep opacity-70">
                                ×
                            </span>
                            <select
                                aria-label="Footprint depth"
                                value={footprint[1]}
                                onChange={(e) =>
                                    setFootprint(
                                        footprint[0],
                                        Number(e.target.value)
                                    )
                                }
                                className="flex-1 rounded-lg border border-[rgba(27,91,168,0.3)] bg-white/70 px-2 py-1.5 text-ink-deep"
                            >
                                {[1, 2, 3, 4].map((n) => (
                                    <option key={n} value={n}>
                                        {n}
                                    </option>
                                ))}
                            </select>
                        </div>
                    )}
                    <div className="flex flex-col justify-start items-stretch">
                        <span className="text-[11px] font-semibold text-ink-deep opacity-70">
                            Resolution
                        </span>
                        <select
                            id="tile-resolution-select"
                            aria-label="Tile resolution"
                            value={resolution}
                            onChange={(e) =>
                                setResolution(Number(e.target.value))
                            }
                            className="flex-1 rounded-lg border border-[rgba(27,91,168,0.3)] bg-white/70 px-2 py-1.5 text-ink-deep"
                        >
                            {ALLOWED_RESOLUTIONS.map((n) => (
                                <option key={n} value={n}>
                                    {n} vox/cell{n === 12 ? " (default)" : ""}
                                </option>
                            ))}
                        </select>
                    </div>
                    <label className="flex cursor-pointer items-center gap-1.5 text-xs font-semibold text-ink-deep">
                        <input
                            type="checkbox"
                            aria-label="Stackable"
                            checked={stackable}
                            onChange={(e) => setStackable(e.target.checked)}
                        />{" "}
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
                            onClick={() => navigate("/")}
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
