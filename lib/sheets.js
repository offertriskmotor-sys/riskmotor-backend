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
  // Deterministic enough + no collisions in practice
  try {
    if (crypto?.randomUUID) return crypto.randomUUID();
  } catch {}
  return `run_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

/**
 * Writes request values into fixed INPUT cells, then polls EXPORT tab (A:B)
 * until out.run_id matches the current runId AND decision exists.
 *
 * IMPORTANT:
 * - Sheet must echo INPUT!B2 to EXPORT as key "run_id" (e.g. EXPORT!A1="run_id", B1="=INPUT!B2")
 */
export async function writeInputReadResult({
  jobbtyp,
  ortzon,
  rot,
  antal_anstallda,
  timmar,
  timpris,
  ue_kostnad,
  materialkostnad,
  justering,
}) {
  const spreadsheetId = process.env.SHEET_ID;
  if (!spreadsheetId) throw new Error("Missing SHEET_ID");

  const sheets = getSheetsClient();

  const runId = makeRunId();

  // 1) Write into INPUT fixed cells (based on your sheet layout)
  // INPUT!B2  run_id (NEW)
  // INPUT!B3  jobbtyp
  // INPUT!B4  ortzon
  // INPUT!B5  rot
  // INPUT!B6  antal_anstallda
  // INPUT!B7  timmar
  // INPUT!B8  timpris_offert
  // INPUT!B9  ue_kostnad
  // INPUT!B10 materialkostnad
  // INPUT!B11 justering (0/1/2)
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: "INPUT!B2:B11",
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [
        [runId],
        [jobbtyp ?? ""],
        [ortzon ?? ""],
        [rot ?? ""],
        [Number.isFinite(Number(antal_anstallda)) ? Number(antal_anstallda) : 1],
        [Number.isFinite(Number(timmar)) ? Number(timmar) : 0],
        [Number.isFinite(Number(timpris)) ? Number(timpris) : 0],
        [Number.isFinite(Number(ue_kostnad)) ? Number(ue_kostnad) : 0],
        [Number.isFinite(Number(materialkostnad)) ? Number(materialkostnad) : 0],
        [Number.isFinite(Number(justering)) ? Number(justering) : 0],
      ],
    },
  });

  // 2) Poll EXPORT tab until ready
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

    // Build { key: value } from EXPORT rows
    const out = {};
    for (const r of rows) {
      const k = r?.[0];
      const v = r?.[1];
      if (k !== undefined && k !== null && String(k).trim().length > 0) {
        out[String(k).trim()] = v;
      }
    }

    // Ready ONLY when:
    // 1) out.run_id matches this runId (prevents returning stale previous run)
    // 2) decision exists and is non-empty
    const outRunId = String(out.run_id ?? "");
    const decisionOk =
      typeof out.decision === "string" && out.decision.trim().length > 0;

    if (outRunId === runId && decisionOk) {
      return { ...out };
    }

    await sleep(intervalMs);
  }

  throw new Error(
    `Sheet calculation timeout (run_id=${runId}). Last EXPORT values: ${JSON.stringify(lastValues)}`
  );
}

