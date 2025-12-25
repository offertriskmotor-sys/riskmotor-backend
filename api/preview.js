// api/preview.js
import { z } from "zod";

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Vary", "Origin");
}

const InputSchema = z.object({
  // Projekt
  jobbtyp: z.string().min(1),
  ortzon: z.enum(["Storstad", "Mellanstor", "Landsbygd"]),
  rot: z.enum(["JA", "NEJ"]),
  antal_anstallda: z.coerce.number(),

  // Pris / upplägg (matchar din sheet)
  prismodell: z.coerce.number().optional().default(1), // 1 = LÖPANDE, 2 = FAST
  fastpris: z.coerce.number().optional().default(0),   // endast relevant om prismodell=2

  // Produktion
  timmar: z.coerce.number(),
  timpris: z.coerce.number(), // timpris_offert i sheet
  ue_kostnad: z.coerce.number().optional().default(0),
  materialkostnad: z.coerce.number(),

  // Subjektiv justering (0/1/2)
  justering: z.coerce.number().optional().default(0),

  // Övrigt
  email: z.string().email().optional(),
});

export default async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    // Lazy import så OPTIONS aldrig laddar Google
    const { writeInputReadResult } = await import("../lib/sheets.js");

    const parsed = InputSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        error: "Invalid input",
        details: parsed.error.flatten(),
      });
    }

    const d = parsed.data;

    // Skriv till INPUT + läs EXPORT (run_id-säkrad)
    const result = await writeInputReadResult({
      jobbtyp: d.jobbtyp,
      ortzon: d.ortzon,
      rot: d.rot,
      antal_anstallda: d.antal_anstallda,

      prismodell: d.prismodell,
      fastpris: d.fastpris,

      timmar: d.timmar,
      timpris: d.timpris,
      ue_kostnad: d.ue_kostnad,
      materialkostnad: d.materialkostnad,
      justering: d.justering,
    });

    // Marker för felsökning/versionering
    res.setHeader("x-build-marker", "sheets-v5");

    // Låsning baserad på beslut
    const locked =
      typeof result.decision === "string"
        ? result.decision.trim() !== "SKICKA"
        : true;

    return res.status(200).json({
      ...result,
      locked,
    });
  } catch (err) {
    console.error("PREVIEW ERROR:", err);
    return res.status(500).json({
      error: "Internal server error",
      details: err?.message ?? String(err),
    });
  }
}
