// lib/sheets.js
import { google } from "googleapis";
import crypto from "crypto";

/**
 * Creates an authenticated Google Sheets client using the service account.
 */
function getSheetsClient() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_JSON");

  const creds = JSON.parse(raw);

  const auth = new google.auth.JWT(
    creds.client_email,
    null,
    creds.private_key,
    ["https://www.googleapis.com/auth/spreadsheets"]
  );

  return google.sheets({ version: "v4", auth });
}

/** Sleep helper for polling */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Generate a unique run_id */
function runId() {
  return (
    crypto.randomUUID?.() ??
    `run_${Date.now()}_${Math.random().toString(16).slice(2)}`
  );
}

/** Convert to number safely */
function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Normalize prismodell */
function toPrismodell(v) {
  const s = String(v ?? "").trim().toUpperCase();
  if (s === "FAST") return "FAST";
  if (s === "LÖPANDE" || s === "LOPANDE") return "LÖPANDE";
  return s;
}

/** Normalize ROT */
function toRot(v) {
  const s = String(v ?? "").trim().toUpperCase();
  if (s === "JA" || s === "NEJ") return s;
  return "NEJ";
}

/** Normalize justering text */
function toJusteringText(v) {
  return String(v ?? "").trim();
}

/**
 * Writes input values to the INPUT sheet and polls EXPORT until ready.
 *
 * INPUT layout (Google Sheets):
 *
 *  B2  jobbtyp
 *  B3  marknadslage
 *  B4  rot
 *  B5  antal_anstallda
 *  B6  prismodell
 *  B7  timmar
 *  B8  timpris
 *  B9  fastpris
 *  B10 ue_kostnad
 *  B11 materialkostnad
 *  B12 justering (TEXT)
 *  B16 run_id
 */
export async function writeInputReadResult({
  jobbtyp,
  marknadslage,
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
  const id = runId();

  // Write run_id to INPUT!B16
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: "INPUT!B16",
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[id]] },
  });

  // Write the input block B2:B12
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: "INPUT!B2:B12",
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [
        [jobbtyp ?? ""],                // B2
        [marknadslage ?? ""],           // B3
        [toRot(rot)],                   // B4
        [num(antal_anstallda, 1)],      // B5
        [toPrismodell(prismodell)],     // B6
        [num(timmar, 0)],               // B7
        [num(timpris, 0)],              // B8
        [num(fastpris, 0)],             // B9
        [num(ue_kostnad, 0)],           // B10
        [num(materialkostnad, 0)],      // B11
        [toJusteringText(justering)],   // B12
      ],
    },
  });

  // Poll EXPORT sheet
  const exportRange = process.env.SHEET_EXPORT_RANGE || "EXPORT!A1:B80";
  const maxWaitMs = Number(process.env.SHEET_MAX_WAIT_MS || 12000);
  const intervalMs = Number(process.env.SHEET_POLL_INTERVAL_MS || 150);
  const deadline = Date.now() + maxWaitMs;

  let lastValues = null;

  while (Date.now() < deadline) {
    const r = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: exportRange,
      valueRenderOption: "UNFORMATTED_VALUE",
    });

    const rows = r?.data?.values ?? [];
    lastValues = rows;

    const out = {};
    for (const row of rows) {
      const k = row?.[0];
      const v = row?.[1];
      if (k !== undefined && k !== null && String(k).trim()) {
        out[String(k).trim()] = v;
      }
    }

    const outRunId = String(out.run_id ?? "");
    const lastFlag =
      out.last === true ||
      String(out.last ?? "").toUpperCase() === "TRUE";

    const hasRiskklass =
      typeof out.riskklass === "string" && out.riskklass.trim().length > 0;

    const hasBeslut =
      typeof out.beslut === "string" && out.beslut.trim().length > 0;

    // Ready when:
    // - run_id matches AND
    // - last=true OR riskklass present OR beslut present
    if (outRunId === id && (lastFlag || hasRiskklass || hasBeslut)) {
      return out;
    }

    await sleep(intervalMs);
  }

  // Timeout fallback: return last matching run_id if available
  try {
    const rows = lastValues ?? [];
    const out = {};
    for (const row of rows) {
      const k = row?.[0];
      const v = row?.[1];
      if (k !== undefined && k !== null && String(k).trim()) {
        out[String(k).trim()] = v;
      }
    }
    if (String(out.run_id ?? "") === id) return out;
  } catch {}

  throw new Error(
    `Sheet timeout (run_id=${id}). Last EXPORT: ${JSON.stringify(lastValues)}`
  );
}
