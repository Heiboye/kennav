import React, { useState, useEffect, useRef } from 'react';
import { X, Save, Bot, Key, Globe, Sparkles, PauseCircle, Wrench, Copy, Check, LayoutTemplate, Download, Sidebar, Keyboard, AlertTriangle, Package, Zap, Upload, CloudSun, Globe2, Languages, Coins, Plus, Trash2, Loader2, GripVertical, Palette, Image as ImageIcon, Type, AlignLeft, RefreshCw } from 'lucide-react';
import { AIConfig, AIProvider, LinkItem, SiteSettings, ToolsConfig, DEFAULT_TOOLS_CONFIG } from '../types';
import { generateLinkDescription, fetchModels, AIModelInfo } from '../services/geminiService';
import { TOOL_MODULES, resolveModules } from './tools/registry';
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext, verticalListSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import JSZip from 'jszip';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: AIConfig;
  siteSettings: SiteSettings;
  onSave: (config: AIConfig, siteSettings: SiteSettings) => void;
  links: LinkItem[];
  onUpdateLinks: (links: LinkItem[]) => void;
  authToken: string | null;
  toolsConfig: ToolsConfig;
  onSaveToolsConfig: (config: ToolsConfig) => void;
  onBingSync?: () => void; // 立即同步 Bing 壁纸
  onPasswordChanged?: (newPassword: string) => void; // 修改登录密码成功后回调
  initialTab?: 'site' | 'ai' | 'appearance' | 'tools' | 'utilities';
}

const DEFAULT_BACKGROUND = { enabled: false, type: 'bing' as const, bingResolution: '4k' as const, customUrl: '', solidColor: '#1e293b', overlayOpacity: 0.35, dailySync: true, imageOpacity: 1 };

// AI 接口预设：默认官方接口 + 自定义接口
const AI_PRESETS: Record<string, { label: string; baseUrl: string; defaultModel: string }> = {
  gemini: { label: 'Gemini 官方', baseUrl: '', defaultModel: 'gemini-2.5-flash' },
  deepseek: { label: 'DeepSeek 官方', baseUrl: 'https://api.deepseek.com/v1', defaultModel: 'deepseek-chat' },
  openai: { label: 'OpenAI 官方', baseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-4o' },
  custom: { label: '自定义接口', baseUrl: '', defaultModel: '' },
};

// 工具模块可排序行（拖拽 + 启用开关）
const ModuleSortableRow: React.FC<{
  id: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  description: string;
  enabled: boolean;
  onToggle: () => void;
}> = ({ id, icon: Icon, label, description, enabled, onToggle }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-2.5 p-2.5 rounded-xl border bg-white dark:bg-slate-800 transition-shadow ${
        isDragging ? 'border-blue-400 shadow-lg opacity-90 z-10' : 'border-slate-200 dark:border-slate-700'
      }`}
    >
      <button
        {...attributes}
        {...listeners}
        className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-grab active:cursor-grabbing"
        title="拖动排序"
      >
        <GripVertical size={15} />
      </button>
      <span className={`p-1.5 rounded-lg flex-shrink-0 ${enabled ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-300' : 'bg-slate-100 dark:bg-slate-700 text-slate-400'}`}>
        <Icon size={14} />
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-slate-700 dark:text-slate-200">{label}</div>
        <div className="text-[10px] text-slate-400 truncate">{description}</div>
      </div>
      <button
        onClick={onToggle}
        className={`relative w-9 h-5 rounded-full transition-colors flex-shrink-0 ${enabled ? 'bg-blue-500' : 'bg-slate-300 dark:bg-slate-600'}`}
        title={enabled ? '点击停用' : '点击启用'}
      >
        <span
          className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all"
          style={{ left: enabled ? 18 : 2 }}
        />
      </button>
    </div>
  );
};


const SettingsModal: React.FC<SettingsModalProps> = ({ 
    isOpen, onClose, config, siteSettings, onSave, links, onUpdateLinks, authToken,
    toolsConfig, onSaveToolsConfig, initialTab, onBingSync, onPasswordChanged
}) => {
  const [activeTab, setActiveTab] = useState<'site' | 'ai' | 'appearance' | 'tools' | 'utilities'>('site');
  const [localConfig, setLocalConfig] = useState<AIConfig>(config);
  const [localToolsConfig, setLocalToolsConfig] = useState<ToolsConfig>(() => ({ ...DEFAULT_TOOLS_CONFIG, ...toolsConfig }));
  // 修改登录密码表单
  const [changePwd, setChangePwd] = useState({ old: '', next: '', confirm: '' });
  const [pwdState, setPwdState] = useState<{ status: 'idle' | 'loading' | 'ok' | 'error'; msg: string }>({ status: 'idle', msg: '' });
  const handleChangePassword = async () => {
    if (!changePwd.old || !changePwd.next) { setPwdState({ status: 'error', msg: '请填写当前密码和新密码' }); return; }
    if (changePwd.next.length < 8) { setPwdState({ status: 'error', msg: '新密码至少 8 位' }); return; }
    if (changePwd.next === changePwd.old) { setPwdState({ status: 'error', msg: '新密码不能与当前密码相同' }); return; }
    if (changePwd.next !== changePwd.confirm) { setPwdState({ status: 'error', msg: '两次输入的新密码不一致' }); return; }
    setPwdState({ status: 'loading', msg: '' });
    try {
      const res = await fetch('/api/storage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-auth-password': authToken || '' },
        body: JSON.stringify({ changePassword: { oldPassword: changePwd.old, newPassword: changePwd.next } }),
      });
      let data: any = {};
      if (res.ok) { try { data = await res.json(); } catch { /* 忽略解析失败 */ } }
      if (!res.ok || !data.success) {
        setPwdState({ status: 'error', msg: data.error || '修改失败' });
        return;
      }
      setPwdState({ status: 'ok', msg: '密码修改成功，下次登录请使用新密码' });
      // 传入后端签发的新会话 token（兼容旧后端：无 token 时回退新密码）
      onPasswordChanged?.(data.token || changePwd.next);
      setChangePwd({ old: '', next: '', confirm: '' });
    } catch {
      setPwdState({ status: 'error', msg: '网络错误，修改失败' });
    }
  };
  
  const [localSiteSettings, setLocalSiteSettings] = useState<SiteSettings>(() => ({
      title: siteSettings?.title || 'CloudNav - 我的导航',
      navTitle: siteSettings?.navTitle || 'CloudNav',
      favicon: siteSettings?.favicon || '',
      cardStyle: siteSettings?.cardStyle || 'detailed',
      requirePasswordOnVisit: siteSettings?.requirePasswordOnVisit ?? false,
      passwordExpiryDays: siteSettings?.passwordExpiryDays ?? 7,
      background: siteSettings?.background ?? DEFAULT_BACKGROUND,
      font: siteSettings?.font ?? { family: '' },
      navTitleAlign: siteSettings?.navTitleAlign ?? 'left'
  }));

  // 背景配置（防御：任何路径下 localSiteSettings.background 缺失时用默认值）
  const bg = localSiteSettings.background ?? DEFAULT_BACKGROUND;
  
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const shouldStopRef = useRef(false);

  const [password, setPassword] = useState('');
  const [domain, setDomain] = useState('');
  const [browserType, setBrowserType] = useState<'chrome' | 'firefox'>('chrome');
  const [isZipping, setIsZipping] = useState(false);
  const faviconUploadRef = useRef<HTMLInputElement>(null);
  
  const [copiedStates, setCopiedStates] = useState<{[key: string]: boolean}>({});

  // AI 模型列表（自动获取）
  const [modelList, setModelList] = useState<AIModelInfo[]>([]);
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const [modelFetchError, setModelFetchError] = useState('');

  useEffect(() => {
    if (isOpen) {
      setLocalConfig(config);
      // 初始化工具配置（与默认值深合并）
      setLocalToolsConfig({
          ...DEFAULT_TOOLS_CONFIG,
          ...toolsConfig,
          weather: { ...DEFAULT_TOOLS_CONFIG.weather, ...(toolsConfig.weather || {}) },
          translate: { ...DEFAULT_TOOLS_CONFIG.translate, ...(toolsConfig.translate || {}) },
          worldClock: { ...DEFAULT_TOOLS_CONFIG.worldClock, ...(toolsConfig.worldClock || {}) },
          currency: { ...DEFAULT_TOOLS_CONFIG.currency, ...(toolsConfig.currency || {}) },
      });
      if (initialTab) setActiveTab(initialTab);
      const safeSettings = {
          title: siteSettings?.title || 'CloudNav - 我的导航',
          navTitle: siteSettings?.navTitle || 'CloudNav',
          favicon: siteSettings?.favicon || '',
          cardStyle: siteSettings?.cardStyle || 'detailed',
          requirePasswordOnVisit: siteSettings?.requirePasswordOnVisit ?? false,
          passwordExpiryDays: siteSettings?.passwordExpiryDays ?? 7,
          background: siteSettings?.background ?? DEFAULT_BACKGROUND,
          font: siteSettings?.font ?? { family: '' },
          navTitleAlign: siteSettings?.navTitleAlign ?? 'left'
      };
      setLocalSiteSettings(safeSettings);

      setIsProcessing(false);
      setIsZipping(false);
      setProgress({ current: 0, total: 0 });
      shouldStopRef.current = false;
      setDomain(window.location.origin);
      const storedToken = localStorage.getItem('cloudnav_auth_token');
      if (storedToken) setPassword(storedToken);
    }
  }, [isOpen, config, siteSettings, toolsConfig, initialTab]);

  const handleChange = (key: keyof AIConfig, value: string) => {
    setLocalConfig(prev => ({ ...prev, [key]: value }));
  };

  // 切换 AI 接口类型：应用官方预设（baseUrl + 默认模型）
  const handleProviderChange = (provider: string) => {
    const preset = AI_PRESETS[provider];
    setLocalConfig(prev => {
      const next = { ...prev, provider: provider as any };
      if (preset) {
        // 预设接口自动填 baseUrl（custom 留空）
        next.baseUrl = preset.baseUrl;
        // 仅当当前模型为空或仍是旧预设模型时，替换为默认模型
        if (!next.model || !prev.model) {
          next.model = preset.defaultModel;
        }
      }
      return next;
    });
    setModelList([]);
    setModelFetchError('');
  };

  // 自动获取模型列表
  const handleFetchModels = async () => {
    if (!localConfig.apiKey) {
      setModelFetchError('请先填写 API Key');
      return;
    }
    setIsFetchingModels(true);
    setModelFetchError('');
    const models = await fetchModels(localConfig);
    setIsFetchingModels(false);
    if (models.length > 0) {
      setModelList(models);
      // 若当前模型不在列表中，自动选第一个
      if (!models.find(m => m.id === localConfig.model)) {
        handleChange('model', models[0].id);
      }
    } else {
      setModelFetchError('未能获取模型列表，请检查接口地址与 API Key 是否有效');
    }
  };

  const handleSiteChange = async (key: keyof SiteSettings, value: any) => {
    setLocalSiteSettings(prev => {
        const next = { ...prev, [key]: value };
        
        // 如果是身份验证过期天数修改，立即保存到 KV 空间
        if (key === 'passwordExpiryDays' && authToken) {
            saveWebsiteConfigToKV(next);
        }
        
        return next;
    });
  };

  // 保存网站配置到 KV 空间
  const saveWebsiteConfigToKV = async (siteSettings: SiteSettings) => {
    try {
        const authIssuedAt = localStorage.getItem('lastLoginTime');
        const response = await fetch('/api/storage', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-auth-password': authToken || '',
                ...(authIssuedAt ? { 'x-auth-issued-at': authIssuedAt } : {})
            },
            body: JSON.stringify({
                saveConfig: 'website',
                config: siteSettings
            })
        });
        
        if (!response.ok) {
            console.error('Failed to save website config to KV:', response.statusText);
        }
    } catch (error) {
        console.error('Error saving website config to KV:', error);
    }
  };

  const handleSave = () => {
    onSave(localConfig, localSiteSettings);
    onSaveToolsConfig(localToolsConfig);
    onClose();
  };

  // ===== 工具配置辅助函数 =====
  const updateTools = (section: keyof ToolsConfig, value: any) => {
    setLocalToolsConfig(prev => ({ ...prev, [section]: value }));
  };

  const updateCity = (index: number, key: 'label' | 'timezone', value: string) => {
    updateTools('worldClock', {
      cities: localToolsConfig.worldClock.cities.map((c, i) => i === index ? { ...c, [key]: value } : c)
    });
  };

  const addCity = () => {
    updateTools('worldClock', {
      cities: [...localToolsConfig.worldClock.cities, { label: '', timezone: '' }]
    });
  };

  const removeCity = (index: number) => {
    updateTools('worldClock', {
      cities: localToolsConfig.worldClock.cities.filter((_, i) => i !== index)
    });
  };

  // ===== 工具模块管理 =====
  // 切换模块启用状态（以注册表为准补全配置）
  const toggleModule = (id: string) => {
    setLocalToolsConfig(prev => {
      const current = resolveModules(prev.modules);
      const next = current.map(m => m.id === id ? { ...m, enabled: !m.enabled } : m);
      return { ...prev, modules: next };
    });
  };

  // 拖拽排序
  const handleModuleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setLocalToolsConfig(prev => {
      const current = resolveModules(prev.modules);
      const oldIndex = current.findIndex(m => m.id === active.id);
      const newIndex = current.findIndex(m => m.id === over.id);
      if (oldIndex < 0 || newIndex < 0) return prev;
      const reordered = arrayMove(current, oldIndex, newIndex);
      // 按新顺序重写 order
      const withOrder = reordered.map((m, i) => ({ ...m, order: i + 1 }));
      return { ...prev, modules: withOrder };
    });
  };

  const moduleSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const handleBulkGenerate = async () => {
    if (!localConfig.apiKey) {
        alert("请先配置并保存 API Key");
        return;
    }

    const missingLinks = links.filter(l => !l.description);
    if (missingLinks.length === 0) {
        alert("所有链接都已有描述！");
        return;
    }

    if (!confirm(`发现 ${missingLinks.length} 个链接缺少描述，确定要使用 AI 自动生成吗？这可能需要一些时间。`)) return;

    setIsProcessing(true);
    shouldStopRef.current = false;
    setProgress({ current: 0, total: missingLinks.length });
    
    let currentLinks = [...links];

    for (let i = 0; i < missingLinks.length; i++) {
        if (shouldStopRef.current) break;

        const link = missingLinks[i];
        try {
            const desc = await generateLinkDescription(link.title, link.url, localConfig);
            currentLinks = currentLinks.map(l => l.id === link.id ? { ...l, description: desc } : l);
            onUpdateLinks(currentLinks);
            setProgress({ current: i + 1, total: missingLinks.length });
        } catch (e) {
            console.error(`Failed to generate for ${link.title}`, e);
        }
    }

    setIsProcessing(false);
  };

  const handleCopy = (text: string, key: string) => {
      navigator.clipboard.writeText(text);
      setCopiedStates(prev => ({ ...prev, [key]: true }));
      setTimeout(() => {
          setCopiedStates(prev => ({ ...prev, [key]: false }));
      }, 2000);
  };

  const handleLocalFaviconUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      if (!file.type.startsWith('image/')) {
          alert('请上传图片文件');
          e.target.value = '';
          return;
      }

      const reader = new FileReader();
      reader.onload = () => {
          if (typeof reader.result === 'string') {
              handleSiteChange('favicon', reader.result);
          }
      };
      reader.readAsDataURL(file);
      e.target.value = '';
  };

  const handleDownloadFile = (filename: string, content: string) => {
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
  };

  const getManifestJson = () => {
    const navName = localSiteSettings.navTitle || "CloudNav";
    const json: any = {
        manifest_version: 3,
        name: navName + " Pro",
        version: "7.6",
        minimum_chrome_version: "116",
        description: `${navName} - 侧边栏 + 弹窗双模式收藏助手`,
        permissions: ["activeTab", "scripting", "sidePanel", "storage", "favicon", "contextMenus", "notifications", "tabs"],
        // 跨域访问导航站 API 所需的站点权限（生成时取当前部署域名）
        host_permissions: [`${window.location.origin}/*`],
        background: {
            service_worker: "background.js"
        },
        action: {
            default_title: `打开 ${navName} 弹窗`
        },
        side_panel: {
            default_path: "sidebar.html"
        },
        icons: {
            "128": "icon.png"
        },
        commands: {
          "_execute_action": {
            "suggested_key": {
              "default": "Ctrl+Shift+E",
              "mac": "Command+Shift+E"
            },
            "description": `打开 ${navName} 弹窗`
          },
          "open_sidepanel": {
            "suggested_key": {
              "default": "Alt+Shift+E",
              "mac": "Option+Shift+E"
            },
            "description": `打开 ${navName} 侧边栏`
          }
        }
    };
    json.action.default_popup = "popup.html";
    
    if (browserType === 'firefox') {
        // Firefox MV3 不支持 chrome.sidePanel：移除 side_panel 与 sidePanel 权限（否则扩展无法加载），侧边栏退化为弹窗模式
        delete json.side_panel;
        json.permissions = json.permissions.filter((p: string) => p !== 'sidePanel');
        json.browser_specific_settings = {
            gecko: {
                id: "cloudnav@example.com",
                strict_min_version: "109.0"
            }
        };
    }
    
    return JSON.stringify(json, null, 2);
  };

