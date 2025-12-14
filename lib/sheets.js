// lib/sheets.js
import { google } from "googleapis";

function getSheetsClient() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_JSON");

  let creds;
  try {
    creds = JSON.parse(raw);
  } catch {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON");
  }

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
 * Writes A–K, then polls L–Q until computed.
 * Returns: { faktisk_marginal, riskklass, hint_text, diff_timpris }
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

  if (!spreadsheetId) throw new Error("Missing SHEET_ID");
  if (!tab) throw new Error("Missing SHEET_TAB");

  const sheets = getSheetsClient();

  // A–K (11 cols)
  const inputRow = [
    jobbtyp ?? "",
    Number(timpris),
    Number(timmar),
    Number(materialkostnad),
    Number(ue_kostnad),
    rot, // "JA"/"NEJ"
    onskad_marginal ?? "", // kan vara tom om du inte använder den än
    riskniva,              // "LÅG"/"MED"/"HÖG"
    omsattning ?? "",
    internkostnad ?? "",
    totalkostnad ?? "",
  ];

  // 1) Append
  const appendResp = await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${tab}!A:K`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [inputRow] },
  });

  const updatedRange = appendResp?.data?.updates?.updatedRange;
  const rowIndex = parseRowFromUpdatedRange(updatedRange);

  // 2) Poll read A–Q for that row until L–Q is filled
  // A=0...K=10, L=11, M=12, N=13, ... Q=16
  const rangeAQ = `${tab}!A${rowIndex}:Q${rowIndex}`;

  const maxWaitMs = 2500;
  const intervalMs = 150;
  const deadline = Date.now() + maxWaitMs;

  let lastValues = null;

  while (Date.now() < deadline) {
    const readResp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: rangeAQ,
      valueRenderOption: "UNFORMATTED_VALUE",
    });

    const values = readResp?.data?.values?.[0] ?? [];
    lastValues = values;

    const faktisk_marginal = values[11];
    const riskklass = values[12];
    const hint_text = values[13];   // du måste se till att N innehåller “kundtext”
    const diff_timpris = values[16];

    const ready =
      typeof riskklass === "string" &&
      riskklass.length > 0 &&
      diff_timpris !== undefined &&
      diff_timpris !== null &&
      diff_timpris !== "" &&
      hint_text !== undefined &&
      hint_text !== null &&
      hint_text !== "";

    if (ready) {
      return {
        faktisk_marginal: faktisk_marginal ?? null,
        riskklass,
        hint_text: String(hint_text),
        diff_timpris: Number(diff_timpris) || 0,
        rowIndex,
      };
    }

    await sleep(intervalMs);
  }

  throw new Error(
    `Sheet calculation timeout. Row ${rowIndex}. Last values: ${JSON.stringify(lastValues)}`
  );
}
