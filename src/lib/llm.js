import {
  extractGeminiRetryAfterSeconds,
  extractGeminiStatusCode,
  generateGeminiJsonText,
  generateGeminiText,
  getGeminiClient,
  getGeminiModelName,
  hasGeminiApiKey,
} from "./gemini.js";
import {
  generateAnthropicText,
  hasAnthropicApiKey,
  isAnthropicBillingError,
} from "./anthropic.js";

const DEFAULT_PROVIDER_ORDER = ["anthropic", "gemini"];
const BILLING_COOLDOWN_MS = readPositiveIntEnv(
  "AI_PROVIDER_BILLING_COOLDOWN_MS",
  10 * 60 * 1000,
);
const DEFAULT_RATE_LIMIT_COOLDOWN_SECONDS = 20;
const BILLING_STATUSES = [401, 402, 403];
// Errors our own provider adapters raise for a successful-but-unusable response.
const FAILOVER_ERROR_CODES = new Set([
  "AI_PROVIDER_REFUSAL",
  "AI_PROVIDER_TRUNCATED",
  "AI_PROVIDER_EMPTY",
  "AI_RATE_LIMIT",
  "AI_QUEUE_BUSY",
]);
const NETWORK_ERROR_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ENOTFOUND",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "UND_ERR_CONNECT_TIMEOUT",
]);

const providerCooldowns = new Map();

function readPositiveIntEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

const PROVIDERS = {
  anthropic: {
    name: "anthropic",
    isConfigured: hasAnthropicApiKey,
    generate: (parts, options) => generateAnthropicText(parts, options),
  },
  gemini: {
    name: "gemini",
    isConfigured: hasGeminiApiKey,
    generate: (parts, options) => {
      const generate = options.json ? generateGeminiJsonText : generateGeminiText;
      return generate(getGeminiClient(), parts, {
        modelName: options.modelName ?? getGeminiModelName(options.purpose),
        fallbackModelNames: options.fallbackModelNames,
        maxQueueWaitMs: options.maxQueueWaitMs,
        temperature: options.temperature,
      });
    },
  },
};

export class AiProvidersExhaustedError extends Error {
  constructor(attempts, representative) {
    super(
      `All AI providers failed: ${attempts
        .map((a) => `${a.provider}=${a.reason}(${a.status ?? "-"})`)
        .join(", ")}`,
    );
    this.name = "AiProvidersExhaustedError";
    this.attempts = attempts;
    this.status = representative?.status ?? null;
    this.statusCode = this.status;
    this.errorCode = representative?.errorCode ?? "AI_PROVIDERS_EXHAUSTED";
    this.retryAfterSeconds = representative?.retryAfterSeconds;
  }
}

export class AiNotConfiguredError extends Error {
  constructor() {
    super("No AI provider is configured (set ANTHROPIC_API_KEY or GOOGLE_GENERATIVE_AI_API_KEY)");
    this.name = "AiNotConfiguredError";
    this.status = 500;
    this.statusCode = 500;
    this.errorCode = "AI_NOT_CONFIGURED";
  }
}

export function getAiProviderOrder() {
  const configured = (process.env.AI_PROVIDER_ORDER ?? "")
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .filter((name) => PROVIDERS[name]);
  const order = Array.from(new Set(configured));

  return order.length > 0 ? order : DEFAULT_PROVIDER_ORDER;
}

export function hasAiApiKey() {
  return getAiProviderOrder().some((name) => PROVIDERS[name].isConfigured());
}

// Gemini reports a bad key as 400 API_KEY_INVALID, which is an auth problem.
function isInvalidApiKeyError(error) {
  const message = typeof error?.message === "string" ? error.message : "";
  return /API key not valid|API_KEY_INVALID/i.test(message);
}

function isNetworkError(error) {
  if (NETWORK_ERROR_CODES.has(error?.code) || NETWORK_ERROR_CODES.has(error?.cause?.code)) {
    return true;
  }
  const message = typeof error?.message === "string" ? error.message : "";
  return (
    error?.name === "APIConnectionError" ||
    error?.name === "APIConnectionTimeoutError" ||
    /fetch failed|network|timed? ?out/i.test(message)
  );
}

/**
 * Decide whether another provider should get a chance. Billing/auth problems,
 * rate limits, overload, retired models and network failures are provider
 * problems; any other 400 is our request and would fail elsewhere too.
 */
