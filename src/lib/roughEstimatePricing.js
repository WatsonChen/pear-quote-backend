/**
 * Deterministic pricing for the public rough estimate.
 *
 * The model is good at scoping work (which modules, how many hours each) but
 * not at producing a stable price: the same brief moved by ~30% between runs.
 * So the model only reports hours plus any rates/budget the client stated, and
 * the price is derived here from those hours.
 */

export const DEFAULT_HOURLY_RATE = { USD: 55, TWD: 1800 };
const RATE_BOUNDS = { USD: [10, 1000], TWD: [200, 20_000] };
const PRICE_ROUNDING = { USD: 500, TWD: 5000 };
// Quantise mid-point hours to whole work weeks so run-to-run jitter in the
// model's hour counts does not become price jitter.
const HOURS_BUCKET = 40;
const MAX_ITEM_HOURS = 2000;
// Band around the mid-point; the less certain the brief, the wider the range.
const QUALITY_BANDS = {
  clear: [0.85, 1.2],
  partial: [0.8, 1.3],
  vague: [0.6, 1.6],
};
export const VAGUE_CONFIDENCE_CAP = 62;

function toPositiveNumber(value) {
  const number = typeof value === "string" ? Number.parseFloat(value) : value;
  return typeof number === "number" && Number.isFinite(number) && number > 0
    ? number
    : null;
}

function roundTo(value, step) {
  return Math.round(value / step) * step;
}

export function normalizeCurrency(value, fallback) {
  const upper = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (upper === "USD" || upper === "TWD") return upper;
  if (upper === "NTD" || upper === "NT$") return "TWD";
  return fallback;
}

export function normalizeBriefQuality(value) {
  return value === "clear" || value === "vague" ? value : "partial";
}

/** "18–28h" / "18-28 h" / "20h" -> { min, max } */
export function parseEffortHours(effort) {
  if (typeof effort !== "string") return null;

  const range = effort.match(/(\d+(?:\.\d+)?)\s*[–—-]\s*(\d+(?:\.\d+)?)/);
  if (range) {
    return { min: Number.parseFloat(range[1]), max: Number.parseFloat(range[2]) };
  }

  const single = effort.match(/(\d+(?:\.\d+)?)/);
  if (single) {
    const hours = Number.parseFloat(single[1]);
    return { min: hours, max: hours };
  }

  return null;
}

/**
 * Give every breakdown item numeric hours (from the model's numbers, else from
 * its effort string) and rewrite the display string so both always agree.
 * Returns null when no item has usable hours.
 */
export function normalizeBreakdownHours(breakdown) {
  if (!Array.isArray(breakdown) || breakdown.length === 0) return null;

  let usable = 0;
  const items = breakdown.map((item) => {
    const parsed = parseEffortHours(item?.effort);
    const min = toPositiveNumber(item?.effortMinHours) ?? parsed?.min ?? null;
    const max = toPositiveNumber(item?.effortMaxHours) ?? parsed?.max ?? null;
    if (min == null || max == null) return { ...item };

    const low = Math.min(Math.round(Math.min(min, max)), MAX_ITEM_HOURS);
    const high = Math.min(Math.round(Math.max(min, max)), MAX_ITEM_HOURS);
    usable += 1;
    return {
      ...item,
      effortMinHours: low,
      effortMaxHours: high,
      effort: low === high ? `${low}h` : `${low}–${high}h`,
    };
  });

  return usable === breakdown.length ? items : null;
}

/**
 * Use hourly rates only if the client stated them in the brief; otherwise fall
 * back to a default and say so. Rates are averaged because the model's hours
 * are per phase, not per role.
 */
export function resolveHourlyRate(statedRates, currency) {
  const [low, high] = RATE_BOUNDS[currency];
  const rates = (Array.isArray(statedRates) ? statedRates : [])
    .map((entry) => toPositiveNumber(entry?.rate ?? entry?.hourlyRate))
    .filter((rate) => rate != null && rate >= low && rate <= high);

  if (rates.length === 0) {
    return { rate: DEFAULT_HOURLY_RATE[currency], source: "default" };
  }

  const average = rates.reduce((sum, rate) => sum + rate, 0) / rates.length;
  return { rate: Math.round(average), source: "stated" };
}

export function computePriceRange({ breakdown, quality, currency, rate }) {
  const minHours = breakdown.reduce((sum, item) => sum + item.effortMinHours, 0);
  const maxHours = breakdown.reduce((sum, item) => sum + item.effortMaxHours, 0);
  if (!(maxHours > 0)) return null;

  const midHours = Math.max(
    HOURS_BUCKET,
    roundTo((minHours + maxHours) / 2, HOURS_BUCKET),
  );
  const [lowFactor, highFactor] = QUALITY_BANDS[normalizeBriefQuality(quality)];
  const step = PRICE_ROUNDING[currency];
  const min = roundTo(midHours * rate * lowFactor, step);
  const max = Math.max(roundTo(midHours * rate * highFactor, step), min + step);

  return { minHours, maxHours, midHours, min, max };
}

