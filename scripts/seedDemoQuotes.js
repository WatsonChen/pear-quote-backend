#!/usr/bin/env node
// scripts/seedDemoQuotes.js
// 用途：建立 5 個金額夠高、足以排進 Top 5 的示範報價單
// 使用方式：node scripts/seedDemoQuotes.js [workspaceId]
// 若不傳 workspaceId，將自動使用第一個找到的 Workspace

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const DEMO_DATA = [
  {
    customer: {
      name: "樺達科技股份有限公司",
      industry: "科技",
      type: "company",
      email: "contact@huada-tech.com",
    },
    quote: {
      projectName: "企業官網全面改版暨 CMS 系統建置",
      projectType: "web",
      status: "WON",
      totalAmount: 1_200_000,
      wonAmount: 1_200_000,
      totalCost: 720_000,
      totalMargin: 40,
      expectedDays: 90,
      description:
        "全站重新設計，包含後台 CMS、多語言支援、SEO 優化與 CDN 部署。",
    },
    items: [
      {
        description: "UI/UX 設計（全站）",
        type: "service",
        estimatedHours: 200,
        suggestedRole: "設計師",
        hourlyRate: 1500,
        amount: 300_000,
      },
      {
        description: "前端開發（Next.js）",
        type: "service",
        estimatedHours: 300,
        suggestedRole: "資深工程師",
        hourlyRate: 1800,
        amount: 540_000,
      },
      {
        description: "後端 CMS 開發",
        type: "service",
        estimatedHours: 150,
        suggestedRole: "資深工程師",
        hourlyRate: 1800,
        amount: 270_000,
      },
      {
        description: "雲端部署與 CDN 設定",
        type: "service",
        estimatedHours: 50,
        suggestedRole: "初級工程師",
        hourlyRate: 1200,
        amount: 60_000,
      },
      {
        description: "SEO 優化諮詢",
        type: "service",
        estimatedHours: 20,
        suggestedRole: "PM",
        hourlyRate: 1500,
        amount: 30_000,
      },
    ],
  },
  {
    customer: {
      name: "旭日創意有限公司",
      industry: "電商",
      type: "company",
      email: "info@sunrise-creative.com",
    },
    quote: {
      projectName: "跨境電商平台開發（多幣別 / 多語系）",
      projectType: "web",
      status: "WON",
      totalAmount: 980_000,
      wonAmount: 980_000,
      totalCost: 588_000,
      totalMargin: 40,
      expectedDays: 120,
      description:
        "支援繁中、英文、日文三語系，整合 Stripe 跨境支付與物流 API。",
    },
    items: [
      {
        description: "產品規劃與系統架構設計",
        type: "service",
        estimatedHours: 60,
        suggestedRole: "PM",
        hourlyRate: 1500,
        amount: 90_000,
      },
      {
        description: "多語系前端開發（React）",
        type: "service",
        estimatedHours: 280,
        suggestedRole: "資深工程師",
        hourlyRate: 1800,
        amount: 504_000,
      },
      {
        description: "購物車 / 結帳 / 付款流程",
        type: "service",
        estimatedHours: 140,
        suggestedRole: "資深工程師",
        hourlyRate: 1800,
        amount: 252_000,
      },
      {
        description: "物流 API 整合（黑貓 / 蝦皮）",
        type: "service",
        estimatedHours: 60,
        suggestedRole: "初級工程師",
        hourlyRate: 1200,
        amount: 72_000,
      },
      {
        description: "QA 測試與上線協助",
        type: "service",
        estimatedHours: 40,
        suggestedRole: "初級工程師",
        hourlyRate: 1200,
        amount: 48_000,
      },
      {
        description: "伺服器年費（首年）",
        type: "material",
        unit: "年",
        hourlyRate: 14_000,
        amount: 14_000,
      },
    ],
  },
  {
    customer: {
      name: "普騰電子股份有限公司",
      industry: "製造業",
      type: "company",
      email: "rd@proton-elec.com.tw",
    },
    quote: {
      projectName: "製造業 ERP 系統客製化開發",
      projectType: "system",
      status: "WON",
      totalAmount: 860_000,
      wonAmount: 860_000,
      totalCost: 516_000,
      totalMargin: 40,
      expectedDays: 150,
      description:
        "整合現有 SAP 系統，新增生產排程、倉儲管理、進出貨追蹤模組。",
    },
    items: [
      {
        description: "需求訪談與系統分析",
        type: "service",
        estimatedHours: 80,
        suggestedRole: "PM",
        hourlyRate: 1500,
        amount: 120_000,
      },
      {
        description: "生產排程模組開發",
        type: "service",
        estimatedHours: 200,
        suggestedRole: "資深工程師",
        hourlyRate: 1800,
        amount: 360_000,
      },
      {
        description: "倉儲 / 進出貨管理模組",
        type: "service",
        estimatedHours: 150,
        suggestedRole: "資深工程師",
        hourlyRate: 1800,
        amount: 270_000,
      },
      {
        description: "SAP API 串接",
        type: "service",
        estimatedHours: 60,
        suggestedRole: "資深工程師",
        hourlyRate: 1800,
        amount: 108_000,
      },
      {
        description: "教育訓練暨上線輔導",
        type: "service",
        estimatedHours: 8,
        suggestedRole: "PM",
        hourlyRate: 1500,
        amount: 12_000,
      },
      {
        description: "硬體條碼掃描器（x5）",
        type: "material",
        unit: "台",
        hourlyRate: 6_000,
        amount: 30_000,
      },
    ],
  },
  {
    customer: {
      name: "翠峰顧問股份有限公司",
      industry: "金融",
      type: "company",
      email: "tech@jade-peak.com",
    },
    quote: {
      projectName: "投資組合分析 SaaS 平台開發",
      projectType: "web",
      status: "WON",
      totalAmount: 720_000,
      wonAmount: 720_000,
      totalCost: 432_000,
      totalMargin: 40,
      expectedDays: 90,
      description: "提供即時資產配置分析、風險評估報告產生、與法遵監控儀表板。",
    },
    items: [
      {
        description: "系統架構規劃（含資安評估）",
        type: "service",
        estimatedHours: 40,
        suggestedRole: "PM",
        hourlyRate: 1500,
        amount: 60_000,
      },
      {
        description: "資料視覺化儀表板（D3.js）",
        type: "service",
        estimatedHours: 180,
        suggestedRole: "資深工程師",
        hourlyRate: 1800,
        amount: 324_000,
      },
      {
        description: "投資分析演算法整合",
        type: "service",
        estimatedHours: 140,
        suggestedRole: "資深工程師",
        hourlyRate: 1800,
        amount: 252_000,
      },
      {
        description: "資安稽核與滲透測試",
        type: "service",
        estimatedHours: 40,
        suggestedRole: "資深工程師",
        hourlyRate: 1800,
        amount: 72_000,
      },
      {
        description: "SSL 憑證（3 年）",
        type: "material",
        unit: "年",
        hourlyRate: 4_000,
        amount: 12_000,
      },
    ],
  },
  {
    customer: {
      name: "鴻澤數位媒體有限公司",
      industry: "媒體",
      type: "company",
      email: "project@hongze-media.com",
    },
    quote: {
      projectName: "串流影音平台建置（OTT Platform）",
      projectType: "app",
      status: "WON",
      totalAmount: 540_000,
      wonAmount: 540_000,
      totalCost: 324_000,
      totalMargin: 40,
      expectedDays: 75,
      description:
        "支援 HLS 串流播放、訂閱制付費牆、內容管理後台與行動端 App（iOS / Android）。",
    },
    items: [
      {
        description: "產品規劃與 UX 設計",
        type: "service",
        estimatedHours: 80,
        suggestedRole: "設計師",
        hourlyRate: 1500,
        amount: 120_000,
      },
      {
        description: "HLS 串流播放器整合",
        type: "service",
        estimatedHours: 100,
        suggestedRole: "資深工程師",
        hourlyRate: 1800,
        amount: 180_000,
      },
      {
        description: "訂閱付費牆 / 會員系統",
        type: "service",
        estimatedHours: 80,
        suggestedRole: "資深工程師",
        hourlyRate: 1800,
        amount: 144_000,
      },
      {
        description: "內容管理後台（CMS）",
        type: "service",
        estimatedHours: 40,
        suggestedRole: "初級工程師",
        hourlyRate: 1200,
        amount: 48_000,
      },
      {
        description: "行動端 App（React Native）",
        type: "service",
        estimatedHours: 24,
        suggestedRole: "資深工程師",
        hourlyRate: 1800,
        amount: 43_200,
      },
      {
        description: "CDN 費用（首年預估）",
        type: "material",
        unit: "年",
        hourlyRate: 4_800,
        amount: 4_800,
      },
    ],
  },
];

