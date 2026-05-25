/**
 * Generic undo/redo stack with unbounded (infinite) depth. Stores whole-state
 * snapshots: the caller hands over the state it's about to leave via {@link record}
 * before mutating, and passes the current state into {@link undo}/{@link redo} so
 * the inverse can be pushed onto the opposite stack.
 */
export class History<T> {
    private readonly undoStack: T[] = [];
    private readonly redoStack: T[] = [];

    /** Remember `before` as a state we can return to, and invalidate redo. */
    record(before: T): void {
        this.undoStack.push(before);
        this.redoStack.length = 0;
    }

    /** Step back one state; `current` is banked for a later redo. */
    undo(current: T): T | null {
        const prev = this.undoStack.pop();
        if (prev === undefined) return null;
        this.redoStack.push(current);
        return prev;
    }

    /** Step forward one state; `current` is banked for a later undo. */
    redo(current: T): T | null {
        const next = this.redoStack.pop();
        if (next === undefined) return null;
        this.undoStack.push(current);
        return next;
    }

    get canUndo(): boolean {
        return this.undoStack.length > 0;
    }

    get canRedo(): boolean {
        return this.redoStack.length > 0;
    }

    /** Drop all history (e.g. when a fresh document is loaded). */
    clear(): void {
        this.undoStack.length = 0;
        this.redoStack.length = 0;
    }
}
