import { GoogleGenerativeAI } from "@google/generative-ai";
import prisma from "../lib/prisma.js";
import { POINT_COSTS } from "../config/pricing.config.js";

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GENERATIVE_AI_API_KEY);

/**
 * Analyze requirements using AI
 * POST /api/ai/analyze
 */
export async function analyzeRequirements(req, res) {
  try {
    const { requirements, images } = req.body;
    const workspaceId = req.workspace?.id;
    const creditCost = 10;

    if (!workspaceId) {
      return res
        .status(401)
        .json({ success: false, message: "Workspace not found" });
    }

    // STRICT CHECK: Do not allow AI Analysis if the workspace is implicitly determined via fallback.
    // The frontend must explicitly specify the WorkspaceId to prevent accidental point deduction.
    if (req.isFallbackWorkspace) {
      return res.status(403).json({
        success: false,
        message:
          "Unable to verify current workspace ID. Please select a workspace.",
        errorCode: "WORKSPACE_ID_MISSING",
      });
    }

    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { creditBalance: true },
    });

    if (!workspace) {
      return res
        .status(404)
        .json({ success: false, message: "Workspace does not exist" });
    }

    if (workspace.creditBalance < creditCost) {
      return res.status(403).json({
        success: false,
        message: "Insufficient credits. Please top up your account.",
        errorCode: "INSUFFICIENT_CREDITS",
      });
    }

    // Allow empty requirements if images are provided
    if (!requirements && (!images || images.length === 0)) {
      return res
        .status(400)
        .json({ message: "Requirements text or images are required" });
    }

    const model = genAI.getGenerativeModel({
      model: "gemini-2.0-flash", // Updated to confirmed available model
      generationConfig: {
        responseMimeType: "application/json",
      },
    });

    const prompt = `
Please analyze these software requirements and break them down into actionable tasks. 
Return the result EXCLUSIVELY as a valid JSON object.

Important Instructions:
1. **Language**: All text content (description, etc.) MUST be in **Traditional Chinese (Taiwan)** (繁體中文).
2. **Financials**: 
   - You MUST estimate a reasonable "hourlyRate" (e.g., between 800 and 3000 TWD based on role).
   - "amount" MUST be calculated as "estimatedHours" * "hourlyRate".
   - Do NOT return 0 for rates or amounts.

JSON Structure:
{
  "summary": "string (Short summary in Traditional Chinese)",
  "items": [
    {
      "id": "string (e.g., ai_1)",
      "description": "string (Task description in Traditional Chinese)",
      "estimatedHours": number,
      "suggestedRole": "design" | "frontend" | "backend" | "pm" | "qa" | "other",
      "hourlyRate": number,
      "amount": number
    }
  ]
}

Requirements:
${requirements}
`;

    console.log("Calling Gemini AI via official SDK with payload:", {
      requirementsLength: requirements.length,
      imagesCount: images?.length || 0,
    });

    // Safety check for images
    const safeImages = Array.isArray(images) ? images : [];

    const parts = [{ text: prompt }];

    safeImages.forEach((img, idx) => {
      try {
        const base64Data = img.includes(",") ? img.split(",")[1] : img;
        parts.push({
          inlineData: {
            data: base64Data,
            mimeType: "image/jpeg",
          },
        });
      } catch (e) {
        console.error(`Error processing image at index ${idx}:`, e);
      }
    });

    const result = await model.generateContent(parts);
    const response = await result.response;
    const text = response.text();

    console.log("AI Response received successfully.");

    // Parse the JSON result
    const cleanedText = text.replace(/```json\n?|```/g, "").trim();
    let parsedResult;
    try {
      parsedResult = JSON.parse(cleanedText);
    } catch (parseError) {
      console.error(
        "JSON Parsing Error:",
        parseError,
        "Cleaned Text:",
        cleanedText,
      );
      throw new Error(
        `Failed to parse AI response as JSON: ${parseError.message}`,
      );
    }

    // Deduct credits after a successful parse
    await prisma.workspace.update({
      where: { id: workspaceId },
      data: {
        creditBalance: {
          decrement: creditCost,
        },
      },
    });

    return res.json({
      summary: parsedResult.summary,
      items: parsedResult.items,
    });
  } catch (error) {
    console.error("CRITICAL AI Analysis error:", error);
    // Return the full error message and stack for debugging
    return res.status(500).json({
      success: false,
      message: "Failed to analyze requirements",
      error: error.message,
      stack: error.stack,
      apiKeyPresent: !!process.env.GOOGLE_GENERATIVE_AI_API_KEY,
    });
  }
}

