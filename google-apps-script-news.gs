/**
 * Intent Collective — News post handler.
 *
 * Paste this into the Apps Script editor bound to the Google Sheet that
 * News reads from (Extensions → Apps Script in that Sheet), then deploy
 * it as a Web App. See README.md, "News — enable posting from the site".
 *
 * This is the News-sheet counterpart to google-apps-script.gs (Discourse).
 * They're separate because News and Discourse are separate spreadsheets —
 * each needs its own script bound to its own sheet.
 */

var PASSWORD = "intentcollectivedesign";

// If your News tab has a different name, change this to match.
// If it's not found, the script falls back to the sheet's first tab.
var SHEET_NAME = "News";

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);

    if (data.password !== PASSWORD) {
      return respond({ status: "error", message: "Incorrect password." });
    }
    if (!data.name || !data.title || !data.link || !data.preview) {
      return respond({ status: "error", message: "Missing required fields." });
    }

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(SHEET_NAME) || ss.getSheets()[0];

    var lastCol = Math.max(sheet.getLastColumn(), 1);
    var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0]
      .map(function (h) { return String(h).trim().toLowerCase(); });

    var row = header.map(function (key) {
      if (key === "name") return data.name;
      if (key === "title") return data.title;
      if (key === "link") return data.link;
      if (key === "preview") return data.preview;
      if (key === "date") return new Date();
      return "";
    });

    sheet.appendRow(row);
    return respond({ status: "ok" });
  } catch (err) {
    return respond({ status: "error", message: err.message });
  }
}

function respond(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
