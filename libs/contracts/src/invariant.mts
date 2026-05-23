export interface InvariantLogger {
    error(message: string): void;
}

export type ErrorCtor<TError extends Error = Error> = new (
    message: string
) => TError;

/**
 * Throws if the condition is not met. Narrows the type via `asserts`.
 *
 * @param condition - A boolean or a function returning one.
 * @param message - The error message, or a function returning it (only invoked on failure).
 * @param errorClass - Error class to throw. Defaults to `Error`.
 * @param logger - Optional logger; its `error` method is called with the message on failure.
 */
export function invariant<TError extends Error = Error>(
    condition: boolean | (() => boolean),
    message: string | (() => string),
    errorClass?: ErrorCtor<TError>,
    logger?: InvariantLogger
): asserts condition {
    const ok = typeof condition === 'function' ? condition() : condition;
    if (ok) {
        return;
    }

    const msg = typeof message === 'function' ? message() : message;
    logger?.error(msg);

    const ErrorImpl = errorClass ?? Error;
    throw new ErrorImpl(msg);
}
