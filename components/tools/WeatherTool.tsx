import React, { useEffect, useRef, useState } from 'react';
import { CloudSun, Loader2, RefreshCw, MapPin, Settings2, Droplets, Wind, ThermometerSun, AlertTriangle, Eye, Gauge, Cloud, Check, XCircle } from 'lucide-react';
import { ToolsConfig } from '../../types';
import { fetchWeather, fetchHourlyForecast, fetchDailyForecast, fetchWeatherWarnings, isWeatherConfigured, WeatherData, HourlyForecast, DailyForecast, WeatherWarning } from '../../services/weatherService';

interface WeatherToolProps {
  weatherConfig: ToolsConfig['weather'];
  onOpenSettings?: () => void;
  expanded?: boolean;
}

// 天气背景动画样式（与天气类型对应的动态效果）
const WEATHER_ANIM = `
@keyframes wxRainFall { 0% { transform: translateY(-14px) rotate(14deg); opacity: 0; } 10% { opacity: 1; } 100% { transform: translateY(420px) rotate(14deg); opacity: 0.25; } }
@keyframes wxSnowFall { 0% { transform: translate(0,-12px); opacity: 0; } 10% { opacity: 1; } 25% { transform: translate(6px, 90px); } 50% { transform: translate(-5px, 185px); } 75% { transform: translate(5px, 275px); } 100% { transform: translate(-3px, 360px); opacity: 0.35; } }
@keyframes wxCloudDrift { 0% { transform: translateX(-150px); opacity: 0; } 12% { opacity: 0.9; } 88% { opacity: 0.9; } 100% { transform: translateX(360px); opacity: 0; } }
@keyframes wxFogDrift { 0% { transform: translateX(-5%); } 100% { transform: translateX(5%); } }
@keyframes wxLightning { 0%, 86%, 100% { opacity: 0; } 87% { opacity: 0.9; } 89% { opacity: 0.05; } 91% { opacity: 0.7; } 93% { opacity: 0; } }
@keyframes wxSunRotate { from { transform: rotate(0); } to { transform: rotate(360deg); } }
@keyframes wxSunPulse { 0%, 100% { box-shadow: 0 0 40px 12px rgba(251,191,36,0.35); } 50% { box-shadow: 0 0 70px 22px rgba(251,191,36,0.55); } }
@keyframes wxMoonGlow { 0%, 100% { box-shadow: 0 0 18px 5px rgba(226,232,240,0.18); } 50% { box-shadow: 0 0 32px 10px rgba(226,232,240,0.4); } }
@keyframes wxTwinkle { 0%, 100% { opacity: 0.15; } 50% { opacity: 1; } }
@keyframes wxShootingStar { 0% { transform: translate(0,0); opacity: 0; } 4% { opacity: 1; } 14% { transform: translate(-110px, 60px); opacity: 0; } 100% { transform: translate(-110px, 60px); opacity: 0; } }
@keyframes wxWindLine { 0% { transform: translateX(-70px); opacity: 0; } 25% { opacity: 0.7; } 100% { transform: translateX(90px); opacity: 0; } }
@keyframes wxOrbFloat { 0% { transform: translate(0,0) scale(1); opacity: 0; } 15% { opacity: 0.5; } 50% { transform: translate(26px,-32px) scale(1.18); opacity: 0.32; } 85% { opacity: 0.45; } 100% { transform: translate(-14px,26px) scale(0.92); opacity: 0; } }
.wx-drop { position: absolute; top: -16px; width: 1.5px; height: 12px; border-radius: 2px; background: linear-gradient(to bottom, rgba(255,255,255,0), rgba(255,255,255,0.9)); animation: wxRainFall linear infinite; }
.wx-snow { position: absolute; top: -12px; border-radius: 50%; background: rgba(255,255,255,0.95); animation: wxSnowFall linear infinite; }
.wx-cloud { position: absolute; width: 56px; height: 20px; border-radius: 999px; background: rgba(255,255,255,0.75); animation: wxCloudDrift linear infinite; }
.wx-cloud::before { content: ''; position: absolute; width: 26px; height: 26px; border-radius: 50%; background: inherit; top: -13px; left: 10px; }
.wx-cloud::after { content: ''; position: absolute; width: 18px; height: 18px; border-radius: 50%; background: inherit; top: -8px; left: 28px; }
.wx-fog { position: absolute; left: -12%; right: -12%; height: 38%; background: linear-gradient(to bottom, transparent, rgba(255,255,255,0.16), transparent); animation: wxFogDrift ease-in-out infinite alternate; }
.wx-flash { position: absolute; inset: 0; z-index: 20; pointer-events: none; background: radial-gradient(ellipse at 72% 18%, rgba(255,255,255,0.9), transparent 55%); animation: wxLightning 8s linear infinite; }
.wx-rays { position: absolute; border-radius: 50%; background: repeating-conic-gradient(rgba(255,214,79,0.4) 0deg 14deg, transparent 14deg 28deg); animation: wxSunRotate 22s linear infinite; }
.wx-wind { position: absolute; height: 2px; border-radius: 2px; background: linear-gradient(to right, transparent, rgba(255,255,255,0.75)); animation: wxWindLine ease-in-out infinite; }
.wx-meteor { position: absolute; width: 2.5px; height: 2.5px; border-radius: 50%; background: #fff; box-shadow: 0 0 6px 2px rgba(255,255,255,0.5); animation: wxShootingStar 18s linear infinite; }
.wx-meteor::after { content: ''; position: absolute; width: 64px; height: 1.5px; background: linear-gradient(to left, rgba(255,255,255,0.7), transparent); top: 0.5px; left: 2px; }
.wx-orb { position: absolute; border-radius: 50%; pointer-events: none; filter: blur(8px); animation: wxOrbFloat ease-in-out infinite; }
`;

