import { z } from "zod";
import { appendInputAndGetRow, readCalcRow } from "../lib/sheets.js";

// ---------- CORS (måste finnas för browser/Lovable) ----------
function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  // bra att ha för cache-proxies
  res.setHeader("Vary", "Origin");
}

// ---------- Input validation ----------
const InputSchema = z.object({
  jobbtyp: z.string().min(1),
  timpris: z.number(),
  timmar: z.number(),
  materialkostnad: z.number(),
  ue_kostnad: z.number().optional().default(0),
  rot: z.enum(["JA", "NEJ"]),
  risknivå: z.enum(["LÅG", "MED", "HÖG"]),
  email: z.string().email().optional(),
  önskad_marginal: z.number().optional(),
  omsättning: z.number().optional(),
  internkostnad: z.number().optional(),
  totalkostnad: z.number().optional(),
});

// ---------- Helper: safe parse JSON ----------
async function readJson(req) {
  return await new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      try {
        resolve(JSON.parse(data || "{}"));
      } catch (e) {
        reject(e);
      }
    });
  });
}

export default async function handler(req, res) {
  setCors(res);

  // Preflight
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    // Vercel brukar redan parse:a JSON ibland, men vi gör robust:
    const raw = req.body && typeof req.body === "object" ? req.body : await readJson(req);

    const parsed = InputSchema.safeParse(raw);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Invalid input",
        details: parsed.error.flatten(),
      });
    }

    const d = parsed.data;

    // Bygg rad exakt i samma ordning som din sheet förväntar (A–K input)
    // A jobbtyp
    // B timpris
    // C timmar
    // D materialkostnad
    // E ue_kostnad
    // F rot
    // G önskad_marginal
    // H risknivå
    // I omsättning
    // J internkostnad
    // K totalkostnad
    const inputRow = [
      d.jobbtyp,
      d.timpris,
      d.timmar,
      d.materialkostnad,
      d.ue_kostnad ?? 0,
      d.rot,
      d.önskad_marginal ?? "",
      d.risknivå,
      d.omsättning ?? "",
      d.internkostnad ?? "",
      d.totalkostnad ?? "",
    ];

    // 1) Append input → få radindex
    const rowIndex = await appendInputAndGetRow(inputRow);

    // 2) Läs beräknade kolumner för samma rad (L–Q)
    const calc = await readCalcRow(rowIndex);

    // calc bör innehålla:
    // faktisk_marginal, riskklass, åtgärd_för_grön, målmarginal, krav_timpris, diff_timpris
    // Vi returnerar bara det frontend behöver (plus valfri debug)
    const riskklass = calc.riskklass;
    const diff_timpris = Number(calc.diff_timpris ?? 0) || 0;
    const hint_text = String(calc.åtgärd_för_grön ?? "");

    // Låsning: lås om RÖD eller GUL (du kan justera detta senare utan att röra Sheets)
    const locked = riskklass !== "GRÖN";

    res.setHeader("x-build-marker", "sheets-v1");
    return res.status(200).json({
      riskklass,
      diff_timpris,
      hint_text,
      locked,
      debug: {
        row: rowIndex,
        faktisk_marginal: calc.faktisk_marginal,
      },
    });
  } catch (err) {
    return res.status(500).json({
      error: "Sheets invocation failed",
      details: err?.message ?? String(err),
    });
  }
}
