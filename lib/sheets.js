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
  // TEXT ONLY: "LÖPANDE" | "FAST"
  const s = String(x ?? "").trim().toUpperCase();
  if (s === "FAST") return "FAST";
  return "LÖPANDE";
}

/**
 * SHEET CONTRACT (your current "Fält/Värde" INPUT layout):
 * - INPUT!B1 is header "Värde"
 * - INPUT!B2  jobbtyp
 * - INPUT!B3  ortzon
 * - INPUT!B4  rot
 * - INPUT!B5  antal_anstallda
 * - INPUT!B6  prismodell  ("LÖPANDE" | "FAST")
 * - INPUT!B7  timmar
 * - INPUT!B8  timpris_offert
 * - INPUT!B9  fastpris
 * - INPUT!B10 ue_kostnad
 * - INPUT!B11 materialkostnad
 * - INPUT!B12 justering
 * - INPUT!B16 run_id
 *
 * EXPORT must echo run_id:
 * - EXPORT!A1 = run_id
 * - EXPORT!B1 = =INPUT!B16
 */
export async function writeInputReadResult({
  jobbtyp,
  ortzon,
  rot,
  antal_anstallda,
  prismodell, // "LÖPANDE" | "FAST"
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

  // 1) run_id -> INPUT!B16
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: "INPUT!B16",
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[runId]] },
  });

  // 2) Main inputs -> INPUT!B2:B12
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: "INPUT!B2:B12",
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [
        [jobbtyp ?? ""],                // B2
        [ortzon ?? ""],                 // B3
        [rot ?? ""],                    // B4
        [toNumber(antal_anstallda, 1)], // B5
        [toPrismodell(prismodell)],     // B6
        [toNumber(timmar, 0)],          // B7
        [toNumber(timpris, 0)],         // B8
        [toNumber(fastpris, 0)],        // B9
        [toNumber(ue_kostnad, 0)],      // B10
        [toNumber(materialkostnad, 0)], // B11
        [toNumber(justering, 0)],       // B12
      ],
    },
  });

  // DEBUG: read back critical INPUT cells (B6..B9)
  const dbg = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "INPUT!B6:B9",
    valueRenderOption: "UNFORMATTED_VALUE",
  });

  const dbgValues = dbg?.data?.values ?? [];
  const dbg_prismodell = dbgValues?.[0]?.[0] ?? "";
  const dbg_timpris = dbgValues?.[2]?.[0] ?? "";
  const dbg_fastpris = dbgValues?.[3]?.[0] ?? "";

  // DEBUG: dump INPUT A1:B16 to see what sheet actually stored
  const dumpResp = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "INPUT!A1:B16",
    valueRenderOption: "UNFORMATTED_VALUE",
  });
  const dbg_input_dump = dumpResp?.data?.values ?? [];

  // 3) Poll EXPORT
  const exportTab = process.env.SHEET_EXPORT_TAB || "EXPORT";
  const exportRange = process.env.SHEET_EXPORT_RANGE || `${exportTab}!A1:B50`;

  const maxWaitMs = Number(process.env.SHEET_MAX_WAIT_MS || 6000);
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

    if (outRunId === runId && decisionOk) {
      return { ...out, dbg_prismodell, dbg_timpris, dbg_fastpris, dbg_input_dump };
    }

    await sleep(intervalMs);
  }

  throw new Error(
    `Sheet calculation timeout (run_id=${runId}). Last EXPORT values: ${JSON.stringify(lastValues)}`
  );
}
