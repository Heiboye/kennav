import React, { useState, useEffect } from 'react';
import { X, Sparkles, Loader2, Pin, Wand2, Trash2, AlertCircle, Image as ImageIcon, Eye, EyeOff } from 'lucide-react';
import { LinkItem, Category, AIConfig } from '../types';
import { generateLinkDescription, suggestCategory } from '../services/geminiService';

interface LinkModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (link: Omit<LinkItem, 'id' | 'createdAt'>) => void;
  onDelete?: (id: string) => void;
  categories: Category[];
  initialData?: LinkItem;
  aiConfig: AIConfig;
  defaultCategoryId?: string;
}

const LinkModal: React.FC<LinkModalProps> = ({ isOpen, onClose, onSave, onDelete, categories, initialData, aiConfig, defaultCategoryId }) => {
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [description, setDescription] = useState('');
  const [categoryId, setCategoryId] = useState(categories[0]?.id || 'common');
  const [pinned, setPinned] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [icon, setIcon] = useState('');
  const [iconMode, setIconMode] = useState<'auto' | 'svg'>('auto');
  const [svgCode, setSvgCode] = useState('');
  const [iconFetchFailed, setIconFetchFailed] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isFetchingIcon, setIsFetchingIcon] = useState(false);
  const [autoFetchIcon, setAutoFetchIcon] = useState(true);
  const [batchMode, setBatchMode] = useState(false);
  const [showSuccessMessage, setShowSuccessMessage] = useState(false);
  
  // 当模态框关闭时，重置批量模式为默认关闭状态
  useEffect(() => {
    if (!isOpen) {
      setBatchMode(false);
      setShowSuccessMessage(false);
    }
  }, [isOpen]);
  
  // 成功提示1秒后自动消失
  useEffect(() => {
    if (showSuccessMessage) {
      const timer = setTimeout(() => {
        setShowSuccessMessage(false);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [showSuccessMessage]);

  useEffect(() => {
    if (isOpen) {
      if (initialData) {
        setTitle(initialData.title);
        setUrl(initialData.url);
        setDescription(initialData.description || '');
        setCategoryId(initialData.categoryId);
        setPinned(initialData.pinned || false);
        setHidden(initialData.hidden || false);
        const savedIcon = initialData.icon || '';
        setIcon(savedIcon);
        // 如果已有图标是 SVG data URI，自动切换到 SVG 代码模式并解码回编辑框
        if (savedIcon.startsWith('data:image/svg+xml')) {
          setIconMode('svg');
          setSvgCode(decodeSvgDataUri(savedIcon));
        } else {
          setIconMode('auto');
          setSvgCode('');
        }
      } else {
        setTitle('');
        setUrl('');
        setDescription('');
        // 如果有默认分类ID且该分类存在，则使用默认分类，否则使用第一个分类
        const defaultCategory = defaultCategoryId && categories.find(cat => cat.id === defaultCategoryId);
        setCategoryId(defaultCategory ? defaultCategoryId : (categories[0]?.id || 'common'));
        setPinned(false);
        setIcon('');
        setIconMode('auto');
        setSvgCode('');
        setIconFetchFailed(false);
      }
    }
  }, [isOpen, initialData, categories, defaultCategoryId]);

  // 当URL变化且启用自动获取图标时，自动获取图标
  useEffect(() => {
    if (url && autoFetchIcon && !initialData) {
      const timer = setTimeout(() => {
        handleFetchIcon();
      }, 500); // 延迟500ms执行，避免频繁请求
      
      return () => clearTimeout(timer);
    }
  }, [url, autoFetchIcon, initialData]);

  const handleDelete = () => {
    if (!initialData) return;
    onDelete && onDelete(initialData.id);
    onClose();
  };

  // 将 iconfont 的 SVG 代码转换为 data URI（兼容现有 <img> 渲染链路）
  const svgToDataUri = (code: string) => {
    return `data:image/svg+xml;utf8,${encodeURIComponent(code.trim())}`;
  };

  // 将 SVG data URI 解码回原始代码（用于编辑已有 SVG 图标）
  const decodeSvgDataUri = (dataUri: string) => {
    try {
      if (dataUri.startsWith('data:image/svg+xml;base64,')) {
        return atob(dataUri.replace('data:image/svg+xml;base64,', ''));
      }
      const prefix = 'data:image/svg+xml;utf8,';
      if (dataUri.startsWith(prefix)) {
        return decodeURIComponent(dataUri.slice(prefix.length));
      }
    } catch (e) {
      console.error('Failed to decode SVG data URI', e);
    }
    return '';
  };

  // SVG 白名单：仅允许基础图形与外观属性，剔除 script/foreignObject/事件属性/危险 URL，防 XSS
  const SVG_ALLOWED_TAGS = new Set([
    'svg', 'g', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse',
    'defs', 'use', 'symbol', 'text', 'tspan', 'title', 'desc', 'stop',
    'linearGradient', 'radialGradient', 'clipPath', 'mask', 'pattern',
  ]);
  const SVG_ALLOWED_ATTRS = new Set([
    'd', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin',
    'stroke-opacity', 'stroke-dasharray', 'fill-opacity', 'opacity', 'viewBox',
    'width', 'height', 'x', 'y', 'cx', 'cy', 'r', 'rx', 'ry', 'points', 'transform',
    'offset', 'stop-color', 'stop-opacity', 'x1', 'y1', 'x2', 'y2',
    'gradientUnits', 'spreadMethod', 'pathLength', 'text-anchor', 'font-size',
    'font-family', 'font-weight', 'preserveAspectRatio', 'version', 'xmlns',
  ]);
  const DANGEROUS_URL_RE = /^\s*(javascript:|vbscript:|data:text\/html)/i;

  // 清洗粘贴的 SVG 代码：白名单重写，返回安全字符串；无效返回空串
  const sanitizeSvgCode = (code: string): string => {
    try {
      const doc = new DOMParser().parseFromString(code.trim(), 'image/svg+xml');
      const root = doc.documentElement;
      if (!root || root.tagName.toLowerCase() !== 'svg') return '';

      const cleanNode = (el: Element): Element | null => {
        const tag = el.tagName.toLowerCase();
        if (!SVG_ALLOWED_TAGS.has(tag)) return null; // 剔除 script/foreignObject 等
        const clean = doc.createElementNS('http://www.w3.org/2000/svg', tag);
        for (const attr of Array.from(el.attributes)) {
          const name = attr.name;
          if (/^on/i.test(name)) continue; // 剔除 on* 事件属性
          if (!SVG_ALLOWED_ATTRS.has(name)) continue;
          if ((name === 'href' || name === 'xlink:href') && DANGEROUS_URL_RE.test(attr.value)) continue;
          clean.setAttribute(name, attr.value);
        }
        for (const child of Array.from(el.childNodes)) {
          if (child.nodeType === Node.TEXT_NODE) {
            clean.appendChild(doc.createTextNode(child.textContent || ''));
          } else if (child.nodeType === Node.ELEMENT_NODE) {
            const c = cleanNode(child as Element);
            if (c) clean.appendChild(c);
          }
        }
        return clean;
      };

      const cleaned = cleanNode(root);
      if (!cleaned) return '';
      return new XMLSerializer().serializeToString(cleaned);
    } catch {
      return '';
    }
  };

  // 缓存自定义图标到KV空间
  const cacheCustomIcon = async (url: string, iconUrl: string) => {
    try {
      let domain = url;
      if (domain.startsWith('http://') || domain.startsWith('https://')) {
        const urlObj = new URL(domain);
        domain = urlObj.hostname;
      }
      
      // 将自定义图标保存到KV缓存
      const authToken = localStorage.getItem('cloudnav_auth_token');
      if (authToken) {
        const authIssuedAt = localStorage.getItem('lastLoginTime');
        const response = await fetch('/api/storage', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-auth-password': authToken,
            ...(authIssuedAt ? { 'x-auth-issued-at': authIssuedAt } : {})
          },
          body: JSON.stringify({
            saveConfig: 'favicon',
            domain: domain,
            icon: iconUrl
          })
        });

        if (response.ok) {
          const data = await response.json();
          return data.icon || iconUrl;
        }
      }
    } catch (error) {
      console.log("Failed to cache custom icon", error);
    }

    return iconUrl;
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!title || !url) return;
    
    // 确保URL有协议前缀
    let finalUrl = url;
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      finalUrl = 'https://' + url;
    }

    let finalIcon = icon;
    if (iconMode === 'svg' && svgCode.trim()) {
      // SVG 代码模式：白名单清洗后再转 data URI 存储（防恶意脚本/外链进入图标）
      const safeSvg = sanitizeSvgCode(svgCode);
      if (safeSvg) {
        finalIcon = svgToDataUri(safeSvg);
        setIcon(finalIcon);
      }
    } else if (finalIcon) {
      finalIcon = await cacheCustomIcon(finalUrl, finalIcon);
      setIcon(finalIcon);
    }
    
    // 保存链接数据（id 由 App 侧管理：新增自动生成、编辑沿用 initialData）
    onSave({
      title,
      url: finalUrl,
      icon: finalIcon,
      description,
      categoryId,
      pinned,
      hidden
    });
    
    // 批量模式下不关闭窗口，只显示成功提示
    if (batchMode) {
      setShowSuccessMessage(true);
      // 重置表单，但保留分类和批量模式设置
      setTitle('');
      setUrl('');
      setIcon('');
      setSvgCode('');
      setIconFetchFailed(false);
      setDescription('');
      setPinned(false);
      // 如果开启自动获取图标，尝试获取新图标
      if (autoFetchIcon && finalUrl) {
        handleFetchIcon();
      }
    } else {
      onClose();
    }
  };

  const handleAIAssist = async () => {
    if (!url || !title) return;
    if (!aiConfig.apiKey) {
        alert("请先点击侧边栏左下角设置图标配置 AI API Key");
        return;
    }

    setIsGenerating(true);
    
    // Parallel execution for speed
    try {
        const descPromise = generateLinkDescription(title, url, aiConfig);
        const catPromise = suggestCategory(title, url, categories, aiConfig);
        
        const [desc, cat] = await Promise.all([descPromise, catPromise]);
        
        if (desc) setDescription(desc);
        if (cat) setCategoryId(cat);
        
    } catch (e) {
        console.error("AI Assist failed", e);
    } finally {
        setIsGenerating(false);
    }
  };

  const handleFetchIcon = async () => {
    if (!url) return;
    
    setIsFetchingIcon(true);
    try {
      // 提取域名
      let domain = url;
      // 如果URL没有协议前缀，添加https://作为默认协议
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        domain = 'https://' + url;
      }
      
      if (domain.startsWith('http://') || domain.startsWith('https://')) {
        const urlObj = new URL(domain);
        domain = urlObj.hostname;
      }
      
      // 先尝试从KV缓存获取图标（fetch=true 需要登录凭据）
      try {
        const authToken = localStorage.getItem('cloudnav_auth_token');
        const authIssuedAt = localStorage.getItem('lastLoginTime');
        const response = await fetch(`/api/storage?getConfig=favicon&domain=${encodeURIComponent(domain)}&fetch=true`, {
          headers: {
            ...(authToken ? { 'x-auth-password': authToken } : {}),
            ...(authIssuedAt ? { 'x-auth-issued-at': authIssuedAt } : {}),
          }
        });
        if (response.ok) {
          const data = await response.json();
          if (data.cached && data.icon) {
            setIcon(data.icon);
            setIconFetchFailed(false);
            setIsFetchingIcon(false);
            return;
          }
        }
      } catch (error) {
        console.log("Failed to fetch cached icon, will generate new one", error);
      }
      
      // 如果缓存中没有，则生成新图标
      const iconUrl = `https://www.faviconextractor.com/favicon/${domain}?larger=true`;
      setIcon(iconUrl);
      // 自动获取未能获得缓存的有效图标，提示可切换 SVG 代码模式
      setIconFetchFailed(true);
      
      // 将图标保存到KV缓存
      try {
        const authToken = localStorage.getItem('cloudnav_auth_token');
        if (authToken) {
          const authIssuedAt = localStorage.getItem('lastLoginTime');
          await fetch('/api/storage', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-auth-password': authToken,
              ...(authIssuedAt ? { 'x-auth-issued-at': authIssuedAt } : {})
            },
            body: JSON.stringify({
              saveConfig: 'favicon',
              domain: domain,
              icon: iconUrl
            })
          });
        }
      } catch (error) {
        console.log("Failed to cache icon", error);
      }
    } catch (e) {
      console.error("Failed to fetch icon", e);
      alert("无法获取图标，请检查URL是否正确");
    } finally {
      setIsFetchingIcon(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden border border-slate-200 dark:border-slate-700">
        <div className="flex justify-between items-center p-4 border-b border-slate-200 dark:border-slate-700">
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-semibold dark:text-white">
              {initialData ? '编辑链接' : '添加新链接'}
            </h3>
            <button
              type="button"
              onClick={() => setPinned(!pinned)}
              className={`flex items-center gap-1 px-2 py-1 rounded-md border transition-all ${
                pinned 
                ? 'bg-blue-100 border-blue-200 text-blue-600 dark:bg-blue-900/40 dark:border-blue-800 dark:text-blue-300' 
                : 'bg-slate-50 border-slate-200 text-slate-500 dark:bg-slate-700 dark:border-slate-600 dark:text-slate-400'
              }`}
              title={pinned ? "取消置顶" : "置顶"}
            >
              <Pin size={14} className={pinned ? "fill-current" : ""} />
              <span className="text-xs font-medium">置顶</span>
            </button>
            <button
              type="button"
              onClick={() => setHidden(!hidden)}
              className={`flex items-center gap-1 px-2 py-1 rounded-md border transition-all ${
                hidden 
                ? 'bg-amber-100 border-amber-200 text-amber-600 dark:bg-amber-900/40 dark:border-amber-800 dark:text-amber-300' 
                : 'bg-slate-50 border-slate-200 text-slate-500 dark:bg-slate-700 dark:border-slate-600 dark:text-slate-400'
              }`}
              title={hidden ? "恢复显示" : "隐藏此链接（不在首页显示）"}
            >
              {hidden ? <Eye size={14} /> : <EyeOff size={14} />}
              <span className="text-xs font-medium">隐藏</span>
            </button>
            {!initialData && (
              <div className="flex items-center gap-1 px-2 py-1 rounded-md border bg-slate-50 border-slate-200 dark:bg-slate-700 dark:border-slate-600">
                <input
                  type="checkbox"
                  id="batchMode"
                  checked={batchMode}
                  onChange={(e) => setBatchMode(e.target.checked)}
                  className="h-3 w-3 text-blue-600 focus:ring-blue-500 border-slate-300 rounded dark:border-slate-600 dark:bg-slate-700"
                />
                <label htmlFor="batchMode" className="text-xs font-medium text-slate-500 dark:text-slate-400 cursor-pointer">
                  批量添加不关窗口
                </label>
              </div>
            )}
            {initialData && onDelete && (
              <button
                type="button"
                onClick={handleDelete}
                className={`flex items-center gap-1 px-2 py-1 rounded-md border transition-all ${
                  'bg-red-50 border-red-200 text-red-600 hover:bg-red-100 dark:bg-red-900/20 dark:border-red-800/30 dark:text-red-400 dark:hover:bg-red-900/30'
                }`}
                title="删除链接"
              >
                <Trash2 size={14} />
                <span className="text-xs font-medium">删除</span>
              </button>
            )}
          </div>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-full transition-colors">
            <X className="w-5 h-5 dark:text-slate-400" />
          </button>
        </div>

        <form onSubmit={handleSave} className="p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1 dark:text-slate-300">标题</label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full p-2 rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none transition-all"
              placeholder="网站名称"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1 dark:text-slate-300">URL 链接</label>
            <div className="flex gap-2">
                <input
                type="text"
                required
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className="w-full p-2 rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                placeholder="example.com 或 https://..."
                />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2 dark:text-slate-300">图标</label>

            {/* 图标来源模式选择：勾选哪个即生效哪种 */}
            <div className="flex items-center gap-5 mb-3">
              <label className="flex items-center gap-1.5 cursor-pointer select-none text-sm text-slate-700 dark:text-slate-300">
                <input
                  type="radio"
                  name="iconMode"
                  checked={iconMode === 'auto'}
                  onChange={() => { setIconMode('auto'); setIconFetchFailed(false); }}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-slate-300 dark:border-slate-600 dark:bg-slate-700"
                />
                自动获取
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer select-none text-sm text-slate-700 dark:text-slate-300">
                <input
                  type="radio"
                  name="iconMode"
                  checked={iconMode === 'svg'}
                  onChange={() => { setIconMode('svg'); setIconFetchFailed(false); }}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-slate-300 dark:border-slate-600 dark:bg-slate-700"
                />
                SVG 代码 (iconfont)
              </label>
            </div>

            {iconMode === 'auto' ? (
              <>
                <div className="flex gap-2">
                  {icon && (
                    <div className="w-10 h-10 rounded-xl border border-slate-300 dark:border-slate-600 overflow-hidden flex-shrink-0 bg-white dark:bg-slate-700">
                      <img
                        key={icon}
                        src={icon}
                        alt="图标预览"
                        className="w-full h-full object-cover rounded-xl"
                        onLoad={(e) => {
                          e.currentTarget.style.display = 'block';
                          setIconFetchFailed(false);
                        }}
                        onError={(e) => {
                          e.currentTarget.style.display = 'none';
                          // 图标加载失败，提示可切换 SVG 代码模式
                          setIconFetchFailed(true);
                        }}
                      />
                    </div>
                  )}
                  <input
                    type="url"
                    value={icon}
                    onChange={(e) => setIcon(e.target.value)}
                    className="flex-1 p-2 rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                    placeholder="https://example.com/icon.png"
                  />
                  <button
                    type="button"
                    onClick={handleFetchIcon}
                    disabled={!url || isFetchingIcon}
                    className="px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 flex items-center gap-1 transition-colors"
                  >
                    {isFetchingIcon ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Wand2 className="w-4 h-4" />
                    )}
                    获取图标
                  </button>
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <input
                    type="checkbox"
                    id="autoFetchIcon"
                    checked={autoFetchIcon}
                    onChange={(e) => setAutoFetchIcon(e.target.checked)}
                    className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-slate-300 rounded dark:border-slate-600 dark:bg-slate-700"
                  />
                  <label htmlFor="autoFetchIcon" className="text-sm text-slate-700 dark:text-slate-300">
                    自动获取URL链接的图标
                  </label>
                </div>
                {iconFetchFailed && (
                  <div className="mt-2 flex items-start gap-2 p-2.5 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/40">
                    <AlertCircle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                    <div className="text-xs text-amber-700 dark:text-amber-300">
                      无法获取源站图标，可切换到「SVG 代码」模式，从
                      <a href="https://www.iconfont.cn" target="_blank" rel="noopener noreferrer" className="underline mx-0.5 text-blue-600 dark:text-blue-400">iconfont.cn</a>
                      复制 SVG 代码粘贴使用
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="space-y-2">
                {/* SVG 代码预览（白名单清洗后注入，防 XSS） */}
                <div className="flex items-center gap-3 p-2.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700">
                  {sanitizeSvgCode(svgCode) ? (
                    <span
                      className="w-10 h-10 flex items-center justify-center text-blue-600 dark:text-blue-400"
                      style={{ fontSize: 32 }}
                      dangerouslySetInnerHTML={{ __html: sanitizeSvgCode(svgCode) }}
                    />
                  ) : (
                    <div className="w-10 h-10 flex items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-600 text-slate-400">
                      <ImageIcon className="w-5 h-5" />
                    </div>
                  )}
                  <div className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                    {sanitizeSvgCode(svgCode)
                      ? 'SVG 代码有效，将作为此链接的图标'
                      : '粘贴 iconfont 的 SVG 代码后自动预览'}
                  </div>
                </div>
                <textarea
                  value={svgCode}
                  onChange={(e) => setSvgCode(e.target.value)}
                  className="w-full p-2 rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none transition-all h-24 resize-none font-mono text-xs"
                  placeholder={'<svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">...</svg>'}
                />
                <p className="text-xs text-slate-400 leading-relaxed">
                  使用方式：打开 <span className="text-blue-500">iconfont.cn</span> → 选择图标 → 「复制代码」→ 「复制SVG代码」，将代码粘贴到上方输入框
                </p>
              </div>
            )}
          </div>

          <div>
            <div className="flex justify-between items-center mb-1">
                <label className="block text-sm font-medium dark:text-slate-300">描述 (选填)</label>
                {(title && url) && (
                    <button
                        type="button"
                        onClick={handleAIAssist}
                        disabled={isGenerating}
                        className="text-xs flex items-center gap-1 text-purple-600 dark:text-purple-400 hover:text-purple-700 dark:hover:text-purple-300 transition-colors"
                    >
                        {isGenerating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                        AI 自动填写
                    </button>
                )}
            </div>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full p-2 rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none transition-all h-20 resize-none"
              placeholder="简短描述..."
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1 dark:text-slate-300">分类</label>
            <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="w-full p-2 rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none transition-all"
            >
            {categories.map(cat => (
                <option key={cat.id} value={cat.id}>{cat.name}</option>
            ))}
            </select>
          </div>

          <div className="pt-2 relative">
            {/* 成功提示 */}
            {showSuccessMessage && (
              <div className="absolute -top-10 left-1/2 transform -translate-x-1/2 z-10 px-4 py-2 bg-green-500 text-white rounded-lg shadow-lg transition-opacity duration-300">
                添加成功
              </div>
            )}
            <button
              type="submit"
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-lg transition-colors shadow-lg shadow-blue-500/30"
            >
              保存
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default LinkModal;
