import {
  extractGeminiRetryAfterSeconds,
  extractGeminiStatusCode,
  generateGeminiJsonText,
  getGeminiClient,
  getGeminiModelName,
  isGeminiTemporaryStatus as isGeminiRetryableStatus,
  normalizeJsonResponse,
} from "../lib/gemini.js";
import { buildParseConversationPrompt } from "../prompts/parseConversationPrompt.js";

const VALID_RAW_INPUT_TYPES = new Set(["conversation", "email", "meeting_notes", "short_brief", "mixed"]);
const VALID_SPEAKER_ROLES = new Set(["client", "sales", "developer", "decision_maker", "unknown"]);
const VALID_STATUSES = new Set(["confirmed", "inferred", "conflicting"]);
const VALID_PRICE_IMPACTS = new Set(["high", "medium", "low"]);

function normalizeTextField(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => normalizeTextField(item)).filter(Boolean);
}

function normalizeSpeakers(value) {
  if (!Array.isArray(value) || value.length === 0) {
    return [{ label: "未知", role: "unknown" }];
  }
  return value
    .map((s) => ({
      label: normalizeTextField(s?.label) || "未知",
      role: VALID_SPEAKER_ROLES.has(s?.role) ? s.role : "unknown",
    }))
    .filter((s) => s.label);
}

function normalizeRequirements(value) {
  if (!Array.isArray(value)) return [];
  let idCounter = 1;
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const text = normalizeTextField(item.text);
      if (!text) return null;
      const confidence = Number(item.confidence);
      return {
        id: normalizeTextField(item.id) || `R${idCounter++}`,
        text,
        status: VALID_STATUSES.has(item.status) ? item.status : "inferred",
        evidence: normalizeTextField(item.evidence) || "AI 推測",
        confidence: Number.isFinite(confidence) && confidence >= 0 && confidence <= 1 ? confidence : 0.5,
      };
    })
    .filter(Boolean);
}

function normalizeMissingQuestions(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const question = normalizeTextField(item.question);
      if (!question) return null;
      return {
        question,
        whyItMatters: normalizeTextField(item.whyItMatters),
        priceImpact: VALID_PRICE_IMPACTS.has(item.priceImpact) ? item.priceImpact : "medium",
      };
    })
    .filter(Boolean);
}

function normalizeRisks(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const risk = normalizeTextField(item.risk || item.title || item.name);
      if (!risk) return null;
      return { risk, mitigation: normalizeTextField(item.mitigation || item.solution || item.description) };
    })
    .filter(Boolean);
}

/**
 * Parse a raw conversation / email / meeting-notes input into a structured RequirementSpec.
 * POST /api/ai/parse-conversation
 *
 * Auth: required (authMiddleware applied in router)
 * Body: { rawInput: string }
 * Response: RequirementSpec JSON
 */
export async function parseConversation(req, res) {
  try {
    const { rawInput } = req.body;
    const normalizedInput = typeof rawInput === "string" ? rawInput.trim() : "";

    if (!normalizedInput) {
      return res.status(400).json({ success: false, message: "rawInput is required" });
    }

    const geminiClient = getGeminiClient();
    if (!geminiClient) {
      return res.status(500).json({
        success: false,
        message: "GOOGLE_GENERATIVE_AI_API_KEY is not configured",
      });
    }

    const modelName = getGeminiModelName("analyze");
    const prompt = buildParseConversationPrompt({ rawInput: normalizedInput });

    let text;
    try {
      text = await generateGeminiJsonText(geminiClient, [{ text: prompt }], {
        modelName,
        temperature: 0.1,
      });
    } catch (error) {
      const statusCode = extractGeminiStatusCode(error);
      const retryAfterSeconds = extractGeminiRetryAfterSeconds(error, 20);

      if (statusCode === 429) {
        res.set("Retry-After", String(retryAfterSeconds));
        return res.status(429).json({
          success: false,
          message: `AI 服務忙碌，請 ${retryAfterSeconds} 秒後重試。`,
          errorCode: "AI_RATE_LIMIT",
          retryAfterSeconds,
        });
      }

      if (isGeminiRetryableStatus(statusCode)) {
        return res.status(503).json({
          success: false,
          message: "AI 服務暫時不可用，請稍後重試。",
          errorCode: "AI_TEMP_UNAVAILABLE",
        });
      }

      throw error;
    }

    const cleanedText = normalizeJsonResponse(text);
    let parsed;
    try {
      parsed = JSON.parse(cleanedText);
    } catch (parseError) {
      return res.status(500).json({
        success: false,
        message: "Failed to parse AI response as JSON",
        error: parseError.message,
      });
    }

    const requirementSpec = {
      rawInputType: VALID_RAW_INPUT_TYPES.has(parsed?.rawInputType) ? parsed.rawInputType : "mixed",
      detectedLanguage: normalizeTextField(parsed?.detectedLanguage) || "zh-TW",
      conversationSummary: normalizeTextField(parsed?.conversationSummary),
      detectedSpeakers: normalizeSpeakers(parsed?.detectedSpeakers),
      clientIntent: normalizeTextField(parsed?.clientIntent),
      projectType: normalizeTextField(parsed?.projectType),
      businessGoal: normalizeTextField(parsed?.businessGoal),
      targetUsers: normalizeStringArray(parsed?.targetUsers),
      platforms: normalizeStringArray(parsed?.platforms),
      requirements: normalizeRequirements(parsed?.requirements),
      missingQuestions: normalizeMissingQuestions(parsed?.missingQuestions),
      assumptions: normalizeStringArray(parsed?.assumptions),
      exclusions: normalizeStringArray(parsed?.exclusions),
      risks: normalizeRisks(parsed?.risks),
    };

    return res.json({ success: true, requirementSpec });
  } catch (error) {
    console.error("[parseConversation] Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to parse conversation",
      error: error.message,
    });
  }
}
