import { GoogleGenerativeAI } from "@google/generative-ai";
import "dotenv/config";

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GENERATIVE_AI_API_KEY);

async function test() {
  console.log("Testing Gemini 2.0 Flash...");
  try {
    const model = genAI.getGenerativeModel({
      model: "gemini-2.0-flash",
      generationConfig: {
        responseMimeType: "application/json",
      },
    });

    const prompt = `
      Please analyze these software requirements and break them down into actionable tasks. 
      Return the result EXCLUSIVELY as a valid JSON object with the following structure:
      {
        "summary": "string",
        "items": []
      }
      
      Requirements:
      I want a coffee shop website.
    `;

    console.log("Sending prompt...");
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    console.log("Success! Response:", text);
  } catch (e) {
    console.error("Failed!");
    console.error("Error Name:", e.name);
    console.error("Error Message:", e.message);
    if (e.cause) {
      console.error("Cause:", e.cause);
    }
    // Dump full error object if possible
    console.error(
      "Full Error:",
      JSON.stringify(e, Object.getOwnPropertyNames(e), 2),
    );
  }
}

test();
