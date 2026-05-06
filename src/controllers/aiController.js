import prisma from "../lib/prisma.js";
import {
  extractGeminiRetryAfterSeconds,
  extractGeminiStatusCode,
  generateGeminiJsonText,
  getGeminiClient,
  getGeminiModelName,
  hasGeminiApiKey,
  isGeminiTemporaryStatus as isGeminiRetryableStatus,
  normalizeJsonResponse,
} from "../lib/gemini.js";

const DEFAULT_AI_RETRY_AFTER_SECONDS = 20;
const CONFIDENCE_SCORE_MIN = 62;
const CONFIDENCE_SCORE_MAX = 92;
const ROUGH_ESTIMATE_MAX_DESCRIPTION_CHARS = readPositiveIntEnv(
  "ROUGH_ESTIMATE_MAX_DESCRIPTION_CHARS",
  1400,
);
const ROUGH_ESTIMATE_DAILY_LIMIT = readPositiveIntEnv(
  "ROUGH_ESTIMATE_DAILY_LIMIT",
  0,
);
const ROUGH_ESTIMATE_QUEUE_WAIT_MS = readPositiveIntEnv(
  "ROUGH_ESTIMATE_QUEUE_WAIT_MS",
  4_500,
);
const ANALYZE_QUEUE_WAIT_MS = readPositiveIntEnv(
  "ANALYZE_QUEUE_WAIT_MS",
  12_000,
);
const TRANSLATE_QUEUE_WAIT_MS = readPositiveIntEnv(
  "TRANSLATE_QUEUE_WAIT_MS",
  12_000,
);
const REFINE_QUEUE_WAIT_MS = readPositiveIntEnv(
  "REFINE_QUEUE_WAIT_MS",
  12_000,
);
const roughEstimateUsageByWindow = new Map();

function readPositiveIntEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function getCurrentUsageWindowKey(now = Date.now()) {
  return Math.floor(now / 86_400_000);
}

function getSecondsUntilNextUsageWindow(now = Date.now()) {
  const nextWindowAt = (getCurrentUsageWindowKey(now) + 1) * 86_400_000;
  return Math.max(1, Math.ceil((nextWindowAt - now) / 1000));
}

function getClientFingerprint(req) {
  const forwardedFor = req.headers["x-forwarded-for"];
  if (typeof forwardedFor === "string" && forwardedFor.trim().length > 0) {
    return forwardedFor.split(",")[0].trim();
  }

  return req.ip || req.socket?.remoteAddress || "anonymous";
}

function createRoughEstimateQuota(req) {
  if (ROUGH_ESTIMATE_DAILY_LIMIT <= 0) {
    return { allowed: true, commit() {} };
  }

  const now = Date.now();
  const windowKey = String(getCurrentUsageWindowKey(now));
  for (const key of roughEstimateUsageByWindow.keys()) {
    if (!key.startsWith(`${windowKey}:`)) {
      roughEstimateUsageByWindow.delete(key);
    }
  }

  const fingerprint = getClientFingerprint(req);
  const quotaKey = `${windowKey}:${fingerprint}`;
  const usedCount = roughEstimateUsageByWindow.get(quotaKey) ?? 0;
  let committed = false;

  return {
    allowed: usedCount < ROUGH_ESTIMATE_DAILY_LIMIT,
    retryAfterSeconds: getSecondsUntilNextUsageWindow(now),
    commit() {
      if (committed || usedCount >= ROUGH_ESTIMATE_DAILY_LIMIT) {
        return;
      }

      roughEstimateUsageByWindow.set(quotaKey, usedCount + 1);
      committed = true;
    },
  };
}

function getDailyLimitMessage(useChinese, retryAfterSeconds) {
  if (useChinese) {
    return `今日免費試用次數已用完，約 ${retryAfterSeconds} 秒後會重置。`;
  }

  return `Today's free trial limit has been reached. It resets in about ${retryAfterSeconds} seconds.`;
}

function getDescriptionTooLongMessage(useChinese, maxChars) {
  if (useChinese) {
    return `描述內容過長，請精簡至 ${maxChars} 字內，或改用正式需求分析流程。`;
  }

  return `The description is too long. Please shorten it to ${maxChars} characters or move to the full analysis flow.`;
}

function getBusyMessage(useChinese, retryAfterSeconds) {
  if (useChinese) {
    return `AI 目前請求量較高，請約 ${retryAfterSeconds} 秒後再試一次。`;
  }

  return `AI capacity is currently busy. Please retry in about ${retryAfterSeconds} seconds.`;
}

function getUnavailableMessage(useChinese) {
  if (useChinese) {
    return "AI 服務暫時不穩定，請稍後再試。";
  }

  return "AI service is temporarily unavailable. Please try again shortly.";
}

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function hasChineseText(text) {
  return /[\u3400-\u9fff]/.test(text || "");
}

function extractConfidenceScore(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return clampNumber(
      Math.round(value),
      CONFIDENCE_SCORE_MIN,
      CONFIDENCE_SCORE_MAX,
    );
  }

  if (typeof value === "string") {
    const match = value.match(/(\d{1,3})\s*%?/);
    if (match) {
      return clampNumber(
        Number.parseInt(match[1], 10),
        CONFIDENCE_SCORE_MIN,
        CONFIDENCE_SCORE_MAX,
      );
    }
  }

  return null;
}

function estimateHeuristicConfidence({
  description,
  hasImage,
  breakdownCount,
  assumptionsCount,
}) {
  const text = description || "";
  const normalized = text.toLowerCase();
  let score = 66;

  const length = text.length;
  if (length >= 420) score += 12;
  else if (length >= 260) score += 10;
  else if (length >= 160) score += 8;
  else if (length >= 90) score += 6;
  else if (length >= 40) score += 4;
  else if (length >= 20) score += 2;
  else score -= 6;

  const punctuationCount = (text.match(/[，,、\n;；]/g) || []).length;
  if (punctuationCount >= 8) score += 4;
  else if (punctuationCount >= 4) score += 2;

  if (/\d/.test(text)) score += 2;
  if (hasImage) score += 4;

  const explicitMarkers = [
    "api",
    "integration",
    "payment",
    "auth",
    "admin",
    "dashboard",
    "database",
    "sso",
    "rbac",
    "ios",
    "android",
    "金流",
    "串接",
    "登入",
    "後台",
    "資料庫",
    "上線",
    "權限",
    "行動",
    "app",
    "web",
    "mobile",
    "timeline",
    "budget",
    "測試",
    "驗收",
    "部署",
    "維運",
  ];
  const markerHits = explicitMarkers.filter((marker) => normalized.includes(marker)).length;
  score += Math.min(Math.round(markerHits * 1.2), 9);

  const vagueMarkers = [
    "類似",
    "大概",
    "先做",
    "之後再",
    "等等",
    "something",
    "etc",
    "maybe",
    "tbd",
    "not sure",
    "不確定",
  ];
  const vagueHits = vagueMarkers.filter((marker) => normalized.includes(marker)).length;
  score -= Math.min(Math.round(vagueHits * 1.5), 6);

  const highComplexityMarkers = [
    "uber",
    "airbnb",
    "multi-tenant",
    "marketplace",
    "real-time",
    "即時",
    "雙端",
    "派單",
    "多租戶",
  ];
  const complexityHits = highComplexityMarkers.filter((marker) =>
    normalized.includes(marker),
  ).length;

  if (complexityHits >= 2 && length < 180) {
    score -= 4;
  }

  if (complexityHits >= 3 && length < 120) {
    score -= 5;
  }

  if (breakdownCount >= 4) score += 2;
  else if (breakdownCount === 3) score += 1;
  else if (breakdownCount <= 2) score -= 4;

  if (assumptionsCount === 3) score += 2;
  else if (assumptionsCount < 2) score -= 2;

  return clampNumber(score, CONFIDENCE_SCORE_MIN, CONFIDENCE_SCORE_MAX);
}

