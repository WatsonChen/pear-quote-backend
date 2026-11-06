/**
 * Which language a piece of client text is written in. The AI steps that read a
 * brief answer in that language, so an English brief gets an English quote and
 * proposal instead of Chinese by default.
 */

const HAN = /[㐀-鿿]/g;
const LATIN = /[A-Za-z]/g;

/**
 * @param {unknown} text
 * @param {"zh-TW"|"en"} fallback used when there is too little text to judge
 * @returns {"zh-TW"|"en"}
 */
export function detectTextLocale(text, fallback = "zh-TW") {
  const value = typeof text === "string" ? text.slice(0, 4000) : "";
  const han = (value.match(HAN) || []).length;
  const latin = (value.match(LATIN) || []).length;
  if (han + latin < 20) return fallback;
  return han / (han + latin) > 0.15 ? "zh-TW" : "en";
}

/**
 * Appended to the end of a prompt. The prompts are written for Traditional
 * Chinese output; for English this overrides every language instruction above.
 */
export function outputLanguageOverride(locale) {
  if (locale !== "en") return "";
  return `

OUTPUT LANGUAGE OVERRIDE (highest priority): the client's brief is in English. Write EVERY human-readable text field of the JSON in clear, professional English, and ignore any earlier instruction to use Traditional Chinese. Keep JSON keys and enum values exactly as specified.`;
}
