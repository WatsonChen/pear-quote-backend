import prisma from "../lib/prisma.js";

/**
 * Create a new customer
 * POST /api/customers
 */
export async function createCustomer(req, res) {
  try {
    const { name, industry, description, aiSummary, email, phone } = req.body;
    const userId = req.user.userId;

    const customer = await prisma.customer.create({
      data: {
        name,
        industry,
        description,
        aiSummary,
        email,
        phone,
        userId,
      },
    });

    return res.status(201).json(customer);
  } catch (error) {
    console.error("Create customer error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to create customer",
      error: error.message,
    });
  }
}

/**
 * Get all customers
 * GET /api/customers
 */
export async function getCustomers(req, res) {
  try {
    const userId = req.user.userId;
    const customers = await prisma.customer.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      include: {
        quotes: {
          select: {
            totalAmount: true,
            status: true,
          },
        },
        _count: {
          select: { quotes: true },
        },
      },
    });

    // Calculate stats
    const customersWithStats = customers.map((customer) => {
      const totalAmount = customer.quotes.reduce(
        (sum, q) => sum + (q.totalAmount || 0),
        0
      );

      // Calculate win rate or other stats if needed
      // For now, just total amount

      return {
        ...customer,
        totalAmount,
        // Remove quotes array to keep response light if desired,
        // but keeping it is fine for small datasets.
        // Let's remove it to match the previous structure but with added fields.
        quotes: undefined,
      };
    });

    return res.json(customersWithStats);
  } catch (error) {
    console.error("Get customers error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch customers",
    });
  }
}

/**
 * Get a single customer by ID
 * GET /api/customers/:id
 */
export async function getCustomerById(req, res) {
  try {
    const { id } = req.params;
    const userId = req.user.userId;

    const customer = await prisma.customer.findFirst({
      where: { id, userId },
      include: {
        quotes: {
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            projectName: true,
            status: true,
            totalAmount: true,
            createdAt: true,
          },
        },
      },
    });

    if (!customer) {
      return res.status(404).json({ message: "Customer not found" });
    }

    return res.json(customer);
  } catch (error) {
    console.error("Get customer error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch customer",
    });
  }
}

/**
 * Update a customer
 * PUT /api/customers/:id
 */
export async function updateCustomer(req, res) {
  try {
    const { id } = req.params;
    const { name, industry, description, aiSummary, email, phone } = req.body;
    const userId = req.user.userId;

    const customer = await prisma.customer.update({
      where: { id, userId },
      data: {
        name,
        industry,
        description,
        aiSummary,
        email,
        phone,
      },
    });

    return res.json(customer);
  } catch (error) {
    console.error("Update customer error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update customer",
    });
  }
}

/**
 * Delete a customer
 * DELETE /api/customers/:id
 */
export async function deleteCustomer(req, res) {
  try {
    const { id } = req.params;
    const userId = req.user.userId;

    await prisma.customer.delete({
      where: { id, userId },
    });

    return res.json({ success: true, message: "Customer deleted" });
  } catch (error) {
    console.error("Delete customer error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to delete customer",
    });
  }
}
