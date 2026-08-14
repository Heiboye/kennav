import React, { useState } from 'react';
import { ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react';
import { Solar } from 'lunar-javascript';

interface CalendarToolProps {
  expanded?: boolean;
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

// 重要节气（四立 + 二分二至），醒目提醒
const IMPORTANT_JIEQI = ['立春', '立夏', '立秋', '立冬', '春分', '夏至', '秋分', '冬至'];

// 公历节日表（中国主要公历节日；lunar-javascript 不含公历节日）
const SOLAR_FESTIVALS: Record<string, string> = {
  '1-1': '元旦', '2-14': '情人节', '3-8': '妇女节', '3-12': '植树节', '4-1': '愚人节',
  '5-1': '劳动节', '5-4': '青年节', '6-1': '儿童节', '7-1': '建党节', '8-1': '建军节',
  '9-10': '教师节', '10-1': '国庆节', '12-24': '平安夜', '12-25': '圣诞节',
};

// 母亲节（5月第2个周日）、父亲节（6月第3个周日）
const getNthWeekday = (year: number, month: number, nth: number, weekday: number): number => {
  const first = new Date(year, month - 1, 1);
  const firstWday = first.getDay();
  const offset = (weekday - firstWday + 7) % 7;
  return 1 + offset + (nth - 1) * 7;
};

/**
 * 获取某天所有节日（公历节日 + 农历节日 + 节气 + 特殊节日），按日期返回数组
 */
const getFestivalsFor = (year: number, month: number, day: number): string[] => {
  const festivals: string[] = [];

  // 公历节日
  const solar = SOLAR_FESTIVALS[`${month}-${day}`];
  if (solar) festivals.push(solar);

  // 母亲节 / 父亲节
  if (month === 5 && day === getNthWeekday(year, 5, 2, 0)) festivals.push('母亲节');
  if (month === 6 && day === getNthWeekday(year, 6, 3, 0)) festivals.push('父亲节');

  try {
    const lunar = Solar.fromYmd(year, month, day).getLunar();
    // 农历节日（春节、元宵、端午、七夕、中秋、重阳、腊八、除夕等）
    const lunarFestivals = lunar.getFestivals() || [];
    for (const f of lunarFestivals) {
      if (!festivals.includes(f)) festivals.push(f);
    }
    // 节气（清明既是节气也是节日）
    const jieQi = lunar.getJieQi() || '';
    if (jieQi) festivals.push(jieQi);
  } catch { /* ignore */ }

  return festivals;
};

interface DayInfo {
  lunarDay: string;
  lunarMonth: string;
  jieQi: string;
  isImportantJieQi: boolean;
  festival: string; // 农历节日或公历节日名
  isMonthStart: boolean;
}

const getDayInfo = (year: number, month: number, day: number): DayInfo => {
  try {
    const lunar = Solar.fromYmd(year, month + 1, day).getLunar();
    const jieQi = lunar.getJieQi() || '';
    const lunarFestivals = lunar.getFestivals() || [];
    const solarFestival = SOLAR_FESTIVALS[`${month + 1}-${day}`] || '';
    const festival = lunarFestivals[0] || solarFestival;
    return {
      lunarDay: lunar.getDayInChinese(),
      lunarMonth: lunar.getMonthInChinese(),
      jieQi,
      isImportantJieQi: IMPORTANT_JIEQI.includes(jieQi),
      festival,
      isMonthStart: lunar.getDayInChinese() === '初一',
    };
  } catch {
    return { lunarDay: '', lunarMonth: '', jieQi: '', isImportantJieQi: false, festival: '', isMonthStart: false };
  }
};

// 单元格下方文字：优先级 节气 > 节日 > 农历日
const getCellLabel = (info: DayInfo) => info.jieQi || info.festival || info.lunarDay;

// 文字颜色：节气绿 / 节日红 / 平时灰
const getCellLabelClass = (info: DayInfo, isToday: boolean, isWeekend: boolean) => {
  if (isToday) return 'text-white';
  if (info.jieQi) return info.isImportantJieQi ? 'text-green-600 dark:text-green-400 font-bold' : 'text-green-600 dark:text-green-400';
  if (info.festival) return 'text-red-500 dark:text-red-400';
  if (isWeekend) return 'text-red-300 dark:text-red-400/50';
  return 'text-slate-400 dark:text-slate-500';
};

const CalendarTool: React.FC<CalendarToolProps> = ({ expanded = false }) => {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [selectedDay, setSelectedDay] = useState(today.getDate());

  const changeMonth = (delta: number) => {
    let newYear = year;
    let newMonth = month + delta;
    if (newMonth < 0) { newMonth = 11; newYear -= 1; }
    if (newMonth > 11) { newMonth = 0; newYear += 1; }
    setYear(newYear);
    setMonth(newMonth);
    // 校正选中日期：若超出新月天数则取新月最后一天
    const newDaysInMonth = new Date(newYear, newMonth + 1, 0).getDate();
    setSelectedDay(prev => Math.min(prev, newDaysInMonth));
  };

  const goToday = () => {
    setYear(today.getFullYear());
    setMonth(today.getMonth());
    setSelectedDay(today.getDate());
  };

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array.from({ length: firstDay }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  const isToday = (day: number) =>
    day === today.getDate() && month === today.getMonth() && year === today.getFullYear();

  // 标题：公历年月 + 生肖
  const monthTitle = (() => {
    try {
      const lunar = Solar.fromYmd(year, month + 1, 1).getLunar();
      return `${year}年${month + 1}月 (${lunar.getYearInGanZhi()}${lunar.getYearShengXiao()}年)`;
    } catch {
      return `${year}年${month + 1}月`;
    }
  })();

  // 今天农历（右上角标签）
  const todayLunar = (() => {
    try {
      const lunar = Solar.fromYmd(today.getFullYear(), today.getMonth() + 1, today.getDate()).getLunar();
      return `${lunar.getMonthInChinese()}月${lunar.getDayInChinese()}`;
    } catch {
      return '';
    }
  })();

  // 选中日期详情（展开模式左侧）
  const selectedInfo = getDayInfo(year, month, selectedDay);
  const selectedLunarFull = (() => {
    try {
      return Solar.fromYmd(year, month + 1, selectedDay).getLunar();
    } catch {
      return null;
    }
  })();
  const selectedYi = selectedLunarFull?.getDayYi() || [];
  const selectedJi = selectedLunarFull?.getDayJi() || [];

  const renderMonthGrid = () => (
    <div>
      {/* 星期表头 */}
      <div className="grid grid-cols-7 gap-0.5 mb-0.5">
        {WEEKDAYS.map((w, i) => (
          <div key={w} className={`text-center text-[10px] font-medium py-0.5 ${i === 0 || i === 6 ? 'text-red-400' : 'text-slate-400'}`}>
            {w}
          </div>
        ))}
      </div>

      {/* 日期网格 */}
      <div className="grid grid-cols-7 gap-0.5">
        {cells.map((day, i) => {
          if (day === null) return <div key={`empty-${i}`} />;
          const dow = (firstDay + day - 1) % 7;
          const isWeekend = dow === 0 || dow === 6;
          const info = getDayInfo(year, month, day);
          const todayCls = isToday(day);
          const selectedCls = expanded && day === selectedDay && !todayCls;

          return (
            <button
              key={day}
              onClick={() => expanded && setSelectedDay(day)}
              className={`relative flex flex-col items-center pt-1 pb-0.5 rounded-lg transition-colors min-h-[38px] ${
                todayCls
                  ? 'bg-blue-600 text-white shadow-md'
                  : selectedCls
                    ? 'bg-blue-100 dark:bg-blue-900/40 ring-1 ring-blue-400 dark:ring-blue-600'
                    : 'hover:bg-slate-100 dark:hover:bg-slate-700'
              }`}
            >
              <span className={`text-[13px] font-medium leading-none ${todayCls ? 'text-white' : isWeekend ? 'text-red-400 dark:text-red-400/80' : 'text-slate-700 dark:text-slate-200'}`}>
                {day}
              </span>
              <span className={`mt-0.5 text-[9px] leading-tight truncate max-w-full px-0.5 ${getCellLabelClass(info, todayCls, isWeekend)}`}>
                {getCellLabel(info)}
              </span>
              {info.isImportantJieQi && !todayCls && (
                <span className="absolute top-0.5 right-0.5 w-1 h-1 rounded-full bg-green-500" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );

  // ===== 卡片常驻模式（扁平化）：当天时间/日期/节日 =====
  if (!expanded) {
    const t = today;
    const festivals = getFestivalsFor(t.getFullYear(), t.getMonth() + 1, t.getDate());
    const weekday = ['日', '一', '二', '三', '四', '五', '六'][t.getDay()];
    let lunarMonth = '', lunarDay = '';
    try {
      const lunar = Solar.fromYmd(t.getFullYear(), t.getMonth() + 1, t.getDate()).getLunar();
      lunarMonth = lunar.getMonthInChinese();
      lunarDay = lunar.getDayInChinese();
    } catch { /* ignore */ }

    const festivalText = festivals.length > 0 ? festivals.join('、') : `农历${lunarMonth}月${lunarDay}`;

    return (
      <div className="flex items-center justify-center gap-3 px-1 py-0.5 flex-1 min-h-0">
        {/* 左侧：日期纯色块（窄屏隐藏，避免挤压右侧文字导致截断） */}
        <div className="hidden sm:flex flex-col items-center justify-center w-[52px] h-[52px] rounded-2xl bg-blue-500 text-white flex-shrink-0 shadow-sm">
          <span className="text-xl font-bold leading-none tabular-nums">{t.getDate()}</span>
          <span className="text-[10px] mt-0.5 opacity-85">{t.getMonth() + 1}月</span>
        </div>
        {/* 右侧：星期 / 农历 / 节日（调大） */}
        <div className="min-w-0 text-center">
          <div className="text-[10px] leading-tight text-slate-400 truncate">
            {t.getFullYear()}年{t.getMonth() + 1}月{t.getDate()}日 星期{weekday}
          </div>
          <div className={`text-sm leading-tight font-semibold truncate ${festivals.length > 0 ? 'text-red-500 dark:text-red-400' : 'text-slate-700 dark:text-slate-200'}`}>
            {festivalText}
          </div>
          {festivals.length === 0 && (
            <div className="text-[10px] text-slate-400 truncate">今日无节日</div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={expanded ? 'flex flex-col lg:flex-row gap-6' : ''}>
      {/* 万年历展开：左侧单日详情 */}
      {expanded && (
        <div className="lg:w-56 flex-shrink-0 space-y-3">
          <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-gradient-to-br from-blue-50/60 to-slate-50 dark:from-slate-700/40 dark:to-slate-800/60 p-4 flex flex-col items-center justify-center text-center">
            <div className="text-xs text-slate-500 dark:text-slate-400">
              {year}年{month + 1}月{selectedDay}日 星期{['日','一','二','三','四','五','六'][new Date(year, month, selectedDay).getDay()]}
            </div>
            <div className="text-5xl font-bold text-slate-800 dark:text-slate-100 my-1">{selectedDay}</div>
            <div className="text-sm text-blue-600 dark:text-blue-300 font-medium">
              农历 {selectedInfo.lunarMonth}月{selectedInfo.lunarDay}
            </div>
            {selectedInfo.jieQi && (
              <div className="mt-1 text-xs text-green-600 dark:text-green-400 font-medium">{selectedInfo.jieQi}</div>
            )}
            {selectedInfo.festival && !selectedInfo.jieQi && (
              <div className="mt-1 text-xs text-red-500 dark:text-red-400 font-medium">{selectedInfo.festival}</div>
            )}
          </div>

          {/* 黄历宜忌 */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60 p-4">
            <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2 flex items-center gap-1.5">
              <CalendarDays size={12} /> 黄历
            </div>
            <div className="space-y-2">
              <div className="flex gap-2">
                <span className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-full bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 text-[10px] font-bold">宜</span>
                <span className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                  {selectedYi.length ? selectedYi.join('、') : '无'}
                </span>
              </div>
              <div className="flex gap-2">
                <span className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-full bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 text-[10px] font-bold">忌</span>
                <span className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                  {selectedJi.length ? selectedJi.join('、') : '无'}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 右侧月历 */}
      <div className="flex-1 min-w-0">
        {/* 标题栏 */}
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-1.5 min-w-0">
            <button
              onClick={() => changeMonth(-1)}
              className="p-1 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors flex-shrink-0"
              title="上个月"
            >
              <ChevronLeft size={15} />
            </button>
            <span className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">{monthTitle}</span>
            <button
              onClick={() => changeMonth(1)}
              className="p-1 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors flex-shrink-0"
              title="下个月"
            >
              <ChevronRight size={15} />
            </button>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {todayLunar && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-300">
                {todayLunar}
              </span>
            )}
            <button
              onClick={goToday}
              className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
            >
              今天
            </button>
          </div>
        </div>

        {renderMonthGrid()}
      </div>
    </div>
  );
};

export default CalendarTool;
