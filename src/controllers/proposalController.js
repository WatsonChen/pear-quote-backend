import prisma from "../lib/prisma.js";
import {
  sendProposalAcceptedNotification,
  sendProposalViewedNotification,
} from "../services/proposalNotificationService.js";
import { serializePublicProposal, resolveOwnerUser } from "../lib/proposalSerializer.js";

const TERMINAL_PROPOSAL_STATUSES = new Set(["accepted", "rejected"]);

async function findPublicProposal(shareToken) {
  return prisma.quote.findUnique({
    where: { shareToken },
    include: {
      items: true,
      customer: true,
      workspace: {
        include: {
          settings: true,
          users: {
            include: {
              user: {
                select: {
                  email: true,
                  bookingUrl: true,
                },
              },
            },
          },
        },
      },
    },
  });
}

/**
 * Get a public Proposal by share token.
 * GET /api/proposals/:shareToken
 */
export async function getPublicProposal(req, res) {
  try {
    const { shareToken } = req.params;
    const quote = await findPublicProposal(shareToken);

    if (!quote) {
      return res
        .status(404)
        .json({ success: false, message: "Proposal not found" });
    }

    return res.json({
      success: true,
      proposal: serializePublicProposal(quote),
    });
  } catch (error) {
    console.error("Get public proposal error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch proposal",
    });
  }
}

/**
 * Track a public Proposal view.
 * POST /api/proposals/:shareToken/view
 */
export async function trackProposalView(req, res) {
  try {
    const { shareToken } = req.params;
    const quote = await findPublicProposal(shareToken);

    if (!quote) {
      return res
        .status(404)
        .json({ success: false, message: "Proposal not found" });
    }

    const now = new Date();
    const isFirstView = !quote.shareViewedAt;
    const shouldMoveToViewed = !TERMINAL_PROPOSAL_STATUSES.has(
      quote.proposalStatus,
    );

    const updatedQuote = await prisma.quote.update({
      where: { shareToken },
      data: {
        shareViewedAt: isFirstView ? now : undefined,
        lastViewedAt: now,
        viewCount: { increment: 1 },
        proposalStatus: shouldMoveToViewed ? "viewed" : undefined,
      },
    });

    if (isFirstView) {
      const ownerUser = resolveOwnerUser(quote.workspace);
      await sendProposalViewedNotification({
        to: ownerUser?.email,
        proposalName: quote.projectName,
        viewedAt: now,
      });
    }

    return res.json({
      success: true,
      proposalStatus: updatedQuote.proposalStatus,
      shareViewedAt: updatedQuote.shareViewedAt,
      lastViewedAt: updatedQuote.lastViewedAt,
      viewCount: updatedQuote.viewCount,
    });
  } catch (error) {
    console.error("Track proposal view error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to track proposal view",
    });
  }
}

/**
 * Accept a public Proposal.
 * POST /api/proposals/:shareToken/accept
 */
export async function acceptProposal(req, res) {
  try {
    const { shareToken } = req.params;
    const name = String(req.body?.name || "").trim();
    const email = String(req.body?.email || "").trim();
    const responseMessage = String(req.body?.message || "").trim();

    if (!name || !email) {
      return res.status(400).json({
        success: false,
        message: "Name and Email are required",
      });
    }

    const quote = await findPublicProposal(shareToken);

    if (!quote) {
      return res
        .status(404)
        .json({ success: false, message: "Proposal not found" });
    }

    if (quote.acceptedAt) {
      return res.json({
        success: true,
        accepted: true,
        proposalStatus: quote.proposalStatus,
        acceptedAt: quote.acceptedAt,
        clientResponseName: quote.clientResponseName,
        clientResponseEmail: quote.clientResponseEmail,
        clientResponseMessage: quote.clientResponseMessage,
      });
    }

    if (quote.proposalStatus === "rejected") {
      return res.status(409).json({
        success: false,
        message: "Proposal has been rejected",
        proposalStatus: quote.proposalStatus,
      });
    }

    const now = new Date();
    const updatedQuote = await prisma.quote.update({
      where: { shareToken },
      data: {
        acceptedAt: now,
        clientResponseName: name,
        clientResponseEmail: email,
        clientResponseMessage: responseMessage || null,
        proposalStatus: "accepted",
      },
    });

    const ownerUser = resolveOwnerUser(quote.workspace);
    await sendProposalAcceptedNotification({
      to: ownerUser?.email,
      proposalName: quote.projectName,
      clientName: name,
      clientEmail: email,
      message: responseMessage,
    });

    return res.json({
      success: true,
      accepted: true,
      proposalStatus: updatedQuote.proposalStatus,
      acceptedAt: updatedQuote.acceptedAt,
      clientResponseName: updatedQuote.clientResponseName,
      clientResponseEmail: updatedQuote.clientResponseEmail,
      clientResponseMessage: updatedQuote.clientResponseMessage,
    });
  } catch (error) {
    console.error("Accept proposal error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to accept proposal",
    });
  }
}
