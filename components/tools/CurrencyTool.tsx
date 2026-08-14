import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Coins, Loader2, ArrowRightLeft, RefreshCw, Settings2, AlertCircle } from 'lucide-react';
import { ToolsConfig } from '../../types';
import { fetchUsdRates, convertCurrency } from '../../services/exchangeRateService';

interface CurrencyToolProps {
  currencyConfig: ToolsConfig['currency'];
  onOpenSettings?: () => void;
}

const ALL_CURRENCIES = [
  'USD', 'CNY', 'EUR', 'JPY', 'GBP', 'HKD', 'KRW', 'AUD', 'CAD', 'SGD',
  'TWD', 'THB', 'INR', 'RUB', 'BRL', 'MXN', 'CHF', 'SEK', 'NZD', 'MYR',
];

const CurrencyTool: React.FC<CurrencyToolProps> = ({ currencyConfig, onOpenSettings }) => {
  const [amount, setAmount] = useState('100');
  const [from, setFrom] = useState(currencyConfig.baseCurrency || 'CNY');
  const [to, setTo] = useState((currencyConfig.favorites.find(c => c !== (currencyConfig.baseCurrency || 'CNY'))) || 'USD');
  const [rates, setRates] = useState<Record<string, number> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const lastUpdatedRef = useRef<number | null>(null);

  const hasKey = !!currencyConfig.apiKey;
  const currencies = useMemo(() => {
    const merged = [...currencyConfig.favorites];
    for (const c of ALL_CURRENCIES) {
      if (!merged.includes(c)) merged.push(c);
    }
    return merged;
  }, [currencyConfig.favorites]);

  const loadRates = async (silent = false) => {
    if (!hasKey) return;
    if (!silent) setLoading(true);
    setError('');
    try {
      const r = await fetchUsdRates(currencyConfig.apiKey);
      setRates(r);
      setLastUpdated(Date.now());
      lastUpdatedRef.current = Date.now();
    } catch (e: any) {
      setError(e?.message || '获取汇率失败');
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    if (hasKey) loadRates(true);
    // 每 30 分钟自动检查/刷新汇率（命中 1 小时缓存时不会实际请求）
    const timer = setInterval(() => loadRates(true), 30 * 60 * 1000);
    // 页面重新可见且数据超过 10 分钟时自动刷新
    const onVisibility = () => {
      if (document.visibilityState === 'visible' && lastUpdatedRef.current && Date.now() - lastUpdatedRef.current > 10 * 60 * 1000) {
        loadRates(true);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currencyConfig.apiKey]);

  // 基础币种配置变化时同步「源币种」
  useEffect(() => {
    const base = currencyConfig.baseCurrency || 'CNY';
    if (currencies.includes(base)) {
      setFrom(base);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currencyConfig.baseCurrency]);

  if (!hasKey) {
    return (
      <div className="text-center py-6">
        <Coins size={32} className="mx-auto mb-3 text-slate-300 dark:text-slate-600" />
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
          汇率转换需要配置 exchangerate-api Key（免费申请，配置需登录后生效）
        </p>
        <button
          onClick={onOpenSettings}
          className="flex items-center gap-1.5 mx-auto px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg transition-colors"
        >
          <Settings2 size={15} /> 去配置汇率
        </button>
      </div>
    );
  }

  const numAmount = parseFloat(amount);
  const result = rates && !isNaN(numAmount) && rates[from] && rates[to]
    ? convertCurrency(rates, numAmount, from, to)
    : NaN;

  const handleSwap = () => {
    setFrom(to);
    setTo(from);
  };

  return (
    <div className="space-y-3">
      {/* 币种转换 + 金额 */}
      <div className="flex gap-2 items-center">
        <select
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className="p-2 rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white text-sm outline-none focus:ring-2 focus:ring-blue-500"
        >
          {currencies.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <button
          onClick={handleSwap}
          className="p-2 text-slate-400 hover:text-blue-500 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
          title="交换币种"
        >
          <ArrowRightLeft size={16} />
        </button>
        <select
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className="p-2 rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white text-sm outline-none focus:ring-2 focus:ring-blue-500"
        >
          {currencies.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <input
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          min="0"
          className="flex-1 p-2 rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white text-sm font-mono outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="金额"
        />
        <button
          onClick={() => loadRates()}
          className="p-2 text-slate-400 hover:text-blue-500 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
          title="刷新汇率"
        >
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* 结果 */}
      {loading && !rates ? (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
        </div>
      ) : error && !rates ? (
        <div className="text-center py-4">
          <AlertCircle size={24} className="mx-auto mb-2 text-red-400" />
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">{error}</p>
          <button
            onClick={() => loadRates()}
            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded-lg transition-colors"
          >
            重试
          </button>
        </div>
      ) : rates && !isNaN(result) ? (
        <div className="rounded-xl border border-blue-200 dark:border-blue-800/50 bg-blue-50/60 dark:bg-blue-900/20 px-4 py-3">
          <div className="text-lg font-semibold text-slate-800 dark:text-slate-100 tabular-nums">
            {numAmount.toLocaleString('zh-CN', { maximumFractionDigits: 2 })} {from} ={' '}
            <span className="text-blue-600 dark:text-blue-300">
              {result.toLocaleString('zh-CN', { maximumFractionDigits: 4 })} {to}
            </span>
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            1 {from} ≈ {(convertCurrency(rates, 1, from, to)).toLocaleString('zh-CN', { maximumFractionDigits: 6 })} {to}
            {lastUpdated && ` · 更新于 ${new Date(lastUpdated).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`}
          </div>
        </div>
      ) : rates ? (
        <div className="text-xs text-amber-500 flex items-center gap-1">
          <AlertCircle size={12} /> 无法换算：币种代码无效或不在汇率表中
        </div>
      ) : null}

      {error && rates && (
        <p className="text-xs text-amber-500 flex items-center gap-1">
          <AlertCircle size={12} /> {error}（使用上次缓存的汇率）
        </p>
      )}
    </div>
  );
};

export default CurrencyTool;
