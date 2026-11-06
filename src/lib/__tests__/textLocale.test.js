/**
 * Tests for textLocale.js. Run with: node src/lib/__tests__/textLocale.test.js
 */
import assert from "node:assert/strict";
import { detectTextLocale, outputLanguageOverride } from "../textLocale.js";

const english =
  "Client: Bright Smile Dental, a 3-clinic dental group in Taipei. They want online booking with LINE login, reminders and a front-desk dashboard.";
const chinese = "客戶是一間三分店的牙醫診所，希望做線上預約、LINE 提醒與櫃檯儀表板，三個月內上線，資料要留在台灣。";
const mixed = "我們需要一個 booking system，包含 LINE 登入、提醒與後台儀表板，也要能匯出到 DentalOne，三個月內上線。";

assert.equal(detectTextLocale(english), "en");
assert.equal(detectTextLocale(chinese), "zh-TW");
assert.equal(detectTextLocale(mixed), "zh-TW");
assert.equal(detectTextLocale("hi"), "zh-TW");
assert.equal(detectTextLocale("hi", "en"), "en");
assert.equal(detectTextLocale(null), "zh-TW");

assert.equal(outputLanguageOverride("zh-TW"), "");
assert.match(outputLanguageOverride("en"), /English/);

console.log("textLocale: all tests passed");
