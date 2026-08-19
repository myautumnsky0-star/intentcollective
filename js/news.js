/* ==========================================================================
   Intent Collective — News
   A) Reads shared links from a Google Sheet published to the web as CSV
      and renders them as cards; clicking one opens an internal detail
      view with the full preview text and a button out to the link.
   B) Lets a fellow share a new link from the page itself, gated by a
      password, the same pattern as Discourse. Posting goes through a
      Google Apps Script Web App (the CSV is read-only). See README.md.

   SETUP — reading
   Header row, any order (case-insensitive):
     Name    - who shared it
     Title   - the shared page/article's headline
     Link    - the URL being shared (required)
     Date    - set automatically by the Apps Script when posting via the site
     Preview - a couple of sentences describing it

   SETUP — posting
   See README.md, "Enable posting from the site", to create the Apps
   Script Web App for this sheet and paste its URL into POST_ENDPOINT_URL.
   ========================================================================== */

const SHEET_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vS8WbPtCB-oy-jEzMEaYbYaRblTYz_J14t6Vy7PzsxeooXoxJtCba41YTzAC_nmQzjyfNYgjB_YfrT0/pub?output=csv";

// Web app URL from the Apps Script that appends new links to the sheet.
const POST_ENDPOINT_URL = "https://script.google.com/macros/s/AKfycbxYXhpRXvG3UvLTmQEec9FSxD2rXjoJcpX5BVL4R7dwtEj2F5CV7chSBLrRt3tq4csv/exec";

// Soft client-side check only — see the note on this in js/discourse.js.
// The Apps Script checks the password server-side; that's the real gate.
const POST_PASSWORD = "intentcollectivedesign";

const stateEl = document.getElementById("state");
const gridEl = document.getElementById("entry-grid");
const countEl = document.getElementById("entry-count");
const toolbarEl = document.getElementById("discourse-toolbar");
const composerRegionEl = document.getElementById("composer-region");
const detailEl = document.getElementById("post-detail");

let currentEntries = [];

/* ---------------- CSV parsing ---------------- */

function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') { field += '"'; i++; }
      else if (char === '"') { inQuotes = false; }
      else { field += char; }
    } else {
      if (char === '"') { inQuotes = true; }
      else if (char === ",") { row.push(field); field = ""; }
      else if (char === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else if (char === "\r") { /* skip */ }
      else { field += char; }
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(cell => cell.trim() !== ""));
}

function rowsToEntries(rows) {
  if (!rows.length) return [];
  const header = rows[0].map(h => h.trim().toLowerCase());
  const idx = (name) => header.indexOf(name);

  const iName = idx("name");
  const iTitle = idx("title");
  const iLink = idx("link");
  const iDate = idx("date");
  const iPreview = idx("preview");

  return rows.slice(1).map((r, i) => {
    const title = iTitle > -1 ? (r[iTitle] || "").trim() : "Untitled";
    const date = iDate > -1 ? (r[iDate] || "").trim() : "";
    return {
      name: iName > -1 ? (r[iName] || "").trim() : "",
      title,
      link: iLink > -1 ? (r[iLink] || "").trim() : "",
      date,
      preview: iPreview > -1 ? (r[iPreview] || "").trim() : "",
      slug: slugify(title) + "-" + (date ? date.replace(/[^0-9]/g, "") : i),
    };
  }).filter(e => e.link);
}

/* ---------------- helpers ---------------- */

function slugify(str) {
  return (str || "link").toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-+|-+$)/g, "") || "link";
}

function excerpt(text, len) {
  if (text.length <= len) return text;
  return text.slice(0, len).replace(/\s+\S*$/, "") + "…";
}

function formatDate(d) {
  const parsed = new Date(d);
  if (isNaN(parsed)) return d;
  return parsed.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function escapeHTML(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function hostFromURL(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); }
  catch { return ""; }
}

/* ---------------- list view ---------------- */

function setState(message, isError) {
  stateEl.hidden = false;
  gridEl.hidden = true;
  stateEl.textContent = message;
  stateEl.classList.toggle("is-error", Boolean(isError));
}

function renderEntries(entries) {
  currentEntries = entries.slice();

  currentEntries.sort((a, b) => {
    const da = new Date(a.date), db = new Date(b.date);
    if (isNaN(da) || isNaN(db)) return 0;
    return db - da;
  });

  if (!currentEntries.length) {
    setState("No links shared yet — the first one added will show up here.");
    countEl.textContent = "";
    return;
  }

  gridEl.innerHTML = "";
  currentEntries.forEach(e => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "entry-card";
    card.innerHTML = `
      <div class="entry-meta">
        <span>${escapeHTML(hostFromURL(e.link) || "Link")}</span>
        <span>${e.date ? formatDate(e.date) : ""}</span>
      </div>
      <h3>${escapeHTML(e.title)}</h3>
      <p class="excerpt">${escapeHTML(excerpt(e.preview, 220))}</p>
      <div class="byline">${e.name ? "Shared by " + escapeHTML(e.name) : ""}</div>
    `;
    card.addEventListener("click", () => { location.hash = "link-" + e.slug; });
    gridEl.appendChild(card);
  });

  stateEl.hidden = true;
  gridEl.hidden = false;
  countEl.textContent = `${currentEntries.length} ${currentEntries.length === 1 ? "link" : "links"}`;
}

/* ---------------- detail view + hash routing ---------------- */

function showList() {
  detailEl.hidden = true;
  toolbarEl.hidden = false;
  composerRegionEl.hidden = false;
  gridEl.hidden = currentEntries.length === 0;
  stateEl.hidden = currentEntries.length !== 0;
}

