// 健康检查：验证 KV 可用性与关键生产配置是否就绪
// GET /api/health → { kvConnected, passwordConfigured, authSecretConfigured }
// 任一生产配置缺失时返回 503；不返回任何 Secret / KV ID / 配置内容
interface Env {
  CLOUDNAV_KV: any;
  PASSWORD: string;
  AUTH_SECRET?: string;
}

const getCorsHeaders = (request: Request) => {
  const requestUrl = new URL(request.url);
  const origin = request.headers.get('Origin');
  const allowOrigin = origin && origin === requestUrl.origin ? origin : requestUrl.origin;
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
    'Cache-Control': 'no-store',
  };
};

export const onRequestOptions = async (context: { request: Request }) =>
  new Response(null, { status: 204, headers: getCorsHeaders(context.request) });

export const onRequestGet = async (context: { request: Request; env: Env }) => {
  const { env, request } = context;
  const corsHeaders = getCorsHeaders(request);

  // 1. KV 连通性：随机 key 完成 put/get/delete
  let kvConnected = false;
  try {
    const probeKey = `health_probe_${crypto.randomUUID()}`;
    await env.CLOUDNAV_KV.put(probeKey, '1', { expirationTtl: 60 });
    const val = await env.CLOUDNAV_KV.get(probeKey);
    kvConnected = val === '1';
    await env.CLOUDNAV_KV.delete(probeKey);
  } catch {
    kvConnected = false;
  }

  // 2. 生产配置：PASSWORD / AUTH_SECRET 是否存在（仅布尔，不返回内容）
  const passwordConfigured = !!env.PASSWORD || !!((await env.CLOUDNAV_KV.get('password'))?.length);
  const authSecretConfigured = !!env.AUTH_SECRET;

  const ready = kvConnected && passwordConfigured && authSecretConfigured;
  const body = JSON.stringify({ kvConnected, passwordConfigured, authSecretConfigured });

  return new Response(body, {
    status: ready ? 200 : 503,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
};
