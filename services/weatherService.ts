import { ToolsConfig } from '../types';

export interface WeatherData {
  location: string;       // 城市名
  temp: string;           // 温度（℃）
  text: string;           // 天气描述
  icon: string;           // emoji 图标
  iconCode: string;       // 原始天气代码（用于判断昼夜/天气类型）
  feelsLike?: string;     // 体感温度
  humidity?: string;      // 湿度 %
  windDir?: string;       // 风向
  windScale?: string;     // 风力等级（和风）
  windSpeed?: string;     // 风速
  precip?: string;        // 降水量 mm
  pressure?: string;      // 大气压强 hPa
  vis?: string;           // 能见度 km
  cloud?: string;         // 云量 %
  dew?: string;           // 露点温度 ℃
  updatedAt: number;
}

export interface WeatherWarning {
  title: string;   // 预警标题
  shortTitle: string; // 简短预警名（如：雷电预警）
  text: string;    // 预警详情
  type: string;    // 预警类型
  level: string;   // 预警等级
}

export interface HourlyForecast {
  time: string;    // 时间 HH:mm
  temp: string;    // 温度
  icon: string;    // emoji
  text: string;
}

export interface DailyForecast {
  date: string;       // 日期 MM-DD
  weekday: string;    // 星期
  tempMax: string;
  tempMin: string;
  icon: string;       // emoji
  text: string;
}

// 和风天气 weather icon code → emoji
const QWEATHER_ICONS: Record<string, string> = {
  '100': '☀️', '101': '🌤️', '102': '⛅', '103': '☁️', '104': '☁️',
  '150': '🌙', '151': '🌤️', '152': '⛅', '153': '☁️',
  '300': '🌧️', '301': '🌧️', '302': '🌧️', '303': '🌧️', '304': '🌧️',
  '305': '🌦️', '306': '🌧️', '307': '🌧️', '308': '🌧️', '309': '🌧️',
  '310': '🌧️', '311': '🌧️', '312': '🌧️', '313': '🌧️', '314': '🌧️', '315': '🌧️',
  '316': '🌧️', '317': '🌧️', '318': '🌧️', '399': '🌧️',
  '400': '🌨️', '401': '🌨️', '402': '❄️', '403': '🌨️', '404': '🌨️',
  '405': '🌨️', '406': '🌨️', '407': '🌨️', '408': '❄️', '409': '❄️',
  '410': '❄️', '499': '❄️',
  '500': '🌫️', '501': '🌫️', '502': '🌫️', '503': '🌫️', '504': '🌫️', '507': '🌫️', '508': '🌫️',
  '509': '🌫️', '510': '🌫️', '511': '🌫️', '512': '🌫️', '513': '🌫️', '514': '🌫️', '515': '🌫️',
  '900': '🌫️',
};

// OpenWeather icon code → emoji
const OPENWEATHER_ICONS: Record<string, string> = {
  '01d': '☀️', '01n': '🌙', '02d': '🌤️', '02n': '🌤️', '03d': '☁️', '03n': '☁️',
  '04d': '☁️', '04n': '☁️', '09d': '🌧️', '09n': '🌧️', '10d': '🌦️', '10n': '🌦️',
  '11d': '⛈️', '11n': '⛈️', '13d': '🌨️', '13n': '🌨️', '50d': '🌫️', '50n': '🌫️',
};

/**
 * 获取和风天气 API Host（去掉尾部斜杠）
 */
const getQweatherHost = (config: ToolsConfig['weather']): string => {
  return (config.qweatherHost || 'https://devapi.qweather.com').replace(/\/$/, '');
};

/**
 * 和风天气（QWeather）实时天气
 * 文档: https://dev.qweather.com/docs/api/weather/weather-now/
 */
