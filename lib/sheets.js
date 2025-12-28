import { google } from "googleapis";

function getAuth() {
  // Supports either:
  // - GOOGLE_SERVICE_ACCOUNT_JSON (full JSON string)
  // - GOOGLE_CLIENT_EMAIL + GOOGLE_PRIVATE_KEY (private key may contain \n escapes)
  const saJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (saJson) {
    const creds = JSON.parse(saJson);
    return new google.auth.JWT(
      creds.client_email,
      null,
      creds.private_key,
      ["https://www.googleapis.com/auth/spreadsheets"]
    );
  }

  const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
  let privateKey = process.env.GOOGLE_PRIVATE_KEY;

  if (!clientEmail || !privateKey) {
    throw new Error(
      "Missing Google credentials. Set GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_CLIENT_EMAIL + GOOGLE_PRIVATE_KEY."
    );
  }

  privateKey = privateKey.replace(/\\n/g, "\n");

  return new google.auth.JWT(
    clientEmail,
    null,
    privateKey,
    ["https://www.googleapis.com/auth/spreadsheets"]
  );
}

export async function writeInputReadResult(input) {
  const spreadsheetId = process.env.SPREADSHEET_ID;
  if (!spreadsheetId) {
    throw new Error("Missing SPREADSHEET_ID env var");
  }

  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });

  // Write inputs to INPUT!B2:B12
  const values = [
    [input.jobbtyp ?? ""],
    [input.ortzon ?? ""],
    [input.rot ?? ""],
    [input.antal_anstallda ?? ""],
    [input.prismodell ?? ""],
    [input.timmar ?? ""],
    [input.timpris ?? ""],
    [input.fastpris ?? ""],
    [input.ue_kostnad ?? ""],
    [input.materialkostnad ?? ""],
    [input.justering ?? ""],
  ];

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: "INPUT!B2:B12",
    valueInputOption: "USER_ENTERED",
    requestBody: { values },
  });

  // Read output from EXPORT!A2:B60
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "EXPORT!A2:B60",
  });

  const rows = resp.data.values ?? [];
  const out = {};
  for (const r of rows) {
    const k = r?.[0];
    const v = r?.[1];
    if (k !== undefined && k !== null && String(k).trim().length > 0) {
      out[String(k).trim()] = v;
    }
  }

  return out;
}
