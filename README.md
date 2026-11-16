# HamSafar Esfahak — simplified name entry

Mobile Persian trip companion. Members select their existing Telegram name; only the administrator needs a password.

Name entry is a convenience workflow, not identity verification. Anyone with the link can select another member's name and edit that profile's public fields. Selecting the leader's name **does not** grant administrator permission. Do not collect sensitive information with this workflow. Private phone numbers are visible and editable only to the password-verified administrator.

## Local run

Python 3.10 or newer, no third-party dependencies for local SQLite mode:

```sh
python server.py --port 8766
```

Open http://127.0.0.1:8766. The first local run creates `private/access-codes.txt` with the administrator password. Existing local databases and profiles are preserved. Older per-member codes no longer provide entry; members use name selection.

## Vercel deployment

1. Upload all source files and folders, including `api`, to the repository root. Replace older files.
2. Connect a Postgres database to the **Production** environment through Vercel Storage / Marketplace. Neon is one compatible provider.
3. Under Settings > Environment Variables, ensure `DATABASE_URL` (or `POSTGRES_URL`) contains the database connection URL. Add a private `HAMSAFAR_ADMIN_CODE` of at least 16 characters; use a long random value. The code is not stored in this repository.
4. Framework Preset: Other. Clear old Build Command and Output Directory overrides so `vercel.json` applies (`python build_static.py`, output `public`).
5. Redeploy. Open `/api/state`: JSON with a sign-in-required error is expected before login. A Vercel 404 means the API files or routing were not deployed; JSON status 503 means database or administrator setup is incomplete or unreachable.
6. Members choose a name. For administration, open “ورود مدیر سفر” on the sign-in screen and enter `HAMSAFAR_ADMIN_CODE`. If signed in as a member, first sign out.

Cloud tables and the 27 initial names are created automatically, once a configured database is reachable. Data persists in Postgres across deployments. The cloud API never falls back to SQLite or `/tmp`. Keep production and preview databases separate: the administrator password is applied to the configured database on cold-start initialization.

Changing `HAMSAFAR_ADMIN_CODE` and redeploying rotates the password and revokes older administrator sessions when initialization runs. Regular name-entry sessions remain separate.

The old local administrator code does not automatically become the cloud password. Existing local profile records are not uploaded or migrated by this package.

## Static output and secrets

`build_static.py` copies only HTML, CSS and JS into the public output. Database credentials, server code and local runtime files are not part of that output. Never upload `private/`, real `.env` files or access codes to GitHub. `.env.example` contains placeholders only.

`index.html` includes embedded copies of `mobile.js` and `mobile.css` so local standalone read-only features remain available. Keep those embedded versions synchronized when changing frontend source.

## Validation

```sh
python tests/test_name_login.py
python tests/test_cloud_setup.py
python build_static.py
node --check mobile.js
```

The automated checks verify shared-data behavior, name-based entry, administrator isolation, private contact handling, concurrent edits, logout and a safe cloud configuration failure. A real hosted Postgres connection and Vercel deployment must still be verified after configuring the external service.
