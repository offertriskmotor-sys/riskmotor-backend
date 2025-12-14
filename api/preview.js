// api/preview.js
import { z } from "zod";
import { writeInputReadResult } from "../lib/sheets.js";

// Tillåt både siffror och sträng-siffror ("520") så du slipper huvudvärk
const num = z.preprocess((v) => {
  if (typeof v === "string" && v.trim() !== "") return Number(v);
  return v;
}, z.number());

const Schema = z.object({
  jobbtyp: z.string().min(1),
  timpris: num,
  timmar: num,
  materialkostnad: num,
  ue_kostnad: num,
  rot: z.enum(["JA", "NEJ"]),
  risknivå: z.enum(["LÅG", "MED", "HÖG"]),

  // valfritt (du kan skicka senare)
  önskad_marginal: num.optional(),
  omsättning: num.optional(),
  internkostnad: num.optional(),
  totalkostnad: num.optional(),
  email: z.string().email().optional(),
});

export default async function handler(req, res) {
  // 1) METHOD GUARD FÖRST
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).send("Method Not Allowed");
  }

  // 2) Bygg-markör (så vi vet att rätt kod körs)
  res.setHeader("x-build-marker", "sheets-v1");

  // 3) Body parse (Vercel kan ge string eller objekt)
  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      body = {};
    }
  }

  // 4) Validera input
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return res.status(422).json({
      error: "Invalid input",
      details: parsed.error.flatten(),
    });
  }

  // 5) Kör Sheets (append + poll + read)
  try {
    const d = parsed.data;

    const result = await writeInputReadResult({
      jobbtyp: d.jobbtyp,
      timpris: d.timpris,
      timmar: d.timmar,
      materialkostnad: d.materialkostnad,
      ue_kostnad: d.ue_kostnad,
      rot: d.rot,

      // valfria
      onskad_marginal: d.önskad_marginal ?? "",
      riskniva: d.risknivå,
      omsattning: d.omsättning ?? "",
      internkostnad: d.internkostnad ?? "",
      totalkostnad: d.totalkostnad ?? "",
    });

    return res.status(200).json({
      riskklass: result.riskklass,
      diff_timpris: result.diff_timpris,
      hint_text: result.hint_text,
      locked: result.riskklass === "RÖD" || result.riskklass === "GUL",
      debug: {
        row: result.rowIndex,
        faktisk_marginal: result.faktisk_marginal,
      },
    });
  } catch (err) {
    return res.status(500).json({
      error: "Sheets invocation failed",
      details: err?.message ?? String(err),
    });
  }
}
