import { GoogleGenerativeAI } from "@google/generative-ai";
import prisma from "../lib/prisma.js";

const GEMINI_MODEL_NAME = "gemini-2.0-flash";
const GEMINI_RETRY_DELAYS_MS = [450, 900];
const ROUGH_ESTIMATE_COOLDOWN_MS = 20_000;
const CONFIDENCE_SCORE_MIN = 62;
const CONFIDENCE_SCORE_MAX = 92;

let roughEstimateCooldownUntil = 0;

function hasGeminiApiKey() {
  return Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim());
}

function getGeminiClient() {
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim();
  if (!apiKey) {
    return null;
  }

  return new GoogleGenerativeAI(apiKey);
}

function normalizeJsonResponse(text) {
  return text.replace(/```json\n?|```/g, "").trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractGeminiStatusCode(error) {
  const directStatus =
    error?.status ?? error?.statusCode ?? error?.response?.status ?? null;
  if (typeof directStatus === "number" && Number.isFinite(directStatus)) {
    return directStatus;
  }

  const message = typeof error?.message === "string" ? error.message : "";
  const bracketMatch = message.match(/\[(\d{3})[^\]]*\]/);
  if (bracketMatch) {
    return Number.parseInt(bracketMatch[1], 10);
  }

  const plainMatch = message.match(/\b(429|500|502|503|504)\b/);
  if (plainMatch) {
    return Number.parseInt(plainMatch[1], 10);
  }

  return null;
}

