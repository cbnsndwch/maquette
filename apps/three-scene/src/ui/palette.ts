import { assetsForCategory, CATEGORIES, type Category } from '../config.js';
import type { Game } from '../core/game.js';

interface Section {
    root: HTMLElement;
    head: HTMLButtonElement;
    body: HTMLElement;
    grid: HTMLElement;
    count: HTMLElement;
}

/**
 * Right-dock palette: one collapsible **accordion per category** (replacing the
 * old tabs). Terrain is populated from the baked cells; the other categories are
 * filled by tiles authored in the editor. The active category's accordion is
 * kept open so keyboard category-switching stays visible.
 */
export class Palette {
    private readonly sections = new Map<Category, Section>();
    private readonly open = new Set<Category>();
    private renderedCategory: Category | null = null;

    constructor(
        private readonly root: HTMLElement,
        private readonly game: Game,
        private readonly thumbnails: Map<string, string>
    ) {
        this.build();
        this.open.add(this.game.category);
        for (const c of CATEGORIES) this.renderGrid(c);
        this.update();
    }

    private build(): void {
        this.root.innerHTML = '';
        for (const c of CATEGORIES) {
            const root = document.createElement('section');
            root.className = 'cat';

            const head = document.createElement('button');
            head.type = 'button';
            head.className = 'cat-head';
            const title = document.createElement('span');
            title.className = 'cat-title';
            title.textContent = c[0]!.toUpperCase() + c.slice(1);
            const count = document.createElement('span');
            count.className = 'cat-count';
            const chev = document.createElement('span');
            chev.className = 'cat-chev';
            chev.textContent = '▸';
            head.append(title, count, chev);
            head.addEventListener('click', () => this.toggle(c));

            const body = document.createElement('div');
            body.className = 'cat-body';
            const grid = document.createElement('div');
            grid.className = 'cat-grid';
            body.appendChild(grid);

            root.append(head, body);
            this.root.appendChild(root);
            this.sections.set(c, { root, head, body, grid, count });
        }
    }

    private toggle(c: Category): void {
        if (this.open.has(c)) this.open.delete(c);
        else this.open.add(c);
        this.applyOpenState();
    }

    private renderGrid(c: Category): void {
        const section = this.sections.get(c);
        if (!section) return;
        const items = assetsForCategory(c);
        section.grid.innerHTML = '';
        section.count.textContent = String(items.length);

        if (items.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'palette-empty';
            empty.textContent = 'No tiles yet';
            section.grid.appendChild(empty);
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
            section.grid.appendChild(swatch);
        }
    }

    private applyOpenState(): void {
        for (const [c, section] of this.sections) {
            section.root.classList.toggle('open', this.open.has(c));
        }
    }

    update(): void {
        // Keep the active category revealed (e.g. after a 1–4 key switch).
        if (this.renderedCategory !== this.game.category) {
            this.open.add(this.game.category);
            this.renderedCategory = this.game.category;
        }
        for (const [c, section] of this.sections) {
            section.head.classList.toggle('active', c === this.game.category);
        }
        this.applyOpenState();
        for (const sw of this.root.querySelectorAll<HTMLElement>('.swatch')) {
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

    /** Force a re-render of every category grid (e.g. after a tile is added). */
    refresh(): void {
        for (const c of CATEGORIES) this.renderGrid(c);
        this.update();
    }
}
