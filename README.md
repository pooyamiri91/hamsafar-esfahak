# HamSafar Esfahak

Mobile-first Persian trip companion for the Esfahak group trip.

## Run locally

Requires Python 3.10 or newer. No third-party Python packages are required.

```sh
python server.py --port 8766
```

Open http://127.0.0.1:8766. On Windows, you can also run `START.bat`.

The first run creates the `private/` folder with the SQLite database and individual login codes in `private/access-codes.txt`. Only give each participant their own code. The seeded **Farhad Leader** account is the administrator; assistants can edit their own profiles.

## Features

- Initial roster of 27 participants and per-member access codes.
- Shared profiles with optional phone-number visibility and readiness status.
- Administrator profile editing, room assignments, member activation, announcements and edit history.
- Category-based fuel estimates with editable consumption, distance and tank capacity.
- Next scheduled rendezvous using Tehran time, itinerary, room notes, emergency links and a personal packing list.
- Server-side authorization, version checks for concurrent edits, and SQLite persistence.

`index.html` bundles the styles and scripts so the itinerary and fuel calculator also work as a standalone file. Shared features require the running Python server. `mobile.js` and `mobile.css` are the editable source copies of the additions embedded in the HTML; keep the embedded versions synchronized when editing.

## Data and hosting

The repository includes the initial trip content and seed roster. Runtime profiles, login codes and the database are excluded from version control. Do not upload `private/`.

This is a local MVP. GitHub stores its source; GitHub Pages cannot run the Python backend. For remote group use, deploy the backend behind HTTPS with persistent private storage and set `HAMSAFAR_SECURE=1`. The standard-library HTTP server is intended for local evaluation, not direct public exposure.

See `README.fa.txt` for Persian setup and operational notes.

## Verification

```sh
python tests/test_shared.py
node --check mobile.js
```

The shared-data checks use a temporary database and cover authorization, phone privacy, persistence, announcements, session revocation and concurrent edits.
