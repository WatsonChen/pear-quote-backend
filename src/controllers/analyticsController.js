import prisma from "../lib/prisma.js";
import { generateText } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";

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

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GENERATIVE_AI_API_KEY);

export const postAnalyticsInsight = async (req, res) => {
  const userId = req.user.userId;

  try {
    // 1. Fetch data for the prompt
    const [quotes, projects] = await Promise.all([
      prisma.quote.findMany({
        where: { userId },
        select: {
          totalAmount: true,
          totalMargin: true,
          status: true,
          projectName: true,
          projectType: true,
          customerName: true,
          createdAt: true,
        },
      }),
      prisma.quote.findMany({
        where: { userId },
        orderBy: { totalAmount: "desc" },
        take: 5,
      }),
    ]);

    if (quotes.length === 0) {
      return res.json({
        insight: "目前尚無足夠的數據產生洞察。建議先建立一些報價單！",
      });
    }

    // 2. Calculate key metrics for the AI
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
    const winRate = ((totalWon / totalQuoted) * 100).toFixed(1);
    const avgMargin =
      totalQuoted > 0 ? ((grossProfit / totalQuoted) * 100).toFixed(1) : 0;

    const dataSummary = `
數據概況：
- 總報價金額：TWD ${totalQuoted.toLocaleString()}
- 已成交金額：TWD ${totalWon.toLocaleString()}
- 成交率：${winRate}%
- 平均毛利率：${avgMargin}%
- 熱門專案類型：${Array.from(new Set(quotes.map((q) => q.projectType))).join(
      ", "
    )}
- 前五大專案：${projects
      .map((p) => `${p.projectName} (${p.totalAmount})`)
      .join(", ")}
`;

    // 3. Call Gemini via official SDK
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const prompt = `
你是一位專業的業務分析顧問。請根據以下用戶的報價數據，提供一段簡短、具備洞察力且具備行動建議的「AI 洞察」（約 60-100 字）。
語氣要專業、正面且具備商業價值。

${dataSummary}

請直接輸出洞察文本，不需要標題或其他格式。
`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    res.json({
      insight: text.trim(),
    });
  } catch (error) {
    console.error("Failed to generate AI insight:", error);
    res
      .status(500)
      .json({ message: "Failed to generate AI insight", error: error.message });
  }
};