function formatConfidence(score, description, rawConfidence) {
  const useChinese = hasChineseText(rawConfidence) || hasChineseText(description);
  return useChinese
    ? `初步估計信心度 ${score}%`
    : `Draft confidence ${score}%`;
}

function hasAnyKeyword(text, keywords) {
  return keywords.some((keyword) => text.includes(keyword));
}

function buildConfidenceGuidance({
  score,
  description,
  hasImage,
  useChinese,
}) {
  const normalized = (description || "").toLowerCase();
  const detailLength = description.trim().length;
  const confidenceLevel = score >= 82 ? "high" : score >= 72 ? "medium" : "low";
  const actions = [];

  const addAction = (zhText, enText) => {
    if (actions.length >= 3) return;
    actions.push(useChinese ? zhText : enText);
  };

  const hasScopeSignals = hasAnyKeyword(normalized, [
    "feature",
    "module",
    "page",
    "screen",
    "flow",
    "功能",
    "模組",
    "頁面",
    "流程",
    "角色",
  ]);
  const hasTechSignals = hasAnyKeyword(normalized, [
    "api",
    "integration",
    "payment",
    "auth",
    "database",
    "framework",
    "stack",
    "串接",
    "金流",
    "登入",
    "資料庫",
    "技術",
  ]);
  const hasConstraintSignals = hasAnyKeyword(normalized, [
    "timeline",
    "deadline",
    "budget",
    "week",
    "month",
    "launch",
    "時程",
    "交期",
    "預算",
    "上線",
    "驗收",
  ]);

  if (!hasScopeSignals || detailLength < 120) {
    addAction(
      "補上主要功能、頁面流程與使用角色，報價信心會明顯提高。",
      "Add key features, core flows, and user roles to improve confidence.",
    );
  }

  if (!hasTechSignals) {
    addAction(
      "補充第三方串接或技術限制（例如金流、登入、資料來源）。",
      "Include integrations or technical constraints (payment, auth, data source).",
    );
  }

  if (!hasConstraintSignals) {
    addAction(
      "提供預計時程或預算區間，能縮小估價區間並提升可信度。",
      "Share timeline or budget range to narrow estimate spread.",
    );
  }

  if (!hasImage) {
    addAction(
      "若有截圖或規格文件，建議上傳，通常可再提高信心度。",
      "Upload a screenshot/spec if available to improve confidence further.",
    );
  }

  if (confidenceLevel === "high") {
    return {
      confidenceLevel,
      confidenceHint: null,
      confidenceActions: [],
    };
  }

  if (confidenceLevel === "medium") {
    return {
      confidenceLevel,
      confidenceHint: useChinese
        ? "目前已可作為初步報價依據；再補幾個關鍵細節，信心度會更穩定。"
        : "This is usable for a first quote; a few more details will make confidence more stable.",
      confidenceActions: actions.slice(0, 2),
    };
  }

  return {
    confidenceLevel,
    confidenceHint: useChinese
      ? "目前資訊偏少，所以信心度較保守。補齊下列資訊可明顯提高準確性。"
      : "Input detail is limited, so confidence is conservative. Add the following details to improve accuracy.",
    confidenceActions: actions.slice(0, 3),
  };
}

function normalizeGuidanceText(value) {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 0 ? normalized : null;
}

function extractAiConfidenceGuidance(parsed, useChinese, confidenceLevel) {
  const actionLimit = confidenceLevel === "medium" ? 2 : 3;
  const minHintLength = useChinese ? 10 : 24;
  const maxHintLength = useChinese ? 64 : 180;
  const minActionLength = useChinese ? 8 : 18;
  const maxActionLength = useChinese ? 46 : 120;

  const rawHint = normalizeGuidanceText(parsed?.confidenceHint);
  const confidenceHint =
    rawHint && rawHint.length >= minHintLength && rawHint.length <= maxHintLength
      ? rawHint
      : null;

  const candidateActions = Array.isArray(parsed?.confidenceActions)
    ? parsed.confidenceActions
    : [];
  const confidenceActions = [];

  for (const action of candidateActions) {
    const normalizedAction = normalizeGuidanceText(action);
    if (!normalizedAction) continue;
    if (
      normalizedAction.length < minActionLength ||
      normalizedAction.length > maxActionLength
    ) {
      continue;
    }
    if (confidenceActions.includes(normalizedAction)) continue;
    confidenceActions.push(normalizedAction);
    if (confidenceActions.length >= actionLimit) break;
  }

  return {
    confidenceHint,
    confidenceActions,
  };
}

function mergeConfidenceGuidance(ruleGuidance, aiGuidance) {
  if (ruleGuidance.confidenceLevel === "high") {
    return {
      confidenceLevel: "high",
      confidenceHint: null,
      confidenceActions: [],
    };
  }

  const actionLimit = ruleGuidance.confidenceLevel === "medium" ? 2 : 3;

  return {
    confidenceLevel: ruleGuidance.confidenceLevel,
    confidenceHint: aiGuidance.confidenceHint ?? ruleGuidance.confidenceHint,
    confidenceActions:
      aiGuidance.confidenceActions.length > 0
        ? aiGuidance.confidenceActions.slice(0, actionLimit)
        : ruleGuidance.confidenceActions.slice(0, actionLimit),
  };
}

function formatRange(minValue, maxValue, useChinese) {
  const roundedMin = Math.round(minValue);
  const roundedMax = Math.round(maxValue);
  if (useChinese) {
    return `NT$${roundedMin.toLocaleString()} - NT$${roundedMax.toLocaleString()}`;
  }
  return `$${roundedMin.toLocaleString()} - $${roundedMax.toLocaleString()}`;
}

function estimateFallbackComplexity(description, hasImage) {
  const normalized = (description || "").toLowerCase();
  let complexity = 1;
  const length = description.length;

  if (length >= 260) complexity += 0.95;
  else if (length >= 160) complexity += 0.7;
  else if (length >= 90) complexity += 0.45;
  else if (length >= 45) complexity += 0.2;

  const heavySignals = [
    "金流",
    "payment",
    "logistics",
    "物流",
    "crm",
    "dashboard",
    "後台",
    "erp",
    "api",
    "integration",
    "雙端",
    "ios",
    "android",
    "mobile",
  ];
  const heavyHitCount = heavySignals.filter((signal) =>
    normalized.includes(signal),
  ).length;
  complexity += Math.min(heavyHitCount * 0.18, 1.2);

  if (hasImage) complexity += 0.22;

  return clampNumber(complexity, 0.9, 3.2);
}

