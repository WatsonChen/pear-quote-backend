/**
 * Spending credits. The balance check at the start of a request is only a quick
 * refusal: two requests can pass it together. The charge itself is one
 * conditional update, so the balance can never go below zero and a request
 * that cannot pay delivers nothing.
 */

export class InsufficientCreditsError extends Error {
  constructor() {
    super("Insufficient credits. Please top up your account.");
    this.name = "InsufficientCreditsError";
    this.errorCode = "INSUFFICIENT_CREDITS";
  }
}

/**
 * @param {{ workspace: { updateMany: Function } }} client prisma or a transaction client
 * @param {string} workspaceId
 * @param {number} cost
 */
export async function chargeCredits(client, workspaceId, cost) {
  const charged = await client.workspace.updateMany({
    where: { id: workspaceId, creditBalance: { gte: cost } },
    data: { creditBalance: { decrement: cost } },
  });
  if (charged.count !== 1) throw new InsufficientCreditsError();
}

/** Sends the standard refusal and returns true when the error is a failed charge. */
export function handleInsufficientCredits(res, error) {
  if (!(error instanceof InsufficientCreditsError)) return false;
  res.status(403).json({ success: false, message: error.message, errorCode: error.errorCode });
  return true;
}