async function main() {
  const workspaceIdArg = process.argv[2];

  let workspace;
  if (workspaceIdArg) {
    workspace = await prisma.workspace.findUnique({
      where: { id: workspaceIdArg },
    });
    if (!workspace) {
      console.error(`❌ 找不到 workspaceId: ${workspaceIdArg}`);
      process.exit(1);
    }
  } else {
    workspace = await prisma.workspace.findFirst();
    if (!workspace) {
      console.error("❌ 資料庫中找不到任何 Workspace，請先建立帳號。");
      process.exit(1);
    }
  }

  console.log(`\n🍐 使用 Workspace: ${workspace.name} (${workspace.id})\n`);

  for (const demo of DEMO_DATA) {
    // 建立或找到客戶
    let customer = await prisma.customer.findFirst({
      where: { name: demo.customer.name, workspaceId: workspace.id },
    });
    if (!customer) {
      customer = await prisma.customer.create({
        data: { ...demo.customer, workspaceId: workspace.id },
      });
      console.log(`  👤 新增客戶: ${customer.name}`);
    } else {
      console.log(`  👤 已存在客戶: ${customer.name}`);
    }

    // 建立報價單
    const quote = await prisma.quote.create({
      data: {
        ...demo.quote,
        customerId: customer.id,
        customerName: customer.name,
        workspaceId: workspace.id,
        items: {
          create: demo.items,
        },
      },
    });

    const amountDisplay = `NT$${demo.quote.wonAmount.toLocaleString()}`;
    console.log(`  📄 新增報價單: 【${quote.projectName}】${amountDisplay} ✅`);
  }

  console.log(
    "\n✅ 全部 5 筆示範資料建立完成！請重新訪問 AI 收益追蹤頁面截圖。\n",
  );
}

main()
  .catch((e) => {
    console.error("❌ 發生錯誤:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
