#!/bin/bash
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if ! command -v python3 >/dev/null 2>&1; then
    echo "python3 is required to run this installer but was not found."
    read -p "Press Enter to exit"
    exit 1
fi
python3 "$DIR/install.py"