function buildFallbackBreakdown(description, useChinese) {
  const normalized = (description || "").toLowerCase();
  const contains = (keywords) =>
    keywords.some((keyword) => normalized.includes(keyword));

  const items = [];
  if (useChinese) {
    items.push({
      label: "需求釐清",
      description: "整理核心流程、功能邊界與主要交付項目。",
      effort: "12-20h",
    });
  } else {
    items.push({
      label: "Scope alignment",
      description: "Clarify core flows, feature boundaries, and deliverables.",
      effort: "10-16h",
    });
  }

  if (contains(["web", "網站", "frontend", "前端", "ui", "ux"])) {
    items.push(
      useChinese
        ? {
            label: "前台體驗實作",
            description: "完成主要頁面與關鍵互動流程的前端建置。",
            effort: "28-48h",
          }
        : {
            label: "Frontend build",
            description: "Implement key pages and interaction flows.",
            effort: "24-40h",
          },
    );
  }

  if (contains(["後台", "dashboard", "admin", "crm", "管理"])) {
    items.push(
      useChinese
        ? {
            label: "後台與資料流程",
            description: "建立管理端頁面、資料操作與權限基礎邏輯。",
            effort: "24-44h",
          }
        : {
            label: "Admin and data flow",
            description: "Build admin views, data operations, and base access logic.",
            effort: "22-40h",
          },
    );
  }

  if (contains(["payment", "金流", "物流", "logistics", "api", "integration"])) {
    items.push(
      useChinese
        ? {
            label: "第三方串接",
            description: "處理金流、物流或外部系統 API 串接與驗證。",
            effort: "20-36h",
          }
        : {
            label: "Integrations",
            description: "Connect payment/logistics or external APIs with validation.",
            effort: "18-34h",
          },
    );
  }

  if (items.length < 3) {
    items.push(
      useChinese
        ? {
            label: "功能主體開發",
            description: "完成核心商業流程與必要資料結構。",
            effort: "30-52h",
          }
        : {
            label: "Core feature build",
            description: "Implement core business flows and required data model.",
            effort: "26-46h",
          },
    );
  }

  items.push(
    useChinese
      ? {
          label: "測試與上線",
          description: "整合測試、修正風險並完成部署交付。",
          effort: "12-22h",
        }
      : {
          label: "QA and launch",
          description: "Run integration QA, fix blockers, and deploy.",
          effort: "10-18h",
        },
  );

  return items.slice(0, 5);
}

function buildFallbackAssumptions(description, hasImage, useChinese) {
  const normalized = (description || "").toLowerCase();
  const assumptions = [];
  const push = (zhText, enText) => {
    if (assumptions.length >= 3) return;
    assumptions.push(useChinese ? zhText : enText);
  };

  if (!/timeline|deadline|時程|交期|week|month|預算|budget/.test(normalized)) {
    push(
      "此估算以一般中小型專案時程推算，正式交期需再確認。",
      "Timeline is estimated for a typical small-to-mid project and should be validated.",
    );
  }

  if (!/payment|金流|api|integration|第三方|串接/.test(normalized)) {
    push(
      "目前以標準第三方服務串接複雜度估算，不含高度客製協定。",
      "Estimate assumes standard third-party integrations, not highly custom protocols.",
    );
  }

  if (!hasImage) {
    push(
      "若補上流程截圖或規格文件，價格與時程區間可再縮小。",
      "Adding screenshots or spec docs can narrow the estimate range.",
    );
  }

  push(
    "超出目前敘述的新功能會影響最終報價與時程。",
    "New requirements beyond the current brief will affect final scope and pricing.",
  );
  push(
    "此結果用於初步溝通，正式報價建議再做一次需求確認。",
    "This preview is for first-pass discussion; final quote should follow a short discovery pass.",
  );

  return assumptions.slice(0, 3);
}

function buildRateLimitFallbackEstimate({
  description,
  hasImage,
  useChinese,
  retryAfterSeconds,
}) {
  const complexity = estimateFallbackComplexity(description, hasImage);
  const breakdown = buildFallbackBreakdown(description, useChinese);
  const assumptions = buildFallbackAssumptions(description, hasImage, useChinese);

  let minPrice = useChinese ? 62_000 : 2_800;
  let maxPrice = useChinese ? 108_000 : 5_200;
  minPrice += (complexity - 1) * (useChinese ? 95_000 : 3_400);
  maxPrice += (complexity - 1) * (useChinese ? 145_000 : 5_100);

  const timelineMin = clampNumber(
    Math.round(2 + complexity * 1.8),
    2,
    useChinese ? 18 : 20,
  );
  const timelineMax = clampNumber(
    timelineMin + Math.round(1 + complexity * 1.4),
    timelineMin + 1,
    useChinese ? 24 : 26,
  );

  return {
    priceRange: formatRange(minPrice, maxPrice, useChinese),
    timeline: useChinese
      ? `${timelineMin}-${timelineMax} 週`
      : `${timelineMin}-${timelineMax} weeks`,
    confidence: useChinese ? "初步估計信心度 68%" : "Draft confidence 68%",
    breakdown,
    assumptions,
    note: useChinese
      ? `AI 目前請求量較高，先提供系統粗估結果；約 ${retryAfterSeconds} 秒後可再試一次模型版分析。`
      : `AI is currently busy, so this is a system fallback estimate. Retry in about ${retryAfterSeconds}s for a full model-based result.`,
  };
}

function finalizeRoughEstimateResult({
  parsed,
  description,
  hasImage,
  useChinese,
  allowAiGuidance,
}) {
  const modelConfidence = extractConfidenceScore(
    parsed?.confidenceScore ?? parsed?.confidence,
  );
  const heuristicConfidence = estimateHeuristicConfidence({
    description,
    hasImage,
    breakdownCount: Array.isArray(parsed?.breakdown) ? parsed.breakdown.length : 0,
    assumptionsCount: Array.isArray(parsed?.assumptions)
      ? parsed.assumptions.length
      : 0,
  });

  const finalConfidenceScore =
    modelConfidence == null
      ? heuristicConfidence
      : (() => {
          const modelWeight = description.length >= 120 || hasImage ? 0.65 : 0.55;
          const heuristicWeight = 1 - modelWeight;
          return clampNumber(
            Math.round(
              modelConfidence * modelWeight + heuristicConfidence * heuristicWeight,
            ),
            CONFIDENCE_SCORE_MIN,
            CONFIDENCE_SCORE_MAX,
          );
        })();

  const finalized = { ...parsed };
  finalized.confidence = formatConfidence(
    finalConfidenceScore,
    description,
    parsed?.confidence,
  );

  const ruleGuidance = buildConfidenceGuidance({
    score: finalConfidenceScore,
    description,
    hasImage,
    useChinese,
  });
  const aiGuidance = allowAiGuidance
    ? extractAiConfidenceGuidance(
        parsed,
        useChinese,
        ruleGuidance.confidenceLevel,
      )
    : { confidenceHint: null, confidenceActions: [] };
  const guidance = mergeConfidenceGuidance(ruleGuidance, aiGuidance);

  finalized.confidenceScore = finalConfidenceScore;
  finalized.confidenceLevel = guidance.confidenceLevel;
  if (guidance.confidenceHint) {
    finalized.confidenceHint = guidance.confidenceHint;
  } else {
    delete finalized.confidenceHint;
  }
  if (guidance.confidenceActions.length > 0) {
    finalized.confidenceActions = guidance.confidenceActions;
  } else {
    delete finalized.confidenceActions;
  }

  return finalized;
}

