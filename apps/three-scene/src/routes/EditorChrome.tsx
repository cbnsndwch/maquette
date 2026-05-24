import { useLoaderData } from 'react-router';

import { ColorPalette } from '@/components/ColorPalette';
import { EditContextMenu } from '@/components/EditContextMenu';
import { EditorPanel } from '@/components/EditorPanel';

import type { EditorLoaderData } from '../router.js';

/** Tile-editor chrome: left color palette + right editor panel + context menu. */
export function EditorChrome(): React.JSX.Element {
    const { def } = useLoaderData() as EditorLoaderData;
    // Key by tile so switching tiles remounts the panel (resets the save form);
    // a new/imported tile keeps the same 'new' key so its form state persists.
    return (
        <>
            <ColorPalette />
            <EditorPanel key={def?.id ?? 'new'} def={def} />
            <EditContextMenu />
        </>
    );
}
