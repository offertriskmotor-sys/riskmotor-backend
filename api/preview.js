import { z } from "zod";

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Vary", "Origin");
}

const InputSchema = z.object({
  jobbtyp: z.string().min(1),
  timpris: z.coerce.number(),
  timmar: z.coerce.number(),
  materialkostnad: z.coerce.number(),
  ue_kostnad: z.coerce.number().optional().default(0),
  rot: z.enum(["JA", "NEJ"]),
  risknivå: z.enum(["LÅG", "MED", "HÖG"]),
  email: z.string().email().optional(),

  // valfria fält (om du skickar dem senare)
  önskad_marginal: z.coerce.number().optional(),
  omsättning: z.coerce.number().optional(),
  internkostnad: z.coerce.number().optional(),
  totalkostnad: z.coerce.number().optional(),
});

export default async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  try {
    // Lazy import så OPTIONS aldrig laddar Google
    const { writeInputReadResult } = await import("../lib/sheets.js");

    const parsed = InputSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    }

    const d = parsed.data;

    // Mappa frontend → sheets.js (svenska tecken -> ascii)
    const result = await writeInputReadResult({
      jobbtyp: d.jobbtyp,
      timpris: d.timpris,
      timmar: d.timmar,
      materialkostnad: d.materialkostnad,
      ue_kostnad: d.ue_kostnad,
      rot: d.rot,
      onskad_marginal: d.önskad_marginal,
      riskniva: d.risknivå,
      omsattning: d.omsättning,
      internkostnad: d.internkostnad,
      totalkostnad: d.totalkostnad,
    });

    res.setHeader("x-build-marker", "sheets-v1");

    return res.status(200).json({
      riskklass: result.riskklass,
      diff_timpris: result.diff_timpris,
      hint_text: result.hint_text,
      locked: result.riskklass !== "GRÖN",
      debug: { row: result.rowIndex, faktisk_marginal: result.faktisk_marginal },
    });
  } catch (err) {
    console.error("PREVIEW ERROR:", err);
    return res.status(500).json({
      error: "Internal server error",
      details: err?.message ?? String(err),
    });
  }
}
