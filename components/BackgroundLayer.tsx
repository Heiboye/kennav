import React, { useEffect, useState } from 'react';
import { BackgroundConfig } from '../types';

interface BackgroundLayerProps {
  config: BackgroundConfig;
  darkMode: boolean;
  syncSignal?: number; // 手动同步信号：变化时清缓存重新拉取
}

const BING_RES_LABEL: Record<string, string> = {
  '4k': '4k',
  '1080p': '1080p',
  'mobile': 'mobile',
};

// 兜底配置：config 缺失/损坏时使用（enabled=false 不渲染，保证永不崩溃白屏）
const DEFAULT_BG: BackgroundConfig = {
  enabled: false,
  type: 'bing',
  bingResolution: '4k',
  customUrl: '',
  solidColor: '#1e293b',
  overlayOpacity: 0.35,
  dailySync: true,
  imageOpacity: 1,
};

/**
 * 全局背景层（fixed 底部，不挡交互）
 * - Bing：每日壁纸（后端代理 + KV 当日缓存，前端 localStorage 二次缓存）
 * - 自定义：用户图片 URL
 * - 纯色：单色背景
 * 叠加半透明遮罩保证内容文字可读性
 */
const BackgroundLayer: React.FC<BackgroundLayerProps> = ({ config, darkMode, syncSignal = 0 }) => {
  // 防御：config 缺失/为 null/损坏时使用默认配置（enabled=false → 不渲染）
  const cfg = config && typeof config === 'object' ? { ...DEFAULT_BG, ...config } : DEFAULT_BG;

  const [bingUrl, setBingUrl] = useState('');
  const [imgLoaded, setImgLoaded] = useState(false);

  // 加载 Bing 当日壁纸（localStorage 缓存 → 后端代理）
  // dailySync=true：缓存带日期，每天自动换最新；dailySync=false：固定缓存，仅手动同步更新
  useEffect(() => {
    if (!cfg.enabled || cfg.type !== 'bing') return;
    const res = BING_RES_LABEL[cfg.bingResolution] || '4k';
    const dateKey = new Date().toISOString().slice(0, 10);
    const cacheKey = cfg.dailySync
      ? `cloudnav_bing_wallpaper_${res}_${dateKey}`
      : `cloudnav_bing_wallpaper_${res}_fixed`;

    // 1. localStorage 命中（手动同步信号变化时缓存已被清空，走 fetch）
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      setBingUrl(cached);
      setImgLoaded(false);
      return;
    }
    // 2. 请求后端代理
    let cancelled = false;
    fetch(`/api/bing-wallpaper?resolution=${res}`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('壁纸服务不可用'))))
      .then((data: { url?: string }) => {
        if (cancelled || !data.url) return;
        try { localStorage.setItem(cacheKey, data.url); } catch (e) { /* 忽略存储失败 */ }
        setBingUrl(data.url);
        setImgLoaded(false);
      })
      .catch(() => { /* 静默失败，保留默认背景 */ });
    return () => { cancelled = true; };
  }, [cfg.enabled, cfg.type, cfg.bingResolution, cfg.dailySync, syncSignal]);

  // 预加载背景图，加载完成后淡入（避免背景闪烁）
  const bgUrl = cfg.type === 'bing' ? bingUrl : cfg.customUrl;
  useEffect(() => {
    if (!bgUrl) { setImgLoaded(false); return; }
    const img = new Image();
    img.onload = () => setImgLoaded(true);
    img.src = bgUrl;
  }, [bgUrl]);

  if (!cfg.enabled) return null;

  // 纯色模式
  if (cfg.type === 'solid') {
    return (
      <div
        aria-hidden="true"
        className="fixed inset-0 -z-10"
        style={{ backgroundColor: cfg.solidColor || '#1e293b' }}
      />
    );
  }

  // 图片模式（Bing / 自定义）
  const overlay = Math.min(0.7, Math.max(0, cfg.overlayOpacity ?? 0.35));
  const imgOpacity = Math.min(1, Math.max(0.3, cfg.imageOpacity ?? 1));

  return (
    <div aria-hidden="true" className="fixed inset-0 -z-10 overflow-hidden">
      {bgUrl ? (
        <div
          className="absolute inset-0 bg-cover bg-center transition-opacity duration-700"
          style={{
            backgroundImage: `url(${bgUrl})`,
            opacity: imgLoaded ? imgOpacity : 0,
          }}
        />
      ) : null}
      {/* 加载中占位（纯色渐隐，避免白屏闪烁） */}
      {!imgLoaded && bgUrl && (
        <div
          className="absolute inset-0 transition-opacity duration-700"
          style={{ backgroundColor: darkMode ? '#0f172a' : '#e2e8f0' }}
        />
      )}
      {/* 遮罩层：保证内容对比度 */}
      <div
        className="absolute inset-0"
        style={{
          background: darkMode
            ? `rgba(15,23,42,${overlay})`
            : `linear-gradient(rgba(255,255,255,${overlay * 0.6}), rgba(15,23,42,${overlay * 0.35}))`,
        }}
      />
    </div>
  );
};

export default BackgroundLayer;
