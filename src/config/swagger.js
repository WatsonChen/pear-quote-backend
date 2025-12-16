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

export default swaggerSpec;
