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

// Anthropic requires a client-supplied x-api-key; any non-empty value is accepted.
// x-api-key must be present even when Authorization is sent instead.
function anthropicAuthorized(request) {
  return Boolean(request.headers.get('x-api-key') || request.headers.get('authorization'));
}

// Anthropic error envelope: {type: "error", error: {type, message}}.
function anthropicError(status, type, message) {
  return json({ type: 'error', error: { type, message } }, status);
}

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

function isAnthropicRoute(route) {
  return route === '/anthropic' || route.startsWith('/anthropic/');
}

function anthropicRoute(route) {
  return route.slice('/anthropic'.length);
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

// Anthropic Messages API (POST /anthropic/v1/messages). Streams the egg as
// `message_start` / `content_block_delta` / `message_stop` events when `stream: true`.
async function handleAnthropicMessages(request) {
  if (!anthropicAuthorized(request)) {
    return anthropicError(401, 'authentication_error', 'x-api-key header is required');
  }

  let body = {};
  try {
    body = await request.json();
  } catch {
    return anthropicError(400, 'invalid_request_error', 'Request body must be valid JSON.');
  }

  if (body.max_tokens === undefined || !Array.isArray(body.messages)) {
    return anthropicError(400, 'invalid_request_error', 'messages and max_tokens are required.');
  }

  const model = body.model || 'free-egg-1';
  const id = `msg_egg_${Math.random().toString(36).slice(2, 12)}`;
  const lines = EGG_ART.split('\n');
  const inputTokens = lines.length;
  const outputTokens = lines.length;
  const usage = (out) => ({ input_tokens: inputTokens, output_tokens: out });
  const full = {
    id,
    type: 'message',
    role: 'assistant',
    model,
    content: [{ type: 'text', text: EGG_ART }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: usage(outputTokens),
  };

  if (body.stream !== true) {
    return json(full);
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (type, data) => controller.enqueue(encoder.encode(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`));

      try {
        send('message_start', { type: 'message_start', message: { ...full, content: [], usage: usage(0) } });
        send('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
        send('ping', { type: 'ping' });
        for (const [i, line] of lines.entries()) {
          await new Promise((resolve) => setTimeout(resolve, STREAM_CHUNK_DELAY_MS));
          send('content_block_delta', {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: i === lines.length - 1 ? line : line + '\n' },
          });
        }
        send('content_block_stop', { type: 'content_block_stop', index: 0 });
        send('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: usage(outputTokens) });
        send('message_stop', { type: 'message_stop' });
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
  const method = request.method;

  // Anthropic-compatible surface, mounted at /anthropic (with or without /v1).
  const route = normalizeRoute(url.pathname);
  if (isAnthropicRoute(route)) {
    const anthropicPath = anthropicRoute(route);

    if (anthropicPath === '/v1/messages' && method === 'POST') {
      return handleAnthropicMessages(request);
    }

    // Anthropic clients probe this pair on startup to size-configure the connection.
    if (anthropicPath === '/v1/models' && (method === 'GET' || method === 'HEAD')) {
      const list = await serveStaticJson(env, request, 'v1/models.json');
      if (!list.ok) return anthropicError(500, 'api_error', 'Model list is unavailable.');
      const { data } = await list.json();
      return json({
        data: data.map(({ id, created }) => ({ type: 'model', id, display_name: id, created_at: new Date(created * 1000).toISOString() })),
        has_more: false,
        first_id: data[0] ? data[0].id : null,
        last_id: data.length ? data[data.length - 1].id : null,
      });
    }

    return anthropicError(404, 'not_found_error', `Egg not found: '${url.pathname}' has no shell to hatch from.`);
  }

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