const extBackgroundJs = `// background.js - ${localSiteSettings.navTitle || 'CloudNav'} Assistant v7.6
const CONFIG = {
  apiBase: ${JSON.stringify(domain)},
  password: ${JSON.stringify(password)},
  authTimestamp: ${JSON.stringify(localStorage.getItem('lastLoginTime') || '')},
  siteName: ${JSON.stringify(localSiteSettings.navTitle || 'CloudNav')}
};
const MODE_KEY = 'cloudnav_ui_mode';
const POPUP_PATH = 'popup.html';

let linkCache = [];
let categoryCache = [];

async function getUiMode() {
    const data = await chrome.storage.local.get(MODE_KEY);
    return data[MODE_KEY] === 'sidepanel' ? 'sidepanel' : 'popup';
}

async function setUiMode(mode) {
    await chrome.storage.local.set({ [MODE_KEY]: mode });
    await chrome.action.setPopup({ popup: mode === 'popup' ? POPUP_PATH : '' });
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: mode === 'sidepanel' }).catch(() => {});
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});
  setUiMode('popup').catch(() => {});
  refreshCache().then(buildMenus);
});

chrome.runtime.onStartup?.addListener(() => {
    getUiMode().then((mode) => setUiMode(mode)).catch(() => {});
});

chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.cloudnav_data) {
        refreshCache().then(buildMenus);
    }
    if (area === 'local' && changes[MODE_KEY]) {
        setUiMode(changes[MODE_KEY].newValue === 'sidepanel' ? 'sidepanel' : 'popup').catch(() => {});
    }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === 'open-sidepanel') {
        const targetWindowId = message.windowId || sender.tab?.windowId;
        if (targetWindowId) {
            setUiMode('sidepanel').then(() => chrome.sidePanel.open({ windowId: targetWindowId })).then(() => {
                sendResponse({ ok: true });
            }).catch((error) => {
                console.error('Failed to open side panel', error);
                sendResponse({ ok: false });
            });
            return true;
        }
    }
    if (message?.type === 'switch-to-popup') {
        setUiMode('popup').then(() => {
            sendResponse({ ok: true });
        }).catch((error) => {
            console.error('Failed to switch to popup', error);
            sendResponse({ ok: false });
        });
        return true;
    }
    return false;
});

async function refreshCache() {
    const data = await chrome.storage.local.get('cloudnav_data');
    if (data && data.cloudnav_data) {
        linkCache = data.cloudnav_data.links || [];
        categoryCache = data.cloudnav_data.categories || [];
    }
    return;
}

const windowPorts = {};

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'cloudnav_sidebar') return;
  port.onMessage.addListener((msg) => {
    if (msg.type === 'init' && msg.windowId) {
      windowPorts[msg.windowId] = port;
      port.onDisconnect.addListener(() => {
        if (windowPorts[msg.windowId] === port) {
          delete windowPorts[msg.windowId];
        }
      });
    }
  });
});

chrome.commands.onCommand.addListener(async (command) => {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.windowId) return;
        if (command === 'open_sidepanel') {
            await setUiMode('sidepanel');
            await chrome.sidePanel.open({ windowId: tab.windowId });
            return;
        }
        if (command === '_execute_action') {
            await setUiMode('popup');
            await chrome.action.openPopup();
        }
    } catch (e) {
        console.error('Failed to handle command', e);
    }
});

function buildMenus() {
    chrome.contextMenus.removeAll(() => {
        chrome.contextMenus.create({
            id: "cloudnav_root",
            title: \`⚡ 保存到 \${CONFIG.siteName}\`,
            contexts: ["page", "link", "action"]
        });

        if (categoryCache.length > 0) {
            categoryCache.forEach(cat => {
                chrome.contextMenus.create({
                    id: \`save_to_\${cat.id}\`,
                    parentId: "cloudnav_root",
                    title: cat.name,
                    contexts: ["page", "link", "action"]
                });
            });
        } else {
            chrome.contextMenus.create({
                id: "save_to_common",
                parentId: "cloudnav_root",
                title: "默认分类",
                contexts: ["page", "link", "action"]
            });
        }
    });
}

function updateMenuTitle(url) {
    if (!url) return;
    const cleanUrl = url.replace(/\\/$/, '').toLowerCase();
    const exists = linkCache.some(l => l.url && l.url.replace(/\\/$/, '').toLowerCase() === cleanUrl);
    const newTitle = exists ? \`⚠️ 已存在 - 保存到 \${CONFIG.siteName}\` : \`⚡ 保存到 \${CONFIG.siteName}\`;
    chrome.contextMenus.update("cloudnav_root", { title: newTitle }, () => {
        if (chrome.runtime.lastError) { }
    });
}

chrome.tabs.onActivated.addListener(async (activeInfo) => {
   try {
       const tab = await chrome.tabs.get(activeInfo.tabId);
       if (tab && tab.url) updateMenuTitle(tab.url);
   } catch(e){}
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
   if (changeInfo.status === 'complete' && tab.active && tab.url) {
       updateMenuTitle(tab.url);
   }
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (String(info.menuItemId).startsWith("save_to_")) {
        const catId = String(info.menuItemId).replace("save_to_", "");
        const title = tab.title;
        const url = info.linkUrl || tab.url;
        const cleanUrl = url.replace(/\\/$/, '').toLowerCase();
        const exists = linkCache.some(l => l.url.replace(/\\/$/, '').toLowerCase() === cleanUrl);
        saveLink(title, url, catId);
    }
});

async function saveLink(title, url, categoryId) {
    if (!CONFIG.password) {
        notify('保存失败', '未配置密码，请先在侧边栏登录。');
        return;
    }
    // 注意：不在提交前单独写入 favicon KV——图标由网页导入后统一回填，避免扩展侧写操作与网页端冲突

    // 本地 outbox（幂等）：网络/服务端失败时保留，指数退避自动重试
    const OUTBOX_KEY = 'cloudnav_outbox';
    async function pushOutbox(payload) {
        const data = await chrome.storage.local.get(OUTBOX_KEY);
        const list = data[OUTBOX_KEY] || [];
        list.push({ ...payload, retry: 0 });
        await chrome.storage.local.set({ [OUTBOX_KEY]: list.slice(-200) }); // 上限 200 条
    }
    async function flushOutbox() {
        const data = await chrome.storage.local.get(OUTBOX_KEY);
        const list = data[OUTBOX_KEY] || [];
        if (!list.length) return;
        const remain = [];
        for (const item of list) {
            try {
                const r = await fetch(\`\${CONFIG.apiBase}/api/link\`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-auth-password': CONFIG.password,
                        ...(CONFIG.authTimestamp ? { 'x-auth-issued-at': CONFIG.authTimestamp } : {})
                    },
                    body: JSON.stringify({ title: item.title, url: item.url, categoryId: item.categoryId })
                });
                if (r.status === 202 || r.ok) continue; // 提交成功，移出 outbox
                if (r.status === 401) {
                    notify('凭据已过期', '请登录网站后重新生成扩展');
                    remain.push(item);
                    continue;
                }
                remain.push({ ...item, retry: (item.retry || 0) + 1 }); // 429 / 5xx / 网络错误：保留
            } catch {
                remain.push({ ...item, retry: (item.retry || 0) + 1 });
            }
        }
        await chrome.storage.local.set({ [OUTBOX_KEY]: remain.slice(-200) });
        // 有剩余则指数退避重试（2s → 4s → 8s → 16s → 30s 封顶）
        if (remain.length && !flushOutbox.timer) {
            flushOutbox.timer = setTimeout(async () => {
                flushOutbox.timer = null;
                await flushOutbox();
            }, Math.min(30000, 2000 * Math.pow(2, Math.min(remain[0].retry || 0, 4))));
        }
    }

    try {
        const res = await fetch(\`\${CONFIG.apiBase}/api/link\`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'x-auth-password': CONFIG.password,
                ...(CONFIG.authTimestamp ? { 'x-auth-issued-at': CONFIG.authTimestamp } : {})
            },
            body: JSON.stringify({
                title: title || '未命名',
                url: url,
                categoryId: categoryId
            })
        });

        if (res.status === 202 || res.ok) {
            // 异步收件箱：已排队，由网页端合并导入
            notify('已提交', '已提交，打开导航页面后自动同步');
            chrome.runtime.sendMessage({ type: 'refresh' }).catch(() => {});
            await flushOutbox();
        } else if (res.status === 401) {
            notify('凭据已过期', '请登录网站后重新生成扩展');
            await pushOutbox({ title: title || '未命名', url, categoryId });
        } else if (res.status === 429) {
            notify('提交受限', '服务器繁忙，已加入本地队列自动重试');
            await pushOutbox({ title: title || '未命名', url, categoryId });
        } else {
            notify('提交失败', \`服务器错误: \${res.status}，已加入本地队列自动重试\`);
            await pushOutbox({ title: title || '未命名', url, categoryId });
        }
    } catch (e) {
        notify('提交失败', '网络请求错误，已加入本地队列自动重试');
        await pushOutbox({ title: title || '未命名', url, categoryId });
    }
}

function notify(title, message) {
    chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icon.png',
        title: title,
        message: message,
        priority: 1
    });
}
`;

  const extSidebarHtml = `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <style>
        :root {
            --bg: #ffffff;
            --text: #1e293b;
            --border: #e2e8f0;
            --hover: #f1f5f9;
            --accent: #3b82f6;
            --muted: #64748b;
        }
        @media (prefers-color-scheme: dark) {
            :root {
                --bg: #0f172a;
                --text: #f1f5f9;
                --border: #334155;
                --hover: #1e293b;
                --accent: #60a5fa;
                --muted: #94a3b8;
            }
        }
        html, body { width: 100%; min-width: 0; max-width: 100%; overflow-x: hidden; }
        * { box-sizing: border-box; min-width: 0; }
        body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: var(--bg); color: var(--text); padding-bottom: 20px; }
        
        .header { position: sticky; top: 0; padding: 10px 12px; background: var(--bg); border-bottom: 1px solid var(--border); z-index: 10; display: flex; gap: 8px; min-width: 0; }
        .search-input { flex: 1; min-width: 0; width: 0; padding: 6px 10px; border-radius: 6px; border: 1px solid var(--border); background: var(--hover); color: var(--text); outline: none; font-size: 13px; }
        .search-input:focus { border-color: var(--accent); }
        
        .refresh-btn { width: 30px; display: flex; align-items: center; justify-content: center; border: 1px solid var(--border); background: var(--hover); border-radius: 6px; color: var(--muted); cursor: pointer; transition: all 0.2s; }
        .refresh-btn:hover { color: var(--accent); border-color: var(--accent); }
        .refresh-btn:active { transform: scale(0.95); }
        .rotating { animation: spin 1s linear infinite; }
        @keyframes spin { 100% { transform: rotate(360deg); } }

        .content { padding: 4px; min-width: 0; }
        .cat-group { margin-bottom: 2px; }
        .cat-header { 
            padding: 8px 10px; font-size: 13px; font-weight: 600; color: var(--text); 
            cursor: pointer; display: flex; align-items: center; gap: 8px; border-radius: 6px;
            user-select: none; transition: background 0.1s;
        }
        .cat-header span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .cat-header:hover { background: var(--hover); }
        .cat-arrow { width: 14px; height: 14px; color: var(--muted); transition: transform 0.2s; }
        .cat-header.active .cat-arrow { transform: rotate(90deg); color: var(--accent); }
        
        .cat-links { display: none; padding-left: 8px; margin-bottom: 8px; }
        .cat-header.active + .cat-links { display: block; }
        
        .link-item { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 6px; text-decoration: none; color: var(--text); transition: background 0.1s; border-left: 2px solid transparent; }
        .link-item:hover { background: var(--hover); border-left-color: var(--accent); }
        .link-icon { width: 16px; height: 16px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; overflow: hidden; }
        .link-icon img { width: 100%; height: 100%; object-fit: contain; }
        .link-info { min-width: 0; flex: 1; }
        .link-title { font-size: 13px; font-weight: 400; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.2; }
        
        .empty { text-align: center; padding: 20px; color: var(--muted); font-size: 12px; }
        .loading { display: flex; justify-content: center; padding: 40px; color: var(--accent); font-size: 12px; }
    </style>
</head>
<body>
    <div class="header">
        <input type="text" id="search" class="search-input" placeholder="搜索..." autocomplete="off">
        <button id="switchPopup" class="refresh-btn" title="切到小窗">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9 4v16"/></svg>
        </button>
        <button id="refresh" class="refresh-btn" title="同步最新数据">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>
        </button>
    </div>
    <div id="content" class="content">
        <div class="loading">初始化...</div>
    </div>
    <script src="sidebar.js"></script>
</body>
</html>`;

