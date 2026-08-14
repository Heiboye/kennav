import React, { useState, useEffect } from 'react';
import { 
  Wrench, Settings2, ChevronDown, ArrowRightLeft, KeyRound, RefreshCw
} from 'lucide-react';
import { ToolsConfig, AIConfig } from '../types';
import { TOOL_MODULES, resolveModules } from './tools/registry';
import CalendarTool from './tools/CalendarTool';
import WorldClockTool from './tools/WorldClockTool';
import TranslateTool from './tools/TranslateTool';
import WeatherTool from './tools/WeatherTool';
import { isWeatherConfigured } from '../services/weatherService';
import CurrencyTool from './tools/CurrencyTool';
import { fetchUsdRates, convertCurrency } from '../services/exchangeRateService';

interface ToolsPanelProps {
  toolsConfig: ToolsConfig;
  authToken: string | null;
  aiConfig: AIConfig;
  onSaveConfig: (config: ToolsConfig) => void;
  onOpenSettings?: () => void; // 打开「工具设置」tab
  onOpenAISettings?: () => void; // 打开「AI 设置」tab
}

type ToolTabId = 'weather' | 'calendar' | 'clock' | 'translate' | 'currency';
// 语言代码 → 中文标签
const LANG_LABELS: Record<string, string> = {
  'zh-CN': '中文', 'en': 'English', 'ja': '日本語', 'ko': '한국어',
  'fr': 'Français', 'de': 'Deutsch', 'es': 'Español', 'ru': 'Русский',
};

// 卡片动画样式
const CARD_ANIM = `
@keyframes toolsFadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
.tools-expand { animation: toolsFadeIn 0.35s ease both; }
@keyframes toolsCardIn { from { opacity: 0; transform: translateY(14px) scale(0.97); } to { opacity: 1; transform: translateY(0) scale(1); } }
.tools-card-enter { animation: toolsCardIn 0.4s cubic-bezier(0.22, 1, 0.36, 1) both; }
@keyframes toolsIconPop { 0% { transform: scale(1) rotate(0deg); } 50% { transform: scale(1.25) rotate(-8deg); } 100% { transform: scale(1) rotate(0deg); } }
.tools-icon-pop { animation: toolsIconPop 0.45s ease; }
@keyframes toolsPulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
.tools-pulse { animation: toolsPulse 2s ease-in-out infinite; }
.tools-card { transition: transform 0.3s cubic-bezier(0.22, 1, 0.36, 1), box-shadow 0.3s ease, border-color 0.3s ease; }
.tools-card:hover { transform: translateY(-3px); box-shadow: 0 10px 24px -8px rgba(59, 130, 246, 0.28); }
.tools-arrow { transition: transform 0.3s cubic-bezier(0.22, 1, 0.36, 1); }
.tools-arrow.rotated { transform: rotate(180deg); }
`;

