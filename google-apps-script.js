const SHEET_NAME = "RSVPs";

function doPost(event) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  const body = JSON.parse(event.postData.contents);

  sheet.appendRow([
    new Date(),
    body.name || "",
    body.email || "",
    body.plusOne || "",
    (body.events || []).join(", "),
    body.dietary || "",
    body.song || "",
    body.submittedAt || "",
  ]);

  return ContentService.createTextOutput(JSON.stringify({ ok: true })).setMimeType(
    ContentService.MimeType.JSON,
  );
}
