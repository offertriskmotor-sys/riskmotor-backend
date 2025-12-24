// api/preview.js
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

  // gör risknivå optional (användaren ska inte behöva ange den)
  risknivå: z.enum(["LÅG", "MED", "HÖG"]).optional(),

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

    // Mappa request → sheets.js (svenska tecken -> ascii i paramnamn)
    const result = await writeInputReadResult({
      jobbtyp: d.jobbtyp,
      timpris: d.timpris,
      timmar: d.timmar,
      materialkostnad: d.materialkostnad,
      ue_kostnad: d.ue_kostnad,
      rot: d.rot,

      // riskniva lämnas tom om den inte skickas
      riskniva: d.risknivå ?? "",

      onskad_marginal: d.önskad_marginal,
      omsattning: d.omsättning,
      internkostnad: d.internkostnad,
      totalkostnad: d.totalkostnad,
    });

    // Markera ny version som läser från EXPORT-tabben
    res.setHeader("x-build-marker", "sheets-v2");

    // Returnera hela EXPORT-kontraktet + minimal debug
    return res.status(200).json({
      ...result,
      locked: typeof result.decision === "string" ? result.decision !== "SKICKA" : true,
      debug: { row: result.rowIndex },
    });
  } catch (err) {
    console.error("PREVIEW ERROR:", err);
    return res.status(500).json({
      error: "Internal server error",
      details: err?.message ?? String(err),
    });
  }
}
