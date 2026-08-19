/* ==========================================================================
   Intent Collective — Discourse
   A) Reads posts from a Google Sheet published to the web as CSV and
      renders them as cards; clicking a card opens the full post.
   B) Lets a fellow publish a new post from the page itself. Posting goes
      through a Google Apps Script Web App (not the CSV, which is read-only)
      so a new row can actually be appended to the sheet. See README.md.

   SETUP — reading
   Sheet's first row must be a header row with these columns
   (case-insensitive, any order):
     Name    - fellow's name
     Title   - post title
     Date    - set automatically by the Apps Script when posting via the site
     Content - the post body (may contain basic HTML from the editor)
     Link    - optional URL to an external version of the piece
     Tag     - optional short tag/category

   SETUP — posting
   See README.md, "Enable posting from the site", to create the Apps Script
   Web App and paste its URL into POST_ENDPOINT_URL below.
   ========================================================================== */

const SHEET_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQBQ1XXs9ML_5Bmydn824YJlm7xg-_ueJDw7YxhB4RuVVEfRi495R2E5zOLZ16QCoZQ5n8JXN-Gxo54/pub?output=csv";

// Web app URL from the Apps Script that appends new posts to the sheet.
const POST_ENDPOINT_URL = "PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE";

// Soft client-side check only — gives instant feedback in the UI. It is
// NOT real security: this file is visible to anyone who views page source,
// so the string is trivially readable. The Apps Script also checks the
// password server-side before it will append a row — that's the real gate.
const POST_PASSWORD = "intentcollectivedesign";

const stateEl = document.getElementById("state");
const gridEl = document.getElementById("entry-grid");
const countEl = document.getElementById("entry-count");
const toolbarEl = document.getElementById("discourse-toolbar");
const composerRegionEl = document.getElementById("composer-region");
const detailEl = document.getElementById("post-detail");

let currentEntries = [];

/* ---------------- CSV parsing + fetch ---------------- */

// Minimal RFC4180-ish CSV parser: handles quoted fields, embedded commas,
// escaped quotes (""), and embedded newlines inside quoted fields.
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
  const iDate = idx("date");
  const iContent = idx("content");
  const iLink = idx("link");
  const iTag = idx("tag");

  return rows.slice(1).map((r, i) => {
    const title = iTitle > -1 ? (r[iTitle] || "").trim() : "Untitled";
    const date = iDate > -1 ? (r[iDate] || "").trim() : "";
    return {
      name: iName > -1 ? (r[iName] || "").trim() : "",
      title,
      date,
      content: iContent > -1 ? (r[iContent] || "").trim() : "",
      link: iLink > -1 ? (r[iLink] || "").trim() : "",
      tag: iTag > -1 ? (r[iTag] || "").trim() : "",
      slug: slugify(title) + "-" + (date ? date.replace(/[^0-9]/g, "") : i),
    };
  }).filter(e => e.title || e.content);
}

/* ---------------- helpers ---------------- */

function slugify(str) {
  return (str || "post").toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-+|-+$)/g, "") || "post";
}

