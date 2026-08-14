import React from 'react';
import { CloudSun, Calendar, Globe2, Languages, Coins } from 'lucide-react';
import { ToolModuleConfig } from '../../types';

export interface ToolModuleDef {
  id: string;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  description: string;
  defaultEnabled: boolean;
}

/**
 * 工具模块注册表：新增工具模块只需在此追加一项
 * （例如未来添加「备忘录」「计算器」等模块）
 */
export const TOOL_MODULES: ToolModuleDef[] = [
  { id: 'weather', label: '天气', icon: CloudSun, description: '实时天气、24 小时逐时、多日预报', defaultEnabled: true },
  { id: 'calendar', label: '日历', icon: Calendar, description: '万年历、农历、节气节日提醒', defaultEnabled: true },
  { id: 'clock', label: '世界时间', icon: Globe2, description: '多城市时钟、指针随动', defaultEnabled: true },
  { id: 'translate', label: '翻译', icon: Languages, description: 'AI 流式翻译（DeepSeek / OpenAI / Gemini）', defaultEnabled: true },
  { id: 'currency', label: '汇率', icon: Coins, description: '实时汇率换算、自动更新', defaultEnabled: true },
];

/**
 * 根据用户配置解析工具模块：以注册表为准补全缺失模块，按 order 升序返回
 */
export const resolveModules = (modules?: ToolModuleConfig[]): ToolModuleConfig[] => {
  const map = new Map<string, ToolModuleConfig>();
  (modules || []).forEach(m => map.set(m.id, m));

  const result = TOOL_MODULES.map((def, i) => {
    const existing = map.get(def.id);
    return existing
      ? { ...existing }
      : { id: def.id, enabled: def.defaultEnabled, order: i + 1 };
  });

  return result.sort((a, b) => a.order - b.order);
};
