import { CATEGORIES, type Category, type TerrainDef } from "../config.js";
import type { EditTool, TileEditor } from "../core/tile-editor.js";
import type { TileMeta } from "../core/tile-save.js";

const TOOLS: { id: EditTool; label: string; key: string }[] = [
    { id: "add", label: "Add", key: "A" },
    { id: "delete", label: "Delete", key: "D" },
    { id: "paint", label: "Paint", key: "P" },
    { id: "eyedropper", label: "Pick", key: "I" },
    { id: "select", label: "Select", key: "S" },
];

export interface EditorPanelHooks {
    onSave: (meta: TileMeta) => void;
    onDone: () => void;
}

/**
 * Right-side editor panel: tools (incl. multi-voxel Select), bulk clear actions,
 * and the save form. The color palette lives in its own left panel
 * ({@link EditorColors}).
 */
export class EditorPanel {
    private readonly toolBtns = new Map<EditTool, HTMLButtonElement>();
    private readonly headEl: HTMLElement;
    private readonly nameInput: HTMLInputElement;
    private readonly catSelect: HTMLSelectElement;
    private readonly stackInput: HTMLInputElement;
    private readonly clearSelBtn: HTMLButtonElement;
    private readonly infoEl: HTMLElement;
    private readonly floorValEl: HTMLElement;
    private readonly gridBtn: HTMLButtonElement;
    private readonly edgesBtn: HTMLButtonElement;
    private readonly explodeValEl: HTMLElement;
    private readonly focusValEl: HTMLElement;
    private readonly spreadValEl: HTMLElement;
    private readonly voxFile: HTMLInputElement;
    private readonly shadeNotice: HTMLElement;
    private readonly shadeMsg: HTMLElement;
    private readonly shadeResolveBtn: HTMLButtonElement;
    /** Shading spread (variance), 0–100%. */
    private spread = 30;