function normalizeTextField(value) {
  return typeof value === "string" ? value.trim() : "";
}

function parseAiJsonPayload(text, label = "AI response") {
  const cleanedText = normalizeJsonResponse(text);

  try {
    return JSON.parse(cleanedText);
  } catch (error) {
    throw new Error(`Failed to parse ${label} as JSON: ${error.message}`);
  }
}

function buildTranslatedItemCopies(sourceItems, translatedItems) {
  const translatedItemMap = new Map(
    Array.isArray(translatedItems)
      ? translatedItems.map((item) => [item?.id, normalizeTextField(item?.description)])
      : [],
  );

  return sourceItems.map((item) => ({
    description: translatedItemMap.get(item.id) || item.description,
    type: item.type || "service",
    estimatedHours: item.estimatedHours ?? 0,
    suggestedRole: item.suggestedRole || "",
    unit: item.unit || null,
    hourlyRate: item.hourlyRate ?? 0,
    amount: item.amount ?? 0,
  }));
}

function roundToTenth(value) {
  return Math.round(value * 10) / 10;
}

function buildScaledRefinementItems(sourceItems, targetBudget) {
  const currentTotal = sourceItems.reduce(
    (sum, item) => sum + Number(item.amount || 0),
    0,
  );

  if (!Number.isFinite(currentTotal) || currentTotal <= 0) {
    return sourceItems.map((item) => ({
      description: item.description,
      type: item.type || "service",
      estimatedHours: item.estimatedHours ?? 0,
      suggestedRole: item.suggestedRole || "",
      unit: item.unit || null,
      hourlyRate: item.hourlyRate ?? 0,
      amount: item.amount ?? 0,
    }));
  }

  const scale = targetBudget / currentTotal;
  const refinedItems = sourceItems.map((item) => {
    const baseHours = Number(item.estimatedHours || 0);
    const hourlyRate = Number(item.hourlyRate || 0);
    const scaledHours =
      baseHours <= 0 || hourlyRate <= 0
        ? baseHours
        : Math.max(0.1, roundToTenth(baseHours * scale));

    return {
      description: item.description,
      type: item.type || "service",
      estimatedHours: scaledHours,
      suggestedRole: item.suggestedRole || "",
      unit: item.unit || null,
      hourlyRate,
      amount: Math.round(hourlyRate * scaledHours * 100) / 100,
    };
  });

  const delta = Math.round(
    (targetBudget -
      refinedItems.reduce((sum, item) => sum + Number(item.amount || 0), 0)) *
      100,
  ) / 100;
  const adjustableIndex = [...refinedItems]
    .reverse()
    .findIndex((item) => Number(item.hourlyRate || 0) > 0);

  if (adjustableIndex !== -1 && Math.abs(delta) >= 0.01) {
    const targetIndex = refinedItems.length - 1 - adjustableIndex;
    const targetItem = refinedItems[targetIndex];
    const rate = Number(targetItem.hourlyRate || 0);
    const nextAmount = Math.max(0, Math.round((targetItem.amount + delta) * 100) / 100);
    const nextHours =
      rate > 0 ? Math.max(0.1, roundToTenth(nextAmount / rate)) : targetItem.estimatedHours;

    refinedItems[targetIndex] = {
      ...targetItem,
      estimatedHours: nextHours,
      amount: Math.round(rate * nextHours * 100) / 100,
    };
  }

  return refinedItems;
}

function buildAnalyzeFallbackModelNames() {
  const modelName = getGeminiModelName("analyze");

  return Array.from(
    new Set(
      [
        process.env.GEMINI_ANALYZE_FALLBACK_MODEL?.trim(),
        "gemini-2.5-pro",
        "gemini-2.0-flash",
        getGeminiModelName("default"),
      ].filter((value) => value && value !== modelName),
    ),
  );
}

async function createQuoteDraftCopy(tx, sourceQuote, workspaceId, overrides = {}) {
  const normalizedItems = Array.isArray(overrides.items) ? overrides.items : [];
  const totalAmount = normalizedItems.reduce(
    (sum, item) => sum + Number(item.amount || 0),
    0,
  );

  return tx.quote.create({
    data: {
      customerName: sourceQuote.customerName,
      customerId: sourceQuote.customerId || null,
      projectName: overrides.projectName ?? sourceQuote.projectName,
      projectType: overrides.projectType ?? sourceQuote.projectType,
      createdAt: sourceQuote.createdAt,
      expectedDays:
        overrides.expectedDays !== undefined
          ? overrides.expectedDays
          : sourceQuote.expectedDays,
      description:
        overrides.description !== undefined
          ? overrides.description
          : sourceQuote.description,
      status: "DRAFT",
      totalAmount,
      paymentTerms:
        overrides.paymentTerms !== undefined
          ? overrides.paymentTerms
          : sourceQuote.paymentTerms,
      validityDays:
        overrides.validityDays !== undefined
          ? overrides.validityDays
          : sourceQuote.validityDays,
      wonAmount: null,
      workspaceId,
      materials: sourceQuote.materials ?? null,
      roleRates: sourceQuote.roleRates ?? null,
      items: {
        create: normalizedItems.map((item) => ({
          description: item.description,
          type: item.type || "service",
          estimatedHours: Number(item.estimatedHours || 0),
          suggestedRole: item.suggestedRole || "",
          unit: item.unit || null,
          hourlyRate: Number(item.hourlyRate || 0),
          amount: Number(item.amount || 0),
        })),
      },
    },
    include: {
      items: true,
      customer: true,
    },
  });
}

/**
 * Translate a quote into a new draft copy
 * POST /api/ai/translate-quote
 */
