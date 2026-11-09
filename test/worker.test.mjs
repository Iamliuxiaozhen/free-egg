import worker from "../_worker.js";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const TYPES = { ".json": "application/json", ".md": "text/markdown", ".html": "text/html" };

const env = {
  ASSETS: {
    async fetch(request) {
      const url = new URL(request.url);
      const file = path.join(root, "public", url.pathname === "/" ? "index.html" : url.pathname);
      try {
        const body = await readFile(file);
        return new Response(body, {
          headers: { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" },
        });
      } catch {
        return new Response("asset not found", { status: 404 });
      }
    },
  },
};

const base = "http://localhost";
let failures = 0;

function check(name, cond, extra = "") {
  if (cond) console.log(`PASS ${name}`);
  else {
    failures++;
    console.log(`FAIL ${name} ${extra}`);
  }
}

// models list
let res = await worker.fetch(new Request(`${base}/v1/models`), env);
const models = await res.json();
check("GET /v1/models 200 + list", res.status === 200 && models.object === "list" && models.data.length === 9, res.status);

// trailing slash + model detail
res = await worker.fetch(new Request(`${base}/v1/models/gpt-4o/`), env);
const one = await res.json();
check("GET /v1/models/gpt-4o", one.id === "gpt-4o");

res = await worker.fetch(new Request(`${base}/v1/models/nope`), env);
check("GET /v1/models/nope 404", res.status === 404);

// billing
res = await worker.fetch(new Request(`${base}/dashboard/billing/subscription`), env);
const sub = await res.json();
check("subscription 10000", sub.hard_limit_usd === 10000 && sub.total_available === 10000);

res = await worker.fetch(new Request(`${base}/v1/dashboard/billing/subscription`), env);
check("/v1/dashboard alias", res.status === 200);

res = await worker.fetch(new Request(`${base}/dashboard/billing/usage`), env);
check("usage 200", res.status === 200);
res = await worker.fetch(new Request(`${base}/dashboard/billing/credit_grants`), env);
check("credit_grants 200", res.status === 200);

// non-streaming
res = await worker.fetch(
  new Request(`${base}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }] }),
  }),
  env,
);
const completion = await res.json();
check("non-streaming completion", completion.object === "chat.completion" && completion.choices[0].message.content.includes("(__)"));
console.log("---\n" + completion.choices[0].message.content + "\n---");

// streaming
const t0 = Date.now();
res = await worker.fetch(
  new Request(`${base}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gpt-4o", stream: true, messages: [] }),
  }),
  env,
);
check("streaming content-type", res.headers.get("content-type").startsWith("text/event-stream"));
let text = "";
let firstChunkAt = 0;
for await (const chunk of res.body) {
  if (!firstChunkAt) firstChunkAt = Date.now();
  text += new TextDecoder().decode(chunk);
}
const events = text.split("\n\n").filter(Boolean).map((e) => e.replace(/^data: /, ""));
check("stream ends with [DONE]", events.at(-1) === "[DONE]");
// role chunk + one chunk per egg line (9) + finish chunk + [DONE]
check("stream has 12 data events", events.length === 12, events.length);
const rebuilt = events
  .filter((e) => e !== "[DONE]")
  .map((e) => JSON.parse(e))
  .map((c) => c.choices[0].delta.content || "")
  .join("");
check("stream rebuilds egg", rebuilt.trim() === completion.choices[0].message.content.trim());
check("stream is incremental", Date.now() - firstChunkAt > 400, Date.now() - firstChunkAt);

// 404 for unknown api route, asset fallback for others
res = await worker.fetch(new Request(`${base}/v1/embeddings`), env);
check("unknown /v1 404 json", res.status === 404 && (await res.json()).error.code === "egg_not_found");
res = await worker.fetch(new Request(`${base}/`), env);
check("root falls back to assets", res.status === 404);

// streaming to disconnected client does not throw
res = await worker.fetch(
  new Request(`${base}/v1/chat/completions`, {
    method: "POST",
    body: JSON.stringify({ stream: true }),
  }),
  env,
);
res.body.cancel();

console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL PASS");
process.exit(failures ? 1 : 0);
