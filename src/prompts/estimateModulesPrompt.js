/**
 * Builds the prompt for POST /api/ai/estimate-modules.
 *
 * AI's job: map requirements to baseline modules and judge complexity.
 * AI must NOT output any hours or prices — those are computed by code.
 *
 * @param {object} params
 * @param {object} params.requirementSpec  - Output from parse-conversation
 * @param {Array}  params.baselines        - Available baseline modules (deprecated ones already filtered out)
 * @returns {string}
 */
export function buildEstimateModulesPrompt({ requirementSpec, baselines }) {
  // Filter deprecated baselines — they exist only for backward compat with historical snapshots
  const activeBaselines = baselines.filter((b) => !b.deprecated);

  const baselineList = activeBaselines
    .map((b) => {
      const parts = [`- ${b.baselineKey}: ${b.name}（${b.description}）`];
      if (b.defaultComplexity) parts.push(`  預設複雜度: ${b.defaultComplexity}`);
      if (Array.isArray(b.assumptions) && b.assumptions.length > 0) {
        parts.push(`  包含: ${b.assumptions.join("；")}`);
      }
      if (Array.isArray(b.exclusions) && b.exclusions.length > 0) {
        parts.push(`  不含: ${b.exclusions.join("；")}`);
      }
      if (Array.isArray(b.missingInfo) && b.missingInfo.length > 0) {
        parts.push(`  需確認: ${b.missingInfo.join("；")}`);
      }
      if (b.riskBuffer) {
        parts.push(`  ⚠ 風險係數: 已內建 ${Math.round(b.riskBuffer * 100)}% buffer`);
      }
      return parts.join("\n");
    })
    .join("\n");

  const requirementList = Array.isArray(requirementSpec?.requirements)
    ? requirementSpec.requirements
        .map((r) => `[${r.id}] (${r.status}) ${r.text}`)
        .join("\n")
    : "(no requirements)";

  return `
You are a senior software architect. Based on the project requirements below, break the project down into functional modules and map each module to the most relevant baseline entry from the provided list.

YOUR OUTPUT MUST BE ONLY a valid JSON object — no markdown, no explanation.
DO NOT output any hours, rates, or prices. Those are calculated by code.

AVAILABLE BASELINES:
${baselineList}

PROJECT CONTEXT:
- Project Type: ${requirementSpec?.projectType || "Not specified"}
- Business Goal: ${requirementSpec?.businessGoal || "Not specified"}
- Platforms: ${(requirementSpec?.platforms || []).join(", ") || "Not specified"}
- Client Intent: ${requirementSpec?.clientIntent || "Not specified"}

REQUIREMENTS:
${requirementList}

ASSUMPTIONS IN EFFECT:
${(requirementSpec?.assumptions || []).map((a) => `- ${a}`).join("\n") || "None"}

OUTPUT SCHEMA:
{
  "modules": [
    {
      "id": "string (e.g. M1, M2)",
      "name": "string (繁體中文，模組名稱)",
      "description": "string (繁體中文，一句話描述此模組的交付範圍)",
      "features": ["string (繁體中文，此模組包含的功能點)"],
      "requirementIds": ["string (requirement ids this module addresses, e.g. ['R1','R3'])"],
      "baselineKey": "string (the single most relevant baselineKey from the list above)",
      "complexity": "simple | standard | complex",
      "complexityReason": "string (繁體中文，一句話說明判斷複雜度的理由)",
      "confidence": 0.0
    }
  ],
  "unmappedRequirements": ["string (requirement ids that could not be mapped to any module)"],
  "overallComplexity": "simple | standard | complex",
  "estimationNotes": "string (繁體中文，整體估算備注，例如特殊整合風險、建議分期的說明)"
}

RULES:
1. Each module must map to exactly ONE baselineKey. Choose the closest match; do not invent new keys.
2. A single baseline can be used for multiple modules if they are genuinely distinct (e.g. two separate CRUD modules).
3. complexity must reflect the SPECIFIC requirements vs the baseline default:
   - simple: requirements are simpler than the baseline describes (fewer edge cases, smaller scope)
   - standard: requirements match the baseline closely
   - complex: requirements add significant complexity vs the baseline (custom logic, deep integrations, many edge cases)
   Use the baseline's "預設複雜度" as a reference starting point.
4. confidence (0.0–1.0): how certain you are about this module mapping and complexity, based on requirement clarity.
5. requirementIds: list ALL requirement IDs this module addresses.
6. DO NOT add modules for features not mentioned in the requirements or assumptions.
7. DO NOT output estimatedHours, roleHours, hourlyRate, amount, or any numeric cost/time values.
8. All text fields in Traditional Chinese (繁體中文).

TIER SELECTION GUIDE — WEBSITE (MUST READ BEFORE PICKING):
Follow these steps in order. STOP as soon as one matches.

  STEP 1 — Single-page check:
    Is the entire site a single marketing/landing page with no backend at all?
    YES → landing_page_simple. STOP.

  STEP 2 — CMS check:
    Does the client need to update their own content (news, articles, product pages, blog)?
    NO  → corporate_site_static. Add missingInfo: 「是否需要客戶自行更新網站內容（文章/圖片）？」STOP.
    YES → client needs CMS. Continue to STEP 3.

  STEP 3 — Complexity scoring (CMS is confirmed):
    Count how many of these complexity signals are explicitly present:
      ① 多語系 / multilingual / i18n / language switcher
      ② SEO 深度設定 / sitemap / structured data / meta optimization
      ③ 表單通知 / email notifications triggered by forms
      ④ CI/CD 部署 / DevOps / staging environment / production pipeline
      ⑤ 複雜動畫 / interactive effects / GSAP / scroll-triggered animations
      ⑥ 第三方系統串接 / external API integration / webhook / ERP/CRM sync

    Score ≥ 3 signals → corporate_site_advanced
    Score < 3 signals → corporate_site_with_cms
      + add missingInfo for each unconfirmed signal (e.g. 「是否需要多語系？」「是否需要 SEO 設定？」)

STRICT RULES — WEBSITE:
- NEVER pick corporate_site_with_cms without explicit CMS / client content editing mentioned.
- NEVER pick corporate_site_advanced without CMS confirmed AND score ≥ 3 signals.
- "做個官網" with no further context → corporate_site_static + ask CMS question.
- Borderline cases → LOWER tier + missingInfo. Better to under-estimate and ask than to over-select advanced.

TIER SELECTION GUIDE — EMAIL (MUST READ BEFORE PICKING):
- Requirements only mention contact form or a single notification → email_basic (add-on, very small)
- Requirements mention multiple email types (welcome, reset password, order confirmation) OR template design → email_transactional
- Requirements mention queue, retry, delivery tracking, logs, or bulk reliability → email_queue_advanced

STRICT RULES — EMAIL:
- Do NOT select email_transactional for a simple "contact form sends email" case → use email_basic.
- Do NOT select email_queue_advanced unless queue or retry is explicitly needed.

PHASED PROJECTS NOTE:
For large projects (SaaS, mobile app) that could be split into phases: estimate the FULL v1 scope described, and note phasing in estimationNotes only (e.g. "建議分兩期：Phase 1 為核心功能，Phase 2 為報表與進階設定"). Do NOT artificially reduce scope.
`;
}
