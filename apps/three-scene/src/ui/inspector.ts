import {
    assetsForCategory,
    CATEGORIES,
    type Category,
    type TerrainDef
} from '../config.js';
import type { VoxelAssets } from '../core/voxel-assets.js';

export interface InspectorHooks {
    assets: VoxelAssets;
    thumbnails: Map<string, string>;
    onEdit: (id: string) => void;
    onDelete: (id: string) => void;
    onClose: () => void;
}

/**
 * Full-screen tile library (the `/inspect` route). Lists every catalog tile in a
 * per-category accordion; clicking a tile opens a large detail modal with its
 * thumbnail, stats, and Edit / Delete actions. Built lazily into `document.body`.
 */
export class Inspector {
    private readonly root: HTMLElement;
    private readonly bodyEl: HTMLElement;
    private modal: HTMLElement | null = null;
    private readonly open = new Set<Category>();

    constructor(private readonly hooks: InspectorHooks) {
        this.root = document.createElement('section');
        this.root.id = 'inspector';
        this.root.style.display = 'none';
        this.root.innerHTML = `
            <header class="insp-head">
                <h2>Tile Library</h2>
                <span class="insp-sub">Click a tile for details</span>
                <button type="button" class="ed-btn insp-close">Close</button>
            </header>
            <div class="insp-body"></div>
        `;
        this.bodyEl = this.root.querySelector('.insp-body')!;
        this.root
            .querySelector('.insp-close')!
            .addEventListener('click', () => this.hooks.onClose());
        document.body.appendChild(this.root);
    }

    show(): void {
        // Default: reveal every category that has tiles.
        for (const c of CATEGORIES) {
            if (assetsForCategory(c).length > 0) this.open.add(c);
        }
        this.render();
        this.root.style.display = '';
    }

    hide(): void {
        this.closeModal();
        this.root.style.display = 'none';
    }

    /** Re-render after the catalog changes (e.g. a tile was deleted). */
    refresh(): void {
        if (this.root.style.display !== 'none') this.render();
    }

    private render(): void {
        this.bodyEl.innerHTML = '';
        for (const c of CATEGORIES) {
            const items = assetsForCategory(c);
            const cat = document.createElement('div');
            cat.className = 'insp-cat' + (this.open.has(c) ? ' open' : '');

            const head = document.createElement('button');
            head.type = 'button';
            head.className = 'insp-cat-head';
            head.innerHTML =
                `<span>${c}</span>` +
                `<span class="cat-count">${items.length}</span>` +
                `<span class="cat-chev">▸</span>`;
            head.addEventListener('click', () => {
                if (this.open.has(c)) this.open.delete(c);
                else this.open.add(c);
                cat.classList.toggle('open', this.open.has(c));
            });
            cat.appendChild(head);

            const body = document.createElement('div');
            body.className = 'insp-cat-body';
            if (items.length === 0) {
                const empty = document.createElement('div');
                empty.className = 'insp-empty';
                empty.textContent = 'No tiles in this category';
                body.appendChild(empty);
            } else {
                for (const def of items) body.appendChild(this.card(def));
            }
            cat.appendChild(body);
            this.bodyEl.appendChild(cat);
        }
    }

    private card(def: TerrainDef): HTMLElement {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'insp-card';
        const thumb = this.hooks.thumbnails.get(def.id);
        card.innerHTML =
            (thumb ? `<img src="${thumb}" alt="${def.name}" />` : `<img />`) +
            `<span class="name">${def.name}</span>`;
        card.addEventListener('click', () => this.openModal(def));
        return card;
    }

    private openModal(def: TerrainDef): void {
        this.closeModal();
        const [dx, dy, dz] = this.hooks.assets.dims(def.id);
        const voxels = this.hooks.assets.get(def.id).length;
        const thumb = this.hooks.thumbnails.get(def.id);

        const backdrop = document.createElement('div');
        backdrop.className = 'insp-modal-backdrop';
        backdrop.innerHTML = `
            <div class="insp-modal" role="dialog" aria-modal="true">
                <div class="insp-modal-top">
                    ${thumb ? `<img src="${thumb}" alt="${def.name}" />` : `<img />`}
                    <div>
                        <h3>${def.name}</h3>
                        <dl class="insp-meta">
                            <dt>ID</dt><dd>${def.id}</dd>
                            <dt>Category</dt><dd>${def.category}</dd>
                            <dt>Stackable</dt><dd>${def.stackable ? 'Yes' : 'No'}</dd>
                            <dt>Voxels</dt><dd>${voxels}</dd>
                            <dt>Size</dt><dd>${dx} × ${dy} × ${dz}</dd>
                        </dl>
                    </div>
                </div>
                <div class="insp-modal-actions">
                    <button type="button" class="ed-btn ed-danger" data-act="delete">Delete</button>
                    <button type="button" class="ed-btn" data-act="close">Close</button>
                    <button type="button" class="ed-btn ed-primary" data-act="edit">Edit</button>
                </div>
            </div>
        `;
        backdrop.addEventListener('click', e => {
            if (e.target === backdrop) this.closeModal();
        });
        const act = (name: string, fn: () => void) =>
            backdrop
                .querySelector(`[data-act="${name}"]`)!
                .addEventListener('click', fn);
        act('edit', () => this.hooks.onEdit(def.id));
        act('delete', () => {
            this.hooks.onDelete(def.id);
            this.closeModal();
        });
        act('close', () => this.closeModal());

        document.body.appendChild(backdrop);
        this.modal = backdrop;
    }

    private closeModal(): void {
        if (!this.modal) return;
        this.modal.remove();
        this.modal = null;
    }
}