type WxKind = 'sunny' | 'cloudy' | 'overcast' | 'rain' | 'thunder' | 'snow' | 'fog' | 'night';

const getWxKind = (iconCode: string): WxKind => {
  if (/^1(5[0-3])/.test(iconCode)) return 'night';
  if (/^3\d\d/.test(iconCode)) return 'thunder';
  if (/^4\d\d/.test(iconCode)) return 'snow';
  if (/^5\d\d/.test(iconCode)) return 'fog';
  if (iconCode === '100' || iconCode === '101') return 'sunny';
  if (iconCode === '102' || iconCode === '103') return 'cloudy';
  if (iconCode === '104') return 'overcast';
  if (iconCode === '01d') return 'sunny';
  if (iconCode === '01n') return 'night';
  if (/^0[2-3]/.test(iconCode)) return 'cloudy';
  if (iconCode === '04d' || iconCode === '04n') return 'overcast';
  if (/^(09|10|11)/.test(iconCode)) return 'rain';
  if (/^13/.test(iconCode)) return 'snow';
  if (/^50/.test(iconCode)) return 'fog';
  return 'cloudy';
};

const KIND_STYLE: Record<WxKind, {
  bg: string;
  drops?: number;      // 雨滴数量
  snows?: number;      // 雪花数量
  clouds?: number;     // 漂移云朵数量
  fogLayers?: number;  // 雾带层数
  thunder?: boolean;   // 雷雨闪电
  sun?: boolean;       // 太阳光芒
  moon?: boolean;      // 月亮光晕
  stars?: boolean;     // 星星闪烁
  meteor?: boolean;    // 流星
}> = {
  sunny: { bg: 'linear-gradient(160deg, #4fc3f7 0%, #81d4fa 40%, #b3e5fc 100%)', clouds: 2, sun: true },
  cloudy: { bg: 'linear-gradient(160deg, #90a4ae 0%, #b0bec5 45%, #cfd8dc 100%)', clouds: 3 },
  overcast: { bg: 'linear-gradient(160deg, #6b7a86 0%, #87949e 50%, #9aa5ad 100%)', clouds: 4 },
  rain: { bg: 'linear-gradient(160deg, #546e7a 0%, #78909c 50%, #90a4ae 100%)', drops: 20, clouds: 2 },
  thunder: { bg: 'linear-gradient(160deg, #37474f 0%, #546e7a 55%, #6d7d87 100%)', drops: 22, thunder: true, clouds: 2 },
  snow: { bg: 'linear-gradient(160deg, #78909c 0%, #b0bec5 55%, #e0e0e0 100%)', snows: 18 },
  fog: { bg: 'linear-gradient(160deg, #90a4ae 0%, #cfd8dc 50%, #eceff1 100%)', fogLayers: 3 },
  night: { bg: 'linear-gradient(160deg, #0f172a 0%, #1e293b 60%, #334155 100%)', stars: true, moon: true, meteor: true },
};

