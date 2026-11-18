# Pit Log

Personal vehicle maintenance tracker. Static PWA (no backend, no account); data lives on the phone.

## Files
| File | What |
|---|---|
| `index.html`, `app.css`, `app.js` | The app UI |
| `core.js` | Data logic: migration, oil sticker, search, mileage, build sheet, import/export. No DOM. |
| `sw.js` | Service worker: offline cache + "New version available" update flow |
| `tests/run-tests.js` | Migration and behaviour tests (Node, no dependencies) |

## Releasing
1. Bump `VERSION` in `sw.js` **and** `APP_VERSION` in `app.js` (same number).
2. Run the tests: `node tests/run-tests.js` (add `path/to/pitlog-backup.json` to also test a real export).
3. Upload all files to the GitHub repo. Phones show "New version available — Reload" the next time they open the app.

## Storage
- v0.2+ stores data in `localStorage["pitlog.v2"]` (schemaVersion 2).
- On first launch it migrates v0.1 data from `localStorage["pitlog.data"]` and **never writes that key again**, so it stays as a rollback copy.
- Backups are always called `pitlog-backup.json` and include `exportedAt`. Importing runs the same `migrate()` and refuses files from a newer version.

## Hidden dev panel
Setup → tap the version line 5 times. Free/Pro toggle, per-feature Pro gates (all off by default), test date, sample data.
