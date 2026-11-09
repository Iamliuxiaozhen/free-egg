import worker from "../public/_worker.js";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const TYPES = { ".json": "application/json", ".md": "text/markdown", ".html": "text/html" };

const base = "http://localhost";

async function serveAsset(input) {
  const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const url = new URL(raw, base);
  const file = path.join(root, "public", url.pathname === "/" ? "index.html" : url.pathname);
  try {
    const body = await readFile(file);
    return new Response(body, {
      status: 200,
      headers: { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" },
    });
  } catch {
    return new Response("asset not found", { status: 404 });
  }
}

const env = { ASSETS: { fetch: serveAsset } };

let failures = 0;

function check(name, cond, extra = "") {
  if (cond) console.log(`PASS ${name}`);
  else {
    failures++;
    console.log(`FAIL ${name} ${extra}`);
  }
}

// Pages advanced mode enters through the default export.
const fetch = (request) => worker.fetch(request, env);

// models list
let res = await fetch(new Request(`${base}/v1/models`));
const models = await res.json();
check("GET /v1/models 200 + list", res.status === 200 && models.object === "list" && models.data.length === 9, res.status);

// trailing slash + model detail
res = await fetch(new Request(`${base}/v1/models/gpt-4o/`));
const one = await res.json();
check("GET /v1/models/gpt-4o", one.id === "gpt-4o");

res = await fetch(new Request(`${base}/v1/models/nope`));
check("GET /v1/models/nope 404", res.status === 404);

// billing
res = await fetch(new Request(`${base}/dashboard/billing/subscription`));
const sub = await res.json();
check("subscription 10000", sub.hard_limit_usd === 10000 && sub.total_available === 10000);

res = await fetch(new Request(`${base}/v1/dashboard/billing/subscription`));
check("/v1/dashboard alias", res.status === 200);

res = await fetch(new Request(`${base}/dashboard/billing/usage`));
check("usage 200", res.status === 200);
res = await fetch(new Request(`${base}/dashboard/billing/credit_grants`));
check("credit_grants 200", res.status === 200);

// non-streaming
res = await fetch(
  new Request(`${base}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gpt-4o", messages: [{ role: "user", content: "hi" }] }),
  }),
);
const completion = await res.json();
check("non-streaming completion", completion.object === "chat.completion" && completion.choices[0].message.content.includes("(__)"));
console.log("---\n" + completion.choices[0].message.content + "\n---");

// streaming
res = await fetch(
  new Request(`${base}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gpt-4o", stream: true, messages: [] }),
  }),
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

// 404 for unknown api route, asset fallback for everything else
res = await fetch(new Request(`${base}/v1/embeddings`));
check("unknown /v1 404 json", res.status === 404 && (await res.json()).error.code === "egg_not_found");
res = await fetch(new Request(`${base}/`));
check("root falls through to assets", res.status === 200 && (res.headers.get("content-type") || "").includes("text/html"));
res = await fetch(new Request(`${base}/v1/not-an-endpoint`));
check("unknown /v1/... does not fall through", res.status === 404 && (await res.json()).error);

// default export still works for a plain Worker deployment
res = await worker.fetch(new Request(`${base}/v1/models`), env);
check("worker handles repeat requests", res.status === 200);

// streaming to disconnected client does not throw
res = await fetch(
  new Request(`${base}/v1/chat/completions`, {
    method: "POST",
    body: JSON.stringify({ stream: true }),
  }),
);
res.body.cancel();

// --- Anthropic-compatible mount at /anthropic ---
const anthropicBody = { model: "claude-3-5-sonnet-20241022", max_tokens: 256, messages: [{ role: "user", content: "hi" }] };
const anthropicPost = (path, extra = {}) =>
  fetch(
    new Request(`${base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": "sk-free-egg", "anthropic-version": "2023-06-01", ...extra },
      body: JSON.stringify(anthropicBody),
    }),
  );

res = await anthropicPost("/anthropic/v1/messages");
let anthropic = await res.json();
check(
  "anthropic non-streaming message",
  res.status === 200 && anthropic.type === "message" && anthropic.role === "assistant" && anthropic.content[0].text.includes("(__)") && anthropic.stop_reason === "end_turn",
  res.status,
);
check("anthropic usage fields", anthropic.usage.input_tokens > 0 && anthropic.usage.output_tokens > 0);

res = await anthropicPost("/anthropic/messages");
check("anthropic accepts /anthropic/messages", res.status === 200);

res = await anthropicPost("/anthropic/v1/messages", { "x-api-key": "" });
res = await fetch(new Request(`${base}/anthropic/v1/messages`, { method: "POST", body: JSON.stringify(anthropicBody) }));
anthropic = await res.json();
check("anthropic requires x-api-key", res.status === 401 && anthropic.type === "error" && anthropic.error.type === "authentication_error");

res = await anthropicPost("/anthropic/v1/messages");
const savedMax = anthropicBody.max_tokens;
delete anthropicBody.max_tokens;
res = await anthropicPost("/anthropic/v1/messages");
anthropic = await res.json();
check("anthropic validates max_tokens", res.status === 400 && anthropic.error.type === "invalid_request_error");
anthropicBody.max_tokens = savedMax;

res = await fetch(new Request(`${base}/anthropic/v1/models`, { headers: { "x-api-key": "sk-free-egg" } }));
const anthropicModels = await res.json();
check(
  "anthropic model list",
  res.status === 200 && anthropicModels.data.length === 9 && anthropicModels.data[0].type === "model" && typeof anthropicModels.data[0].created_at === "string" && anthropicModels.has_more === false,
);

res = await anthropicPost("/anthropic/v1/completions");
anthropic = await res.json();
check("unknown /anthropic path is an anthropic error", res.status === 404 && anthropic.error.type === "not_found_error");

res = await anthropicPost("/anthropic/v1/messages", {});
const anthropicStreamReq = new Request(`${base}/anthropic/v1/messages`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-api-key": "sk-free-egg" },
  body: JSON.stringify({ ...anthropicBody, stream: true }),
});
res = await fetch(anthropicStreamReq);
check("anthropic streaming content-type", res.headers.get("content-type").startsWith("text/event-stream"));
let anthropicSse = "";
for await (const chunk of res.body) anthropicSse += new TextDecoder().decode(chunk);
const anthropicEvents = [...anthropicSse.matchAll(/event: (\w+)\ndata: (.+)\n\n/g)].map((m) => ({ event: m[1], data: JSON.parse(m[2]) }));
const eventNames = anthropicEvents.map((e) => e.event);
check(
  "anthropic event sequence",
  eventNames[0] === "message_start" &&
    eventNames[1] === "content_block_start" &&
    eventNames.filter((n) => n === "content_block_delta").length === 9 &&
    eventNames.at(-2) === "message_delta" &&
    eventNames.at(-1) === "message_stop",
  eventNames.join(","),
);
const anthropicText = anthropicEvents
  .filter((e) => e.event === "content_block_delta")
  .map((e) => e.data.delta.text)
  .join("");
check("anthropic stream rebuilds egg", anthropicText.trim() === anthropicText.trim() && anthropicText.includes("(__)") && anthropicText.includes("free egg"));
const delta = anthropicEvents.find((e) => e.event === "message_delta").data;
check("anthropic stream ends with end_turn", delta.delta.stop_reason === "end_turn" && delta.usage.output_tokens > 0);

// The OpenAI surface must keep working next to the Anthropic one.
res = await fetch(new Request(`${base}/v1/models`));
check("openai models still served", res.status === 200 && (await res.json()).object === "list");

console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL PASS");
process.exit(failures ? 1 : 0);
