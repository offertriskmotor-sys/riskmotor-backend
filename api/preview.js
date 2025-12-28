import { writeInputReadResult } from "./sheets.js";

function parseNumberOrNull(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return v;
  const s = String(v).trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function normalizePayload(body = {}) {
  const p = {
    jobbtyp: body.jobbtyp ?? "",
    ortzon: body.ortzon ?? "",
    rot: body.rot ?? "",
    antal_anstallda: parseNumberOrNull(body.antal_anstallda),
    prisodell: body.prismodell ?? "",
    prisodell_raw: body.prismodell ?? "",
    timmar: parseNumberOrNull(body.timmar),
    timpris: parseNumberOrNull(body.timpris),
    fastpris: parseNumberOrNull(body.fastpris),
    ue_kostnad: parseNumberOrNull(body.ue_kostnad),
    materialkostnad: parseNumberOrNull(body.materialkostnad),
    justering: parseNumberOrNull(body.justering) ?? 0,
  };

  // Normalize pricing model labels if needed
  const m = String(p.prisodell_raw || "").toUpperCase();
  if (m === "FAST" || m === "FIXED") p.prisodell = "FAST";
  else if (m === "LÖPANDE" || m === "LOPANDE" || m === "HOURLY") p.prisodell = "LÖPANDE";
  else p.prisodell = p.prisodell_raw;

  return p;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const input = normalizePayload(req.body || {});
    const result = await writeInputReadResult(input);
    return res.status(200).json(result);
  } catch (e) {
    console.error(e);
    return res.status(500).json({
      error: "Internal server error",
      details: e?.message ?? String(e),
    });
  }
}
