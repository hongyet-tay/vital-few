/**
 * POST /api/suggest
 *
 * The only server code in Vital Few. It receives a mission and its item list
 * from the app, asks Claude for missing high-leverage items, and returns them.
 *
 * Your Anthropic API key lives in the ANTHROPIC_API_KEY secret. It never
 * reaches the phone.
 *
 * Protections:
 *   1. One job only: the prompt is built here; callers can't send free text to Claude.
 *   2. Small, capped requests: input trimmed, short output, cheapest model.
 *   3. Daily limits per device and per IP address.
 *   4. A daily budget: stops all AI calls for the day after DAILY_GLOBAL_LIMIT requests.
 *   5. Optional origin check: only your own site may call it (ALLOWED_ORIGIN).
 *
 * Settings (Cloudflare dashboard → your Pages project → Settings → Variables and secrets):
 *   ANTHROPIC_API_KEY       required, secret
 *   ALLOWED_ORIGIN          optional, e.g. https://vital-few.pages.dev
 *   DAILY_LIMIT_PER_DEVICE  optional, default 5
 *   DAILY_LIMIT_PER_IP      optional, default 20
 *   DAILY_GLOBAL_LIMIT      optional, default 500
 *   MODEL                   optional, default claude-haiku-4-5-20251001
 * Binding (Settings → Bindings → KV namespace): RATE_LIMIT
 *   Needed for limits 3 and 4. Without it the function still works, unlimited.
 */

const TYPES = ["task", "question", "issue"];

const SYSTEM_PROMPT = `You help people apply the 80/20 (Pareto) principle to a mission.
Given a mission and the items already listed, suggest up to 6 important items they are missing.
Favor high-leverage items: tasks that unblock others, open questions whose answer would change the plan, and risks that could sink the mission.
Do not repeat or rephrase existing items. Keep each item under 12 words, written as a plain action, question, or issue.
Reply with JSON only, no other text: {"items":[{"text":"...","type":"task|question|issue"}]}`;

export async function onRequestPost({ request, env }) {
  if (!env.ANTHROPIC_API_KEY) return json({ error: "AI suggestions aren't set up on this server." }, 501);

  // 5. Origin check
  const origin = request.headers.get("Origin") || "";
  if (env.ALLOWED_ORIGIN && origin !== env.ALLOWED_ORIGIN) return json({ error: "Not allowed." }, 403);

  // 1 + 2. Validate and trim input
  let body;
  try { body = await request.json(); } catch { return json({ error: "Invalid request." }, 400); }
  const title = clean(body?.mission?.title, 140);
  const finish = clean(body?.mission?.finish, 140);
  const deviceId = clean(body?.deviceId, 64).replace(/[^a-zA-Z0-9-]/g, "");
  if (!title) return json({ error: "Add a mission first." }, 400);
  if (!deviceId) return json({ error: "Invalid request." }, 400);
  const items = (Array.isArray(body.items) ? body.items : [])
    .slice(-60)
    .map((i) => ({ text: clean(i?.text, 160), type: TYPES.includes(i?.type) ? i.type : "task" }))
    .filter((i) => i.text);

  // 3 + 4. Daily limits
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const limit = await checkLimits(env, deviceId, ip);
  if (!limit.ok) return json({ error: limit.message }, 429);

  // Ask Claude
  const userMsg =
    `Mission: ${title}\n` +
    (finish ? `Done when: ${finish}\n` : "") +
    `Items already listed:\n` +
    (items.length ? items.map((i) => `- (${i.type}) ${i.text}`).join("\n") : "(none yet)");

  let res;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: env.MODEL || "claude-haiku-4-5-20251001",
        max_tokens: 400,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMsg }],
      }),
    });
  } catch {
    return json({ error: "Couldn't reach the AI service." }, 502);
  }
  if (!res.ok) {
    console.log("Anthropic error", res.status, await res.text().catch(() => ""));
    return json({ error: "The AI service is busy. Try again in a moment." }, 502);
  }

  const data = await res.json();
  const text = (data.content || []).map((c) => (c.type === "text" ? c.text : "")).join("");
  const suggestions = parseItems(text);
  await limit.commit(); // only count calls that succeeded
  return json({ items: suggestions, remaining: limit.remaining });
}

export function onRequest() {
  return json({ error: "Use POST." }, 405);
}

/* ---------- helpers ---------- */

function clean(v, max) {
  return typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function parseItems(text) {
  const match = text.replace(/```json|```/g, "").match(/\{[\s\S]*\}/);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[0]);
    return (Array.isArray(parsed.items) ? parsed.items : [])
      .map((i) => ({ text: clean(i?.text, 160), type: TYPES.includes(i?.type) ? i.type : "task" }))
      .filter((i) => i.text)
      .slice(0, 6);
  } catch {
    return [];
  }
}

async function checkLimits(env, deviceId, ip) {
  const kv = env.RATE_LIMIT;
  if (!kv) return { ok: true, remaining: null, commit: async () => {} };

  const day = new Date().toISOString().slice(0, 10); // resets at 00:00 UTC
  const perDevice = int(env.DAILY_LIMIT_PER_DEVICE, 5);
  const perIp = int(env.DAILY_LIMIT_PER_IP, 20);
  const global = int(env.DAILY_GLOBAL_LIMIT, 500);
  const keys = { d: `d:${day}:${deviceId}`, i: `i:${day}:${ip}`, g: `g:${day}` };

  const [d, i, g] = await Promise.all([kv.get(keys.d), kv.get(keys.i), kv.get(keys.g)]).then((v) => v.map((x) => int(x, 0)));

  if (g >= global) return { ok: false, message: "AI suggestions are paused for today. The rest of the app works as normal." };
  if (d >= perDevice) return { ok: false, message: `You've used today's ${perDevice} free suggestions. They reset tomorrow.` };
  if (i >= perIp) return { ok: false, message: "Too many suggestions from this network today. Try again tomorrow." };

  const ttl = { expirationTtl: 60 * 60 * 48 };
  return {
    ok: true,
    remaining: perDevice - d - 1,
    commit: () => Promise.all([kv.put(keys.d, String(d + 1), ttl), kv.put(keys.i, String(i + 1), ttl), kv.put(keys.g, String(g + 1), ttl)]),
  };
}

function int(v, fallback) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