const extSidebarJs = `const CONFIG = {
  apiBase: ${JSON.stringify(domain)},
  password: ${JSON.stringify(password)},
  authTimestamp: ${JSON.stringify(localStorage.getItem('lastLoginTime') || '')}
};
const CACHE_KEY = 'cloudnav_data';

let port = null;
try {
    port = chrome.runtime.connect({ name: 'cloudnav_sidebar' });
    chrome.windows.getCurrent((win) => {
        if (win && port) {
            port.postMessage({ type: 'init', windowId: win.id });
        }
    });

    port.onMessage.addListener((msg) => {
        if (msg.action === 'close_panel') {
            window.close();
        }
    });
} catch(e) {
    console.error('Connection failed', e);
}

document.addEventListener('DOMContentLoaded', async () => {
    const container = document.getElementById('content');
    const searchInput = document.getElementById('search');
    const refreshBtn = document.getElementById('refresh');
    const switchPopupBtn = document.getElementById('switchPopup');
    
    let allLinks = [];
    let allCategories = [];
    let expandedCats = new Set(); 

    const getArrowIcon = () => {
        return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="cat-arrow"><polyline points="9 18 15 12 9 6"></polyline></svg>';
    };

    const escapeHtml = (value) => String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    const getFaviconUrl = (pageUrl) => {
        try {
            const url = new URL(chrome.runtime.getURL("/_favicon/"));
            url.searchParams.set("pageUrl", pageUrl);
            url.searchParams.set("size", "32");
            return url.toString();
        } catch (e) {
            return '';
        }
    };

    const toggleCat = (id) => {
        const header = document.querySelector(\`.cat-header[data-id="\${id}"]\`);
        if (header) {
            header.classList.toggle('active');
            if (header.classList.contains('active')) {
                expandedCats.add(id);
            } else {
                expandedCats.delete(id);
            }
        }
    };

    container.addEventListener('click', (e) => {
        const header = e.target.closest('.cat-header');
        if (header) {
            toggleCat(header.dataset.id);
        }
    });

    const render = (filter = '') => {
        const q = filter.toLowerCase();
        let html = '';
        let hasContent = false;
        
        const isSearching = q.length > 0;

        allCategories.forEach(cat => {
            const catLinks = allLinks.filter(l => {
                const inCat = l.categoryId === cat.id;
                if (!inCat) return false;
                if (!q) return true;
                return l.title.toLowerCase().includes(q) || 
                       l.url.toLowerCase().includes(q) || 
                       (l.description && l.description.toLowerCase().includes(q));
            });

            if (catLinks.length === 0) return;
            hasContent = true;

            const isOpen = expandedCats.has(cat.id) || isSearching;
            const activeClass = isOpen ? 'active' : '';

            html += \`
            <div class="cat-group">
                <div class="cat-header \${activeClass}" data-id="\${cat.id}">
                    \${getArrowIcon()}
                    <span>\${cat.name}</span>
                </div>
                <div class="cat-links">
            \`;
            
            catLinks.forEach(link => {
                const iconSrc = getFaviconUrl(link.url);
                html += \`
                    <a href="\${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer" class="link-item">
                        <div class="link-icon"><img src="\${escapeHtml(iconSrc)}" /></div>
                        <div class="link-info">
                            <div class="link-title">\${escapeHtml(link.title)}</div>
                        </div>
                    </a>
                \`;
            });

            html += \`</div></div>\`;
        });

        if (!hasContent) {
            container.innerHTML = filter ? '<div class="empty">无搜索结果</div>' : '<div class="empty">暂无数据</div>';
        } else {
            container.innerHTML = html;
        }
    };

    const loadData = async (forceRefresh = false) => {
        try {
            if (!forceRefresh) {
                const cached = await chrome.storage.local.get(CACHE_KEY);
                if (cached[CACHE_KEY]) {
                    const data = cached[CACHE_KEY];
                    allLinks = data.links || [];
                    allCategories = data.categories || [];
                    render(searchInput.value);
                    return;
                }
            }

            refreshBtn.classList.add('rotating');
            container.innerHTML = '<div class="loading">同步数据中...</div>';
            
            const res = await fetch(\`\${CONFIG.apiBase}/api/storage\`, {
                headers: {
                    'x-auth-password': CONFIG.password,
                    ...(CONFIG.authTimestamp ? { 'x-auth-issued-at': CONFIG.authTimestamp } : {})
                }
            });
            
            if (!res.ok) throw new Error("Sync failed");
            
            const data = await res.json();
            allLinks = data.links || [];
            allCategories = data.categories || [];
            
            await chrome.storage.local.set({ [CACHE_KEY]: data });
            
            render(searchInput.value);
        } catch (e) {
            container.innerHTML = \`<div class="empty" style="color:#ef4444">加载失败: \${escapeHtml(e.message)}<br>请点击右上角刷新</div>\`;
        } finally {
            refreshBtn.classList.remove('rotating');
        }
    };

    loadData();

    searchInput.addEventListener('input', (e) => render(e.target.value));
    refreshBtn.addEventListener('click', () => loadData(true));
    switchPopupBtn?.addEventListener('click', async () => {
        try {
            await chrome.runtime.sendMessage({ type: 'switch-to-popup' });
            window.close();
        } catch (e) {
            console.error('Switch to popup failed', e);
        }
    });

    chrome.runtime.onMessage.addListener((msg) => {
        if (msg.type === 'refresh') {
            loadData(true);
        }
    });
});`;

