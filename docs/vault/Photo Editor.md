---
tags: [feature, photos]
---
# Photo editor (PR #96)

Admins (`ADMIN_IDS`) can change pictures from the app. Readers see the change straight away.

- **Slots:**
  - `leader:<id>`: square portrait;
  - `period:<id>`: 4:5 cover;
  - `event:<slug>`: square picture.
- **How it works:** "Add photo" or "Change photo", drag and zoom in a frame, then Save. The crop is made on the phone (JPEG at 512² or 640×800). "Remove photo" restores the app's own picture.
- **Server side:**
  - Files go to R2 at `photos/<kind>/<id>/<time>.<ext>`. A KV manifest, `photos:manifest`, says which file each slot shows.
  - The file type is read from its bytes (JPEG, PNG or WebP only). Files over 2.5 MB are rejected. Only keys the Worker wrote are served.
- **API:**
  - `GET /api/photos` and `GET /api/photos/file/<key>` are public.
  - `PUT` and `DELETE /api/admin/photos?slot=` are for admins only.
- **Code:**
  - `bot/src/photos.mjs` and `photos.ts`, `app/src/ui/photo-edit.tsx` and `.css`, and `Timeline.tsx`.
  - Which picture shows: the event's photo first, then the leader's, then the default.
- **Tests:** `bot/tests/photos.test.mjs` and `e2e/photos.spec.ts`.
- **No secrets reach the client.**