export async function translateQuote(req, res) {
  try {
    const { quoteId, targetLanguage } = req.body;
    const normalizedTargetLanguage = normalizeTextField(targetLanguage);
    const workspaceId = req.workspace?.id;
    const creditCost = 1;

    if (!workspaceId) {
      return res
        .status(401)
        .json({ success: false, message: "Workspace not found" });
    }

    if (req.isFallbackWorkspace) {
      return res.status(403).json({
        success: false,
        message:
          "Unable to verify current workspace ID. Please select a workspace.",
        errorCode: "WORKSPACE_ID_MISSING",
      });
    }

    if (!quoteId || !normalizedTargetLanguage) {
      return res.status(400).json({
        success: false,
        message: "quoteId and targetLanguage are required",
      });
    }

    const [workspace, quote] = await Promise.all([
      prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: { creditBalance: true },
      }),
      prisma.quote.findUnique({
        where: { id: quoteId },
        include: { items: true, customer: true },
      }),
    ]);

    if (!workspace) {
      return res
        .status(404)
        .json({ success: false, message: "Workspace does not exist" });
    }

    if (workspace.creditBalance < creditCost) {
      return res.status(403).json({
        success: false,
        message: "Insufficient credits. Please top up your account.",
        errorCode: "INSUFFICIENT_CREDITS",
      });
    }

    if (!quote || quote.workspaceId !== workspaceId) {
      return res
        .status(404)
        .json({ success: false, message: "Quote not found" });
    }

    const geminiClient = getGeminiClient();
    if (!geminiClient) {
      return res.status(500).json({
        success: false,
        message: "GOOGLE_GENERATIVE_AI_API_KEY is not configured",
        apiKeyPresent: false,
      });
    }

    const sourcePayload = {
      projectName: quote.projectName,
      description: quote.description || "",
      paymentTerms: quote.paymentTerms || "",
      items: quote.items.map((item) => ({
        id: item.id,
        description: item.description,
        suggestedRole: item.suggestedRole || "",
      })),
    };

    const prompt = `
Translate the following software quote content into ${normalizedTargetLanguage}.
Return the result EXCLUSIVELY as valid JSON.

JSON structure:
{
  "projectName": "string",
  "description": "string",
  "paymentTerms": "string",
  "items": [
    {
      "id": "string",
      "description": "string"
    }
  ]
}

Rules:
- Preserve the professional meaning and tone.
- Keep company names, people names, product names, URLs, emails, and numeric values unchanged when appropriate.
- Keep the same item ids.
- Do not add or remove items.
- Do not change suggestedRole, estimatedHours, hourlyRate, amount, type, or unit.
- If a source field is empty, return an empty string.

Source quote JSON:
${JSON.stringify(sourcePayload, null, 2)}
`;

    let parsedResult;
    try {
      const modelName = getGeminiModelName("analyze");
      const fallbackModelNames = buildAnalyzeFallbackModelNames();
      const text = await generateGeminiJsonText(
        geminiClient,
        [{ text: prompt }],
        {
          modelName,
          fallbackModelNames,
          maxQueueWaitMs: TRANSLATE_QUEUE_WAIT_MS,
        },
      );
      parsedResult = parseAiJsonPayload(text, "translation response");
    } catch (error) {
      const statusCode = extractGeminiStatusCode(error);
      const retryAfterSeconds = extractGeminiRetryAfterSeconds(
        error,
        DEFAULT_AI_RETRY_AFTER_SECONDS,
      );

      if (statusCode === 429) {
        res.set("Retry-After", String(retryAfterSeconds));
        return res.status(429).json({
          success: false,
          message: `AI is currently busy. Please retry in about ${retryAfterSeconds} seconds.`,
          errorCode: "AI_RATE_LIMIT",
          retryAfterSeconds,
          apiKeyPresent: true,
        });
      }

      if (isGeminiRetryableStatus(statusCode)) {
        return res.status(503).json({
          success: false,
          message: "AI service is temporarily unavailable. Please try again later.",
          errorCode: "AI_TEMP_UNAVAILABLE",
          apiKeyPresent: true,
        });
      }

      throw error;
    }

    const translatedQuote = await prisma.$transaction(async (tx) => {
      const draftCopy = await createQuoteDraftCopy(tx, quote, workspaceId, {
        projectName:
          normalizeTextField(parsedResult?.projectName) || quote.projectName,
        description:
          normalizeTextField(parsedResult?.description) || quote.description,
        paymentTerms:
          normalizeTextField(parsedResult?.paymentTerms) || quote.paymentTerms,
        items: buildTranslatedItemCopies(quote.items, parsedResult?.items),
      });

      await tx.workspace.update({
        where: { id: workspaceId },
        data: {
          creditBalance: {
            decrement: creditCost,
          },
        },
      });

      return draftCopy;
    });

    return res.json({
      success: true,
      quoteId: translatedQuote.id,
      quote: translatedQuote,
    });
  } catch (error) {
    console.error("translateQuote error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to translate quote",
      error: error.message,
    });
  }
}

/**
 * Refine a quote toward a target budget and save as a new draft copy
 * POST /api/ai/refine-quote
 */
