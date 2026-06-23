/**
 * Builds the prompt for POST /api/ai/analyze (analyzeRequirements).
 *
 * @param {object} params
 * @param {string} params.normalizedProjectType
 * @param {string} params.normalizedRequirements
 * @param {string} params.normalizedTemplateContext
 * @param {boolean} params.isMaterialHeavyProject
 * @returns {string}
 */
export function buildAnalyzePrompt({
  normalizedProjectType,
  normalizedRequirements,
  normalizedTemplateContext,
  isMaterialHeavyProject,
}) {
  return `
Please analyze these project requirements and attached screenshots. Your primary output is a client-ready proposal draft comparable to a polished first-stage project proposal deck. Also include quote items as a pricing appendix.
Return the result EXCLUSIVELY as a valid JSON object.

Important Instructions:
1. **Language**: All text content (summary, description, material names, units, etc.) MUST be in **Traditional Chinese (Taiwan)** (繁體中文).
2. **Proposal-first output**:
   - Do NOT compress the screenshot content into 3-4 generic engineering tasks.
   - Extract the actual product logic, module names, stage boundaries, exclusions, timeline, payment logic, and operating cost assumptions from the screenshots.
   - The proposalDraft must be the most detailed part of the response.
3. **Financials — assess the scope tier FIRST, then assign hours and rates**:
   - Read the full requirements, count the distinct modules, identify integrations, and determine the project tier before writing a single number.
   - PRICING TIERS (use these as firm anchors; do not skip tiers without clear scope justification):
     * Tier 1 · Simple (brochure / landing page, 1–4 pages, no custom backend):
         Items: 3–4 | Total: NT$50,000–130,000 | Total service hours: ≤ 80hr | Timeline: 2–4 weeks
     * Tier 2 · Basic web app (CMS, blog, simple CRUD, standard auth, < 5 features):
         Items: 4–7 | Total: NT$150,000–400,000 | Timeline: 4–10 weeks
     * Tier 3 · Standard platform (e-commerce, booking system, multi-role app, payments, 5–8 modules):
         Items: 6–9 | Total: NT$400,000–1,200,000 | Timeline: 2–4 months
     * Tier 4 · Complex platform (SaaS, CRM, multi-tenant, AI workflow, internal tool, 8–12 modules):
         Items: 8–12 | Total: NT$1,200,000–3,500,000 | Timeline: 4–8 months
     * Tier 5 · Enterprise AI platform (multi-platform AI content, RAG, multi-social API integration, full DevOps, 12+ modules):
         Items: 10–14 | Total: NT$3,500,000–7,000,000 | Timeline: 6–12 months
   - A simple landing page with a contact form is Tier 1 even if it has animations. Do NOT inflate it to Tier 2–3.
   - A standard e-commerce site with auth, cart, and payments is Tier 3, not Tier 4.
   - Only reach Tier 5 when the scope genuinely includes 12+ modules, AI workflow, multi-platform social API integration, and enterprise DevOps together.
   - Hourly rate guidelines by role (apply lower end for Tier 1–2; upper end only for Tier 4–5):
     * PM / QA: NT$1,000–1,400/hr
     * Frontend / UX/UI: NT$1,200–1,600/hr
     * Backend: NT$1,300–1,800/hr
     * AI / DevOps / Integration: NT$1,400–2,000/hr
   - "amount" MUST equal "estimatedHours" × "hourlyRate". Do NOT return 0 for rates or amounts.
   - For material items, "hourlyRate" means unit price.
   - **Tier 1 overhead rule**: For Tier 1 projects, do NOT create separate PM, QA, or DevOps line items. Fold any minor testing and deployment effort into the existing frontend/design items. A static site must not have more than 4 items, and total hours must stay within the 80hr cap.
   - **No invented scope**: Only include items that the requirements explicitly state or clearly imply. If the requirements say "no backend", "static only", or "no custom DB", do NOT add backend or server items.
   - **No operational costs in quote items**: Do NOT include hosting fees, server rental, domain costs, API usage fees, cloud credits, or any recurring operational expense as a development line item. If relevant, mention them in proposalDraft.ongoingFees only.
4. **Quote Item Classification**:
   - Each item MUST include "type": "service" or "material".
   - "service" = labor, design, planning, project management, engineering, testing, installation, software licenses, cloud/API setup allowances, third-party service setup, or any work billed by effort.
   - "material" = ONLY physical products, hardware, building materials, wiring, tiles, lighting, fixtures, appliances, furniture, or consumables.
   - Do NOT classify cloud hosting, API usage, SaaS subscriptions, AI credits, or platform fees as "material" — use "service" and name them as third-party/usage allowances.
   - Item count must match the tier range above. Do NOT pad simple projects with extra items to make the quote look bigger.
   - Only include items that the requirements explicitly state or clearly imply. Do NOT invent scope to reach the tier's maximum item count.
   - Quote item descriptions must be complete readable line items, not comma-separated feature dumps.
   - Use practical role categories: "PM", "UX/UI", "Frontend", "Backend", "AI / Automation", "API Integration", "DevOps", "QA".
5. **Service Item Rules**:
   - "suggestedRole": "pm", "design", "frontend", "backend", "qa", "ai", "integration", "devops", "content", or "other".
   - "unit" should be null or empty string.
6. **Material Item Rules**:
   - "suggestedRole" should be the material name or category in Traditional Chinese, not a staff role.
   - "estimatedHours" represents quantity.
   - "unit" MUST be a practical quantity unit: "式", "組", "件", "支", "才", "片", "箱", "桶", "公尺", "平方公尺", "盞", "座".
7. **Source Evidence Rules**:
   - Every item should include "sourceEvidence": a verbatim excerpt from the user's input that supports this line item.
   - Do NOT paraphrase or summarize — copy the original words exactly.
   - If the item is inferred from standard project practice (not directly stated in the input), set "sourceEvidence" to null.
   - If the input is a LINE/email/meeting transcript, quote the most relevant sentence(s). Multiple short sentences may be joined with " / ".
   - Do not fabricate evidence. If no clear source exists in the input, use null.
8. **Interior / Construction Projects**:
   - Separate labor/service items and material items.
   - Return at least 2 material items when physical materials are implied, unless the user says labor only.

JSON Structure:
{
  "summary": "string (Short summary in Traditional Chinese)",
  "expectedDays": "number | null",
  "items": [
    {
      "id": "string (e.g., ai_1)",
      "type": "service" | "material",
      "description": "string (Task or material description in Traditional Chinese)",
      "estimatedHours": number,
      "suggestedRole": "string",
      "unit": "string | null",
      "hourlyRate": number,
      "amount": number,
      "sourceEvidence": "string | null"
    }
  ],
  "proposalDraft": {
    "coverTitle": "string",
    "subtitle": "string",
    "executiveSummary": "string",
    "positioning": "string",
    "priceSummary": "string",
    "timelineSummary": "string",
    "feeBoundary": "string",
    "businessModel": ["string"],
    "painPoints": ["string"],
    "coreWorkflow": ["string"],
    "modules": [
      {
        "id": "string (e.g. M1)",
        "title": "string",
        "bullets": ["string", "string", "string"]
      }
    ],
    "includedScope": ["string"],
    "excludedScope": ["string"],
    "futureExpansion": ["string"],
    "technicalStrategy": ["string"],
    "timeline": [
      { "title": "string", "duration": "string", "detail": "string" }
    ],
    "pricingStrategy": ["string"],
    "paymentMilestones": [
      { "stage": "string", "percentage": 30, "trigger": "string" }
    ],
    "ongoingFees": ["string"],
    "testingCategories": [
      { "name": "string", "description": "string" }
    ],
    "uatSteps": [
      { "title": "string", "duration": "string", "responsible": "我方 | 業主 | 雙方" }
    ],
    "maintenanceTiers": [
      { "tier": "Basic | Standard | Premium", "monthlyFee": "string", "hoursPool": "string", "regularSla": "string", "criticalSla": "string" }
    ],
    "contractProtection": ["string"],
    "nextSteps": [
      { "step": "string", "detail": "string", "timing": "string" }
    ],
    "conclusion": "string",
    "keyTakeaways": ["string"],
    "risks": [
      { "risk": "string (風險描述)", "mitigation": "string (緩解措施)" }
    ]
  },
  "missingQuestions": [
    {
      "question": "string (繁體中文，具體問題)",
      "whyItMatters": "string (說明為什麼這題會影響報價、範圍、工期或風險)",
      "priceImpact": "high | medium | low"
    }
  ],
  "assumptions": ["string (繁體中文，AI 在資訊不足時做出的報價假設)"],
  "confidenceScore": "number (55–92 的整數)"
}

Missing Questions & Confidence Rules:
- **missingQuestions**: 只列出「報價前最影響價格、範圍、工期或風險」的問題。
  - 不要產生泛泛的問題，例如：「請問還有其他需求嗎？」「請提供更多資訊」
  - 問題必須具體，例如：
    * 是否需要會員登入與權限管理？
    * 是否需要第三方金流串接（如綠界、Stripe）？
    * 是否需要後台管理介面？
    * 是否需要第三方 API 串接（如 LINE、Google、社群平台）？
    * 是否需要 RWD（行動裝置適配）？
    * 是否需要多語系支援？
    * 是否需要推播通知（App push / Email / SMS）？
    * 是否需要報表或數據分析功能？
  - 每個問題的 whyItMatters 必須說明具體的報價影響（例如：「需要金流串接會增加後端安全性驗證工作量，影響 20–40 小時」）。
  - priceImpact 只能是 high、medium、low，不可為其他值。
  - 需求已明確提及的功能不需要再列入 missingQuestions。
  - 若需求已非常完整，missingQuestions 可為空陣列。
- **assumptions**: AI 在資訊不足時做出的合理報價假設（例如：「假設不含金流串接」「假設使用繁體中文介面」）。
  - 若需求完整，assumptions 可為空陣列。
- **confidenceScore**: 55–92 的整數，反映對這份需求的報價把握程度。
  - 完整規格、需求明確：75–92
  - 資訊部分齊全、有數個不確定點：62–75
  - 一句話需求、凌亂對話、資訊嚴重不足：55–62
  - 分數必須根據資訊品質評估，不可使用固定預設值。

Proposal Draft Rules:
- Treat screenshots as source material, not decoration. Infer the project/product logic from them.
- The proposalDraft should resemble a polished first-stage build proposal, with clear scope, boundaries, timeline, pricing logic, payment milestones, and next-stage expansion.
- If screenshots show module names/features, preserve their module structure and rewrite it into implementation-oriented proposal language.
- Avoid generic headings such as "我們深入理解了您的需求" as actual content. Use project-specific titles and bullets.
- Be explicit about third-party API / AI / cloud / usage fees when relevant.
- Include enough sections to form 10-13 slides when the input contains enough information.
- Keep proposalDraft in Traditional Chinese (Taiwan), concise but complete enough to generate slides.
- paymentMilestones: generate 4-6 structured stages with realistic percentages summing to 100 (e.g. 30% sign, 20% design, 20% mid-dev, 15% UAT, 10% acceptance, 5% mid-warranty).
- testingCategories: list 6-10 major testing areas relevant to the project (e.g. 功能測試, 權限/多租戶, AI生成測試, 效能測試, 安全性測試, 瀏覽器裝置).
- uatSteps: describe 5-8 concrete UAT stages with durations and responsible party (我方/業主/雙方).
- maintenanceTiers: always provide 3 tiers (Basic, Standard, Premium) with realistic monthly fees and SLA.
- contractProtection: 6-10 clear contract protection clauses relevant to this type of project.
- nextSteps: 4-6 clear action steps after proposal acceptance, each with a short detail and rough timing.
- **Consistency rule**: The priceSummary must reflect the actual total of the items array. Do not claim a price in the proposal that does not match the quoted items. The scope described in the proposal must not include features that have no corresponding quote item.
- **risks**: Provide 3–6 project-specific risks with concrete mitigations. Risks must be relevant to this project type (e.g. third-party API availability, scope creep, timeline risk, data security, technology dependency). Do NOT write generic risks like "project may fail". Each mitigation must be actionable.

Project Type Hint:
${normalizedProjectType || "Not specified"}
${isMaterialHeavyProject ? "This request likely requires explicit material line items." : "This request may be service-only unless materials are clearly implied."}

Quote Template Context:
${normalizedTemplateContext || "No selected quote template context."}

User Requirements:
${normalizedRequirements || "No additional user-entered requirements."}
`;
}
