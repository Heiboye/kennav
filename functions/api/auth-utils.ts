// 共享鉴权工具：HMAC 会话 token
// 目的：localStorage 不再存放明文密码，改为存放「密码 + 时间戳」的 HMAC 签名（不可逆推密码）。
// 只有持有正确密码（服务端 secret）才能签发或验证 token，因此 token 有效等价于知道密码。
// 兼容性：verifyCredential 对非 token 格式的凭据回退明文比对，老会话（明文密码）无需重新登录即可平滑升级。

const encoder = new TextEncoder();

const toHex = (buf: ArrayBuffer): string =>
  [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');

const hmacHex = async (secret: string, message: string): Promise<string> => {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return toHex(sig);
};

/**
 * 签发 token：`<签发时间戳>.<会话代次 epoch>.<HMAC-SHA256(secret, "ts:epoch")>`
 * epoch 用于会话失效控制：修改密码时递增，旧 epoch 的 token 立即失效（不等自然过期）。
 * @param secret 签名密钥（AUTH_SECRET 或密码）
 * @param timestamp 签发时间戳（毫秒）
 * @param epoch 会话代次（KV auth_epoch；改密码后 +1）
 */
export const issueAuthToken = async (secret: string, timestamp: number, epoch = 0): Promise<string> => {
  const ts = String(timestamp);
  const msg = `${ts}:${epoch}`;
  return ts + '.' + epoch + '.' + (await hmacHex(secret, msg));
};

/**
 * 仅验证 HMAC token（签名 + 服务端过期校验 + 会话代次校验），不含明文密码回退。
 * @param expectedEpoch 服务端当前会话代次；token 内 epoch 与之不一致则视为失效（改密码后旧 token 立即作废）
 */
export const verifyToken = async (secret: string, credential: string | null, maxAgeMs = 0, expectedEpoch = 0): Promise<boolean> => {
  if (!credential || !secret) return false;

  const parts = credential.split('.');
  if (parts.length !== 3) return false; // 旧格式（2 段）一律失效，走明文回退或重新登录
  const ts = parts[0];
  const epoch = parts[1];
  const sig = parts[2];
  // 格式校验：时间戳为数字、epoch 为数字、签名为 64 位 hex（SHA-256）
  if (!/^\d{10,13}$/.test(ts) || !/^\d+$/.test(epoch) || !/^[0-9a-f]{64}$/.test(sig)) return false;
  // 会话代次不匹配：密码已修改，旧 token 作废
  if (Number(epoch) !== Number(expectedEpoch)) return false;

  // 服务端强制过期校验（签发时间戳由服务端写入，攻击者无法伪造）
  if (maxAgeMs > 0) {
    const issuedAt = Number(ts);
    if (!Number.isFinite(issuedAt) || issuedAt <= 0 || Date.now() - issuedAt > maxAgeMs) {
      return false;
    }
  }
  try {
    const expected = await hmacHex(secret, `${ts}:${epoch}`);
    if (expected.length !== sig.length) return false;
    let diff = 0;
    for (let i = 0; i < expected.length; i++) {
      diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
    }
    return diff === 0;
  } catch {
    return false;
  }
};

/**
 * 验证凭据：优先按 token 解析（HMAC 重算、常数时间比较 + 服务端过期校验），失败则回退明文密码比对。
 * @param secret 服务端密码
 * @param credential 请求携带的凭据（x-auth-password 值，可能是 token 或明文密码）
 * @param maxAgeMs token 最大有效期（毫秒）；>0 时服务端强制校验签发时间，客户端无法通过删除/修改请求头绕过；0 表示 token 不过期
 */
export const verifyCredential = async (secret: string, credential: string | null, maxAgeMs = 0): Promise<boolean> => {
  if (!credential || !secret) return false;
  if (await verifyToken(secret, credential, maxAgeMs)) return true;
  return credential === secret;
};
