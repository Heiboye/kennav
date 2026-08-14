
import { verifyToken } from './auth-utils';

interface Env {
  CLOUDNAV_KV: any;
  PASSWORD: string;
  // 独立高熵 token 签名密钥（生产建议配置 Secret）；缺省时回退 PASSWORD（兼容旧部署）
  AUTH_SECRET?: string;
}

interface WebsiteConfig {
  passwordExpiryDays?: number;
}

const AUTH_TIME_HEADER = 'x-auth-issued-at';

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
    'Access-Control-Allow-Headers': `Content-Type, x-auth-password, ${AUTH_TIME_HEADER}`,
    // 动态 CORS 需要 Vary: Origin 避免缓存串源；敏感数据一律禁止缓存
    'Vary': 'Origin',
    'Cache-Control': 'no-store',
  };
};

const getWebsiteConfig = async (env: Env): Promise<WebsiteConfig> => {
  const rawConfig = await env.CLOUDNAV_KV.get('website_config');
  return rawConfig ? JSON.parse(rawConfig) : { passwordExpiryDays: 7 };
};

const buildJsonResponse = (body: unknown, status: number, corsHeaders: Record<string, string>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });

const buildWebDavErrorMessage = (status: number) => {
  if (status === 520) {
    return 'Cloudflare 代理访问坚果云返回 520';
  }
  if (status === 401) {
    return 'WebDAV 用户名或应用密码不正确';
  }
  if (status === 403) {
    return 'WebDAV 服务器拒绝访问';
  }
  if (status === 404) {
    return '备份文件不存在';
  }
  return `WebDAV 返回异常状态 ${status}`;
};

const validateAuth = async (request: Request, env: Env, corsHeaders: Record<string, string>) => {
  // 与 storage 保持一致：KV 中修改过的密码优先，环境变量兜底（改密码后新 token 同样有效）
  const serverPassword = (await env.CLOUDNAV_KV.get('password')) || env.PASSWORD;
  if (!serverPassword) {
    return buildJsonResponse({ error: 'Server misconfigured: PASSWORD not set' }, 500, corsHeaders);
  }

  const websiteConfig = await getWebsiteConfig(env);
  const passwordExpiryDays = websiteConfig.passwordExpiryDays ?? 7;
  // 0 = 永久有效；否则为过期毫秒数，同时约束 token 有效期与会话头
  const expiryMs = passwordExpiryDays > 0 ? passwordExpiryDays * 24 * 60 * 60 * 1000 : 0;

  const providedPassword = request.headers.get('x-auth-password');
  // 凭据必须为 HMAC token（AUTH_SECRET 签名，服务端校验过期与会话代次）；明文密码一律拒绝
  const tokenSecret = env.AUTH_SECRET || serverPassword;
  const authEpoch = Number((await env.CLOUDNAV_KV.get('auth_epoch')) || 0);
  const tokenValid = providedPassword ? await verifyToken(tokenSecret, providedPassword, expiryMs, authEpoch) : false;
  if (!tokenValid) {
    return buildJsonResponse({ error: 'Unauthorized' }, 401, corsHeaders);
  }

  if (passwordExpiryDays > 0) {
    const authIssuedAtRaw = request.headers.get(AUTH_TIME_HEADER);
    const authIssuedAt = authIssuedAtRaw ? Number(authIssuedAtRaw) : NaN;

    if (Number.isFinite(authIssuedAt) && authIssuedAt > 0 && Date.now() - authIssuedAt > expiryMs) {
      return buildJsonResponse({ error: '密码已过期，请重新输入' }, 401, corsHeaders);
    }
  }

  return null;
};

export const onRequestOptions = async (context: { request: Request }) =>
  new Response(null, {
    status: 204,
    headers: getCorsHeaders(context.request),
  });

