// lib/sheets.js
import { google } from "googleapis";
import crypto from "crypto";

function getSheetsClient() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_JSON");

  let creds;
  try {
    creds = JSON.parse(raw);
  } catch {
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

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function makeRunId() {
  try {
    if (crypto?.randomUUID) return crypto.randomUUID();
  } catch {}
  return `run_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

/**
 * IMPORTANT SHEET CONTRACT:
 * - INPUT!B16 holds run_id
 * - EXPORT must echo it as key "run_id" (e.g. EXPORT!A1="run_id", EXPORT!B1="=INPUT!B16")
 */
export async function writeInputReadResult({
  jobbtyp,
  ortzon,
  rot,
  antal_anstallda,
  prismodell,      // NEW
  timmar,
  timpris,
  fastpris,        // NEW
  ue_kostnad,
  materialkostnad,
  justering,
}) {
  const spreadsheetId = process.env.SHEET_ID;
  if (!spreadsheetId) throw new Error("Missing SHEET_ID");

  const sheets = getSheetsClient();
  const runId = makeRunId();

  // 1) run_id -> INPUT!B16 (per din sheet)
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: "INPUT!B16",
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[runId]] },
  });

  // 2) Inputs -> INPUT!B2:B12 (per din "Fält/Värde"-layout)
  // B1 är rubrik "Värde", så första värdet ska i B2.
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: "INPUT!B2:B12",
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [
        [jobbtyp ?? ""],                                  // B2  jobbtyp
        [ortzon ?? ""],                                   // B3  ortzon
        [rot ?? ""],                                      // B4  rot
        [Number.isFinite(Number(antal_anstallda)) ? Number(antal_anstallda) : 1], // B5 antal_anstallda
        [Number.isFinite(Number(prismodell)) ? Number(prismodell) : 1],           // B6 prismodell (1=löpande, 2=fast)
        [Number.isFinite(Number(timmar)) ? Number(timmar) : 0],                   // B7 timmar
        [Number.isFinite(Number(timpris)) ? Number(timpris) : 0],                 // B8 timpris_offert
        [Number.isFinite(Number(fastpris)) ? Number(fastpris) : 0],               // B9 fastpris
        [Number.isFinite(Number(ue_kostnad)) ? Number(ue_kostnad) : 0],           // B10 ue_kostnad
        [Number.isFinite(Number(materialkostnad)) ? Number(materialkostnad) : 0], // B11 materialkostnad
        [Number.isFinite(Number(justering)) ? Number(justering) : 0],             // B12 justering
      ],
    },
  });

  // 3) Poll EXPORT
  const exportTab = process.env.SHEET_EXPORT_TAB || "EXPORT";
  const exportRange = process.env.SHEET_EXPORT_RANGE || `${exportTab}!A1:B50`;

  const maxWaitMs = Number(process.env.SHEET_MAX_WAIT_MS || 5000);
  const intervalMs = Number(process.env.SHEET_POLL_INTERVAL_MS || 150);
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

    const outRunId = String(out.run_id ?? "");
    const decisionOk = typeof out.decision === "string" && out.decision.trim().length > 0;

    if (outRunId === runId && decisionOk) return { ...out };

    await sleep(intervalMs);
  }

  throw new Error(
    `Sheet calculation timeout (run_id=${runId}). Last EXPORT values: ${JSON.stringify(lastValues)}`
  );
}
