#!/bin/zsh
set -eu
chui_root="$HOME/Library/Application Support/Chui Eve"
uv venv --allow-existing --python 3.11 "$chui_root/mlx-env"
uv pip install --python "$chui_root/mlx-env/bin/python" -r requirements-mlx.lock
"$chui_root/mlx-env/bin/python" scripts/setup-model.py --model "${1:-4bit}"
