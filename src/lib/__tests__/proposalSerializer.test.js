/**
 * Tests for proposalSerializer.js — public proposal serializer hardening.
 * Run with: node src/lib/__tests__/proposalSerializer.test.js
 *
 * Hand-rolled assert harness (same convention as estimationBaselines.test.js).
 * No live DB, no HTTP server.
 *
 * Coverage:
 *   1. items do not contain hourlyRate
 *   2. items do not contain other internal pricing fields
 *   3. companyInfo does not contain taxId
 *   4. companyInfo does not contain internalCost / costRange / etc.
 *   5. Recursive forbidden-key scan across entire public response
 *   6. All expected public fields are present (regression guard)
 *   7. Items synthetic id is stable (shareToken + index)
 *   8. Accepted proposal serializes acceptedAt correctly
 *   9. Missing optional fields degrade gracefully (null, not throw)
 */

import {
  serializePublicProposal,
  buildCompanyInfo,
  buildBookingUrl,
  resolveOwnerUser,
  PUBLIC_PROPOSAL_FORBIDDEN_KEYS,
} from "../proposalSerializer.js";

// ── Hand-rolled assert harness ────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(label, condition, extra = "") {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${extra ? `  (${extra})` : ""}`);
    failed++;
  }
}

/** Recursively collect any forbidden keys anywhere in a structure. */
function findForbiddenKeys(value, forbidden, path = "root") {
  const hits = [];
  if (Array.isArray(value)) {
    value.forEach((item, i) =>
      hits.push(...findForbiddenKeys(item, forbidden, `${path}[${i}]`)),
    );
  } else if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (forbidden.has(k)) hits.push(`${path}.${k}`);
      else hits.push(...findForbiddenKeys(v, forbidden, `${path}.${k}`));
    }
  }
  return hits;
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeQuote(overrides = {}) {
  return {
    shareToken: "tok-abc123",
    proposalStatus: "draft",
    acceptedAt: null,
    customerName: "Acme Corp",
    contactEmail: null,
    projectName: "Portal Redesign",
    projectType: "web",
    expectedDays: 30,
    description: "A new client portal",
    totalAmount: 150000,
    paymentTerms: "50% upfront, 50% on delivery",
    validityDays: 30,
    createdAt: new Date("2026-07-01"),
    updatedAt: new Date("2026-07-10"),
    proposalContent: null,
    proposalTheme: null,
    customer: null,
    items: [
      {
        description: "Frontend development",
        estimatedHours: 80,
        suggestedRole: "Frontend Engineer",
        hourlyRate: 1500,                 // ← internal — must be stripped
        aiSuggestedHourlyRate: 1400,      // ← internal — must be stripped
        configuredHourlyRate: 1500,       // ← internal — must be stripped
        rateSource: "workspace_config",   // ← internal — must be stripped
        amount: 120000,
        type: "service",
        unit: null,
      },
      {
        description: "Backend API",
        estimatedHours: 40,
        suggestedRole: "Backend Engineer",
        hourlyRate: 1800,
        aiSuggestedHourlyRate: 1700,
        configuredHourlyRate: 1800,
        rateSource: "workspace_config",
        amount: 72000,
        type: "service",
        unit: null,
      },
    ],
    workspace: {
      settings: {
        companyName: "Dev Studio",
        contactEmail: "hello@devstudio.com",
        taxId: "12345678",               // ← internal — must be stripped from public
        companySealUrl: null,
        quoteValidityDays: 30,
      },
      users: [
        {
          role: "OWNER",
          user: { email: "owner@devstudio.com", bookingUrl: "https://cal.com/owner" },
        },
      ],
    },
    ...overrides,
  };
}

// ── [1] items do not contain hourlyRate ───────────────────────────────────────
console.log("\n[1] items must not contain hourlyRate");
{
  const result = serializePublicProposal(makeQuote());
  for (const item of result.quote.items) {
    assert("item has no hourlyRate", !("hourlyRate" in item));
    assert("item has no aiSuggestedHourlyRate", !("aiSuggestedHourlyRate" in item));
    assert("item has no configuredHourlyRate", !("configuredHourlyRate" in item));
    assert("item has no rateSource", !("rateSource" in item));
  }
}