const extPopupHtml = `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        :root {
            --bg: #f8fafc;
            --card: rgba(255,255,255,0.88);
            --text: #0f172a;
            --muted: #64748b;
            --line: rgba(148,163,184,0.22);
            --accent: #2563eb;
            --accent-soft: rgba(37,99,235,0.12);
        }
        @media (prefers-color-scheme: dark) {
            :root {
                --bg: #020617;
                --card: rgba(15,23,42,0.86);
                --text: #e2e8f0;
                --muted: #94a3b8;
                --line: rgba(148,163,184,0.18);
                --accent: #60a5fa;
                --accent-soft: rgba(96,165,250,0.16);
            }
        }
        * { box-sizing: border-box; }
        html, body { margin: 0; width: 388px; min-width: 388px; max-width: 388px; background:
          radial-gradient(circle at top, rgba(59,130,246,0.16), transparent 34%),
          linear-gradient(180deg, rgba(255,255,255,0.4), transparent 40%),
          var(--bg); color: var(--text); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
        body { padding: 14px; }
        .shell { display: flex; flex-direction: column; gap: 12px; max-height: 580px; }
        .hero { padding: 14px; border-radius: 18px; background: var(--card); backdrop-filter: blur(16px); border: 1px solid var(--line); box-shadow: 0 18px 60px rgba(15,23,42,0.10); }
        .hero-top { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
        .hero h1 { margin: 0; font-size: 16px; line-height: 1.2; }
        .hero p { margin: 4px 0 0; font-size: 12px; color: var(--muted); }
        .refresh-btn { width: 34px; height: 34px; border-radius: 12px; border: 1px solid var(--line); background: transparent; color: var(--muted); display: inline-flex; align-items: center; justify-content: center; cursor: pointer; }
        .refresh-btn:hover { color: var(--accent); border-color: rgba(37,99,235,0.28); background: var(--accent-soft); }
        .rotating { animation: spin 1s linear infinite; }
        @keyframes spin { 100% { transform: rotate(360deg); } }
        .search { margin-top: 12px; width: 100%; border: 1px solid var(--line); background: rgba(255,255,255,0.58); color: var(--text); border-radius: 14px; padding: 11px 13px; outline: none; font-size: 13px; }
        @media (prefers-color-scheme: dark) { .search { background: rgba(15,23,42,0.8); } }
        .chips { display: flex; gap: 8px; overflow-x: auto; padding: 2px 2px 0; }
        .chip { white-space: nowrap; border: 1px solid var(--line); background: transparent; color: var(--muted); border-radius: 999px; padding: 7px 11px; font-size: 12px; cursor: pointer; }
        .chip.active { color: white; background: var(--accent); border-color: transparent; box-shadow: 0 10px 28px rgba(37,99,235,0.25); }
        .results { display: flex; flex-direction: column; gap: 10px; }
        .card { display: flex; align-items: center; gap: 12px; padding: 12px; border-radius: 16px; background: var(--card); border: 1px solid var(--line); text-decoration: none; color: inherit; backdrop-filter: blur(12px); }
        .card:hover { transform: translateY(-1px); border-color: rgba(37,99,235,0.28); box-shadow: 0 14px 34px rgba(37,99,235,0.10); }
        .icon { width: 38px; height: 38px; border-radius: 12px; background: rgba(148,163,184,0.12); display: flex; align-items: center; justify-content: center; overflow: hidden; flex-shrink: 0; }
        .icon img { width: 100%; height: 100%; object-fit: cover; }
        .meta { min-width: 0; flex: 1; }
        .title { font-size: 13px; font-weight: 600; line-height: 1.3; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .url { margin-top: 3px; font-size: 11px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .badge { margin-top: 8px; display: inline-flex; padding: 4px 8px; border-radius: 999px; background: var(--accent-soft); color: var(--accent); font-size: 11px; }
        .empty { text-align: center; color: var(--muted); padding: 28px 12px; font-size: 12px; }
    </style>
</head>
<body>
    <div class="shell">
        <section class="hero">
            <div class="hero-top">
                <div>
                    <h1>${localSiteSettings.navTitle || 'CloudNav'} 扩展弹窗</h1>
                    <p>点这里能快速搜和存</p>
                </div>
                <div style="display:flex; gap:8px;">
                    <button id="openSidepanel" class="refresh-btn" title="打开侧边栏">
                        <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/></svg>
                    </button>
                    <button id="refresh" class="refresh-btn" title="同步最新数据">
                        <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>
                    </button>
                </div>
            </div>
            <input id="search" class="search" type="text" placeholder="搜标题、网址、描述" autocomplete="off">
        </section>
        <div id="chips" class="chips"></div>
        <div id="content" class="results">
            <div class="empty">初始化中...</div>
        </div>
    </div>
    <script src="popup.js"></script>
</body>
</html>`;

