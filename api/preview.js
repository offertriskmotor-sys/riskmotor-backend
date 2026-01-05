// api/preview.js
import { z } from "zod";

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

const InputSchema = z.object({
  jobbtyp: z.string().min(1),
  marknadslage: z.enum(["Normal marknad", "Hög efterfrågan", "Svår marknad"]),
  rot: z.enum(["JA", "NEJ"]),
  antal_anstallda: z.coerce.number().min(1),
  prismodell: z.enum(["LÖPANDE", "FAST"]),
  timmar: z.coerce.number().optional().default(0),
  timpris: z.coerce.number().optional().default(0),
  fastpris: z.coerce.number().optional().default(0),
  ue_kostnad: z.coerce.number().optional().default(0),
  materialkostnad: z.coerce.number().optional().default(0),
  justering: z.enum(["Lägre risk", "Normal risk", "Högre risk"]),
});

export default async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const parsed = InputSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid input",
      details: parsed.error.flatten(),
    });
  }

  try {
    const { writeInputReadResult } = await import("../lib/sheets.js");
    const result = await writeInputReadResult(parsed.data);
    return res.status(200).json(result);
  } catch (e) {
    console.error("PREVIEW ERROR:", e);
    return res.status(500).json({
      error: "Internal error",
      details: e?.message ?? String(e),
    });
  }
}
