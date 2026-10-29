function buildOutputLanguageInstruction(useChinese) {
  return useChinese
    ? "IMPORTANT: You MUST write ALL text fields (timeline, confidence, confidenceHint, confidenceActions, breakdown labels and descriptions, assumptions, note, missingInfo) in Traditional Chinese (繁體中文). Do NOT use English in any of these fields."
    : "IMPORTANT: You MUST write ALL text fields (timeline, confidence, confidenceHint, confidenceActions, breakdown labels and descriptions, assumptions, note, missingInfo) in English. Do NOT use any other language in these fields, even if the project description is written in another language.";
}

/**
 * Prompt for the public rough estimate. The model scopes the work in hours;
 * the server turns hours into a price (see roughEstimatePricing.js), so the
 * model is deliberately not asked for a price.
 */
export function buildRoughEstimatePrompt({ description, useChinese, hasImages }) {
  const imageSummaryField = hasImages
    ? `  "imageSummary": "string (one paragraph describing the visual content of the attached images — list every module, feature, platform, and technology you can see)"`
    : `  "imageSummary": null`;

  return `
You are a senior software project estimator. Analyze the following project description and produce a rough quote preview.
Return ONLY a valid JSON object matching this exact schema — no markdown, no explanation.

Schema:
{
  "currency": "USD | TWD (the currency the client works in: use the currency of any stated rates or budget, otherwise TWD for Traditional Chinese briefs and USD for others)",
  "briefQuality": "clear | partial | vague (see rules)",
  "missingInfo": ["string (a concrete question; only when briefQuality is partial or vague, max 3, otherwise [])"],
  "statedHourlyRates": [{ "role": "string", "rate": "number (hourly, in the stated currency)" }] ,
  "statedBudget": { "amount": "number", "currency": "USD | TWD" },
  "timeline": "string (calendar duration, e.g. '4 – 6 weeks' or '4 – 6 週'; this is elapsed time, not effort)",
  "confidenceScore": "number (integer 55-92)",
  "confidence": "string (must include confidenceScore as percentage, e.g. 'Draft confidence 82%' or '初步估計信心度 82%')",
  "confidenceHint": "string | null (one short sentence; null when confidence is high)",
  "confidenceActions": ["string", "string", "string"],
  "breakdown": [
    {
      "label": "string (phase or module name, max 5 words)",
      "description": "string (one sentence)",
      "effortMinHours": "number (integer, working hours, low case)",
      "effortMaxHours": "number (integer, working hours, high case)"
    }
  ],
  "assumptions": ["string", "string", "string"],
  "note": "string (one short disclaimer sentence)",
${imageSummaryField}
}

Rules:
- Do NOT output a price. Output hours only; the price is computed from your hours.
- statedHourlyRates: copy ONLY hourly rates the brief explicitly states (one entry per role). If the brief states none, output []. Never invent rates.
- statedBudget: the client's budget ceiling if the brief states one, else null. NEVER adjust hours, scope, or assumptions to fit the budget; estimate the work honestly even when it exceeds the budget.
- breakdown must have 3–6 items, one per major module or phase actually named in the brief (e.g. booking system, payments, data import, redesign, QA/launch). Do not merge distinct modules into one item and do not add modules the brief did not ask for.
- effortMaxHours must be between 1.1× and 1.6× effortMinHours. Hours are effort, not calendar time; keep "timeline" as elapsed duration and do not derive one from the other by dividing by 40.
- Typical hours for a single-module project (add the hours of each module when there are several): simple landing page / brochure site 30–65h; basic web app or CMS 75–150h; e-commerce store 90–220h; complex platform or SaaS 180h and up. Include project management, design, and QA inside the module hours.
- breakdown descriptions MUST name specific technologies, platforms, and integrations that the brief mentions or that are standard for the task (e.g. "Stripe Billing", "FB/IG API", "RAG 知識庫"). Generic labels like "後端開發" alone are not acceptable.
- briefQuality: "clear" when features, platforms, and constraints are specific; "partial" when some key facts are missing; "vague" when the brief is a one-liner or names no concrete features (e.g. "Need a website"). For "vague", keep breakdown generic and set confidenceScore to 55–62.
- assumptions must have exactly 3 items. Choose the three unresolved items that most affect price or schedule, preferring ones the brief itself raises: missing content or assets (copy, photos, data), key-person or handover risks, and ambiguous scope such as one-off versus recurring payments, third-party accounts, or data quality. State each as a risk or assumption, not as a confirmed requirement.
- Never state that a requirement, integration, or delivery date is confirmed unless the brief says so.
- confidenceScore must reflect requirement clarity, not a default value. Increase it when scope is specific; decrease it when scope is vague, highly complex, or missing key constraints.
- if confidenceScore >= 82: set confidenceHint to null and confidenceActions to [].
- if confidenceScore is 72-81: provide confidenceHint + up to 2 confidenceActions.
- if confidenceScore <= 71: provide confidenceHint + up to 3 confidenceActions.
- ${buildOutputLanguageInstruction(useChinese)}

Project description:
${description || "(see attached images)"}
`.trim();
}
