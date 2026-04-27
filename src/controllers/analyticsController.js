import prisma from "../lib/prisma.js";
import {
  extractGeminiRetryAfterSeconds,
  extractGeminiStatusCode,
  generateGeminiText,
  getGeminiClient,
  getGeminiModelName,
  hasGeminiApiKey,
} from "../lib/gemini.js";

const ANALYTICS_INSIGHT_QUEUE_WAIT_MS = 8_000;

export const getAnalyticsMetrics = async (req, res) => {
  const workspaceId = req.workspace?.id;

  try {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();

    // Current month start and end
    const currentMonthStart = new Date(currentYear, currentMonth, 1);
    const nextMonthStart = new Date(currentYear, currentMonth + 1, 1);

    // Previous month start and end
    const prevMonthStart = new Date(currentYear, currentMonth - 1, 1);
    const prevMonthEnd = new Date(currentYear, currentMonth, 1);

    // Trend start (6 months ago)
    const trendStart = new Date(currentYear, currentMonth - 5, 1);

    // Fetch quotes for current, previous month, and trend range
    const [currentMonthQuotes, prevMonthQuotes, trendQuotes] =
      await Promise.all([
        prisma.quote.findMany({
          where: {
            workspaceId,
            createdAt: {
              gte: currentMonthStart,
              lt: nextMonthStart,
            },
          },
          select: { totalAmount: true, totalMargin: true, status: true },
        }),
        prisma.quote.findMany({
          where: {
            workspaceId,
            createdAt: {
              gte: prevMonthStart,
              lt: prevMonthEnd,
            },
          },
          select: { totalAmount: true, totalMargin: true, status: true },
        }),
        prisma.quote.findMany({
          where: {
            workspaceId,
            createdAt: {
              gte: trendStart,
            },
          },
          select: { totalAmount: true, status: true, createdAt: true },
          orderBy: { createdAt: "asc" },
        }),
      ]);

    // Helper to calculate metrics
    const calculateMetrics = (quotes) => {
      const totalQuoted = quotes.reduce(
        (sum, q) => sum + (q.totalAmount || 0),
        0,
      );
      const totalWon = quotes
        .filter((q) => q.status === "WON")
        .reduce((sum, q) => sum + (q.totalAmount || 0), 0);
      const grossProfit = quotes.reduce(
        (sum, q) => sum + (q.totalMargin || 0),
        0,
      );
      const marginRate =
        totalQuoted > 0 ? (grossProfit / totalQuoted) * 100 : 0;
      return { totalQuoted, totalWon, grossProfit, marginRate };
    };

    const currentMetrics = calculateMetrics(currentMonthQuotes);
    const prevMetrics = calculateMetrics(prevMonthQuotes);

    // Helper to calculate trend and change
    const calculateTrend = (current, previous) => {
      if (previous === 0) {
        return {
          change: current === 0 ? 0 : 100,
          trend: current > 0 ? "up" : "neutral",
        };
      }
      const change = ((current - previous) / previous) * 100;
      return {
        change: Math.abs(Math.round(change)),
        trend: change > 0 ? "up" : change < 0 ? "down" : "neutral",
      };
    };

    const totalQuotedTrend = calculateTrend(
      currentMetrics.totalQuoted,
      prevMetrics.totalQuoted,
    );
    const totalWonTrend = calculateTrend(
      currentMetrics.totalWon,
      prevMetrics.totalWon,
    );
    const grossProfitTrend = calculateTrend(
      currentMetrics.grossProfit,
      prevMetrics.grossProfit,
    );
    const marginRateTrend = calculateTrend(
      currentMetrics.marginRate,
      prevMetrics.marginRate,
    );

    // Calculate 6-month trend data
    const trendData = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(currentYear, currentMonth - i, 1);
      const year = d.getFullYear();
      const month = d.getMonth();
      const label = `${year}-${String(month + 1).padStart(2, "0")}`;

      const monthlyQuotes = trendQuotes.filter((q) => {
        const qDate = new Date(q.createdAt);
        return qDate.getFullYear() === year && qDate.getMonth() === month;
      });

      const quoted = monthlyQuotes.reduce(
        (sum, q) => sum + (q.totalAmount || 0),
        0,
      );
      const won = monthlyQuotes
        .filter((q) => q.status === "WON")
        .reduce((sum, q) => sum + (q.totalAmount || 0), 0);

      trendData.push({ name: label, quoted, won });
    }

    res.json({
      metrics: [
        {
          title: "總報價金額",
          value: currentMetrics.totalQuoted,
          trend: totalQuotedTrend.trend,
          change: totalQuotedTrend.change,
        },
        {
          title: "成交金額",
          value: currentMetrics.totalWon,
          trend: totalWonTrend.trend,
          change: totalWonTrend.change,
        },
        {
          title: "毛利總額",
          value: currentMetrics.grossProfit,
          trend: grossProfitTrend.trend,
          change: grossProfitTrend.change,
        },
        {
          title: "平均毛利率",
          value: currentMetrics.marginRate.toFixed(1),
          trend: marginRateTrend.trend,
          change: marginRateTrend.change,
        },
      ],
      trendData,
    });
  } catch (error) {
    console.error("Failed to get analytics metrics:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

export const getAnalyticsProjects = async (req, res) => {
  const workspaceId = req.workspace?.id;

  try {
    const projects = await prisma.quote.findMany({
      where: { workspaceId },
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
  const workspaceId = req.workspace?.id;
  const creditCost = 10;

  try {
    if (!workspaceId) {
      return res.status(401).json({
        success: false,
        message: "Workspace not found",
      });
    }

    if (req.isFallbackWorkspace) {
      return res.status(403).json({
        success: false,
        message:
          "Unable to verify current workspace ID. Please select a workspace.",
        errorCode: "WORKSPACE_ID_MISSING",
      });
    }

    // 1. Fetch data for the prompt
    const [quotes, projects] = await Promise.all([
      prisma.quote.findMany({
        where: { workspaceId },
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
        where: { workspaceId },
        orderBy: { totalAmount: "desc" },
        take: 5,
      }),
    ]);

    if (quotes.length === 0) {
      return res.json({
        insight: "目前尚無足夠的數據產生洞察。建議先建立一些報價單！",
      });
    }

    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { creditBalance: true },
    });

    if (!workspace) {
      return res.status(404).json({
        success: false,
        message: "Workspace does not exist",
      });
    }

    if (workspace.creditBalance < creditCost) {
      return res.status(403).json({
        success: false,
        message: "Insufficient credits. Please top up your account.",
        errorCode: "INSUFFICIENT_CREDITS",
      });
    }

    // 2. Calculate key metrics for the AI
    const totalQuoted = quotes.reduce(
      (sum, q) => sum + (q.totalAmount || 0),
      0,
    );
    const totalWon = quotes
      .filter((q) => q.status === "WON")
      .reduce((sum, q) => sum + (q.totalAmount || 0), 0);
    const grossProfit = quotes.reduce(
      (sum, q) => sum + (q.totalMargin || 0),
      0,
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
      ", ",
    )}
- 前五大專案：${projects
      .map((p) => `${p.projectName} (${p.totalAmount})`)
      .join(", ")}
`;

    const prompt = `
你是一位專業的業務分析顧問。請根據以下用戶的報價數據，提供一段簡短、具備洞察力且具備行動建議的「AI 洞察」（約 60-100 字）。
語氣要專業、正面且具備商業價值。

${dataSummary}

請直接輸出洞察文本，不需要標題或其他格式。
`;

    const geminiClient = getGeminiClient();
    if (!geminiClient) {
      return res.status(500).json({
        success: false,
        message: "GOOGLE_GENERATIVE_AI_API_KEY is not configured",
        apiKeyPresent: hasGeminiApiKey(),
      });
    }

    const modelName = getGeminiModelName("analyticsInsight");
    let text;

    try {
      text = await generateGeminiText(geminiClient, prompt, {
        modelName,
        maxQueueWaitMs: ANALYTICS_INSIGHT_QUEUE_WAIT_MS,
      });
    } catch (error) {
      const statusCode = extractGeminiStatusCode(error);
      if (statusCode === 429) {
        const retryAfterSeconds = extractGeminiRetryAfterSeconds(error, 20);
        res.set("Retry-After", String(retryAfterSeconds));
        return res.status(429).json({
          success: false,
          message: `AI 洞察目前請求量較高，請約 ${retryAfterSeconds} 秒後再試。`,
          errorCode: "AI_RATE_LIMIT",
          retryAfterSeconds,
        });
      }

      throw error;
    }

    // 4. Deduct credits after successful AI generation
    await prisma.workspace.update({
      where: { id: workspaceId },
      data: {
        creditBalance: {
          decrement: creditCost,
        },
      },
    });

    res.json({
      insight: text.trim(),
    });
  } catch (error) {
    console.error("Failed to generate AI insight:", error);
    res
      .status(500)
      .json({
        success: false,
        message: "Failed to generate AI insight",
        error: error.message,
      });
  }
};
