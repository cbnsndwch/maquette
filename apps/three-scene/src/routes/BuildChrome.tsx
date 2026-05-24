import { Palette } from '@/components/Palette';
import { Toolbar } from '@/components/Toolbar';

/** Build-mode chrome: left toolbar + right palette. */
export function BuildChrome(): React.JSX.Element {
    return (
        <>
            <Toolbar />
            <Palette />
        </>
    );
}
