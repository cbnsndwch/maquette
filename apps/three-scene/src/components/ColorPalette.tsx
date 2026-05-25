import { memo, useCallback, useEffect, useRef, useState } from "react";

import { getEngine } from "@/bootstrap";
import { Popover, PopoverContent } from "@/components/ui/popover";
import {
    listPalettes,
    paletteId,
    savePalette,
    type SavedPalette,
} from "@/core/palette-store";
import { hexToHsl, hslToHex } from "@/core/tile-editor";
import { cn } from "@/lib/utils";
import { useEngineSelector } from "@/store";

const HEX_RE = /^#?[0-9a-f]{6}$/i;
const RAMP_STEPS = 5;
const PALETTE_SIZE = 256;

const ED_BTN =
    "cursor-pointer rounded-[10px] border-[1.5px] border-ink bg-transparent px-1 py-1.5 text-xs font-semibold text-ink-deep hover:bg-[rgba(27,91,168,0.08)] disabled:cursor-default disabled:opacity-30";
const ED_TOOL =
    "cursor-pointer rounded-[10px] border-[1.5px] border-transparent bg-white/55 px-1 py-1.5 text-xs font-semibold text-ink-deep hover:bg-white/85";

const hex2 = (n: number): string => n.toString(16).padStart(2, "0");

interface SwatchProps {
    i: number;
    onOpen: (i: number, anchor: HTMLElement) => void;
    onDragStartSlot: (i: number) => void;
    onDropSlot: (i: number) => void;
}

const ColorSwatch = memo(function ColorSwatch({
    i,
    onOpen,
    onDragStartSlot,
    onDropSlot,
}: SwatchProps): React.JSX.Element {
    const { editor } = getEngine();
    const color = useEngineSelector(() => editor.palette[i] ?? null);
    const active = useEngineSelector(() => i === editor.activeColorIdx);
    const [dragging, setDragging] = useState(false);
    const empty = color == null;

    return (
        <button
            type="button"
            draggable
            title={color ?? `slot ${i} — empty`}
            aria-label={color ?? `slot ${i} empty`}
            onClick={(e) => onOpen(i, e.currentTarget)}
            onDragStart={() => {
                onDragStartSlot(i);
                setDragging(true);
            }}
            onDragEnd={() => setDragging(false)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
                e.preventDefault();
                onDropSlot(i);
            }}
            style={empty ? undefined : { background: color }}
            className={cn(
                "aspect-square cursor-pointer rounded-[4px] border-[1.5px] p-0",
                active
                    ? "border-ink-deep shadow-[0_0_0_1px_#fff_inset]"
                    : "border-[rgba(27,91,168,0.25)]",
                empty && "edc-cell-empty",
                dragging && "opacity-40"
            )}
        />
    );
});

