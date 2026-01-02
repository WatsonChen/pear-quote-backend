import prisma from "../lib/prisma.js";

/**
 * Create a new customer
 * POST /api/customers
 */
export async function createCustomer(req, res) {
  try {
    const { name, industry, description, aiSummary, email, phone } = req.body;

    const customer = await prisma.customer.create({
      data: {
        name,
        industry,
        description,
        aiSummary,
        email,
        phone,
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
    const customers = await prisma.customer.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        _count: {
          select: { quotes: true },
        },
      },
    });

    return res.json(customers);
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

    const customer = await prisma.customer.findUnique({
      where: { id },
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

    const customer = await prisma.customer.update({
      where: { id },
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

    await prisma.customer.delete({
      where: { id },
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
