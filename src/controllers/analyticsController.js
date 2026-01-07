export const getAnalyticsMetrics = async (req, res) => {
  // Mock data for now, ideally this would aggregate from Quotes
  res.json({
    totalRevenue: 1250000,
    totalProjects: 12,
    activeClients: 8,
    winRate: 0.75,
  });
};

export const getAnalyticsProjects = async (req, res) => {
  // Mock data for chart
  res.json([
    { name: "Jan", value: 4000, status: "completed" },
    { name: "Feb", value: 3000, status: "completed" },
    { name: "Mar", value: 2000, status: "completed" },
    { name: "Apr", value: 2780, status: "active" },
    { name: "May", value: 1890, status: "active" },
    { name: "Jun", value: 2390, status: "active" },
  ]);
};

export const postAnalyticsInsight = async (req, res) => {
  const { prompt } = req.body;
  // Mock AI response
  res.json({
    insight:
      "Based on current trends, revenue is projected to increase by 15% next quarter.",
  });
};
