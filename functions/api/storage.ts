import { issueAuthToken, verifyToken } from './auth-utils';

interface Env {
  CLOUDNAV_KV: any;
  PASSWORD: string;
  // 独立高熵 token 签名密钥（生产建议配置 Secret）；缺省时回退 PASSWORD（兼容旧部署）
  AUTH_SECRET?: string;
}

interface WebsiteConfig {
  title?: string;
  navTitle?: string;
  favicon?: string;
  cardStyle?: 'detailed' | 'simple';
  requirePasswordOnVisit?: boolean;
  passwordExpiryDays?: number;
}

const AUTH_TIME_HEADER = 'x-auth-issued-at';

// ===== 登录/分类密码失败限流（暴力破解防护）=====
// 按客户端 IP 计数，10 分钟窗口内连续失败达阈值返回 429，成功登录清零
const FAIL_WINDOW_MS = 10 * 60 * 1000;
const MAX_FAILS = 5;

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

const getClientIp = (request: Request) => request.headers.get('CF-Connecting-IP') || 'unknown';

const recordAuthFail = async (env: Env, key: string): Promise<boolean> => {
  let rec: { count: number; firstFailAt: number } = { count: 0, firstFailAt: Date.now() };
  try {
    const raw = await env.CLOUDNAV_KV.get(key);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.count === 'number' && typeof parsed.firstFailAt === 'number') {
        rec = parsed;
      }
    }
  } catch {
    // KV 中计数数据损坏时从零开始，不导致 500
  }
  if (Date.now() - rec.firstFailAt > FAIL_WINDOW_MS) {
    rec.count = 1;
    rec.firstFailAt = Date.now();
  } else {
    rec.count += 1;
  }
  try {
    await env.CLOUDNAV_KV.put(key, JSON.stringify(rec), { expirationTtl: 900 });
  } catch {
    // 计数写入失败（KV 频率限制等）：采取拒绝策略（fail-closed），不允许退化为无限尝试
    return true;
  }
  return rec.count >= MAX_FAILS;
};

const clearAuthFail = async (env: Env, key: string) => {
  try {
    await env.CLOUDNAV_KV.delete(key);
  } catch {
    // 清除失败不影响主流程（计数残留会在窗口过期后自然失效）
  }
};

// 锁定检查：窗口内失败次数已达阈值（供验证前先拦截，锁定期间连正确密码也不放行，彻底阻断爆破）
const isAuthLocked = async (env: Env, key: string): Promise<boolean> => {
  const raw = await env.CLOUDNAV_KV.get(key);
  if (!raw) return false;
  try {
    const rec = JSON.parse(raw);
    return rec.count >= MAX_FAILS && Date.now() - rec.firstFailAt <= FAIL_WINDOW_MS;
  } catch {
    return false;
  }
};

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
    'Access-Control-Allow-Headers': `Content-Type, x-auth-password, ${AUTH_TIME_HEADER}, x-category-password`,
    // 动态 CORS 需要 Vary: Origin 避免缓存串源；敏感数据一律禁止缓存
    'Vary': 'Origin',
    'Cache-Control': 'no-store',
  };
};

const getWebsiteConfig = async (env: Env): Promise<WebsiteConfig> => {
  const websiteConfigStr = await env.CLOUDNAV_KV.get('website_config');
  return websiteConfigStr
    ? JSON.parse(websiteConfigStr)
    : { requirePasswordOnVisit: false, passwordExpiryDays: 7 };
};

const buildUnauthorizedResponse = (message: string, corsHeaders: Record<string, string>) =>
  new Response(JSON.stringify({ error: message }), {
    status: 401,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });

