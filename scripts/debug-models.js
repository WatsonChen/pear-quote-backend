import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";

dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GENERATIVE_AI_API_KEY);

async function testModels() {
  console.log("--- Testing Gemini Models ---");
  const modelsToTest = ["gemini-1.5-flash", "gemini-1.5-pro", "gemini-pro"];

  for (const modelName of modelsToTest) {
    try {
      console.log(`Checking ${modelName}...`);
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await model.generateContent("Hello! Are you there?");
      const response = await result.response;
      console.log(
        `✅ Success for ${modelName}:`,
        response.text().substring(0, 30)
      );
    } catch (e) {
      console.error(`❌ Failure for ${modelName}:`, e.message);
    }
  }
}

testModels();
