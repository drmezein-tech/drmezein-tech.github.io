# The Ward

Offline surgical ward record for iPhone and Android (installable web app, SQLite via sql.js).
All patient data stays in the phone's local storage; the hosted site only serves the app code.

## Put it online (GitHub Pages, free)
1. Create a GitHub account and a new **public** repository, e.g. `the-ward`.
2. Upload every file in this folder (keep the `vendor/` and `icons/` folders) via **Add file → Upload files**.
3. Repository **Settings → Pages → Branch: main / (root) → Save**.
4. After about a minute the app is at `https://<your-username>.github.io/the-ward/`.

## Install on the phones
- **iPhone (Safari):** open the link → Share → **Add to Home Screen**.
- **Android (Chrome):** open the link → ⋮ menu → **Install app** / **Add to Home screen**.
Open it once while online; after that it works offline.

## Backups
- The app asks for a backup the first time it is opened each day (Files / WhatsApp / email).
- Deleting the home-screen app or clearing Safari/Chrome website data **erases the data**, so keep backups.
- Moving data between phones: Settings → Save backup → send the file → on the other phone Settings → Import backup
  (import **replaces** everything on that phone).
- Backup files are not encrypted.

## Updating the app
After changing any file, bump `VERSION` in `sw.js` (e.g. `ward-v2`) and upload again;
phones pick up the new version on the next launch or two. Data is not affected.

## Run locally
    python -m http.server 8765
then open http://localhost:8765