function formatMoney(amount, currency) {
  return currency === "TWD"
    ? `NT$${amount.toLocaleString("en-US")}`
    : `$${amount.toLocaleString("en-US")}`;
}

export function formatPriceRange(min, max, currency) {
  return `${formatMoney(min, currency)} - ${formatMoney(max, currency)}`;
}

export function buildRateSentence({ rate, source, currency, useChinese }) {
  const amount = formatMoney(rate, currency);
  if (source === "stated") {
    return useChinese
      ? `價格依您提供的時薪（平均 ${amount}/小時）計算。`
      : `Priced at your stated hourly rates (average ${amount}/hr).`;
  }
  return useChinese
    ? `價格以預設時薪 ${amount}/小時概算，未採用您的內部費率。`
    : `Priced at a default ${amount}/hr; your internal rates were not provided, so none were applied.`;
}

/**
 * Report, never bend to, the client's budget. Returns null when no budget was
 * stated or its currency differs from the estimate's.
 */
export function buildBudgetSentence({
  budget,
  budgetCurrency,
  currency,
  min,
  max,
  useChinese,
}) {
  const amount = toPositiveNumber(budget);
  if (amount == null || normalizeCurrency(budgetCurrency, currency) !== currency) {
    return null;
  }

  const label = formatMoney(amount, currency);
  if (min > amount) {
    return useChinese
      ? `此估價高於您提到的預算 ${label}，需縮減範圍或調整時程。`
      : `This estimate is above your stated budget of ${label}; scope or timeline would need to be reduced.`;
  }
  if (max > amount) {
    return useChinese
      ? `估價上限可能超出您提到的預算 ${label}，需確認範圍後才能判斷。`
      : `The upper end may exceed your stated budget of ${label}; scope needs confirming.`;
  }
  return null;
}

export function buildVagueBriefAssumption({ missingInfo, useChinese }) {
  const questions = (Array.isArray(missingInfo) ? missingInfo : [])
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean)
    .slice(0, 3);

  if (questions.length === 0) {
    return useChinese
      ? "需求描述過於簡短，無法給出可靠報價；請補充主要功能、平台與時程。"
      : "The brief is too short for a reliable quote; please add the main features, platforms, and timeline.";
  }

  return useChinese
    ? `需求資訊不足，請先確認：${questions.join("；")}`
    : `Not enough detail for a reliable quote. Please confirm: ${questions.join("; ")}`;
}

/**
 * Replace the model's own price/time-effort numbers with the deterministic
 * ones and fold rate, budget and thin-brief disclosures into the fields the
 * landing page already renders (`note`, `assumptions`).
 *
 * Returns { result, quality, applied }. When the model gave no usable hours the
 * result is returned untouched (`applied: false`) so we never invent a price.
 */
export function applyRoughEstimatePricing(parsed, { useChinese }) {
  const quality = normalizeBriefQuality(parsed?.briefQuality);
  const breakdown = normalizeBreakdownHours(parsed?.breakdown);
  const currency = normalizeCurrency(parsed?.currency, useChinese ? "TWD" : "USD");
  if (!breakdown) return { result: parsed, quality, applied: false };

  const { rate, source } = resolveHourlyRate(parsed?.statedHourlyRates, currency);
  const price = computePriceRange({ breakdown, quality, currency, rate });
  if (!price) return { result: parsed, quality, applied: false };

  const budget = parsed?.statedBudget;
  const budgetSentence = buildBudgetSentence({
    budget: typeof budget === "object" ? budget?.amount : budget,
    budgetCurrency: typeof budget === "object" ? budget?.currency : undefined,
    currency,
    min: price.min,
    max: price.max,
    useChinese,
  });

  const assumptions = Array.isArray(parsed?.assumptions) ? [...parsed.assumptions] : [];
  if (quality === "vague") {
    assumptions.unshift(
      buildVagueBriefAssumption({ missingInfo: parsed?.missingInfo, useChinese }),
    );
  }

  const {
    statedHourlyRates: _rates,
    statedBudget: _budget,
    missingInfo: _missing,
    briefQuality: _quality,
    currency: _currency,
    ...rest
  } = parsed;

  return {
    quality,
    applied: true,
    result: {
      ...rest,
      breakdown,
      priceRange: formatPriceRange(price.min, price.max, currency),
      assumptions: assumptions.slice(0, 3),
      note: [
        typeof parsed.note === "string" ? parsed.note.trim() : "",
        buildRateSentence({ rate, source, currency, useChinese }),
        budgetSentence,
      ]
        .filter(Boolean)
        .join(" "),
    },
  };
}
