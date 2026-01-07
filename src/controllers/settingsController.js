import prisma from "../lib/prisma.js";

/**
 * Get system settings
 * GET /api/settings
 */
export async function getSettings(req, res) {
  try {
    // Assuming there is only one settings record
    let settings = await prisma.systemSettings.findFirst();

    if (!settings) {
      // Create default settings if not exists
      settings = await prisma.systemSettings.create({
        data: {
          companyName: "My Company",
          targetMarginMin: 20,
          targetMarginMax: 40,
        },
      });
    }

    return res.json(settings);
  } catch (error) {
    console.error("Get settings error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch settings",
    });
  }
}

/**
 * Update system settings
 * PUT /api/settings
 */
export async function updateSettings(req, res) {
  try {
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
      companySealUrl, // Add
    } = req.body;

    // Find the existing record to update
    const existingSettings = await prisma.systemSettings.findFirst();

    let settings;
    if (existingSettings) {
      settings = await prisma.systemSettings.update({
        where: { id: existingSettings.id },
        data: {
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
          companySealUrl, // Add
        },
      });
    } else {
      settings = await prisma.systemSettings.create({
        data: {
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
          companySealUrl, // Add
        },
      });
    }

    return res.json(settings);
  } catch (error) {
    console.error("Update settings error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update settings",
    });
  }
}