/** In-popover color editor for one slot. Keyed by slot so it re-inits on open. */
function ColorEditor({
    slot,
    onClose,
}: {
    slot: number;
    onClose: () => void;
}): React.JSX.Element {
    const { editor } = getEngine();
    const initial = editor.palette[slot] ?? "#ffffff";
    const [current, setCurrent] = useState(initial);
    const [hexBuf, setHexBuf] = useState(initial);
    const [hsl, setHsl] = useState(() => hexToHsl(initial));
    const inUse = editor.slotInUse(slot);

    const commit = (hex: string): void => {
        setCurrent(hex);
        setHexBuf(hex);
        setHsl(hexToHsl(hex));
        editor.setSlotColor(slot, hex);
    };

    const commitHsl = (h: number, s: number, l: number): void => {
        const hex = hslToHex(h, s / 100, l / 100);
        setHsl([h, s / 100, l / 100]);
        setCurrent(hex);
        setHexBuf(hex);
        editor.setSlotColor(slot, hex);
    };

    const commitHex = (): void => {
        if (HEX_RE.test(hexBuf)) commit("#" + hexBuf.replace("#", ""));
    };

    return (
        <div className="flex w-[170px] flex-col gap-2">
            <input
                type="color"
                aria-label="Slot color"
                value={current}
                onChange={(e) => commit(e.target.value)}
                className="h-10 w-full cursor-pointer rounded-lg border-none bg-none p-0"
            />
            <input
                type="text"
                maxLength={7}
                spellCheck={false}
                aria-label="Hex color"
                value={hexBuf}
                onChange={(e) => setHexBuf(e.target.value)}
                onBlur={commitHex}
                onKeyDown={(e) => e.key === "Enter" && commitHex()}
                className="w-full rounded-lg border border-[rgba(27,91,168,0.3)] bg-white/70 px-2 py-1.5 lowercase text-ink-deep"
            />
            <div className="flex flex-col gap-1">
                {(
                    [
                        ["H", 360, Math.round(hsl[0]), 0],
                        ["S", 100, Math.round(hsl[1] * 100), 1],
                        ["L", 100, Math.round(hsl[2] * 100), 2],
                    ] as const
                ).map(([label, max, val, idx]) => (
                    <label
                        key={label}
                        className="flex items-center gap-1.5 text-[11px] font-semibold text-ink-deep"
                    >
                        {label}
                        <input
                            type="range"
                            min={0}
                            max={max}
                            value={val}
                            aria-label={`${label} channel`}
                            onChange={(e) => {
                                const v = Number(e.target.value);
                                const h = idx === 0 ? v : Math.round(hsl[0]);
                                const s =
                                    idx === 1 ? v : Math.round(hsl[1] * 100);
                                const l =
                                    idx === 2 ? v : Math.round(hsl[2] * 100);
                                commitHsl(h, s, l);
                            }}
                            className="min-w-0 flex-1"
                        />
                    </label>
                ))}
            </div>
            <div className="flex gap-1.5">
                <button
                    type="button"
                    disabled={inUse}
                    title={
                        inUse
                            ? "In use — recolor or delete those voxels first"
                            : "Unassign this slot"
                    }
                    onClick={() => {
                        editor.clearSlot(slot);
                        onClose();
                    }}
                    className={cn(ED_BTN, "flex-1")}
                >
                    Clear
                </button>
                <button
                    type="button"
                    onClick={onClose}
                    className={cn(
                        ED_BTN,
                        "flex-1 bg-ink text-white hover:bg-ink-deep"
                    )}
                >
                    Done
                </button>
            </div>
        </div>
    );
}

