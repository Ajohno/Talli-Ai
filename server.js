import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { handleAgentRequest } from "./lib/agent.js";

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static("public"));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.post("/api/agent", (req, res) => {
  return handleAgentRequest(req, res);
});

app.listen(port, () => {
  console.log(`Running: http://localhost:${port}`);
});

export default app;
