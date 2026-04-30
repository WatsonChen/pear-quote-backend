import prisma from "../lib/prisma.js";

function buildCompanyInfo(settings) {
  return {
    name: settings?.companyName || "PearQuote",
    email: settings?.contactEmail || "",
    taxId: settings?.taxId || "",
    companySealUrl: settings?.companySealUrl || null,
    quoteValidityDays: settings?.quoteValidityDays || 30,
  };
}

export async function getPublicProposal(req, res) {
  try {
    const { shareToken } = req.params;

    const quote = await prisma.quote.findFirst({
      where: { shareToken },
      include: {
        items: true,
        customer: true,
        workspace: {
          include: {
            settings: true,
            users: {
              take: 1,
              include: { user: true },
            },
          },
        },
      },
    });

    if (!quote) {
      return res.status(404).json({
        success: false,
        message: "Proposal not found",
      });
    }

    const settings = quote.workspace?.settings;
    const owner = quote.workspace?.users?.[0]?.user;

    return res.json({
      success: true,
      proposal: {
        quote,
        proposalContent: quote.proposalContent || null,
        proposalTheme: quote.proposalTheme || null,
        companyInfo: buildCompanyInfo(settings),
        ownerEmail: settings?.contactEmail || owner?.email || "",
        bookingUrl: null,
        acceptedAt: quote.acceptedAt,
        proposalStatus: quote.proposalStatus,
      },
    });
  } catch (error) {
    console.error("Get public proposal error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to load proposal",
      error: error.message,
    });
  }
}

export async function trackProposalView(req, res) {
  try {
    const { shareToken } = req.params;
    const now = new Date();

    const quote = await prisma.quote.findFirst({
      where: { shareToken },
      select: { id: true, proposalStatus: true, shareViewedAt: true },
    });

    if (!quote) {
      return res.status(404).json({
        success: false,
        message: "Proposal not found",
      });
    }

    const nextStatus =
      quote.proposalStatus === "accepted" || quote.proposalStatus === "rejected"
        ? quote.proposalStatus
        : "viewed";

    const updatedQuote = await prisma.quote.update({
      where: { id: quote.id },
      data: {
        viewCount: { increment: 1 },
        shareViewedAt: quote.shareViewedAt || now,
        lastViewedAt: now,
        proposalStatus: nextStatus,
      },
      select: {
        viewCount: true,
        shareViewedAt: true,
        lastViewedAt: true,
        proposalStatus: true,
      },
    });

    return res.json({ success: true, ...updatedQuote });
  } catch (error) {
    console.error("Track proposal view error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to track proposal view",
      error: error.message,
    });
  }
}

export async function acceptProposal(req, res) {
  try {
    const { shareToken } = req.params;
    const { name, email, message } = req.body;

    const quote = await prisma.quote.findFirst({
      where: { shareToken },
      select: { id: true },
    });

    if (!quote) {
      return res.status(404).json({
        success: false,
        message: "Proposal not found",
      });
    }

    const acceptedAt = new Date();
    const updatedQuote = await prisma.quote.update({
      where: { id: quote.id },
      data: {
        proposalStatus: "accepted",
        acceptedAt,
        clientResponseName: name || "",
        clientResponseEmail: email || "",
        clientResponseMessage: message || "",
      },
      select: {
        acceptedAt: true,
        proposalStatus: true,
        clientResponseName: true,
        clientResponseEmail: true,
        clientResponseMessage: true,
      },
    });

    return res.json({ success: true, ...updatedQuote });
  } catch (error) {
    console.error("Accept proposal error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to accept proposal",
      error: error.message,
    });
  }
}
