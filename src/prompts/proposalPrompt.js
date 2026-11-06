/**
 * Builds the prompt that writes a client-ready proposal from an existing quote.
 *
 * The quote is the source of truth: line items, hours, amounts, timeline and
 * payment terms come from it. The model writes the narrative around them.
 *
 * @param {object} params
 * @param {object} params.quote   - { customerName, projectName, description, projectType, expectedDays, validityDays, paymentTerms, totalAmount }
 * @param {Array}  params.items   - [{ description, suggestedRole, estimatedHours, amount }]
 * @param {object|null} params.provider - { name, about, proof[] } written by the user, or null when not configured
 * @param {string|null} params.requirementContext - structured reading of the client's request (JSON text)
 * @param {string} params.locale  - "en" for English, anything else for Traditional Chinese (Taiwan)
 * @returns {string}
 */
export function buildProposalPrompt({ quote, items, locale, provider = null, requirementContext = null }) {
  const english = String(locale || "").trim().toLowerCase().startsWith("en");
  const language = english
    ? "English"
    : "Traditional Chinese (Taiwan) (繁體中文), natural business Mandarin, not machine-translated";

  const source = {
    client: quote.customerName || null,
    project: quote.projectName || null,
    brief: quote.description || null,
    projectType: quote.projectType || null,
    expectedDays: quote.expectedDays || null,
    quoteValidityDays: quote.validityDays || null,
    paymentTermsOnQuote: quote.paymentTerms || null,
    totalAmount: Math.round(Number(quote.totalAmount || 0)),
    currency: "TWD",
    lineItems: items.map((item, index) => ({
      index,
      description: item.description,
      role: item.suggestedRole || null,
      hours: item.estimatedHours ?? null,
      amount: Math.round(Number(item.amount || 0)),
    })),
  };

  const providerBlock = provider
    ? `
PROVIDER (written by the user; the only company facts you may use)
${JSON.stringify(provider, null, 2)}
`
    : "";
  const requirementBlock = requirementContext
    ? `
CLIENT REQUEST ANALYSIS (what the client actually asked for; use it to make the proposal specific)
${requirementContext}
`
    : "";

  return `
You are a senior delivery lead writing a client-ready proposal for a software or digital-services project.
The quote below is final. Your job is to write the proposal around it, so the client understands what they are buying, why it is scoped this way, and what happens next.

OUTPUT: only one valid JSON object, no markdown, no commentary.
LANGUAGE: write every string value in ${language}.

GROUNDING RULES
- Use only facts in the quote JSON. Never invent client history, past results, team size, tools, statistics or guarantees.
- Anything you have to assume (platform, integrations, content supplied by the client) goes into "assumptions" style wording inside excludedScope or risks, not stated as fact.
- The provider block is the only source for statements about the delivery company. ${provider ? "Reflect its strengths where they genuinely fit this project (for example in positioning and risk mitigations), and never add experience, clients, results or team details that it does not state." : "No provider profile is configured: write nothing about the company's experience, past clients, team, certifications or track record. Write only from the quote."}
- Do not change the total, the line items or the hours. Do not put per-item prices in the narrative; refer to the quote for numbers.
- If paymentTermsOnQuote is given, paymentMilestones must follow it exactly (same percentages and triggers). Otherwise propose a fair schedule that sums to 100.
- If expectedDays is given, the timeline phases must add up to roughly that duration. Otherwise give ranges.

QUALITY RULES
- Specific over generic. Name the actual features from the line items and brief. Avoid filler such as "high quality", "seamless", "cutting-edge".
- executiveSummary: 2-3 sentences covering the goal, what will be delivered first, and the outcome for the client.
- painPoints: 3-5 problems this client is likely facing, inferred from the brief. Write them from the client's point of view.
- coreWorkflow: 4-6 steps of how the finished product is used, in order.
- modules: group the line items into 3-6 deliverable modules. Each has 3-4 bullets describing concrete deliverables.
- includedScope / excludedScope: concrete and testable. Excluded scope should prevent the most likely disputes for this project type.
- futureExpansion: 2-4 sensible later phases.
- risks: 3-5 risks specific to this project, each with a mitigation that the delivery team controls.
- nextSteps: 3-4 steps with timing, starting with confirming scope and signing.
- keyTakeaways: exactly 3 short points.
- options: 2 or 3 packages the client can choose between, each made only of lineItems (list their "index" values in itemIndexes). The largest package must contain every item. Smaller packages drop only items that can genuinely be postponed. Every package must work on its own: before dropping an item, read the remaining items' descriptions and check whether any of them operates on, validates, fulfils, reports on or manages what the dropped item produces (for example, a staff back office that validates redemptions cannot ship without the rewards catalog it validates; a dashboard needs the data source it displays). If an item depends on a dropped one, drop both or keep both; when unsure, keep it. Every package keeps the testing/QA, launch/deployment and project-management items. A package summary may only mention what its own items contain, never a feature that none of them describes. Mark exactly one package "recommended": true. If the quote has fewer than 3 line items or nothing can sensibly be postponed, return an empty array. Do not write prices; they are computed from the items.
- Keep sentences short. No emojis.

QUOTE:
${JSON.stringify(source, null, 2)}
${providerBlock}${requirementBlock}
OUTPUT SCHEMA:
{
  "proposalDraft": {
    "coverTitle": "string (project title, 4-9 words)",
    "subtitle": "string (one line: for whom and what)",
    "executiveSummary": "string",
    "positioning": "string (one sentence on how the work is scoped and why)",
    "painPoints": ["string"],
    "coreWorkflow": ["string"],
    "modules": [{ "id": "M1", "title": "string", "bullets": ["string"] }],
    "includedScope": ["string"],
    "excludedScope": ["string"],
    "futureExpansion": ["string"],
    "timeline": [{ "title": "string", "duration": "string", "detail": "string" }],
    "timelineSummary": "string",
    "paymentMilestones": [{ "stage": "string", "percentage": 30, "trigger": "string" }],
    "ongoingFees": ["string (hosting, licences, third-party usage that the client pays separately)"],
    "feeBoundary": "string (what the quoted price does not cover)",
    "testingCategories": [{ "name": "string", "description": "string" }],
    "risks": [{ "risk": "string", "mitigation": "string" }],
    "nextSteps": [{ "step": "string", "detail": "string", "timing": "string" }],
    "conclusion": "string (2 sentences)",
    "keyTakeaways": ["string", "string", "string"],
    "options": [{ "name": "string (e.g. Essentials)", "summary": "string (one sentence on who it suits)", "itemIndexes": [0, 1], "recommended": false }]
  }
}
`.trim();
}
