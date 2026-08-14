// 统一安全响应头：作用于所有 /api/* Functions 响应（含错误响应）
// 各 handler 已自行设置的部分（如 Vary/动态 Origin）保持原样，这里兜底补齐全局策略
export const onRequest: PagesFunction = async (context) => {
  const response = await context.next();
  const headers = new Headers(response.headers);
  // 敏感数据（配置/数据）一律禁止缓存
  if (!headers.has('Cache-Control')) {
    headers.set('Cache-Control', 'no-store');
  }
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};
