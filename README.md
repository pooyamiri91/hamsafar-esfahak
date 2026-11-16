# HamSafar Esfahak — simplified name entry

Mobile Persian trip companion. The Netlify site shows all 27 names immediately, with an edit button on each profile. Visitors can update public travel details without selecting an identity or signing in. Shared edits persist in Netlify Database. Anyone with the link can edit public profiles; the UI asks visitors to edit their own details.

Administrator login remains separate for announcements, room assignments, member activation and private phone fields. Public edits preserve those restricted fields. Anonymous edits appear as public edits in the administrator history.

## Local run

Python 3.10 or newer, no third-party dependencies for local SQLite mode:

```sh
python server.py --port 8766
```

Open http://127.0.0.1:8766. The first local run creates `private/access-codes.txt` with the administrator password. Existing local databases and profiles are preserved. Older per-member codes no longer provide entry; members use name selection.

## Netlify deployment

The Netlify site serves the existing frontend from `public` and the shared-data API from `netlify/server/index.ts`. `netlify.toml` selects Node.js 24 and publishes only the frontend assets copied by `build_static.py`; Python source and private runtime files are excluded from the published directory.

Members view and edit profiles directly without login. The API seeds the 27 names without overwriting existing profiles. Members, profile versions, sessions, announcements, audit entries and login attempt limits persist in Netlify Database through the Drizzle adapter. `db/schema.ts` defines the schema and generated migrations in `netlify/database/migrations` are applied by Netlify during deployment. No external database connection string is needed for this deployment.

`HAMSAFAR_ADMIN_CODE` is optional for member entry. Configure a private value of at least 16 characters in Netlify to enable the existing administrator password flow. Missing administrator configuration returns a JSON error only for administrator login; it does not prevent name selection or profile updates. Rotating this value invalidates administrator sessions. Selecting the leader's name alone never grants administrator access.

After deployment, `/api/roster` should return JSON with the active names and `/api/state` should return JSON with all active profiles without a session. Verify direct profile editing, profile saving after reload, logout, and administrator permissions on the deployed site. Existing Python SQLite or external Postgres records are not automatically imported into the fresh Netlify database.

## Legacy Vercel deployment

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
npm test
npm run typecheck
node --check mobile.js
```

The API integration tests execute the generated PostgreSQL migrations in an isolated PGlite database and verify name entry, persistence across handler restarts, session revocation, administrator isolation, private phone fields, version conflicts, CSRF checks, input validation and shared login attempt limits. Hosted routing and Netlify Database connectivity require verification after deployment.