function showDetail(entry) {
  toolbarEl.hidden = true;
  composerRegionEl.hidden = true;
  gridEl.hidden = true;
  stateEl.hidden = true;

  detailEl.hidden = false;
  detailEl.innerHTML = `
    <a href="#" class="back-link" id="back-link">← All links</a>
    <div class="mark-label">${escapeHTML(hostFromURL(entry.link) || "Link")}</div>
    <h1>${escapeHTML(entry.title)}</h1>
    <div class="post-meta">${entry.name ? "Shared by " + escapeHTML(entry.name) : "Shared"}${entry.date ? " · " + formatDate(entry.date) : ""}</div>
    <div class="post-body"><p>${escapeHTML(entry.preview)}</p></div>
    <a class="btn-primary" href="${escapeHTML(entry.link)}" target="_blank" rel="noopener">Visit link →</a>
  `;
  document.getElementById("back-link").addEventListener("click", (ev) => {
    ev.preventDefault();
    history.pushState("", document.title, window.location.pathname + window.location.search);
    showList();
  });
  window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
}

function handleHash() {
  const hash = decodeURIComponent(location.hash || "");
  if (hash.startsWith("#link-")) {
    const slug = hash.slice(6);
    const entry = currentEntries.find(e => e.slug === slug);
    if (entry) { showDetail(entry); return; }
  }
  showList();
}

window.addEventListener("hashchange", handleHash);

/* ---------------- loading the feed ---------------- */

async function loadEntries() {
  if (!SHEET_CSV_URL || SHEET_CSV_URL.includes("PASTE_YOUR")) {
    setState(
      "News isn't connected yet — paste your published Google Sheet CSV URL into js/news.js.",
      true
    );
    return;
  }

  try {
    const res = await fetch(SHEET_CSV_URL, { cache: "no-store" });
    if (!res.ok) throw new Error(`Sheet responded with ${res.status}`);
    const text = await res.text();
    const rows = parseCSV(text);
    const entries = rowsToEntries(rows);
    renderEntries(entries);
    handleHash();
  } catch (err) {
    setState(
      "Couldn't load links from the sheet. Check that it's published to the web as CSV and that the URL in js/news.js is correct.",
      true
    );
    console.error(err);
  }
}

/* ---------------- compose form (part B) ---------------- */

try {
  const composeToggle = document.getElementById("compose-toggle");
  const composer = document.getElementById("composer");
  const composerStatus = document.getElementById("composer-status");
  const publishBtn = document.getElementById("publish-btn");

  if (!POST_ENDPOINT_URL || POST_ENDPOINT_URL.includes("PASTE_YOUR")) {
    composeToggle.hidden = true;
  } else {
    composeToggle.addEventListener("click", () => {
      composer.classList.toggle("hidden");
      composeToggle.textContent = composer.classList.contains("hidden") ? "+ Share a link" : "− Close";
    });
  }

  function setComposerStatus(message, kind) {
    composerStatus.textContent = message || "";
    composerStatus.classList.toggle("is-error", kind === "error");
    composerStatus.classList.toggle("is-ok", kind === "ok");
  }

  if (publishBtn) {
    publishBtn.addEventListener("click", async () => {
      const nameInput = document.getElementById("compose-name");
      const titleInput = document.getElementById("compose-title");
      const linkInput = document.getElementById("compose-link");
      const previewInput = document.getElementById("compose-preview");
      const passwordInput = document.getElementById("compose-password");

      const name = nameInput.value.trim();
      const title = titleInput.value.trim();
      const link = linkInput.value.trim();
      const preview = previewInput.value.trim();
      const password = passwordInput.value;

      if (!name || !title || !link || !preview) {
        setComposerStatus("Name, title, link, and preview are all required.", "error");
        return;
      }
      if (!/^https?:\/\//i.test(link)) {
        setComposerStatus("Link must start with http:// or https://", "error");
        return;
      }
      if (password !== POST_PASSWORD) {
        setComposerStatus("Incorrect password.", "error");
        return;
      }

      publishBtn.disabled = true;
      setComposerStatus("Publishing…", null);

      try {
        const res = await fetch(POST_ENDPOINT_URL, {
          method: "POST",
          headers: { "Content-Type": "text/plain;charset=utf-8" }, // avoids CORS preflight
          body: JSON.stringify({ name, title, link, preview, password }),
        });
        const data = await res.json();

        if (data.status !== "ok") {
          setComposerStatus(data.message || "Something went wrong. Try again.", "error");
          publishBtn.disabled = false;
          return;
        }

        // Optimistic UI: show it immediately, ahead of the sheet's CSV cache
        // refresh (which can lag a few minutes behind the actual edit).
        const newEntry = {
          name, title, link, preview,
          date: new Date().toISOString(),
          slug: slugify(title) + "-" + Date.now(),
        };
        renderEntries([newEntry, ...currentEntries]);

        nameInput.value = "";
        titleInput.value = "";
        linkInput.value = "";
        previewInput.value = "";
        passwordInput.value = "";
        composer.classList.add("hidden");
        composeToggle.textContent = "+ Share a link";
        setComposerStatus("Published. (It may take a few minutes to also show up after the sheet's own refresh.)", "ok");
      } catch (err) {
        setComposerStatus("Couldn't reach the posting service. Check POST_ENDPOINT_URL in js/news.js.", "error");
        console.error(err);
      }
      publishBtn.disabled = false;
    });
  }
} catch (err) {
  console.error("News composer failed to initialize:", err);
}

loadEntries();