/**
 * Generate an AI summary for a customer's profile and history
 * POST /api/ai/customer-summary
 */
export async function generateCustomerSummary(req, res) {
  try {
    const { customerId } = req.body;
    const workspaceId = req.workspace?.id;
    const creditCost = POINT_COSTS.CUSTOMER_AI_SUMMARY;

    if (!workspaceId) {
      return res.status(401).json({ success: false, message: "Workspace not found" });
    }

    if (req.isFallbackWorkspace) {
      return res.status(403).json({
        success: false,
        message: "Unable to verify current workspace ID. Please select a workspace.",
        errorCode: "WORKSPACE_ID_MISSING",
      });
    }

    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { creditBalance: true },
    });

    if (!workspace) {
      return res.status(404).json({ success: false, message: "Workspace does not exist" });
    }

    if (workspace.creditBalance < creditCost) {
      return res.status(403).json({
        success: false,
        message: "Insufficient credits. Please top up your account.",
        errorCode: "INSUFFICIENT_CREDITS",
      });
    }

    // Fetch customer data to summarize
    const customer = await prisma.customer.findFirst({
      where: { id: customerId, workspaceId },
      include: {
        quotes: {
          select: { projectName: true, projectType: true, totalAmount: true, status: true },
          orderBy: { createdAt: "desc" },
          take: 5
        }
      }
    });

    if (!customer) {
      return res.status(404).json({ success: false, message: "Customer not found" });
    }

    const model = genAI.getGenerativeModel({
      model: "gemini-2.0-flash",
    });

    const prompt = `
Please act as an expert business analyst. I will provide you with a customer's profile and their recent quotes.
Please write a concise, professional AI summary (in Traditional Chinese / 繁體中文) analyzing this customer.
Include insights like their industry focus, value to the company based on quotes, and any recommendations for future engagement.
Do NOT use markdown structuring like bolding every line, just a flowing paragraph or a couple of bullet points.

Customer Name: ${customer.name}
Industry: ${customer.industry || 'Unknown'}
Description: ${customer.description || 'None'}
Type: ${customer.type}

Recent Quotes:
${JSON.stringify(customer.quotes, null, 2)}
`;

    const result = await model.generateContent(prompt);
    const text = result.response.text();

    await prisma.$transaction([
      // 1. Deduct points
      prisma.workspace.update({
        where: { id: workspaceId },
        data: { creditBalance: { decrement: creditCost } },
      }),
      // 2. Save summary to customer
      prisma.customer.update({
        where: { id: customerId },
        data: { aiSummary: text },
      })
    ]);

    return res.json({ success: true, aiSummary: text });
  } catch (error) {
    console.error("CRITICAL AI Customer Summary error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to generate customer summary",
      error: error.message,
    });
  }
}

/**
 * Translate a quote's details via AI
 * POST /api/ai/translate-quote
 */