function stripTags(html) {
  const div = document.createElement("div");
  div.innerHTML = html;
  return div.textContent || "";
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

// Allow-list HTML sanitizer for post content coming out of the sheet.
// Anything not in this list is unwrapped (its text/children kept, tag
// dropped) rather than shown raw — protects the detail view from a
// mistaken or malicious sheet cell.
const ALLOWED_TAGS = {
  P: [], DIV: [], BR: [], B: [], STRONG: [], I: [], EM: [], U: [],
  UL: [], OL: [], LI: [], BLOCKQUOTE: [], H2: [], H3: [], H4: [],
  A: ["href", "target", "rel"],
};

function sanitizeHTML(html) {
  const doc = new DOMParser().parseFromString(html || "", "text/html");
  cleanNode(doc.body);
  return doc.body.innerHTML;
}

function cleanNode(node) {
  Array.from(node.childNodes).forEach(child => {
    if (child.nodeType === Node.ELEMENT_NODE) {
      cleanNode(child);
      const tag = child.tagName;
      if (ALLOWED_TAGS[tag]) {
        Array.from(child.attributes).forEach(attr => {
          if (!ALLOWED_TAGS[tag].includes(attr.name)) child.removeAttribute(attr.name);
        });
        if (tag === "A") {
          const href = child.getAttribute("href") || "";
          if (!/^https?:\/\//i.test(href)) child.removeAttribute("href");
          else { child.setAttribute("target", "_blank"); child.setAttribute("rel", "noopener"); }
        }
      } else {
        while (child.firstChild) node.insertBefore(child.firstChild, child);
        node.removeChild(child);
      }
    } else if (child.nodeType !== Node.TEXT_NODE) {
      node.removeChild(child);
    }
  });
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
    setState("No entries yet — the first post added will show up here.");
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
        <span>${e.tag ? escapeHTML(e.tag) : "Discourse"}</span>
        <span>${e.date ? formatDate(e.date) : ""}</span>
      </div>
      <h3>${escapeHTML(e.title)}</h3>
      <p class="excerpt">${escapeHTML(excerpt(stripTags(e.content), 220))}</p>
      <div class="byline">${e.name ? "— " + escapeHTML(e.name) : ""}</div>
    `;
    card.addEventListener("click", () => { location.hash = "post-" + e.slug; });
    gridEl.appendChild(card);
  });

  stateEl.hidden = true;
  gridEl.hidden = false;
  countEl.textContent = `${currentEntries.length} ${currentEntries.length === 1 ? "entry" : "entries"}`;
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
    <a href="#" class="back-link" id="back-link">← All posts</a>
    <div class="mark-label">${entry.tag ? escapeHTML(entry.tag) : "Discourse"}</div>
    <h1>${escapeHTML(entry.title)}</h1>
    <div class="post-meta">${entry.name ? escapeHTML(entry.name) : "Anonymous"}${entry.date ? " · " + formatDate(entry.date) : ""}</div>
    <div class="post-body">${sanitizeHTML(entry.content)}</div>
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
  if (hash.startsWith("#post-")) {
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
      "Discourse isn't connected yet — paste your published Google Sheet CSV URL into js/discourse.js.",
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
      "Couldn't load entries from the sheet. Check that it's published to the web as CSV and that the URL in js/discourse.js is correct.",
      true
    );
    console.error(err);
  }
}

/* ---------------- compose form (part B) ---------------- */

try {
  const composeToggle = document.getElementById("compose-toggle");
  const composer = document.getElementById("composer");
  const rteBody = document.getElementById("rte-body");
  const composerStatus = document.getElementById("composer-status");
  const publishBtn = document.getElementById("publish-btn");

  if (!POST_ENDPOINT_URL || POST_ENDPOINT_URL.includes("PASTE_YOUR")) {
    composeToggle.hidden = true;
  } else {
    composeToggle.addEventListener("click", () => {
      composer.classList.toggle("hidden");
      composeToggle.textContent = composer.classList.contains("hidden") ? "+ Share a post" : "− Close";
    });
  }

  // Rich text toolbar — basic Google-Docs-style formatting via execCommand.
  document.querySelectorAll(".rte-toolbar [data-cmd]").forEach(btn => {
    btn.addEventListener("click", () => {
      rteBody.focus();
      const cmd = btn.getAttribute("data-cmd");
      if (cmd === "createLink") {
        const url = prompt("Link URL (including https://)");
        if (url) document.execCommand("createLink", false, url);
      } else {
        document.execCommand(cmd, false, null);
      }
    });
  });

  const blockSelect = document.getElementById("rte-block");
  if (blockSelect) {
    blockSelect.addEventListener("change", () => {
      rteBody.focus();
      document.execCommand("formatBlock", false, blockSelect.value);
      blockSelect.selectedIndex = 0;
    });
  }

  rteBody.addEventListener("focus", () => {
    document.execCommand("defaultParagraphSeparator", false, "p");
  });

  function setComposerStatus(message, kind) {
    composerStatus.textContent = message || "";
    composerStatus.classList.toggle("is-error", kind === "error");
    composerStatus.classList.toggle("is-ok", kind === "ok");
  }

  if (publishBtn) {
    publishBtn.addEventListener("click", async () => {
      const nameInput = document.getElementById("compose-name");
      const titleInput = document.getElementById("compose-title");
      const passwordInput = document.getElementById("compose-password");

      const name = nameInput.value.trim();
      const title = titleInput.value.trim();
      const content = rteBody.innerHTML.trim();
      const password = passwordInput.value;

      if (!name || !title || stripTags(content).trim().length === 0) {
        setComposerStatus("Name, title, and content are all required.", "error");
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
          body: JSON.stringify({ name, title, content, password }),
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
          name, title, content,
          date: new Date().toISOString(),
          link: "", tag: "",
          slug: slugify(title) + "-" + Date.now(),
        };
        renderEntries([newEntry, ...currentEntries]);

        nameInput.value = "";
        titleInput.value = "";
        passwordInput.value = "";
        rteBody.innerHTML = "";
        composer.classList.add("hidden");
        composeToggle.textContent = "+ Share a post";
        setComposerStatus("Published. (It may take a few minutes to also show up after the sheet's own refresh.)", "ok");
      } catch (err) {
        setComposerStatus("Couldn't reach the posting service. Check POST_ENDPOINT_URL in js/discourse.js.", "error");
        console.error(err);
      }
      publishBtn.disabled = false;
    });
  }
} catch (err) {
  // A missing element or unexpected DOM state here should never blank the
  // whole page — the read-only feed above still works either way.
  console.error("Discourse composer failed to initialize:", err);
}

loadEntries();
