# Final reader interaction review

Actual production-browser screenshots before (`2ec3fb5`) and after (`ccff1e1`), at 390×844 and 1280×800 in light, dark, sepia and reduced-transparency appearances. Each phase has 32 images: selected-verse context, version picker, chapter people and class gallery. Finite opening/stagger animations finish before the capture; remote media thumbnails are blocked consistently.

Selected context uses readable semantic ink instead of 30% group opacity. Version/person/gallery metadata uses shared theme ink, and the people portal follows the current root theme. The selected verse still has its dashed underline; stored preferences and authored highlight colors remain unchanged.

Typecheck, build and 36 app tests pass. All 32 interaction checks pass in Chromium/WebKit (eight palettes × standard/increased contrast × two engines). The new assertion fails against the previous production build, confirming that it detects the faded context. Existing contrast thresholds and main-route coverage are unchanged. The parent integration suite checks the broader application and Worker behavior; its outcome is recorded in the PR.

The [parent production comparison](../glass-10/README.md) and reproducible profiler retain slow frames and the unmet 16ms target. A final same-machine sample for this reader-state adjustment is recorded when the integration runner releases the machine; browser or physical-device results are never inferred from these screenshots.
