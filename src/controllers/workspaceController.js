import prisma from "../lib/prisma.js";

/**
 * Get the current active workspace for the user
 * GET /api/workspaces/current
 */
export async function getCurrentWorkspace(req, res) {
  try {
    const workspaceId = req.workspace?.id;

    if (!workspaceId) {
      return res
        .status(400)
        .json({ success: false, message: "No active workspace found" });
    }

    // Always fetch fresh data from DB to get the latest creditBalance
    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: {
        id: true,
        name: true,
        creditBalance: true,
        subscriptionPlan: true,
      },
    });

    if (!workspace) {
      return res
        .status(404)
        .json({ success: false, message: "Workspace not found in database" });
    }

    return res.json({
      success: true,
      data: workspace,
    });
  } catch (error) {
    console.error("Get current workspace error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Failed to get workspace" });
  }
}
