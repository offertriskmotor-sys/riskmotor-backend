import { z } from "zod";

/* ---------------- CORS ---------------- */
function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Vary", "Origin");
}

/* ---------------- Validation ---------------- */
const InputSchema = z.object({
  jobbtyp: z.string(),
  timpris: z.number(),
  timmar: z.number(),
  materialkostnad: z.number(),
  ue_kostnad: z.number().optional().default(0),
  rot: z.enum(["JA", "NEJ"]),
  risknivå: z.enum(["LÅG", "MED", "HÖG"]),
  email: z.string().email().optional(),
});

/* ---------------- Handler ---------------- */
export default async function handler(req, res) {
  setCors(res);

  // 🟢 Preflight – INGEN LOGIK, INGA IMPORTS
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // 🔴 IMPORTERA SHEETS FÖRST HÄR
    const { appendInputAndGetRow, readCalcRow } = await import("../lib/sheets.js");

    const data = typeof req.body === "object" ? req.body : JSON.parse(req.body || "{}");
    const parsed = InputSchema.parse(data);

    const row = [
      parsed.jobbtyp,
      parsed.timpris,
      parsed.timmar,
      parsed.materialkostnad,
      parsed.ue_kostnad,
      parsed.rot,
      "",
      parsed.risknivå,
      "",
      "",
      "",
    ];

    const rowIndex = await appendInputAndGetRow(row);
    const calc = await readCalcRow(rowIndex);

    const riskklass = calc.riskklass;
    const diff_timpris = Number(calc.diff_timpris || 0);
    const hint_text = String(calc.åtgärd_för_grön || "");
    const locked = riskklass !== "GRÖN";

    res.setHeader("x-build-marker", "sheets-v1");
    return res.status(200).json({
      riskklass,
      diff_timpris,
      hint_text,
      locked,
    });
  } catch (err) {
    console.error("PREVIEW ERROR:", err);
    return res.status(500).json({
      error: "Internal server error",
      details: err.message || String(err),
    });
  }
}
