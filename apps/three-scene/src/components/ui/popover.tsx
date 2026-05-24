import { Popover as BasePopover } from '@base-ui-components/react/popover';
import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

export const Popover = BasePopover.Root;

type PositionerProps = ComponentProps<typeof BasePopover.Positioner>;

export function PopoverContent({
    className,
    anchor,
    side = 'right',
    sideOffset = 8,
    children,
    ...props
}: ComponentProps<typeof BasePopover.Popup> & {
    anchor?: PositionerProps['anchor'];
    side?: PositionerProps['side'];
    sideOffset?: number;
}): React.JSX.Element {
    return (
        <BasePopover.Portal>
            <BasePopover.Positioner
                anchor={anchor}
                side={side}
                align="start"
                sideOffset={sideOffset}
                className="z-[60]"
            >
                <BasePopover.Popup
                    className={cn(
                        'rounded-xl bg-paper p-3 shadow-panel outline-none',
                        className
                    )}
                    {...props}
                >
                    {children}
                </BasePopover.Popup>
            </BasePopover.Positioner>
        </BasePopover.Portal>
    );
}
