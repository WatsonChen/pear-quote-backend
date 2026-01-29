import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GENERATIVE_AI_API_KEY);

/**
 * Analyze requirements using AI
 * POST /api/ai/analyze
 */
export async function analyzeRequirements(req, res) {
  try {
    const { requirements, images } = req.body;

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
