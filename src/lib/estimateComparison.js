/**
 * Estimate comparison — diff two estimate revisions for the conversational refine flow.
 *
 * Pure functions, no Gemini / no Prisma. Compares modules by baselineKey (NOT baselineName,
 * which is a display string and may collide or change). Produces a client-safe `comparison`
 * object: ranges, price deltas, and added / removed / changed module lists keyed by baselineKey
 * but carrying baselineName for display.
 *
 * Internal-only fields (internalRange, roleHours, calibration factors, etc.) are never read
 * or emitted here — only the client-visible estimateRange is compared.
 */

const ZERO_RANGE = { min: 0, max: 0, currency: "TWD" };

function num(value) {
  return Number.isFinite(value) ? value : 0;
}

function normalizeRange(range) {
  if (!range || typeof range !== "object") return { ...ZERO_RANGE };
  return {
    min: num(range.min),
    max: num(range.max),
    currency: typeof range.currency === "string" ? range.currency : "TWD",
  };
}

/**
 * Index modules by baselineKey. Modules without a baselineKey are skipped from the
 * keyed comparison (they cannot be reliably matched across revisions).
 *
 * @param {Array} modules
 * @returns {Map<string, object>}
 */
function indexByBaselineKey(modules) {
  const map = new Map();
  if (!Array.isArray(modules)) return map;
  for (const m of modules) {
    const key = m?.baselineKey;
    if (!key) continue;
    // If the same baselineKey appears twice (two distinct CRUD modules), aggregate
    // their estimateRange so the comparison reflects the full per-key contribution.
    const existing = map.get(key);
    if (existing) {
      const a = normalizeRange(existing.estimateRange);
      const b = normalizeRange(m.estimateRange);
      existing.estimateRange = {
        min: a.min + b.min,
        max: a.max + b.max,
        currency: a.currency,
      };
    } else {
      map.set(key, {
        baselineKey: key,
        baselineName: m.baselineName || key,
        estimateRange: normalizeRange(m.estimateRange),
      });
    }
  }
  return map;
}

function rangesDiffer(a, b) {
  const ra = normalizeRange(a);
  const rb = normalizeRange(b);
  return ra.min !== rb.min || ra.max !== rb.max;
}

/**
 * Build the comparison object between a previous and current estimate revision.
 *
 * @param {object} params
 * @param {object} params.previous - { snapshotId, revisionNumber, estimateRange, modules }
 * @param {object} params.current  - { snapshotId, revisionNumber, estimateRange, modules }
 * @returns {object} client-safe comparison
 */
export function buildEstimateComparison({ previous, current }) {
  const prevRange = normalizeRange(previous?.estimateRange);
  const currRange = normalizeRange(current?.estimateRange);

  const prevByKey = indexByBaselineKey(previous?.modules);
  const currByKey = indexByBaselineKey(current?.modules);

  const addedModules = [];
  const removedModules = [];
  const changedModules = [];

  // Added + changed: iterate current keys
  for (const [key, currMod] of currByKey.entries()) {
    const prevMod = prevByKey.get(key);
    if (!prevMod) {
      addedModules.push({
        baselineKey: key,
        baselineName: currMod.baselineName,
        estimateRange: currMod.estimateRange,
      });
    } else if (rangesDiffer(prevMod.estimateRange, currMod.estimateRange)) {
      changedModules.push({
        baselineKey: key,
        baselineName: currMod.baselineName || prevMod.baselineName,
        previousEstimateRange: prevMod.estimateRange,
        currentEstimateRange: currMod.estimateRange,
        changeType: "price_changed",
      });
    }
  }

  // Removed: keys in previous but not current
  for (const [key, prevMod] of prevByKey.entries()) {
    if (!currByKey.has(key)) {
      removedModules.push({
        baselineKey: key,
        baselineName: prevMod.baselineName,
        estimateRange: prevMod.estimateRange,
      });
    }
  }

  return {
    previousSnapshotId: previous?.snapshotId ?? null,
    previousRevisionNumber: previous?.revisionNumber ?? null,
    previousEstimateRange: prevRange,
    currentEstimateRange: currRange,
    priceDifference: {
      min: currRange.min - prevRange.min,
      max: currRange.max - prevRange.max,
    },
    addedModules,
    removedModules,
    changedModules,
  };
}

/**
 * Merge prior answers + free-form additional context into a single enhanced
 * requirements text block, appended to the original requirement summary.
 *
 * Blank-only answers are dropped. Used to feed parse-conversation on refine.
 *
 * @param {object} params
 * @param {string} [params.baseText]     - original requirement text to build on
 * @param {Array<{question?: string, answer?: string}>} [params.answers]
 * @param {string} [params.additionalContext]
 * @returns {string}
 */
export function buildEnhancedRequirementsText({ baseText = "", additionalContext = "", answers = [] } = {}) {
  const qaLines = (Array.isArray(answers) ? answers : [])
    .map((a) => {
      const question = typeof a?.question === "string" ? a.question.trim() : "";
      const answer = typeof a?.answer === "string" ? a.answer.trim() : "";
      if (!answer) return null; // drop blank-only answers
      return question ? `問題：${question}\n回答：${answer}` : `補充：${answer}`;
    })
    .filter(Boolean);

  const extra = typeof additionalContext === "string" ? additionalContext.trim() : "";
  const sections = [];

  const base = typeof baseText === "string" ? baseText.trim() : "";
  if (base) sections.push(base);

  if (qaLines.length > 0) {
    sections.push(`【補充問答】\n${qaLines.join("\n\n")}`);
  }
  if (extra) {
    sections.push(`【補充說明】\n${extra}`);
  }

  return sections.join("\n\n");
}

/**
 * Derive a plain-text summary from a requirementSpec for use as the base of the
 * enhanced requirements text on refine. Falls back gracefully across fields.
 *
 * @param {object|null} requirementSpec
 * @returns {string}
 */
export function summarizeRequirementSpec(requirementSpec) {
  if (!requirementSpec || typeof requirementSpec !== "object") return "";
  const lines = [];
  if (requirementSpec.projectType) lines.push(`專案類型：${requirementSpec.projectType}`);
  if (requirementSpec.businessGoal) lines.push(`商業目標：${requirementSpec.businessGoal}`);
  if (requirementSpec.clientIntent) lines.push(`客戶需求：${requirementSpec.clientIntent}`);
  if (Array.isArray(requirementSpec.requirements) && requirementSpec.requirements.length > 0) {
    const reqLines = requirementSpec.requirements
      .map((r) => (typeof r?.text === "string" ? r.text.trim() : ""))
      .filter(Boolean)
      .map((t) => `- ${t}`);
    if (reqLines.length > 0) lines.push(`需求項目：\n${reqLines.join("\n")}`);
  }
  if (!lines.length && typeof requirementSpec.conversationSummary === "string") {
    return requirementSpec.conversationSummary.trim();
  }
  return lines.join("\n");
}
