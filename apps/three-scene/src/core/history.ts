interface HistoryEntry<T> {
    state: T;
    /** True when this entry was recorded by a save, not a document edit. */
    milestone?: boolean;
}

/**
 * Generic undo/redo stack with unbounded depth. Stores whole-state snapshots:
 * the caller hands over the state it's about to leave via {@link record} before
 * mutating, and passes the current state into {@link undo}/{@link redo} so the
 * inverse can be pushed onto the opposite stack.
 *
 * Save points can be recorded as milestone entries via {@link milestone}; they
 * are navigated exactly like regular edits but are flagged so the UI can label
 * the undo/redo buttons appropriately.
 */
export class History<T> {
    private readonly undoStack: HistoryEntry<T>[] = [];
    private readonly redoStack: HistoryEntry<T>[] = [];

    /** Remember `before` as a state we can return to, and invalidate redo. */
    record(before: T): void {
        this.undoStack.push({ state: before });
        this.redoStack.length = 0;
    }

    /**
     * Record `current` as a save milestone. The entry behaves exactly like a
     * regular undo step (undoing it restores the saved state), but is flagged
     * so callers can distinguish it from content edits.
     */
    milestone(current: T): void {
        this.undoStack.push({ state: current, milestone: true });
        this.redoStack.length = 0;
    }

    /** Step back one state; `current` is banked for a later redo. */
    undo(current: T): T | null {
        const entry = this.undoStack.pop();
        if (entry === undefined) return null;
        this.redoStack.push({ state: current });
        return entry.state;
    }

    /** Step forward one state; `current` is banked for a later undo. */
    redo(current: T): T | null {
        const entry = this.redoStack.pop();
        if (entry === undefined) return null;
        this.undoStack.push({ state: current });
        return entry.state;
    }

    get canUndo(): boolean {
        return this.undoStack.length > 0;
    }

    get canRedo(): boolean {
        return this.redoStack.length > 0;
    }

    /** True when the next undo step is a save milestone. */
    get nextUndoIsMilestone(): boolean {
        return !!this.undoStack[this.undoStack.length - 1]?.milestone;
    }

    /** True when the next redo step is a save milestone. */
    get nextRedoIsMilestone(): boolean {
        return !!this.redoStack[this.redoStack.length - 1]?.milestone;
    }

    /** Drop all history (e.g. when a fresh document is loaded). */
    clear(): void {
        this.undoStack.length = 0;
        this.redoStack.length = 0;
    }
}
