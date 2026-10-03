---
tags: [fix, ask]
---
# Ask sheet fix (PR #94, merged)

The "Your chats" sheet showed unstyled outside the Bible tab. The fix moved the sheet styles into `app/src/bible/ui/sheet.css`, which `Sheet.tsx` imports, and made `.chats-sheet` and `.edit-sheet` opaque. The [[Photo Editor]] sheet uses the same base.
