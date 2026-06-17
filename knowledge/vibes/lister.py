import os
import json
try:
    from PIL import Image
    from pillow_heif import register_heif_opener
    register_heif_opener()
except ImportError as e:
    print("Got import error", e)
    print("You need to install pillow and pillow-heif: `pip3 install pillow pillow-heif`")
    import sys; sys.exit(1);

files = []
for file in os.listdir("."):
    try:
        im = Image.open(file)
        files.append([file, [im.width, im.height]])
    except: # e.g. .DS_Store, calculater.py, file
        continue
json.dump(files, open("image_widths_heights.json", 'w'))
print(f"Successfully created image_widths_heights.json with {len(files)} files.")