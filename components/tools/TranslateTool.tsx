import React, { useState, useRef } from 'react';
import { Languages, Loader2, Copy, Check, Sparkles, ArrowRightLeft, Square } from 'lucide-react';
import { AIConfig, ToolsConfig } from '../../types';
import { translateTextStream } from '../../services/geminiService';

interface TranslateToolProps {
  aiConfig: AIConfig;
  translateConfig: ToolsConfig['translate'];
  onOpenSettings?: () => void;
}

const LANGUAGES = [
  { code: 'zh-CN', label: '中文（简体）' },
  { code: 'en', label: 'English' },
  { code: 'ja', label: '日本語' },
  { code: 'ko', label: '한국어' },
  { code: 'fr', label: 'Français' },
  { code: 'de', label: 'Deutsch' },
  { code: 'es', label: 'Español' },
  { code: 'ru', label: 'Русский' },
];

const TranslateTool: React.FC<TranslateToolProps> = ({ aiConfig, translateConfig, onOpenSettings }) => {
  const [sourceText, setSourceText] = useState('');
  const [targetLang, setTargetLang] = useState(translateConfig.targetLang || 'zh-CN');
  const [result, setResult] = useState('');
  const [isTranslating, setIsTranslating] = useState(false);
  const [copied, setCopied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const hasKey = !!aiConfig.apiKey;

  const handleTranslate = async () => {
    if (!sourceText.trim() || !hasKey || isTranslating) return;

    setIsTranslating(true);
    setResult('');
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await translateTextStream(
        sourceText,
        targetLang,
        aiConfig,
        translateConfig, // 结构化翻译配置（角色/行业/要求/自定义提示词）
        (delta) => setResult(prev => prev + delta), // 流式逐字追加（打字机效果）
        controller.signal
      );
    } catch (e) {
      if (!controller.signal.aborted) {
        setResult(prev => {
          const base = prev || '';
          return base
            ? `${base}\n\n⚠️ 翻译中断，请重试`
            : '翻译失败，请检查 AI 配置或稍后重试';
        });
      }
    } finally {
      setIsTranslating(false);
      abortRef.current = null;
    }
  };

  const handleStop = () => {
    abortRef.current?.abort();
  };

  const handleSwap = () => {
    if (result && !isTranslating) {
      setSourceText(result);
      setResult('');
    }
  };

  const handleCopy = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = result;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (!hasKey) {
    return (
      <div className="text-center py-6">
        <Languages size={32} className="mx-auto mb-3 text-slate-300 dark:text-slate-600" />
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
          快捷翻译需要先配置 AI 服务（支持 DeepSeek / OpenAI 兼容 / Gemini）
        </p>
        <button
          onClick={onOpenSettings}
          className="flex items-center gap-1.5 mx-auto px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg transition-colors"
        >
          <Sparkles size={15} /> 去配置 AI
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* 输入区 */}
      <textarea
        value={sourceText}
        onChange={(e) => setSourceText(e.target.value)}
        rows={3}
        placeholder="输入要翻译的内容..."
        className="w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white text-sm outline-none focus:ring-2 focus:ring-blue-500 resize-none"
      />

      {/* 目标语言 + 操作按钮 */}
      <div className="flex items-center gap-2">
        <select
          value={targetLang}
          onChange={(e) => setTargetLang(e.target.value)}
          className="flex-1 p-2 rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white text-sm outline-none focus:ring-2 focus:ring-blue-500"
        >
          {LANGUAGES.map(lang => (
            <option key={lang.code} value={lang.code}>翻译为：{lang.label}</option>
          ))}
        </select>
        {isTranslating ? (
          <button
            onClick={handleStop}
            className="flex items-center gap-1.5 px-4 py-2 bg-red-500 hover:bg-red-600 text-white text-sm rounded-lg transition-colors"
            title="停止翻译"
          >
            <Square size={13} className="fill-current" /> 停止
          </button>
        ) : (
          <button
            onClick={handleTranslate}
            disabled={!sourceText.trim()}
            className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white text-sm rounded-lg transition-colors"
          >
            <Languages size={14} /> 翻译
          </button>
        )}
      </div>

      {/* 结果区（流式输出） */}
      {isTranslating || result ? (
        <div className="relative">
          <div className="w-full min-h-[84px] p-2.5 rounded-lg border border-blue-200 dark:border-blue-800/50 bg-blue-50/50 dark:bg-slate-800 text-sm text-slate-700 dark:text-slate-200 whitespace-pre-wrap break-words">
            {result || (
              <span className="text-slate-400 dark:text-slate-500 flex items-center gap-1.5">
                <Loader2 size={13} className="animate-spin" /> 正在翻译...
              </span>
            )}
            {isTranslating && (
              <span className="inline-block w-1.5 h-4 ml-0.5 bg-blue-500 animate-pulse align-middle" />
            )}
          </div>
          {result && !isTranslating && (
            <div className="absolute top-1.5 right-1.5 flex items-center gap-1">
              <button
                onClick={handleSwap}
                className="p-1.5 text-slate-400 hover:text-blue-500 hover:bg-white dark:hover:bg-slate-700 rounded-lg transition-colors"
                title="结果作为新输入"
              >
                <ArrowRightLeft size={13} />
              </button>
              <button
                onClick={handleCopy}
                className="p-1.5 text-slate-400 hover:text-green-500 hover:bg-white dark:hover:bg-slate-700 rounded-lg transition-colors"
                title="复制结果"
              >
                {copied ? <Check size={13} className="text-green-500" /> : <Copy size={13} />}
              </button>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
};

export default TranslateTool;
