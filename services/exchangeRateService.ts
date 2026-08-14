interface RatesCache {
  timestamp: number;
  rates: Record<string, number>; // 相对 USD 的汇率
}

const CACHE_KEY = 'cloudnav_fx_rates_usd';
const CACHE_TTL = 60 * 60 * 1000; // 1 小时

/**
 * 获取相对 USD 的汇率表（带 1 小时本地缓存）
 * 免费套餐仅支持 latest/USD，其他币种通过 USD 交叉换算
 */
export const fetchUsdRates = async (apiKey: string): Promise<Record<string, number>> => {
  // 尝试读取缓存
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) {
      const parsed: RatesCache = JSON.parse(cached);
      if (parsed.rates && Date.now() - parsed.timestamp < CACHE_TTL) {
        return parsed.rates;
      }
    }
  } catch (e) {
    console.warn('Failed to read fx cache', e);
  }

  const url = `https://v6.exchangerate-api.com/v6/${encodeURIComponent(apiKey)}/latest/USD`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`汇率接口请求失败 (HTTP ${res.status})`);
  }
  const data = await res.json();
  if (data.result !== 'success') {
    throw new Error(`汇率接口错误: ${data['error-type'] || 'unknown'}`);
  }
  const rates = data.conversion_rates as Record<string, number>;

  // 写入缓存
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ timestamp: Date.now(), rates } as RatesCache));
  } catch (e) {
    console.warn('Failed to cache fx rates', e);
  }

  return rates;
};

/**
 * 货币换算：amount 从 from 币种换算到 to 币种（经 USD 交叉）
 */
export const convertCurrency = (
  rates: Record<string, number>,
  amount: number,
  from: string,
  to: string
): number => {
  if (from === to) return amount;
  const fromUsd = rates[from];
  const toUsd = rates[to];
  if (!fromUsd || !toUsd) return NaN;
  // amount (from) → USD → to
  return (amount / fromUsd) * toUsd;
};
