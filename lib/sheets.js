// lib/sheets.js
import { google } from "googleapis";
import crypto from "crypto";

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

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function runId() {
  return crypto.randomUUID?.() ?? `run_${Date.now()}`;
}

function num(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

export async function writeInputReadResult(input) {
  const sheets = getSheetsClient();
  const spreadsheetId = process.env.SHEET_ID;
  const id = runId();

  // run_id
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: "INPUT!B20",
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[id]] }
  });

  // INPUT (v2 – utan ortzon)
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: "INPUT!B3:B11",
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [
        [input.jobbtyp],               // B3
        [input.marknadslage],          // B4
        [input.rot],                   // B5
        [num(input.antal_anstallda)],  // B6
        [input.prismodell],            // B7
        [num(input.timmar)],           // B8
        [num(input.timpris)],          // B9
        [num(input.fastpris)],         // B10
      ]
    }
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: "INPUT!B13:B16",
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [
        [num(input.ue_kostnad)],        // B13
        [num(input.materialkostnad)],  // B14
        [input.justering],              // B16 (TEXT)
      ]
    }
  });

  // poll EXPORT
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const r = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "EXPORT!A1:B80",
      valueRenderOption: "UNFORMATTED_VALUE"
    });

    const out = {};
    for (const [k, v] of r.data.values ?? []) {
      if (k) out[String(k).trim()] = v;
    }

    if (out.run_id === id && out.beslut) return out;
    await sleep(150);
  }

  throw new Error("Sheet timeout");
}