const validateAuth = async (
  request: Request,
  env: Env,
  corsHeaders: Record<string, string>,
  options: { requireSession?: boolean; allowPlainPassword?: boolean } = {}
) => {
  const serverPassword = (await env.CLOUDNAV_KV.get('password')) || env.PASSWORD;
  if (!serverPassword) {
    return {
      ok: false,
      response: new Response(JSON.stringify({ error: 'Server misconfigured: PASSWORD not set' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      }),
    };
  }

  const websiteConfig = await getWebsiteConfig(env);
  const passwordExpiryDays = websiteConfig.passwordExpiryDays ?? 7;
  // 0 = 永久有效（不校验过期）；否则为过期毫秒数，同时约束 token 有效期与会话头
  const expiryMs = passwordExpiryDays > 0 ? passwordExpiryDays * 24 * 60 * 60 * 1000 : 0;

  const providedPassword = request.headers.get('x-auth-password');
  // 凭据可为 HMAC token（用独立 AUTH_SECRET 签名，服务端校验过期与会话代次）；
  // 明文密码仅 authOnly/changePassword 等登录流程允许，其他接口一律只接受 token
  const tokenSecret = env.AUTH_SECRET || serverPassword;
  const authEpoch = Number((await env.CLOUDNAV_KV.get('auth_epoch')) || 0);
  const tokenValid = providedPassword ? await verifyToken(tokenSecret, providedPassword, expiryMs, authEpoch) : false;
  const plainValid = options.allowPlainPassword && !!providedPassword && providedPassword === serverPassword;
  if (!providedPassword || (!tokenValid && !plainValid)) {
    return {
      ok: false,
      response: buildUnauthorizedResponse('Unauthorized', corsHeaders),
    };
  }

  if (options.requireSession && passwordExpiryDays > 0) {
    const authIssuedAtRaw = request.headers.get(AUTH_TIME_HEADER);
    const authIssuedAt = authIssuedAtRaw ? Number(authIssuedAtRaw) : NaN;

    if (Number.isFinite(authIssuedAt) && authIssuedAt > 0 && Date.now() - authIssuedAt > expiryMs) {
      return {
        ok: false,
        response: buildUnauthorizedResponse('密码已过期，请重新输入', corsHeaders),
      };
    }
  }

  return {
    ok: true,
    websiteConfig,
  };
};

const normalizeDomain = (rawDomain: string | null) => {
  if (!rawDomain) return '';

  try {
    const value = rawDomain.startsWith('http://') || rawDomain.startsWith('https://')
      ? rawDomain
      : `https://${rawDomain}`;
    return new URL(value).hostname;
  } catch {
    return rawDomain.trim();
  }
};

const toBase64 = (buffer: ArrayBuffer) => {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
};

const MAX_ICON_BYTES = 2 * 1024 * 1024; // 图标缓存上限 2MB

const fetchAndEncodeImage = async (imageUrl: string) => {
  // 10s 超时：外部图标服务挂起时及时中止
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(imageUrl, {
      cf: { cacheTtl: 86400, cacheEverything: true },
      signal: controller.signal,
    });

    if (!response.ok) return null;

    // 仅接受图片类型，避免拉取任意内容进缓存/内存
    const contentType = response.headers.get('content-type') || '';
    if (!/^image\//i.test(contentType)) return null;

    // 优先按 Content-Length 提前拒绝超大响应
    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > MAX_ICON_BYTES) return null;

    // 流式读取：无 Content-Length 时累计超限立即取消，避免大响应整体载入内存
    if (!response.body) return null;
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_ICON_BYTES) {
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

    return `data:${contentType};base64,${toBase64(merged.buffer as ArrayBuffer)}`;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

const fetchAndEncodeFavicon = async (domain: string) => {
  const providers = [
    `https://www.faviconextractor.com/favicon/${encodeURIComponent(domain)}?larger=true`,
    `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`,
  ];

  for (const iconUrl of providers) {
    const encoded = await fetchAndEncodeImage(iconUrl);
    if (encoded) return encoded;
  }

  return null;
};

// 处理 OPTIONS 请求（解决跨域预检）
export const onRequestOptions = async (context: { request: Request }) => {
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(context.request),
  });
};

