import type { Game, Tool } from '../core/game.js';

interface ToolButton {
    id: string;
    label: string;
    icon: string;
}

// Simple cobalt-ink SVG glyphs (24×24 viewBox), one visual language for the rail.
const ICONS: Record<string, string> = {
    tile: '<path d="M12 2 3 7v10l9 5 9-5V7z"/><path d="M3 7l9 5 9-5M12 12v10"/>',
    place: '<path d="M12 2C8.7 2 6 4.7 6 8c0 4.5 6 12 6 12s6-7.5 6-12c0-3.3-2.7-6-6-6z"/><circle cx="12" cy="8" r="2.2" fill="#fff"/>',
    erase: '<path d="M4 15.5 12 7.5l5 5-5 5H7z"/><path d="M9 20h11"/>',
    pan: '<path d="M12 3v18M3 12h18"/><path d="M12 3 9.5 5.5M12 3l2.5 2.5M12 21l-2.5-2.5M12 21l2.5-2.5M3 12l2.5-2.5M3 12l2.5 2.5M21 12l-2.5-2.5M21 12l-2.5 2.5"/>',
    rotate: '<rect x="8.5" y="9" width="7" height="7" rx="1"/><path d="M5 9a8 8 0 0 1 13-2.5"/><path d="M18 2.5v4h-4"/>',
    fill: '<path d="M5 9l6-6 7 7-6 6a2 2 0 0 1-2.8 0L5 11.8A2 2 0 0 1 5 9z"/><path d="M19 14s2 2.5 2 4a2 2 0 1 1-4 0c0-1.5 2-4 2-4z"/>',
    undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a6 6 0 0 1 0 12H9"/>',
    redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H9a6 6 0 0 0 0 12h6"/>',
    orbit: '<circle cx="12" cy="12" r="3"/><path d="M12 3a9 9 0 0 1 8 5M21 9l-1 -1l-2 1M12 21a9 9 0 0 1-8-5M3 15l1 1l2-1"/>',
    grid: '<path d="M4 4h16v16H4z"/><path d="M9 4v16M15 4v16M4 9h16M4 15h16"/>',
    save: '<path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/>',
    export: '<path d="M12 3v12M8 11l4 4 4-4"/><path d="M5 17v2a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2"/>',
    reset: '<path d="M19 12a7 7 0 1 1-2.3-5.2"/><path d="M19 4v4h-4"/>'
};

const BUTTONS: ToolButton[] = [
    { id: 'tile', label: 'Tile', icon: ICONS.tile! },
    { id: 'place', label: 'Place', icon: ICONS.place! },
    { id: 'erase', label: 'Erase', icon: ICONS.erase! },
    { id: 'pan', label: 'Pan', icon: ICONS.pan! },
    { id: 'rotate', label: '0°', icon: ICONS.rotate! },
    { id: 'fill', label: 'Fill', icon: ICONS.fill! },
    { id: 'undo', label: 'Undo', icon: ICONS.undo! },
    { id: 'redo', label: 'Redo', icon: ICONS.redo! },
    { id: 'orbit', label: 'Orbit', icon: ICONS.orbit! },
    { id: 'grid', label: 'Grid', icon: ICONS.grid! },
    { id: 'save', label: 'Save', icon: ICONS.save! },
    { id: 'export', label: 'Export', icon: ICONS.export! },
    { id: 'reset', label: 'Reset', icon: ICONS.reset! }
];

const TOOL_IDS = new Set<Tool>(['place', 'erase', 'pan']);

export class Toolbar {
    private readonly buttons = new Map<string, HTMLButtonElement>();

    constructor(
        private readonly root: HTMLElement,
        private readonly game: Game
    ) {
        this.build();
    }

    private build(): void {
        this.root.innerHTML = '';
        for (const def of BUTTONS) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'tool';
            btn.dataset.toolId = def.id;
            btn.innerHTML =
                `<svg class="ti" viewBox="0 0 24 24" fill="none" stroke="#1b5ba8" ` +
                `stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${def.icon}</svg>` +
                `<span class="label">${def.label}</span>`;
            btn.addEventListener('click', () => this.onClick(def.id));
            this.root.appendChild(btn);
            this.buttons.set(def.id, btn);
        }
        this.update();
    }

    private onClick(id: string): void {
        switch (id) {
            case 'tile':
                this.game.toggleMode();
                break;
            case 'place':
            case 'erase':
            case 'pan':
                this.game.setTool(id as Tool);
                break;
            case 'rotate':
                this.game.rotateBrush(1);
                break;
            case 'fill':
                this.game.fillTerrain();
                break;
            case 'undo':
                this.game.undo();
                break;
            case 'redo':
                this.game.redo();
                break;
            case 'orbit':
                this.game.toggleAutoRotate();
                break;
            case 'grid':
                this.game.toggleGrid();
                break;
            case 'save':
                this.game.save();
                break;
            case 'export':
                this.game.exportScene();
                break;
            case 'reset':
                this.game.reset();
                break;
        }
    }

    update(): void {
        for (const [id, btn] of this.buttons) {
            const active =
                (TOOL_IDS.has(id as Tool) && this.game.tool === id) ||
                (id === 'grid' && this.game.gridVisible) ||
                (id === 'orbit' && this.game.autoRotate);
            btn.classList.toggle('active', active);
        }

        // Rotate button doubles as the current-angle indicator.
        const rotateLabel = this.buttons.get('rotate')?.querySelector('.label');
        if (rotateLabel)
            rotateLabel.textContent = `${this.game.rotation * 90}°`;

        const undo = this.buttons.get('undo');
        const redo = this.buttons.get('redo');
        if (undo) undo.disabled = !this.game.canUndo;
        if (redo) redo.disabled = !this.game.canRedo;
    }
}
