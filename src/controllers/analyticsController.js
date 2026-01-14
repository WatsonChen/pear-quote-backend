import prisma from "../lib/prisma.js";

export const getAnalyticsMetrics = async (req, res) => {
  const userId = req.user.userId;

  try {
    const quotes = await prisma.quote.findMany({
      where: { userId },
      select: {
        totalAmount: true,
        totalMargin: true,
        status: true,
      },
    });

    const totalQuoted = quotes.reduce(
      (sum, q) => sum + (q.totalAmount || 0),
      0
    );
    const totalWon = quotes
      .filter((q) => q.status === "WON")
      .reduce((sum, q) => sum + (q.totalAmount || 0), 0);
    const grossProfit = quotes.reduce(
      (sum, q) => sum + (q.totalMargin || 0),
      0
    );
    const marginRate = totalQuoted > 0 ? (grossProfit / totalQuoted) * 100 : 0;

    res.json({
      metrics: [
        {
          title: "總報價金額",
          value: totalQuoted,
          trend: "up",
          change: 12,
        },
        {
          title: "成交金額",
          value: totalWon,
          trend: "up",
          change: 8,
        },
        {
          title: "毛利總額",
          value: grossProfit,
          trend: "up",
          change: 5,
        },
        {
          title: "平均毛利率",
          value: marginRate.toFixed(1),
          trend: "up",
          change: 2,
        },
      ],
    });
  } catch (error) {
    console.error("Failed to get analytics metrics:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

export const getAnalyticsProjects = async (req, res) => {
  const userId = req.user.userId;

  try {
    const projects = await prisma.quote.findMany({
      where: { userId },
      include: {
        customer: true,
      },
      orderBy: {
        totalAmount: "desc",
      },
    });

    // Group project types
    const typesMap = projects.reduce((acc, p) => {
      acc[p.projectType] = (acc[p.projectType] || 0) + 1;
      return acc;
    }, {});
    const totalProjects = projects.length;
    const projectTypes = Object.entries(typesMap).map(([label, count]) => ({
      label,
      percent: Math.round((count / totalProjects) * 100),
      color: "#2D7B4E",
    }));

    // Top Projects
    const topProjects = projects.slice(0, 5).map((p) => ({
      title: p.projectName,
      subtitle: p.customerName || p.customer?.name || "Unknown Customer",
      value: p.totalAmount,
    }));

    // Top Customers
    const customerMap = projects.reduce((acc, p) => {
      const name = p.customerName || p.customer?.name || "Unknown";
      acc[name] = (acc[name] || 0) + (p.totalAmount || 0);
      return acc;
    }, {});
    const topCustomers = Object.entries(customerMap)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([title, value]) => ({
        title,
        subtitle: `Total spent: $${value.toLocaleString()}`,
        value,
      }));

    res.json({
      projectTypes,
      topProjects,
      topCustomers,
    });
  } catch (error) {
    console.error("Failed to get analytics projects:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

export const postAnalyticsInsight = async (req, res) => {
  // Mock AI response for now as requested by "static display" context if AI is not ready
  // But we can make it sound more dynamic
  res.json({
    insight:
      "根據目前的數據，本月的成交率穩定在 75% 以上，建議針對高毛利的「官網開發」專案加強推廣。",
  });
};