const extPopupJs = `const CONFIG = {
  apiBase: ${JSON.stringify(domain)},
  password: ${JSON.stringify(password)},
  authTimestamp: ${JSON.stringify(localStorage.getItem('lastLoginTime') || '')}
};
const CACHE_KEY = 'cloudnav_data';

document.addEventListener('DOMContentLoaded', async () => {
    const content = document.getElementById('content');
    const chips = document.getElementById('chips');
    const searchInput = document.getElementById('search');
    const refreshBtn = document.getElementById('refresh');
    const openSidepanelBtn = document.getElementById('openSidepanel');

    let allLinks = [];
    let allCategories = [];
    let activeCategory = 'all';

    const escapeHtml = (value) => String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    const getFaviconUrl = (link) => {
        if (link.icon) return link.icon;
        try {
            const url = new URL(chrome.runtime.getURL('/_favicon/'));
            url.searchParams.set('pageUrl', link.url);
            url.searchParams.set('size', '64');
            return url.toString();
        } catch (e) {
            return '';
        }
    };

    const getHostname = (rawUrl) => {
        try {
            return new URL(rawUrl).hostname.replace(/^www\\./, '');
        } catch (e) {
            return rawUrl;
        }
    };

    const renderChips = () => {
        const fallbackCategories = allCategories.length > 0
            ? allCategories
            : Array.from(new Set(allLinks.map((link) => link.categoryId)))
                .filter(Boolean)
                .map((categoryId) => ({ id: categoryId, name: categoryId }));
        const items = [{ id: 'all', name: '全部' }, ...fallbackCategories];
        chips.innerHTML = items.map((category) => \`
            <button class="chip \${activeCategory === category.id ? 'active' : ''}" data-id="\${category.id}">
                \${escapeHtml(category.name)}
            </button>
        \`).join('');
    };

    const render = () => {
        const query = searchInput.value.trim().toLowerCase();
        const filteredLinks = allLinks.filter((link) => {
            if (activeCategory !== 'all' && link.categoryId !== activeCategory) return false;
            if (!query) return true;
            return link.title.toLowerCase().includes(query) ||
                link.url.toLowerCase().includes(query) ||
                (link.description && link.description.toLowerCase().includes(query));
        });

        if (filteredLinks.length === 0) {
            content.innerHTML = '<div class="empty">这里还没有符合条件的链接</div>';
            return;
        }

        content.innerHTML = filteredLinks.map((link) => {
            const category = allCategories.find((item) => item.id === link.categoryId);
            return \`
                <a class="card" href="\${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer">
                    <div class="icon"><img src="\${escapeHtml(getFaviconUrl(link))}" alt=""></div>
                    <div class="meta">
                        <div class="title">\${escapeHtml(link.title)}</div>
                        <div class="url">\${escapeHtml(getHostname(link.url))}</div>
                        <div class="badge">\${escapeHtml(category?.name || '未分类')}</div>
                    </div>
                </a>
            \`;
        }).join('');
    };

    searchInput.addEventListener('input', render);
    chips.addEventListener('click', (event) => {
        const chip = event.target.closest('.chip');
        if (!chip) return;
        activeCategory = chip.dataset.id || 'all';
        renderChips();
        render();
    });
    openSidepanelBtn?.addEventListener('click', async () => {
        try {
            const currentWindow = await chrome.windows.getCurrent();
            await chrome.runtime.sendMessage({ type: 'open-sidepanel', windowId: currentWindow.id });
            window.close();
        } catch (e) {
            console.error('Open side panel failed', e);
        }
    });

    const loadData = async (forceRefresh = false) => {
        try {
            if (!forceRefresh) {
                const cached = await chrome.storage.local.get(CACHE_KEY);
                if (cached[CACHE_KEY]) {
                    allLinks = cached[CACHE_KEY].links || [];
                    allCategories = cached[CACHE_KEY].categories || [];
                    renderChips();
                    render();
                    return;
                }
            }

            refreshBtn.classList.add('rotating');
            const res = await fetch(\`\${CONFIG.apiBase}/api/storage\`, {
                headers: {
                    'x-auth-password': CONFIG.password,
                    ...(CONFIG.authTimestamp ? { 'x-auth-issued-at': CONFIG.authTimestamp } : {})
                }
            });
            if (!res.ok) throw new Error('同步失败');

            const data = await res.json();
            allLinks = data.links || [];
            allCategories = data.categories || [];
            await chrome.storage.local.set({ [CACHE_KEY]: data });
            renderChips();
            render();
        } catch (e) {
            content.innerHTML = \`<div class="empty" style="color:#ef4444">加载失败<br>\${escapeHtml(e.message)}</div>\`;
        } finally {
            refreshBtn.classList.remove('rotating');
        }
    };

    refreshBtn.addEventListener('click', () => loadData(true));

    chrome.runtime.onMessage.addListener((msg) => {
        if (msg.type === 'refresh') {
            loadData(true);
        }
    });

    loadData();
});`;

  const renderCodeBlock = (filename: string, code: string) => (
    <div className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden shrink-0">
        <div className="flex justify-between items-center bg-slate-50 dark:bg-slate-700/50 px-3 py-2 border-b border-slate-200 dark:border-slate-700">
            <span className="text-xs font-mono font-medium text-slate-600 dark:text-slate-300">{filename}</span>
            <div className="flex items-center gap-2">
                <button 
                    onClick={() => handleDownloadFile(filename, code)}
                    className="text-xs flex items-center gap-1 text-slate-600 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 hover:underline"
                    title="下载文件"
                >
                    <Download size={12}/>
                    Download
                </button>
                <div className="w-px h-3 bg-slate-300 dark:bg-slate-600"></div>
                <button 
                    onClick={() => handleCopy(code, filename)}
                    className="text-xs flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline"
                >
                    {copiedStates[filename] ? <Check size={12}/> : <Copy size={12}/>}
                    {copiedStates[filename] ? 'Copied' : 'Copy'}
                </button>
            </div>
        </div>
        <div className="bg-slate-900 p-3 overflow-x-auto">
            <pre className="text-[10px] md:text-xs font-mono text-slate-300 leading-relaxed whitespace-pre">
                {code}
            </pre>
        </div>
    </div>
  );

  const generateIconBlob = async (): Promise<Blob | null> => {
     const iconUrl = localSiteSettings.favicon;
     if (!iconUrl) return null;

     try {
         const img = new Image();
         img.crossOrigin = "anonymous";
         img.src = iconUrl;

         await new Promise((resolve, reject) => {
             img.onload = resolve;
             img.onerror = reject;
         });

         const canvas = document.createElement('canvas');
         canvas.width = 128;
         canvas.height = 128;
         const ctx = canvas.getContext('2d');
         if (!ctx) throw new Error('Canvas error');

         ctx.drawImage(img, 0, 0, 128, 128);

         return new Promise((resolve) => {
             canvas.toBlob((blob) => {
                 resolve(blob);
             }, 'image/png');
         });
     } catch (e) {
         console.error(e);
         return null;
     }
  };

  const handleDownloadIcon = async () => {
    const blob = await generateIconBlob();
    if (!blob) {
        alert("生成图片失败 (可能是跨域限制)。\n\n请尝试右键点击下方的预览图片，选择 '图片另存为...' 保存。");
        return;
    }
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = "icon.png";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  };

  const handleDownloadZip = async () => {
    setIsZipping(true);
    try {
        const zip = new JSZip();
        
        zip.file("manifest.json", getManifestJson());
        zip.file("background.js", extBackgroundJs);
        zip.file("sidebar.html", extSidebarHtml);
        zip.file("sidebar.js", extSidebarJs);
        zip.file("popup.html", extPopupHtml);
        zip.file("popup.js", extPopupJs);
        
        const iconBlob = await generateIconBlob();
        if (iconBlob) {
            zip.file("icon.png", iconBlob);
        } else {
            console.warn("Could not generate icon for zip");
            zip.file("icon_missing.txt", "Icon generation failed due to CORS. Please save the icon manually.");
        }

        const content = await zip.generateAsync({ type: "blob" });
        const url = window.URL.createObjectURL(content);
        const a = document.createElement('a');
        a.href = url;
        a.download = "CloudNav-Ext.zip";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        
    } catch(e) {
        console.error(e);
        alert("打包下载失败");
    } finally {
        setIsZipping(false);
    }
  };

  if (!isOpen) return null;

  const tabs = [
    { id: 'site', label: '网站设置', icon: LayoutTemplate },
    { id: 'ai', label: 'AI 设置', icon: Bot },
    { id: 'appearance', label: '外观', icon: Palette },
    { id: 'tools', label: '扩展工具', icon: Wrench },
    { id: 'utilities', label: '工具设置', icon: CloudSun },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-4xl overflow-hidden border border-slate-200 dark:border-slate-700 flex max-h-[90vh] flex-col md:flex-row">
        
        <div className="w-full md:w-48 bg-slate-50 dark:bg-slate-800/50 border-r border-slate-200 dark:border-slate-700 flex flex-row md:flex-col p-2 gap-1 overflow-x-auto shrink-0">
            {tabs.map(tab => (
                <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id as any)}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                        activeTab === tab.id 
                        ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' 
                        : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'
                    }`}
                >
                    <tab.icon size={18} />
                    {tab.label}
                </button>
            ))}
        </div>

        <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden bg-white dark:bg-slate-800">
             <div className="flex justify-between items-center p-4 border-b border-slate-200 dark:border-slate-700 shrink-0">
                <h3 className="text-lg font-semibold dark:text-white">设置</h3>
                <button onClick={onClose} className="p-1 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-full transition-colors">
                    <X className="w-5 h-5 dark:text-slate-400" />
                </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-6 pb-12">
                
                {activeTab === 'site' && (
                    <div className="space-y-6 animate-in fade-in duration-300">
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">网页标题 (Title)</label>
                                <input 
                                    type="text" 
                                    value={localSiteSettings.title}
                                    onChange={(e) => handleSiteChange('title', e.target.value)}
                                    className="w-full p-2 rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-blue-500"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">导航栏标题</label>
                                <input 
                                    type="text" 
                                    value={localSiteSettings.navTitle}
                                    onChange={(e) => handleSiteChange('navTitle', e.target.value)}
                                    className="w-full p-2 rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-blue-500"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">网站图标 (Favicon URL)</label>
                                <div className="flex gap-3 items-center">
                                    <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center overflow-hidden border border-slate-200 dark:border-slate-600">
                                        {localSiteSettings.favicon ? <img src={localSiteSettings.favicon} className="w-full h-full object-cover rounded-xl"/> : <Globe size={20} className="text-slate-400"/>}
                                    </div>
                                    <input 
                                        type="text" 
                                        value={localSiteSettings.favicon}
                                        onChange={(e) => handleSiteChange('favicon', e.target.value)}
                                        placeholder="https://example.com/favicon.ico"
                                        className="flex-1 p-2 rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-blue-500"
                                    />
                                </div>
                                <div className="mt-2 flex items-center gap-2">
                                    <input
                                        ref={faviconUploadRef}
                                        type="file"
                                        accept="image/*"
                                        className="hidden"
                                        onChange={handleLocalFaviconUpload}
                                    />
                                    <button
                                        type="button"
                                        onClick={() => faviconUploadRef.current?.click()}
                                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-600 px-3 py-1.5 text-xs text-slate-600 dark:text-slate-300 hover:border-blue-500 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                                    >
                                        <Upload size={12} />
                                        本地上传
                                    </button>
                                    <p className="text-xs text-slate-500">会直接存成图片数据，不用图床。</p>
                                </div>
                            </div>
                            <div>
                                <div className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-900/40 px-4 py-3">
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">访问时先验密</label>
                                        <p className="text-xs text-slate-500 mt-1">打开后，访问网站就先输密码。关闭后，只有点设置这些操作才验密。</p>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => handleSiteChange('requirePasswordOnVisit', !localSiteSettings.requirePasswordOnVisit)}
                                        className={`relative inline-flex h-8 w-14 items-center rounded-full border transition-all duration-200 ${
                                            localSiteSettings.requirePasswordOnVisit
                                              ? 'border-blue-500 bg-blue-600 shadow-[0_0_0_4px_rgba(59,130,246,0.12)]'
                                              : 'border-slate-300 bg-white dark:border-slate-600 dark:bg-slate-800'
                                        }`}
                                        aria-pressed={localSiteSettings.requirePasswordOnVisit}
                                    >
                                        <span
                                            className={`inline-flex h-6 w-6 items-center justify-center rounded-full bg-white shadow-sm transition-transform duration-200 ${
                                                localSiteSettings.requirePasswordOnVisit ? 'translate-x-7' : 'translate-x-1'
                                            }`}
                                        >
                                            <span className={`h-2.5 w-2.5 rounded-full ${localSiteSettings.requirePasswordOnVisit ? 'bg-blue-600' : 'bg-slate-400'}`} />
                                        </span>
                                    </button>
                                </div>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">身份验证过期天数</label>
                                <div className="relative">
                                    <input 
                                        type="number" 
                                        min="0"
                                        value={localSiteSettings.passwordExpiryDays}
                                        onChange={(e) => handleSiteChange('passwordExpiryDays', parseInt(e.target.value) || 0)}
                                        className="w-full p-2 rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-blue-500"
                                    />
                                </div>
                                <p className="text-xs text-slate-500 mt-1">设置为 0 表示永久不退出，默认 7 天后自动退出</p>
                            </div>

                            {/* 修改登录密码 */}
                            <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-900/40 p-4">
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">修改登录密码</label>
                                <p className="text-xs text-slate-500 mb-3">修改后需使用新密码登录（本地开发默认密码 123456）</p>
                                <div className="space-y-2">
                                    <input
                                        type="password"
                                        placeholder="当前密码"
                                        value={changePwd.old}
                                        onChange={(e) => setChangePwd({ ...changePwd, old: e.target.value })}
                                        className="w-full p-2 rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-blue-500"
                                    />
                                    <input
                                        type="password"
                                        placeholder="新密码（至少 8 位）"
                                        value={changePwd.next}
                                        onChange={(e) => setChangePwd({ ...changePwd, next: e.target.value })}
                                        className="w-full p-2 rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-blue-500"
                                    />
                                    <input
                                        type="password"
                                        placeholder="确认新密码"
                                        value={changePwd.confirm}
                                        onChange={(e) => setChangePwd({ ...changePwd, confirm: e.target.value })}
                                        className="w-full p-2 rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-blue-500"
                                    />
                                    {pwdState.msg && (
                                        <p className={`text-xs ${pwdState.status === 'error' ? 'text-red-500' : pwdState.status === 'ok' ? 'text-green-600' : 'text-slate-500'}`}>
                                            {pwdState.msg}
                                        </p>
                                    )}
                                    <button
                                        type="button"
                                        onClick={handleChangePassword}
                                        disabled={pwdState.status === 'loading'}
                                        className="w-full px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium disabled:opacity-60 transition-colors"
                                    >
                                        {pwdState.status === 'loading' ? '提交中...' : '确认修改密码'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {activeTab === 'ai' && (
                    <div className="space-y-6 animate-in fade-in duration-300">
                        {/* 接口类型：默认官方接口 + 自定义接口 */}
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">接口类型</label>
                            <div className="grid grid-cols-2 gap-2">
                                {(Object.keys(AI_PRESETS) as AIProvider[]).map(p => (
                                    <button
                                        key={p}
                                        type="button"
                                        onClick={() => handleProviderChange(p)}
                                        className={`p-3 rounded-xl border-2 transition-all text-left ${
                                            localConfig.provider === p
                                                ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                                                : 'border-slate-200 dark:border-slate-700 hover:border-blue-300 bg-white dark:bg-slate-800'
                                        }`}
                                    >
                                        <div className={`text-sm font-medium ${localConfig.provider === p ? 'text-blue-700 dark:text-blue-300' : 'text-slate-700 dark:text-slate-200'}`}>
                                            {AI_PRESETS[p].label}
                                        </div>
                                        <div className="text-[10px] text-slate-400 mt-0.5 truncate">
                                            {p === 'custom' ? '手动填写 Base URL' : AI_PRESETS[p].baseUrl || '官方 SDK 接入'}
                                        </div>
                                    </button>
                                ))}
                            </div>
                            <p className="text-xs text-slate-500 mt-1.5">
                                💡 默认官方接口：DeepSeek / OpenAI / Gemini，选择后自动填入接口地址与默认模型
                            </p>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">API Key</label>
                            <div className="relative">
                                <Key size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                <input 
                                    type="password" 
                                    value={localConfig.apiKey}
                                    onChange={(e) => handleChange('apiKey', e.target.value)}
                                    placeholder="sk-..."
                                    className="w-full pl-10 p-2 rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                                />
                            </div>
                            <p className="text-xs text-slate-500 mt-1">Key 仅存储在本地浏览器缓存中，不会发送到我们的服务器。</p>
                        </div>

                        {localConfig.provider !== 'gemini' && (
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Base URL (API 地址)</label>
                                <input 
                                    type="text" 
                                    value={localConfig.baseUrl}
                                    onChange={(e) => handleChange('baseUrl', e.target.value)}
                                    placeholder={localConfig.provider === 'custom' ? "https://你的接口地址/v1" : "https://api.openai.com/v1"}
                                    className="w-full p-2 rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-blue-500"
                                />
                                {localConfig.provider !== 'custom' && (
                                    <p className="text-xs text-slate-500 mt-1">官方接口地址已自动填入，可按需修改</p>
                                )}
                            </div>
                        )}

                        {/* 模型：手动输入 + 自动获取列表 */}
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">模型 (Model)</label>
                            <div className="flex gap-2">
                                <input 
                                    type="text" 
                                    value={localConfig.model}
                                    onChange={(e) => handleChange('model', e.target.value)}
                                    placeholder={AI_PRESETS[localConfig.provider]?.defaultModel || "模型名称"}
                                    className="flex-1 p-2 rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-blue-500"
                                    list={modelList.length > 0 ? 'ai-model-options' : undefined}
                                />
                                <button
                                    type="button"
                                    onClick={handleFetchModels}
                                    disabled={isFetchingModels || !localConfig.apiKey}
                                    className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-600 disabled:opacity-50 text-sm transition-colors"
                                    title="填入 API Key 后自动获取可用模型"
                                >
                                    {isFetchingModels
                                        ? <Loader2 size={14} className="animate-spin" />
                                        : <Sparkles size={14} />}
                                    获取模型
                                </button>
                            </div>
                            {modelList.length > 0 && (
                                <div className="mt-2">
                                    <datalist id="ai-model-options">
                                        {modelList.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                                    </datalist>
                                    <label className="block text-xs text-slate-500 mb-1">已获取 {modelList.length} 个模型，可下拉选择：</label>
                                    <select
                                        value={localConfig.model}
                                        onChange={(e) => handleChange('model', e.target.value)}
                                        className="w-full p-2 rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-blue-500"
                                    >
                                        {modelList.map(m => (
                                            <option key={m.id} value={m.id}>
                                                {m.name && m.name !== m.id ? `${m.name} (${m.id})` : m.id}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            )}
                            {modelFetchError && (
                                <p className="text-xs text-red-500 dark:text-red-400 mt-1.5 flex items-center gap-1">
                                    <AlertTriangle size={12} /> {modelFetchError}
                                </p>
                            )}
                            <p className="text-xs text-slate-500 mt-1">也可手动输入模型名（如 deepseek-chat / gpt-4o / gemini-2.5-flash）</p>
                        </div>

                        <div className="pt-4 border-t border-slate-100 dark:border-slate-700">
                            <h4 className="text-sm font-semibold mb-2 dark:text-slate-200">批量操作</h4>
                            {isProcessing ? (
                                <div className="space-y-2">
                                    <div className="flex justify-between text-xs text-slate-600 dark:text-slate-400">
                                        <span>正在生成描述... ({progress.current}/{progress.total})</span>
                                        <button onClick={() => { shouldStopRef.current = true; setIsProcessing(false); }} className="text-red-500 flex items-center gap-1 hover:underline">
                                            <PauseCircle size={12}/> 停止
                                        </button>
                                    </div>
                                    <div className="w-full h-2 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                                        <div className="h-full bg-blue-500 transition-all duration-300" style={{ width: `${(progress.current / progress.total) * 100}%` }}></div>
                                    </div>
                                </div>
                            ) : (
                                <button 
                                    onClick={handleBulkGenerate}
                                    className="flex items-center gap-2 text-sm text-purple-600 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-900/20 px-3 py-2 rounded-lg transition-colors border border-purple-200 dark:border-purple-800"
                                >
                                    <Sparkles size={16} /> 一键补全所有缺失的描述
                                </button>
                            )}
                        </div>
                    </div>
                )}

                {activeTab === 'tools' && (
                    <div className="space-y-8 animate-in fade-in duration-300">
                        
                        <div className="space-y-3">
                            <h4 className="font-medium text-slate-800 dark:text-slate-200 flex items-center gap-2">
                                <span className="flex items-center justify-center w-6 h-6 rounded-full bg-blue-100 text-blue-600 text-xs font-bold">1</span>
                                扩展地址
                            </h4>
                            <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl border border-slate-200 dark:border-slate-700">
                                <div>
                                    <label className="text-xs text-slate-500 mb-1 block">API 域名 (自动获取)</label>
                                    <code className="block w-full p-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded text-xs text-slate-600 dark:text-slate-400 font-mono truncate">
                                        {domain}
                                    </code>
                                </div>
                            </div>
                        </div>

                        <div className="space-y-3">
                            <h4 className="font-medium text-slate-800 dark:text-slate-200 flex items-center gap-2">
                                <span className="flex items-center justify-center w-6 h-6 rounded-full bg-blue-100 text-blue-600 text-xs font-bold">2</span>
                                选择浏览器类型
                            </h4>
                            <div className="grid grid-cols-2 gap-4">
                                <button 
                                    onClick={() => setBrowserType('chrome')}
                                    className={`p-4 rounded-xl border-2 transition-all flex flex-col items-center gap-2 ${browserType === 'chrome' ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300' : 'border-slate-200 dark:border-slate-700 hover:border-blue-300 bg-white dark:bg-slate-800'}`}
                                >
                                    <span className="font-semibold">Chrome / Edge</span>
                                </button>
                                <button 
                                    onClick={() => setBrowserType('firefox')}
                                    className={`p-4 rounded-xl border-2 transition-all flex flex-col items-center gap-2 ${browserType === 'firefox' ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300' : 'border-slate-200 dark:border-slate-700 hover:border-blue-300 bg-white dark:bg-slate-800'}`}
                                >
                                    <span className="font-semibold">Mozilla Firefox</span>
                                </button>
                            </div>
                            <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-2">
                                注意：侧边栏模式（side panel）仅 Chrome / Edge 支持，Firefox 将退化为弹窗模式。
                                扩展内嵌的登录凭证（Token）会随扩展存储，密码变更或会话过期后需重新生成扩展。
                            </p>
                        </div>

                        <div className="space-y-4">
                            <h4 className="font-medium text-slate-800 dark:text-slate-200 flex items-center gap-2">
                                <span className="flex items-center justify-center w-6 h-6 rounded-full bg-blue-100 text-blue-600 text-xs font-bold">3</span>
                                配置步骤与代码
                            </h4>
                            
                            <div className="bg-slate-50 dark:bg-slate-800/50 p-5 rounded-xl border border-slate-200 dark:border-slate-700">
                                <h5 className="font-semibold text-sm mb-3 dark:text-slate-200">
                                    安装指南 ({browserType === 'chrome' ? 'Chrome/Edge' : 'Firefox'} / 双模式插件):
                                </h5>
                                <ol className="list-decimal list-inside text-sm text-slate-600 dark:text-slate-400 space-y-2 leading-relaxed">
                                    <li>在电脑上新建文件夹 <code className="bg-white dark:bg-slate-900 px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-700 font-mono text-xs">CloudNav-Pro</code>。</li>
                                    <li><strong>[重要]</strong> 将下方图标保存为 <code className="bg-white dark:bg-slate-900 px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-700 font-mono text-xs">icon.png</code>。</li>
                                    <li>获取插件代码文件：
                                        <ul className="list-disc list-inside ml-4 mt-1 space-y-1 text-slate-500">
                                            <li><strong>方式一 (推荐)：</strong>点击下方的 <span className="text-blue-600 dark:text-blue-400 font-bold">"📦 一键下载所有文件"</span> 按钮，解压到该文件夹。</li>
                                            <li><strong>方式二 (备用)：</strong>分别点击下方代码块的 <Download size={12} className="inline"/> 按钮下载或复制 <code className="bg-white dark:bg-slate-900 px-1 rounded">manifest.json</code>, <code className="bg-white dark:bg-slate-900 px-1 rounded">background.js</code> 等文件到该文件夹。</li>
                                        </ul>
                                    </li>
                                    <li>
                                        打开浏览器扩展管理页面 
                                        {browserType === 'chrome' ? (
                                            <> (Chrome: <code className="select-all bg-white dark:bg-slate-900 px-1 rounded">chrome://extensions</code>)</>
                                        ) : (
                                            <> (Firefox: <code className="select-all bg-white dark:bg-slate-900 px-1 rounded">about:debugging</code>)</>
                                        )}。
                                    </li>
                                    <li className="text-blue-600 font-bold">操作关键点：</li>
                                    <li>1. 开启右上角的 "开发者模式" (Chrome)。</li>
                                    <li>2. 点击 "加载已解压的扩展程序"，选择包含上述文件的文件夹。</li>
                                    <li>3. 前往 <code className="select-all bg-white dark:bg-slate-900 px-1 rounded">chrome://extensions/shortcuts</code>。</li>
                                    <li>4. 点浏览器右上角插件图标，默认先弹出小窗。</li>
                                    <li>5. 在弹窗右上角点侧边栏按钮，就能切到侧边栏。</li>
                                    <li>6. <strong>[重要]</strong> 找到 "打开 CloudNav 弹窗" 和 "打开 CloudNav 侧边栏" 两个快捷键，按你习惯自己设。</li>
                                </ol>
                                
                                <div className="mt-4 mb-4">
                                    <button 
                                        onClick={handleDownloadZip}
                                        disabled={isZipping}
                                        className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-70 disabled:cursor-not-allowed text-white font-bold py-3 px-4 rounded-xl transition-colors shadow-lg shadow-blue-500/20"
                                    >
                                        <Package size={20} />
                                        {isZipping ? '打包中...' : '📦 一键下载所有文件 (v7.6 Pro)'}
                                    </button>
                                </div>
                                
                                <div className="p-3 bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-200 rounded border border-green-200 dark:border-green-900/50 text-sm space-y-2">
                                    <div className="font-bold flex items-center gap-2"><Zap size={16}/> 当前方案 (双模式):</div>
                                    <ul className="list-disc list-inside text-xs space-y-1">
                                        <li><strong>点扩展图标:</strong> 直接弹出小窗。</li>
                                        <li><strong>弹窗右上角按钮:</strong> 一下切到侧边栏。</li>
                                        <li><strong>网页右键:</strong> 直接展示分类列表 (支持判重警告)。</li>
                                        <li><strong>图标右键:</strong> 同上，统一为级联菜单。</li>
                                    </ul>
                                    <div className="text-xs text-amber-700 dark:text-amber-300 pt-1 border-t border-green-200 dark:border-green-800">
                                        保存采用「异步收件箱」：扩展提交后进入服务端收件箱，打开导航页面后自动合并导入（可能受 KV 最终一致性影响，延迟数秒出现）。
                                    </div>
                                </div>
                            </div>

                            <div className="p-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl flex items-center justify-between">
                                <div className="flex items-center gap-4">
                                     <div className="w-12 h-12 rounded-lg bg-slate-100 dark:bg-slate-700 flex items-center justify-center overflow-hidden border border-slate-200 dark:border-slate-600">
                                        {localSiteSettings.favicon ? <img src={localSiteSettings.favicon} className="w-full h-full object-cover"/> : <Globe size={24} className="text-slate-400"/>}
                                    </div>
                                    <div>
                                        <div className="font-medium text-sm dark:text-white">插件图标 (icon.png)</div>
                                        <div className="text-xs text-slate-500">请保存此图片为 icon.png</div>
                                    </div>
                                </div>
                                <button 
                                    onClick={handleDownloadIcon}
                                    className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 dark:bg-blue-900/30 dark:hover:bg-blue-900/50 dark:text-blue-400 rounded-lg transition-colors"
                                >
                                    <Download size={16} /> 下载图标
                                </button>
                            </div>

                            <div className="space-y-4">
                                <div className="flex items-center gap-2 text-sm font-medium text-slate-800 dark:text-slate-200 pt-2 border-t border-slate-100 dark:border-slate-700">
                                    <Sidebar size={18} className="text-purple-500"/> 核心配置
                                </div>
                                {renderCodeBlock('manifest.json', getManifestJson())}
                                {renderCodeBlock('background.js', extBackgroundJs)}
                                
                                <div className="flex items-center gap-2 text-sm font-medium text-slate-800 dark:text-slate-200 pt-2 border-t border-slate-100 dark:border-slate-700">
                                    <Keyboard size={18} className="text-green-500"/> 扩展弹窗界面
                                </div>
                                {renderCodeBlock('popup.html', extPopupHtml)}
                                {renderCodeBlock('popup.js', extPopupJs)}

                                <div className="flex items-center gap-2 text-sm font-medium text-slate-800 dark:text-slate-200 pt-2 border-t border-slate-100 dark:border-slate-700">
                                    <Sidebar size={18} className="text-purple-500"/> 侧边栏界面
                                </div>
                                {renderCodeBlock('sidebar.html', extSidebarHtml)}
                                {renderCodeBlock('sidebar.js', extSidebarJs)}
                            </div>
                        </div>
                    </div>
                )}

                {activeTab === 'appearance' && (
                    <div className="space-y-8 animate-in fade-in duration-300">
                        {/* ===== 背景设置 ===== */}
                        <div className="space-y-3">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <ImageIcon size={16} className="text-blue-500" />
                                    <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">背景壁纸</h3>
                                </div>
                                {/* 总开关 */}
                                <button
                                    onClick={() => setLocalSiteSettings(prev => ({ ...prev, background: { ...prev.background, enabled: !prev.background.enabled } }))}
                                    className={`relative w-11 h-6 rounded-full transition-colors ${bg.enabled ? 'bg-blue-600' : 'bg-slate-300 dark:bg-slate-600'}`}
                                >
                                    <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${bg.enabled ? 'translate-x-5' : ''}`} />
                                </button>
                            </div>

                            {bg.enabled && (
                                <>
                                    {/* 壁纸来源 */}
                                    <div className="grid grid-cols-3 gap-2">
                                        {([
                                            { id: 'bing', label: 'Bing 每日' },
                                            { id: 'custom', label: '自定义图片' },
                                            { id: 'solid', label: '纯色' },
                                        ] as const).map(opt => (
                                            <button
                                                key={opt.id}
                                                onClick={() => setLocalSiteSettings(prev => ({ ...prev, background: { ...prev.background, type: opt.id } }))}
                                                className={`px-3 py-2 rounded-xl text-xs font-medium border transition-colors ${
                                                    bg.type === opt.id
                                                        ? 'bg-blue-600 border-blue-600 text-white'
                                                        : 'bg-white dark:bg-slate-700 border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:border-blue-400'
                                                }`}
                                            >
                                                {opt.label}
                                            </button>
                                        ))}
                                    </div>

                                    {/* Bing 清晰度 */}
                                    {bg.type === 'bing' && (
                                        <div className="space-y-2">
                                            <p className="text-xs text-slate-500 dark:text-slate-400">
                                                Bing 每日壁纸，选择清晰度：
                                            </p>
                                            <div className="grid grid-cols-3 gap-2">
                                                {([
                                                    { id: '1080p', label: '1080P 高清' },
                                                    { id: '4k', label: '4K 超清' },
                                                    { id: 'mobile', label: '手机版' },
                                                ] as const).map(opt => (
                                                    <button
                                                        key={opt.id}
                                                        onClick={() => setLocalSiteSettings(prev => ({ ...prev, background: { ...prev.background, bingResolution: opt.id } }))}
                                                        className={`px-3 py-2 rounded-lg text-xs border transition-colors ${
                                                            bg.bingResolution === opt.id
                                                                ? 'bg-blue-600 border-blue-600 text-white'
                                                                : 'bg-white dark:bg-slate-700 border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300'
                                                        }`}
                                                    >
                                                        {opt.label}
                                                    </button>
                                                ))}
                                            </div>

                                            {/* 每日自动同步开关 */}
                                            <div className="flex items-center justify-between rounded-xl border border-slate-200 dark:border-slate-600 px-3 py-2">
                                                <div className="flex items-center gap-2">
                                                    <RefreshCw size={14} className="text-blue-500" />
                                                    <span className="text-xs text-slate-600 dark:text-slate-300">每日自动同步最新壁纸</span>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => setLocalSiteSettings(prev => ({ ...prev, background: { ...prev.background, dailySync: !(prev.background?.dailySync ?? true) } }))}
                                                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${bg.dailySync ? 'bg-blue-600' : 'bg-slate-300 dark:bg-slate-600'}`}
                                                    aria-pressed={bg.dailySync}
                                                >
                                                    <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform ${bg.dailySync ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
                                                </button>
                                            </div>

                                            {/* 立即同步按钮 */}
                                            <button
                                                type="button"
                                                onClick={() => onBingSync && onBingSync()}
                                                className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 dark:bg-blue-900/30 dark:hover:bg-blue-900/50 dark:text-blue-400 border border-blue-200 dark:border-blue-800 transition-colors"
                                            >
                                                <RefreshCw size={12} /> 立即同步最新壁纸
                                            </button>
                                        </div>
                                    )}

                                    {/* 自定义图片 */}
                                    {bg.type === 'custom' && (
                                        <div className="space-y-2">
                                            <label className="block text-xs text-slate-500 dark:text-slate-400">图片 URL（支持 https 图片链接）</label>
                                            <input
                                                type="text"
                                                value={bg.customUrl}
                                                onChange={e => setLocalSiteSettings(prev => ({ ...prev, background: { ...prev.background, customUrl: e.target.value } }))}
                                                placeholder="https://example.com/wallpaper.jpg"
                                                className="w-full px-3 py-2 rounded-xl bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-sm text-slate-700 dark:text-slate-200 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                            />
                                        </div>
                                    )}

                                    {/* 纯色 */}
                                    {bg.type === 'solid' && (
                                        <div className="space-y-2">
                                            <label className="block text-xs text-slate-500 dark:text-slate-400">选择颜色</label>
                                            <div className="flex items-center gap-3">
                                                <input
                                                    type="color"
                                                    value={bg.solidColor}
                                                    onChange={e => setLocalSiteSettings(prev => ({ ...prev, background: { ...prev.background, solidColor: e.target.value } }))}
                                                    className="w-12 h-9 rounded-lg border border-slate-200 dark:border-slate-600 bg-transparent cursor-pointer"
                                                />
                                                <div className="flex gap-1.5">
                                                    {['#1e293b', '#0f172a', '#334155', '#3b82f6', '#10b981', '#8b5cf6', '#f59e0b', '#ef4444'].map(c => (
                                                        <button
                                                            key={c}
                                                            onClick={() => setLocalSiteSettings(prev => ({ ...prev, background: { ...prev.background, solidColor: c } }))}
                                                            className={`w-7 h-7 rounded-lg transition-transform hover:scale-110 ${bg.solidColor === c ? 'ring-2 ring-blue-500 ring-offset-2 ring-offset-white dark:ring-offset-slate-800' : ''}`}
                                                            style={{ backgroundColor: c }}
                                                        />
                                                    ))}
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {/* 遮罩强度 */}
                                    <div className="space-y-1.5">
                                        <div className="flex items-center justify-between">
                                            <label className="text-xs text-slate-500 dark:text-slate-400">遮罩强度（保证文字清晰）</label>
                                            <span className="text-xs text-slate-400 tabular-nums">{Math.round((bg.overlayOpacity ?? 0.35) * 100)}%</span>
                                        </div>
                                        <input
                                            type="range"
                                            min="0"
                                            max="0.7"
                                            step="0.05"
                                            value={bg.overlayOpacity ?? 0.35}
                                            onChange={e => setLocalSiteSettings(prev => ({ ...prev, background: { ...prev.background, overlayOpacity: parseFloat(e.target.value) } }))}
                                            className="w-full accent-blue-600"
                                        />
                                    </div>

                                    {/* 壁纸图片透明度（仅图片模式） */}
                                    {bg.type !== 'solid' && (
                                        <div className="space-y-1.5">
                                            <div className="flex items-center justify-between">
                                                <label className="text-xs text-slate-500 dark:text-slate-400">壁纸透明度（让底色透出）</label>
                                                <span className="text-xs text-slate-400 tabular-nums">{Math.round((bg.imageOpacity ?? 1) * 100)}%</span>
                                            </div>
                                            <input
                                                type="range"
                                                min="0.3"
                                                max="1"
                                                step="0.05"
                                                value={bg.imageOpacity ?? 1}
                                                onChange={e => setLocalSiteSettings(prev => ({ ...prev, background: { ...prev.background, imageOpacity: parseFloat(e.target.value) } }))}
                                                className="w-full accent-blue-600"
                                            />
                                        </div>
                                    )}
                                </>
                            )}
                        </div>

                        {/* ===== 导航栏标题对齐 ===== */}
                        <div className="space-y-2">
                            <div className="flex items-center gap-2">
                                <AlignLeft size={16} className="text-orange-500" />
                                <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">导航栏标题对齐</h3>
                            </div>
                            <div className="grid grid-cols-3 gap-2">
                                {([
                                    { id: 'left', label: '居左', icon: '←' },
                                    { id: 'center', label: '居中', icon: '↔' },
                                    { id: 'right', label: '居右', icon: '→' },
                                ] as const).map(opt => (
                                    <button
                                        key={opt.id}
                                        onClick={() => setLocalSiteSettings(prev => ({ ...prev, navTitleAlign: opt.id }))}
                                        className={`px-3 py-2 rounded-xl text-sm border transition-colors flex items-center justify-center gap-1.5 ${
                                            (localSiteSettings.navTitleAlign || 'left') === opt.id
                                                ? 'bg-orange-600 border-orange-600 text-white'
                                                : 'bg-white dark:bg-slate-700 border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:border-orange-400'
                                        }`}
                                    >
                                        <span className="text-xs">{opt.icon}</span> {opt.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* ===== 字体设置 ===== */}
                        <div className="space-y-3">
                            <div className="flex items-center gap-2">
                                <Type size={16} className="text-purple-500" />
                                <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">全局字体</h3>
                            </div>

                            <div className="grid grid-cols-3 gap-2">
                                {([
                                    { label: '系统默认', value: '' },
                                    { label: '微软雅黑', value: "'Microsoft YaHei', '微软雅黑', sans-serif" },
                                    { label: '黑体', value: "'SimHei', '黑体', sans-serif" },
                                    { label: '宋体', value: "'SimSun', '宋体', serif" },
                                    { label: '楷体', value: "'KaiTi', '楷体', serif" },
                                    { label: '仿宋', value: "'FangSong', '仿宋', serif" },
                                    { label: '隶书', value: "'LiSu', '隶书', cursive" },
                                    { label: '幼圆', value: "'YouYuan', '幼圆', sans-serif" },
                                    { label: '等线', value: "'DengXian', '等线', sans-serif" },
                                    { label: '思源黑体', value: "'Source Han Sans SC', 'Noto Sans SC', sans-serif" },
                                    { label: '苹方', value: "'PingFang SC', 'Microsoft YaHei', sans-serif" },
                                    { label: '华文行楷', value: "'STXingkai', '华文行楷', cursive" },
                                    { label: '华文新魏', value: "'STXinwei', '华文新魏', cursive" },
                                    { label: '华文细黑', value: "'STXihei', '华文细黑', sans-serif" },
                                    { label: '华文楷体', value: "'STKaiti', '华文楷体', serif" },
                                    { label: '华文仿宋', value: "'STFangsong', '华文仿宋', serif" },
                                    { label: '华文宋体', value: "'STSong', '华文宋体', serif" },
                                    { label: '方正舒体', value: "'FZShuTi', '方正舒体', cursive" },
                                    { label: 'Arial', value: "'Arial', 'Helvetica', sans-serif" },
                                    { label: 'Georgia', value: "'Georgia', 'Times New Roman', serif" },
                                ] as const).map(opt => (
                                    <button
                                        key={opt.label}
                                        onClick={() => setLocalSiteSettings(prev => ({ ...prev, font: { family: opt.value } }))}
                                        className={`px-3 py-2.5 rounded-xl text-sm border transition-colors text-left ${
                                            (localSiteSettings.font?.family || '') === opt.value
                                                ? 'bg-purple-600 border-purple-600 text-white'
                                                : 'bg-white dark:bg-slate-700 border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:border-purple-400'
                                        }`}
                                        style={opt.value ? { fontFamily: opt.value } : undefined}
                                    >
                                        {opt.label}
                                    </button>
                                ))}
                            </div>

                            <div className="space-y-1.5">
                                <label className="block text-xs text-slate-500 dark:text-slate-400">自定义字体（CSS font-family）</label>
                                <input
                                    type="text"
                                    value={localSiteSettings.font?.family || ''}
                                    onChange={e => setLocalSiteSettings(prev => ({ ...prev, font: { family: e.target.value } }))}
                                    placeholder="'Noto Serif SC', serif"
                                    className="w-full px-3 py-2 rounded-xl bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-sm text-slate-700 dark:text-slate-200 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-500"
                                />
                            </div>

                            {/* 字体预览 */}
                            <div className="px-4 py-3 rounded-xl border border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-700/30">
                                <p className="text-sm text-slate-600 dark:text-slate-300" style={{ fontFamily: localSiteSettings.font?.family || undefined }}>
                                    字体预览：CloudNav 云航导航 · 2026年8月10日 星期一
                                </p>
                            </div>
                        </div>
                    </div>
                )}

                {activeTab === 'utilities' && (
                    <div className="space-y-8 animate-in fade-in duration-300">

                        {/* 工具模块管理 */}
                        <div className="space-y-3">
                            <h4 className="font-medium text-slate-800 dark:text-slate-200 flex items-center gap-2">
                                <Wrench size={18} className="text-blue-500" /> 工具模块管理
                            </h4>
                            <p className="text-xs text-slate-500">
                                拖动调整显示顺序，开关控制是否启用。启用的模块会显示在首页实用工具区，新增工具模块会自动出现在列表中。
                            </p>
                            <DndContext sensors={moduleSensors} collisionDetection={closestCenter} onDragEnd={handleModuleDragEnd}>
                                <SortableContext items={resolveModules(localToolsConfig.modules).map(m => m.id)} strategy={verticalListSortingStrategy}>
                                    <div className="space-y-2">
                                        {resolveModules(localToolsConfig.modules).map(m => {
                                            const def = TOOL_MODULES.find(t => t.id === m.id);
                                            if (!def) return null;
                                            return (
                                                <ModuleSortableRow
                                                    key={m.id}
                                                    id={m.id}
                                                    icon={def.icon}
                                                    label={def.label}
                                                    description={def.description}
                                                    enabled={m.enabled}
                                                    onToggle={() => toggleModule(m.id)}
                                                />
                                            );
                                        })}
                                    </div>
                                </SortableContext>
                            </DndContext>
                        </div>

                        {/* 天气 */}
                        <div className="space-y-4">
                            <h4 className="font-medium text-slate-800 dark:text-slate-200 flex items-center gap-2">
                                <CloudSun size={18} className="text-blue-500" /> 天气
                            </h4>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">数据源</label>
                                <select
                                    value={localToolsConfig.weather.provider}
                                    onChange={(e) => updateTools('weather', { ...localToolsConfig.weather, provider: e.target.value as any })}
                                    className="w-full p-2 rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-blue-500"
                                >
                                    <option value="qweather">和风天气 (QWeather) — 默认</option>
                                    <option value="openweather">OpenWeatherMap</option>
                                </select>
                            </div>
                            {localToolsConfig.weather.provider === 'qweather' ? (
                                <>
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">和风天气 API Key</label>
                                        <input
                                            type="password"
                                            value={localToolsConfig.weather.qweatherKey}
                                            onChange={(e) => updateTools('weather', { ...localToolsConfig.weather, qweatherKey: e.target.value })}
                                            placeholder="申请地址: https://dev.qweather.com/"
                                            className="w-full p-2 rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">和风天气 API Host</label>
                                        <input
                                            type="text"
                                            value={localToolsConfig.weather.qweatherHost || 'https://devapi.qweather.com'}
                                            onChange={(e) => updateTools('weather', { ...localToolsConfig.weather, qweatherHost: e.target.value })}
                                            placeholder="https://devapi.qweather.com"
                                            className="w-full p-2 rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                                        />
                                        <p className="text-xs text-slate-500 mt-1">
                                          登录和风控制台 → <span className="text-blue-500">设置</span>（console.qweather.com/setting/）查看你的 API Host，默认 <code className="font-mono">https://devapi.qweather.com</code>；若请求报 403 Invalid Host 请填控制台中显示的地址
                                        </p>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">LocationID（城市 ID）</label>
                                        <input
                                            type="text"
                                            value={localToolsConfig.weather.qweatherLocationId}
                                            onChange={(e) => updateTools('weather', { ...localToolsConfig.weather, qweatherLocationId: e.target.value })}
                                            placeholder="如 101010100（北京）"
                                            className="w-full p-2 rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-blue-500"
                                        />
                                        <p className="text-xs text-slate-500 mt-1">在和风天气控制台「城市列表」中查找对应城市的 LocationID</p>
                                    </div>
                                </>
                            ) : (
                                <>
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">OpenWeatherMap API Key</label>
                                        <input
                                            type="password"
                                            value={localToolsConfig.weather.openweatherKey}
                                            onChange={(e) => updateTools('weather', { ...localToolsConfig.weather, openweatherKey: e.target.value })}
                                            placeholder="申请地址: https://openweathermap.org/"
                                            className="w-full p-2 rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">城市名（英文）</label>
                                        <input
                                            type="text"
                                            value={localToolsConfig.weather.openweatherCity}
                                            onChange={(e) => updateTools('weather', { ...localToolsConfig.weather, openweatherCity: e.target.value })}
                                            placeholder="如 Beijing / Shanghai / London"
                                            className="w-full p-2 rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-blue-500"
                                        />
                                    </div>
                                </>
                            )}
                        </div>

                        {/* 快捷翻译 */}
                        <div className="space-y-4">
                            <h4 className="font-medium text-slate-800 dark:text-slate-200 flex items-center gap-2">
                                <Languages size={18} className="text-purple-500" /> 快捷翻译
                            </h4>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">默认目标语言</label>
                                <select
                                    value={localToolsConfig.translate.targetLang}
                                    onChange={(e) => updateTools('translate', { ...localToolsConfig.translate, targetLang: e.target.value })}
                                    className="w-full p-2 rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-blue-500"
                                >
                                    <option value="zh-CN">中文（简体）</option>
                                    <option value="en">English</option>
                                    <option value="ja">日本語</option>
                                    <option value="ko">한국어</option>
                                    <option value="fr">Français</option>
                                    <option value="de">Deutsch</option>
                                    <option value="es">Español</option>
                                    <option value="ru">Русский</option>
                                </select>
                            </div>
                            {/* 角色设定 */}
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">角色设定</label>
                                <input
                                    type="text"
                                    value={localToolsConfig.translate.role || ''}
                                    onChange={(e) => updateTools('translate', { ...localToolsConfig.translate, role: e.target.value })}
                                    placeholder="如：专业翻译助手、医学翻译专家"
                                    className="w-full p-2 rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                                />
                                <div className="flex flex-wrap gap-1.5 mt-2">
                                    {['专业翻译助手', '技术文档翻译', '医学翻译专家', '法律翻译专员', '商务翻译', '文学翻译'].map(p => (
                                        <button
                                            key={p}
                                            type="button"
                                            onClick={() => updateTools('translate', { ...localToolsConfig.translate, role: p })}
                                            className={`px-2 py-1 rounded-lg text-[11px] border transition-colors ${
                                                localToolsConfig.translate.role === p
                                                    ? 'bg-purple-600 border-purple-600 text-white'
                                                    : 'bg-white dark:bg-slate-700 border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:border-purple-400'
                                            }`}
                                        >
                                            {p}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* 行业领域 */}
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">行业领域（专业术语翻译）</label>
                                <input
                                    type="text"
                                    value={localToolsConfig.translate.industry || ''}
                                    onChange={(e) => updateTools('translate', { ...localToolsConfig.translate, industry: e.target.value })}
                                    placeholder="如：通用、医疗、法律、技术、金融"
                                    className="w-full p-2 rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                                />
                                <div className="flex flex-wrap gap-1.5 mt-2">
                                    {['通用', '医疗', '法律', '金融', '技术', '学术', '营销', '游戏'].map(i => (
                                        <button
                                            key={i}
                                            type="button"
                                            onClick={() => updateTools('translate', { ...localToolsConfig.translate, industry: i })}
                                            className={`px-2 py-1 rounded-lg text-[11px] border transition-colors ${
                                                localToolsConfig.translate.industry === i
                                                    ? 'bg-purple-600 border-purple-600 text-white'
                                                    : 'bg-white dark:bg-slate-700 border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:border-purple-400'
                                            }`}
                                        >
                                            {i}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* 翻译要求（多选） */}
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">翻译要求（可多选）</label>
                                <div className="flex flex-wrap gap-1.5">
                                    {['术语保留原文', '专业术语精准', '语气正式', '语气口语化', '直译为主', '意译为主', '简洁精炼', '保留原文格式'].map(r => {
                                        const reqs = localToolsConfig.translate.requirements || [];
                                        const active = reqs.includes(r);
                                        return (
                                            <button
                                                key={r}
                                                type="button"
                                                onClick={() => updateTools('translate', {
                                                    ...localToolsConfig.translate,
                                                    requirements: active ? reqs.filter(x => x !== r) : [...reqs, r],
                                                })}
                                                className={`px-2 py-1 rounded-lg text-[11px] border transition-colors ${
                                                    active
                                                        ? 'bg-purple-600 border-purple-600 text-white'
                                                        : 'bg-white dark:bg-slate-700 border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:border-purple-400'
                                                }`}
                                            >
                                                {active ? '✓ ' : ''}{r}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* 自定义补充提示词 */}
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">自定义补充提示词（可选）</label>
                                <textarea
                                    value={localToolsConfig.translate.prompt || ''}
                                    onChange={(e) => updateTools('translate', { ...localToolsConfig.translate, prompt: e.target.value })}
                                    rows={3}
                                    placeholder="如：使用简洁地道的表达，专有名词首次出现时附原文..."
                                    className="w-full p-2 rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-blue-500 resize-none text-sm"
                                />
                                <p className="text-xs text-slate-500 mt-1">角色、行业、翻译要求将自动组合为系统提示词，自定义内容追加在末尾；目标语言始终自动注入</p>
                            </div>
                            <div className="rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800/40 p-3 text-xs text-blue-700 dark:text-blue-300">
                                💡 翻译复用「AI 设置」中的 Key 与模型：使用 <b>DeepSeek</b> 时，AI 提供商选择「OpenAI Compatible」，并在 Base URL 填写 <code className="font-mono">https://api.deepseek.com/v1</code>、模型填写 <code className="font-mono">deepseek-chat</code>
                            </div>
                        </div>

                        {/* 世界时间 */}
                        <div className="space-y-4">
                            <h4 className="font-medium text-slate-800 dark:text-slate-200 flex items-center gap-2">
                                <Globe2 size={18} className="text-green-500" /> 世界时间
                            </h4>
                            <div className="space-y-2">
                                {localToolsConfig.worldClock.cities.map((city, i) => (
                                    <div key={i} className="flex gap-2 items-center">
                                        <input
                                            type="text"
                                            value={city.label}
                                            onChange={(e) => updateCity(i, 'label', e.target.value)}
                                            placeholder="城市名，如 北京"
                                            className="flex-1 p-2 rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-blue-500"
                                        />
                                        <input
                                            type="text"
                                            value={city.timezone}
                                            onChange={(e) => updateCity(i, 'timezone', e.target.value)}
                                            placeholder="Asia/Shanghai"
                                            className="flex-1 p-2 rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-blue-500 font-mono text-xs"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => removeCity(i)}
                                            className="p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                                            title="删除城市"
                                        >
                                            <Trash2 size={15} />
                                        </button>
                                    </div>
                                ))}
                            </div>
                            <button
                                type="button"
                                onClick={addCity}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800/50 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
                            >
                                <Plus size={14} /> 添加城市
                            </button>
                            <p className="text-xs text-slate-500">时区使用 IANA 格式，如 Asia/Tokyo、Europe/London、America/New_York</p>
                        </div>

                        {/* 汇率 */}
                        <div className="space-y-4">
                            <h4 className="font-medium text-slate-800 dark:text-slate-200 flex items-center gap-2">
                                <Coins size={18} className="text-amber-500" /> 汇率转换
                            </h4>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">exchangerate-api Key</label>
                                <input
                                    type="password"
                                    value={localToolsConfig.currency.apiKey}
                                    onChange={(e) => updateTools('currency', { ...localToolsConfig.currency, apiKey: e.target.value })}
                                    placeholder="申请地址: https://www.exchangerate-api.com/"
                                    className="w-full p-2 rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">基础币种</label>
                                <input
                                    type="text"
                                    value={localToolsConfig.currency.baseCurrency}
                                    onChange={(e) => updateTools('currency', { ...localToolsConfig.currency, baseCurrency: e.target.value.toUpperCase() })}
                                    placeholder="如 CNY / USD / EUR"
                                    className="w-full p-2 rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">常用币种（逗号分隔）</label>
                                <input
                                    type="text"
                                    value={localToolsConfig.currency.favorites.join(',')}
                                    onChange={(e) => updateTools('currency', { ...localToolsConfig.currency, favorites: e.target.value.split(',').map(s => s.trim().toUpperCase()).filter(Boolean) })}
                                    placeholder="USD,CNY,EUR,JPY,GBP"
                                    className="w-full p-2 rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                                />
                            </div>
                        </div>
                    </div>
                )}

            </div>

            <div className="p-4 border-t border-slate-200 dark:border-slate-700 flex justify-end bg-slate-50 dark:bg-slate-800/50 shrink-0">
                <button 
                    onClick={handleSave}
                    className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg font-medium transition-colors shadow-lg shadow-blue-500/20"
                >
                    <Save size={18} /> 保存更改
                </button>
            </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;
