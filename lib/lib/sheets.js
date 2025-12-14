import { google } from "googleapis";

function getSheetsClient() {
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);

  const auth = new google.auth.JWT(
    creds.client_email,
    null,
    creds.private_key,
    ["https://www.googleapis.com/auth/spreadsheets"]
  );

  return google.sheets({ version: "v4", auth });
}

function parseRowFromUpdatedRange(updatedRange) {
  // Example: "Regler_v1!A12:H12"
  const m = updatedRange.match(/![A-Z]+(\d+):[A-Z]+(\d+)/);
  if (!m) throw new Error("Could not parse updatedRange: " + updatedRange);
  return Number(m[1]);
}

export async function appendInputAndGetRow(inputRow) {
  const sheets = getSheetsClient();
  const spreadsheetId = process.env.SHEET_ID;
  const tab = process.env.SHEET_TAB || "Regler_v1";

  const resp = await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${tab}!A:H`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [inputRow] },
  });

  const updatedRange = resp.data.updates?.updatedRange;
  if (!updatedRange) throw new Error("Missing updates.updatedRange from append()");
  return parseRowFromUpdatedRange(updatedRange);
}

export async function readCalcRow(rowNumber) {
  const sheets = getSheetsClient();
  const spreadsheetId = process.env.SHEET_ID;
  const tab = process.env.SHEET_TAB || "Regler_v1";

  // Your layout:
  // L=faktisk_marginal, M=riskklass, N=åtgärd_för_grön, O=krav_timpris, P=målmarginal, Q=diff_timpris
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${tab}!L${rowNumber}:Q${rowNumber}`,
    valueRenderOption: "UNFORMATTED_VALUE",
  });

  const v = res.data.values?.[0] || [];
  return {
    faktisk_marginal: Number(v[0] ?? 0),
    riskklass: String(v[1] ?? ""),
    åtgärd_för_grön: String(v[2] ?? ""),
    krav_timpris: Number(v[3] ?? 0),   // O
    målmarginal: Number(v[4] ?? 0),    // P
    diff_timpris: Number(v[5] ?? 0),   // Q
  };
}
