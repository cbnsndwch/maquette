import { Tooltip as BaseTooltip } from '@base-ui-components/react/tooltip';
import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

export function TooltipProvider({
    delay = 200,
    ...props
}: ComponentProps<typeof BaseTooltip.Provider>): React.JSX.Element {
    return <BaseTooltip.Provider delay={delay} {...props} />;
}

export function Tooltip(
    props: ComponentProps<typeof BaseTooltip.Root>
): React.JSX.Element {
    return <BaseTooltip.Root {...props} />;
}

export function TooltipTrigger(
    props: ComponentProps<typeof BaseTooltip.Trigger>
): React.JSX.Element {
    return <BaseTooltip.Trigger {...props} />;
}

export function TooltipContent({
    className,
    sideOffset = 6,
    side,
    children,
    ...props
}: ComponentProps<typeof BaseTooltip.Popup> & {
    sideOffset?: number;
    side?: ComponentProps<typeof BaseTooltip.Positioner>['side'];
}): React.JSX.Element {
    return (
        <BaseTooltip.Portal>
            <BaseTooltip.Positioner sideOffset={sideOffset} side={side}>
                <BaseTooltip.Popup
                    className={cn(
                        'z-50 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground shadow-md',
                        'origin-[var(--transform-origin)] transition-[transform,opacity] data-[starting-style]:scale-95 data-[starting-style]:opacity-0 data-[ending-style]:scale-95 data-[ending-style]:opacity-0',
                        className
                    )}
                    {...props}
                >
                    {children}
                </BaseTooltip.Popup>
            </BaseTooltip.Positioner>
        </BaseTooltip.Portal>
    );
}
