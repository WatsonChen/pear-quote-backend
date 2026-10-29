import Anthropic from "@anthropic-ai/sdk";

const DEFAULT_MODEL_NAME = "claude-opus-5-5";
const DEFAULT_MAX_TOKENS = 16_000;
const ROUGH_ESTIMATE_MAX_TOKENS = 8_000;
// Keep the per-attempt budget small enough that a failover to Gemini still
// fits inside the serverless function duration.
const ANTHROPIC_TIMEOUT_MS = readPositiveIntEnv("ANTHROPIC_TIMEOUT_MS", 30_000);
const ANTHROPIC_MAX_RETRIES = readPositiveIntEnv("ANTHROPIC_MAX_RETRIES", 1);

// Purposes that are cheap, high-volume, or latency-sensitive run at low effort.
const EFFORT_BY_PURPOSE = {
  roughEstimate: "low",
  analyticsInsight: "low",
};
const DEFAULT_EFFORT = "medium";

let cachedClient = null;
let cachedClientKey = null;

function readPositiveIntEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export class AnthropicResponseError extends Error {
  constructor(message, errorCode) {
    super(message);
    this.name = "AnthropicResponseError";
    this.errorCode = errorCode;
  }
}

export function hasAnthropicApiKey() {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

export function getAnthropicClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    return null;
  }

  if (!cachedClient || cachedClientKey !== apiKey) {
    cachedClient = new Anthropic({
      apiKey,
      timeout: ANTHROPIC_TIMEOUT_MS,
      maxRetries: ANTHROPIC_MAX_RETRIES,
    });
    cachedClientKey = apiKey;
  }

  return cachedClient;
}

export function getAnthropicModelName(purpose = "default") {
  const sharedModel = process.env.ANTHROPIC_MODEL_NAME?.trim();
  const overrides = {
    roughEstimate: process.env.ANTHROPIC_ROUGH_ESTIMATE_MODEL?.trim(),
    analyze: process.env.ANTHROPIC_ANALYZE_MODEL?.trim(),
    analyticsInsight: process.env.ANTHROPIC_ANALYTICS_MODEL?.trim(),
    refineRough: process.env.ANTHROPIC_REFINE_ROUGH_MODEL?.trim(),
  };

  return overrides[purpose] || sharedModel || DEFAULT_MODEL_NAME;
}

/**
 * Anthropic reports an exhausted credit balance as a 400 invalid_request_error
 * ("Your credit balance is too low ..."), not as a 402, so status alone is not
 * enough to tell billing apart from a malformed request.
 */
export function isAnthropicBillingError(error) {
  const message = typeof error?.message === "string" ? error.message : "";
  return /credit balance is too low|plans\s*&\s*billing|purchase credits/i.test(
    message,
  );
}

/**
 * Convert the Gemini-shaped parts every controller builds into Claude content
 * blocks: { text } -> text, { inlineData } -> base64 image.
 */
export function toAnthropicContent(parts) {
  if (typeof parts === "string") {
    return [{ type: "text", text: parts }];
  }

  const content = [];

  for (const part of parts) {
    if (typeof part?.text === "string") {
      content.push({ type: "text", text: part.text });
    } else if (part?.inlineData?.data) {
      content.push({
        type: "image",
        source: {
          type: "base64",
          media_type: part.inlineData.mimeType || "image/jpeg",
          data: part.inlineData.data,
        },
      });
    }
  }

  return content;
}

export async function generateAnthropicText(parts, options = {}) {
  const client = getAnthropicClient();
  if (!client) {
    throw new AnthropicResponseError(
      "ANTHROPIC_API_KEY is not configured",
      "AI_NOT_CONFIGURED",
    );
  }

  const purpose = options.purpose ?? "default";
  const modelName = options.anthropicModelName ?? getAnthropicModelName(purpose);
  const maxTokens =
    options.maxTokens ??
    (purpose === "roughEstimate" ? ROUGH_ESTIMATE_MAX_TOKENS : DEFAULT_MAX_TOKENS);

  // No temperature/top_p/top_k (rejected by current models) and no prefill.
  const response = await client.messages.create({
    model: modelName,
    max_tokens: maxTokens,
    output_config: { effort: EFFORT_BY_PURPOSE[purpose] ?? DEFAULT_EFFORT },
    messages: [{ role: "user", content: toAnthropicContent(parts) }],
  });

  if (response.stop_reason === "refusal") {
    throw new AnthropicResponseError(
      `Claude refused the request (${response.stop_details?.category ?? "unknown"})`,
      "AI_PROVIDER_REFUSAL",
    );
  }
  if (response.stop_reason === "max_tokens") {
    throw new AnthropicResponseError(
      "Claude response was truncated at max_tokens",
      "AI_PROVIDER_TRUNCATED",
    );
  }

  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");

  if (!text.trim()) {
    throw new AnthropicResponseError(
      "Claude returned an empty response",
      "AI_PROVIDER_EMPTY",
    );
  }

  return text;
}
