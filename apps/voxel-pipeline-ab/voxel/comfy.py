"""Minimal ComfyUI HTTP client for Path B step 1 (text -> concept image).

Loads the ``obj-concept.json`` API-format workflow, patches the object
description / seed / LoRA-checkpoint names, POSTs it to a running ComfyUI server,
polls history until the job finishes, and downloads the resulting PNG. Uses only
the stdlib so it adds no dependencies.
"""

from __future__ import annotations

import json
import time
import urllib.parse
import urllib.request
import uuid
from pathlib import Path
from typing import Optional

from .paths import WORKFLOWS_DIR


def load_workflow(name: str = "obj-concept") -> dict:
    path = name if name.endswith(".json") else str(WORKFLOWS_DIR / f"{name}.json")
    return json.loads(Path(path).read_text(encoding="utf-8"))


def patch_workflow(
    workflow: dict,
    *,
    description: str,
    seed: int,
    ckpt_name: Optional[str] = None,
    lora_name: Optional[str] = None,
    steps: Optional[int] = None,
    cfg: Optional[float] = None,
) -> dict:
    wf = json.loads(json.dumps(workflow))  # deep copy
    if "6" in wf:
        text = wf["6"]["inputs"].get("text", "{object}")
        wf["6"]["inputs"]["text"] = text.replace("{object}", description)
    if "3" in wf:
        wf["3"]["inputs"]["seed"] = int(seed)
        if steps is not None:
            wf["3"]["inputs"]["steps"] = steps
        if cfg is not None:
            wf["3"]["inputs"]["cfg"] = cfg
    if ckpt_name and "4" in wf:
        wf["4"]["inputs"]["ckpt_name"] = ckpt_name
    if lora_name and "10" in wf:
        wf["10"]["inputs"]["lora_name"] = lora_name
    return wf


class ComfyClient:
    def __init__(self, base_url: str = "http://127.0.0.1:8188"):
        self.base_url = base_url.rstrip("/")
        self.client_id = uuid.uuid4().hex

    def _post(self, route: str, payload: dict) -> dict:
        req = urllib.request.Request(
            f"{self.base_url}{route}",
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read())

    def _get(self, route: str) -> dict:
        with urllib.request.urlopen(f"{self.base_url}{route}", timeout=30) as resp:
            return json.loads(resp.read())

    def queue(self, workflow: dict) -> str:
        result = self._post("/prompt", {"prompt": workflow, "client_id": self.client_id})
        return result["prompt_id"]

    def wait(self, prompt_id: str, *, timeout: float = 180.0, poll: float = 1.0) -> dict:
        deadline = time.time() + timeout
        while time.time() < deadline:
            history = self._get(f"/history/{prompt_id}")
            if prompt_id in history:
                return history[prompt_id]
            time.sleep(poll)
        raise TimeoutError(f"ComfyUI job {prompt_id} did not finish in {timeout}s")

    def download_images(self, history: dict, out_dir: Path) -> list[Path]:
        out_dir.mkdir(parents=True, exist_ok=True)
        saved: list[Path] = []
        for node_output in history.get("outputs", {}).values():
            for img in node_output.get("images", []):
                params = urllib.parse.urlencode(
                    {
                        "filename": img["filename"],
                        "subfolder": img.get("subfolder", ""),
                        "type": img.get("type", "output"),
                    }
                )
                with urllib.request.urlopen(f"{self.base_url}/view?{params}", timeout=60) as resp:
                    data = resp.read()
                dest = out_dir / img["filename"]
                dest.write_bytes(data)
                saved.append(dest)
        return saved


def generate_concept(
    description: str,
    out_dir: Path,
    *,
    base_url: str = "http://127.0.0.1:8188",
    seed: int = 0,
    ckpt_name: Optional[str] = None,
    lora_name: Optional[str] = None,
    workflow_name: str = "obj-concept",
    timeout: float = 180.0,
) -> Path:
    """Run the concept-image workflow and return the path to the first PNG."""
    wf = patch_workflow(
        load_workflow(workflow_name),
        description=description,
        seed=seed,
        ckpt_name=ckpt_name,
        lora_name=lora_name,
    )
    client = ComfyClient(base_url)
    prompt_id = client.queue(wf)
    history = client.wait(prompt_id, timeout=timeout)
    images = client.download_images(history, out_dir)
    if not images:
        raise RuntimeError("ComfyUI produced no images")
    return images[0]