export const onRequestPost = async (context: { request: Request; env: Env }) => {
  const { request, env } = context;
  const corsHeaders = getCorsHeaders(request);
  
  try {
    const authError = await validateAuth(request, env, corsHeaders);
    if (authError) {
      return authError;
    }

    const body = await request.json() as any;
    const { operation, config, payload, filename } = body;
    
    if (!config || !config.url || !config.username || !config.password) {
        return buildJsonResponse({ error: 'Missing configuration' }, 400, corsHeaders);
    }

    // URL 校验：必须为合法 HTTPS 地址（防止把 WebDAV 凭据发往错误/恶意域名）
    let baseUrl: URL;
    try {
        baseUrl = new URL(config.url.trim());
    } catch {
        return buildJsonResponse({ error: 'WebDAV 地址格式错误' }, 400, corsHeaders);
    }
    if (baseUrl.protocol !== 'https:') {
        return buildJsonResponse({ error: 'WebDAV 地址必须使用 HTTPS' }, 400, corsHeaders);
    }
    // 清除 URL 内嵌的用户名/密码/query/hash，避免凭据泄露与请求边界异常
    baseUrl.username = '';
    baseUrl.password = '';
    baseUrl.search = '';
    baseUrl.hash = '';
    const baseStr = baseUrl.href.endsWith('/') ? baseUrl.href : baseUrl.href + '/';

    // filename 消毒：仅保留文件名安全字符，防止路径穿越（../、/ 等），并限制长度
    const rawFilename = String(filename || 'cloudnav_backup.json').slice(0, 100);
    const safeFilename = rawFilename.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '');
    const fileUrl = baseStr + safeFilename;

    const authHeader = `Basic ${btoa(`${config.username}:${config.password}`)}`;
    
    let fetchUrl = baseUrl.href;
    let method = 'PROPFIND';
    let headers: Record<string, string> = {
        'Authorization': authHeader,
        'User-Agent': 'CloudNav/1.0'
    };
    let requestBody = undefined;

    if (operation === 'check') {
        fetchUrl = baseUrl.href;
        method = 'PROPFIND';
        headers['Depth'] = '0';
    } else if (operation === 'upload') {
        fetchUrl = fileUrl;
        method = 'PUT';
        headers['Content-Type'] = 'application/json';
        requestBody = JSON.stringify(payload); 
    } else if (operation === 'download') {
        fetchUrl = fileUrl;
        method = 'GET';
    } else {
        return buildJsonResponse({ error: 'Invalid operation' }, 400, corsHeaders);
    }

    // 15s 超时（AbortController），避免外部 WebDAV 挂起拖死 Worker
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    let response: Response;
    try {
        response = await fetch(fetchUrl, {
            method,
            headers,
            body: requestBody,
            signal: controller.signal
        });
    } catch (err: any) {
        clearTimeout(timer);
        return buildJsonResponse({ error: err.name === 'AbortError' ? '连接 WebDAV 超时' : '连接 WebDAV 失败' }, 502, corsHeaders);
    }

    if (operation === 'download') {
        if (!response.ok) {
            clearTimeout(timer);
            return buildJsonResponse({
               success: false,
               status: response.status,
               error: buildWebDavErrorMessage(response.status),
             }, 200, corsHeaders);
        }
        // 下载大小限制：流式读取，无 Content-Length 时累计超限立即取消，避免大文件整体载入内存
        const MAX_DOWNLOAD_BYTES = 5 * 1024 * 1024;
        const contentLength = Number(response.headers.get('content-length') || 0);
        if (contentLength > MAX_DOWNLOAD_BYTES) {
            clearTimeout(timer);
            return buildJsonResponse({ success: false, error: '备份文件过大，无法恢复' }, 200, corsHeaders);
        }
        if (!response.body) {
            clearTimeout(timer);
            return buildJsonResponse({ success: false, error: '下载失败：响应为空' }, 200, corsHeaders);
        }
        // 超时定时器保持到读取完成：慢速/无限响应也会在限定时间内被中止
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let total = 0;
        let readError: string | null = null;
        try {
            for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                total += value.byteLength;
                if (total > MAX_DOWNLOAD_BYTES) {
                    await reader.cancel().catch(() => {});
                    clearTimeout(timer);
                    return buildJsonResponse({ success: false, error: '备份文件过大，无法恢复' }, 200, corsHeaders);
                }
                chunks.push(value);
            }
        } catch (err: any) {
            readError = err.name === 'AbortError' ? '连接 WebDAV 超时' : '下载中断';
        } finally {
            clearTimeout(timer);
        }
        if (readError) {
            return buildJsonResponse({ success: false, error: readError }, 502, corsHeaders);
        }
        const merged = new Uint8Array(total);
        let offset = 0;
        for (const c of chunks) {
            merged.set(c, offset);
            offset += c.byteLength;
        }
        try {
            const data = JSON.parse(new TextDecoder().decode(merged));
            return buildJsonResponse(data, 200, corsHeaders);
        } catch {
            return buildJsonResponse({ success: false, error: '备份文件不是有效的 JSON' }, 200, corsHeaders);
        }
    }

    const success = response.ok || response.status === 207;
    clearTimeout(timer); // 非下载操作：读取完成（无响应体消费）即清理超时
    return buildJsonResponse({
      success,
      status: response.status,
      ...(success ? {} : { error: buildWebDavErrorMessage(response.status) }),
    }, 200, corsHeaders);

  } catch (err: any) {
    return buildJsonResponse({ error: err.message }, 500, corsHeaders);
  }
};
