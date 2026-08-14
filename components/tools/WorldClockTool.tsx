import React, { useEffect, useState } from 'react';
import { MapPin, Plus, Trash2 } from 'lucide-react';
import { WorldClockCity } from '../../types';
import AnalogClock from './AnalogClock';

interface WorldClockToolProps {
  cities: WorldClockCity[];
  onChange: (cities: WorldClockCity[]) => void;
  editable: boolean; // 是否登录可编辑
  expanded?: boolean;
}

const WorldClockTool: React.FC<WorldClockToolProps> = ({ cities, onChange, editable, expanded = false }) => {
  const [now, setNow] = useState(new Date());
  const [adding, setAdding] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newTz, setNewTz] = useState('');

  // 每秒刷新时间（驱动指针随动）
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const formatTime = (timezone: string) => {
    try {
      return new Intl.DateTimeFormat('zh-CN', {
        timeZone: timezone,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }).format(now);
    } catch {
      return '--:--:--';
    }
  };

  const formatDate = (timezone: string) => {
    try {
      return new Intl.DateTimeFormat('zh-CN', {
        timeZone: timezone,
        month: 'numeric',
        day: 'numeric',
        weekday: 'short',
      }).format(now);
    } catch {
      return '';
    }
  };

  const isValidTz = (timezone: string) => {
    try {
      new Intl.DateTimeFormat('zh-CN', { timeZone: timezone });
      return true;
    } catch {
      return false;
    }
  };

  const handleAdd = () => {
    if (!newLabel.trim() || !newTz.trim()) return;
    onChange([...cities, { label: newLabel.trim(), timezone: newTz.trim() }]);
    setNewLabel('');
    setNewTz('');
    setAdding(false);
  };

  if (cities.length === 0) {
    return (
      <div className="text-center py-6 text-sm text-slate-500 dark:text-slate-400">
        暂无城市，请添加一个城市时区
        {editable && (
          <div className="mt-3">
            <button
              onClick={() => setAdding(true)}
              className="flex items-center gap-1.5 mx-auto px-3 py-1.5 text-xs font-medium text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800/50 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
            >
              <Plus size={14} /> 添加城市
            </button>
          </div>
        )}
      </div>
    );
  }

  // 卡片常驻模式：3 个时钟 UI 横排，每个下方对应城市名 + 数字时间
  if (!expanded) {
    const previewCities = cities.slice(0, 3);
    return (
      <div className="flex items-stretch justify-between gap-0.5 px-0.5 py-0 flex-1 min-h-0">
        {previewCities.map((city, i) => {
          const valid = isValidTz(city.timezone);
          const timeParts = valid ? formatTime(city.timezone).split(':') : ['--', '--', '--'];
          return (
            <div key={i} className="flex flex-col items-center justify-center gap-0.5 flex-1 min-w-0 overflow-hidden">
              {/* 窄屏（<390px）隐藏表盘：列宽不足时时间数字会相互重叠 */}
              <div className="hidden min-[390px]:block">
                <AnalogClock date={now} timezone={city.timezone} size={30} />
              </div>
              <span className="text-[10px] leading-none font-medium text-slate-600 dark:text-slate-300 truncate max-w-full">
                {city.label || city.timezone}
              </span>
              <span className={`font-mono text-[9px] min-[390px]:text-[10px] leading-none tabular-nums whitespace-nowrap ${valid ? 'text-slate-700 dark:text-slate-200' : 'text-red-400'}`}>
                {timeParts[0]}:{timeParts[1]}
                {/* 窄屏隐藏秒：列宽不足以容纳 HH:mm:ss 时会溢出重叠 */}
                <span className="hidden min-[390px]:inline">:{timeParts[2]}</span>
              </span>
            </div>
          );
        })}
        {cities.length === 0 && (
          <div className="flex-1 text-center text-xs text-slate-400">暂无城市</div>
        )}
        {cities.length > 3 && (
          <div className="hidden min-[390px]:block self-center text-[10px] text-slate-400 font-medium whitespace-nowrap flex-shrink-0">
            +{cities.length - 3}
          </div>
        )}
      </div>
    );
  }

  // 主城市（第一个）用大钟表，其余用小钟表
  const [primary, ...rest] = cities;
  const primaryValid = isValidTz(primary.timezone);

  return (
    <div>
      {/* 主城市：大钟表 + 数字时间 */}
      <div className="flex flex-col sm:flex-row items-center gap-4 px-3 py-3 rounded-2xl bg-gradient-to-br from-blue-50/80 to-slate-50 dark:from-slate-700/40 dark:to-slate-800/60 border border-slate-100 dark:border-slate-700 mb-3">
        <div className="flex flex-col items-center gap-1.5">
          <AnalogClock date={now} timezone={primary.timezone} size={100} />
          <div className="flex items-center gap-1 text-xs font-medium text-slate-700 dark:text-slate-200">
            <MapPin size={11} className="text-blue-500" />
            {primary.label || primary.timezone}
          </div>
        </div>
        <div className="flex flex-col items-center sm:items-start gap-0.5">
          <div className={`font-mono text-2xl font-bold tabular-nums tracking-tight ${primaryValid ? 'text-slate-800 dark:text-slate-100' : 'text-red-400'}`}>
            {primaryValid ? formatTime(primary.timezone) : '--:--:--'}
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400">
            {primaryValid ? formatDate(primary.timezone) : '无效时区'}
          </div>
          <div className="text-[10px] text-slate-400">
            {new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(now)} · 每城市独立时区
          </div>
          {editable && (
            <button
              onClick={() => onChange(cities.filter((_, idx) => idx !== 0))}
              className="mt-0.5 flex items-center gap-1 text-[10px] text-slate-400 hover:text-red-500 transition-colors"
            >
              <Trash2 size={10} /> 移除该城市
            </button>
          )}
        </div>
      </div>

      {/* 其他城市：小钟表网格（每行 5 个，边距紧凑） */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
        {rest.map((city, i) => {
          const valid = isValidTz(city.timezone);
          return (
            <div
              key={`${city.label}-${i}`}
              className="flex flex-col items-center gap-1 px-2 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60"
            >
              <AnalogClock date={now} timezone={city.timezone} size={64} />
              <div className="flex items-center gap-1 text-[11px] font-medium text-slate-600 dark:text-slate-300 truncate max-w-full">
                <span className="truncate">{city.label || city.timezone}</span>
                {editable && (
                  <button
                    onClick={() => onChange(cities.filter((_, idx) => idx !== i + 1))}
                    className="p-0.5 text-slate-300 dark:text-slate-500 hover:text-red-500 rounded transition-colors flex-shrink-0"
                    title="删除城市"
                  >
                    <Trash2 size={10} />
                  </button>
                )}
              </div>
              <div className={`font-mono text-xs tabular-nums ${valid ? 'text-slate-700 dark:text-slate-200' : 'text-red-400'}`}>
                {valid ? formatTime(city.timezone) : '--:--:--'}
              </div>
              <div className="text-[10px] text-slate-400">
                {valid ? formatDate(city.timezone) : '无效时区'}
              </div>
            </div>
          );
        })}

        {editable && (
          <div className="flex flex-col items-center justify-center gap-1.5 min-h-[96px] px-2 py-2.5 rounded-xl border border-dashed border-slate-300 dark:border-slate-600">
            {adding ? (
              <div className="w-full space-y-1.5">
                <input
                  type="text"
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  placeholder="城市名"
                  className="w-full p-1.5 rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white text-xs outline-none focus:ring-2 focus:ring-blue-500"
                />
                <input
                  type="text"
                  value={newTz}
                  onChange={(e) => setNewTz(e.target.value)}
                  placeholder="Asia/Tokyo"
                  className="w-full p-1.5 rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white text-xs font-mono outline-none focus:ring-2 focus:ring-blue-500"
                />
                <div className="flex gap-1.5">
                  <button
                    onClick={handleAdd}
                    className="flex-1 px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded-lg transition-colors"
                  >
                    添加
                  </button>
                  <button
                    onClick={() => setAdding(false)}
                    className="flex-1 px-2 py-1 text-xs text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
                  >
                    取消
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setAdding(true)}
                className="flex flex-col items-center gap-1 text-slate-400 hover:text-blue-500 transition-colors"
              >
                <Plus size={20} />
                <span className="text-xs">添加城市</span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default WorldClockTool;
