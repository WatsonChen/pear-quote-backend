import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";

dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GENERATIVE_AI_API_KEY);

async function test() {
  console.log("Testing Gemini API Key...");
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const result = await model.generateContent("Hello, respond with only 'OK'");
    console.log("Response:", result.response.text());
  } catch (e) {
    console.error("Gemini Error:", e.message);
    if (e.response) {
      console.error("Response Data:", JSON.stringify(e.response, null, 2));
    }
  }
}

test();
