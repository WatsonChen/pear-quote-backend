import prisma from "../lib/prisma.js";
import {
  sendProposalAcceptedNotification,
  sendProposalCommentNotification,
  sendProposalReplyNotification,
  sendProposalViewedNotification,
} from "../services/proposalNotificationService.js";
import { serializePublicProposal, resolveOwnerUser } from "../lib/proposalSerializer.js";
import { PROPOSAL_SECTIONS, isKnownOptionId } from "../lib/proposalOptions.js";
import { detectTextLocale } from "../lib/textLocale.js";

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
    const optionId = req.body?.optionId ? String(req.body.optionId) : null;

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

    if (optionId && !isKnownOptionId(quote.proposalContent?.options, optionId)) {
      return res
        .status(400)
        .json({ success: false, message: "Unknown package option" });
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
        clientSelectedOptionId: optionId,
        proposalStatus: "accepted",
      },
    });

    await prisma.proposalEvent.create({
      data: { quoteId: quote.id, type: "accept" },
    });

    const ownerUser = resolveOwnerUser(quote.workspace);
    await sendProposalAcceptedNotification({
      to: ownerUser?.email,
      proposalName: quote.projectName,
      clientName: name,
      clientEmail: email,
      message: responseMessage,
      optionName: optionId
        ? quote.proposalContent.options.find((o) => o.id === optionId)?.name
        : null,
    });

    return res.json({
      success: true,
      accepted: true,
      proposalStatus: updatedQuote.proposalStatus,
      acceptedAt: updatedQuote.acceptedAt,
      clientResponseName: updatedQuote.clientResponseName,
      clientResponseEmail: updatedQuote.clientResponseEmail,
      clientResponseMessage: updatedQuote.clientResponseMessage,
      clientSelectedOptionId: updatedQuote.clientSelectedOptionId,
    });
  } catch (error) {
    console.error("Accept proposal error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to accept proposal",
    });
  }
}

const MAX_SECTION_MS = 10 * 60 * 1000;

/**
 * Record a client's click on a call to action (book a call, download the PDF).
 * POST /api/proposals/:shareToken/action
 */
const CLIENT_ACTIONS = ["book", "download"];
export async function trackProposalAction(req, res) {
  try {
    const action = String(req.body?.action || "");
    if (!CLIENT_ACTIONS.includes(action)) {
      return res.status(400).json({ success: false, message: "Invalid action" });
    }
    const quote = await prisma.quote.findUnique({
      where: { shareToken: req.params.shareToken },
      select: { id: true },
    });
    if (!quote) return res.status(404).json({ success: false, message: "Proposal not found" });
    await prisma.proposalEvent.create({ data: { quoteId: quote.id, type: action } });
    return res.json({ success: true });
  } catch (error) {
    console.error("Track proposal action error:", error);
    return res.status(500).json({ success: false, message: "Failed to track" });
  }
}

/**
 * Record that a client spent time on a section.
 * POST /api/proposals/:shareToken/events
 */
export async function trackProposalSection(req, res) {
  try {
    const { shareToken } = req.params;
    const section = String(req.body?.section || "");
    const durationMs = Math.round(Number(req.body?.durationMs));

    if (!PROPOSAL_SECTIONS.includes(section) || !Number.isFinite(durationMs) || durationMs < 1) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid section event" });
    }

    const quote = await prisma.quote.findUnique({
      where: { shareToken },
      select: { id: true },
    });
    if (!quote) {
      return res
        .status(404)
        .json({ success: false, message: "Proposal not found" });
    }

    await prisma.proposalEvent.create({
      data: {
        quoteId: quote.id,
        type: "section",
        section,
        durationMs: Math.min(durationMs, MAX_SECTION_MS),
      },
    });
    return res.json({ success: true });
  } catch (error) {
    console.error("Track proposal section error:", error);
    return res.status(500).json({ success: false, message: "Failed to track" });
  }
}

function serializeComment(comment) {
  return {
    id: comment.id,
    section: comment.section,
    authorName: comment.authorName,
    body: comment.body,
    fromClient: comment.fromClient,
    createdAt: comment.createdAt,
  };
}

/**
 * The thread on a shared proposal. The share link is the credential, so anyone
 * holding it sees the thread; emails are never returned.
 * GET /api/proposals/:shareToken/comments
 */
