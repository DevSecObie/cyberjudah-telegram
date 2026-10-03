# Final reader interaction review

Actual production-browser screenshots before (`2ec3fb5`) and after (`ccff1e1` for selection/version views; `650d3f3` for the final opaque galleries), at 390×844 and 1280×800 in light, dark, sepia and reduced-transparency appearances. Each phase has 32 images: selected-verse context, version picker, chapter people and class gallery. Finite opening/stagger animations finish before the capture; remote media thumbnails are blocked consistently.

Selected context uses readable semantic ink instead of 30% group opacity. Version/person/gallery metadata uses shared theme ink, and the people portal follows the current root theme. Galleries use opaque content surfaces, preventing the reader text from showing through their captions. The selected verse still has its dashed underline; stored preferences and authored highlight colors remain unchanged.

Typecheck, build and 36 app tests pass. All 32 interaction checks pass in Chromium/WebKit (eight palettes × standard/increased contrast × two engines). The new assertion fails against the previous production build, confirming that it detects the faded context. Existing contrast thresholds and main-route coverage are unchanged. The parent integration suite checks the broader application and Worker behavior; its outcome is recorded in the PR.

The [parent production comparison](../glass-10/README.md) and reproducible profiler retain slow frames and the unmet 16ms target. The final sample below was taken after the integration runner released the machine; browser or physical-device results are never inferred from screenshots.

## Final production sample

Production Chromium 153.0.8010.12, 4× CPU, 390×844, source `3b7a6036ca0413f7cbc0e0a8c61fe5866cfeaeff`. Each action starts in a fresh context. The parent [reproducible harness](../glass-10/profile.mjs) writes the raw traces and JSON. This quiet sample includes the final opaque galleries and touch-completion correction.

| Action | Frame median / p95 / max (ms) | Main-thread work p95 / max (ms) | Work intervals over 16ms |
| --- | --- | --- | --- |
| dock-drag | 16.7 / 16.7 / 50 | 19.86 / 55.72 | 10 |
| sheet-open | 16.7 / 16.8 / 66.7 | 24.34 / 77.18 | 5 |
| menu-morph | 16.7 / 33.4 / 133.3 | 55.38 / 88.01 | 4 |
| reader-scroll | 16.7 / 16.8 / 50 | 28.33 / 54.43 | 5 |

The requested 16ms target remains unmet. A 60Hz refresh interval explains typical 16.7ms samples, but not the recorded long tasks and missed refreshes. These are observed measurements, not a performance pass or a physical-device result. See [profile.json](profile.json) for all samples and counts.
