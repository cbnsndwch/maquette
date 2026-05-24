import { Dialog as BaseDialog } from '@base-ui-components/react/dialog';
import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

export const Dialog = BaseDialog.Root;
export const DialogTrigger = BaseDialog.Trigger;
export const DialogClose = BaseDialog.Close;
export const DialogTitle = BaseDialog.Title;
export const DialogDescription = BaseDialog.Description;

export function DialogContent({
    className,
    children,
    ...props
}: ComponentProps<typeof BaseDialog.Popup>): React.JSX.Element {
    return (
        <BaseDialog.Portal>
            <BaseDialog.Backdrop className="fixed inset-0 z-[45] bg-[rgba(20,30,40,0.45)] transition-opacity data-[starting-style]:opacity-0 data-[ending-style]:opacity-0" />
            <BaseDialog.Popup
                className={cn(
                    'fixed left-1/2 top-1/2 z-[46] -translate-x-1/2 -translate-y-1/2',
                    'flex flex-col gap-4 rounded-[18px] bg-paper p-[22px] shadow-panel',
                    'transition-[transform,opacity] data-[starting-style]:scale-95 data-[starting-style]:opacity-0 data-[ending-style]:scale-95 data-[ending-style]:opacity-0',
                    className
                )}
                {...props}
            >
                {children}
            </BaseDialog.Popup>
        </BaseDialog.Portal>
    );
}
