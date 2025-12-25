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
  ortzon: z.enum(["Storstad", "Mellanstor", "Landsbygd", "Turistort"]),
  rot: z.enum(["JA", "NEJ"]),
  antal_anstallda: z.coerce.number().default(1),

  prismodell: z.enum(["LÖPANDE", "FAST"]).default("LÖPANDE"),
  fastpris: z.coerce.number().optional().default(0),

  // Valfria (Sheets kan schablona om du har låst/formler där)
  timmar: z.coerce.number().optional().default(0),
  timpris: z.coerce.number().optional().default(0),
  ue_kostnad: z.coerce.number().optional().default(0),
  materialkostnad: z.coerce.number().default(0),

  justering: z.coerce.number().optional().default(0),
});

export default async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  try {
    const { writeInputReadResult } = await import("../lib/sheets.js");

    const parsed = InputSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        error: "Invalid input",
        details: parsed.error.flatten(),
      });
    }

    const d = parsed.data;

    const result = await writeInputReadResult({
      jobbtyp: d.jobbtyp,
      ortzon: d.ortzon,
      rot: d.rot,
      antal_anstallda: d.antal_anstallda,
      prismodell: d.prismodell,
      timmar: d.timmar,
      timpris: d.timpris,
      fastpris: d.fastpris,
      ue_kostnad: d.ue_kostnad,
      materialkostnad: d.materialkostnad,
      justering: d.justering,
    });

    res.setHeader("x-build-marker", "sheets-v7");
    return res.status(200).json(result);
  } catch (err) {
    console.error("PREVIEW ERROR:", err);
    return res.status(500).json({
      error: "Internal server error",
      details: err?.message ?? String(err),
    });
  }
}
