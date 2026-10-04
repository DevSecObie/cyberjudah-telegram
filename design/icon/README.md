# CyberJudah icon source

`cyberjudah-layers.svg` is the editable source. It preserves the existing mark’s blue cybernetic left half, golden natural right half and front-facing lion. Simplified vector paths replace the small raster’s fine texture. The three top-level groups are `background`, `middle` (mane/circuitry) and `foreground` (face). The shared paths in `defs` remain editable; complementary clips separate the face and mane without introducing effects.

Exports are in `app/public/icons/`. Light/dark squares have opaque full-bleed backgrounds, with no corner mask, outer shadow or gloss. Maskable exports keep the complete mark inside the central 80%-diameter circle. Monochrome uses one ink with transparent negative spaces; `clear.svg` has a transparent background. `layers/` contains three 1024px transparent/opaque layers for future native composition. The existing in-app logo and BotFather avatar are unchanged.

To regenerate from the SVG, install the repository's development dependencies and Chromium, then install `requirements.txt` into a separate Python environment and run `python design/icon/export.py`. CairoSVG renders ordinary layers; the included Playwright renderer handles the monochrome SVG's luminance mask. Neither adds an app runtime dependency.

Serve the repository directory locally and open `design/icon/preview.html` for the light, dark, maskable, monochrome and 16/32/64px review. `?phase=before` uses the original asset. `?theme=dark` or `?theme=sepia` changes the review background. Preview corners are illustrative, not Apple's proprietary grid or a native rendering claim.

For the future iOS app, import the three `layers/*.png` files into [Icon Composer](https://developer.apple.com/icon-composer/), review Apple's current grids and appearance variants, and let the system add its lighting, masking and material effects. Web manifests do not offer native clear/tinted appearance selection; the clear and monochrome artwork are prepared for that step. Browser favicon media queries select the supplied dark appearance where supported.