export async function listPublicComments(req, res) {
  try {
    const quote = await prisma.quote.findUnique({
      where: { shareToken: req.params.shareToken },
      select: { id: true },
    });
    if (!quote) {
      return res
        .status(404)
        .json({ success: false, message: "Proposal not found" });
    }
    const comments = await prisma.proposalComment.findMany({
      where: { quoteId: quote.id },
      orderBy: { createdAt: "asc" },
      take: 200,
    });
    return res.json({ success: true, comments: comments.map(serializeComment) });
  } catch (error) {
    console.error("List public comments error:", error);
    return res.status(500).json({ success: false, message: "Failed to load" });
  }
}

/**
 * A client asks a question.
 * POST /api/proposals/:shareToken/comments
 */
export async function createPublicComment(req, res) {
  try {
    const name = String(req.body?.name || "").trim().slice(0, 80);
    const email = String(req.body?.email || "").trim().slice(0, 160);
    const body = String(req.body?.body || "").trim().slice(0, 2000);
    const section = PROPOSAL_SECTIONS.includes(req.body?.section)
      ? req.body.section
      : null;

    if (!name || !body) {
      return res
        .status(400)
        .json({ success: false, message: "Name and message are required" });
    }

    const quote = await findPublicProposal(req.params.shareToken);
    if (!quote) {
      return res
        .status(404)
        .json({ success: false, message: "Proposal not found" });
    }

    const comment = await prisma.proposalComment.create({
      data: {
        quoteId: quote.id,
        section,
        authorName: name,
        authorEmail: email || null,
        body,
        fromClient: true,
      },
    });
    await prisma.proposalEvent.create({
      data: { quoteId: quote.id, type: "comment", section },
    });

    const ownerUser = resolveOwnerUser(quote.workspace);
    await sendProposalCommentNotification({
      to: ownerUser?.email,
      proposalName: quote.projectName,
      clientName: name,
      clientEmail: email,
      message: body,
    });

    return res.status(201).json({ success: true, comment: serializeComment(comment) });
  } catch (error) {
    console.error("Create public comment error:", error);
    return res.status(500).json({ success: false, message: "Failed to send" });
  }
}

async function findOwnedQuote(req) {
  const quote = await prisma.quote.findUnique({
    where: { id: req.params.id },
    select: { id: true, workspaceId: true, shareToken: true, projectName: true },
  });
  if (!quote) return { status: 404 };
  if (quote.workspaceId !== req.workspace?.id) return { status: 403 };
  return { quote };
}

/**
 * Owner: how the client read the proposal, plus the question thread.
 * GET /api/quotes/:id/proposal-activity
 */
export async function getProposalActivity(req, res) {
  try {
    const { quote, status } = await findOwnedQuote(req);
    if (!quote) return res.status(status).json({ message: "Not found" });

    const [grouped, comments, lastEvents, actionCounts] = await Promise.all([
      prisma.proposalEvent.groupBy({
        by: ["section"],
        where: { quoteId: quote.id, type: "section" },
        _sum: { durationMs: true },
        _count: { _all: true },
      }),
      prisma.proposalComment.findMany({
        where: { quoteId: quote.id },
        orderBy: { createdAt: "asc" },
        take: 200,
      }),
      prisma.proposalEvent.findMany({
        where: { quoteId: quote.id },
        orderBy: { createdAt: "desc" },
        take: 20,
      }),
      prisma.proposalEvent.groupBy({
        by: ["type"],
        where: { quoteId: quote.id, type: { in: CLIENT_ACTIONS } },
        _count: { _all: true },
      }),
    ]);

    return res.json({
      sections: PROPOSAL_SECTIONS.map((name) => {
        const row = grouped.find((g) => g.section === name);
        return {
          section: name,
          reads: row?._count._all || 0,
          totalMs: row?._sum.durationMs || 0,
        };
      }),
      actions: Object.fromEntries(CLIENT_ACTIONS.map((a) => [a, actionCounts.find((r) => r.type === a)?._count._all || 0])),
      comments: comments.map((c) => ({ ...serializeComment(c), authorEmail: c.authorEmail })),
      recent: lastEvents.map((e) => ({
        type: e.type,
        section: e.section,
        createdAt: e.createdAt,
      })),
    });
  } catch (error) {
    console.error("Get proposal activity error:", error);
    return res.status(500).json({ message: "Failed to load activity" });
  }
}

