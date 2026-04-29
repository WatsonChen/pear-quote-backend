import { GoogleGenerativeAI } from "@google/generative-ai";

const DEFAULT_MODEL_NAME = "gemini-2.0-flash";
const DEFAULT_ROUGH_ESTIMATE_MODEL_NAME = "gemini-2.0-flash";
const DEFAULT_ANALYZE_MODEL_NAME = "gemini-2.0-flash";
const DEFAULT_ANALYTICS_MODEL_NAME = "gemini-2.0-flash";
const GEMINI_RETRY_DELAYS_MS = [450, 900];
const GEMINI_QUEUE_GAP_MS = readPositiveIntEnv("GEMINI_QUEUE_GAP_MS", 900);
const GEMINI_QUEUE_MAX_WAIT_MS = readPositiveIntEnv(
  "GEMINI_QUEUE_MAX_WAIT_MS",
  12_000,
);
const geminiCooldowns = new Map();

let geminiQueueTail = Promise.resolve();
let geminiNextAvailableAt = 0;

function readPositiveIntEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryDelaySeconds(rawValue) {
  if (typeof rawValue !== "string") return null;
  const match = rawValue.trim().match(/^(\d+(?:\.\d+)?)s$/i);
  if (!match) return null;

  const seconds = Number.parseFloat(match[1]);
  return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : null;
}

export class GeminiCooldownError extends Error {
  constructor(modelName, retryAfterSeconds) {
    super(
      `Gemini model ${modelName} is cooling down. Retry in about ${retryAfterSeconds} seconds.`,
    );
    this.name = "GeminiCooldownError";
    this.modelName = modelName;
    this.statusCode = 429;
    this.retryAfterSeconds = retryAfterSeconds;
    this.errorCode = "AI_RATE_LIMIT";
  }
}

export class GeminiQueueBusyError extends Error {
  constructor(retryAfterSeconds) {
    super(
      `Gemini queue is currently busy. Retry in about ${retryAfterSeconds} seconds.`,
    );
    this.name = "GeminiQueueBusyError";
    this.statusCode = 429;
    this.retryAfterSeconds = retryAfterSeconds;
    this.errorCode = "AI_QUEUE_BUSY";
  }
}

export function hasGeminiApiKey() {
  return Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim());
}

export function getGeminiClient() {
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim();
  if (!apiKey) {
    return null;
  }

  return new GoogleGenerativeAI(apiKey);
}

export function getGeminiModelName(purpose = "default") {
  const sharedModel = process.env.GEMINI_MODEL_NAME?.trim();
  const configuredModels = {
    roughEstimate:
      process.env.GEMINI_ROUGH_ESTIMATE_MODEL?.trim() ??
      sharedModel ??
      DEFAULT_ROUGH_ESTIMATE_MODEL_NAME,
    analyze:
      process.env.GEMINI_ANALYZE_MODEL?.trim() ??
      sharedModel ??
      DEFAULT_ANALYZE_MODEL_NAME,
    analyticsInsight:
      process.env.GEMINI_ANALYTICS_MODEL?.trim() ??
      sharedModel ??
      DEFAULT_ANALYTICS_MODEL_NAME,
    default: sharedModel ?? DEFAULT_MODEL_NAME,
  };

  return configuredModels[purpose] ?? configuredModels.default;
}

export function normalizeJsonResponse(text) {
  return text.replace(/```json\n?|```/g, "").trim();
}

