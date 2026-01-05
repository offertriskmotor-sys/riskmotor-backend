// lib/sheets.js
import { google } from "googleapis";
import crypto from "crypto";

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

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function runId() {
  return crypto.randomUUID?.() ?? `run_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function toPrismodell(v) {
  const s = String(v ?? "").trim().toUpperCase();
  if (s === "FAST") return "FAST";
  if (s === "LÖPANDE") return "LÖPANDE";
  if (s === "LOPANDE") return "LÖPANDE";
  return s;
}

function toRot(v) {
  const s = String(v ?? "").trim().toUpperCase();
  if (s === "JA" || s === "NEJ") return s;
  return "NEJ";
}

function toJusteringText(v) {
  return String(v ?? "").trim();
}

// ✅ Canonical marknadsläge (det ni beslutade)
// OBS: måste matcha exakt det sheet/backenden förväntar sig.
const ALLOWED_MARKNAD = new Set(["Normal marknad", "Hög efterfrågan", "Svår marknad"]);

function toMarknadslage(v) {
  const s = String(v ?? "").trim();

  // Om du vill vara stenhård: kasta fel om ogiltigt.
  // Jag gör det hårt här för att slippa Invalid input senare.
  if (!ALLOWED_MARKNAD.has(s)) {
    throw new Error(
      `Invalid input: marknadslage="${s}". Tillåtna: ${Array.from(ALLOWED_MARKNAD).join(", ")}`
    );
  }
  return s;
}

/**
 * INPUT layout:
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

  const pm = toPrismodell(prismodell);

  // ✅ Strict input per prismodell:
  // - FAST: timmar/timpris ska vara tomt (inte 0)
  // - LÖPANDE: fastpris ska vara tomt (inte 0)
  const timmarCell = pm === "LÖPANDE" ? num(timmar, 0) : "";
  const timprisCell = pm === "LÖPANDE" ? num(timpris, 0) : "";
  const fastprisCell = pm === "FAST" ? num(fastpris, 0) : "";

  // run_id -> INPUT!B16
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: "INPUT!B16",
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[id]] },
  });

  // Write input block: B2:B12
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: "INPUT!B2:B12",
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [
        [jobbtyp ?? ""],                 // B2
        [toMarknadslage(marknadslage)],  // B3  ✅ validerad
        [toRot(rot)],                    // B4
        [num(antal_anstallda, 1)],       // B5
        [pm],                            // B6
        [timmarCell],                    // B7  ✅ tomt vid FAST
        [timprisCell],                   // B8  ✅ tomt vid FAST
        [fastprisCell],                  // B9  ✅ tomt vid LÖPANDE
        [num(ue_kostnad, 0)],            // B10
        [num(materialkostnad, 0)],       // B11
        [toJusteringText(justering)],    // B12
      ],
    },
  });

  // Poll EXPORT
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

    // key/value -> object (pass-through)
    const out = {};
    for (const row of rows) {
      const k = row?.[0];
      const v = row?.[1];
      if (k !== undefined && k !== null && String(k).trim()) {
        out[String(k).trim()] = v;
      }
    }

    const outRunId = String(out.run_id ?? "");
    const lastFlag = out.last === true || String(out.last ?? "").toUpperCase() === "TRUE";
    const hasRiskklass = typeof out.riskklass === "string" && out.riskklass.trim().length > 0;
    const hasBeslut = typeof out.beslut === "string" && out.beslut.trim().length > 0;

    // ✅ Ready when:
    // - run_id matches AND
    // - sheet says last=true OR we have a riskklass OR beslut is present
    if (outRunId === id && (lastFlag || hasRiskklass || hasBeslut)) {
      return out;
    }

    await sleep(intervalMs);
  }

  // If timeout but we still have matching run_id, return what we have instead of throwing 500
  try {
    const rows = lastValues ?? [];
    const out = {};
    for (const row of rows) {
      const k = row?.[0];
      const v = row?.[1];
      if (k !== undefined && k !== null && String(k).trim()) out[String(k).trim()] = v;
    }
    if (String(out.run_id ?? "") === id) return out;
  } catch {}

  throw new Error(`Sheet timeout (run_id=${id}). Last EXPORT: ${JSON.stringify(lastValues)}`);
}
