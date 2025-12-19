// src/config/swagger.js
import fs from "fs";
import yaml from "yaml";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read the OpenAPI YAML file
const openapiPath = join(__dirname, "../../openapi.yaml");
const file = fs.readFileSync(openapiPath, "utf8");
const swaggerSpec = yaml.parse(file);

// 動態設定 Servers
const port = process.env.PORT || 3001;
const baseUrl = process.env.BASE_URL || `http://localhost:${port}`;

// 覆蓋 openapi.yaml 中的 servers 設定
swaggerSpec.servers = [
  {
    url: `${baseUrl}/api`,
    description:
      process.env.NODE_ENV === "production"
        ? "Production server"
        : "Development server",
  },
];

export default swaggerSpec;
