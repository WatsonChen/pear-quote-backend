/**
 * Tests for newebpaySignature.js — the webhook must accept only what the gateway signed.
 * Run with: node src/lib/__tests__/newebpaySignature.test.js
 */
import assert from "node:assert/strict";
import { checkoutLangType, isValidTradeSha, receiptEmail, tradeSha } from "../newebpaySignature.js";

let passed = 0;
const test = (name, fn) => {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
};
const keys = { hashKey: "k".repeat(32), hashIv: "i".repeat(16) };
const info = "abcdef0123456789";

test("accepts the signature computed with our keys", () => {
  assert.equal(isValidTradeSha(info, tradeSha(info, keys.hashKey, keys.hashIv), keys), true);
});
test("is case-insensitive about the given signature", () => {
  assert.equal(isValidTradeSha(info, tradeSha(info, keys.hashKey, keys.hashIv).toLowerCase(), keys), true);
});
test("rejects an altered TradeInfo", () => {
  const sha = tradeSha(info, keys.hashKey, keys.hashIv);
  assert.equal(isValidTradeSha(info + "0", sha, keys), false);
});
test("rejects a signature made with other keys", () => {
  assert.equal(isValidTradeSha(info, tradeSha(info, "x".repeat(32), keys.hashIv), keys), false);
});
test("rejects missing or non-string input", () => {
  assert.equal(isValidTradeSha(info, undefined, keys), false);
  assert.equal(isValidTradeSha(undefined, "AB", keys), false);
  assert.equal(isValidTradeSha(info, "AB", keys), false);
});
test("fails closed when our keys are not configured", () => {
  const sha = tradeSha(info, undefined, undefined);
  assert.equal(isValidTradeSha(info, sha, { hashKey: undefined, hashIv: undefined }), false);
});
test("checkout page is English only for the English site", () => {
  assert.equal(checkoutLangType("/en/admin/settings?tab=billing"), "en");
  assert.equal(checkoutLangType("/en"), "en");
  assert.equal(checkoutLangType("/admin/settings?tab=billing"), "zh-tw");
  assert.equal(checkoutLangType("/english/admin"), "zh-tw");
  assert.equal(checkoutLangType(undefined), "zh-tw");
});
test("receipt email is passed on only when it looks like an email", () => {
  assert.equal(receiptEmail(" a@b.co "), "a@b.co");
  assert.equal(receiptEmail("not an email"), "");
  assert.equal(receiptEmail(undefined), "");
});
console.log(`\n${passed} passed`);