function isGeminiRetryableStatus(statusCode) {
  return statusCode === 429 || statusCode === 500 || statusCode === 502 || statusCode === 503 || statusCode === 504;
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

async function generateGeminiJsonText(geminiClient, parts) {
  const model = geminiClient.getGenerativeModel({
    model: GEMINI_MODEL_NAME,
    generationConfig: { responseMimeType: "application/json" },
  });

  let lastError = null;
  const totalAttempts = GEMINI_RETRY_DELAYS_MS.length + 1;

  for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
    try {
      const result = await model.generateContent(parts);
      return result.response.text();
    } catch (error) {
      lastError = error;
      const statusCode = extractGeminiStatusCode(error);

      if (!isGeminiRetryableStatus(statusCode) || attempt === totalAttempts) {
        throw error;
      }

      const delay =
        GEMINI_RETRY_DELAYS_MS[attempt - 1] + Math.floor(Math.random() * 120);
      await sleep(delay);
    }
  }

  throw lastError;
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

/**
 * Analyze requirements using AI
 * POST /api/ai/analyze
 */
export async function analyzeRequirements(req, res) {
  try {
    const { requirements, images } = req.body;
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
    if (!requirements && (!images || images.length === 0)) {
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

    const prompt = `
Please analyze these software requirements and break them down into actionable tasks. 
Return the result EXCLUSIVELY as a valid JSON object.

Important Instructions:
1. **Language**: All text content (description, etc.) MUST be in **Traditional Chinese (Taiwan)** (繁體中文).
2. **Financials**: 
   - You MUST estimate a reasonable "hourlyRate" (e.g., between 800 and 3000 TWD based on role).
   - "amount" MUST be calculated as "estimatedHours" * "hourlyRate".
   - Do NOT return 0 for rates or amounts.

JSON Structure:
{
  "summary": "string (Short summary in Traditional Chinese)",
  "items": [
    {
      "id": "string (e.g., ai_1)",
      "description": "string (Task description in Traditional Chinese)",
      "estimatedHours": number,
      "suggestedRole": "design" | "frontend" | "backend" | "pm" | "qa" | "other",
      "hourlyRate": number,
      "amount": number
    }
  ]
}

Requirements:
${requirements}
`;

    console.log("Calling Gemini AI via official SDK with payload:", {
      requirementsLength: requirements.length,
      imagesCount: images?.length || 0,
    });

    // Safety check for images
    const safeImages = Array.isArray(images) ? images : [];

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
      text = await generateGeminiJsonText(geminiClient, parts);
    } catch (error) {
      const statusCode = extractGeminiStatusCode(error);

      if (statusCode === 429) {
        const retryAfterSeconds = Math.ceil(ROUGH_ESTIMATE_COOLDOWN_MS / 1000);
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
      summary: parsedResult.summary,
      items: parsedResult.items,
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
    const { description, imageBase64, imageBase64List, images } = req.body;
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
    const useChinese = hasChineseText(normalizedDescription);

    if (!normalizedDescription && !hasImage) {
      return res.status(400).json({
        success: false,
        message: "description or imageBase64/imageBase64List required",
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

    const now = Date.now();
    if (roughEstimateCooldownUntil > now) {
      const retryAfterSeconds = Math.ceil(
        (roughEstimateCooldownUntil - now) / 1000,
      );
      res.set("Retry-After", String(retryAfterSeconds));
      return res.status(429).json({
        success: false,
        message: getBusyMessage(useChinese, retryAfterSeconds),
        errorCode: "AI_RATE_LIMIT",
        retryAfterSeconds,
        apiKeyPresent: true,
      });
    }

    const prompt = `
You are a senior software project estimator. Analyze the following project description and produce a rough quote preview.
Return ONLY a valid JSON object matching this exact schema — no markdown, no explanation.

Schema:
{
  "priceRange": "string (e.g. '$4,800 – $7,500' or 'NT$150,000 – NT$235,000' based on locale hints)",
  "timeline": "string (e.g. '4 – 6 weeks')",
  "confidenceScore": "number (integer 55-92)",
  "confidence": "string (must include confidenceScore as percentage, e.g. 'Draft confidence 82%')",
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
- Use the same language as the user's description (English or Chinese).
- Keep breakdown labels concise and professional.
- Price should reflect typical freelance/agency rates for the region implied by the description language (TWD for Chinese, USD for English).
- confidenceScore must be based on requirement clarity and uncertainty, not a default value.
- increase confidenceScore when scope is specific (clear features, constraints, stack, deliverables).
- decrease confidenceScore when scope is vague, highly complex, or missing key constraints.
- do not reuse the same confidence score across unrelated inputs unless the information quality is genuinely similar.

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
      text = await generateGeminiJsonText(geminiClient, parts);
    } catch (error) {
      const statusCode = extractGeminiStatusCode(error);
      if (statusCode === 429) {
        const retryAfterSeconds = Math.ceil(ROUGH_ESTIMATE_COOLDOWN_MS / 1000);
        roughEstimateCooldownUntil = Date.now() + ROUGH_ESTIMATE_COOLDOWN_MS;
        res.set("Retry-After", String(retryAfterSeconds));
        return res.status(429).json({
          success: false,
          message: getBusyMessage(useChinese, retryAfterSeconds),
          errorCode: "AI_RATE_LIMIT",
          retryAfterSeconds,
          apiKeyPresent: true,
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

    const modelConfidence = extractConfidenceScore(
      parsed?.confidenceScore ?? parsed?.confidence,
    );
    const heuristicConfidence = estimateHeuristicConfidence({
      description: normalizedDescription,
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
            const modelWeight =
              normalizedDescription.length >= 120 || hasImage ? 0.65 : 0.55;
            const heuristicWeight = 1 - modelWeight;
            return clampNumber(
              Math.round(
                modelConfidence * modelWeight +
                  heuristicConfidence * heuristicWeight,
              ),
              CONFIDENCE_SCORE_MIN,
              CONFIDENCE_SCORE_MAX,
            );
          })();

    parsed.confidence = formatConfidence(
      finalConfidenceScore,
      normalizedDescription,
      parsed?.confidence,
    );
    const guidance = buildConfidenceGuidance({
      score: finalConfidenceScore,
      description: normalizedDescription,
      hasImage,
      useChinese,
    });

    parsed.confidenceScore = finalConfidenceScore;
    parsed.confidenceLevel = guidance.confidenceLevel;
    if (guidance.confidenceHint) {
      parsed.confidenceHint = guidance.confidenceHint;
    } else {
      delete parsed.confidenceHint;
    }
    if (guidance.confidenceActions.length > 0) {
      parsed.confidenceActions = guidance.confidenceActions;
    } else {
      delete parsed.confidenceActions;
    }

    return res.json(parsed);
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
