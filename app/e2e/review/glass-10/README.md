# Platform/performance visual review

Actual production-browser captures at 390×844 and 1280×800: light, dark, sepia and reduced-transparency appearances, each showing the reader, held dock selection, verse-selection sheet and Scripture menu. There are 32 images before and 32 after. Remote thumbnails are blocked consistently; Bible text/relations come from the same cached public data.

- Before: section 09 production bundle, with equivalent runtime at `8be015b`.
- After: `2ec3fb5281753d0b073be5cb4dbae0fd95434300`, including the static icon-path optimization and Search touch fix.
- The visual result should remain consistent; the optimizations change repeated rendering work and snapshot scope.
- These are browser screenshots, not physical Telegram-device captures.

The accompanying production profile records Chromium 153, a 390×844 viewport and 4× CPU throttle for dock drag, first sheet opening, menu morph and reader scrolling. Measurements retain slow frames; refresh intervals and main-thread task work are separate metrics. The profiling procedure and results are attached after the full-suite runner releases the machine for an isolated sample.
