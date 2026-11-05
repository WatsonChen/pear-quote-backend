import prisma from "./prisma.js";

/**
 * Extra, optional context for writing a proposal: who is writing it, and what
 * the client actually asked for.
 *
 * The provider profile is written by the user. When it is empty the proposal is
 * written from the quote alone and makes no claim about the company, so an
 * unconfigured account never gets invented credentials.
 */

const DEFAULT_COMPANY_NAME = "My Company";
const MAX_PROOF_LINES = 8;

function clean(value, max) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

export function buildProviderProfile(settings) {
  const about = clean(settings?.proposalAbout, 600);
  const proof = String(settings?.proposalProof ?? "")
    .split("\n")
    .map((line) => clean(line, 160))
    .filter(Boolean)
    .slice(0, MAX_PROOF_LINES);

  if (!about && proof.length === 0) return null;

  const name = clean(settings?.companyName, 80);
  return {
    name: name && name !== DEFAULT_COMPANY_NAME ? name : null,
    about,
    proof,
  };
}

/** The structured reading of the client's request, trimmed to what helps the writer. */
export function buildRequirementContext(spec) {
  if (!spec || typeof spec !== "object") return null;
  const pick = {};
  for (const key of [
    "businessGoal",
    "clientIntent",
    "targetUsers",
    "platforms",
    "requirements",
    "assumptions",
    "exclusions",
    "risks",
  ]) {
    if (spec[key] != null && spec[key] !== "") pick[key] = spec[key];
  }
  if (Object.keys(pick).length === 0) return null;
  const text = JSON.stringify(pick);
  return text.length > 3500 ? text.slice(0, 3500) : text;
}

export async function loadProposalContext({ workspaceId, quoteId }) {
  const [settings, snapshot] = await Promise.all([
    prisma.systemSettings.findUnique({
      where: { workspaceId },
      select: { companyName: true, proposalAbout: true, proposalProof: true },
    }),
    prisma.estimateSnapshot.findFirst({
      where: { quoteId },
      orderBy: { createdAt: "desc" },
      select: { requirementSpec: true },
    }),
  ]);

  return {
    provider: buildProviderProfile(settings),
    requirementContext: buildRequirementContext(snapshot?.requirementSpec),
  };
}
