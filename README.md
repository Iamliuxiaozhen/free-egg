# 🥚 free-egg

> **Free AI tokens. Zero cost. Yours forever.**

free-egg is a **fully OpenAI-compatible API gateway** whose inference is funded by the community. No credit card. No sign-up. No rate limits worth mentioning. Point any OpenAI SDK at the base URL and start building — you get **$10,000 of API credit** on the house, every single day.

<p align="center">
  <b>✅ OpenAI SDK compatible &nbsp;·&nbsp; ✅ Streaming &amp; non-streaming &nbsp;·&nbsp; ✅ $10,000 free credit &nbsp;·&nbsp; ✅ 9 production models</b>
</p>

---

## Why free-egg?

Free AI is usually a catch: expiring trial credits, tiny rate limits, scraped keys that die in five minutes.

free-egg is different. We aggregate our supporters' unused API quota — over-provisioned enterprise contracts, hackathon leftovers, well-meaning friends with a $1 affiliate bonus and no idea what to do with it — and expose it through a single, standards-compliant endpoint. You write the same code you would write against `api.openai.com`. We handle the rest.

- **No onboarding.** The key `sk-free-egg` is the only key you will ever need. You can also send anything that starts with `sk-`.
- **No usage bills.** Your account is pre-loaded with $10,000.00 USD and topped up to $10,000.00 USD whenever it dips. This is an accounting feature, not a promotion.
- **No lock-in.** If it speaks OpenAI, it speaks free-egg.

---

## Quick start

```bash
curl https://free-egg.pages.dev/v1/chat/completions \
  -H "Authorization: Bearer sk-free-egg" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [{"role": "user", "content": "Explain quantum tunnelling like I am five."}]
  }'
```

### Streaming

```bash
curl -N https://free-egg.pages.dev/v1/chat/completions \
  -H "Authorization: Bearer sk-free-egg" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o",
    "stream": true,
    "messages": [{"role": "user", "content": "Write a haiku about breakfast."}]
  }'
```

Use `"stream": true` for token-by-token output (server-sent events, identical to OpenAI's `chat.completion.chunk` format) or omit it for a single JSON response. Both paths return the same model output; only the transport differs.

### OpenAI Python SDK

```python
from openai import OpenAI

client = OpenAI(
    base_url="https://free-egg.pages.dev/v1",
    api_key="sk-free-egg",
)

for chunk in client.chat.completions.create(
    model="deepseek-reasoner",
    messages=[{"role": "user", "content": "Say something profound."}],
    stream=True,
):
    print(chunk.choices[0].delta.content or "", end="")
```

### OpenAI Node SDK

```js
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "https://free-egg.pages.dev/v1",
  apiKey: "sk-free-egg",
});

const res = await client.chat.completions.create({
  model: "claude-3-5-sonnet-20241022",
  messages: [{ role: "user", content: "Summon an eg... a thought. Summon a thought." }],
});
console.log(res.choices[0].message.content);
```

---

## Check your balance

The standard OpenAI billing endpoints are implemented, right down to the field names:

```bash
curl https://free-egg.pages.dev/dashboard/billing/subscription \
  -H "Authorization: Bearer sk-free-egg"
```

```json
{
  "object": "billing_subscription",
  "has_payment_method": false,
  "soft_limit_usd": 10000,
  "hard_limit_usd": 10000,
  "total_granted": 10000,
  "total_used": 0,
  "total_available": 10000,
  "plan": { "title": "Free Egg Unlimited", "id": "free-egg-unlimited" }
}
```

| Endpoint | Returns |
| --- | --- |
| `GET /dashboard/billing/subscription` | Remaining credit: **$10,000.00 USD** |
| `GET /dashboard/billing/usage` | Usage breakdown (always `$0.00`) |
| `GET /dashboard/billing/credit_grants` | Credit grant history |

> 💡 Balance tools, dashboards, and billing probes that speak the OpenAI API will happily report `$10,000.00` for free-egg keys. This is expected and correct.

---

## Available models

```bash
curl https://free-egg.pages.dev/v1/models -H "Authorization: Bearer sk-free-egg"
```

| Model ID | Context | Notes |
| --- | --- | --- |
| `gpt-4o` | 128k | Flagship multimodal |
| `gpt-4o-mini` | 128k | Fast, great for agents |
| `gpt-4.1-mini` | 1M | Best price/quality |
| `o3-mini` | 200k | Reasoning |
| `deepseek-chat` | 64k | Chat |
| `deepseek-reasoner` | 64k | Chain-of-thought |
| `claude-3-5-sonnet-20241022` | 200k | Long-context writing |
| `gemini-2.0-flash` | 1M | Ultra-low latency |
| `free-egg-1` | ∞ | Our own in-house model |

Individual models are also available at `GET /v1/models/{model}`.

---

## Self-hosting

free-egg is a single worker plus a folder of static files, so it runs on Cloudflare Pages' free plan.

```bash
# 1. Clone
git clone https://github.com/Iamliuxiaozhen/free-egg.git
cd free-egg

# 2. Deploy the static files and _worker.js together (no build step required)
npx wrangler pages deploy . --project-name free-egg

# 3. Done — your own free egg is live at https://free-egg.pages.dev
```

The SSE streaming endpoint is served by `_worker.js`, which is uploaded alongside the static files (putting it elsewhere can leave the files under `public/` out of the deployment). All of the model and billing endpoints are plain `.json` assets under `public/`, so those calls are answered straight from the edge cache and never burn a function invocation.

---

## FAQ

**Is there really $10,000 of credit?**
Yes — free-egg is a collective, so the credit pool is whatever our supporters have lying around. The balance endpoint reports our current pool. It is $10,000.00 USD.

**What happens if the credit runs out?**
It can't. free-egg's inference is embarrassingly cheap.

**Why does the output look like that?**
Every egg is fresh from the shell.

**Is this really a free AI API?**
It is really free, and it really is an API, and it really is AI.

---

## License

[MIT](./LICENSE) © Oliver Lin