    constructor(
        private readonly root: HTMLElement,
        private readonly editor: TileEditor,
        hooks: EditorPanelHooks
    ) {
        const acc = (id: string, label: string, body: string, open = false) =>
            `<div class="ed-accordion${open ? " open" : ""}">` +
            `<button type="button" class="ed-acc-hdr">${label}</button>` +
            `<div class="ed-acc-body" id="ed-acc-${id}">${body}</div>` +
            `</div>`;

        root.innerHTML = `
            <div class="ed-head" id="ed-head">New Tile</div>
            ${acc(
                "tools",
                "Tools",
                `
                <div class="ed-tools" id="ed-tools"></div>
            `,
                true
            )}
            ${acc(
                "geometry",
                "Geometry",
                `
                <div class="ed-tools">
                    <button type="button" class="ed-btn" id="ed-base"
                        title="Fill the buried base layers with the active color">Fill base</button>
                    <button type="button" class="ed-btn" id="ed-hull"
                        title="Remove hidden interior voxels (Hull)">Hull</button>
                </div>
                <div class="ed-clear">
                    <button type="button" class="ed-btn" id="ed-clear-base"
                        title="Clear buried base layers">Base</button>
                    <button type="button" class="ed-btn" id="ed-clear-top"
                        title="Clear everything above ground">Top</button>
                    <button type="button" class="ed-btn" id="ed-clear-all"
                        title="Clear all voxels">All</button>
                </div>
                <button type="button" class="ed-btn" id="ed-clear-sel"
                    title="Clear the current selection">Clear selection</button>
            `
            )}
            ${acc(
                "shade",
                "Shade",
                `
                <div class="ed-floor">
                    <button type="button" class="ed-btn" id="ed-spread-down"
                        title="Less shading variance">−</button>
                    <span class="ed-floor-val" id="ed-spread-val">Spread 30%</span>
                    <button type="button" class="ed-btn" id="ed-spread-up"
                        title="More shading variance">+</button>
                </div>
                <button type="button" class="ed-btn" id="ed-shade"
                    title="Shade voxels from the active color (normal distribution)">Shade from color</button>
                <div class="ed-notice" id="ed-shade-notice" hidden>
                    <span id="ed-shade-msg"></span>
                    <button type="button" class="ed-btn" id="ed-shade-resolve"></button>
                </div>
            `
            )}
            ${acc(
                "floor",
                "Floor",
                `
                <div class="ed-floor">
                    <button type="button" class="ed-btn" id="ed-floor-down"
                        title="Lower the model (more buried)">−</button>
                    <span class="ed-floor-val" id="ed-floor-val">Base —</span>
                    <button type="button" class="ed-btn" id="ed-floor-up"
                        title="Raise the model (less buried)">+</button>
                </div>
            `
            )}
            ${acc(
                "view",
                "View",
                `
                <div class="ed-tools">
                    <button type="button" class="ed-tool" id="ed-grid"
                        title="Toggle floor grid">Grid</button>
                    <button type="button" class="ed-tool" id="ed-edges"
                        title="Toggle voxel edges">Edges</button>
                </div>
                <div class="ed-floor">
                    <button type="button" class="ed-btn" id="ed-explode-down"
                        title="Less exploded spacing">−</button>
                    <span class="ed-floor-val" id="ed-explode-val">Explode 0</span>
                    <button type="button" class="ed-btn" id="ed-explode-up"
                        title="More exploded spacing">+</button>
                </div>
                <div class="ed-floor">
                    <button type="button" class="ed-btn" id="ed-focus-down"
                        title="Focus a lower layer (or show all)">−</button>
                    <span class="ed-floor-val" id="ed-focus-val">Layer all</span>
                    <button type="button" class="ed-btn" id="ed-focus-up"
                        title="Focus a higher layer">+</button>
                </div>
            `
            )}
            ${acc(
                "import",
                "Import",
                `
                <button type="button" class="ed-btn" id="ed-import-vox"
                    title="Import a MagicaVoxel .vox file as a new tile">Import .vox file</button>
                <input type="file" id="ed-vox-file"
                    accept=".vox,application/octet-stream" hidden />
            `
            )}
            ${acc(
                "save",
                "Save as tile",
                `
                <input type="text" id="ed-name" placeholder="tile name" />
                <select id="ed-cat"></select>
                <label class="ed-check"><input type="checkbox" id="ed-stack" /> Stackable</label>
                <div class="ed-actions">
                    <button type="button" class="ed-btn ed-primary" id="ed-save"
                        title="Save the tile (stays in the editor)">Save</button>
                    <button type="button" class="ed-btn" id="ed-done"
                        title="Return to the scene editor">Done</button>
                </div>
                <div class="ed-info" id="ed-info"></div>
            `,
                true
            )}
        `;

        root.addEventListener("click", (e) => {
            const hdr = (e.target as Element).closest(".ed-acc-hdr");
            if (hdr) hdr.closest(".ed-accordion")!.classList.toggle("open");
        });

        const toolsEl = root.querySelector("#ed-tools")!;
        for (const def of TOOLS) {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "ed-tool";
            btn.textContent = def.label;
            btn.title = `${def.label} (${def.key})`;
            btn.addEventListener("click", () => this.editor.setTool(def.id));
            toolsEl.appendChild(btn);
            this.toolBtns.set(def.id, btn);
        }

        this.headEl = root.querySelector("#ed-head")!;
        this.nameInput = root.querySelector("#ed-name")!;
        this.catSelect = root.querySelector("#ed-cat")!;
        this.stackInput = root.querySelector("#ed-stack")!;
        this.clearSelBtn = root.querySelector("#ed-clear-sel")!;
        this.infoEl = root.querySelector("#ed-info")!;
        this.floorValEl = root.querySelector("#ed-floor-val")!;
        this.gridBtn = root.querySelector("#ed-grid")!;
        this.edgesBtn = root.querySelector("#ed-edges")!;
        this.explodeValEl = root.querySelector("#ed-explode-val")!;
        this.focusValEl = root.querySelector("#ed-focus-val")!;
        this.spreadValEl = root.querySelector("#ed-spread-val")!;
        this.voxFile = root.querySelector("#ed-vox-file")!;
        this.shadeNotice = root.querySelector("#ed-shade-notice")!;
        this.shadeMsg = root.querySelector("#ed-shade-msg")!;
        this.shadeResolveBtn = root.querySelector("#ed-shade-resolve")!;

        for (const c of CATEGORIES) {
            const opt = document.createElement("option");
            opt.value = c;
            opt.textContent = c[0]!.toUpperCase() + c.slice(1);
            this.catSelect.appendChild(opt);
        }
        // Terrain is stackable by default (props/terrain can sit on top); other
        // categories default off. The user can still override the checkbox.
        this.catSelect.addEventListener("change", () => {
            this.stackInput.checked = this.catSelect.value === "terrain";
        });

        const on = (id: string, fn: () => void) =>
            root.querySelector(`#${id}`)!.addEventListener("click", fn);
        on("ed-base", () => this.editor.fillBase());
        on("ed-hull", () => this.editor.hull());
        on("ed-spread-down", () => this.setSpread(this.spread - 10));
        on("ed-spread-up", () => this.setSpread(this.spread + 10));
        on("ed-shade", () => this.doShade());
        on("ed-shade-resolve", () => this.resolveShade());
        on("ed-clear-base", () => this.editor.clearBase());
        on("ed-clear-top", () => this.editor.clearTop());
        on("ed-clear-all", () => this.editor.clearAll());
        on("ed-clear-sel", () => this.editor.clearSelection());
        on("ed-floor-down", () => this.editor.lowerFloor());
        on("ed-floor-up", () => this.editor.raiseFloor());
        on("ed-grid", () => this.editor.setGridVisible(!this.editor.gridOn));
        on("ed-edges", () => this.editor.setEdgesVisible(!this.editor.edgesOn));
        on("ed-explode-down", () => this.editor.lowerExplode());
        on("ed-explode-up", () => this.editor.raiseExplode());
        on("ed-focus-down", () => this.editor.focusDown());
        on("ed-focus-up", () => this.editor.focusUp());
        on("ed-import-vox", () => this.voxFile.click());
        this.voxFile.addEventListener("change", () => {
            const file = this.voxFile.files?.[0];
            this.voxFile.value = "";
            if (file) void this.importVox(file);
        });
        on("ed-save", () => hooks.onSave(this.meta()));
        root.querySelector("#ed-done")!.addEventListener("click", hooks.onDone);

        this.refresh();
    }