export function classifyProviderError(error) {
  const rawStatus = extractGeminiStatusCode(error);
  const billing =
    BILLING_STATUSES.includes(rawStatus) ||
    isAnthropicBillingError(error) ||
    isInvalidApiKeyError(error);

  if (billing) {
    return {
      failover: true,
      reason: "billing_or_auth",
      status: BILLING_STATUSES.includes(rawStatus) ? rawStatus : 402,
    };
  }
  if (rawStatus === 429) {
    return { failover: true, reason: "rate_limited", status: 429 };
  }
  if (rawStatus === 404) {
    return { failover: true, reason: "model_unavailable", status: 404 };
  }
  if (rawStatus === 408 || (rawStatus != null && rawStatus >= 500)) {
    return { failover: true, reason: "unavailable", status: rawStatus };
  }
  if (FAILOVER_ERROR_CODES.has(error?.errorCode)) {
    return { failover: true, reason: error.errorCode, status: rawStatus };
  }
  if (isNetworkError(error)) {
    return { failover: true, reason: "network", status: rawStatus };
  }

  return { failover: false, reason: "request_error", status: rawStatus };
}

function describeError(error) {
  const message = typeof error?.message === "string" ? error.message : String(error);
  return message.replace(/\s+/g, " ").slice(0, 200);
}

function cooldownSecondsRemaining(cooldowns, providerName, now) {
  const until = cooldowns.get(providerName) ?? 0;
  const remainingMs = until - now;
  if (remainingMs <= 0) {
    cooldowns.delete(providerName);
    return 0;
  }
  return Math.ceil(remainingMs / 1000);
}

function startCooldown(cooldowns, providerName, classification, error, now) {
  if (classification.reason === "billing_or_auth") {
    cooldowns.set(providerName, now + BILLING_COOLDOWN_MS);
  } else if (classification.reason === "rate_limited") {
    const seconds = extractGeminiRetryAfterSeconds(
      error,
      DEFAULT_RATE_LIMIT_COOLDOWN_SECONDS,
    );
    cooldowns.set(providerName, now + seconds * 1000);
  }
}

/**
 * Try providers in order until one answers. Exported with injectable providers
 * and cooldown state so failover can be tested without any network.
 */
export async function runAiChain({
  providers,
  parts,
  options = {},
  cooldowns = providerCooldowns,
  now = Date.now,
  log = console,
}) {
  const configured = providers.filter((provider) => provider.isConfigured());
  if (configured.length === 0) {
    throw new AiNotConfiguredError();
  }

  // A stale cooldown must never take every provider out at once.
  const available = configured.filter(
    (provider) => cooldownSecondsRemaining(cooldowns, provider.name, now()) === 0,
  );
  const candidates = available.length > 0 ? available : configured;

  const attempts = [];
  let representative = null;

  for (const provider of candidates) {
    try {
      const text = await provider.generate(parts, options);
      log.info(
        `[AI] provider=${provider.name} purpose=${options.purpose ?? "default"} status=ok` +
          (attempts.length > 0 ? ` (after ${attempts.length} failed provider(s))` : ""),
      );
      return text;
    } catch (error) {
      const classification = classifyProviderError(error);
      log.warn(
        `[AI] provider=${provider.name} purpose=${options.purpose ?? "default"} ` +
          `status=${classification.status ?? "-"} reason=${classification.reason} ` +
          `failover=${classification.failover} message="${describeError(error)}"`,
      );

      if (!classification.failover) {
        throw error;
      }

      startCooldown(cooldowns, provider.name, classification, error, now());
      const attempt = {
        provider: provider.name,
        reason: classification.reason,
        status: classification.status,
      };
      attempts.push(attempt);

      const candidate = {
        status: classification.status,
        errorCode: error?.errorCode,
        retryAfterSeconds: error?.retryAfterSeconds,
      };
      // Prefer a rate-limit signal so callers can show the "try again shortly"
      // fallback; otherwise the most recent failure is the most relevant.
      if (!representative || representative.status !== 429 || candidate.status === 429) {
        representative = candidate;
      }
    }
  }

  throw new AiProvidersExhaustedError(attempts, representative);
}

export function generateAiText(parts, options = {}) {
  const providers = getAiProviderOrder().map((name) => PROVIDERS[name]);
  return runAiChain({ providers, parts, options });
}

export function generateAiJsonText(parts, options = {}) {
  return generateAiText(parts, { ...options, json: true });
}
