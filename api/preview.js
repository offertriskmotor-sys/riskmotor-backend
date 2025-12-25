// api/preview.js
import { z } from "zod";

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Vary", "Origin");
}

// Schablontimmar för FAST när användaren inte anger timmar.
// Enkel, rimlig default. Finjustera när du har data.
function schablonTimmarFAST(jobbtyp, ortzon) {
  const jt = String(jobbtyp ?? "").trim().toLowerCase();

  // Bas per jobbtyp
  let h = 160; // default
  if (jt.includes("service")) h = 40;
  else if (jt.includes("renover")) h = 160;
  else if (jt.includes("tillbygg")) h = 220;
  else if (jt.includes("nybygg")) h = 600;

  // Ortjustering (störningar/logistik)
  const oz = String(ortzon ?? "").trim();
  if (oz === "Storstad") h = Math.round(h * 1.10);
  if (oz === "Landsbygd") h = Math.round(h * 1.10);

  return h;
}

const InputSchema = z.object({
  // Projekt
  jobbtyp: z.string().min(1),
  ortzon: z.enum(["Storstad", "Mellanstor", "Landsbygd"]),
  rot: z.enum(["JA", "NEJ"]),
  antal_anstallda: z.coerce.number(),

  // Pris/upplägg
  prismodell: z.enum(["LÖPANDE", "FAST"]).default("LÖPANDE"),
  fastpris: z.coerce.number().optional().default(0),

  // Produktion
  // Vid FAST: timmar/timpris får vara tomt (backend fyller timmar med schablon, timpris=0)
  timmar: z.coerce.number().optional().default(0),
  timpris: z.coerce.number().optional().default(0), // timpris_offert i sheet
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
    const { writeInputReadResult } = await import("../lib/sheets.js");

    const parsed = InputSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        error: "Invalid input",
        details: parsed.error.flatten(),
      });
    }

    const d = parsed.data;

    // Normalisering:
    // - FAST: användaren ska inte ange timpris => 0
    // - FAST: timmar kan utelämnas => schablon om <= 0
    let timmar = Number(d.timmar ?? 0);
    let timpris = Number(d.timpris ?? 0);
    let schablon_timmar = false;

    if (d.prismodell === "FAST") {
      timpris = 0;
      if (!Number.isFinite(timmar) || timmar <= 0) {
        timmar = schablonTimmarFAST(d.jobbtyp, d.ortzon);
        schablon_timmar = true;
      }
    }

    const result = await writeInputReadResult({
      jobbtyp: d.jobbtyp,
      ortzon: d.ortzon,
      rot: d.rot,
      antal_anstallda: d.antal_anstallda,

      prismodell: d.prismodell,
      fastpris: d.fastpris,

      timmar,
      timpris,
      ue_kostnad: d.ue_kostnad,
      materialkostnad: d.materialkostnad,
      justering: d.justering,
    });

    // Behåll din marker (ändra om du vill bumpa version)
    res.setHeader("x-build-marker", "sheets-v7");

    // locked: lås allt som inte är SKICKA
    const locked =
      typeof result.decision === "string"
        ? result.decision.trim() !== "SKICKA"
        : true;

    return res.status(200).json({
      ...result,
      locked,
      schablon_timmar,
      timmar_kalla: schablon_timmar ? "SCHABLON" : "ANGIVET",
    });
  } catch (err) {
    console.error("PREVIEW ERROR:", err);
    return res.status(500).json({
      error: "Internal server error",
      details: err?.message ?? String(err),
    });
  }
}