// ── [2] companyInfo does not contain taxId ────────────────────────────────────
console.log("\n[2] companyInfo must not expose taxId");
{
  const result = serializePublicProposal(makeQuote());
  assert("companyInfo has no taxId", !("taxId" in result.companyInfo));
  assert("companyInfo has name", result.companyInfo.name === "Dev Studio");
  assert("companyInfo has email", result.companyInfo.email === "hello@devstudio.com");
  assert("companyInfo has quoteValidityDays", result.companyInfo.quoteValidityDays === 30);
}

// ── [3] Recursive forbidden-key scan ─────────────────────────────────────────
console.log("\n[3] Recursive forbidden-key scan across entire public response");
{
  const result = serializePublicProposal(makeQuote());
  const hits = findForbiddenKeys(result, PUBLIC_PROPOSAL_FORBIDDEN_KEYS);
  assert(
    `zero forbidden keys in public response (found: ${hits.join(", ") || "none"})`,
    hits.length === 0,
  );
}

// ── [4] Expected public fields are present ────────────────────────────────────
console.log("\n[4] Expected public fields are present");
{
  const result = serializePublicProposal(makeQuote());

  // Top-level keys
  for (const key of ["shareToken", "proposalStatus", "acceptedAt", "bookingUrl", "ownerEmail", "proposalContent", "proposalTheme", "quote", "companyInfo"]) {
    assert(`top-level key "${key}" present`, key in result);
  }

  // quote sub-keys
  for (const key of ["id", "shareToken", "customerName", "projectName", "totalAmount", "items", "createdAt", "updatedAt", "proposalStatus"]) {
    assert(`quote.${key} present`, key in result.quote);
  }

  // item sub-keys (safe ones only)
  const item = result.quote.items[0];
  for (const key of ["id", "description", "estimatedHours", "suggestedRole", "amount", "type"]) {
    assert(`item.${key} present`, key in item);
  }
}

// ── [5] Item id is stable (shareToken-based) ──────────────────────────────────
console.log("\n[5] Item synthetic id");
{
  const result = serializePublicProposal(makeQuote());
  assert("item[0].id = shareToken-1", result.quote.items[0].id === "tok-abc123-1");
  assert("item[1].id = shareToken-2", result.quote.items[1].id === "tok-abc123-2");
}

// ── [6] Accepted proposal serializes correctly ────────────────────────────────
console.log("\n[6] Accepted proposal");
{
  const acceptedAt = new Date("2026-07-15T10:00:00Z");
  const result = serializePublicProposal(makeQuote({ proposalStatus: "accepted", acceptedAt }));
  assert("proposalStatus is accepted", result.proposalStatus === "accepted");
  assert("acceptedAt is set", result.acceptedAt?.getTime() === acceptedAt.getTime());
  assert("quote.proposalStatus is accepted", result.quote.proposalStatus === "accepted");
}

// ── [7] Missing optional fields degrade gracefully ───────────────────────────
console.log("\n[7] Missing optional fields");
{
  const sparse = makeQuote({
    expectedDays: null,
    description: null,
    totalAmount: null,
    customer: null,
    proposalContent: null,
    proposalTheme: null,
    items: [],
    workspace: {
      settings: {},
      users: [],
    },
  });
  let threw = false;
  let result;
  try {
    result = serializePublicProposal(sparse);
  } catch (e) {
    threw = true;
  }
  assert("does not throw on sparse quote", !threw);
  assert("items is empty array", Array.isArray(result?.quote?.items) && result.quote.items.length === 0);
  assert("companyInfo.name falls back to PearQuote", result?.companyInfo?.name === "PearQuote");
  assert("bookingUrl is null when no owner", result?.bookingUrl === null);
}

// ── [8] bookingUrl falls back to mailto ───────────────────────────────────────
console.log("\n[8] bookingUrl fallback");
{
  const noBooking = makeQuote({
    workspace: {
      settings: { companyName: "X", contactEmail: "x@x.com" },
      users: [{ role: "OWNER", user: { email: "owner@x.com", bookingUrl: null } }],
    },
  });
  const result = serializePublicProposal(noBooking);
  assert("bookingUrl falls back to mailto", result.bookingUrl === "mailto:owner@x.com");
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(60)}`);
console.log(`proposalSerializer: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