export async function refineQuote(req, res) {
  try {
    const { quoteId, targetBudget } = req.body;
    const numericTargetBudget = Number(targetBudget);
    const workspaceId = req.workspace?.id;
    const creditCost = 3;

    if (!workspaceId) {
      return res
        .status(401)
        .json({ success: false, message: "Workspace not found" });
    }

    if (req.isFallbackWorkspace) {
      return res.status(403).json({
        success: false,
        message:
          "Unable to verify current workspace ID. Please select a workspace.",
        errorCode: "WORKSPACE_ID_MISSING",
      });
    }

    if (!quoteId || !Number.isFinite(numericTargetBudget) || numericTargetBudget <= 0) {
      return res.status(400).json({
        success: false,
        message: "quoteId and a positive targetBudget are required",
      });
    }

    const [workspace, quote] = await Promise.all([
      prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: { creditBalance: true },
      }),
      prisma.quote.findUnique({
        where: { id: quoteId },
        include: { items: true, customer: true },
      }),
    ]);

    if (!workspace) {
      return res
        .status(404)
        .json({ success: false, message: "Workspace does not exist" });
    }

    if (workspace.creditBalance < creditCost) {
      return res.status(403).json({
        success: false,
        message: "Insufficient credits. Please top up your account.",
        errorCode: "INSUFFICIENT_CREDITS",
      });
    }

    if (!quote || quote.workspaceId !== workspaceId) {
      return res
        .status(404)
        .json({ success: false, message: "Quote not found" });
    }

    const sourcePayload = {
      projectName: quote.projectName,
      targetBudget: numericTargetBudget,
      currentTotal: quote.totalAmount || 0,
      expectedDays: quote.expectedDays,
      items: quote.items.map((item) => ({
        id: item.id,
        description: item.description,
        suggestedRole: item.suggestedRole || "",
        estimatedHours: Number(item.estimatedHours || 0),
        hourlyRate: Number(item.hourlyRate || 0),
        amount: Number(item.amount || 0),
      })),
    };

    let refinedItems = buildScaledRefinementItems(quote.items, numericTargetBudget);
    let refinedExpectedDays =
      quote.expectedDays && quote.totalAmount
        ? Math.max(
            1,
            Math.round((quote.expectedDays * numericTargetBudget) / quote.totalAmount),
          )
        : quote.expectedDays;

    const geminiClient = getGeminiClient();
    if (geminiClient) {
      try {
        const modelName = getGeminiModelName("analyze");
        const fallbackModelNames = buildAnalyzeFallbackModelNames();
        const prompt = `
Refine this software quote so the total price moves as close as possible to ${numericTargetBudget} TWD.
Return the result EXCLUSIVELY as valid JSON.

JSON structure:
{
  "expectedDays": number,
  "items": [
    {
      "id": "string",
      "estimatedHours": number
    }
  ]
}

Rules:
- Keep the same number of items and the same item ids.
- Adjust only estimatedHours.
- Do not change descriptions, suggestedRole, hourlyRate, type, unit, or item order.
- Keep estimatedHours non-negative and use at most one decimal place.
- The final total should be as close as possible to the target budget while preserving realistic phase balance.

Source quote JSON:
${JSON.stringify(sourcePayload, null, 2)}
`;

        const text = await generateGeminiJsonText(
          geminiClient,
          [{ text: prompt }],
          {
            modelName,
            fallbackModelNames,
            maxQueueWaitMs: REFINE_QUEUE_WAIT_MS,
          },
        );
        const parsedResult = parseAiJsonPayload(text, "refinement response");
        const hoursById = new Map(
          Array.isArray(parsedResult?.items)
            ? parsedResult.items.map((item) => [item?.id, Number(item?.estimatedHours)])
            : [],
        );

        refinedItems = quote.items.map((item) => {
          const refinedHoursCandidate = hoursById.get(item.id);
          const estimatedHours =
            Number.isFinite(refinedHoursCandidate) && refinedHoursCandidate >= 0
              ? Math.max(0.1, roundToTenth(refinedHoursCandidate))
              : Number(item.estimatedHours || 0);
          const hourlyRate = Number(item.hourlyRate || 0);

          return {
            description: item.description,
            type: item.type || "service",
            estimatedHours,
            suggestedRole: item.suggestedRole || "",
            unit: item.unit || null,
            hourlyRate,
            amount: Math.round(hourlyRate * estimatedHours * 100) / 100,
          };
        });

        if (
          Number.isFinite(Number(parsedResult?.expectedDays)) &&
          Number(parsedResult.expectedDays) > 0
        ) {
          refinedExpectedDays = Math.round(Number(parsedResult.expectedDays));
        }
      } catch (error) {
        console.warn("refineQuote AI refinement fell back to scaled refinement:", error);
      }
    }

    const refinedQuote = await prisma.$transaction(async (tx) => {
      const draftCopy = await createQuoteDraftCopy(tx, quote, workspaceId, {
        items: refinedItems,
        expectedDays: refinedExpectedDays,
      });

      await tx.workspace.update({
        where: { id: workspaceId },
        data: {
          creditBalance: {
            decrement: creditCost,
          },
        },
      });

      return draftCopy;
    });

    return res.json({
      success: true,
      quoteId: refinedQuote.id,
      quote: refinedQuote,
    });
  } catch (error) {
    console.error("refineQuote error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to refine quote",
      error: error.message,
    });
  }
}

/**
 * Analyze requirements using AI
 * POST /api/ai/analyze
 */