/**
 * Owner replies in the thread.
 * POST /api/quotes/:id/proposal-comments
 */
export async function replyToProposalComment(req, res) {
  try {
    const { quote, status } = await findOwnedQuote(req);
    if (!quote) return res.status(status).json({ message: "Not found" });

    const body = String(req.body?.body || "").trim().slice(0, 2000);
    if (!body) return res.status(400).json({ message: "Message is required" });

    const authorName =
      String(req.body?.authorName || "").trim().slice(0, 80) || "Owner";
    const comment = await prisma.proposalComment.create({
      data: { quoteId: quote.id, authorName, body, fromClient: false },
    });
    // Answering means the owner has read everything so far.
    await prisma.quote.update({
      where: { id: quote.id },
      data: { commentsSeenAt: new Date() },
    });
    // A client who left an email hears about the reply without having to come back and look.
    const asked = await prisma.proposalComment.findFirst({
      where: { quoteId: quote.id, fromClient: true, authorEmail: { not: null } },
      orderBy: { createdAt: "desc" },
      select: { authorEmail: true },
    });
    if (asked?.authorEmail && quote.shareToken) {
      const base = (process.env.FRONTEND_URL || "").split(",")[0].trim().replace(/\/$/, "");
      await sendProposalReplyNotification({
        to: asked.authorEmail,
        proposalName: quote.projectName,
        message: body,
        shareUrl: base ? `${base}/p/${quote.shareToken}` : null,
        locale: detectTextLocale(body, "en"),
      });
    }
    return res.status(201).json({ comment: serializeComment(comment) });
  } catch (error) {
    console.error("Reply to proposal comment error:", error);
    return res.status(500).json({ message: "Failed to reply" });
  }
}

/**
 * Owner: projects with client questions not yet opened, newest first.
 * GET /api/quotes/unread-comments
 */
export async function getUnreadProposalComments(req, res) {
  try {
    const quotes = await prisma.quote.findMany({
      where: {
        workspaceId: req.workspace?.id,
        OR: [{ proposalComments: { some: { fromClient: true } } }, { acceptedAt: { not: null } }],
      },
      select: {
        id: true,
        projectName: true,
        customerName: true,
        commentsSeenAt: true,
        acceptedAt: true,
        clientResponseName: true,
        proposalComments: {
          where: { fromClient: true },
          orderBy: { createdAt: "desc" },
          take: 50,
        },
      },
    });

    const items = quotes
      .map((quote) => {
        const unread = quote.proposalComments.filter(
          (c) => !quote.commentsSeenAt || c.createdAt > quote.commentsSeenAt,
        );
        const latest = unread[0];
        const accepted = Boolean(quote.acceptedAt) && (!quote.commentsSeenAt || quote.acceptedAt > quote.commentsSeenAt);
        if (!latest && !accepted) return null;
        return {
          quoteId: quote.id,
          projectName: quote.projectName,
          customerName: quote.customerName,
          count: unread.length + (accepted ? 1 : 0),
          accepted,
          latest: latest
            ? { authorName: latest.authorName, body: latest.body.slice(0, 160), createdAt: latest.createdAt }
            : { authorName: quote.clientResponseName || "", body: "", createdAt: quote.acceptedAt },
        };
      })
      .filter(Boolean)
      .sort((a, b) => new Date(b.latest.createdAt) - new Date(a.latest.createdAt));

    return res.json({
      total: items.reduce((sum, item) => sum + item.count, 0),
      items,
    });
  } catch (error) {
    console.error("Get unread proposal comments error:", error);
    return res.status(500).json({ message: "Failed to load unread questions" });
  }
}

/**
 * Owner opened the questions of one project.
 * POST /api/quotes/:id/proposal-comments/seen
 */
export async function markProposalCommentsSeen(req, res) {
  try {
    const { quote, status } = await findOwnedQuote(req);
    if (!quote) return res.status(status).json({ message: "Not found" });
    await prisma.quote.update({
      where: { id: quote.id },
      data: { commentsSeenAt: new Date() },
    });
    return res.json({ ok: true });
  } catch (error) {
    console.error("Mark proposal comments seen error:", error);
    return res.status(500).json({ message: "Failed to update" });
  }
}
