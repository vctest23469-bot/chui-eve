#!/bin/zsh
set -eu
chui_root="$HOME/Library/Application Support/Chui Eve"
uv venv --allow-existing --python 3.11 "$chui_root/mlx-env"
uv pip install --python "$chui_root/mlx-env/bin/python" -r requirements-mlx.lock
"$chui_root/mlx-env/bin/python" - <<'PY'
from pathlib import Path
from huggingface_hub import snapshot_download
snapshot_download('mlx-community/Qwen3-ASR-1.7B-4bit',revision='78a389c776a5483b2d0d4ea5494e11012e0d6159',local_dir=str(Path.home()/'Library/Application Support/Chui Eve/models/Qwen3-ASR-1.7B-4bit'),ignore_patterns=['*.safetensors'])
PY
python3 scripts/download-model.py