    show(): void {
        this.root.style.display = "";
        this.refresh();
    }

    hide(): void {
        this.root.style.display = "none";
    }

    /** Prefill the save form from an existing tile (entering edit-an-existing). */
    loadMeta(def: TerrainDef): void {
        this.headEl.textContent = "Edit Tile";
        this.nameInput.value = def.name;
        this.catSelect.value = def.category;
        this.stackInput.checked = def.stackable;
        this.refresh();
    }

    private setSpread(v: number): void {
        this.spread = Math.max(0, Math.min(100, v));
        this.refresh();
    }

    /** Shade; if the palette can't fit the new shades, surface a resolve notice. */
    private doShade(): void {
        if (this.editor.applyShading(this.spread)) {
            this.shadeNotice.hidden = true;
            return;
        }
        const need = this.editor.shadeSlotsNeeded(this.spread);
        const free = this.editor.freeSlotCount();
        const unused = this.editor.unusedColorCount();
        this.shadeMsg.textContent =
            `Palette full: shading needs ${need} free slot${
                need === 1 ? "" : "s"
            }, ${free} available.` +
            (unused === 0 ? " Clear some swatches first." : "");
        this.shadeResolveBtn.hidden = unused === 0;
        this.shadeResolveBtn.textContent = `Trim ${unused} unused & retry`;
        this.shadeNotice.hidden = false;
    }

    private resolveShade(): void {
        this.editor.removeUnusedColors();
        this.doShade(); // retry; re-shows the notice if still short on space
    }

    /** Decode an imported `.vox` into the editor as a new tile (prefill name). */
    private async importVox(file: File): Promise<void> {
        const ok = this.editor.importVoxBuffer(await file.arrayBuffer());
        if (!ok) return;
        this.resetMeta();
        this.nameInput.value = file.name.replace(/\.vox$/i, "");
    }

    /** Clear the save form for authoring a brand-new tile. */
    resetMeta(): void {
        this.headEl.textContent = "New Tile";
        this.nameInput.value = "";
        this.catSelect.value = CATEGORIES[0]!;
        this.stackInput.checked = this.catSelect.value === "terrain";
        this.refresh();
    }

    private meta(): TileMeta {
        const name = this.nameInput.value.trim() || "untitled";
        // When editing an existing tile, keep its id so the save overwrites it
        // (a renamed tile updates in place rather than spawning a duplicate).
        const id =
            this.editor.editingId ??
            (name
                .toLowerCase()
                .replace(/[^a-z0-9_-]+/g, "_")
                .replace(/^_+|_+$/g, "") ||
                `tile_${Date.now()}`);
        return {
            id,
            name,
            category: this.catSelect.value as Category,
            stackable: this.stackInput.checked,
        };
    }

    refresh(): void {
        for (const [id, btn] of this.toolBtns) {
            btn.classList.toggle("active", this.editor.tool === id);
        }
        const sel = this.editor.selection.size;
        this.clearSelBtn.disabled = sel === 0;
        const off = this.editor.floorOffset;
        this.floorValEl.textContent =
            off == null ? "Base —" : `Base ${off > 0 ? "+" : ""}${off}`;
        this.spreadValEl.textContent = `Spread ${this.spread}%`;
        this.gridBtn.classList.toggle("active", this.editor.gridOn);
        this.edgesBtn.classList.toggle("active", this.editor.edgesOn);
        this.explodeValEl.textContent = `Explode ${this.editor.explode}`;
        this.focusValEl.textContent =
            this.editor.focusLayer == null
                ? "Layer all"
                : `Layer ${this.editor.focusLayer}`;
        this.infoEl.textContent =
            `${this.editor.voxels.length} voxels` +
            (sel > 0 ? ` · ${sel} selected` : "");
    }
}
