/**
 * Outcome Learning — Quote WON synchronization (Stage 3 entry point).
 *
 * Scope: when a Quote is marked WON, record the deal outcome on the
 * EstimateAdjustment linked to the snapshot that quote was actually built
 * from. This does NOT feed pricing calibration yet — computeCalibrationSuggestions
 * still reads finalQuotedPrice from the "sent" stage and never reads
 * acceptedPrice. That policy question is Stage 3.5. This module only makes
 * acceptedPrice a reliable, real value for that future audit to reason about.
 *
 * Never creates a snapshot or adjustment (no upsert). Never touches
 * actualHoursByRole, adjustedHoursByRole, adjustedModules, scopeChanged, or
 * calibration factors. Never sets projectStatus to "completed".
 */

export function assertValidWonAmount(wonAmount) {
  if (typeof wonAmount !== "number" || !Number.isFinite(wonAmount) || wonAmount <= 0) {
    throw Object.assign(
      new Error("wonAmount must be a finite number greater than 0"),
      { statusCode: 400, errorCode: "INVALID_WON_AMOUNT" },
    );
  }
}

/**
 * Binds a Quote to the estimate snapshot it was actually built from.
 *
 * Uses a conditional updateMany (id + workspaceId + quoteId: null) rather
 * than update() so a snapshot that doesn't exist, belongs to another
 * workspace, or is already linked to a different quote simply fails to
 * match — it never throws, never steals a link, and never blocks quote
 * creation. The follow-up read only exists to produce an accurate skip
 * reason for logging; it never changes what got written.
 *
 * @param {object} params
 * @param {object} params.tx                 - Prisma transaction client
 * @param {string|null|undefined} params.estimateSnapshotId
 * @param {string} params.quoteId
 * @param {string} params.workspaceId
 * @returns {Promise<object>} { linked: true, snapshotId } | { linked: false, reason }
 */
export async function linkEstimateSnapshotToQuote({ tx, estimateSnapshotId, quoteId, workspaceId }) {
  if (!estimateSnapshotId) {
    return { linked: false, reason: "no_snapshot_id_provided" };
  }

  const result = await tx.estimateSnapshot.updateMany({
    where: { id: estimateSnapshotId, workspaceId, quoteId: null },
    data: { quoteId },
  });

  if (result.count === 1) {
    return { linked: true, snapshotId: estimateSnapshotId };
  }

  const existing = await tx.estimateSnapshot.findUnique({
    where: { id: estimateSnapshotId },
    select: { workspaceId: true, quoteId: true },
  });

  if (!existing) {
    return { linked: false, reason: "snapshot_not_found" };
  }
  if (existing.workspaceId !== workspaceId) {
    return { linked: false, reason: "snapshot_workspace_mismatch" };
  }
  if (existing.quoteId != null) {
    return { linked: false, reason: "snapshot_already_linked" };
  }
  return { linked: false, reason: "snapshot_link_failed" };
}

/**
 * @param {object} params
 * @param {object} params.tx          - Prisma transaction client (or the plain prisma client)
 * @param {string} params.quoteId
 * @param {string} params.workspaceId
 * @param {number} params.wonAmount
 * @returns {Promise<object>} structured sync result — never throws for missing data, only for invalid input or real persistence failures
 */
export async function syncQuoteWonOutcome({ tx, quoteId, workspaceId, wonAmount }) {
  assertValidWonAmount(wonAmount);

  const linkedSnapshots = await tx.estimateSnapshot.findMany({
    where: { quoteId, workspaceId },
    select: { id: true },
  });

  if (linkedSnapshots.length === 0) {
    return { synced: false, reason: "snapshot_not_linked" };
  }

  if (linkedSnapshots.length > 1) {
    // Should not happen under the Stage 3 linking policy (one quote binds at
    // most one snapshot), but if historical data or a future bug produces
    // this, guessing which one is "right" would silently corrupt outcome
    // data. Surface it instead of picking createdAt-latest.
    return {
      synced: false,
      reason: "snapshot_link_ambiguous",
      snapshotIds: linkedSnapshots.map((s) => s.id),
    };
  }

  const snapshotId = linkedSnapshots[0].id;

  const adjustment = await tx.estimateAdjustment.findFirst({
    where: { snapshotId, workspaceId },
  });

  if (!adjustment) {
    return { synced: false, reason: "adjustment_not_found", snapshotId };
  }

  const nextFinalQuotedPrice =
    adjustment.finalQuotedPrice != null ? adjustment.finalQuotedPrice : wonAmount;

  const updated = await tx.estimateAdjustment.update({
    where: { id: adjustment.id },
    data: {
      projectStatus: "accepted",
      acceptedPrice: wonAmount,
      finalQuotedPrice: nextFinalQuotedPrice,
    },
  });

  return {
    synced: true,
    snapshotId,
    adjustmentId: updated.id,
    projectStatus: updated.projectStatus,
    acceptedPrice: updated.acceptedPrice,
    finalQuotedPrice: updated.finalQuotedPrice,
  };
}