const WEEKDAY_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/**
 * 天气动态背景装饰（雨/雪/云/雾/闪电/阳光/星光/风线等）
 * dense=true 用于展开的大面积区域（元素稍多），常驻卡片用紧凑数量
 */
const WxDecor: React.FC<{
  kind: WxKind;
  style: (typeof KIND_STYLE)[WxKind];
  windLevel: number;
  dense?: boolean;
}> = ({ kind, style, windLevel, dense }) => {
  const mult = dense ? 1.3 : 1;
  const drops = Math.round((style.drops || 0) * mult);
  const snows = Math.round((style.snows || 0) * mult);
  const clouds = Math.round((style.clouds || 0) * (dense ? 1.2 : 1));
  const fogLayers = style.fogLayers || 0;

  // 风力 >= 3 级时叠加风线（速度随风力加快）
  const windLines = windLevel >= 3 ? Math.min(3, Math.ceil(windLevel / 2)) : 0;
  const windDur = Math.max(1.6, 4.5 - windLevel * 0.4);

  // 氛围光斑（沉浸式：所有天气类型通用，缓慢漂浮的柔和光斑覆盖全卡）
  const orbColors: Record<WxKind, string[]> = {
    sunny: ['rgba(255,235,170,0.55)', 'rgba(255,200,110,0.45)', 'rgba(190,230,255,0.45)'],
    cloudy: ['rgba(255,255,255,0.48)', 'rgba(200,220,240,0.42)', 'rgba(160,190,220,0.36)'],
    overcast: ['rgba(210,220,230,0.4)', 'rgba(150,165,180,0.34)', 'rgba(120,140,160,0.32)'],
    rain: ['rgba(200,220,235,0.45)', 'rgba(150,175,200,0.36)', 'rgba(120,150,180,0.34)'],
    thunder: ['rgba(210,215,225,0.4)', 'rgba(140,150,170,0.34)', 'rgba(100,110,135,0.32)'],
    snow: ['rgba(255,255,255,0.55)', 'rgba(230,240,250,0.45)', 'rgba(200,220,240,0.38)'],
    fog: ['rgba(255,255,255,0.45)', 'rgba(215,225,235,0.38)', 'rgba(180,195,210,0.34)'],
    night: ['rgba(140,150,255,0.4)', 'rgba(100,120,230,0.34)', 'rgba(170,140,255,0.32)'],
  };
  const orbs = (dense ? 4 : 2);

  return (
    <>
      {/* 氛围光斑 */}
      {Array.from({ length: orbs }).map((_, i) => (
        <div
          key={`orb-${i}`}
          className="wx-orb"
          style={{
            width: 100 + (i % 3) * 60,
            height: 100 + (i % 3) * 60,
            left: `${(i * 29 + 6) % 88}%`,
            top: `${(i * 37 + 8) % 82}%`,
            background: `radial-gradient(circle, ${orbColors[kind][i % 3]} 0%, transparent 70%)`,
            animationDuration: `${10 + (i % 3) * 5}s`,
            animationDelay: `${i * 2.2}s`,
          }}
        />
      ))}
      {/* 雨滴（斜雨，伪随机分布更自然） */}
      {drops > 0 && Array.from({ length: drops }).map((_, i) => (
        <div key={`drop-${i}`} className="wx-drop" style={{ left: `${((i * 137 + 41) % 100)}%`, height: 8 + (i % 5) * 4, animationDuration: `${0.6 + (i % 6) * 0.14}s`, animationDelay: `${(i % 9) * 0.18}s` }} />
      ))}
      {/* 雪花（左右摇摆下落，伪随机分布） */}
      {snows > 0 && Array.from({ length: snows }).map((_, i) => (
        <div key={`snow-${i}`} className="wx-snow" style={{ width: 3 + (i % 5) * 2, height: 3 + (i % 5) * 2, left: `${((i * 173 + 23) % 100)}%`, opacity: 0.65 + ((i % 4) * 0.1), animationDuration: `${2.2 + (i % 7) * 0.55}s`, animationDelay: `${(i % 10) * 0.45}s` }} />
      ))}
      {/* 云朵漂移 */}
      {clouds > 0 && Array.from({ length: clouds }).map((_, i) => (
        <div
          key={`cloud-${i}`}
          className="wx-cloud"
          style={{
            top: `${6 + (i * 23) % 62}%`,
            opacity: kind === 'overcast' ? 0.5 : 0.55 + (i % 2) * 0.15,
            background: kind === 'overcast' || kind === 'thunder' ? 'rgba(60,72,82,0.55)' : 'rgba(255,255,255,0.75)',
            transform: `scale(${0.7 + (i % 3) * 0.3})`,
            animationDuration: `${16 + (i % 4) * 5}s`,
            animationDelay: `${-i * 6}s`,
          }}
        />
      ))}
      {/* 雾带 */}
      {fogLayers > 0 && Array.from({ length: fogLayers }).map((_, i) => (
        <div key={`fog-${i}`} className="wx-fog" style={{ top: `${12 + i * 30}%`, animationDuration: `${11 + i * 4}s`, animationDelay: `${i * 1.8}s` }} />
      ))}
      {/* 雷雨闪电 */}
      {style.thunder && <div className="wx-flash" />}
      {/* 太阳旋转光芒 + 光晕脉冲（加大覆盖） */}
      {style.sun && (
        <>
          <div className="absolute rounded-full" style={{ width: 112, height: 112, right: 18, top: -14, background: 'radial-gradient(circle, #ffd54f 0%, #ffb300 60%, transparent 75%)', animation: 'wxSunPulse 3s ease-in-out infinite' }} />
          <div className="wx-rays" style={{ width: 176, height: 176, right: -6, top: -30, opacity: 0.85 }} />
        </>
      )}
      {/* 月亮光晕呼吸（加大） */}
      {style.moon && (
        <div className="absolute rounded-full" style={{ width: 72, height: 72, right: 28, top: 4, background: 'radial-gradient(circle, #e2e8f0 0%, #cbd5e1 55%, transparent 75%)', animation: 'wxMoonGlow 4s ease-in-out infinite' }} />
      )}
      {/* 星星闪烁（铺满整卡，沉浸夜空） */}
      {style.stars && Array.from({ length: 24 }).map((_, i) => (
        <div key={`star-${i}`} className="absolute rounded-full bg-white" style={{ width: i % 4 === 0 ? 3 : 2, height: i % 4 === 0 ? 3 : 2, left: `${((i * 41 + 7) % 100)}%`, top: `${((i * 29 + 4) % 95)}%`, animation: `wxTwinkle ${1.4 + (i % 5) * 0.5}s ease-in-out ${(i % 7) * 0.25}s infinite` }} />
      ))}
      {/* 流星 */}
      {style.meteor && (
        <div className="wx-meteor" style={{ right: 24, top: 20, animationDelay: '6s' }} />
      )}
      {/* 风线（风力 >= 3 级） */}
      {windLines > 0 && Array.from({ length: windLines }).map((_, i) => (
        <div key={`wind-${i}`} className="wx-wind" style={{ width: 34 + i * 10, top: `${30 + i * 22}%`, right: 12, animationDuration: `${windDur + i * 0.8}s`, animationDelay: `${i * 0.9}s` }} />
      ))}
    </>
  );
};