export async function analyzeRequirements(req, res) {
  try {
    const { requirements, images, projectType, templateContext } = req.body;
    const normalizedRequirements =
      typeof requirements === "string" ? requirements.trim() : "";
    const normalizedTemplateContext =
      typeof templateContext === "string" ? templateContext.trim() : "";
    const normalizedProjectType =
      typeof projectType === "string" ? projectType.trim() : "";
    const safeImages = Array.isArray(images) ? images : [];
    const workspaceId = req.workspace?.id;
    const creditCost = 10;

    if (!workspaceId) {
      return res
        .status(401)
        .json({ success: false, message: "Workspace not found" });
    }

    // STRICT CHECK: Do not allow AI Analysis if the workspace is implicitly determined via fallback.
    // The frontend must explicitly specify the WorkspaceId to prevent accidental point deduction.
    if (req.isFallbackWorkspace) {
      return res.status(403).json({
        success: false,
        message:
          "Unable to verify current workspace ID. Please select a workspace.",
        errorCode: "WORKSPACE_ID_MISSING",
      });
    }

    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { creditBalance: true },
    });

    if (!workspace) {
      return res
        .status(404)
        .json({ success: false, message: "Workspace does not exist" });
    }

    if (workspace.creditBalance < creditCost) {
      return res.status(403).json({
        success: false,
        message: "Insufficient credits. Please top up your account.",
        errorCode: "INSUFFICIENT_CREDITS",
      });
    }

    // Allow empty requirements if images are provided
    if (
      !normalizedRequirements &&
      !normalizedTemplateContext &&
      safeImages.length === 0
    ) {
      return res
        .status(400)
        .json({ message: "Requirements text or images are required" });
    }

    const geminiClient = getGeminiClient();
    if (!geminiClient) {
      return res.status(500).json({
        success: false,
        message: "GOOGLE_GENERATIVE_AI_API_KEY is not configured",
        apiKeyPresent: false,
      });
    }

    const modelName = getGeminiModelName("analyze");
    const isMaterialHeavyProject =
      /裝潢|装修|裝修|室內|室内|工程|施工|拆除|泥作|木作|水電|机电|機電|管線|管道|天花|地坪|油漆|建材|櫃體|系统柜|系統櫃|家具|傢俱|燈具|灯具|衛浴|卫浴|防水|renovation|interior|construction|fit[ -]?out/i.test(
        `${normalizedProjectType} ${normalizedRequirements} ${normalizedTemplateContext}`,
      );
    const prompt = `
Please analyze these project requirements and break them down into actionable quote items.
Return the result EXCLUSIVELY as a valid JSON object.

Important Instructions:
1. **Language**: All text content (summary, description, material names, units, etc.) MUST be in **Traditional Chinese (Taiwan)** (繁體中文).
2. **Financials**:
   - You MUST estimate a reasonable "hourlyRate" in TWD.
   - For service items, "hourlyRate" means labor/unit hourly rate.
   - For material items, "hourlyRate" means unit price.
   - "amount" MUST be calculated as "estimatedHours" * "hourlyRate".
   - Do NOT return 0 for rates or amounts.
3. **Item Type Classification**:
   - Each item MUST include "type" and it must be either "service" or "material".
   - "service" = labor, design, planning, project management, engineering execution, testing, installation, supervision, or any work billed by effort.
   - "material" = physical products, fixtures, hardware, building materials, wiring, pipes, boards, paint, tiles, lighting, sanitaryware, appliances, furniture, or consumables.
4. **Service Item Rules**:
   - "suggestedRole" MUST be one of: "design", "frontend", "backend", "pm", "qa", "other".
   - "unit" should be null or an empty string.
5. **Material Item Rules**:
   - "suggestedRole" should be the material name or material category in Traditional Chinese, not a staff role.
   - "estimatedHours" represents quantity for materials.
   - "unit" MUST be a practical quantity unit such as "式", "組", "件", "支", "才", "片", "箱", "桶", "公尺", "平方公尺", "盞", "座".
6. **Interior / Construction Projects**:
   - If the requirement is related to interior design, renovation, construction, fit-out, engineering, or any physical build project, you MUST separate labor/service items and material items.
   - When physical materials are reasonably implied, you MUST include material items and not hide them inside service items.
   - For these projects, return at least 2 material items unless the user explicitly says labor only / materials excluded.

JSON Structure:
{
  "summary": "string (Short summary in Traditional Chinese)",
  "items": [
    {
      "id": "string (e.g., ai_1)",
      "type": "service" | "material",
      "description": "string (Task or material description in Traditional Chinese)",
      "estimatedHours": number,
      "suggestedRole": "string",
      "unit": "string | null",
      "hourlyRate": number,
      "amount": number
    }
  ]
}

Project Type Hint:
${normalizedProjectType || "Not specified"}
${isMaterialHeavyProject ? "This request likely requires explicit material line items." : "This request may be service-only unless materials are clearly implied."}

Quote Template Context:
${normalizedTemplateContext || "No selected quote template context."}

User Requirements:
${normalizedRequirements || "No additional user-entered requirements."}
`;

    console.log("Calling Gemini AI via official SDK with payload:", {
      modelName,
      requirementsLength: normalizedRequirements.length,
      templateContextLength: normalizedTemplateContext.length,
      imagesCount: safeImages.length,
    });

    const parts = [{ text: prompt }];

    safeImages.forEach((img, idx) => {
      try {
        const base64Data = img.includes(",") ? img.split(",")[1] : img;
        parts.push({
          inlineData: {
            data: base64Data,
            mimeType: "image/jpeg",
          },
        });
      } catch (e) {
        console.error(`Error processing image at index ${idx}:`, e);
      }
    });

    let text;
    try {
      const fallbackModelNames = buildAnalyzeFallbackModelNames();
      text = await generateGeminiJsonText(geminiClient, parts, {
        modelName,
        fallbackModelNames,
        maxQueueWaitMs: ANALYZE_QUEUE_WAIT_MS,
      });
    } catch (error) {
      const statusCode = extractGeminiStatusCode(error);
      const retryAfterSeconds = extractGeminiRetryAfterSeconds(
        error,
        DEFAULT_AI_RETRY_AFTER_SECONDS,
      );

      if (statusCode === 429) {
        res.set("Retry-After", String(retryAfterSeconds));
        return res.status(429).json({
          success: false,
          message: getBusyMessage(true, retryAfterSeconds),
          errorCode: "AI_RATE_LIMIT",
          retryAfterSeconds,
          apiKeyPresent: true,
        });
      }

      if (isGeminiRetryableStatus(statusCode)) {
        return res.status(503).json({
          success: false,
          message: getUnavailableMessage(true),
          errorCode: "AI_TEMP_UNAVAILABLE",
          apiKeyPresent: true,
        });
      }

      throw error;
    }

    console.log("AI Response received successfully.");

    // Parse the JSON result
    const cleanedText = normalizeJsonResponse(text);
    let parsedResult;
    try {
      parsedResult = JSON.parse(cleanedText);
    } catch (parseError) {
      console.error(
        "JSON Parsing Error:",
        parseError,
        "Cleaned Text:",
        cleanedText,
      );
      throw new Error(
        `Failed to parse AI response as JSON: ${parseError.message}`,
      );
    }

    const knownServiceRoles = new Set([
      "design",
      "frontend",
      "backend",
      "pm",
      "qa",
      "other",
    ]);
    const normalizedItems = Array.isArray(parsedResult?.items)
      ? parsedResult.items.map((item, index) => {
          const rawType = normalizeTextField(item?.type).toLowerCase();
          const rawRole = normalizeTextField(item?.suggestedRole);
          const rawUnit = normalizeTextField(item?.unit);
          const normalizedType =
            rawType === "material" ||
            (!knownServiceRoles.has(rawRole.toLowerCase()) && !!rawUnit)
              ? "material"
              : "service";
          const estimatedCandidate = Number(item?.estimatedHours);
          const estimatedHours =
            Number.isFinite(estimatedCandidate) && estimatedCandidate > 0
              ? normalizedType === "material"
                ? Math.round(estimatedCandidate * 100) / 100
                : Math.max(0.1, roundToTenth(estimatedCandidate))
              : 1;
          const hourlyRateCandidate = Number(item?.hourlyRate);
          const hourlyRate =
            Number.isFinite(hourlyRateCandidate) && hourlyRateCandidate > 0
              ? Math.round(hourlyRateCandidate)
              : normalizedType === "material"
                ? 1000
                : 1500;

          return {
            id: normalizeTextField(item?.id) || `ai_${index + 1}`,
            type: normalizedType,
            description:
              normalizeTextField(item?.description) ||
              `${normalizedType === "material" ? "材料" : "服務"}項目 ${index + 1}`,
            estimatedHours,
            suggestedRole:
              normalizedType === "material"
                ? rawRole || `材料項目 ${index + 1}`
                : knownServiceRoles.has(rawRole.toLowerCase())
                  ? rawRole.toLowerCase()
                  : rawRole || "other",
            unit: normalizedType === "material" ? rawUnit || "式" : null,
            hourlyRate,
            amount: Math.round(hourlyRate * estimatedHours),
          };
        })
      : [];
    const normalizedSummary =
      normalizeTextField(parsedResult?.summary) || "AI 需求分析結果";

    // Deduct credits after a successful parse
    await prisma.workspace.update({
      where: { id: workspaceId },
      data: {
        creditBalance: {
          decrement: creditCost,
        },
      },
    });

    return res.json({
      summary: normalizedSummary,
      items: normalizedItems,
    });
  } catch (error) {
    console.error("CRITICAL AI Analysis error:", error);
    // Return the full error message and stack for debugging
    return res.status(500).json({
      success: false,
      message: "Failed to analyze requirements",
      error: error.message,
      stack: error.stack,
      apiKeyPresent: hasGeminiApiKey(),
    });
  }
}

/**
 * Public rough estimate — no auth, no credits, marketing landing page only.
 * POST /api/ai/rough-estimate
 */
