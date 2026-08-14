// Bing 每日壁纸代理：解决前端 CORS + KV 缓存当日壁纸 URL
// GET /api/bing-wallpaper?resolution=4k|1080p|mobile
// 返回 { url, copyright, title }

interface Env {
  CLOUDNAV_KV: any;
}

const BING_API = 'https://cn.bing.com/HPImageArchive.aspx?format=js&idx=0&n=1&mkt=zh-CN';

// 分辨率 → Bing 图片 URL 后缀
const RES_MAP: Record<string, string> = {
  '4k': '_UHD.jpg',         // 3840×2160
  '1080p': '_1920x1080.jpg', // 1920×1080
  'mobile': '_1080x1920.jpg', // 1080×1920
};

// 外部请求：10s 超时保持到响应体读取完成（慢速响应体同样受限）
const fetchBingImage = async (): Promise<any> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(BING_API, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CloudNav/1.0)' },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Bing API ${res.status}`);
    const data: any = await res.json();
    const img = data?.images?.[0];
    if (!img?.url) throw new Error('Bing API 返回为空');
    return img;
  } finally {
    clearTimeout(timer);
  }
};

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const url = new URL(request.url);
  const resolution = url.searchParams.get('resolution') || '4k';
  const suffix = RES_MAP[resolution] || RES_MAP['4k'];

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  const dateKey = new Date().toISOString().slice(0, 10); // 当日
  // resolution 归一化为白名单值：非法值不会生成任意 KV key
  const normalizedResolution = RES_MAP[resolution] ? resolution : '4k';
  const cacheKey = `bing_wallpaper_v2_${normalizedResolution}_${dateKey}`;

  // 命中 KV 缓存（当天同分辨率只请求一次 Bing）
  try {
    const cached = await env.CLOUDNAV_KV.get(cacheKey);
    if (cached) {
      return new Response(cached, { headers: corsHeaders });
    }
  } catch (e) {
    // KV 不可用时忽略缓存，直接请求
  }

  try {
    const img = await fetchBingImage();
    // 解析图片 ID（Bing URL: /th?id=OHR.xxx_1920x1080.jpg&rf=...&pid=hp）
    const rawUrl = new URL(`https://cn.bing.com${img.url}`);
    const imgId = rawUrl.searchParams.get('id') || '';
    const base = imgId.replace(/_\d+x\d+\.jpg$/, '').replace(/_UHD\.jpg$/, '');
    const finalUrl = `https://cn.bing.com/th?id=${base}${suffix}&pid=hp`;
    const result = JSON.stringify({
      url: finalUrl,
      copyright: img.copyright || '',
      title: img.title || '',
    });

    try {
      // 缓存 TTL：当天有效（最长 26 小时）
      await env.CLOUDNAV_KV.put(cacheKey, result, { expirationTtl: 26 * 60 * 60 });
    } catch (e) {
      // 缓存失败不影响返回
    }

    return new Response(result, { headers: corsHeaders });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || '获取 Bing 壁纸失败' }), {
      status: 502,
      headers: corsHeaders,
    });
  }
};