const ToolsPanel: React.FC<ToolsPanelProps> = ({ toolsConfig, authToken, aiConfig, onSaveConfig, onOpenSettings, onOpenAISettings }) => {
  const [expandedTool, setExpandedTool] = useState<ToolTabId | null>(null);

  // 翻译/汇率卡片预览数据
  const [fxPreview, setFxPreview] = useState<{ from: string; to: string; rate: number } | null>(null);

  // 汇率预览
  useEffect(() => {
    if (!toolsConfig.currency.apiKey) return;
    let cancelled = false;
    fetchUsdRates(toolsConfig.currency.apiKey).then(rates => {
      if (cancelled) return;
      const from = toolsConfig.currency.baseCurrency || 'CNY';
      const to = toolsConfig.currency.favorites.find(c => c !== from) || 'USD';
      const rate = convertCurrency(rates, 1, from, to);
      if (!isNaN(rate)) setFxPreview({ from, to, rate });
    }).catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toolsConfig.currency.apiKey, toolsConfig.currency.baseCurrency]);

  // 展开 / 收起
  const toggleTool = (id: ToolTabId) => {
    setExpandedTool(prev => prev === id ? null : id);
  };

  // 按用户配置（启停 + 排序）生成卡片列表
  const moduleConfigs = resolveModules(toolsConfig.modules);
  // 天气卡片有动画背景（已配置）时才使用白字卡片头，否则与其他卡片配色一致
  const weatherHasBackdrop = isWeatherConfigured(toolsConfig.weather);
  const cards = moduleConfigs
    .filter(m => m.enabled)
    .map(m => {
      const def = TOOL_MODULES.find(t => t.id === m.id);
      if (!def) return null;
      return { id: m.id as ToolTabId, label: def.label, icon: def.icon };
    })
    .filter(Boolean) as { id: ToolTabId; label: string; icon: React.ComponentType<{ size?: number; className?: string }> }[];

  return (
    <section>
      <style>{CARD_ANIM}</style>

      {/* 面板标题 */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Wrench size={16} className="text-blue-500" />
          <h2 className="text-sm font-bold text-slate-600 dark:text-slate-300">实用工具</h2>
          {!authToken && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
              未登录，部分工具不可用
            </span>
          )}
        </div>
        <button
          onClick={onOpenSettings}
          className="flex items-center gap-1 p-1.5 text-slate-400 hover:text-blue-500 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
          title="工具设置"
        >
          <Settings2 size={15} />
        </button>
      </div>

      {/* 卡片网格（固定布局，点击不移动卡片） */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
        {cards.map((card, cardIndex) => {
          const isExpanded = expandedTool === card.id;
          return (
            <div
              key={card.id}
              onClick={() => toggleTool(card.id)}
              style={{ animationDelay: `${cardIndex * 0.06}s` }}
              className={`${
                card.id === 'weather'
                  ? 'group bg-white/75 dark:bg-slate-800/75 backdrop-blur-md relative overflow-hidden flex flex-col'
                  : 'group bg-white/75 dark:bg-slate-800/75 backdrop-blur-md'
              } rounded-[15px] border shadow-sm overflow-hidden flex flex-col tools-card tools-card-enter ${
                isExpanded
                  ? 'border-blue-400 dark:border-blue-500 ring-2 ring-blue-400/40 cursor-pointer'
                  : 'border-slate-200 dark:border-slate-700 cursor-pointer hover:border-blue-300 dark:hover:border-blue-700'
              }`}
            >
              {/* 卡片头（点击由整个卡片处理；天气卡片融入背景：透明底+白字，z-10 浮于天气动画层之上） */}
              <div className={`w-full flex items-center justify-between px-3 ${card.id === 'weather' && weatherHasBackdrop ? 'relative z-10 py-1' : 'py-1.5'}`}>
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className={`p-1 rounded-lg transition-all duration-300 ${card.id === 'weather' && weatherHasBackdrop ? 'bg-white/25 text-white backdrop-blur-sm' : isExpanded ? 'group-hover:scale-110 bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-300' : 'group-hover:scale-110 bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300'}`}>
                    <card.icon size={14} />
                  </span>
                  <span className={`text-[13px] font-medium whitespace-nowrap ${card.id === 'weather' && weatherHasBackdrop ? 'text-white drop-shadow' : 'text-slate-700 dark:text-slate-200'}`}>{card.label}</span>
                  {isExpanded && (
                    <span className="text-[9px] px-1 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-300">展开中</span>
                  )}
                </div>
                <ChevronDown size={14} className={`flex-shrink-0 tools-arrow ${isExpanded ? 'rotated' : ''} ${card.id === 'weather' && weatherHasBackdrop ? 'text-white/80 drop-shadow' : 'text-slate-400'}`} />
              </div>

              {/* 卡片主体（始终显示常驻内容；天气卡片绝对定位铺满整卡，动画覆盖全卡） */}
              <div className={`flex flex-col ${card.id === 'weather' ? 'absolute inset-0' : 'flex-1 px-3 pb-2'}`}>
                {/* 天气/日历/世界时间：常驻组件 */}
                {card.id === 'weather' && (
                  <WeatherTool
                    weatherConfig={toolsConfig.weather}
                    onOpenSettings={onOpenSettings}
                    expanded={false}
                  />
                )}
                {card.id === 'calendar' && (
                  <CalendarTool expanded={false} />
                )}
                {card.id === 'clock' && (
                  <WorldClockTool
                    cities={toolsConfig.worldClock.cities}
                    editable={!!authToken}
                    expanded={false}
                    onChange={(cities) => {
                      onSaveConfig({ ...toolsConfig, worldClock: { cities } });
                    }}
                  />
                )}

                {/* 翻译/汇率：卡片上显示预览 */}
                {card.id === 'translate' && (
                  <div className="mt-auto flex-1 flex flex-col items-center justify-center gap-1 py-1 min-h-[44px]">
                    {aiConfig.apiKey ? (
                      <>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium text-slate-600 dark:text-slate-300">原文</span>
                          <ArrowRightLeft size={13} className="text-blue-500" />
                          <span className="text-xs font-semibold text-blue-600 dark:text-blue-400">
                            {LANG_LABELS[toolsConfig.translate.targetLang] || toolsConfig.translate.targetLang}
                          </span>
                        </div>
                        <span className="text-[10px] text-slate-400">点击展开 · 流式翻译</span>
                      </>
                    ) : (
                      <div className="flex flex-col items-center gap-1.5">
                        <span className="flex items-center gap-1 text-[11px] text-slate-400">
                          <KeyRound size={11} className="text-amber-500" /> 未配置 AI
                        </span>
                        <span className="text-[10px] text-slate-400">点击配置后使用翻译</span>
                      </div>
                    )}
                  </div>
                )}
                {card.id === 'currency' && (
                  <div className="mt-auto flex-1 flex flex-col items-center justify-center gap-1 py-1 min-h-[44px]">
                    {fxPreview ? (
                      <>
                        <div className="text-[13px] font-semibold text-slate-700 dark:text-slate-200 tabular-nums">
                          1 {fxPreview.from} ≈ <span className="text-blue-600 dark:text-blue-400">{fxPreview.rate.toFixed(4)} {fxPreview.to}</span>
                        </div>
                        <div className="text-[10px] text-slate-400 tabular-nums">
                          1 {fxPreview.to} ≈ {(1 / fxPreview.rate).toFixed(4)} {fxPreview.from}
                        </div>
                        <div className="flex items-center gap-1 text-[9px] text-slate-400">
                          <RefreshCw size={9} /> 汇率自动更新
                        </div>
                      </>
                    ) : (
                      <div className="flex flex-col items-center gap-1.5">
                        <span className="flex items-center gap-1 text-[11px] text-slate-400">
                          <KeyRound size={11} className="text-amber-500" /> 未配置汇率
                        </span>
                        <span className="text-[10px] text-slate-400">{toolsConfig.currency.apiKey ? '加载中...' : '点击配置后使用'}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* 手风琴展开区：容器常驻渲染，grid-template-rows 0fr→1fr 实现平滑开合；点击其他卡片自动切换 */}
      <div
        className="tools-expand"
        style={{
          display: 'grid',
          gridTemplateRows: expandedTool ? '1fr' : '0fr',
          transition: 'grid-template-rows 0.45s cubic-bezier(0.22, 1, 0.36, 1)',
        }}
      >
        <div style={{ overflow: 'hidden', minHeight: 0 }}>
          {expandedTool && (() => {
            const expandedCard = cards.find(c => c.id === expandedTool);
            if (!expandedCard) return null;
            return (
              <div className="mt-3 bg-white/75 dark:bg-slate-800/75 backdrop-blur-md rounded-[15px] border border-blue-200 dark:border-blue-800/60 shadow-lg overflow-hidden">
                {/* 手风琴头部：简洁收起按钮（点击卡片区域也可收起） */}
                <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-100 dark:border-slate-700">
                  <div className="flex items-center gap-2">
                    <span className="p-1.5 rounded-lg bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-300">
                      <expandedCard.icon size={15} />
                    </span>
                    <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">{expandedCard.label}</span>
                  </div>
                  <button
                    onClick={() => setExpandedTool(null)}
                    className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
                    title="收起"
                  >
                    <ChevronDown size={15} className="rotate-180" />
                  </button>
                </div>

                {/* 展开内容 */}
                <div className="p-4" onClick={(e) => e.stopPropagation()}>
                  {expandedTool === 'weather' && (
                    <WeatherTool
                      weatherConfig={toolsConfig.weather}
                      onOpenSettings={onOpenSettings}
                      expanded={true}
                    />
                  )}
                  {expandedTool === 'calendar' && (
                    <CalendarTool expanded={true} />
                  )}
                  {expandedTool === 'clock' && (
                    <WorldClockTool
                      cities={toolsConfig.worldClock.cities}
                      editable={!!authToken}
                      expanded={true}
                      onChange={(cities) => {
                        onSaveConfig({ ...toolsConfig, worldClock: { cities } });
                      }}
                    />
                  )}
                  {expandedTool === 'translate' && (
                    <TranslateTool
                      aiConfig={aiConfig}
                      translateConfig={toolsConfig.translate}
                      onOpenSettings={onOpenAISettings}
                    />
                  )}
                  {expandedTool === 'currency' && (
                    <CurrencyTool
                      currencyConfig={toolsConfig.currency}
                      onOpenSettings={onOpenSettings}
                    />
                  )}
                </div>
              </div>
            );
          })()}
        </div>
      </div>
    </section>
  );
};

export default ToolsPanel;