export function extractGeminiStatusCode(error) {
  const directStatus =
    error?.status ??
    error?.statusCode ??
    error?.response?.status ??
    error?.cause?.status ??
    null;
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

export function extractGeminiRetryAfterSeconds(error, fallbackSeconds = 20) {
  const directValue =
    error?.retryAfterSeconds ??
    error?.response?.headers?.get?.("retry-after") ??
    error?.response?.headers?.["retry-after"] ??
    null;
  if (typeof directValue === "number" && Number.isFinite(directValue)) {
    return Math.max(1, Math.ceil(directValue));
  }
  if (typeof directValue === "string") {
    const parsed = Number.parseInt(directValue, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  const errorDetails = Array.isArray(error?.errorDetails) ? error.errorDetails : [];
  for (const detail of errorDetails) {
    if (
      detail?.["@type"] === "type.googleapis.com/google.rpc.RetryInfo" &&
      typeof detail.retryDelay === "string"
    ) {
      const parsed = parseRetryDelaySeconds(detail.retryDelay);
      if (parsed) return parsed;
    }
  }

  const message = typeof error?.message === "string" ? error.message : "";
  const retryMatch = message.match(/Please retry in\s+([\d.]+)s?/i);
  if (retryMatch) {
    const seconds = Number.parseFloat(retryMatch[1]);
    if (Number.isFinite(seconds) && seconds > 0) {
      return Math.ceil(seconds);
    }
  }

  return fallbackSeconds;
}

export function isGeminiTemporaryStatus(statusCode) {
  return (
    statusCode === 429 ||
    statusCode === 500 ||
    statusCode === 502 ||
    statusCode === 503 ||
    statusCode === 504
  );
}

function isGeminiModelUnavailableError(error) {
  const statusCode = extractGeminiStatusCode(error);
  if (statusCode === 404) {
    return true;
  }

  const message = typeof error?.message === "string" ? error.message : "";
  return (
    /not found for api version/i.test(message) ||
    /not supported for generatecontent/i.test(message) ||
    /models\/.+ is not found/i.test(message)
  );
}

function isGeminiTransportRetryableStatus(statusCode) {
  return statusCode === 500 || statusCode === 502 || statusCode === 503 || statusCode === 504;
}

function shouldTryNextGeminiModel(error) {
  if (!error) return false;

  if (error instanceof GeminiCooldownError) {
    return true;
  }

  if (error instanceof GeminiQueueBusyError) {
    return true;
  }

  const statusCode = extractGeminiStatusCode(error);
  return statusCode === 429 || isGeminiTransportRetryableStatus(statusCode);
}

function getGeminiCooldownSeconds(modelName) {
  const cooldownUntil = geminiCooldowns.get(modelName) ?? 0;
  const remainingMs = cooldownUntil - Date.now();
  if (remainingMs <= 0) {
    geminiCooldowns.delete(modelName);
    return 0;
  }

  return Math.ceil(remainingMs / 1000);
}

function markGeminiCooldownFromError(modelName, error, fallbackSeconds = 20) {
  const retryAfterSeconds = extractGeminiRetryAfterSeconds(
    error,
    fallbackSeconds,
  );
  geminiCooldowns.set(modelName, Date.now() + retryAfterSeconds * 1000);
  return retryAfterSeconds;
}

async function runGeminiQueue(task, maxQueueWaitMs) {
  const enqueuedAt = Date.now();
  let releaseQueueSlot;

  const queueSlot = new Promise((resolve) => {
    releaseQueueSlot = resolve;
  });

  const previousTail = geminiQueueTail.catch(() => {});
  geminiQueueTail = previousTail.finally(() => queueSlot);

  await previousTail;

  let enteredExecutionWindow = false;

  try {
    const waitedMs = Date.now() - enqueuedAt;
    if (waitedMs > maxQueueWaitMs) {
      throw new GeminiQueueBusyError(Math.max(1, Math.ceil(waitedMs / 1000)));
    }

    const gapMs = geminiNextAvailableAt - Date.now();
    if (gapMs > 0) {
      const projectedWaitMs = Date.now() - enqueuedAt + gapMs;
      if (projectedWaitMs > maxQueueWaitMs) {
        throw new GeminiQueueBusyError(
          Math.max(1, Math.ceil(projectedWaitMs / 1000)),
        );
      }
      await sleep(gapMs);
    }

    enteredExecutionWindow = true;
    return await task();
  } finally {
    if (enteredExecutionWindow) {
      geminiNextAvailableAt = Date.now() + GEMINI_QUEUE_GAP_MS;
    }
    releaseQueueSlot();
  }
}

export async function generateGeminiText(
  geminiClient,
  parts,
  options = {},
) {
  const modelName = options.modelName ?? getGeminiModelName("default");
  const fallbackModelNames = Array.isArray(options.fallbackModelNames)
    ? options.fallbackModelNames.filter(Boolean)
    : [];
  const responseMimeType = options.responseMimeType ?? null;
  const maxQueueWaitMs = options.maxQueueWaitMs ?? GEMINI_QUEUE_MAX_WAIT_MS;
  const candidateModelNames = Array.from(
    new Set([modelName, ...fallbackModelNames].filter(Boolean)),
  );

  let lastError = null;

  for (let index = 0; index < candidateModelNames.length; index += 1) {
    const candidateModelName = candidateModelNames[index];
    const cooldownBeforeQueue = getGeminiCooldownSeconds(candidateModelName);

    if (cooldownBeforeQueue > 0) {
      lastError = new GeminiCooldownError(
        candidateModelName,
        cooldownBeforeQueue,
      );
      if (index === candidateModelNames.length - 1) {
        throw lastError;
      }
      continue;
    }

    try {
      return await runGeminiQueue(async () => {
        const cooldownInsideQueue = getGeminiCooldownSeconds(candidateModelName);
        if (cooldownInsideQueue > 0) {
          throw new GeminiCooldownError(
            candidateModelName,
            cooldownInsideQueue,
          );
        }

        const modelOptions = { model: candidateModelName };
        if (responseMimeType) {
          modelOptions.generationConfig = { responseMimeType };
        }

        const model = geminiClient.getGenerativeModel(modelOptions);
        let candidateLastError = null;
        const totalAttempts = GEMINI_RETRY_DELAYS_MS.length + 1;

        for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
          try {
            const result = await model.generateContent(parts);
            const responseText = result.response.text();
            console.info(
              index > 0
                ? `[AI] Gemini request completed via fallback model ${candidateModelName} (primary: ${modelName}).`
                : `[AI] Gemini request completed via primary model ${candidateModelName}.`,
            );
            return responseText;
          } catch (error) {
            candidateLastError = error;
            const statusCode = extractGeminiStatusCode(error);

            if (statusCode === 429) {
              markGeminiCooldownFromError(candidateModelName, error);
              throw error;
            }

            if (
              !isGeminiTransportRetryableStatus(statusCode) ||
              attempt === totalAttempts
            ) {
              throw error;
            }

            const delay =
              GEMINI_RETRY_DELAYS_MS[attempt - 1] +
              Math.floor(Math.random() * 120);
            await sleep(delay);
          }
        }

        throw candidateLastError;
      }, maxQueueWaitMs);
    } catch (error) {
      lastError = error;

      if (
        (isGeminiModelUnavailableError(error) || shouldTryNextGeminiModel(error)) &&
        index < candidateModelNames.length - 1
      ) {
        const nextModelName = candidateModelNames[index + 1];
        console.warn(
          `[AI] Gemini model ${candidateModelName} failed (${error?.errorCode || extractGeminiStatusCode(error) || error?.name || "unknown"}). Falling back to ${nextModelName}.`,
        );
        continue;
      }

      throw error;
    }
  }

  throw lastError;
}

export async function generateGeminiJsonText(
  geminiClient,
  parts,
  options = {},
) {
  return generateGeminiText(geminiClient, parts, {
    ...options,
    responseMimeType: "application/json",
  });
}
