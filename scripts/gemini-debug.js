import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";
import fs from "fs";

dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GENERATIVE_AI_API_KEY);

async function test() {
  const log = (msg) => {
    console.log(msg);
    fs.appendFileSync("gemini-test-log.txt", msg + "\n");
  };

  if (fs.existsSync("gemini-test-log.txt"))
    fs.unlinkSync("gemini-test-log.txt");

  log("Starting Gemini Test...");
  const models = ["gemini-1.5-flash", "gemini-1.5-pro", "gemini-pro"];

  for (const modelName of models) {
    log(`Testing ${modelName}...`);
    try {
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await model.generateContent("Hi");
      const text = result.response.text();
      log(`✅ ${modelName} worked: ${text.substring(0, 10)}...`);
    } catch (e) {
      log(`❌ ${modelName} failed: ${e.message}`);
    }
  }
}

test();
