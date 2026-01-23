import { generateText } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";

const google = createGoogleGenerativeAI({
  apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
  baseURL: "https://generativelanguage.googleapis.com/v1",
});

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

    // Process images if any
    const imageParts = (images || []).map((img) => {
      const base64Data = img.includes(",") ? img.split(",")[1] : img;
      return {
        type: "image",
        image: base64Data,
        mimeType: "image/jpeg",
      };
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

    console.log("Calling Gemini AI...");
    const { text } = await generateText({
      model: google("gemini-1.5-flash"),
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: prompt }, ...imageParts],
        },
      ],
    });

    console.log("AI Response received.");

    // Clean the AI output (remove markdown code blocks if any)
    const cleanedText = text.replace(/```json\n?|```/g, "").trim();
    const result = JSON.parse(cleanedText);

    return res.json({
      summary: result.summary,
      items: result.items,
    });
  } catch (error) {
    console.error("AI Analysis error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to analyze requirements",
      error: error.message,
    });
  }
}
