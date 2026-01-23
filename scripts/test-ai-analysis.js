import { analyzeRequirements } from "../src/controllers/aiController.js";
import dotenv from "dotenv";

dotenv.config();

/**
 * Mock Request and Response for testing
 */
const mockReq = {
  body: {
    requirements:
      "I want to build a simple landing page for my new coffee shop. It should have a hero section, and a contact form.",
  },
};

const mockRes = {
  status: (code) => ({
    json: (data) => {
      console.log(`Response Status: ${code}`);
      console.log("Response Data:", JSON.stringify(data, null, 2));
    },
  }),
  json: (data) => {
    console.log("Response Data:", JSON.stringify(data, null, 2));
  },
};

async function testAnalysis() {
  console.log("Testing AI Requirements Analysis...");
  try {
    await analyzeRequirements(mockReq, mockRes);
  } catch (error) {
    console.error("Test Failed:", error);
  }
}

testAnalysis();
