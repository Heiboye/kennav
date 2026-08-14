// 扩展收件箱管理接口：仅管理员（有效 HMAC token）可访问
// GET  /api/extension-inbox        → 列出待处理记录（KV.list，最多 100 条）
// POST /api/extension-inbox       → action=ack，删除已成功并入主数据的 ID（≤100，严格 UUID）
import { verifyToken } from './auth-utils';

interface Env {
  CLOUDNAV_KV: any;
  PASSWORD: string;
  AUTH_SECRET?: string;
}

const getCorsHeaders = (request: Request) => {
  const requestUrl = new URL(request.url);
  const origin = request.headers.get('Origin');
  const allowOrigin = origin && (
    origin === requestUrl.origin ||
    origin.startsWith('chrome-extension://') ||
    origin.startsWith('moz-extension://')
  ) ? origin : requestUrl.origin;
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-auth-password, x-auth-issued-at',
    'Vary': 'Origin',
    'Cache-Control': 'no-store',
  };
};

const buildJson = (body: unknown, status: number, corsHeaders: Record<string, string>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });

const validateAdminAuth = async (request: Request, env: Env): Promise<{ ok: true } | { ok: false; response: Response }> => {
  const corsHeaders = getCorsHeaders(request);
  const serverPassword = (await env.CLOUDNAV_KV.get('password')) || env.PASSWORD;
  if (!serverPassword) {
    return { ok: false, response: buildJson({ error: 'Server misconfigured: PASSWORD not set' }, 500, corsHeaders) };
  }
  const providedPassword = request.headers.get('x-auth-password');
  const tokenSecret = env.AUTH_SECRET || serverPassword;
  const authEpoch = Number((await env.CLOUDNAV_KV.get('auth_epoch')) || 0);
  // 收件箱接口仅接受 token（明文密码一律拒绝）
  const tokenValid = providedPassword ? await verifyToken(tokenSecret, providedPassword, 0, authEpoch) : false;
  if (!tokenValid) {
    return { ok: false, response: buildJson({ error: 'Unauthorized' }, 401, corsHeaders) };
  }
  return { ok: true };
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const onRequestOptions = async (context: { request: Request }) =>
  new Response(null, { status: 204, headers: getCorsHeaders(context.request) });

export const onRequestGet = async (context: { request: Request; env: Env }) => {
  const { request, env } = context;
  const corsHeaders = getCorsHeaders(request);
  const auth = await validateAdminAuth(request, env);
  if (!auth.ok) return auth.response;

  try {
    const list = await env.CLOUDNAV_KV.list({ prefix: 'extension_inbox:', limit: 100 });
    const entries = [];
    for (const key of list.keys) {
      const raw = await env.CLOUDNAV_KV.get(key.name);
      if (!raw) continue;
      try {
        entries.push(JSON.parse(raw));
      } catch {
        // 损坏的收件箱条目忽略
      }
    }
    return buildJson({ queued: entries.length, entries }, 200, corsHeaders);
  } catch {
    return buildJson({ error: '读取收件箱失败' }, 503, corsHeaders);
  }
};

export const onRequestPost = async (context: { request: Request; env: Env }) => {
  const { request, env } = context;
  const corsHeaders = getCorsHeaders(request);
  const auth = await validateAdminAuth(request, env);
  if (!auth.ok) return auth.response;

  try {
    const body: any = await request.json().catch(() => null);
    if (!body || body.action !== 'ack' || !Array.isArray(body.ids)) {
      return buildJson({ error: '参数错误：需要 action=ack 与 ids 数组' }, 400, corsHeaders);
    }
    if (body.ids.length > 100) {
      return buildJson({ error: '一次最多确认 100 个 ID' }, 400, corsHeaders);
    }
    let acked = 0;
    for (const id of body.ids) {
      if (typeof id !== 'string' || !UUID_RE.test(id)) continue; // 严格 UUID，非法 ID 跳过
      try {
        await env.CLOUDNAV_KV.delete(`extension_inbox:${id}`);
        acked += 1;
      } catch {
        // 删除失败忽略（保留待重试）
      }
    }
    return buildJson({ success: true, acked }, 200, corsHeaders);
  } catch {
    return buildJson({ error: '处理失败' }, 500, corsHeaders);
  }
};