const WeatherTool: React.FC<WeatherToolProps> = ({ weatherConfig, onOpenSettings, expanded = false }) => {
  const [data, setData] = useState<WeatherData | null>(null);
  const [hourly, setHourly] = useState<HourlyForecast[]>([]);
  const [daily, setDaily] = useState<DailyForecast[]>([]);
  const [dailyTotal, setDailyTotal] = useState(0);
  const [warnings, setWarnings] = useState<WeatherWarning[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // 刷新按钮专用状态：加载中 / 成功/失败反馈 / 上次更新时间
  const [refreshing, setRefreshing] = useState(false);
  const [refreshTip, setRefreshTip] = useState<'success' | 'error' | ''>('');
  const [lastUpdatedAt, setLastUpdatedAt] = useState(0);
  const tipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isConfigured = isWeatherConfigured(weatherConfig);

  const loadWeather = async (silent = false, userInitiated = false): Promise<boolean> => {
    if (!isConfigured) return false;
    if (!silent) {
      if (userInitiated) {
        setRefreshing(true);
        setRefreshTip('');
      }
      setLoading(true);
    }
    setError('');
    try {
      // 各数据源独立容错：单个接口失败（如预警无权限）不影响实时/预报数据
      const [nowR, hourlyR, dailyR, warnR] = await Promise.allSettled([
        fetchWeather(weatherConfig),
        fetchHourlyForecast(weatherConfig),
        fetchDailyForecast(weatherConfig),
        fetchWeatherWarnings(weatherConfig),
      ]);
      if (nowR.status === 'fulfilled') {
        setData(nowR.value);
        setLastUpdatedAt(nowR.value.updatedAt);
      }
      if (hourlyR.status === 'fulfilled') setHourly(hourlyR.value);
      if (dailyR.status === 'fulfilled') {
        setDaily(dailyR.value.days);
        setDailyTotal(dailyR.value.total);
      }
      if (warnR.status === 'fulfilled') setWarnings(warnR.value);
      if (nowR.status === 'rejected') {
        setError(nowR.reason?.message || '获取实时天气失败');
      }
      const ok = nowR.status === 'fulfilled';
      if (!silent && userInitiated) showTip(ok ? 'success' : 'error');
      return ok;
    } catch (e: any) {
      setError(e?.message || '获取天气失败');
      if (!silent && userInitiated) showTip('error');
      return false;
    } finally {
      if (!silent) {
        if (userInitiated) setRefreshing(false);
        setLoading(false);
      }
    }
  };

  // 刷新反馈：短暂展示 已更新/失败 后恢复
  const showTip = (tip: 'success' | 'error') => {
    setRefreshTip(tip);
    if (tipTimerRef.current) clearTimeout(tipTimerRef.current);
    tipTimerRef.current = setTimeout(() => setRefreshTip(''), 1800);
  };

  const formatTime = (ts: number) =>
    new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

  useEffect(() => {
    if (!isConfigured) return;
    // 首次加载显示 loading 状态，后续定时刷新静默
    loadWeather(false);
    // 每 10 分钟自动静默更新
    timerRef.current = setInterval(() => loadWeather(true), 10 * 60 * 1000);
    // 页面从后台切回时立即静默刷新，保证看到最新天气
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') loadWeather(true);
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (tipTimerRef.current) clearTimeout(tipTimerRef.current);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weatherConfig.provider, weatherConfig.qweatherKey, weatherConfig.qweatherLocationId, weatherConfig.openweatherKey, weatherConfig.openweatherCity]);

  if (!isConfigured) {
    // 参考翻译/汇率卡片：居中的小字提示。内容块保持紧凑（两行），垂直水平居中于卡片中心
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-1 px-1">
        <span className="flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400 whitespace-nowrap">
          <CloudSun size={11} className="text-amber-500" /> 未配置天气 · 默认和风
        </span>
        <button
          onClick={onOpenSettings}
          className="flex items-center gap-1 px-2 py-[3px] bg-blue-600 hover:bg-blue-700 text-white text-[10px] rounded-md transition-colors"
        >
          <Settings2 size={10} /> 去配置
        </button>
      </div>
    );
  }

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="text-center py-6">
        <AlertTriangle size={28} className="mx-auto mb-2 text-red-400" />
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-3">{error}</p>
        <button
          onClick={() => loadWeather()}
          className="flex items-center gap-1.5 mx-auto px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg transition-colors"
        >
          <RefreshCw size={14} /> 重试
        </button>
      </div>
    );
  }

  if (!data) return null;

  const kind = getWxKind(data.iconCode);
  const style = KIND_STYLE[kind];
  // 风力等级（数字），用于风线动画
  const windLevel = parseInt(data.windScale || '0') || 0;

  // 卡片常驻：未来 5 天预报（含今天）
  const cardDaily = daily.slice(0, 5);
  const dailyWeekday = (date: string) => {
    const d = new Date(`${new Date().getFullYear()}-${date}T00:00:00`);
    return WEEKDAY_CN[d.getDay()];
  };

  // 实时数据项
  const realtimeItems = [
    { icon: <ThermometerSun size={13} />, label: '体感温度', value: data.feelsLike ? `${data.feelsLike}℃` : '--' },
    { icon: <Wind size={13} />, label: '风向风力', value: `${data.windDir || '--'} ${data.windScale ? data.windScale + '级' : ''}`.trim() || '--' },
    { icon: <Droplets size={13} />, label: '相对湿度', value: data.humidity ? `${data.humidity}%` : '--' },
    { icon: <Cloud size={13} />, label: '降水量', value: data.precip ? `${data.precip} mm` : '--' },
    { icon: <Eye size={13} />, label: '能见度', value: data.vis ? `${data.vis} km` : '--' },
    { icon: <Gauge size={13} />, label: '大气压强', value: data.pressure ? `${data.pressure} hPa` : '--' },
    { icon: <Cloud size={13} />, label: '云量', value: data.cloud ? `${data.cloud}%` : '--' },
    { icon: <Droplets size={13} />, label: '露点温度', value: data.dew ? `${data.dew}℃` : '--' },
  ];

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <style>{WEATHER_ANIM}</style>

      {/* ===== 常驻卡片：毛玻璃 + 动态背景 + 当前 + 未来5天（铺满卡片左右下三边） ===== */}
      {!expanded && (
        <div
          className="relative overflow-hidden text-white flex-1 flex flex-col"
          style={{ background: style.bg, backdropFilter: 'blur(12px)' }}
        >
          {/* 动态背景装饰（与天气类型对应的效果） */}
          <WxDecor kind={kind} style={style} windLevel={windLevel} />

          {/* 内容：城市+状态(左) | 温度(右)，预报(底部) —— flex 布局让预报贴底，消除底部空白 */}
          <div className="relative z-10 flex flex-col flex-1 pt-[26px] px-2.5 pb-1">
            {/* 上半：城市 + 实时天气状态 + 预警标签（左） | 温度 + 图标（右） */}
            <div className="flex items-center justify-between gap-2 flex-shrink-0">
              <div className="flex items-center gap-1.5 min-w-0 flex-1">
                {/* 地名：放大并下移（避开卡片头标题），左侧定位图标 */}
                <span className="flex items-center gap-1 text-[15px] font-semibold drop-shadow whitespace-nowrap flex-shrink-0">
                  <MapPin size={15} /> {data.location}
                </span>
                {/* 实时天气状态：紧跟在地名后（如：泰安 阴）；窄卡片时允许截断，不挤压温度 */}
                <span className="text-[11px] text-white/95 drop-shadow whitespace-nowrap truncate min-w-0">{data.text}</span>
                {warnings.length > 0 && (
                  <span className="flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded-full bg-amber-400 text-amber-900 font-medium truncate min-w-0">
                    <AlertTriangle size={9} /> {warnings[0].shortTitle}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <span className="text-2xl font-bold drop-shadow tabular-nums">{data.temp}°</span>
                <span className="text-lg drop-shadow">{data.icon}</span>
              </div>
            </div>

            {/* 下半：未来 5 天预报（mt-auto 贴底，消除卡片底部空白；grid 全宽均分 5 列，格子内居中） */}
            {cardDaily.length > 0 && (
              <div className="mt-auto pt-0.5 grid grid-cols-5 gap-0.5 flex-shrink-0">
                {cardDaily.map((d, i) => (
                  <div key={i} className="flex flex-col items-center gap-px py-0 rounded-lg overflow-hidden min-w-0">
                    <span className={`text-[10px] leading-none mb-0.5 ${i === 0 ? 'font-bold' : ''}`}>{i === 0 ? '今天' : dailyWeekday(d.date)}</span>
                    <span className="text-[11px] leading-none">{d.icon}</span>
                    <span className="text-[9px] text-white/90 tabular-nums leading-none">{d.tempMin}~{d.tempMax}°</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ===== 展开：气象中心（分栏） ===== */}
      {expanded && (
        <div className="space-y-4">
          {/* 预警横幅 */}
          {warnings.length > 0 && (
            <div className="rounded-2xl border border-amber-200 dark:border-amber-800/50 bg-amber-50 dark:bg-amber-900/20 p-3.5">
              <div className="flex items-center gap-1.5 text-sm font-semibold text-amber-800 dark:text-amber-300">
                <AlertTriangle size={15} /> {warnings[0].shortTitle}
              </div>
              <p className="mt-1 text-xs text-amber-700 dark:text-amber-400/80 leading-relaxed">
                {warnings[0].text}
              </p>
            </div>
          )}

          <div className="flex flex-col lg:flex-row gap-4">
            {/* 左：当前天气概览 */}
            <div className="lg:w-64 flex-shrink-0">
              <div
                className="relative overflow-hidden rounded-2xl text-white p-5 h-full"
                style={{ background: style.bg, backdropFilter: 'blur(12px)' }}
              >
                {/* 动态背景装饰（展开区域，元素稍密） */}
                <WxDecor kind={kind} style={style} windLevel={windLevel} dense />
                {/* 温度等概览信息：上下左右居中 */}
                <div className="relative z-10 h-full flex flex-col items-center justify-center text-center gap-1.5">
                  <div className="flex items-center gap-1 text-sm font-medium drop-shadow">
                    <MapPin size={14} /> {data.location}
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/25 backdrop-blur ml-1">
                      {weatherConfig.provider === 'qweather' ? '和风天气' : 'OpenWeather'}
                    </span>
                  </div>
                  <div className="text-6xl leading-none drop-shadow">{data.icon}</div>
                  <div className="text-5xl font-bold tabular-nums drop-shadow leading-tight">{data.temp}°C</div>
                  <div className="text-lg drop-shadow">{data.text}</div>
                  <button
                    onClick={() => loadWeather(false, true)}
                    disabled={refreshing}
                    title={lastUpdatedAt ? `上次更新 ${formatTime(lastUpdatedAt)}` : '刷新天气'}
                    className={`mt-1.5 flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg backdrop-blur transition-all duration-200 active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed ${
                      refreshTip === 'success'
                        ? 'bg-green-500/40 text-green-50'
                        : refreshTip === 'error'
                        ? 'bg-red-500/40 text-red-50'
                        : 'bg-white/20 hover:bg-white/30'
                    }`}
                  >
                    {refreshTip === 'success' ? (
                      <><Check size={12} /> 已更新</>
                    ) : refreshTip === 'error' ? (
                      <><XCircle size={12} /> 刷新失败</>
                    ) : refreshing ? (
                      <><RefreshCw size={12} className="animate-spin" /> 刷新中…</>
                    ) : (
                      <><RefreshCw size={12} /> 刷新</>
                    )}
                  </button>
                  {lastUpdatedAt > 0 && !refreshing && refreshTip === '' && (
                    <div className="mt-1 text-[9px] text-white/70">更新于 {formatTime(lastUpdatedAt)}</div>
                  )}
                </div>
              </div>
            </div>

            {/* 右：实时数据 + 逐时预报 */}
            <div className="flex-1 min-w-0 space-y-4">
              <div>
                <h4 className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">实时气象</h4>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {realtimeItems.map((item, i) => (
                    <div key={i} className="px-3 py-2.5 rounded-xl border border-slate-100 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-700/30">
                      <div className="flex items-center gap-1 text-[10px] text-slate-400">
                        <span className="text-slate-400">{item.icon}</span> {item.label}
                      </div>
                      <div className="mt-0.5 text-sm font-medium text-slate-700 dark:text-slate-200 tabular-nums">{item.value}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* 24 小时逐时 */}
              {hourly.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">逐小时预报</h4>
                  <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
                    {hourly.map((h, i) => (
                      <div key={i} className="flex-shrink-0 flex flex-col items-center gap-1 px-3 py-2 rounded-xl border border-slate-100 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-700/30">
                        <span className="text-[10px] text-slate-400">{h.time}</span>
                        <span className="text-lg">{h.icon}</span>
                        <span className="text-xs font-medium text-slate-700 dark:text-slate-200 tabular-nums">{h.temp}°</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* 多日预报 */}
          {daily.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs font-semibold text-slate-500 dark:text-slate-400">天气预报</h4>
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-400">
                  {dailyTotal} 天预报{dailyTotal < 15 ? '（更多天数需和风付费订阅）' : ''}
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
                {daily.map((d, i) => (
                  <div key={i} className={`px-3 py-2.5 rounded-xl border ${i === 0 ? 'bg-blue-50 dark:bg-blue-900/30 border-blue-200 dark:border-blue-800' : 'bg-slate-50 dark:bg-slate-700/40 border-slate-100 dark:border-slate-600'}`}>
                    <div className="flex items-center justify-between">
                      <span className={`text-xs font-medium ${i === 0 ? 'text-blue-600 dark:text-blue-300' : 'text-slate-600 dark:text-slate-300'}`}>
                        {i === 0 ? '今天' : dailyWeekday(d.date)}
                      </span>
                      <span className="text-[10px] text-slate-400">{d.date}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-1.5">
                      <span className="text-xl">{d.icon}</span>
                      <span className="text-[10px] text-slate-500 dark:text-slate-400 truncate">{d.text}</span>
                    </div>
                    <div className="mt-1 text-xs text-slate-600 dark:text-slate-300 tabular-nums">
                      <span className="text-red-500 font-medium">{d.tempMax}°</span>
                      <span className="text-slate-400 mx-1">/</span>
                      <span className="text-blue-500">{d.tempMin}°</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {error && (
            <p className="text-xs text-amber-500 flex items-center gap-1">
              <AlertTriangle size={12} /> {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export default WeatherTool;
