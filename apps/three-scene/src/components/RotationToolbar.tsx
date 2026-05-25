import { getEngine } from "@/bootstrap";
import { cn } from "@/lib/utils";

const BTN =
    "cursor-pointer rounded-md border-[1.5px] border-ink/60 bg-transparent px-2.5 py-1.5 text-xs font-bold text-ink-deep transition-transform duration-75 hover:bg-[rgba(27,91,168,0.1)] active:scale-[0.94]";

const STEP = Math.PI / 4; // 45° per click

const CONTENT_AXES = [
    {
        label: "↻ X",
        title: "Rotate contents 90° around X axis (tilt forward/back)",
        action: () => getEngine().editor.rotateX(),
    },
    {
        label: "↻ Y",
        title: "Rotate contents 90° around Y axis (tilt left/right)",
        action: () => getEngine().editor.rotateY(),
    },
    {
        label: "↻ Z",
        title: "Rotate contents 90° around Z axis (spin)",
        action: () => getEngine().editor.rotateZ(),
    },
] as const;

const CAMERA_CONTROLS = [
    {
        label: "← View",
        title: "Orbit camera left 45°",
        action: () => getEngine().sceneView.orbitCamera(-STEP),
    },
    {
        label: "View →",
        title: "Orbit camera right 45°",
        action: () => getEngine().sceneView.orbitCamera(STEP),
    },
] as const;

/** Floating rotation helper — top-right of the tile editor view. */
export function RotationToolbar(): React.JSX.Element {
    return (
        <div className="fixed top-4 right-68.5 z-10 flex flex-col items-stretch justify-start gap-1.5 rounded-md bg-panel px-3 py-2 shadow-panel backdrop-blur-sm">
            <span className="pr-0.5 text-[10px] font-bold uppercase tracking-[0.4px] text-ink-deep opacity-50">
                Contents
            </span>
            <div className="flex flex-col gap-1.5 pl-2">
                {CONTENT_AXES.map(({ label, title, action }) => (
                    <button
                        key={label}
                        type="button"
                        title={title}
                        onClick={action}
                        className={cn(BTN)}
                    >
                        {label}
                    </button>
                ))}
            </div>

            <span className="mt-1 pr-0.5 text-[10px] font-bold uppercase tracking-[0.4px] text-ink-deep opacity-50">
                Camera
            </span>
            <div className="flex flex-col gap-1.5 pl-2">
                {CAMERA_CONTROLS.map(({ label, title, action }) => (
                    <button
                        key={label}
                        type="button"
                        title={title}
                        onClick={action}
                        className={cn(BTN)}
                    >
                        {label}
                    </button>
                ))}
            </div>
        </div>
    );
}
