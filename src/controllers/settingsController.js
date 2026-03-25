import prisma from "../lib/prisma.js";

/**
 * Get system settings
 * GET /api/settings
 */
export async function getSettings(req, res) {
  try {
    const workspaceId = req.workspace?.id;
    // Assuming each workspace has their own settings record
    let settings = await prisma.systemSettings.findUnique({
      where: { workspaceId },
    });

    if (!settings) {
      // Create default settings if not exists for this user
      settings = await prisma.systemSettings.create({
        data: {
          workspaceId,
          companyName: "My Company",
          targetMarginMin: 20,
          targetMarginMax: 40,
          quoteValidityDays: 30,
        },
      });
    }

    return res.json(settings);
  } catch (error) {
    console.error("Get settings error:", error);
    return res.status(500).json({
      success: false,
      message: `Failed to fetch settings: ${error.message}`,
      stack: error.stack,
    });
  }
}

/**
 * Update system settings
 * PUT /api/settings
 */
export async function updateSettings(req, res) {
  try {
    const workspaceId = req.workspace?.id;
    const {
      companyName,
      taxId,
      contactEmail,
      juniorRate,
      seniorRate,
      pmRate,
      designRate,
      targetMarginMin,
      targetMarginMax,
      companySealUrl,
      roleRates, // Dynamic role rates
      projectTypes, // Dynamic project types
      materials, // Dynamic materials
      quoteValidityDays,
    } = req.body;

    const settings = await prisma.systemSettings.upsert({
      where: { workspaceId },
      update: {
        companyName,
        taxId,
        contactEmail,
        juniorRate: juniorRate ? parseFloat(juniorRate) : undefined,
        seniorRate: seniorRate ? parseFloat(seniorRate) : undefined,
        pmRate: pmRate ? parseFloat(pmRate) : undefined,
        designRate: designRate ? parseFloat(designRate) : undefined,
        targetMarginMin: targetMarginMin
          ? parseFloat(targetMarginMin)
          : undefined,
        targetMarginMax: targetMarginMax
          ? parseFloat(targetMarginMax)
          : undefined,
        companySealUrl,
        roleRates: roleRates || undefined,
        projectTypes: projectTypes || undefined,
        materials: materials || undefined,
        quoteValidityDays: quoteValidityDays
          ? parseInt(quoteValidityDays)
          : undefined,
      },
      create: {
        workspaceId,
        companyName,
        taxId,
        contactEmail,
        juniorRate: juniorRate ? parseFloat(juniorRate) : undefined,
        seniorRate: seniorRate ? parseFloat(seniorRate) : undefined,
        pmRate: pmRate ? parseFloat(pmRate) : undefined,
        designRate: designRate ? parseFloat(designRate) : undefined,
        targetMarginMin: targetMarginMin
          ? parseFloat(targetMarginMin)
          : undefined,
        targetMarginMax: targetMarginMax
          ? parseFloat(targetMarginMax)
          : undefined,
        companySealUrl,
        roleRates: roleRates || undefined,
        projectTypes: projectTypes || undefined,
        materials: materials || undefined,
        quoteValidityDays: quoteValidityDays
          ? parseInt(quoteValidityDays)
          : undefined,
      },
    });

    return res.json(settings);
  } catch (error) {
    console.error("Update settings error:", error);
    return res.status(500).json({
      success: false,
      message: `Failed to update settings: ${error.message}`,
      stack: error.stack,
    });
  }
}
