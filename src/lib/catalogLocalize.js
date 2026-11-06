/**
 * The estimate catalog (module names, assumptions, exclusions, missing-info
 * prompts) is written in Traditional Chinese. For an English brief those lines
 * would reach the client untranslated, so they are translated once per phrase
 * and remembered: the catalog is static, so each phrase costs one translation
 * for the life of the server.
 */
import { generateAiJsonText } from "./llm.js";

const HAN = /[㐀-鿿]/;
const cache = new Map();

export function hasHan(text) {
  return typeof text === "string" && HAN.test(text);
}

/** Distinct Chinese lines found in the strings or string arrays given. */
export function collectChineseTexts(values) {
  const found = new Set();
  const visit = (value) => {
    if (Array.isArray(value)) value.forEach(visit);
    else if (hasHan(value)) found.add(value);
  };
  visit(values);
  return [...found];
}

async function translateWithAi(texts) {
  const prompt = `Translate each Traditional Chinese phrase below into concise, professional English for a software project estimate shown to a client.
Return ONLY a JSON object that maps each exact input phrase to its English translation. Keep technical terms (API, CMS, RBAC) as they are.

${JSON.stringify(texts)}`;
  const raw = await generateAiJsonText([{ text: prompt }], { purpose: "analyze", temperature: 0 });
  const cleaned = String(raw).replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  return JSON.parse(cleaned);
}

/**
 * @param {string[]} texts Chinese lines
 * @param {(texts: string[]) => Promise<Record<string,string>>} [translate] injectable for tests
 * @returns {Promise<Map<string,string>>} line → English (lines that failed are absent)
 */
export async function translateCatalogTexts(texts, translate = translateWithAi) {
  const result = new Map();
  const missing = [];
  for (const text of texts) {
    if (cache.has(text)) result.set(text, cache.get(text));
    else missing.push(text);
  }
  if (missing.length > 0) {
    try {
      const translated = await translate(missing);
      for (const text of missing) {
        const english = translated?.[text];
        if (typeof english === "string" && english.trim() && !hasHan(english)) {
          cache.set(text, english.trim());
          result.set(text, english.trim());
        }
      }
    } catch (error) {
      // A failed translation keeps the original line rather than failing the estimate.
      console.warn("[catalogLocalize] translation failed:", error?.message || error);
    }
  }
  return result;
}

const swap = (value, map) =>
  Array.isArray(value) ? value.map((item) => swap(item, map)) : typeof value === "string" ? map.get(value) ?? value : value;

/** English copy of the estimate modules: baseline name, assumptions, exclusions, missing info. */
export async function localizeModules(modules, translate) {
  const fields = ["baselineName", "assumptions", "exclusions", "missingInfo"];
  const texts = collectChineseTexts(modules.flatMap((m) => fields.map((f) => m[f])));
  if (texts.length === 0) return modules;
  const map = await translateCatalogTexts(texts, translate);
  return modules.map((m) => {
    const next = { ...m };
    for (const f of fields) next[f] = swap(m[f], map);
    return next;
  });
}

/** "Do you need X" → a question; anything else becomes a request. */
export function buildEnglishQuestions(items) {
  return items.map((item) => {
    const s = String(item).trim();
    if (/\?$/.test(s)) return s;
    if (/^(is|are|do|does|will|whether|need|any|should|can)\b/i.test(s)) return `${s.replace(/[.。]$/, "")}?`;
    if (/^please\b/i.test(s)) return s;
    return `Please provide: ${s}`;
  });
}

export const RISK_FLAGS = {
  thirdParty: { zh: "包含第三方 API 或高風險整合，已套用風險係數", en: "Includes third-party APIs or high-risk integrations; a risk factor is applied" },
  payment: { zh: "金流模組 QA 比重高，建議預留沙箱測試時間", en: "Payments need heavy QA; allow time for sandbox testing" },
  rbac: { zh: "權限系統複雜度易被低估，建議在 kickoff 前確認角色矩陣", en: "Permissions are easy to underestimate; confirm the role matrix before kickoff" },
  sharing: { zh: "含公開分享或狀態追蹤，需確認存取控制與資安需求", en: "Includes public sharing or status tracking; confirm access control and security needs" },
  ai: { zh: "AI 功能受 LLM provider 穩定性影響，建議設計 fallback 機制", en: "AI features depend on the LLM provider's stability; design a fallback" },
  vague: { zh: "整體需求描述不足，估算範圍較大，建議補充 missingInfo 後重新估算", en: "The brief is thin, so the range is wide; add the missing details and re-estimate" },
};

export function buildRiskSummary(flags, locale) {
  if (locale !== "en") return null;
  if (!Array.isArray(flags) || flags.length === 0) {
    return "The estimate uses common modules with normal risk factors, so confidence is relatively high.";
  }
  const intro = flags.length === 1 ? "This estimate has one point to note" : `This estimate has ${flags.length} points to note`;
  return `${intro}: ${flags.join("; ")}. Confirm these with the client before quoting and leave room to adjust.`;
}
