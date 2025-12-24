// lib/sheets.js
import { google } from "googleapis";

function getSheetsClient() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_JSON");

  let creds;
  try {
    creds = JSON.parse(raw);
  } catch (e) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON");
  }

  if (!creds?.client_email) throw new Error("Service account JSON missing client_email");
  if (!creds?.private_key) throw new Error("Service account JSON missing private_key");

  const auth = new google.auth.JWT(
    creds.client_email,
    null,
    creds.private_key,
    ["https://www.googleapis.com/auth/spreadsheets"]
  );

  return google.sheets({ version: "v4", auth });
}

function parseRowFromUpdatedRange(updatedRange) {
  // Ex: "Regler_v1!A12:K12"
  const m = updatedRange?.match(/![A-Z]+(\d+):/);
  if (!m) throw new Error(`Could not parse updatedRange: ${updatedRange}`);
  return Number(m[1]);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Writes A–K to the input tab, then polls EXPORT tab (A:B) until "decision" exists.
 * Returns an object built from key/value rows in EXPORT, plus rowIndex.
 */
export async function writeInputReadResult({
  jobbtyp,
  timpris,
  timmar,
  materialkostnad,
  ue_kostnad,
  rot,
  onskad_marginal,
  riskniva,
  omsattning,
  internkostnad,
  totalkostnad,
}) {
  const spreadsheetId = process.env.SHEET_ID;
  const tab = process.env.SHEET_TAB;

  // new: export tab + range
  const exportTab = process.env.SHEET_EXPORT_TAB || "EXPORT";
  const exportRange = process.env.SHEET_EXPORT_RANGE || `${exportTab}!A1:B50`;

  if (!spreadsheetId) throw new Error("Missing SHEET_ID");
  if (!tab) throw new Error("Missing SHEET_TAB");

  const sheets = getSheetsClient();

  // Keep same input row shape (A–K) to avoid breaking the sheet.
  const inputRow = [
    jobbtyp ?? "",
    Number(timpris),
    Number(timmar),
    Number(materialkostnad),
    Number(ue_kostnad ?? 0),
    rot ?? "",              // "JA"/"NEJ"
    onskad_marginal ?? "",  // optional
    riskniva ?? "",         // legacy: "LÅG"/"MED"/"HÖG" (can be empty)
    omsattning ?? "",
    internkostnad ?? "",
    totalkostnad ?? "",
  ];

  // 1) Append inputs
  const appendResp = await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${tab}!A:K`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [inputRow] },
  });

  const updatedRange = appendResp?.data?.updates?.updatedRange;
  const rowIndex = parseRowFromUpdatedRange(updatedRange);

  // 2) Poll EXPORT until ready
  const maxWaitMs = 3500;
  const intervalMs = 150;
  const deadline = Date.now() + maxWaitMs;

  let lastValues = null;

  while (Date.now() < deadline) {
    const readResp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: exportRange,
      valueRenderOption: "UNFORMATTED_VALUE",
    });

    const rows = readResp?.data?.values ?? [];
    lastValues = rows;

    const out = {};
    for (const r of rows) {
      const k = r?.[0];
      const v = r?.[1];
      if (k !== undefined && k !== null && String(k).trim().length > 0) {
        out[String(k).trim()] = v;
      }
    }

    // Ready signal: decision must exist
    const ready =
      typeof out.decision === "string" && out.decision.trim().length > 0;

    if (ready) {
      return { ...out, rowIndex };
    }

    await sleep(intervalMs);
  }

  throw new Error(
    `Sheet calculation timeout. Row ${rowIndex}. Last EXPORT values: ${JSON.stringify(lastValues)}`
  );
}
