# intent collective — website

Four pages, no build step:

- `index.html` — logo mark + manifesto
- `structure.html` — fellowships + pillars
- `discourse.html` — fellow writing: browse, read full posts, and publish new ones
- `news.html` — shared links, pulled live from a Google Sheet

Typeface: DM Sans only. Logo mark and wordmark are already placed
(`assets/logo.png`, `assets/wordmark.png`).

## Discourse — reading

Already connected to your sheet. The CSV URL is set in `js/discourse.js`
(`SHEET_CSV_URL`). Header row, any order: `Name, Title, Date, Content, Link, Tag`
(`Link`/`Tag` optional). Clicking any entry opens it as a full post at
`discourse.html#post-<slug>`.

## Discourse — enable posting from the site

Posting a new entry needs to *write* to the sheet, which a published CSV
can't do (it's read-only). This uses a small Google Apps Script, bound to
the same Sheet, as a private write endpoint.

1. Open the Google Sheet that Discourse reads from.
2. **Extensions → Apps Script.**
3. Delete the placeholder code and paste in the contents of
   `google-apps-script.gs` (included in this project).
4. If your Discourse tab isn't named "Discourse", edit the `SHEET_NAME`
   line near the top to match — otherwise it'll just use the first tab.
5. Save the project (any name is fine).
6. **Deploy → New deployment → type: Web app.**
   - Execute as: **Me**
   - Who has access: **Anyone**
7. Click **Deploy**, authorize the permissions it asks for (this is your
   own script running on your own sheet).
8. Copy the Web app URL — it ends in `/exec`.
9. Paste it into `js/discourse.js`:
   ```js
   const POST_ENDPOINT_URL = "PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE";
   ```
10. If you ever edit the script again, you must **Manage deployments → Edit
    → New version** for the change to actually take effect on the live URL.

Once that's set, the "+ Share a post" toggle on the Discourse page becomes
visible and posting works end to end.

### About the password

The publish button asks for a password (`intentcollectivedesign`). Two
honest notes on how much protection that actually gives you:

- **The real check is server-side**, inside the Apps Script — a post is
  only appended if the password sent matches. This can't be bypassed from
  the browser.
- **The password itself is not a secret from a determined visitor.** It's
  sent in the request body and lives in `js/discourse.js`, both of which
  are visible to anyone who opens dev tools. Treat it as a light gate
  against casual/accidental posting from randoms who find the page, not as
  real authentication. For real per-person accounts you'd need an actual
  login system — worth doing later if this becomes a concern.
- The "+ Share a post" toggle is intentionally understated rather than a
  prominent button, which adds a small layer of obscurity on top of the
  password. If you'd rather it not appear as a link at all (visible only
  to someone who knows to go to a specific URL), that's also easy to set
  up — just ask.

New posts appear on the page immediately after publishing (optimistic UI),
and also permanently in the sheet — the published CSV itself can lag a few
minutes behind edits, which is normal for Google's "publish to web" cache.

## News — link sharing

Same pattern as Discourse: browse cards, click one to read the full preview
inline (at `news.html#link-<slug>`) with a "Visit link →" button out to the
original, and a "+ Share a link" toggle to add new ones from the page.

Already connected to your sheet — the CSV URL is set in `js/news.js`
(`SHEET_CSV_URL`). Header row, any order: `Name, Title, Link, Date, Preview`.

### News — enable posting from the site

Same idea as Discourse's posting setup, but bound to the News spreadsheet
(they're separate sheets, so this needs its own script and its own
deployment — you can't reuse the Discourse one).

1. Open the Google Sheet that News reads from.
2. **Extensions → Apps Script.**
3. Paste in the contents of `google-apps-script-news.gs` (included here).
4. If your News tab isn't named "News", edit the `SHEET_NAME` line near the
   top to match.
5. **Deploy → New deployment → type: Web app.** Execute as **Me**, access
   **Anyone**. Deploy, authorize, and copy the `/exec` URL.
6. Paste it into `js/news.js`:
   ```js
   const POST_ENDPOINT_URL = "PASTE_YOUR_NEWS_APPS_SCRIPT_WEB_APP_URL_HERE";
   ```

Same password (`intentcollectivedesign`) and the same caveats as Discourse
apply here — see "About the password" above.

**Note:** "Publish to web" makes a sheet readable at its CSV URL to anyone
with the link. Don't put anything in it you don't want public.

## Deploy

**GitHub Pages** — push the folder to a repo, then Settings → Pages →
source = default branch, root folder.

**GoDaddy (or any static host)** — upload the folder's contents into your
hosting root (`public_html/`), keeping `index.html` at the top level.
