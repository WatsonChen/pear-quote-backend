import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GENERATIVE_AI_API_KEY);

/**
 * Analyze requirements using AI
 * POST /api/ai/analyze
 */
export async function analyzeRequirements(req, res) {
  try {
    const { requirements, images } = req.body;

    if (!requirements) {
      return res.status(400).json({ message: "Requirements text is required" });
    }

    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-flash",
      generationConfig: {
        responseMimeType: "application/json",
      },
    });

    const prompt = `
Please analyze these software requirements and break them down into actionable tasks. 
Return the result EXCLUSIVELY as a valid JSON object with the following structure:
{
  "summary": "string",
  "items": [
    {
      "id": "string (e.g., ai_1)",
      "description": "string",
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
        cleanedText
      );
      throw new Error(
        `Failed to parse AI response as JSON: ${parseError.message}`
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
