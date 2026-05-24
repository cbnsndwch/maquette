import { assetsForCategory, CATEGORIES, type Category } from '../config.js';
import type { Game } from '../core/game.js';

/**
 * Bottom palette: category tabs + a swatch row for the active category. Terrain
 * is populated from the baked cells; the top-layer categories (nature / props /
 * buildings) are intentionally empty for now and show a placeholder.
 */
export class Palette {
    private readonly tabButtons = new Map<Category, HTMLButtonElement>();
    private renderedCategory: Category | null = null;

    constructor(
        private readonly tabsEl: HTMLElement,
        private readonly gridEl: HTMLElement,
        private readonly game: Game,
        private readonly thumbnails: Map<string, string>
    ) {
        this.buildTabs();
        this.renderGrid();
    }

    private buildTabs(): void {
        this.tabsEl.innerHTML = '';
        for (const c of CATEGORIES) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'tab';
            btn.textContent = c[0]!.toUpperCase() + c.slice(1);
            btn.addEventListener('click', () => this.game.setCategory(c));
            this.tabsEl.appendChild(btn);
            this.tabButtons.set(c, btn);
        }
    }

    private renderGrid(): void {
        this.gridEl.innerHTML = '';
        const items = assetsForCategory(this.game.category);

        if (items.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'palette-empty';
            empty.textContent = 'Top-layer assets coming soon';
            this.gridEl.appendChild(empty);
            this.renderedCategory = this.game.category;
            return;
        }

        for (const def of items) {
            const swatch = document.createElement('button');
            swatch.type = 'button';
            swatch.className = 'swatch';
            swatch.dataset.assetId = def.id;

            const thumb = this.thumbnails.get(def.id);
            if (thumb) {
                const img = document.createElement('img');
                img.className = 'thumb';
                img.src = thumb;
                img.alt = def.name;
                swatch.appendChild(img);
            }

            const name = document.createElement('span');
            name.className = 'name';
            name.textContent = def.name;
            swatch.appendChild(name);

            swatch.addEventListener('click', () =>
                this.game.selectAsset(def.id)
            );
            this.gridEl.appendChild(swatch);
        }
        this.renderedCategory = this.game.category;
    }

    update(): void {
        for (const [c, btn] of this.tabButtons) {
            btn.classList.toggle('active', c === this.game.category);
        }
        if (this.renderedCategory !== this.game.category) {
            this.renderGrid();
        }
        for (const sw of this.gridEl.querySelectorAll<HTMLElement>('.swatch')) {
            sw.classList.toggle(
                'selected',
                sw.dataset.assetId === this.game.selectedAssetId
            );
        }
    }

    /** Set/replace a tile's swatch thumbnail. */
    setThumbnail(id: string, dataUrl: string): void {
        this.thumbnails.set(id, dataUrl);
    }

    /** Force a re-render of the swatch grid (e.g. after a tile is added). */
    refresh(): void {
        this.renderGrid();
        this.update();
    }
}
