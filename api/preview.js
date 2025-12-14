// api/preview.js
import { z } from "zod";
import { writeInputReadResult } from "../lib/sheets.js";

const Schema = z.object({
  jobbtyp: z.string().min(1),
  timpris: z.number(),
  timmar: z.number(),
  materialkostnad: z.number(),
  ue_kostnad: z.number(),
  rot: z.enum(["JA", "NEJ"]),
  risknivå: z.enum(["LÅG", "MED", "HÖG"]),
  // valfria fält (om du vill använda dem i sheet senare)
  önskad_marginal: z.number().optional(),
  omsättning: z.number().optional(),
  internkostnad: z.number().optional(),
  totalkostnad: z.number().optional(),
  email: z.string().email().optional(),
});

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).send("Method Not Allowed");
  }

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = {}; }
  }

  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return res.status(422).json({
      error: "Invalid input",
      details: parsed.error.flatten(),
    });
  }

  try {
    const d = parsed.data;

    const result = await writeInputReadResult({
      jobbtyp: d.jobbtyp,
      timpris: d.timpris,
      timmar: d.timmar,
      materialkostnad: d.materialkostnad,
      ue_kostnad: d.ue_kostnad,
      rot: d.rot,
      onskad_marginal: d.önskad_marginal ?? "",
      riskniva: d.risknivå,
      omsattning: d.omsättning ?? "",
      internkostnad: d.internkostnad ?? "",
      totalkostnad: d.totalkostnad ?? "",
    });

    // JSON-kontraktet du vill ha framåt
    return res.status(200).json({
      riskklass: result.riskklass,
      diff_timpris: result.diff_timpris,
      hint_text: result.hint_text,
      locked: result.riskklass === "RÖD" || result.riskklass === "GUL",
      // debug kan tas bort senare
      debug: { row: result.rowIndex, faktisk_marginal: result.faktisk_marginal },
    });
  } catch (err) {
    return res.status(500).json({
      error: "Sheets invocation failed",
      details: err?.message ?? String(err),
    });
  }
}
