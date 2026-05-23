import { afterEach, describe, expect, it } from 'vitest';

import {
    assetUrl,
    resetAssetResolver,
    setAssetResolver
} from './asset-url.mjs';

describe('assetUrl', () => {
    afterEach(() => resetAssetResolver());

    it('passes the path through by default (browser)', () => {
        expect(assetUrl('/assets/dome.vox')).toBe('/assets/dome.vox');
    });

    it('uses an installed resolver (e.g. Tauri convertFileSrc)', () => {
        setAssetResolver(p => `tauri://localhost/${p}`);
        expect(assetUrl('assets/dome.vox')).toBe(
            'tauri://localhost/assets/dome.vox'
        );
    });

    it('resets back to the default', () => {
        setAssetResolver(() => 'overridden');
        resetAssetResolver();
        expect(assetUrl('x')).toBe('x');
    });
});
