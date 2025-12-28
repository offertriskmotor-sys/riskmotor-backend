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

function toNumber(x, fallback = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}

function toPrismodell(x) {
  // Only "LÖPANDE" | "FAST" in sheet
  const s = String(x ?? "").trim().toUpperCase();
  if (s === "FAST") return "FAST";
  if (s === "LÖPANDE") return "LÖPANDE";
  // accept common typo "LOPANDE" from clients
  if (s === "LOPANDE") return "LÖPANDE";
  return "LÖPANDE";
}

/**
 * INPUT contract (OffertRiskmotor v29+ / (30).xlsx):
 * INPUT!B3  jobbtyp
 * INPUT!B4  ortzon
 * INPUT!B5  rot
 * INPUT!B6  antal_anstallda
 * INPUT!B8  prismodell  ("LÖPANDE" | "FAST")
 * INPUT!B9  timmar
 * INPUT!B10 timpris_offert
 * INPUT!B11 fastpris
 * INPUT!B13 ue_kostnad
 * INPUT!B14 materialkostnad
 * INPUT!B16 justering
 * INPUT!B20 run_id
 *
 * EXPORT is a key/value table in A:B, where:
 * EXPORT!A1 = run_id
 * EXPORT!B1 = =INPUT!B20
 */
export async function writeInputReadResult({
  jobbtyp,
  ortzon,
  rot,
  antal_anstallda,
  prismodell,
  timmar,
  timpris,
  fastpris,
  ue_kostnad,
  materialkostnad,
  justering,
}) {
  const spreadsheetId = process.env.SHEET_ID;
  if (!spreadsheetId) throw new Error("Missing SHEET_ID");

  const sheets = getSheetsClient();
  const runId = makeRunId();

  // 1) run_id -> INPUT!B20
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: "INPUT!B20",
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[runId]] },
  });

  // 2) write inputs (non-contiguous, but keep it simple with multiple updates)
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: "INPUT!B3:B6",
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [
        [jobbtyp ?? ""],                // B3
        [ortzon ?? ""],                 // B4
        [rot ?? ""],                    // B5
        [toNumber(antal_anstallda, 1)], // B6
      ],
    },
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: "INPUT!B8:B11",
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [
        [toPrismodell(prismodell)], // B8
        [toNumber(timmar, 0)],      // B9
        [toNumber(timpris, 0)],     // B10
        [toNumber(fastpris, 0)],    // B11
      ],
    },
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: "INPUT!B13:B14",
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [
        [toNumber(ue_kostnad, 0)],      // B13
        [toNumber(materialkostnad, 0)], // B14
      ],
    },
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: "INPUT!B16",
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[toNumber(justering, 0)]] }, // B16
  });

  // 3) poll EXPORT until run_id matches and beslut exists
  const exportTab = process.env.SHEET_EXPORT_TAB || "EXPORT";
  const exportRange = process.env.SHEET_EXPORT_RANGE || `${exportTab}!A1:B60`;

  const maxWaitMs = Number(process.env.SHEET_MAX_WAIT_MS || 8000);
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
    const beslutOk = typeof out.beslut === "string" && out.beslut.trim().length > 0;

    if (outRunId === runId && beslutOk) {
      return out;
    }

    await sleep(intervalMs);
  }

  throw new Error(
    `Sheet calculation timeout (run_id=${runId}). Last EXPORT values: ${JSON.stringify(lastValues)}`
  );
}

