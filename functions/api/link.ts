
import { verifyToken } from './auth-utils';

interface Env {
  CLOUDNAV_KV: any;
  PASSWORD: string;
  // 独立高熵 token 签名密钥（生产建议配置 Secret）；缺省时回退 PASSWORD（兼容旧部署）
  AUTH_SECRET?: string;
}

// 动态 CORS：同源或浏览器扩展允许；敏感响应禁止缓存
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
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-auth-password, x-auth-issued-at',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
    'Cache-Control': 'no-store',
  };
};

const validateAuth = async (request: Request, env: Env) => {
  const corsHeaders = getCorsHeaders(request);
  // 与 storage 保持一致：KV 中修改过的密码优先，环境变量兜底
  const serverPassword = (await env.CLOUDNAV_KV.get('password')) || env.PASSWORD;
  if (!serverPassword) {
    return new Response(JSON.stringify({ error: 'Server misconfigured: PASSWORD not set' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  const websiteConfigRaw = await env.CLOUDNAV_KV.get('website_config');
  const websiteConfig = websiteConfigRaw ? JSON.parse(websiteConfigRaw) : { passwordExpiryDays: 7 };
  const passwordExpiryDays = websiteConfig.passwordExpiryDays ?? 7;
  // 0 = 永久有效；否则为过期毫秒数，同时约束 token 有效期与会话头
  const expiryMs = passwordExpiryDays > 0 ? passwordExpiryDays * 24 * 60 * 60 * 1000 : 0;

  const providedPassword = request.headers.get('x-auth-password');
  // 凭据必须为 HMAC token（AUTH_SECRET 签名，服务端校验过期与会话代次）；明文密码一律拒绝
  const tokenSecret = env.AUTH_SECRET || serverPassword;
  const authEpoch = Number((await env.CLOUDNAV_KV.get('auth_epoch')) || 0);
  const tokenValid = providedPassword ? await verifyToken(tokenSecret, providedPassword, expiryMs, authEpoch) : false;
  if (!tokenValid) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  if (passwordExpiryDays > 0) {
    const authIssuedAtRaw = request.headers.get('x-auth-issued-at');
    const authIssuedAt = authIssuedAtRaw ? Number(authIssuedAtRaw) : NaN;

    if (Number.isFinite(authIssuedAt) && authIssuedAt > 0 && Date.now() - authIssuedAt > expiryMs) {
      return new Response(JSON.stringify({ error: '密码已过期，请重新输入' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
  }

  return null;
};

// 流式读取请求体并限制大小（不依赖 Content-Length）；超过限制返回 null
const readBodyLimited = async (request: Request, maxBytes: number): Promise<string | null> => {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder().decode(merged);
};

export const onRequestOptions = async (context: { request: Request }) => {
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(context.request),
  });
};

// ===== 扩展保存 =====
// 采用「扩展收件箱」：不读取、不写入 app_data（避免与网页端并发写互相覆盖），
// 每条链接写入独立 KV key extension_inbox:<uuid>（30 天 TTL），由网页端合并后 ACK。
export const onRequestPost = async (context: { request: Request; env: Env }) => {
  const { request, env } = context;
  const corsHeaders = getCorsHeaders(request);

  try {
    // 1. 鉴权：HMAC token（含 epoch/过期校验）
    const authError = await validateAuth(request, env);
    if (authError) {
      return authError;
    }

    // 2. 请求体流式限制 32KB（解析前，不依赖 Content-Length）
    const MAX_BODY_BYTES = 32 * 1024;
    const rawBody = await readBodyLimited(request, MAX_BODY_BYTES);
    if (rawBody === null) {
      return new Response(JSON.stringify({ error: '请求体过大（上限 32KB）' }), {
        status: 413,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
    let data: any;
    try {
      data = JSON.parse(rawBody);
    } catch {
      return new Response(JSON.stringify({ error: '请求体不是有效 JSON' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    // 3. 字段校验：title / http(s) URL / 可选 categoryId / 长度限制
    const title = typeof data.title === 'string' ? data.title.trim() : '';
    const url = typeof data.url === 'string' ? data.url.trim() : '';
    if (!title || title.length > 200) {
      return new Response(JSON.stringify({ error: '标题必填且不超过 200 字符' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
    if (url.length > 2048 || !/^https?:\/\//i.test(url)) {
      return new Response(JSON.stringify({ error: 'URL 无效（仅支持 http/https，不超过 2048 字符）' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
    const categoryId = data.categoryId && typeof data.categoryId === 'string'
      ? data.categoryId.slice(0, 100)
      : undefined;

    // 4. 写入收件箱（独立 KV key，不触碰 app_data）
    const id = crypto.randomUUID();
    const entry = {
      id,
      title,
      url,
      ...(categoryId ? { categoryId } : {}),
      createdAt: Date.now(),
    };
    try {
      await env.CLOUDNAV_KV.put(`extension_inbox:${id}`, JSON.stringify(entry), {
        expirationTtl: 30 * 24 * 60 * 60, // 30 天
      });
    } catch {
      // KV 写入失败：不得假报成功
      return new Response(JSON.stringify({ error: '提交失败，请稍后重试' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    return new Response(JSON.stringify({
      queued: true,
      id,
      message: '已提交，打开导航页面后自动同步',
    }), {
      status: 202,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err?.message || '提交失败' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }
};
