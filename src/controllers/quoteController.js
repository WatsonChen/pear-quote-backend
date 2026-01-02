import prisma from "../lib/prisma.js";

/**
 * Create a new quote with items
 * POST /api/quotes
 */
export async function createQuote(req, res) {
  try {
    const {
      customerName,
      customerId,
      projectName,
      projectType,
      expectedDays,
      description,
      items,
    } = req.body;

    const userId = req.user.userId; // From authMiddleware

    // Calculate total amount
    const totalAmount = items.reduce((sum, item) => sum + (item.amount || 0), 0);
    // Calculate total cost (assuming hourlyRate is cost for now, or we need a separate cost field)
    // For now, let's assume margin is calculated elsewhere or we need more inputs.
    // But based on schema, we have totalMargin and totalCost.
    // Let's just save what we have.

    const quote = await prisma.quote.create({
      data: {
        customerName,
        customerId,
        projectName,
        projectType,
        expectedDays: expectedDays ? parseInt(expectedDays) : null,
        description,
        status: "DRAFT",
        totalAmount,
        userId,
        items: {
          create: items.map((item) => ({
            description: item.description,
            estimatedHours: parseFloat(item.estimatedHours || 0),
            suggestedRole: item.suggestedRole,
            hourlyRate: parseFloat(item.hourlyRate || 0),
            amount: parseFloat(item.amount || 0),
          })),
        },
      },
      include: {
        items: true,
        customer: true,
      },
    });

    return res.status(201).json(quote);
  } catch (error) {
    console.error("Create quote error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to create quote",
      error: error.message,
    });
  }
}

/**
 * Get all quotes for the current user
 * GET /api/quotes
 */
export async function getQuotes(req, res) {
  try {
    const userId = req.user.userId;

    const quotes = await prisma.quote.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      include: {
        customer: {
          select: { name: true },
        },
        _count: {
          select: { items: true },
        },
      },
    });

    return res.json(quotes);
  } catch (error) {
    console.error("Get quotes error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch quotes",
    });
  }
}

/**
 * Get a single quote by ID
 * GET /api/quotes/:id
 */
export async function getQuoteById(req, res) {
  try {
    const { id } = req.params;
    const userId = req.user.userId;

    const quote = await prisma.quote.findUnique({
      where: { id },
      include: {
        items: true,
        customer: true,
      },
    });

    if (!quote) {
      return res.status(404).json({ message: "Quote not found" });
    }

    if (quote.userId !== userId) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    return res.json(quote);
  } catch (error) {
    console.error("Get quote error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch quote",
    });
  }
}