export async function translateQuote(req, res) {
  try {
    const { quoteId, targetLanguage } = req.body;
    const workspaceId = req.workspace?.id;
    const creditCost = POINT_COSTS.QUOTE_TRANSLATION;

    if (!workspaceId) {
      return res.status(401).json({ success: false, message: "Workspace not found" });
    }

    if (req.isFallbackWorkspace) {
      return res.status(403).json({
        success: false,
        message: "Unable to verify current workspace ID. Please select a workspace.",
        errorCode: "WORKSPACE_ID_MISSING",
      });
    }

    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { creditBalance: true },
    });

    if (!workspace) {
      return res.status(404).json({ success: false, message: "Workspace does not exist" });
    }

    if (workspace.creditBalance < creditCost) {
      return res.status(403).json({
        success: false,
        message: "Insufficient credits. Please top up your account.",
        errorCode: "INSUFFICIENT_CREDITS",
      });
    }

    const quote = await prisma.quote.findFirst({
      where: { id: quoteId, workspaceId },
      include: { items: true }
    });

    if (!quote) {
      return res.status(404).json({ success: false, message: "Quote not found" });
    }

    const model = genAI.getGenerativeModel({
      model: "gemini-2.0-flash",
      generationConfig: {
        responseMimeType: "application/json",
      },
    });

    const prompt = `
Please translate the following quote details into ${targetLanguage}. 
Return the result EXCLUSIVELY as a valid JSON object.

JSON Structure:
{
  "projectName": "string (Translated)",
  "description": "string (Translated)",
  "items": [
    {
      "id": "string (Original item ID, do not translate)",
      "description": "string (Translated item description)",
      "unit": "string (Translated unit)"
    }
  ]
}

Quote Details:
Project Name: ${quote.projectName}
Description: ${quote.description || ''}
Items:
${JSON.stringify(quote.items.map(i => ({ id: i.id, description: i.description, unit: i.unit })), null, 2)}
`;

    const result = await model.generateContent(prompt);
    const text = result.response.text();

    const cleanedText = text.replace(/\`\`\`json\n?|\`\`\`/g, "").trim();
    const translatedData = JSON.parse(cleanedText);

    await prisma.workspace.update({
      where: { id: workspaceId },
      data: { creditBalance: { decrement: creditCost } },
    });

    return res.json({ success: true, translatedData });
  } catch (error) {
    console.error("CRITICAL AI Quote Translation error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to translate quote",
      error: error.message,
    });
  }
}

/**
 * Smart refine a quote to match a target budget
 * POST /api/ai/refine-quote
 */
export async function refineQuote(req, res) {
  try {
    const { quoteId, targetBudget } = req.body;
    const workspaceId = req.workspace?.id;
    const creditCost = POINT_COSTS.QUOTE_SMART_REFINEMENT;

    if (!workspaceId) {
      return res.status(401).json({ success: false, message: "Workspace not found" });
    }

    if (req.isFallbackWorkspace) {
      return res.status(403).json({
        success: false,
        message: "Unable to verify current workspace ID. Please select a workspace.",
        errorCode: "WORKSPACE_ID_MISSING",
      });
    }

    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { creditBalance: true },
    });

    if (!workspace) {
      return res.status(404).json({ success: false, message: "Workspace does not exist" });
    }

    if (workspace.creditBalance < creditCost) {
      return res.status(403).json({
        success: false,
        message: "Insufficient credits. Please top up your account.",
        errorCode: "INSUFFICIENT_CREDITS",
      });
    }

    const quote = await prisma.quote.findFirst({
      where: { id: quoteId, workspaceId },
      include: { items: true }
    });

    if (!quote) {
      return res.status(404).json({ success: false, message: "Quote not found" });
    }

    const model = genAI.getGenerativeModel({
      model: "gemini-2.0-flash",
      generationConfig: {
        responseMimeType: "application/json",
      },
    });

    const prompt = `
Please act as an expert project manager. I will provide you with a quote's details and items, and a target budget (${targetBudget}).
Your task is to smartly adjust the 'estimatedHours' of the items so that the newly calculated total amount (sum of estimatedHours * hourlyRate for all items) is as close to the target budget as possible, while keeping the distribution of hours realistic. Do NOT change hourly rates, only estimated hours.
Return the result EXCLUSIVELY as a valid JSON object.

JSON Structure:
{
  "rationale": "string (Short explanation in Traditional Chinese of what was adjusted and why)",
  "items": [
    {
      "id": "string (Original item ID, essential!)",
      "estimatedHours": number (Adjusted hours),
      "hourlyRate": number (Original rate),
      "amount": number (New amount = estimatedHours * hourlyRate)
    }
  ],
  "newTotalAmount": number (Sum of all new item amounts)
}

Quote Details:
Items:
${JSON.stringify(quote.items.map(i => ({ 
  id: i.id, 
  description: i.description, 
  estimatedHours: i.estimatedHours,
  hourlyRate: i.hourlyRate,
  amount: i.amount
})), null, 2)}
`;

    const result = await model.generateContent(prompt);
    const text = result.response.text();

    const cleanedText = text.replace(/\`\`\`json\n?|\`\`\`/g, "").trim();
    const refinedData = JSON.parse(cleanedText);

    await prisma.workspace.update({
      where: { id: workspaceId },
      data: { creditBalance: { decrement: creditCost } },
    });

    return res.json({ success: true, refinedData });
  } catch (error) {
    console.error("CRITICAL AI Quote Refinement error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to refine quote",
      error: error.message,
    });
  }
}


