/**
 * Public proposal serializer.
 *
 * WHITELIST APPROACH: every field returned is explicitly listed.
 * Internal pricing fields (hourlyRate, internalRange, calibration data, etc.)
 * are never included — they must only exist on authenticated admin responses.
 */

export function resolveOwnerUser(workspace) {
  const workspaceUsers = workspace?.users || [];
  return (
    workspaceUsers.find((item) => item.role === "OWNER")?.user ||
    workspaceUsers[0]?.user ||
    null
  );
}

export function buildBookingUrl(user) {
  if (user?.bookingUrl) {
    return user.bookingUrl;
  }
  return user?.email ? `mailto:${user.email}` : null;
}

export function buildCompanyInfo(settings, ownerUser) {
  return {
    name: settings?.companyName || "PearQuote",
    email: settings?.contactEmail || ownerUser?.email || null,
    // taxId intentionally excluded from public proposal response —
    // not rendered in any public UI and constitutes internal company info.
    // Re-add here (and to tests) only if a formal invoice/header section needs it.
    companySealUrl: settings?.companySealUrl || null,
    quoteValidityDays: settings?.quoteValidityDays || 30,
  };
}

export function serializePublicProposal(quote) {
  const ownerUser = resolveOwnerUser(quote.workspace);
  const settings = quote.workspace?.settings || {};
  const companyInfo = buildCompanyInfo(settings, ownerUser);

  return {
    shareToken: quote.shareToken,
    proposalStatus: quote.proposalStatus,
    acceptedAt: quote.acceptedAt,
    bookingUrl: buildBookingUrl(ownerUser),
    ownerEmail: companyInfo.email,
    proposalContent: quote.proposalContent || null,
    proposalTheme: quote.proposalTheme || null,
    quote: {
      id: quote.shareToken,
      shareToken: quote.shareToken,
      customerName: quote.customerName,
      contactEmail: quote.customer?.email || null,
      projectName: quote.projectName,
      projectType: quote.projectType,
      expectedDays: quote.expectedDays,
      description: quote.description,
      totalAmount: quote.totalAmount,
      paymentTerms: quote.paymentTerms,
      validityDays: quote.validityDays,
      createdAt: quote.createdAt,
      updatedAt: quote.updatedAt,
      proposalStatus: quote.proposalStatus,
      acceptedAt: quote.acceptedAt,
      proposalContent: quote.proposalContent || null,
      proposalTheme: quote.proposalTheme || null,
      items: (quote.items || []).map((item, index) => ({
        id: `${quote.shareToken}-${index + 1}`,
        description: item.description,
        estimatedHours: item.estimatedHours,
        suggestedRole: item.suggestedRole,
        // hourlyRate intentionally excluded — internal pricing info not for clients.
        amount: item.amount,
        type: item.type,
        unit: item.unit,
      })),
    },
    companyInfo,
  };
}

/**
 * Keys that must never appear anywhere in a public proposal response.
 * Used by serializePublicProposal tests for recursive leak scanning.
 */
export const PUBLIC_PROPOSAL_FORBIDDEN_KEYS = new Set([
  "hourlyRate",
  "aiSuggestedHourlyRate",
  "configuredHourlyRate",
  "rateSource",
  "internalRange",
  "internalRates",
  "internalCost",
  "marginRange",
  "margin",
  "marginTarget",
  "calibrationFactorsApplied",
  "estimateCalibrationFactors",
  "pricingCalibrationFactors",
  "rawGlobalEstimate",
  "calibratedEstimate",
  "estimateSnapshotId",
  "snapshotId",
  "internalNotes",
  "costRange",
  "taxId",
  "_fieldVisibility",
  "ratesUsed",
]);