export async function roughEstimate(req, res) {
  try {
    const { description, imageBase64, imageBase64List, images, locale } = req.body;
    const normalizedDescription =
      typeof description === "string" ? description.trim() : "";
    const normalizedImageBase64List = [];
    const imageCandidates = Array.isArray(imageBase64List)
      ? imageBase64List
      : Array.isArray(images)
        ? images
        : [];

    if (imageCandidates.length > 0) {
      for (const image of imageCandidates.slice(0, 6)) {
        if (typeof image === "string" && image.trim().length > 0) {
          normalizedImageBase64List.push(image.trim());
        }
      }
    }

    if (
      normalizedImageBase64List.length === 0 &&
      typeof imageBase64 === "string" &&
      imageBase64.trim().length > 0
    ) {
      normalizedImageBase64List.push(imageBase64.trim());
    }

    const hasImage = normalizedImageBase64List.length > 0;
    // Prefer explicit locale from the request (set by the UI language choice);
    // fall back to detecting Chinese characters in the description.
    const normalizedLocale = typeof locale === "string" ? locale.trim().toLowerCase() : "";
    const useChinese = normalizedLocale
      ? normalizedLocale === "zh" || normalizedLocale.startsWith("zh-")
      : hasChineseText(normalizedDescription);
    const quota = createRoughEstimateQuota(req);

    if (!normalizedDescription && !hasImage) {
      return res.status(400).json({
        success: false,
        message: "description or imageBase64/imageBase64List required",
      });
    }

    if (normalizedDescription.length > ROUGH_ESTIMATE_MAX_DESCRIPTION_CHARS) {
      return res.status(413).json({
        success: false,
        message: getDescriptionTooLongMessage(
          useChinese,
          ROUGH_ESTIMATE_MAX_DESCRIPTION_CHARS,
        ),
        errorCode: "DESCRIPTION_TOO_LONG",
        maxChars: ROUGH_ESTIMATE_MAX_DESCRIPTION_CHARS,
      });
    }

    if (!quota.allowed) {
      res.set("Retry-After", String(quota.retryAfterSeconds));
      return res.status(429).json({
        success: false,
        message: getDailyLimitMessage(useChinese, quota.retryAfterSeconds),
        errorCode: "ROUGH_ESTIMATE_DAILY_LIMIT",
        retryAfterSeconds: quota.retryAfterSeconds,
      });
    }

    const geminiClient = getGeminiClient();
    if (!geminiClient) {
      return res.status(500).json({
        success: false,
        message: "GOOGLE_GENERATIVE_AI_API_KEY is not configured",
        apiKeyPresent: false,
      });
    }
    const modelName = getGeminiModelName("roughEstimate");
    const fallbackModelNames = Array.from(
      new Set(
        [
          process.env.GEMINI_ROUGH_ESTIMATE_FALLBACK_MODEL?.trim(),
          getGeminiModelName("default"),
        ].filter((value) => value && value !== modelName),
      ),
    );

    const outputLanguageInstruction = useChinese
      ? "IMPORTANT: You MUST write ALL text fields (priceRange, timeline, confidence, confidenceHint, confidenceActions, breakdown labels and descriptions, assumptions, note) in Traditional Chinese (繁體中文). Do NOT use English in any of these fields. Use TWD (NT$) for prices."
      : "Write all text fields in English. Use USD for prices unless the description clearly implies another currency.";

    const prompt = `
You are a senior software project estimator. Analyze the following project description and produce a rough quote preview.
Return ONLY a valid JSON object matching this exact schema — no markdown, no explanation.

Schema:
{
  "priceRange": "string (e.g. '$4,800 – $7,500' or 'NT$150,000 – NT$235,000')",
  "timeline": "string (e.g. '4 – 6 weeks' or '4 – 6 週')",
  "confidenceScore": "number (integer 55-92)",
  "confidence": "string (must include confidenceScore as percentage, e.g. 'Draft confidence 82%' or '初步估計信心度 82%')",
  "confidenceHint": "string | null (one short sentence; null when confidence is high)",
  "confidenceActions": ["string", "string", "string"],
  "breakdown": [
    {
      "label": "string (phase name, max 5 words)",
      "description": "string (one sentence)",
      "effort": "string (e.g. '18–28h')"
    }
  ],
  "assumptions": ["string", "string", "string"],
  "note": "string (one short disclaimer sentence)"
}

Rules:
- breakdown must have 3–5 items covering the major phases of the project.
- assumptions must have exactly 3 items.
- ${outputLanguageInstruction}
- Keep breakdown labels concise and professional.
- confidenceScore must be based on requirement clarity and uncertainty, not a default value.
- increase confidenceScore when scope is specific (clear features, constraints, stack, deliverables).
- decrease confidenceScore when scope is vague, highly complex, or missing key constraints.
- do not reuse the same confidence score across unrelated inputs unless the information quality is genuinely similar.
- STANDARD PRICING BASELINE (adjust based on detailed requirements):
  * Simple landing page / Website: $1,500 - $3,500 (NT$45,000 - NT$105,000)
  * Basic Web App / CMS: $4,000 - $8,000 (NT$120,000 - NT$240,000)
  * Complex Platform / SaaS: $10,000+ (NT$300,000+)
  * E-commerce site: $5,000 - $12,000 (NT$150,000 - NT$360,000)
  * Use these as a firm anchor to prevent wild price fluctuations between similar inputs. Keep the estimated ranges consistent and stable.
- confidenceHint must be concise and practical.
- confidenceActions must be concrete next inputs the user can add, not generic advice.
- if confidenceScore >= 82: set confidenceHint to null and confidenceActions to [].
- if confidenceScore is 72-81: provide confidenceHint + up to 2 confidenceActions.
- if confidenceScore <= 71: provide confidenceHint + up to 3 confidenceActions.

Project description:
${normalizedDescription || "(see attached images)"}
`.trim();

    const parts = [{ text: prompt }];
    for (const image of normalizedImageBase64List) {
      const base64Data = image.includes(",") ? image.split(",")[1] : image;
      parts.push({ inlineData: { data: base64Data, mimeType: "image/jpeg" } });
    }

    let text;
    try {
      text = await generateGeminiJsonText(geminiClient, parts, {
        modelName,
        fallbackModelNames,
        maxQueueWaitMs: ROUGH_ESTIMATE_QUEUE_WAIT_MS,
        temperature: 0.1, // Added lower temperature to reduce price fluctuation
      });
    } catch (error) {
      const statusCode = extractGeminiStatusCode(error);
      if (statusCode === 429) {
        const retryAfterSeconds = extractGeminiRetryAfterSeconds(
          error,
          DEFAULT_AI_RETRY_AFTER_SECONDS,
        );
        const fallbackResult = buildRateLimitFallbackEstimate({
          description: normalizedDescription,
          hasImage,
          useChinese,
          retryAfterSeconds,
        });
        const finalizedFallback = finalizeRoughEstimateResult({
          parsed: fallbackResult,
          description: normalizedDescription,
          hasImage,
          useChinese,
          allowAiGuidance: false,
        });
        quota.commit();

        return res.json({
          ...finalizedFallback,
          fallback: true,
          fallbackReason:
            error?.errorCode === "AI_QUEUE_BUSY" ? "queue_busy" : "rate_limited",
          retryAfterSeconds,
        });
      }

      if (isGeminiRetryableStatus(statusCode)) {
        return res.status(503).json({
          success: false,
          message: getUnavailableMessage(useChinese),
          errorCode: "AI_TEMP_UNAVAILABLE",
          apiKeyPresent: true,
        });
      }

      throw error;
    }

    const cleaned = normalizeJsonResponse(text);

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (e) {
      console.error("roughEstimate JSON parse failed:", e, cleaned);
      return res.status(500).json({
        success: false,
        message: "Failed to parse AI response",
        apiKeyPresent: true,
      });
    }

    const finalizedResult = finalizeRoughEstimateResult({
      parsed,
      description: normalizedDescription,
      hasImage,
      useChinese,
      allowAiGuidance: true,
    });

    quota.commit();
    return res.json(finalizedResult);
  } catch (error) {
    console.error("roughEstimate error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to generate rough estimate",
      errorCode: "AI_INTERNAL_ERROR",
      apiKeyPresent: hasGeminiApiKey(),
    });
  }
}
