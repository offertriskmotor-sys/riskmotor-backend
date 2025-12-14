// api/preview.js
import { z } from "zod";
import { previewCalculateStub } from "../lib/sheets.js";

const Schema = z.object({
  jobbtyp: z.string().min(1),
  timpris: z.number(),
  timmar: z.number(),
  materialkostnad: z.number(),
  ue_kostnad: z.number(),
  rot: z.enum(["JA", "NEJ"]),
  risknivå: z.enum(["LÅG", "MED", "HÖG"]),
  email: z.string().email().optional()
});

export default async function handler(req, res) {
  // 1) METHOD GUARD FÖRST (så du aldrig får 500 på GET)
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).send("Method Not Allowed");
  }

  // 2) Parse body
  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = {}; }
  }

  // 3) Validate
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return res.status(422).json({
      error: "Invalid input",
      details: parsed.error.flatten()
    });
  }

  // 4) Return stub (sen byter vi till Sheets)
  const result = await previewCalculateStub(parsed.data);
  return res.status(200).json(result);
}
