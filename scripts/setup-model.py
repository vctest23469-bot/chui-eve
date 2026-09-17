"""Install public MLX models at pinned revisions, verify weights before use."""
import argparse
import hashlib
from pathlib import Path
from huggingface_hub import snapshot_download

MODELS = {
    "bf16": ("mlx-community/Qwen3-ASR-1.7B-bf16", "e1f6c266914abc5a46e8756e02580f834a6cf8a7",
             "2f080a3b769ae469aeaaa2dcb9e13a94141e54c9e6d5a7aa63392e0dc5a51789"),
    "4bit": ("mlx-community/Qwen3-ASR-1.7B-4bit", "78a389c776a5483b2d0d4ea5494e11012e0d6159",
             "9848eaf7a5c1589c671b35035ac27b72e248dd0c604eacae547e7e403d29db45"),
}

def install():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", choices=MODELS, default="4bit")
    args = parser.parse_args()
    repo, revision, expected = MODELS[args.model]
    root = Path.home() / "Library/Application Support/Chui Eve/models" / repo.split("/")[1]
    snapshot_download(repo, revision=revision, local_dir=str(root))
    digest = hashlib.sha256()
    with (root / "model.safetensors").open("rb") as weights:
        while block := weights.read(1024 * 1024):
            digest.update(block)
    if digest.hexdigest() != expected:
        (root / "model.safetensors").rename(root / "model.safetensors.invalid")
        raise RuntimeError("Model checksum mismatch; incomplete weights disabled")
    print("Model installed and SHA-256 verified.")

if __name__ == "__main__":
    install()
