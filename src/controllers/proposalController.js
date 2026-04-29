import prisma from "../lib/prisma.js";
import {
  sendProposalAcceptedNotification,
  sendProposalViewedNotification,
} from "../services/proposalNotificationService.js";

function resolveOwnerUser(workspace) {
  const workspaceUsers = workspace?.users || [];
  return (
    workspaceUsers.find((item) => item.role === "OWNER")?.user ||
    workspaceUsers[0]?.user ||
    null
  );
}

function buildBookingUrl(user) {
  if (user?.bookingUrl) {
    return user.bookingUrl;
  }

  return user?.email ? `mailto:${user.email}` : null;
}

function serializePublicProposal(quote) {
  const ownerUser = resolveOwnerUser(quote.workspace);
  const settings = quote.workspace?.settings || {};

  return {
    shareToken: quote.shareToken,
    proposalStatus: quote.proposalStatus,
    acceptedAt: quote.acceptedAt,
    bookingUrl: buildBookingUrl(ownerUser),
    ownerEmail: ownerUser?.email || null,
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
      items: (quote.items || []).map((item, index) => ({
        id: `${quote.shareToken}-${index + 1}`,
        description: item.description,
        estimatedHours: item.estimatedHours,
        suggestedRole: item.suggestedRole,
        hourlyRate: item.hourlyRate,
        amount: item.amount,
        type: item.type,
        unit: item.unit,
      })),
    },
    companyInfo: {
      name: settings.companyName || "PearQuote",
      email: settings.contactEmail || ownerUser?.email || null,
      taxId: settings.taxId || null,
      companySealUrl: settings.companySealUrl || null,
      quoteValidityDays: settings.quoteValidityDays || 30,
    },
  };
}

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
    const shouldMoveToViewed =
      isFirstView && quote.proposalStatus === "sent";

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