const fetchQWeatherNow = async (key: string, locationId: string, host: string): Promise<WeatherData> => {
  const url = `${host}/v7/weather/now?location=${encodeURIComponent(locationId)}&key=${encodeURIComponent(key)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`和风天气请求失败 (HTTP ${res.status})`);
  const data = await res.json();
  if (data.code !== '200') {
    throw new Error(`和风天气错误码: ${data.code}`);
  }
  const now = data.now;
  if (!now) throw new Error('和风天气: 无数据');

  // 通过 GeoAPI 反查城市名（LocationID 是代码，不是地名）
  let locationName = locationId;
  try {
    const geoUrl = `${host}/geo/v2/city/lookup?location=${encodeURIComponent(locationId)}&key=${encodeURIComponent(key)}`;
    const geoRes = await fetch(geoUrl);
    if (geoRes.ok) {
      const geoData = await geoRes.json();
      if (geoData.code === '200' && geoData.location && geoData.location.length > 0) {
        locationName = geoData.location[0].name || locationId;
      }
    }
  } catch {
    // GeoAPI 失败时回退显示 LocationID
  }

  return {
    location: locationName,
    temp: now.temp,
    text: now.text,
    icon: QWEATHER_ICONS[now.icon] || '🌡️',
    iconCode: now.icon,
    feelsLike: now.feelsLike,
    humidity: now.humidity,
    windDir: now.windDir,
    windScale: now.windScale,
    windSpeed: now.windSpeed,
    precip: now.precip,
    pressure: now.pressure,
    vis: now.vis,
    cloud: now.cloud,
    dew: now.dew,
    updatedAt: Date.now(),
  };
};

/**
 * OpenWeatherMap 实时天气
 * 文档: https://openweathermap.org/current
 */
const fetchOpenWeatherNow = async (key: string, city: string): Promise<WeatherData> => {
  const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&appid=${encodeURIComponent(key)}&units=metric&lang=zh_cn`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`OpenWeather 请求失败 (HTTP ${res.status})`);
  const data = await res.json();
  if (data.cod !== 200) {
    throw new Error(`OpenWeather 错误: ${data.message || data.cod}`);
  }
  return {
    location: data.name || city,
    temp: Math.round(data.main.temp).toString(),
    text: data.weather?.[0]?.description || '未知',
    icon: OPENWEATHER_ICONS[data.weather?.[0]?.icon] || '🌡️',
    iconCode: data.weather?.[0]?.icon || '',
    feelsLike: Math.round(data.main.feels_like).toString(),
    humidity: data.main.humidity?.toString(),
    windDir: data.wind?.deg !== undefined ? `${data.wind.deg}°` : undefined,
    windSpeed: data.wind?.speed ? data.wind.speed.toFixed(1) : undefined,
    updatedAt: Date.now(),
  };
};

/**
 * 获取当前天气（按配置的 provider）
 */
export const fetchWeather = async (config: ToolsConfig['weather']): Promise<WeatherData> => {
  if (config.provider === 'qweather') {
    if (!config.qweatherKey || !config.qweatherLocationId) {
      throw new Error('请先在「工具设置」中配置和风天气 Key 与 LocationID');
    }
    return fetchQWeatherNow(config.qweatherKey, config.qweatherLocationId, getQweatherHost(config));
  }
  if (!config.openweatherKey || !config.openweatherCity) {
    throw new Error('请先在「工具设置」中配置 OpenWeatherMap Key 与城市名');
  }
  return fetchOpenWeatherNow(config.openweatherKey, config.openweatherCity);
};

/**
 * 24 小时逐时预报（和风免费；OpenWeather 用 5天/3小时 的前 24 小时）
 */
export const fetchHourlyForecast = async (config: ToolsConfig['weather']): Promise<HourlyForecast[]> => {
  if (config.provider === 'qweather') {
    if (!config.qweatherKey || !config.qweatherLocationId) return [];
    const host = getQweatherHost(config);
    const url = `${host}/v7/weather/24h?location=${encodeURIComponent(config.qweatherLocationId)}&key=${encodeURIComponent(config.qweatherKey)}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    if (data.code !== '200' || !data.hourly) return [];
    return data.hourly.map((h: any) => ({
      time: (h.fxTime || '').slice(11, 16),
      temp: h.temp,
      icon: QWEATHER_ICONS[h.icon] || '🌡️',
      text: h.text,
    }));
  }
  // OpenWeather：5天/3小时预报
  if (!config.openweatherKey || !config.openweatherCity) return [];
  const url = `https://api.openweathermap.org/data/2.5/forecast?q=${encodeURIComponent(config.openweatherCity)}&appid=${encodeURIComponent(config.openweatherKey)}&units=metric&lang=zh_cn`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = await res.json();
  if (data.cod !== '200' || !data.list) return [];
  return data.list.slice(0, 8).map((h: any) => ({
    time: new Date(h.dt * 1000).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }),
    temp: Math.round(h.main.temp).toString(),
    icon: OPENWEATHER_ICONS[h.weather?.[0]?.icon] || '🌡️',
    text: h.weather?.[0]?.description || '',
  }));
};

/**
 * 多日预报：
 * - 和风：优先请求 15 天（需付费订阅），失败/无权限时自动降级为 3 天（免费）
 * - OpenWeather：免费 5 天（3 小时粒度按天聚合取当日最高/最低）
 */