// GET: 获取数据
export const onRequestGet = async (context: { env: Env; request: Request }) => {
  const corsHeaders = getCorsHeaders(context.request);
  try {
    const { env, request } = context;
    const url = new URL(request.url);
    const checkAuth = url.searchParams.get('checkAuth');
    const getConfig = url.searchParams.get('getConfig');
    const websiteConfig = await getWebsiteConfig(env);
    const serverPassword = (await env.CLOUDNAV_KV.get('password')) || env.PASSWORD;
    const requiresAuth = !!serverPassword && !!websiteConfig.requirePasswordOnVisit;
    
    // 如果是检查认证请求，返回是否设置了密码
    if (checkAuth === 'true') {
      return new Response(JSON.stringify({ 
        hasPassword: !!serverPassword,
        requiresAuth
      }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
    
    // 如果是获取配置请求
    if (getConfig === 'ai') {
      const authCheck = await validateAuth(request, env, corsHeaders, { requireSession: true });
      if (!authCheck.ok) {
        return authCheck.response;
      }
      const aiConfig = await env.CLOUDNAV_KV.get('ai_config');
      return new Response(aiConfig || '{}', {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
    
    // 如果是获取搜索配置请求
    if (getConfig === 'search') {
      const searchConfig = await env.CLOUDNAV_KV.get('search_config');
      return new Response(searchConfig || '{}', {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    if (getConfig === 'webdav') {
      const authCheck = await validateAuth(request, env, corsHeaders, { requireSession: true });
      if (!authCheck.ok) {
        return authCheck.response;
      }
      const webDavConfig = await env.CLOUDNAV_KV.get('webdav_config');
      return new Response(webDavConfig || '{}', {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    // 获取实用工具配置（需登录，包含各工具 API Key）
    if (getConfig === 'tools') {
      const authCheck = await validateAuth(request, env, corsHeaders, { requireSession: true });
      if (!authCheck.ok) {
        return authCheck.response;
      }
      const toolsConfig = await env.CLOUDNAV_KV.get('tools_config');
      return new Response(toolsConfig || '{}', {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
    
    // 如果是获取网站配置请求
    if (getConfig === 'website') {
      return new Response(JSON.stringify({
        requirePasswordOnVisit: false,
        passwordExpiryDays: 7,
        ...websiteConfig,
      }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
    
    // 如果是获取图标请求
    if (getConfig === 'favicon') {
      const domain = normalizeDomain(url.searchParams.get('domain'));
      const shouldFetch = url.searchParams.get('fetch') === 'true';
      if (!domain) {
        return new Response(JSON.stringify({ error: 'Domain parameter is required' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
      
      // 从KV中获取缓存的图标
      const cachedIcon = await env.CLOUDNAV_KV.get(`favicon:${domain}`);
      if (cachedIcon && (!shouldFetch || cachedIcon.startsWith('data:'))) {
        return new Response(JSON.stringify({ icon: cachedIcon, cached: true }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      if (shouldFetch) {
        // 触发外部网络请求 + KV 写入属于特权操作：必须登录（防止匿名滥用 Functions/KV 额度）
        const authCheck = await validateAuth(request, env, corsHeaders, { requireSession: true });
        if (!authCheck.ok) {
          return authCheck.response;
        }
        const fetchedIcon = await fetchAndEncodeFavicon(domain);

        if (fetchedIcon) {
          await env.CLOUDNAV_KV.put(`favicon:${domain}`, fetchedIcon);
          return new Response(JSON.stringify({ icon: fetchedIcon, cached: true }), {
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }

        if (cachedIcon) {
          return new Response(JSON.stringify({ icon: cachedIcon, cached: true }), {
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }
      }
      
      // 如果没有缓存，返回空结果
      return new Response(JSON.stringify({ icon: null, cached: false }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
    
    // 从 KV 中读取数据
    const data = await env.CLOUDNAV_KV.get('app_data');
    
    if (!data) {
      // 没有任何数据：返回显式 hasData:false，让前端区分「从未同步」与「用户清空了数据」
      return new Response(JSON.stringify({ links: [], categories: [], hasData: false }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    const appData = JSON.parse(data);
    const revision = typeof appData.revision === 'number' ? appData.revision : 0;
    const links: any[] = appData.links || [];
    const categories: any[] = appData.categories || [];

    // ===== 分类密码解锁：?category=<id> + x-category-password 头 =====
    // 独立于全站登录，匿名用户也能用分类密码解锁单个分类（密码只在服务端比对）
    const categoryQuery = url.searchParams.get('category');
    if (categoryQuery) {
      const cat = categories.find((c: any) => c.id === categoryQuery);
      const categoryPwd = request.headers.get('x-category-password');
      // 限流 key 按 IP 维度（不拼用户可控的 category，防止任意参数生成无限 KV key）
      const failKey = `catfail:${getClientIp(request)}`;
      if (!cat || !cat.password || !categoryPwd || categoryPwd !== cat.password) {
        // 分类密码失败计数：达到阈值返回 429
        const locked = await recordAuthFail(env, failKey);
        if (locked) {
          return new Response(JSON.stringify({ error: '尝试次数过多，请稍后再试' }), {
            status: 429,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }
        return new Response(JSON.stringify({ error: '分类密码错误' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
      await clearAuthFail(env, failKey);
      // 验证通过：仅返回该分类的链接（不含分类密码等敏感字段）
      return new Response(JSON.stringify({
        links: links.filter((l: any) => l.categoryId === categoryQuery),
        hasData: true,
      }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    // ===== 全站访问控制与敏感数据隔离 =====
    // 全站锁开启时必须登录；未开启时也尝试识别携带的会话（可选认证）
    let isAuthed = false;
    if (requiresAuth) {
      const authCheck = await validateAuth(request, env, corsHeaders, { requireSession: true });
      if (!authCheck.ok) {
        return authCheck.response;
      }
      isAuthed = true;
    } else {
      const authCheck = await validateAuth(request, env, corsHeaders);
      isAuthed = authCheck.ok;
    }

    if (isAuthed) {
      // 站长（持有全站密码）：返回全量数据（含分类密码，供管理界面编辑）
      return new Response(JSON.stringify({ ...appData, revision, hasData: true }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    // 匿名：剔除受保护分类（有密码 或 需全站登录）与用户隐藏（hidden）的全部链接，分类密码不下发（仅给 hasPassword 标记）
    const protectedIds = new Set(
      categories.filter((c: any) => c.password || c.requireAuth).map((c: any) => c.id)
    );
    return new Response(JSON.stringify({
      links: links.filter((l: any) => !protectedIds.has(l.categoryId) && !l.hidden),
      categories: categories.map((c: any) => c.password ? { ...c, password: undefined, hasPassword: true } : c),
      revision,
      hasData: true,
    }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Failed to fetch data' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }
};

// POST: 保存数据
export const onRequestPost = async (context: { request: Request; env: Env }) => {
  const { request, env } = context;
  const corsHeaders = getCorsHeaders(request);

  // 1. 验证密码（对于敏感操作需要密码）
  const serverPassword = (await env.CLOUDNAV_KV.get('password')) || env.PASSWORD;

  try {
    // 流式读取请求体并限制大小（不依赖 Content-Length）：超过上限直接 413
    const MAX_REQUEST_BYTES = 2 * 1024 * 1024;
    const rawBody = await readBodyLimited(request, MAX_REQUEST_BYTES);
    if (rawBody === null) {
      return new Response(JSON.stringify({ error: '请求体过大' }), {
        status: 413,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
    let body: Record<string, any>;
    try {
      body = JSON.parse(rawBody) as Record<string, any>;
    } catch {
      return new Response(JSON.stringify({ error: '请求体不是有效 JSON' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
    
    // 如果只是验证密码，不更新数据
    if (body.authOnly) {
      const failKey = `auth_fail:${getClientIp(request)}`;
      // 锁定期间先拦截：不执行密码比较（连正确密码也不放行，彻底阻断暴力破解）
      if (await isAuthLocked(env, failKey)) {
        return new Response(JSON.stringify({ error: '尝试次数过多，请 10 分钟后再试' }), {
          status: 429,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
      const authCheck = await validateAuth(request, env, corsHeaders, { allowPlainPassword: true });
      if (!authCheck.ok) {
        // 失败计数：达到阈值返回 429（暴力破解防护）
        const locked = await recordAuthFail(env, failKey);
        if (locked) {
          return new Response(JSON.stringify({ error: '尝试次数过多，请 10 分钟后再试' }), {
            status: 429,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }
        return authCheck.response;
      }
      await clearAuthFail(env, failKey);
      
      // 签发 HMAC 会话 token：用独立 AUTH_SECRET 签名并携带当前会话代次（改密码后旧 token 立即失效）
      const authSecret = env.AUTH_SECRET || serverPassword;
      const authEpoch = Number((await env.CLOUDNAV_KV.get('auth_epoch')) || 0);
      const authenticatedAt = Date.now();
      const token = await issueAuthToken(authSecret, authenticatedAt, authEpoch);
      return new Response(JSON.stringify({ success: true, authenticatedAt, token }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    // 修改登录密码（验证旧密码后写入 KV，覆盖部署环境变量 PASSWORD）
    // 注意：改过一次密码后，KV 中的 password 会优先于环境变量；如需回退到环境变量，删除 KV 的 password key 即可
    if (body.changePassword) {
      const failKey = `auth_fail:${getClientIp(request)}`;
      // 改密码同样纳入限流（锁定期间先拦截，防止对旧密码的无限尝试）
      if (await isAuthLocked(env, failKey)) {
        return new Response(JSON.stringify({ error: '尝试次数过多，请 10 分钟后再试' }), {
          status: 429,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
      const { oldPassword, newPassword } = body.changePassword;
      const currentPassword = (await env.CLOUDNAV_KV.get('password')) || env.PASSWORD;
      if (!oldPassword || oldPassword !== currentPassword) {
        await recordAuthFail(env, failKey);
        return new Response(JSON.stringify({ error: '当前密码错误' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
      if (!newPassword || String(newPassword).length < 8) {
        return new Response(JSON.stringify({ error: '新密码长度至少 8 位' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
      if (String(newPassword) === currentPassword) {
        return new Response(JSON.stringify({ error: '新密码不能与当前密码相同' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
      // 先递增会话代次使旧 token 立即失效（安全优先），再写入新密码；
      // 若密码写入失败，epoch 已变 → 旧会话全部失效，用户用旧密码重新登录即可恢复一致
      const newEpoch = Number((await env.CLOUDNAV_KV.get('auth_epoch')) || 0) + 1;
      await env.CLOUDNAV_KV.put('auth_epoch', String(newEpoch));
      try {
        await env.CLOUDNAV_KV.put('password', String(newPassword));
      } catch (e) {
        // 密码写入失败：epoch 已递增（旧 token 失效），返回错误提示重新登录（用旧密码）
        return new Response(JSON.stringify({ error: '密码修改失败，请重试；若会话已失效请重新登录' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
      await clearAuthFail(env, failKey);
      // 用 AUTH_SECRET 签名签发新代次 token 供前端直接续用（不落明文密码）
      const authSecret = env.AUTH_SECRET || String(newPassword);
      const token = await issueAuthToken(authSecret, Date.now(), newEpoch);
      return new Response(JSON.stringify({ success: true, token }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
    
    // 配置写入统一大小限制（saveConfig 各分支共用）
    if (body.saveConfig) {
      const configSize = JSON.stringify(body.config || {}).length;
      if (configSize > 200 * 1024) {
        return new Response(JSON.stringify({ error: '配置过大' }), {
          status: 413,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
    }

    // 如果是保存搜索配置（允许无密码访问，因为搜索配置不包含敏感数据）
    if (body.saveConfig === 'search') {
      // 如果服务器设置了密码，需要验证密码
      if (serverPassword) {
        const authCheck = await validateAuth(request, env, corsHeaders, { requireSession: true });
        if (!authCheck.ok) {
          return authCheck.response;
        }
      }
      
      await env.CLOUDNAV_KV.put('search_config', JSON.stringify(body.config));
      return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    if (body.saveConfig === 'webdav') {
      const authCheck = await validateAuth(request, env, corsHeaders, { requireSession: true });
      if (!authCheck.ok) {
        return authCheck.response;
      }
      await env.CLOUDNAV_KV.put('webdav_config', JSON.stringify(body.config));
      return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    // 保存实用工具配置（需登录）
    if (body.saveConfig === 'tools') {
      const authCheck = await validateAuth(request, env, corsHeaders, { requireSession: true });
      if (!authCheck.ok) {
        return authCheck.response;
      }
      await env.CLOUDNAV_KV.put('tools_config', JSON.stringify(body.config));
      return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
    
      // 保存图标也需要密码，避免任意写入缓存；统一走 validateAuth（含 token 过期校验）
      if (body.saveConfig === 'favicon') {
      const domain = normalizeDomain(body.domain);
      const { icon } = body;
      if (!domain || !icon) {
        return new Response(JSON.stringify({ error: 'Domain and icon are required' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      const authCheck = await validateAuth(request, env, corsHeaders, { requireSession: true });
      if (!authCheck.ok) {
        return authCheck.response;
      }
      
      let finalIcon = icon;
      if (!finalIcon.startsWith('data:')) {
        const isCustomImageUrl = /^https?:\/\//i.test(finalIcon);
        finalIcon = isCustomImageUrl
          ? await fetchAndEncodeImage(finalIcon)
          : await fetchAndEncodeFavicon(domain);
      }

      if (!finalIcon) {
        return new Response(JSON.stringify({ error: 'Failed to fetch favicon' }), {
          status: 502,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      await env.CLOUDNAV_KV.put(`favicon:${domain}`, finalIcon);
      return new Response(JSON.stringify({ success: true, icon: finalIcon }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
    
    // 对于其他操作（保存AI配置、应用数据等），需要密码验证
    if (serverPassword) {
      const authCheck = await validateAuth(request, env, corsHeaders, { requireSession: true });
      if (!authCheck.ok) {
        return authCheck.response;
      }
    } else {
      return new Response(JSON.stringify({ error: 'Server misconfigured: PASSWORD not set' }), { 
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
    
    // 如果是保存AI配置
    if (body.saveConfig === 'ai') {
      await env.CLOUDNAV_KV.put('ai_config', JSON.stringify(body.config));
      return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
    
    // 如果是保存网站配置
    if (body.saveConfig === 'website') {
      await env.CLOUDNAV_KV.put('website_config', JSON.stringify(body.config));
      return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
    
    // 将数据写入 KV（带 revision 冲突检测：客户端基于旧版本写入会被 409 拒绝，防止多端/并发旧快照覆盖新数据）
    const currentRaw = await env.CLOUDNAV_KV.get('app_data');
    const currentRevision = currentRaw ? (JSON.parse(currentRaw).revision ?? 0) : 0;
    if (body.baseRevision !== undefined && typeof body.baseRevision === 'number' && body.baseRevision !== currentRevision) {
      return new Response(JSON.stringify({ error: '数据已在其他设备更新，请刷新后重试', revision: currentRevision }), {
        status: 409,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
    // 主数据写入前的统一 schema/大小校验：畸形结构返回 400，超限返回 413，不进入 KV
    const MAX_LINKS = 5000;
    const MAX_CATEGORIES = 200;
    const MAX_APP_DATA_BYTES = 2 * 1024 * 1024;
    if (!Array.isArray(body.links) || !Array.isArray(body.categories)) {
      return new Response(JSON.stringify({ error: '数据格式错误：links/categories 必须为数组' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
    if (body.links.length > MAX_LINKS || body.categories.length > MAX_CATEGORIES) {
      return new Response(JSON.stringify({ error: '数据量超出上限' }), {
        status: 413,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
    const bodySize = JSON.stringify(body).length;
    if (bodySize > MAX_APP_DATA_BYTES) {
      return new Response(JSON.stringify({ error: '请求体过大' }), {
        status: 413,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
    const newRevision = currentRevision + 1;
    // 逐项完整校验：任一畸形元素整单拒绝（返回 400），不静默过滤，防止 links:[null] 等进入 KV
    const isCleanLink = (l: any) =>
      l && typeof l === 'object' &&
      typeof l.id === 'string' && l.id.length > 0 && l.id.length <= 100 &&
      typeof l.title === 'string' && l.title.length > 0 && l.title.length <= 300 &&
      typeof l.url === 'string' && l.url.length <= 2048 && /^https?:\/\//i.test(l.url) &&
      (l.categoryId === undefined || (typeof l.categoryId === 'string' && l.categoryId.length <= 100)) &&
      (l.createdAt === undefined || typeof l.createdAt === 'number' || typeof l.createdAt === 'string');
    const isCleanCategory = (c: any) =>
      c && typeof c === 'object' &&
      typeof c.id === 'string' && c.id.length > 0 && c.id.length <= 100 &&
      typeof c.name === 'string' && c.name.length > 0 && c.name.length <= 100;
    const allLinksClean = (body.links as any[]).every(isCleanLink);
    const allCategoriesClean = (body.categories as any[]).every(isCleanCategory);
    if (!allLinksClean || !allCategoriesClean) {
      return new Response(JSON.stringify({ error: '数据包含畸形元素，已拒绝保存' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
    const appData = {
      links: body.links as any[],
      categories: body.categories as any[],
      revision: newRevision,
    };
    try {
      await env.CLOUDNAV_KV.put('app_data', JSON.stringify(appData));
    } catch (e) {
      // KV 写入失败（含同 Key 写入频率限制）：返回可识别状态，前端退避重试而非当成普通 500
      return new Response(JSON.stringify({ error: '存储繁忙，请稍后重试' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    return new Response(JSON.stringify({ success: true, revision: newRevision }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Failed to save data' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }
};
