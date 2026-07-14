#!/bin/bash
# Double-click this file in Finder to run lister.py.
# It changes into its own folder first so lister.py sees the images.
cd "$(dirname "$0")" || exit 1
python3 lister.py
echo
echo "Done. You can close this window."