export const fetchDailyForecast = async (config: ToolsConfig['weather']): Promise<{ days: DailyForecast[]; total: number }> => {
  const weekday = (dateStr: string) => {
    const d = new Date(dateStr + 'T00:00:00');
    return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()];
  };

  if (config.provider === 'qweather') {
    if (!config.qweatherKey || !config.qweatherLocationId) return { days: [], total: 0 };
    const host = getQweatherHost(config);
    // 先尝试 15 天（付费）
    const url15 = `${host}/v7/weather/15d?location=${encodeURIComponent(config.qweatherLocationId)}&key=${encodeURIComponent(config.qweatherKey)}`;
    let data: any = null;
    try {
      const res = await fetch(url15);
      if (res.ok) {
        const json = await res.json();
        // code 200 = 成功；402/403 等 = 无权限，降级
        if (json.code === '200' && json.daily) data = json;
      }
    } catch { /* 降级 */ }

    if (!data) {
      const url3 = `${host}/v7/weather/3d?location=${encodeURIComponent(config.qweatherLocationId)}&key=${encodeURIComponent(config.qweatherKey)}`;
      const res = await fetch(url3);
      if (!res.ok) return { days: [], total: 0 };
      const json = await res.json();
      if (json.code !== '200' || !json.daily) return { days: [], total: 0 };
      data = json;
    }

    const total = data.daily.length;
    const days = data.daily.map((d: any) => ({
      date: (d.fxDate || '').slice(5),
      weekday: weekday(d.fxDate),
      tempMax: d.tempMax,
      tempMin: d.tempMin,
      icon: QWEATHER_ICONS[d.iconDay] || '🌡️',
      text: d.textDay,
    }));
    return { days, total };
  }

  // OpenWeather：5天/3小时预报 → 按天聚合
  if (!config.openweatherKey || !config.openweatherCity) return { days: [], total: 0 };
  const url = `https://api.openweathermap.org/data/2.5/forecast?q=${encodeURIComponent(config.openweatherCity)}&appid=${encodeURIComponent(config.openweatherKey)}&units=metric&lang=zh_cn`;
  const res = await fetch(url);
  if (!res.ok) return { days: [], total: 0 };
  const data = await res.json();
  if (data.cod !== '200' || !data.list) return { days: [], total: 0 };

  const byDay = new Map<string, { max: number; min: number; icon: string; text: string }>();
  for (const item of data.list) {
    const d = new Date(item.dt * 1000);
    // 用本地时区日期分组，避免 UTC 偏移导致日期错位
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const temp = item.main.temp;
    const existing = byDay.get(key);
    if (!existing) {
      byDay.set(key, {
        max: temp, min: temp,
        icon: OPENWEATHER_ICONS[item.weather?.[0]?.icon] || '🌡️',
        text: item.weather?.[0]?.description || '',
      });
    } else {
      existing.max = Math.max(existing.max, temp);
      existing.min = Math.min(existing.min, temp);
    }
  }
  const days = Array.from(byDay.entries()).map(([date, v]) => ({
    date: date.slice(5),
    weekday: weekday(date),
    tempMax: Math.round(v.max).toString(),
    tempMin: Math.round(v.min).toString(),
    icon: v.icon,
    text: v.text,
  }));
  return { days, total: days.length };
};

/**
 * 气象预警（和风天气；OpenWeather 不支持）
 */
export const fetchWeatherWarnings = async (config: ToolsConfig['weather']): Promise<WeatherWarning[]> => {
  if (config.provider !== 'qweather' || !config.qweatherKey || !config.qweatherLocationId) {
    return [];
  }
  try {
    const host = getQweatherHost(config);
    const url = `${host}/v7/warning/now?location=${encodeURIComponent(config.qweatherLocationId)}&key=${encodeURIComponent(config.qweatherKey)}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    if (data.code !== '200' || !data.warning) return [];
    return data.warning.map((w: any) => {
      const title = w.title || '';
      // 提取简短预警名：如「泰安市气象台...发布雷电黄色预警信号」→「雷电预警」
      // 优先用和风 typeName（如：雷电/暴雨/大风）
      let shortTitle = w.typeName ? w.typeName + '预警' : '';
      // 否则从标题提取：优先「发布XX预警」模式
      if (!shortTitle) {
        const m1 = title.match(/发布([\u4e00-\u9fa5]{2,6}?)(?:黄色|橙色|红色|蓝色)?预警/);
        if (m1) shortTitle = m1[1] + '预警';
      }
      // 兜底：任意「XX预警」
      if (!shortTitle) {
        const m2 = title.match(/([\u4e00-\u9fa5]{2,6}?)(?:黄色|橙色|红色|蓝色)?预警/);
        if (m2) shortTitle = m2[1] + '预警';
      }
      shortTitle = shortTitle || '天气预警';
      return {
        title,
        shortTitle,
        text: w.text || '',
        type: w.type || '',
        level: w.level || '',
      };
    });
  } catch {
    return [];
  }
};

// 判断天气是否已配置（供 WeatherTool / ToolsPanel 复用：决定卡片头配色与是否加载数据）
export const isWeatherConfigured = (config: ToolsConfig['weather']) =>
  config.provider === 'qweather'
    ? !!(config.qweatherKey && config.qweatherLocationId)
    : !!(config.openweatherKey && config.openweatherCity);
