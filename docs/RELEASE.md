# SmartPDF Studio — MVP release notes (Step 10)

## 1. Implemented features (frontend MVP)

- Dashboard with upload, metadata list, search/sort, delete, clear local data
- PDF.js viewer: page navigation, lazy thumbnails, zoom, fit modes, pan tool
- Editor overlays: text, PNG/JPEG images, solid-color masks with eyedropper and before/after preview
- Modular background engine interface (solid color only; inpainting stub)
- PDF.js text inspection and overlay-based “replacement” (no native text rewrite)
- Tesseract.js OCR (English) with region mode, progress, cancel, overlay corrections
- Undo/redo for overlay metadata; export via pdf-lib
- IndexedDB persistence for user PDF bytes, overlay sessions, image assets
- Original vs edited comparison modal with synced scroll/zoom/page

## 2. Files changed in Step 10 (stabilization)

- `src/features/pdf-editor/components/PdfWorkspace.tsx` — pan tool drag-to-scroll
- `src/features/pdf-editor/components/PdfWorkspace.module.css` — pan cursors
- `src/features/pdf-editor/PageOverlayLayer.tsx` — pass-through when pan active
- `src/features/pdf-editor/components/EditorToolsStrip.tsx` — enable pan tool
- `src/features/pdf-editor/components/EditorToolsStrip.module.css` — touch targets
- `src/features/pdf-viewer/PageThumbnail.tsx` — thumbnail DPR capped at 1
- `src/features/ocr/OcrSessionContext.tsx` — ignore duplicate OCR starts
- `src/features/comparison/DocumentComparisonModal.module.css` — mobile layout
- `src/features/persistence/loadRestoredEditorSession.ts` — extracted loader
- `src/features/persistence/EditorPersistenceHost.tsx` — cleanup exports
- `src/features/pdf-editor/editorHistory.test.ts` — unit tests
- `src/lib/persistence/editorSessionStore.test.ts` — unit tests
- `src/lib/ocr/classifyOcrText.test.ts` — unit tests
- `vitest.config.ts`, `package.json` — test script
- `README.md`, `docs/RELEASE.md` — documentation

## 3. Build and test results (actually run)

| Command | Result |
|---------|--------|
| `npm run build` | **Pass** (TypeScript + Vite production build) |
| `npm run lint` | **Pass** (oxlint warnings only, no errors) |
| `npm run test` | **Pass** — 6 tests (editor history, session validation, OCR price tags) |

Automated browser/E2E tests and manual PDF matrix tests were **not** run in CI; use the checklist below locally.

## 4. Known bugs and technical limitations

### PDF / export

- Overlays are drawn on top of the original PDF; **masks do not remove** underlying text or images from the file.
- Export uses standard PDF fonts for text overlays; **no matching** of embedded document fonts.
- Rotated or non-standard page boxes may show **small alignment drift** between PDF.js view and pdf-lib export.
- Very large PDFs may hit browser memory limits; upload capped by `PDF_MAX_FILE_SIZE_BYTES`.

### Text inspection

- PDF.js positions are approximate for some fonts/layouts; low-confidence hits skip highlights.
- No true in-place editing of existing PDF text objects.

### OCR

- English only in this build; Bangla requires bundling traineddata.
- OCR on photos/scans is error-prone; boxes are estimates.
- First OCR run downloads language data (network required once).

### Persistence

- **Browser-only** — clearing site data or another profile loses sessions.
- QuotaExceededError possible for large PDFs + many image overlays.
- Corrupted or future schema versions start a **fresh** session (no merge).

### UI

- Demo documents have no PDF bytes until upload.
- Pan tool disables overlay hit-testing (by design).

## 5. Requires backend or external AI (not in this MVP)

- Server-side PDF storage, sharing, or collaboration
- Secure redaction / content-stream removal
- AI inpainting / background reconstruction
- Cloud OCR with higher accuracy
- Bangla (or other) OCR without shipping traineddata
- User accounts, auth, or cross-device sync
- Sending documents to external APIs without explicit product consent

## 6. Manual acceptance test checklist

Use a **user-uploaded** PDF unless noted.

- [ ] Dashboard loads; upload valid PDF succeeds; invalid file shows friendly error
- [ ] Thumbnails appear when scrolling pages panel; main page renders
- [ ] Zoom in/out/reset; fit page and fit width; **Pan** tool drags scroll area
- [ ] Add text overlay; edit content; move/resize; undo/redo
- [ ] Upload image; place on page; move/resize
- [ ] Draw mask; eyedropper color; opacity; before/after preview; export includes cover
- [ ] PDF Text tab: search selectable text; highlight; overlay correction flow
- [ ] OCR tab: run page OCR; cancel; select word; apply correction (English)
- [ ] Refresh browser; reopen document — overlays and page/zoom restore
- [ ] Compare modal: same page both sides; scroll sync; overlay hints visible
- [ ] Export PDF; open in external viewer — overlays visible; original not destroyed in app storage
- [ ] Leave editor with unsaved changes — confirmation; dashboard **Clear all local data** works

### Suggested PDF matrix (manual)

Prepare or reuse PDFs with: multi-page, mixed page sizes, rotation, selectable text, embedded fonts, tables, scan-only pages, prices in images, transparent PNG overlays on page, busy backgrounds. Record pass/fail per row in your QA log.

## 7. Representative test PDFs

This repo does **not** ship copyrighted PDF fixtures. Generate minimal samples locally (print-to-PDF, LibreOffice export, or scanned phone photos) covering the matrix above.

## 8. Security and privacy (verified by design)

- Upload validation: extension, MIME, size, `%PDF-` signature
- User-facing errors avoid stack traces (`PdfUserFacingError`, antd messages)
- No document upload to a SmartPDF server in this build
- Local deletion available on dashboard
