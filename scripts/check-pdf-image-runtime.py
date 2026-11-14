"""Exercise installed PDF image dependencies without models or PDF acceptance."""
from importlib.metadata import version
from io import BytesIO
import json
import sys

import imageio.v3 as imageio
import numpy as np
from PIL import Image, features
from skimage.metrics import structural_similarity


def main():
    if Image.__version__ != "13.0.0":
        raise RuntimeError(f"Pillow 13.0.0 required; found {Image.__version__}")
    pixels = np.arange(64 * 64 * 3, dtype=np.uint8).reshape((64, 64, 3))
    for format_name in ("PNG", "JPEG", "TIFF"):
        data = BytesIO()
        Image.fromarray(pixels).save(data, format=format_name)
        data.seek(0)
        with Image.open(data) as image:
            image.load()
            assert image.size == (64, 64)
            assert image.convert("L").resize((32, 32)).size == (32, 32)
        decoded = imageio.imread(data.getvalue(), extension=f".{format_name.lower()}", plugin="pillow")
        assert decoded.shape == pixels.shape
    gray = pixels[:, :, 0]
    assert structural_similarity(gray, gray, data_range=255) == 1.0
    jpeg = BytesIO()
    Image.fromarray(np.zeros((1100, 1200), dtype=np.uint8)).save(jpeg, format="JPEG")
    jpeg.seek(0)
    with Image.open(jpeg) as image:
        image.thumbnail((256, 256))
        assert image.size == (256, 235)
    print(json.dumps({
        "python": sys.version.split()[0],
        "versions": {name: version(name) for name in ("Pillow", "scikit-image", "imageio", "numpy", "scipy")},
        "libjpegTurbo": features.version_feature("libjpeg_turbo"),
        "checks": ["PIL native import", "PNG/JPEG/TIFF encode and decode", "convert and resize",
                   "imageio Pillow plugin", "scikit-image structural_similarity", "baseline JPEG thumbnail"],
        "realPdfAcceptance": False, "adversarialJpegTest": False,
    }, indent=2))


if __name__ == "__main__":
    main()
