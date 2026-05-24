import { PerspectiveCamera } from 'three';
import {
    createCliRenderer,
    FrameBufferRenderable,
    RGBA,
    TextRenderable,
    type KeyEvent
} from '@opentui/core';
import { ThreeCliRenderer, SuperSampleType } from '@opentui/three';
import { buildScene, suggestCameraPosition } from '@cbnsndwch/world-core';
import type { WorldSpec } from '@cbnsndwch/contracts';

/**
 * Render a {@link WorldSpec} as a live 3D scene in the terminal via
 * `@opentui/three` (WebGPU → 24-bit partial-block rasterisation). The camera
 * auto-orbits around the island. Press `q` to quit.
 *
 * This function throws if the WebGPU runtime is unavailable (e.g. plain Node
 * without Bun). The caller should catch and fall back to {@link renderAscii}.
 */
export async function render3d(spec: WorldSpec, header: string): Promise<void> {
    const renderer = await createCliRenderer({
        exitOnCtrlC: true,
        targetFps: 30,
        clearOnShutdown: true
    });

    const WIDTH = renderer.terminalWidth;
    const HEIGHT = renderer.terminalHeight;

    const framebufferRenderable = new FrameBufferRenderable(renderer, {
        id: 'three-main',
        width: WIDTH,
        height: HEIGHT,
        zIndex: 10
    });
    renderer.root.add(framebufferRenderable);
    const { frameBuffer: framebuffer } = framebufferRenderable;

    const engine = new ThreeCliRenderer(renderer, {
        width: WIDTH,
        height: HEIGHT,
        focalLength: 8,
        backgroundColor: RGBA.fromValues(0, 0, 0, 1),
        superSample: SuperSampleType.NONE
    });
    await engine.init();

    const scene = buildScene(spec);
    const cam = suggestCameraPosition();
    const [px, py, pz] = cam.position;
    const [tx, ty, tz] = cam.target;

    const camera = new PerspectiveCamera(60, engine.aspectRatio, 0.01, 1000);
    camera.position.set(px, py, pz);
    camera.lookAt(tx, ty, tz);
    scene.add(camera);
    engine.setActiveCamera(camera);

    const titleText = new TextRenderable(renderer, {
        id: 'three-title',
        content: header,
        position: 'absolute',
        fg: '#FFFFFF',
        zIndex: 20
    });
    renderer.root.add(titleText);

    const controlsText = new TextRenderable(renderer, {
        id: 'three-controls',
        content: 'auto-orbit  ·  q quit  ·  --ascii for 2D map',
        position: 'absolute',
        top: HEIGHT - 1,
        fg: '#888888',
        zIndex: 20
    });
    renderer.root.add(controlsText);

    const orbitRadius = Math.sqrt(px * px + pz * pz);
    const orbitY = py;
    let orbitAngle = Math.atan2(pz, px);

    const animate = async (deltaTime: number) => {
        orbitAngle += deltaTime * 0.3;
        camera.position.x = Math.cos(orbitAngle) * orbitRadius;
        camera.position.z = Math.sin(orbitAngle) * orbitRadius;
        camera.position.y = orbitY;
        camera.lookAt(tx, ty, tz);
        camera.updateProjectionMatrix();
        engine.drawScene(scene, framebuffer, deltaTime);
    };

    renderer.on('resize', (width: number, height: number) => {
        framebuffer.resize(width, height);
        engine.setSize(width, height);
        camera.aspect = engine.aspectRatio;
        camera.updateProjectionMatrix();
        controlsText.y = height - 1;
    });

    renderer.keyInput.on('keypress', (key: KeyEvent) => {
        if (key.name === 'q') {
            renderer.destroy();
        }
    });

    renderer.setFrameCallback(animate);
    renderer.start();
}
