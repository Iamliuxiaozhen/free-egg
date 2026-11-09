/**
 * free-egg — Cloudflare Pages advanced mode
 *
 * This file sits at the root of the build output directory (public/), which is the
 * only place Pages looks for `_worker.js`. Streamed (SSE) and non-streamed egg
 * responses are produced here; model and billing routes are resolved to the static
 * .json files next to this file and served through the ASSETS binding.
 */

// Paths that map to a pre-built static JSON file in this directory.
const STATIC_JSON = {
  '/v1/models': 'v1/models.json',
  '/dashboard/billing/subscription': 'dashboard/billing/subscription.json',
  '/dashboard/billing/usage': 'dashboard/billing/usage.json',
  '/dashboard/billing/credit_grants': 'dashboard/billing/credit_grants.json',
};

const EGG_ART = [
  '          .-""""-.',
  "        .'        '.",
  '       /    o  o    \\',
  '      ;              ;',
  '      :     (__)     :',
  '       \\            /',
  '        \\          /',
  "         '------ '",
  '   ~ free egg ~',
].join('\n');

const STREAM_CHUNK_DELAY_MS = 80;

// Pages advanced-mode entry point. The file lives in the build output directory
// (public/) because that is where Pages looks for `_worker.js`.
export default {
  fetch: (request, env) => handle(request, env),
};

function normalizeRoute(pathname) {
  let route = pathname.replace(/\/+$/, '') || '/';
  if (route.startsWith('/v1/v1/')) route = route.slice(3);
  // Billing endpoints are documented under /v1 too; the real ones live at /dashboard.
  if (route.startsWith('/v1/dashboard/')) route = route.slice(3);
  return route;
}

function json(data, status) {
  return Response.json(data, {
    status: status || 200,
    headers: { 'Cache-Control': 'no-store' },
  });
}

function notFound(route) {
  return json(
    {
      error: {
        message: `Egg not found: '${route}' has no shell to hatch from.`,
        type: 'invalid_request_error',
        param: null,
        code: 'egg_not_found',
      },
    },
    404,
  );
}

// Relative URLs resolve against the request origin, which is what `env.ASSETS` expects.
async function serveStaticJson(env, request, file) {
  // The ASSETS binding needs an absolute URL; a bare path throws.
  return env.ASSETS.fetch(new URL(`/${file}`, request.url));
}

async function handleChatCompletions(request) {
  let body = {};
  if (request.method === 'POST') {
    try {
      body = await request.json();
    } catch {
      body = {};
    }
  }

  const model = body.model || 'free-egg-1';
  const created = Math.floor(Date.now() / 1000);
  const id = `chatcmpl-egg-${created.toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  const lines = EGG_ART.split('\n');

  if (body.stream !== true) {
    return json({
      id,
      object: 'chat.completion',
      created,
      model,
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: EGG_ART },
          logprobs: null,
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: lines.length,
        completion_tokens: lines.length,
        total_tokens: lines.length * 2,
      },
    });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (chunk) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
      const chunkOf = (delta, finishReason) => ({
        id,
        object: 'chat.completion.chunk',
        created,
        model,
        system_fingerprint: 'fp_free_egg',
        choices: [{ index: 0, delta, logprobs: null, finish_reason: finishReason || null }],
      });

      try {
        send(chunkOf({ role: 'assistant', content: '' }));
        for (const [i, line] of lines.entries()) {
          await new Promise((resolve) => setTimeout(resolve, STREAM_CHUNK_DELAY_MS));
          send(chunkOf({ content: i === lines.length - 1 ? line : line + '\n' }));
        }
        send(chunkOf({}, 'stop'));
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      } catch {
        // Client went away mid-stream; nothing else to flush.
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

// Every request enters here: API routes are answered from code, everything else is
// handed to the static asset binding.
async function handle(request, env) {
  const url = new URL(request.url);
  const route = normalizeRoute(url.pathname);
  const method = request.method;

  if (method === 'GET' || method === 'HEAD') {
    if (STATIC_JSON[route]) {
      return serveStaticJson(env, request, STATIC_JSON[route]);
    }

    const modelPath = route.match(/^\/v1\/models\/(.+)$/);
    if (modelPath) {
      const id = decodeURIComponent(modelPath[1]);
      const asset = await serveStaticJson(env, request, 'v1/models.json');
      if (!asset.ok) return notFound(route);
      const list = await asset.json();
      const model = list.data.find((item) => item.id === id);
      return model ? json(model) : notFound(route);
    }
  }

  if (route === '/v1/chat/completions' && method === 'POST') {
    return handleChatCompletions(request);
  }

  if (route === '/v1/chat/completions' || route.startsWith('/v1/')) {
    return notFound(route);
  }

  return env.ASSETS.fetch(request);
}
