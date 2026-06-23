# Isabel & Jesse Wedding Website

Static wedding website for GitHub Pages.

## Run Locally

Open `index.html` directly, or serve the folder:

```powershell
python -m http.server 4173
```

Then visit `http://localhost:4173`.

## Guest Code

`RingBearerRabbie`

## Google Sheets RSVP

The RSVP form is ready for a Google Apps Script endpoint. Add the deployed endpoint URL to
`GOOGLE_SHEETS_ENDPOINT` in `script.js`. Until then, RSVP submissions are stored in browser
`localStorage`.

To connect it:

1. Create a Google Sheet with a tab named `RSVPs`.
2. Add headers: `Received At`, `Name`, `Email`, `Plus One`, `Events`, `Dietary`, `Song`, `Submitted At`.
3. Open Extensions -> Apps Script.
4. Paste in `google-apps-script.js`.
5. Deploy as a web app with access set to anyone with the link.
6. Paste the web app URL into `GOOGLE_SHEETS_ENDPOINT` in `script.js`.

## Registry

The South American Fund PayPal flow is currently mocked. Gift purchases disappear locally using
`localStorage`; a shared registry state will need a backend or hosted sheet/database later.

## Rabbie's Rave

Song paths live in `songs.js`. The current config points at the `.m4a` files in `RabbiesRave/`.
You can move or rename the files later as long as each `file` path is updated.

The uploaded Rabbie sprite sheet has been copied to `assets/rabbie-sprite.png`. Sprite crop,
timing windows, confidence changes, scoring, and live note-generation values are all at the top of
`game.js`.
