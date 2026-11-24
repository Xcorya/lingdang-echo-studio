import { WebWorkerMLCEngineHandler } from "https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.89/lib/index.js";

const worker = new WebWorkerMLCEngineHandler();
self.addEventListener("message", (event) => worker.onmessage(event));
