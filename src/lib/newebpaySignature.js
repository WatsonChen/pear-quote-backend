import crypto from "crypto";

/** The signature NewebPay puts on a TradeInfo string. */
export function tradeSha(tradeInfo, hashKey, hashIv) {
  return crypto
    .createHash("sha256")
    .update(`HashKey=${hashKey}&${tradeInfo}&HashIV=${hashIv}`)
    .digest("hex")
    .toUpperCase();
}

/** True only when `given` is the signature of `tradeInfo` under our keys. Fails closed without keys. */
export function isValidTradeSha(tradeInfo, given, { hashKey, hashIv }) {
  if (!hashKey || !hashIv) return false;
  if (typeof tradeInfo !== "string" || typeof given !== "string") return false;
  const expected = Buffer.from(tradeSha(tradeInfo, hashKey, hashIv));
  const actual = Buffer.from(given.toUpperCase());
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

/** The checkout page language: English when the buyer was on the English site, else Chinese. */
export function checkoutLangType(returnPath) {
  return /^\/en(\/|\?|#|$)/.test(String(returnPath || "")) ? "en" : "zh-tw";
}

/** A buyer email worth sending to the gateway for the receipt, or "" when it does not look like one. */
export function receiptEmail(email) {
  const value = String(email || "").trim();
  return value.length <= 100 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : "";
}