/** Left-side 256-slot color panel for the tile editor. */
export function ColorPalette(): React.JSX.Element {
    const { editor } = getEngine();
    const unused = useEngineSelector(() => editor.unusedColorCount());

    const [compact, setCompact] = useState(true);
    const [popover, setPopover] = useState<{
        slot: number;
        anchor: HTMLElement;
    } | null>(null);
    const dragSrc = useRef<number | null>(null);

    const [saved, setSaved] = useState<SavedPalette[]>([]);
    const [libSelId, setLibSelId] = useState("");
    const [libName, setLibName] = useState("");
    const rampToRef = useRef<HTMLInputElement>(null);

    const refreshLibrary = async (keepId?: string): Promise<void> => {
        const list = await listPalettes();
        setSaved(list);
        if (keepId && list.some((p) => p.id === keepId)) setLibSelId(keepId);
    };

    useEffect(() => {
        void refreshLibrary();
    }, []);

    const onOpen = useCallback((i: number, anchor: HTMLElement): void => {
        getEngine().editor.selectColorIdx(i); // no-op for an empty slot
        setPopover({ slot: i, anchor });
    }, []);

    const onDragStartSlot = useCallback((i: number): void => {
        dragSrc.current = i;
    }, []);

    const onDropSlot = useCallback((target: number): void => {
        const src = dragSrc.current;
        dragSrc.current = null;
        if (src == null || src === target) return;
        const ed = getEngine().editor;
        const assigned: number[] = [];
        const empty: number[] = [];
        for (let i = 0; i < ed.palette.length; i++) {
            if (ed.palette[i] != null) assigned.push(i);
            else empty.push(i);
        }
        const from = assigned.indexOf(src);
        const to = assigned.indexOf(target);
        if (from < 0 || to < 0) return;
        assigned.splice(to, 0, assigned.splice(from, 1)[0]!);
        ed.reorderPalette([...assigned, ...empty]);
    }, []);

    function addColor(anchor: HTMLElement): void {
        const free = editor.palette.indexOf(null);
        if (free < 0) return;
        editor.selectColorIdx(free);
        setPopover({ slot: free, anchor });
    }

    function importImage(file: File): void {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            const cv = document.createElement("canvas");
            cv.width = 8;
            cv.height = 32;
            const ctx = cv.getContext("2d")!;
            ctx.imageSmoothingEnabled = false;
            ctx.clearRect(0, 0, 8, 32);
            ctx.drawImage(img, 0, 0, 8, 32);
            const data = ctx.getImageData(0, 0, 8, 32).data;
            const colors: (string | null)[] = [];
            for (let r = 0; r < 32; r++) {
                for (let c = 0; c < 8; c++) {
                    const o = (r * 8 + c) * 4;
                    colors.push(
                        data[o + 3]! < 8
                            ? null
                            : `#${hex2(data[o]!)}${hex2(data[o + 1]!)}${hex2(
                                  data[o + 2]!
                              )}`
                    );
                }
            }
            editor.setPalette(colors);
            URL.revokeObjectURL(url);
        };
        img.src = url;
    }

    async function saveCurrent(): Promise<void> {
        const name = libName.trim();
        if (!name) return;
        const result = await savePalette(paletteId(name), name, editor.palette);
        if (!result) return;
        setLibName("");
        await refreshLibrary(result.id);
    }

    const fileRef = useRef<HTMLInputElement>(null);

    return (
        <section
            id="color-controls"
            className="fixed left-4 top-4 bottom-16 z-10 flex w-62.5 flex-col gap-2 rounded-lg bg-panel px-3.5 py-3 shadow-panel backdrop-blur-sm"
        >
            <div className="text-sm font-bold text-ink-deep">Colors</div>

            <div className="flex shrink-0 gap-1.5">
                <button
                    type="button"
                    title="Show only assigned colors (toggle to the full 256-slot grid)"
                    onClick={() => setCompact((c) => !c)}
                    className={cn(
                        ED_TOOL,
                        "h-7.5 flex-1",
                        compact && "border-ink bg-[rgba(27,91,168,0.12)]"
                    )}
                >
                    Compact
                </button>
                <button
                    type="button"
                    title="Sort colors by hue"
                    onClick={() => editor.sortPalette("hue")}
                    className={cn(ED_BTN, "h-7.5 flex-1")}
                >
                    Hue
                </button>
                <button
                    type="button"
                    title="Sort colors by lightness"
                    onClick={() => editor.sortPalette("light")}
                    className={cn(ED_BTN, "h-7.5 flex-1")}
                >
                    Light
                </button>
            </div>

            <div
                className={cn(
                    "edc-grid grid min-h-0 flex-1 grid-cols-8 content-start gap-0.75 overflow-y-auto pr-0.5 scrollbar-thin",
                    compact && "is-compact"
                )}
            >
                {Array.from({ length: PALETTE_SIZE }, (_, i) => (
                    <ColorSwatch
                        key={i}
                        i={i}
                        onOpen={onOpen}
                        onDragStartSlot={onDragStartSlot}
                        onDropSlot={onDropSlot}
                    />
                ))}
            </div>

            <button
                type="button"
                title="Assign a new color to the first free slot"
                onClick={(e) => addColor(e.currentTarget)}
                className={cn(ED_BTN, "h-8 shrink-0")}
            >
                + Add color
            </button>

            <div className="flex shrink-0 items-center gap-1.5">
                <button
                    type="button"
                    title="Add the complement of the active color"
                    onClick={() => editor.harmony("complement")}
                    className={cn(ED_BTN, "flex-1")}
                >
                    Comp
                </button>
                <button
                    type="button"
                    title="Add analogous colors (±30°) of the active color"
                    onClick={() => editor.harmony("analogous")}
                    className={cn(ED_BTN, "flex-1")}
                >
                    Analog
                </button>
                <button
                    type="button"
                    title="Add triad colors (±120°) of the active color"
                    onClick={() => editor.harmony("triad")}
                    className={cn(ED_BTN, "flex-1")}
                >
                    Triad
                </button>
            </div>

            <div className="flex shrink-0 items-center gap-1.5">
                <input
                    ref={rampToRef}
                    type="color"
                    defaultValue="#1b5ba8"
                    title="Ramp target color"
                    aria-label="Ramp target color"
                    className="h-8 w-9.5 shrink-0 cursor-pointer rounded-lg border-none bg-none p-0"
                />
                <button
                    type="button"
                    title="Add a ramp from the active color to the target color"
                    onClick={() =>
                        editor.rampTo(
                            rampToRef.current?.value ?? "#1b5ba8",
                            RAMP_STEPS
                        )
                    }
                    className={cn(ED_BTN, "flex-1")}
                >
                    Ramp →
                </button>
            </div>

            {unused > 0 && (
                <button
                    type="button"
                    title="Remove palette colors no voxel uses"
                    onClick={() => editor.removeUnusedColors()}
                    className={cn(ED_BTN, "h-8 shrink-0")}
                >
                    Trim {unused} unused
                </button>
            )}

            <button
                type="button"
                title="Load a 256-color palette from an 8×32 image"
                onClick={() => fileRef.current?.click()}
                className={cn(ED_BTN, "h-8 shrink-0")}
            >
                Import 8×32 image
            </button>
            <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/bmp,image/webp"
                hidden
                aria-label="Import palette image"
                onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) importImage(file);
                    e.target.value = "";
                }}
            />

            <div className="flex shrink-0 items-center gap-1.5">
                <select
                    title="Saved palettes"
                    aria-label="Saved palettes"
                    value={libSelId}
                    onChange={(e) => setLibSelId(e.target.value)}
                    className="min-w-0 flex-1 rounded-lg border border-[rgba(27,91,168,0.3)] bg-white/70 px-2 py-1.5 text-ink-deep"
                >
                    <option value="">— saved palettes —</option>
                    {saved.map((p) => (
                        <option key={p.id} value={p.id}>
                            {p.name}
                        </option>
                    ))}
                </select>
                <button
                    type="button"
                    title="Apply the selected palette to this tile"
                    onClick={() => {
                        const p = saved.find((s) => s.id === libSelId);
                        if (p) editor.setPalette(p.colors);
                    }}
                    className={cn(ED_BTN, "h-8 shrink-0 px-3")}
                >
                    Load
                </button>
            </div>

            <div className="flex shrink-0 items-center gap-1.5">
                <input
                    type="text"
                    placeholder="save palette as…"
                    spellCheck={false}
                    aria-label="Palette name"
                    value={libName}
                    onChange={(e) => setLibName(e.target.value)}
                    className="min-w-0 flex-1 rounded-lg border border-[rgba(27,91,168,0.3)] bg-white/70 px-2 py-1.5 text-ink-deep"
                />
                <button
                    type="button"
                    title="Save the current palette to the shared library"
                    onClick={() => void saveCurrent()}
                    className={cn(ED_BTN, "h-8 shrink-0 px-3")}
                >
                    Save
                </button>
            </div>

            <Popover
                open={popover != null}
                onOpenChange={(o) => !o && setPopover(null)}
            >
                {popover && (
                    <PopoverContent anchor={popover.anchor} side="right">
                        <ColorEditor
                            key={popover.slot}
                            slot={popover.slot}
                            onClose={() => setPopover(null)}
                        />
                    </PopoverContent>
                )}
            </Popover>
        </section>
    );
}
