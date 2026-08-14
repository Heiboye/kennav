
import React, { useState, useEffect, useMemo, useRef, useCallback, lazy, Suspense } from 'react';
import { 
  Search, Plus, Upload, Moon, Sun, Menu, 
  Trash2, Loader2, Cloud, CheckCircle2, AlertCircle,
  Pin, Settings, Lock, CloudCog, GripVertical, Save, CheckSquare, LogOut, ExternalLink, X,
  ChevronDown, Eye, EyeOff
} from 'lucide-react';
import {
  DndContext,
  DragEndEvent,
  closestCorners,
  PointerSensor,
  useSensor,
  useSensors,
  KeyboardSensor,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  rectSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { LinkItem, Category, DEFAULT_CATEGORIES, INITIAL_LINKS, WebDavConfig, AIConfig, SearchMode, ExternalSearchSource, SearchConfig, ToolsConfig, DEFAULT_TOOLS_CONFIG, SiteSettings } from './types';
import Icon from './components/Icon';
import BackgroundLayer from './components/BackgroundLayer';
// 大弹窗懒加载：减少首屏主包体积（SettingsModal 约 137KB / LinkModal 25KB / ImportModal 20KB / BackupModal 17KB 等）
const LinkModal = lazy(() => import('./components/LinkModal'));
import AuthModal from './components/AuthModal';
const CategoryManagerModal = lazy(() => import('./components/CategoryManagerModal'));
const BackupModal = lazy(() => import('./components/BackupModal'));
import CategoryAuthModal from './components/CategoryAuthModal';
const ImportModal = lazy(() => import('./components/ImportModal'));
const SettingsModal = lazy(() => import('./components/SettingsModal'));
import ToolsPanel from './components/ToolsPanel';
const SearchConfigModal = lazy(() => import('./components/SearchConfigModal'));
import ContextMenu from './components/ContextMenu';
import QRCodeModal from './components/QRCodeModal';

// --- 配置项 ---
const LOCAL_STORAGE_KEY = 'cloudnav_data_cache';
const AUTH_KEY = 'cloudnav_auth_token';
const AUTH_TIME_KEY = 'lastLoginTime';
const SITE_SETTINGS_KEY = 'cloudnav_site_settings';

// 数据校验：云端/KV/备份可能被旧版本或手工脚本写入畸形结构，统一清洗后再进入 React 状态，避免渲染期崩溃
const sanitizeLinks = (raw: any): LinkItem[] =>
  Array.isArray(raw) ? raw.filter((l: any) =>
    l && typeof l === 'object' && typeof l.id === 'string' &&
    typeof l.url === 'string' && typeof l.title === 'string' &&
    /^https?:\/\//i.test(l.url) && // 仅接受 http/https，剔除危险协议
    (l.categoryId === undefined || typeof l.categoryId === 'string') &&
    (l.createdAt === undefined || typeof l.createdAt === 'number') &&
    (l.pinned === undefined || typeof l.pinned === 'boolean') &&
    (l.hidden === undefined || typeof l.hidden === 'boolean')
  ) : [];
const sanitizeCategories = (raw: any): Category[] =>
  Array.isArray(raw) ? raw.filter((c: any) =>
    c && typeof c === 'object' && typeof c.id === 'string' && typeof c.name === 'string'
  ) : [];
const WEBDAV_CONFIG_KEY = 'cloudnav_webdav_config';
const AI_CONFIG_KEY = 'cloudnav_ai_config';
const SEARCH_CONFIG_KEY = 'cloudnav_search_config';
const TOOLS_CONFIG_KEY = 'cloudnav_tools_config';

const createRoundedFavicon = (source: string): Promise<string> => {
  return new Promise((resolve) => {
    if (!source) {
      resolve(source);
      return;
    }

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const size = 64;
        const radius = 14;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');

        if (!ctx) {
          resolve(source);
          return;
        }

        ctx.beginPath();
        ctx.moveTo(radius, 0);
        ctx.lineTo(size - radius, 0);
        ctx.quadraticCurveTo(size, 0, size, radius);
        ctx.lineTo(size, size - radius);
        ctx.quadraticCurveTo(size, size, size - radius, size);
        ctx.lineTo(radius, size);
        ctx.quadraticCurveTo(0, size, 0, size - radius);
        ctx.lineTo(0, radius);
        ctx.quadraticCurveTo(0, 0, radius, 0);
        ctx.closePath();
        ctx.clip();
        ctx.drawImage(img, 0, 0, size, size);
        resolve(canvas.toDataURL('image/png'));
      } catch (e) {
        resolve(source);
      }
    };
    img.onerror = () => resolve(source);
    img.src = source;
  });
};

function App() {
  const themeButtonRef = useRef<HTMLButtonElement | null>(null);
  const themeTransitionTimerRef = useRef<number | null>(null);

  // --- State ---
  const [links, setLinks] = useState<LinkItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [darkMode, setDarkMode] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  
  // Search Mode State
  const [searchMode, setSearchMode] = useState<SearchMode>('internal');
  const [externalSearchSources, setExternalSearchSources] = useState<ExternalSearchSource[]>([]);
  
  // Category Security State
  const [unlockedCategoryIds, setUnlockedCategoryIds] = useState<Set<string>>(new Set());

  // WebDAV Config State
  const [webDavConfig, setWebDavConfig] = useState<WebDavConfig>({
      url: '',
      username: '',
      password: '',
      enabled: false
  });

  // AI Config State
  const [aiConfig, setAiConfig] = useState<AIConfig>(() => {
      const saved = localStorage.getItem(AI_CONFIG_KEY);
      if (saved) {
          try {
              return JSON.parse(saved);
          } catch (e) {}
      }
      return {
          provider: 'gemini',
          // API Key 不通过构建变量注入（避免编译进公开 JS），由用户在「设置 → AI 设置」中运行时配置（存 KV）
          apiKey: '',
          baseUrl: '',
          model: 'gemini-2.5-flash'
      };
  });

  // 实用工具配置 State
  const [toolsConfig, setToolsConfig] = useState<ToolsConfig>(() => {
      const saved = localStorage.getItem(TOOLS_CONFIG_KEY);
      if (saved) {
          try {
              const parsed = JSON.parse(saved);
              // 与默认配置深度合并，兼容新增字段
              return {
                  ...DEFAULT_TOOLS_CONFIG,
                  ...parsed,
                  weather: { ...DEFAULT_TOOLS_CONFIG.weather, ...(parsed.weather || {}) },
                  translate: { ...DEFAULT_TOOLS_CONFIG.translate, ...(parsed.translate || {}) },
                  worldClock: { ...DEFAULT_TOOLS_CONFIG.worldClock, ...(parsed.worldClock || {}) },
                  currency: { ...DEFAULT_TOOLS_CONFIG.currency, ...(parsed.currency || {}) },
              };
          } catch (e) {}
      }
      return DEFAULT_TOOLS_CONFIG;
  });

  // Site Settings State
  const [siteSettings, setSiteSettings] = useState(() => {
      const saved = localStorage.getItem('cloudnav_site_settings');
      const defaults = {
          title: '',
          navTitle: 'CloudNav',
          favicon: '',
          cardStyle: 'detailed' as const,
          requirePasswordOnVisit: false,
          passwordExpiryDays: 7,
          background: {
              enabled: false,
              type: 'bing' as const,
              bingResolution: '4k' as const,
              customUrl: '',
              solidColor: '#1e293b',
              overlayOpacity: 0.35,
              dailySync: true,
              imageOpacity: 1,
          },
          font: { family: '' },
          navTitleAlign: 'left' as const,
      };
      if (saved) {
          try {
              // 兼容旧配置：缺省字段用默认值补齐（深度合并，防止 background/font 为 null/缺字段）
              const parsed = JSON.parse(saved);
              const merged = { ...defaults, ...parsed };
              merged.background = { ...defaults.background, ...(parsed.background ?? {}) };
              // 新字段兜底（dailySync/imageOpacity）
              merged.background.dailySync = merged.background.dailySync ?? true;
              merged.background.imageOpacity = merged.background.imageOpacity ?? 1;
              merged.font = { ...defaults.font, ...(parsed.font ?? {}) };
              merged.navTitleAlign = parsed.navTitleAlign ?? 'left';
              return merged;
          } catch (e) {}
      }
      return defaults;
  });

  // Bing 壁纸手动同步信号：+1 时 BackgroundLayer 清缓存重新拉取最新壁纸
  const [bgSyncSignal, setBgSyncSignal] = useState(0);
  const handleBingSync = useCallback(() => {
      try {
          Object.keys(localStorage)
              .filter(k => k.startsWith('cloudnav_bing_wallpaper_'))
              .forEach(k => localStorage.removeItem(k));
      } catch (e) { /* 忽略 */ }
      setBgSyncSignal(s => s + 1);
  }, []);
  
  // Modals
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [isCatManagerOpen, setIsCatManagerOpen] = useState(false);
  const [isBackupModalOpen, setIsBackupModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<'site' | 'ai' | 'tools' | 'utilities'>('site');
  const [isSearchConfigModalOpen, setIsSearchConfigModalOpen] = useState(false);
  const [catAuthModalData, setCatAuthModalData] = useState<Category | null>(null);
  const [pendingProtectedCategoryId, setPendingProtectedCategoryId] = useState<string | null>(null);
  
  const [editingLink, setEditingLink] = useState<LinkItem | undefined>(undefined);
  // State for data pre-filled from Bookmarklet
  const [prefillLink, setPrefillLink] = useState<Partial<LinkItem> | undefined>(undefined);
  
  // Sync State
  const [syncStatus, setSyncStatus] = useState<'idle' | 'saving' | 'saved' | 'error' | 'offline'>('idle');
  const [authToken, setAuthToken] = useState<string>('');
  const [requiresAuth, setRequiresAuth] = useState<boolean | null>(null); // null表示未检查，true表示需要认证，false表示不需要
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  
  // Sort State
  const [isSortingMode, setIsSortingMode] = useState<string | null>(null); // 存储正在排序的分类ID，null表示不在排序模式
  const [showHiddenLinks, setShowHiddenLinks] = useState(false); // 是否显示隐藏链接列表
  const [isSortingPinned, setIsSortingPinned] = useState(false); // 是否正在排序置顶链接
  
  // Batch Edit State
  const [isBatchEditMode, setIsBatchEditMode] = useState(false); // 是否处于批量编辑模式
  const [selectedLinks, setSelectedLinks] = useState<Set<string>>(new Set()); // 选中的链接ID集合
  
  // Context Menu State
  const [contextMenu, setContextMenu] = useState<{
    isOpen: boolean;
    position: { x: number; y: number };
    link: LinkItem | null;
  }>({
    isOpen: false,
    position: { x: 0, y: 0 },
    link: null
  });
  
  // QR Code Modal State
  const [qrCodeModal, setQrCodeModal] = useState<{
    isOpen: boolean;
    url: string;
    title: string;
  }>({
    isOpen: false,
    url: '',
    title: ''
  });

  // Mobile Search State
  const [isMobileSearchOpen, setIsMobileSearchOpen] = useState(false);
  const [themeTransition, setThemeTransition] = useState<{
    visible: boolean;
    x: number;
    y: number;
    radius: number;
    targetDark: boolean;
  }>({
    visible: false,
    x: 0,
    y: 0,
    radius: 0,
    targetDark: false,
  });
  
  const buildAuthHeaders = (token?: string | null, extraHeaders: Record<string, string> = {}) => {
    const headers: Record<string, string> = { ...extraHeaders };
    const resolvedToken = token ?? authToken ?? localStorage.getItem(AUTH_KEY);
    const authIssuedAt = localStorage.getItem(AUTH_TIME_KEY);

    if (resolvedToken) {
      headers['x-auth-password'] = resolvedToken;
    }
    if (authIssuedAt) {
      headers['x-auth-issued-at'] = authIssuedAt;
    }

    return headers;
  };

  const clearAuthSession = () => {
    setAuthToken('');
    localStorage.removeItem(AUTH_KEY);
    localStorage.removeItem(AUTH_TIME_KEY);
  };
  
  // --- Helpers & Sync Logic ---

  const loadFromLocal = () => {
    const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        // 仅在「分类数据缺失/非数组」时使用默认分类；合法空数组（用户删光分类）必须保留
        let loadedCategories = Array.isArray(parsed.categories)
          ? sanitizeCategories(parsed.categories)
          : [...DEFAULT_CATEGORIES];
        
        // 确保"常用推荐"分类始终存在，并确保它是第一个分类
        if (!loadedCategories.some(c => c.id === 'common')) {
          loadedCategories = [
            { id: 'common', name: '常用推荐', icon: 'Star' },
            ...loadedCategories
          ];
        } else {
          // 如果"常用推荐"分类已存在，确保它是第一个分类
          const commonIndex = loadedCategories.findIndex(c => c.id === 'common');
          if (commonIndex > 0) {
            const commonCategory = loadedCategories[commonIndex];
            loadedCategories = [
              commonCategory,
              ...loadedCategories.slice(0, commonIndex),
              ...loadedCategories.slice(commonIndex + 1)
            ];
          }
        }
        
        // 检查是否有链接的categoryId不存在于当前分类中，将这些链接移动到"常用推荐"
        const validCategoryIds = new Set(loadedCategories.map(c => c.id));
        // 仅在「链接数据缺失/非数组」时使用默认链接；合法空数组（用户清空全部链接）必须保留
        let loadedLinks = Array.isArray(parsed.links)
          ? sanitizeLinks(parsed.links)
          : [...INITIAL_LINKS];
        loadedLinks = loadedLinks.map(link => {
          if (!validCategoryIds.has(link.categoryId)) {
            return { ...link, categoryId: 'common' };
          }
          return link;
        });
        
        setLinks(loadedLinks);
        setCategories(loadedCategories);
      } catch (e) {
        setLinks(INITIAL_LINKS);
        setCategories(DEFAULT_CATEGORIES);
      }
    } else {
      setLinks(INITIAL_LINKS);
      setCategories(DEFAULT_CATEGORIES);
    }
  };

  // 数据 revision（服务端并发冲突检测）与同步队列（同一客户端写入串行化，避免乱序覆盖）
  const revisionRef = useRef<number | undefined>(undefined);
  const syncQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  // 同步代次：409 冲突后 +1，旧代次任务即使完成也丢弃结果，避免覆盖刚拉回的远端数据
  const syncGenerationRef = useRef(0);
  // 写入合并（debounce）：高频编辑合并为一次云端写入，降低 KV 写入频率
  const pendingSyncRef = useRef<{ links: LinkItem[]; categories: Category[] } | null>(null);
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 扩展收件箱：待处理/导入状态与已合并 ID（去重）
  const [inboxStatus, setInboxStatus] = useState<'idle' | 'pending' | 'importing' | 'imported' | 'error'>('idle');
  const mergedInboxIdsRef = useRef<Set<string>>(new Set());

  const flushPendingSync = () => {
    if (syncTimerRef.current) { clearTimeout(syncTimerRef.current); syncTimerRef.current = null; }
    const pending = pendingSyncRef.current;
    pendingSyncRef.current = null;
    if (pending && authToken) {
      syncToCloud(pending.links, pending.categories, authToken);
    }
  };

  const syncToCloud = async (newLinks: LinkItem[], newCategories: Category[], token: string) => {
    // 入队时即捕获代次：409 后已排队任务即使开始执行，代次也已变化，结果会被丢弃
    const gen = syncGenerationRef.current;
    // 串行队列：保证同客户端的多次写入按顺序完成；并发修改由服务端 revision 冲突检测兜底
    const task = syncQueueRef.current.then(async () => {
      setSyncStatus('saving');
      try {
          // 429（KV 写入频率限制）指数退避重试，最多 3 次；每次重试前检查代次，旧代次直接放弃（不再发请求）
          let response: Response | null = null;
          for (let attempt = 0; attempt < 3; attempt++) {
              if (gen !== syncGenerationRef.current) return false;
              const resp = await fetch('/api/storage', {
                  method: 'POST',
                  headers: buildAuthHeaders(token, {
                      'Content-Type': 'application/json',
                  }),
                  body: JSON.stringify({
                      links: newLinks,
                      categories: newCategories,
                      baseRevision: revisionRef.current,
                  })
              });
              if (resp.status !== 429 && resp.status !== 503 || attempt === 2) {
                  response = resp;
                  break;
              }
              await new Promise(r => setTimeout(r, 500 * Math.pow(2, attempt))); // 500ms / 1s / 2s
          }
          if (!response) return false;

          if (response.status === 401) {
              // 检查是否是密码过期
              try {
                  const errorData = await response.json();
                  if (errorData.error && errorData.error.includes('过期')) {
                      alert('您的密码已过期，请重新登录');
                  }
              } catch (e) {
                  // 如果无法解析错误信息，使用默认提示
                  console.error('Failed to parse error response', e);
              }

              // 只有「本次请求使用的凭据 == 当前会话凭据」时才清空会话；
              // 以 localStorage 为权威（改密码后闭包 authToken 是旧值，可能误判旧请求为当前会话）
              const currentCredential = localStorage.getItem(AUTH_KEY) || authToken;
              if (!currentCredential || token === currentCredential) {
                  clearAuthSession();
                  setIsAuthOpen(true);
              }
              setSyncStatus('error');
              return false;
          }

          if (response.status === 409) {
              // 其他设备/扩展已写入：拉取最新数据覆盖本地；递增代次并清空队列，
              // 使已排队/在途的旧快照任务完成后自动丢弃结果，避免再次覆盖远端修改
              setSyncStatus('error');
              syncGenerationRef.current += 1;
              syncQueueRef.current = Promise.resolve();
              try {
                  const freshRes = await fetch('/api/storage', { headers: buildAuthHeaders(token) });
                  if (freshRes.ok) {
                      const fresh = await freshRes.json();
                      if (fresh.hasData) {
                          setLinks(sanitizeLinks(fresh.links));
                          setCategories(sanitizeCategories(fresh.categories));
                          localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify({ links: fresh.links || [], categories: fresh.categories || DEFAULT_CATEGORIES }));
                          revisionRef.current = typeof fresh.revision === 'number' ? fresh.revision : undefined;
                      }
                  }
              } catch (e) {}
              alert('检测到数据已在其他设备更新，已为您加载最新数据（本次修改未保存，请刷新后重试）');
              return false;
          }
        if (!response.ok) throw new Error('Network response was not ok');
        
        // 代次检查：若期间发生 409（代次已变），本任务结果作废，不更新本地版本号
        if (gen !== syncGenerationRef.current) return false;
        // 记录服务端最新 revision（后续写入带 baseRevision 做冲突检测）
        try {
          const saved = await response.json();
          if (typeof saved.revision === 'number') {
            revisionRef.current = saved.revision;
          }
        } catch (e) {}
        if (gen !== syncGenerationRef.current) return false;
        setSyncStatus('saved');
        setTimeout(() => setSyncStatus('idle'), 2000);
        return true;
    } catch (error) {
        console.error("Sync failed", error);
        setSyncStatus('error');
        return false;
    }
    });
    // 队列尾随错误吞掉，避免影响下一次排队
    syncQueueRef.current = task.catch(() => {});
    return task;
  };

  // ===== 扩展收件箱：拉取 → 合并（基于云端最新）→ 同步成功 → ACK =====
  const ackInbox = async (ids: string[], token: string) => {
    try {
      await fetch('/api/extension-inbox', {
        method: 'POST',
        headers: buildAuthHeaders(token, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({ action: 'ack', ids }),
      });
    } catch {
      // ACK 失败静默：下次拉取靠 UUID 去重不会重复导入
    }
  };

  const pollExtensionInbox = async () => {
    const token = localStorage.getItem(AUTH_KEY);
    if (!token) return;
    try {
      const res = await fetch('/api/extension-inbox', { headers: buildAuthHeaders(token) });
      if (res.status === 401 || res.status === 403) return; // 会话失效：交给正常鉴权流程
      if (!res.ok) {
        setInboxStatus('error');
        return;
      }
      const data = await res.json();
      const entries = (data.entries || []).filter(
        (e: any) => e && typeof e.id === 'string' && !mergedInboxIdsRef.current.has(e.id)
      );
      if (entries.length === 0) {
        setInboxStatus('idle');
        return;
      }
      setInboxStatus('pending');

      // 合并基准必须是「当前」数据：以云端最新为准（含 revision），不用异步开始时的旧闭包
      const freshRes = await fetch('/api/storage', { headers: buildAuthHeaders(token) });
      if (!freshRes.ok) {
        setInboxStatus('error');
        return;
      }
      const fresh = await freshRes.json();
      if (!fresh.hasData) {
        setInboxStatus('error');
        return;
      }
      const baseLinks = sanitizeLinks(fresh.links);
      const baseCategories = sanitizeCategories(fresh.categories);
      const baseRevision = typeof fresh.revision === 'number' ? fresh.revision : undefined;

      // 分类映射：分类不存在时放入 common 或第一个有效分类
      const fallbackCategoryId = baseCategories.some((c) => c.id === 'common')
        ? 'common'
        : (baseCategories[0]?.id || 'common');

      // 第一层：inbox UUID 去重（已在 filter 完成）；第二层：URL 去重（大小写不敏感）
      const urlSet = new Set(baseLinks.map((l) => (l.url || '').toLowerCase()));
      const newItems = entries
        .filter((e: any) => /^https?:\/\//i.test(e.url || ''))
        .filter((e: any) => !urlSet.has((e.url || '').toLowerCase()))
        .map((e: any) => ({
          id: e.id,
          title: String(e.title || '').slice(0, 200),
          url: e.url,
          categoryId: baseCategories.some((c) => c.id === e.categoryId) ? e.categoryId : fallbackCategoryId,
          createdAt: typeof e.createdAt === 'number' ? e.createdAt : Date.now(),
          icon: undefined,
          hidden: false,
          pinned: false,
        } as LinkItem));

      const allIds = entries.map((e: any) => e.id);
      if (newItems.length === 0) {
        // 全部为重复 URL：无需导入，直接 ACK（避免每次轮询重复处理）
        await ackInbox(allIds, token);
        mergedInboxIdsRef.current = new Set([...mergedInboxIdsRef.current, ...allIds]);
        setInboxStatus('imported');
        setTimeout(() => setInboxStatus('idle'), 2000);
        return;
      }

      setInboxStatus('importing');
      // 先等待 syncToCloud 明确返回成功，再更新本地状态并 ACK
      const syncOk = await syncToCloud([...newItems, ...baseLinks], baseCategories, token);
      if (syncOk) {
        await ackInbox(allIds, token);
        mergedInboxIdsRef.current = new Set([...mergedInboxIdsRef.current, ...allIds]);
        setLinks(sanitizeLinks([...newItems, ...baseLinks]));
        localStorage.setItem(
          LOCAL_STORAGE_KEY,
          JSON.stringify({ links: [...newItems, ...baseLinks], categories: baseCategories })
        );
        if (typeof baseRevision === 'number') revisionRef.current = baseRevision;
        setInboxStatus('imported');
        setTimeout(() => setInboxStatus('idle'), 3000);
      } else {
        // 409/401/503/网络错误：不 ACK，留待下次轮询重试
        setInboxStatus('error');
      }
    } catch {
      setInboxStatus('error');
    }
  };

  // 触发时机：管理员登录后、窗口重新获得焦点时、每 30 秒
  useEffect(() => {
    if (!authToken) return;
    pollExtensionInbox();
    const interval = setInterval(pollExtensionInbox, 30_000);
    const onFocus = () => pollExtensionInbox();
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, [authToken]);

  const updateData = (newLinks: LinkItem[], newCategories: Category[]) => {
      // 1. Optimistic UI Update
      setLinks(newLinks);
      setCategories(newCategories);
      
      // 2. Save to Local Cache
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify({ links: newLinks, categories: newCategories }));

      // 3. Sync to Cloud (if authenticated)：300ms 合并，高频编辑只发一次写入（降低 KV 写入频率）
      if (authToken) {
          pendingSyncRef.current = { links: newLinks, categories: newCategories };
          if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
          syncTimerRef.current = setTimeout(flushPendingSync, 300);
      }
  };

  const requireAuth = () => {
    if (authToken) return true;
    setIsAuthOpen(true);
    return false;
  };

  // --- Context Menu Functions ---
  const handleContextMenu = (event: React.MouseEvent, link: LinkItem) => {
    event.preventDefault();
    event.stopPropagation();
    
    // 在批量编辑模式下禁用右键菜单
    if (isBatchEditMode) return;
    
    setContextMenu({
      isOpen: true,
      position: { x: event.clientX, y: event.clientY },
      link: link
    });
  };

  const closeContextMenu = () => {
    setContextMenu({
      isOpen: false,
      position: { x: 0, y: 0 },
      link: null
    });
  };

  const copyLinkToClipboard = () => {
    if (!contextMenu.link) return;
    
    navigator.clipboard.writeText(contextMenu.link.url)
      .then(() => {
        // 可以添加一个短暂的提示
        console.log('链接已复制到剪贴板');
      })
      .catch(err => {
        console.error('复制链接失败:', err);
      });
    
    closeContextMenu();
  };

  const showQRCode = () => {
    if (!contextMenu.link) return;
    
    setQrCodeModal({
      isOpen: true,
      url: contextMenu.link.url,
      title: contextMenu.link.title
    });
    
    closeContextMenu();
  };

  const editLinkFromContextMenu = () => {
    if (!contextMenu.link) return;
    if (!requireAuth()) return;
    
    setEditingLink(contextMenu.link);
    setIsModalOpen(true);
    closeContextMenu();
  };

  const deleteLinkFromContextMenu = () => {
    if (!contextMenu.link) return;
    if (!requireAuth()) return;
    
    if (window.confirm(`确定要删除"${contextMenu.link.title}"吗？`)) {
      const newLinks = links.filter(link => link.id !== contextMenu.link!.id);
      updateData(newLinks, categories);
    }
    
    closeContextMenu();
  };

  const togglePinFromContextMenu = () => {
    if (!contextMenu.link) return;
    if (!requireAuth()) return;
    
    const linkToToggle = links.find(l => l.id === contextMenu.link!.id);
    if (!linkToToggle) return;
    
    // 如果是设置为置顶，则设置pinnedOrder为当前置顶链接数量
    // 如果是取消置顶，则清除pinnedOrder
    const updated = links.map(l => {
      if (l.id === contextMenu.link!.id) {
        const isPinned = !l.pinned;
        return { 
          ...l, 
          pinned: isPinned,
          pinnedOrder: isPinned ? links.filter(link => link.pinned).length : undefined
        };
      }
      return l;
    });
    
    updateData(updated, categories);
    closeContextMenu();
  };

  // 隐藏/恢复显示链接
  const toggleHiddenFromContextMenu = () => {
    if (!contextMenu.link) return;
    if (!requireAuth()) return;
    
    const updated = links.map(l =>
      l.id === contextMenu.link!.id ? { ...l, hidden: !l.hidden } : l
    );
    updateData(updated, categories);
    closeContextMenu();
  };
  const loadLinkIcons = async (linksToLoad: LinkItem[], categoriesToUse: Category[], token?: string) => {
    // 用显式传入的 token（initData 等闭包内 authToken 可能还是旧值）；兜底读 state/localStorage
    const sessionToken = token ?? authToken ?? localStorage.getItem(AUTH_KEY);
    if (!sessionToken) return; // 只有在已登录状态下才加载图标缓存
    
    const updatedLinks = [...linksToLoad];
    const domainsToFetch = new Set<string>();
    
    // 收集所有链接的域名（包括已有图标的链接）
    for (const link of updatedLinks) {
      if (link.url) {
        try {
          let domain = link.url;
          if (!link.url.startsWith('http://') && !link.url.startsWith('https://')) {
            domain = 'https://' + link.url;
          }
          
          if (domain.startsWith('http://') || domain.startsWith('https://')) {
            const urlObj = new URL(domain);
            domain = urlObj.hostname;
            if (!link.icon || !link.icon.startsWith('data:')) {
              domainsToFetch.add(domain);
            }
          }
        } catch (e) {
          console.error("Failed to parse URL for icon loading", e);
        }
      }
    }
    
    // 批量获取图标
    if (domainsToFetch.size > 0) {
      const iconPromises = Array.from(domainsToFetch).map(async (domain) => {
        try {
          const response = await fetch(`/api/storage?getConfig=favicon&domain=${encodeURIComponent(domain)}&fetch=true`, {
            headers: buildAuthHeaders(sessionToken)
          });
          if (response.ok) {
            const data = await response.json();
            if (data.cached && data.icon) {
              return { domain, icon: data.icon };
            }
          }
        } catch (error) {
          console.log(`Failed to fetch cached icon for ${domain}`, error);
        }
        return null;
      });
      
      const iconResults = await Promise.all(iconPromises);
      
      // 更新链接的图标
      let hasChanges = false;

      iconResults.forEach(result => {
        if (result) {
          updatedLinks.forEach(linkToUpdate => {
            if (!linkToUpdate.url) return;

            try {
              let domain = linkToUpdate.url;
              if (!linkToUpdate.url.startsWith('http://') && !linkToUpdate.url.startsWith('https://')) {
                domain = 'https://' + linkToUpdate.url;
              }

              if (!domain.startsWith('http://') && !domain.startsWith('https://')) {
                return;
              }

              const urlObj = new URL(domain);
              if (urlObj.hostname !== result.domain) {
                return;
              }

              if (linkToUpdate.icon !== result.icon) {
                linkToUpdate.icon = result.icon;
                hasChanges = true;
              }
            } catch (e) {
              return;
            }
          });
        }
      });
      
      if (hasChanges) {
        // 只把抓取到的 icon 按域名合并进「当前」state（不覆盖用户期间的编辑/删除），
        // 且不再用旧快照整包 setLinks + syncToCloud（避免旧快照写回云端）
        const iconMap = new Map<string, string>();
        iconResults.forEach(r => { if (r) iconMap.set(r.domain, r.icon); });
        setLinks(prev => {
          const next = prev.map(l => {
            if (!l.url) return l;
            try {
              const urlObj = new URL(l.url.startsWith('http://') || l.url.startsWith('https://') ? l.url : 'https://' + l.url);
              const icon = iconMap.get(urlObj.hostname);
              return icon && icon !== l.icon ? { ...l, icon } : l;
            } catch {
              return l;
            }
          });
          // 同步本地缓存：图标回填在刷新后仍保留（云端 app_data 不写，避免旧快照覆盖）
          try {
            localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify({ links: next, categories: categoriesToUse }));
          } catch (e) {}
          return next;
        });
      }
    }
  };

  // --- Effects ---

  useEffect(() => {
    // Theme init
    if (localStorage.getItem('theme') === 'dark' || (!('theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      setDarkMode(true);
      document.documentElement.classList.add('dark');
    }

    // Load Token and check expiry
    const savedToken = localStorage.getItem(AUTH_KEY);
    const lastLoginTime = localStorage.getItem(AUTH_TIME_KEY);
    
    if (savedToken) {
      const currentTime = Date.now();
      
      if (lastLoginTime) {
        const lastLogin = parseInt(lastLoginTime);
        const timeDiff = currentTime - lastLogin;
        
        const expiryDays = siteSettings.passwordExpiryDays ?? 7;
        const expiryTimeMs = expiryDays > 0 ? expiryDays * 24 * 60 * 60 * 1000 : 0;
        
        if (expiryTimeMs > 0 && timeDiff > expiryTimeMs) {
          clearAuthSession();
        } else {
          setAuthToken(savedToken);
        }
      } else {
        setAuthToken(savedToken);
      }
    }

    // Load WebDAV Config
    const savedWebDav = localStorage.getItem(WEBDAV_CONFIG_KEY);
    if (savedWebDav) {
        try {
            setWebDavConfig(JSON.parse(savedWebDav));
        } catch (e) {}
    }

    // Handle URL Params for Bookmarklet (Add Link)
    const urlParams = new URLSearchParams(window.location.search);
    const addUrl = urlParams.get('add_url');
    if (addUrl) {
        const addTitle = urlParams.get('add_title') || '';
        // Clean URL params to avoid re-triggering on refresh
        window.history.replaceState({}, '', window.location.pathname);
        
        setPrefillLink({
            title: addTitle,
            url: addUrl,
            categoryId: 'common' // Default, Modal will handle selection
        });
        setEditingLink(undefined);
        if (savedToken) {
            setIsModalOpen(true);
        } else {
            setIsAuthOpen(true);
        }
    }

    // Initial Data Fetch
    const initData = async () => {
        // 首先检查是否需要认证
        try {
            const authRes = await fetch('/api/storage?checkAuth=true');
            if (authRes.ok) {
                const authData = await authRes.json();
                setRequiresAuth(authData.requiresAuth);
                if (authData.hasPassword && savedToken) {
                    const validateRes = await fetch('/api/storage', {
                        method: 'POST',
                        headers: buildAuthHeaders(savedToken, {
                            'Content-Type': 'application/json',
                        }),
                        body: JSON.stringify({ authOnly: true })
                    });

                    if (!validateRes.ok) {
                        clearAuthSession();
                    } else {
                        const validateData = await validateRes.json();
                        if (validateData?.authenticatedAt) {
                            localStorage.setItem(AUTH_TIME_KEY, String(validateData.authenticatedAt));
                            // token 轮换：每次会话校验服务端都会签发新 token，保存新 token 使会话延续
                            const refreshedToken = validateData.token || savedToken;
                            setAuthToken(refreshedToken);
                            localStorage.setItem(AUTH_KEY, refreshedToken);
                        }
                    }
                }
                if (authData.requiresAuth && !savedToken) {
                    setIsCheckingAuth(false);
                    return;
                }
            }
        } catch (e) {
            console.warn("Failed to check auth requirement.", e);
        }
        
        // 获取数据（用 savedToken 而非闭包 authToken：state 更新在下一次渲染才生效，闭包内仍是旧值）
        let hasCloudData = false;
        try {
            const res = await fetch('/api/storage', {
                headers: savedToken ? buildAuthHeaders(savedToken) : {}
            });
            if (res.ok) {
                const data = await res.json();
                // 云端只要 hasData=true（含用户清空数据的空数组）就采用，避免本地旧数据覆盖/复活
                if (data.hasData) {
                    setLinks(sanitizeLinks(data.links));
                    setCategories(sanitizeCategories(data.categories));
                    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify({ links: data.links || [], categories: data.categories || DEFAULT_CATEGORIES }));
                    // 记录云端 revision，供后续写入做冲突检测
                    revisionRef.current = typeof data.revision === 'number' ? data.revision : undefined;
                    
                    // 加载链接图标缓存
                    loadLinkIcons(data.links || [], data.categories || DEFAULT_CATEGORIES, savedToken);
                    hasCloudData = true;
                }
            } else if (res.status === 401) {
                // 如果返回401，可能是密码过期，清除本地token并要求重新登录
                const errorData = await res.json();
                if (errorData.error && errorData.error.includes('过期')) {
                    clearAuthSession();
                    setIsAuthOpen(true);
                    setIsCheckingAuth(false);
                    return;
                }
            }
        } catch (e) {
            console.warn("Failed to fetch from cloud, falling back to local.", e);
        }
        
        // 无论是否有云端数据，都尝试从KV空间加载搜索配置和网站配置（统一 try；fetch 异常由下方 catch 兜底）
        try {
            const searchConfigRes = await fetch('/api/storage?getConfig=search');
            if (searchConfigRes.ok) {
                const searchConfigData = await searchConfigRes.json();
                // 检查搜索配置是否有效（包含必要的字段）
                if (searchConfigData && (searchConfigData.mode || searchConfigData.externalSources || searchConfigData.selectedSource)) {
                    // 恢复用户保存的搜索模式（internal 站内 / external 站外），不再强制 internal
                    setSearchMode(searchConfigData.mode === 'external' ? 'external' : 'internal');
                    setExternalSearchSources(sanitizeSearchSources(searchConfigData.externalSources));
                    // 加载已保存的选中搜索源
                    if (searchConfigData.selectedSource) {
                        setSelectedSearchSource(searchConfigData.selectedSource);
                    }
                }
            } else {
                // 云端不可用：用本地缓存兜底
                loadLocalSearchConfig();
            }

            const websiteConfigRes = await fetch('/api/storage?getConfig=website');
            if (websiteConfigRes.ok) {
                const websiteConfigData = await websiteConfigRes.json();
                if (websiteConfigData) {
                    setSiteSettings(prev => ({
                        ...prev,
                        title: websiteConfigData.title || prev.title,
                        navTitle: websiteConfigData.navTitle || prev.navTitle,
                        favicon: websiteConfigData.favicon || prev.favicon,
                        cardStyle: websiteConfigData.cardStyle || prev.cardStyle,
                        requirePasswordOnVisit: websiteConfigData.requirePasswordOnVisit !== undefined ? websiteConfigData.requirePasswordOnVisit : prev.requirePasswordOnVisit,
                        passwordExpiryDays: websiteConfigData.passwordExpiryDays !== undefined ? websiteConfigData.passwordExpiryDays : prev.passwordExpiryDays
                    }));
                }
            }

            if (savedToken) {
                const webDavConfigRes = await fetch('/api/storage?getConfig=webdav', {
                    headers: buildAuthHeaders(savedToken)
                });
                if (webDavConfigRes.ok) {
                    const webDavConfigData = await webDavConfigRes.json();
                    if (webDavConfigData && (webDavConfigData.url || webDavConfigData.username || webDavConfigData.password || webDavConfigData.enabled !== undefined)) {
                        setWebDavConfig(webDavConfigData);
                        localStorage.setItem(WEBDAV_CONFIG_KEY, JSON.stringify(webDavConfigData));
                    }
                }
            }
        } catch (e) {
            console.warn("Failed to fetch configs from KV.", e);
        }
        
        // 如果有云端数据，则不需要加载本地数据
        if (hasCloudData) {
            setIsCheckingAuth(false);
            return;
        }
        
        // 如果没有云端数据，则加载本地数据
        loadFromLocal();
        
        // 如果从KV空间加载搜索配置失败，直接使用默认配置（不使用localStorage回退）
        setSearchMode('internal');
        setExternalSearchSources([
            {
                id: 'bing',
                name: '必应',
                url: 'https://www.bing.com/search?q={query}',
                icon: 'Search',
                enabled: true,
                createdAt: Date.now()
            },
            {
                id: 'google',
                name: 'Google',
                url: 'https://www.google.com/search?q={query}',
                icon: 'Search',
                enabled: true,
                createdAt: Date.now()
            },
            {
                id: 'baidu',
                name: '百度',
                url: 'https://www.baidu.com/s?wd={query}',
                icon: 'Globe',
                enabled: true,
                createdAt: Date.now()
            },
            {
                id: 'sogou',
                name: '搜狗',
                url: 'https://www.sogou.com/web?query={query}',
                icon: 'Globe',
                enabled: true,
                createdAt: Date.now()
            },
            {
                id: 'yandex',
                name: 'Yandex',
                url: 'https://yandex.com/search/?text={query}',
                icon: 'Globe',
                enabled: true,
                createdAt: Date.now()
            },
            {
                id: 'github',
                name: 'GitHub',
                url: 'https://github.com/search?q={query}',
                icon: 'Github',
                enabled: true,
                createdAt: Date.now()
            },
            {
                id: 'linuxdo',
                name: 'Linux.do',
                url: 'https://linux.do/search?q={query}',
                icon: 'Terminal',
                enabled: true,
                createdAt: Date.now()
            },
            {
                id: 'bilibili',
                name: 'B站',
                url: 'https://search.bilibili.com/all?keyword={query}',
                icon: 'Play',
                enabled: true,
                createdAt: Date.now()
            },
            {
                id: 'youtube',
                name: 'YouTube',
                url: 'https://www.youtube.com/results?search_query={query}',
                icon: 'Video',
                enabled: true,
                createdAt: Date.now()
            },
            {
                id: 'wikipedia',
                name: '维基',
                url: 'https://zh.wikipedia.org/wiki/Special:Search?search={query}',
                icon: 'BookOpen',
                enabled: true,
                createdAt: Date.now()
            }
        ]);
        
        setIsCheckingAuth(false);
    };

    initData();
  }, []);

  // Update page title and favicon when site settings change
  useEffect(() => {
    if (siteSettings.title) {
      document.title = siteSettings.title;
    }
    
    const updateFavicon = async () => {
      if (!siteSettings.favicon) return;

      const roundedFavicon = await createRoundedFavicon(siteSettings.favicon);
      const existingFavicons = document.querySelectorAll('link[rel="icon"]');
      existingFavicons.forEach(favicon => favicon.remove());

      const favicon = document.createElement('link');
      favicon.rel = 'icon';
      favicon.href = roundedFavicon;
      document.head.appendChild(favicon);
    };

    updateFavicon();
  }, [siteSettings.title, siteSettings.favicon]);

  // 全局字体应用（空 = 系统默认）
  useEffect(() => {
    document.body.style.fontFamily = siteSettings.font?.family || '';
  }, [siteSettings.font?.family]);

  useEffect(() => {
    return () => {
      if (themeTransitionTimerRef.current) {
        window.clearTimeout(themeTransitionTimerRef.current);
      }
    };
  }, []);

  const applyThemeMode = (newMode: boolean) => {
    setDarkMode(newMode);
    if (newMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  };

  const toggleTheme = () => {
    const newMode = !darkMode;
    const rect = themeButtonRef.current?.getBoundingClientRect();
    const x = rect ? rect.left + rect.width / 2 : window.innerWidth - 48;
    const y = rect ? rect.top + rect.height / 2 : 32;
    const radius = Math.hypot(
      Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y)
    );

    if (themeTransitionTimerRef.current) {
      window.clearTimeout(themeTransitionTimerRef.current);
    }

    setThemeTransition({
      visible: true,
      x,
      y,
      radius: 0,
      targetDark: newMode,
    });

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setThemeTransition({
          visible: true,
          x,
          y,
          radius,
          targetDark: newMode,
        });
      });
    });

    themeTransitionTimerRef.current = window.setTimeout(() => {
      applyThemeMode(newMode);
      setThemeTransition(prev => ({
        ...prev,
        visible: false,
        radius: 0,
      }));
      themeTransitionTimerRef.current = null;
    }, 620);
  };

  // 视图模式切换处理函数
  const handleViewModeChange = (cardStyle: 'detailed' | 'simple') => {
    const newSiteSettings = { ...siteSettings, cardStyle };
    setSiteSettings(newSiteSettings);
    localStorage.setItem('cloudnav_site_settings', JSON.stringify(newSiteSettings));
  };

  // --- Batch Edit Functions ---
  const toggleBatchEditMode = () => {
    if (!requireAuth()) return;
    setIsBatchEditMode(!isBatchEditMode);
    setSelectedLinks(new Set()); // 退出批量编辑模式时清空选中项
  };

  const toggleLinkSelection = (linkId: string) => {
    setSelectedLinks(prev => {
      const newSet = new Set(prev);
      if (newSet.has(linkId)) {
        newSet.delete(linkId);
      } else {
        newSet.add(linkId);
      }
      return newSet;
    });
  };

  const handleBatchDelete = () => {
    if (!authToken) { setIsAuthOpen(true); return; }
    
    if (selectedLinks.size === 0) {
      alert('请先选择要删除的链接');
      return;
    }
    
    if (confirm(`确定要删除选中的 ${selectedLinks.size} 个链接吗？`)) {
      const newLinks = links.filter(link => !selectedLinks.has(link.id));
      updateData(newLinks, categories);
      setSelectedLinks(new Set());
      setIsBatchEditMode(false);
    }
  };

  const handleBatchMove = (targetCategoryId: string) => {
    if (!authToken) { setIsAuthOpen(true); return; }
    
    if (selectedLinks.size === 0) {
      alert('请先选择要移动的链接');
      return;
    }
    
    const newLinks = links.map(link => 
      selectedLinks.has(link.id) ? { ...link, categoryId: targetCategoryId } : link
    );
    updateData(newLinks, categories);
    setSelectedLinks(new Set());
    setIsBatchEditMode(false);
  };

  const handleSelectAll = () => {
    // 获取当前显示的所有链接ID
    const currentLinkIds = displayedLinks.map(link => link.id);
    
    // 如果已选中的链接数量等于当前显示的链接数量，则取消全选
    if (selectedLinks.size === currentLinkIds.length && currentLinkIds.every(id => selectedLinks.has(id))) {
      setSelectedLinks(new Set());
    } else {
      // 否则全选当前显示的所有链接
      setSelectedLinks(new Set(currentLinkIds));
    }
  };

  // --- Actions ---

  const handleLogin = async (password: string): Promise<boolean> => {
      try {
        // 首先验证密码
        const authResponse = await fetch('/api/storage', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-auth-password': password
            },
            body: JSON.stringify({ authOnly: true }) // 只用于验证密码，不更新数据
        });
        
        if (authResponse.ok) {
            const authPayload = await authResponse.json();
            // 存储会话 token（HMAC 签名，不可逆推密码）而非明文密码；
            // 老后端无 token 字段时回退明文（兼容升级过程中的旧部署）
            const sessionCredential = authPayload.token || password;
            setAuthToken(sessionCredential);
            localStorage.setItem(AUTH_KEY, sessionCredential);
            setIsAuthOpen(false);
            setSyncStatus('saved');
            
            // 登录成功后，获取网站配置（包括密码过期时间设置）
            try {
                const websiteConfigRes = await fetch('/api/storage?getConfig=website');
                if (websiteConfigRes.ok) {
                    const websiteConfigData = await websiteConfigRes.json();
                    if (websiteConfigData) {
                        setSiteSettings(prev => ({
                            ...prev,
                            title: websiteConfigData.title || prev.title,
                            navTitle: websiteConfigData.navTitle || prev.navTitle,
                            favicon: websiteConfigData.favicon || prev.favicon,
                            cardStyle: websiteConfigData.cardStyle || prev.cardStyle,
                            requirePasswordOnVisit: websiteConfigData.requirePasswordOnVisit !== undefined ? websiteConfigData.requirePasswordOnVisit : prev.requirePasswordOnVisit,
                            passwordExpiryDays: websiteConfigData.passwordExpiryDays !== undefined ? websiteConfigData.passwordExpiryDays : prev.passwordExpiryDays
                        }));
                    }
                }
            } catch (e) {
                console.warn("Failed to fetch website config after login.", e);
            }
            
            // 登录成功：无条件写入新的会话时间戳（旧会话过期不阻止重新登录）
            localStorage.setItem(AUTH_TIME_KEY, String(authPayload.authenticatedAt || Date.now()));
            
            // 登录成功后，从服务器获取数据
            try {
                const res = await fetch('/api/storage', {
                    headers: buildAuthHeaders(sessionCredential)
                });
                if (res.ok) {
                    const data = await res.json();
                    // 云端有数据（含用户清空后的空数组）则采用云端，避免本地旧数据覆盖/复活
                    if (data.hasData) {
                        setLinks(sanitizeLinks(data.links));
                        setCategories(sanitizeCategories(data.categories));
                        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify({ links: data.links || [], categories: data.categories || DEFAULT_CATEGORIES }));
                        revisionRef.current = typeof data.revision === 'number' ? data.revision : undefined;
                        
                        // 加载链接图标缓存
                        loadLinkIcons(data.links || [], data.categories || DEFAULT_CATEGORIES, sessionCredential);
                    } else {
                        // 服务器从未同步过数据：使用本地数据并上传
                        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify({ links, categories }));
                        syncToCloud(links, categories, sessionCredential);
                        
                        // 加载链接图标缓存
                        loadLinkIcons(links, categories, sessionCredential);
                    }
                } 
            } catch (e) {
                console.warn("Failed to fetch data after login.", e);
                loadFromLocal();
                // 尝试将本地数据同步到服务器
                syncToCloud(links, categories, sessionCredential);
            }
            
            // 登录成功后，从KV空间加载AI配置
            try {
                const aiConfigRes = await fetch('/api/storage?getConfig=ai', {
                    headers: buildAuthHeaders(sessionCredential)
                });
                if (aiConfigRes.ok) {
                    const aiConfigData = await aiConfigRes.json();
                    if (aiConfigData && Object.keys(aiConfigData).length > 0) {
                        setAiConfig(aiConfigData);
                        localStorage.setItem(AI_CONFIG_KEY, JSON.stringify(aiConfigData));
                    }
                }
            } catch (e) {
                console.warn("Failed to fetch AI config after login.", e);
            }

            try {
                const webDavConfigRes = await fetch('/api/storage?getConfig=webdav', {
                    headers: buildAuthHeaders(sessionCredential)
                });
                if (webDavConfigRes.ok) {
                    const webDavConfigData = await webDavConfigRes.json();
                    if (webDavConfigData && (webDavConfigData.url || webDavConfigData.username || webDavConfigData.password || webDavConfigData.enabled !== undefined)) {
                        setWebDavConfig(webDavConfigData);
                        localStorage.setItem(WEBDAV_CONFIG_KEY, JSON.stringify(webDavConfigData));
                    }
                }
            } catch (e) {
                console.warn("Failed to fetch WebDAV config after login.", e);
            }

            // 登录成功后，从KV空间加载实用工具配置
            try {
                const toolsConfigRes = await fetch('/api/storage?getConfig=tools', {
                    headers: buildAuthHeaders(sessionCredential)
                });
                if (toolsConfigRes.ok) {
                    const toolsConfigData = await toolsConfigRes.json();
                    if (toolsConfigData && Object.keys(toolsConfigData).length > 0) {
                        setToolsConfig(() => ({
                            ...DEFAULT_TOOLS_CONFIG,
                            ...toolsConfigData,
                            weather: { ...DEFAULT_TOOLS_CONFIG.weather, ...(toolsConfigData.weather || {}) },
                            translate: { ...DEFAULT_TOOLS_CONFIG.translate, ...(toolsConfigData.translate || {}) },
                            worldClock: { ...DEFAULT_TOOLS_CONFIG.worldClock, ...(toolsConfigData.worldClock || {}) },
                            currency: { ...DEFAULT_TOOLS_CONFIG.currency, ...(toolsConfigData.currency || {}) },
                        }));
                        localStorage.setItem(TOOLS_CONFIG_KEY, JSON.stringify(toolsConfigData));
                    }
                }
            } catch (e) {
                console.warn("Failed to fetch tools config after login.", e);
            }

            if (pendingProtectedCategoryId) {
                setSelectedCategory(pendingProtectedCategoryId);
                setPendingProtectedCategoryId(null);
            }
            
            return true;
        }
        return false;
      } catch (e) {
          return false;
      }
  };

  const handleLogout = () => {
      clearAuthSession();
      setPendingProtectedCategoryId(null);
      setSyncStatus('offline');
      // 退出时取消未执行的同步：清 debounce、pending 快照、递增代次使在途旧任务结果作废
      if (syncTimerRef.current) { clearTimeout(syncTimerRef.current); syncTimerRef.current = null; }
      pendingSyncRef.current = null;
      syncGenerationRef.current += 1;
      syncQueueRef.current = Promise.resolve();
      // 退出后重新加载本地数据
      loadFromLocal();
  };

  // 分类操作密码验证处理函数
  const handleCategoryActionAuth = async (password: string): Promise<boolean> => {
    try {
      // 验证密码
      const authResponse = await fetch('/api/storage', {
        method: 'POST',
        headers: buildAuthHeaders(password, {
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({ authOnly: true })
      });
      
      return authResponse.ok;
    } catch (error) {
      console.error('Category action auth error:', error);
      return false;
    }
  };

  const handleImportConfirm = (newLinks: LinkItem[], newCategories: Category[]) => {
      // Merge categories: Avoid duplicate names/IDs
      const mergedCategories = [...categories];
      
      // 确保"常用推荐"分类始终存在
      if (!mergedCategories.some(c => c.id === 'common')) {
        mergedCategories.push({ id: 'common', name: '常用推荐', icon: 'Star' });
      }
      
      newCategories.forEach(nc => {
          if (!mergedCategories.some(c => c.id === nc.id || c.name === nc.name)) {
              mergedCategories.push(nc);
          }
      });

      const mergedLinks = [...links, ...newLinks];
      updateData(mergedLinks, mergedCategories);
      setIsImportModalOpen(false);
      alert(`成功导入 ${newLinks.length} 个新书签!`);
  };

  const handleAddLink = (data: Omit<LinkItem, 'id' | 'createdAt'>) => {
    if (!authToken) { setIsAuthOpen(true); return; }
    
    // 处理URL，确保有协议前缀
    let processedUrl = data.url;
    if (processedUrl && !processedUrl.startsWith('http://') && !processedUrl.startsWith('https://')) {
      processedUrl = 'https://' + processedUrl;
    }
    
    // 获取当前分类下的所有链接（不包括置顶链接）
    const categoryLinks = links.filter(link => 
      !link.pinned && (data.categoryId === 'all' || link.categoryId === data.categoryId)
    );
    
    // 计算新链接的order值，使其排在分类最后
    const maxOrder = categoryLinks.length > 0 
      ? Math.max(...categoryLinks.map(link => link.order || 0))
      : -1;
    
    const newLink: LinkItem = {
      ...data,
      url: processedUrl, // 使用处理后的URL
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      order: maxOrder + 1, // 设置为当前分类的最大order值+1，确保排在最后
      // 如果是置顶链接，设置pinnedOrder为当前置顶链接数量
      pinnedOrder: data.pinned ? links.filter(l => l.pinned).length : undefined
    };
    
    // 将新链接插入到合适的位置，而不是直接放在开头
    // 如果是置顶链接，放在置顶链接区域的最后
    if (newLink.pinned) {
      const firstNonPinnedIndex = links.findIndex(link => !link.pinned);
      if (firstNonPinnedIndex === -1) {
        // 如果没有非置顶链接，直接添加到末尾
        updateData([...links, newLink], categories);
      } else {
        // 插入到非置顶链接之前
        const updatedLinks = [...links];
        updatedLinks.splice(firstNonPinnedIndex, 0, newLink);
        updateData(updatedLinks, categories);
      }
    } else {
      // 非置顶链接，按照order字段排序后插入
      const updatedLinks = [...links, newLink].sort((a, b) => {
        // 置顶链接始终排在前面
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;
        
        // 同类型链接按照order排序
        const aOrder = a.order !== undefined ? a.order : a.createdAt;
        const bOrder = b.order !== undefined ? b.order : b.createdAt;
        return aOrder - bOrder;
      });
      updateData(updatedLinks, categories);
    }
    
    // Clear prefill if any
    setPrefillLink(undefined);
  };

  const handleEditLink = (data: Omit<LinkItem, 'id' | 'createdAt'>) => {
    if (!authToken) { setIsAuthOpen(true); return; }
    if (!editingLink) return;
    
    // 处理URL，确保有协议前缀
    let processedUrl = data.url;
    if (processedUrl && !processedUrl.startsWith('http://') && !processedUrl.startsWith('https://')) {
      processedUrl = 'https://' + processedUrl;
    }
    
    const updated = links.map(l => l.id === editingLink.id ? { ...l, ...data, url: processedUrl } : l);
    updateData(updated, categories);
    setEditingLink(undefined);
  };

  // 拖拽结束事件处理函数
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      // 获取当前分类下的所有链接
      const categoryLinks = links.filter(link => 
        selectedCategory === 'all' || link.categoryId === selectedCategory
      );
      
      // 找到被拖拽元素和目标元素的索引
      const activeIndex = categoryLinks.findIndex(link => link.id === active.id);
      const overIndex = categoryLinks.findIndex(link => link.id === over.id);
      
      if (activeIndex !== -1 && overIndex !== -1) {
        // 重新排序当前分类的链接
        const reorderedCategoryLinks = arrayMove(categoryLinks, activeIndex, overIndex);
        
        // 更新所有链接的顺序
        const updatedLinks = links.map(link => {
          const reorderedIndex = reorderedCategoryLinks.findIndex(l => l.id === link.id);
          if (reorderedIndex !== -1) {
            return { ...link, order: reorderedIndex };
          }
          return link;
        });
        
        // 按照order字段重新排序
        updatedLinks.sort((a, b) => (a.order || 0) - (b.order || 0));
        
        updateData(updatedLinks, categories);
      }
    }
  };

  // 置顶链接拖拽结束事件处理函数
  const handlePinnedDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      // 获取所有置顶链接
      const pinnedLinksList = links.filter(link => link.pinned);
      
      // 找到被拖拽元素和目标元素的索引
      const activeIndex = pinnedLinksList.findIndex(link => link.id === active.id);
      const overIndex = pinnedLinksList.findIndex(link => link.id === over.id);
      
      if (activeIndex !== -1 && overIndex !== -1) {
        // 重新排序置顶链接
        const reorderedPinnedLinks = arrayMove(pinnedLinksList, activeIndex, overIndex);
        
        // 创建一个映射，存储每个置顶链接的新pinnedOrder
        const pinnedOrderMap = new Map<string, number>();
        reorderedPinnedLinks.forEach((link, index) => {
          pinnedOrderMap.set(link.id, index);
        });
        
        // 只更新置顶链接的pinnedOrder，不改变任何链接的顺序
        const updatedLinks = links.map(link => {
          if (link.pinned) {
            return { 
              ...link, 
              pinnedOrder: pinnedOrderMap.get(link.id) 
            };
          }
          return link;
        });
        
        // 按照pinnedOrder重新排序整个链接数组，确保置顶链接的顺序正确
        // 同时保持非置顶链接的相对顺序不变
        updatedLinks.sort((a, b) => {
          // 如果都是置顶链接，按照pinnedOrder排序
          if (a.pinned && b.pinned) {
            return (a.pinnedOrder || 0) - (b.pinnedOrder || 0);
          }
          // 如果只有一个是置顶链接，置顶链接排在前面
          if (a.pinned) return -1;
          if (b.pinned) return 1;
          // 如果都不是置顶链接，保持原位置不变（按照order或createdAt排序）
          const aOrder = a.order !== undefined ? a.order : a.createdAt;
          const bOrder = b.order !== undefined ? b.order : b.createdAt;
          return bOrder - aOrder;
        });
        
        updateData(updatedLinks, categories);
      }
    }
  };

  // 开始排序
  const startSorting = (categoryId: string) => {
    if (!requireAuth()) return;
    setIsSortingMode(categoryId);
  };

  // 保存排序
  const saveSorting = () => {
    // 在保存排序时，确保将当前排序后的数据保存到服务器和本地存储
    updateData(links, categories);
    setIsSortingMode(null);
  };

  // 取消排序
  const cancelSorting = () => {
    setIsSortingMode(null);
  };

  // 保存置顶链接排序
  const savePinnedSorting = () => {
    // 在保存排序时，确保将当前排序后的数据保存到服务器和本地存储
    updateData(links, categories);
    setIsSortingPinned(false);
  };

  // 取消置顶链接排序
  const cancelPinnedSorting = () => {
    setIsSortingPinned(false);
  };

  // 设置dnd-kit的传感器
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // 需要拖动8px才开始拖拽，避免误触
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDeleteLink = (id: string) => {
    if (!authToken) { setIsAuthOpen(true); return; }
    if (confirm('确定删除此链接吗?')) {
      updateData(links.filter(l => l.id !== id), categories);
    }
  };

  const handleSaveAIConfig = async (config: AIConfig, newSiteSettings?: any) => {
      setAiConfig(config);
      localStorage.setItem(AI_CONFIG_KEY, JSON.stringify(config));
      
      if (newSiteSettings) {
          setSiteSettings(newSiteSettings);
          localStorage.setItem('cloudnav_site_settings', JSON.stringify(newSiteSettings));
      }
      
      if (authToken) {
          try {
              const response = await fetch('/api/storage', {
                  method: 'POST',
                  headers: buildAuthHeaders(authToken, {
                      'Content-Type': 'application/json',
                  }),
                  body: JSON.stringify({
                      saveConfig: 'ai',
                      config: config
                  })
              });
              
              if (!response.ok) {
                  console.error('Failed to save AI config to KV:', response.statusText);
              }
          } catch (error) {
              console.error('Error saving AI config to KV:', error);
          }
          
          if (newSiteSettings) {
              try {
                  const response = await fetch('/api/storage', {
                      method: 'POST',
                      headers: buildAuthHeaders(authToken, {
                          'Content-Type': 'application/json',
                      }),
                      body: JSON.stringify({
                          saveConfig: 'website',
                          config: newSiteSettings
                      })
                  });
                  
                  if (!response.ok) {
                      console.error('Failed to save website config to KV:', response.statusText);
                  }
              } catch (error) {
                  console.error('Error saving website config to KV:', error);
              }
          }
      }
  };

  const handleSaveToolsConfig = async (config: ToolsConfig) => {
      setToolsConfig(config);
      localStorage.setItem(TOOLS_CONFIG_KEY, JSON.stringify(config));

      if (authToken) {
          try {
              const response = await fetch('/api/storage', {
                  method: 'POST',
                  headers: buildAuthHeaders(authToken, {
                      'Content-Type': 'application/json',
                  }),
                  body: JSON.stringify({
                      saveConfig: 'tools',
                      config: config
                  })
              });

              if (!response.ok) {
                  console.error('Failed to save tools config to KV:', response.statusText);
              }
          } catch (error) {
              console.error('Error saving tools config to KV:', error);
          }
      }
  };

  const handleRestoreAIConfig = async (config: AIConfig) => {
      setAiConfig(config);
      localStorage.setItem(AI_CONFIG_KEY, JSON.stringify(config));
      
      // 同时保存到KV空间
      if (authToken) {
          try {
              const response = await fetch('/api/storage', {
                  method: 'POST',
                  headers: buildAuthHeaders(authToken, {
                      'Content-Type': 'application/json',
                  }),
                  body: JSON.stringify({
                      saveConfig: 'ai',
                      config: config
                  })
              });
              
              if (!response.ok) {
                  console.error('Failed to restore AI config to KV:', response.statusText);
                  return false;
              }
              return true;
          } catch (error) {
              console.error('Error restoring AI config to KV:', error);
              return false;
          }
      }
      return true;
  };

  // --- Category Management & Security ---

  const handleCategoryClick = (cat: Category) => {
      if (cat.requireAuth && !authToken) {
          setPendingProtectedCategoryId(cat.id);
          setIsAuthOpen(true);
          setSidebarOpen(false);
          return;
      }

      // If category has password and is NOT unlocked（匿名时用 hasPassword 标记判断）
      if ((cat.hasPassword || cat.password) && !unlockedCategoryIds.has(cat.id)) {
          setCatAuthModalData(cat);
          setSidebarOpen(false);
          return;
      }
      setSelectedCategory(cat.id);
      setSidebarOpen(false);
  };

  // 分类解锁：改为服务端验证密码（匿名时服务端不下发分类密码，不能前端比对）；
  // 验证通过后，未登录用户把服务端返回的该分类链接合并进本地数据
  const handleUnlockCategory = async (catId: string, password: string): Promise<boolean> => {
      try {
          const res = await fetch('/api/storage?category=' + encodeURIComponent(catId), {
              headers: { 'x-category-password': password }
          });
          if (!res.ok) return false;
          const data = await res.json();
          if (!authToken && data.links) {
              setLinks(prev => {
                  const others = prev.filter(l => l.categoryId !== catId);
                  return [...others, ...(data.links || [])];
              });
          }
          setUnlockedCategoryIds(prev => new Set(prev).add(catId));
          setSelectedCategory(catId);
          return true;
      } catch {
          return false;
      }
  };

  const handleUpdateCategories = (newCats: Category[]) => {
      if (!authToken) { setIsAuthOpen(true); return; }
      updateData(links, newCats);
  };

  const handleDeleteCategory = (catId: string) => {
      if (!authToken) { setIsAuthOpen(true); return; }
      
      // 防止删除"常用推荐"分类
      if (catId === 'common') {
          alert('"常用推荐"分类不能被删除');
          return;
      }
      
      let newCats = categories.filter(c => c.id !== catId);
      
      // 检查是否存在"常用推荐"分类，如果不存在则创建它
      if (!newCats.some(c => c.id === 'common')) {
          newCats = [
              { id: 'common', name: '常用推荐', icon: 'Star' },
              ...newCats
          ];
      }
      
      // Move links to common or first available
      const targetId = 'common'; 
      const newLinks = links.map(l => l.categoryId === catId ? { ...l, categoryId: targetId } : l);
      
      updateData(newLinks, newCats);
  };

  // --- WebDAV Config ---
  const handleSaveWebDavConfig = (config: WebDavConfig) => {
      setWebDavConfig(config);
      localStorage.setItem(WEBDAV_CONFIG_KEY, JSON.stringify(config));

      if (authToken) {
          fetch('/api/storage', {
              method: 'POST',
              headers: buildAuthHeaders(authToken, {
                  'Content-Type': 'application/json',
              }),
              body: JSON.stringify({
                  saveConfig: 'webdav',
                  config,
              })
          }).catch((error) => {
              console.error('Error saving WebDAV config to KV:', error);
          });
      }
  };

  const handleRestoreWebDavConfig = async (config: WebDavConfig): Promise<boolean> => {
      setWebDavConfig(config);
      try { localStorage.setItem(WEBDAV_CONFIG_KEY, JSON.stringify(config)); } catch (e) {}
      const token = authToken || localStorage.getItem(AUTH_KEY);
      if (!token) return true;
      try {
          const response = await fetch('/api/storage', {
              method: 'POST',
              headers: buildAuthHeaders(token, { 'Content-Type': 'application/json' }),
              body: JSON.stringify({ saveConfig: 'webdav', config }),
          });
          return response.ok;
      } catch (e) {
          return false;
      }
  };

  // 搜索源选择弹出窗口状态
  const [showSearchSourcePopup, setShowSearchSourcePopup] = useState(false);
  const [hoveredSearchSource, setHoveredSearchSource] = useState<ExternalSearchSource | null>(null);
  const [selectedSearchSource, setSelectedSearchSource] = useState<ExternalSearchSource | null>(null);
  const [isIconHovered, setIsIconHovered] = useState(false);
  const [isPopupHovered, setIsPopupHovered] = useState(false);
  const hideTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // 处理弹出窗口显示/隐藏逻辑
  useEffect(() => {
    if (isIconHovered || isPopupHovered) {
      // 如果图标或弹出窗口被悬停，清除隐藏定时器并显示弹出窗口
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
        hideTimeoutRef.current = null;
      }
      setShowSearchSourcePopup(true);
    } else {
      // 如果图标和弹出窗口都没有被悬停，设置一个延迟隐藏弹出窗口
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
      }
      hideTimeoutRef.current = setTimeout(() => {
        setShowSearchSourcePopup(false);
        setHoveredSearchSource(null);
      }, 100);
    }
    
    // 清理函数
    return () => {
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
      }
    };
  }, [isIconHovered, isPopupHovered]);

  // 打开外部搜索：每次打开前再次校验 HTTPS（防危险协议源绕过清洗）
  const openSearchUrl = (searchUrl: string) => {
    try {
      const u = new URL(searchUrl);
      if (u.protocol !== 'https:') return;
      window.open(u.href, '_blank', 'noopener,noreferrer');
    } catch {
      // URL 非法则忽略
    }
  };

  // 处理搜索源选择
  const handleSearchSourceSelect = async (source: ExternalSearchSource) => {
    // 更新选中的搜索源
    setSelectedSearchSource(source);
    
    // 保存选中的搜索源到KV空间
    await handleSaveSearchConfig(externalSearchSources, searchMode, source);
    
    if (searchQuery.trim()) {
      const searchUrl = source.url.replace('{query}', encodeURIComponent(searchQuery));
      openSearchUrl(searchUrl);
    }
    setShowSearchSourcePopup(false);
    setHoveredSearchSource(null);
  };

  // --- Search Config ---
  // 搜索源统一校验：仅接受 https 且含 {query}（云端/本地/备份恢复/保存所有入口一致）
  const sanitizeSearchSources = (sources: any): ExternalSearchSource[] =>
    Array.isArray(sources) ? sources.filter((s: any) =>
      s && typeof s === 'object' && typeof s.id === 'string' && typeof s.name === 'string' &&
      typeof s.url === 'string' && s.url.includes('{query}') && /^https:\/\//i.test(s.url)
    ) : [];

  // 从本地缓存恢复搜索配置（云端不可用时兜底）
  const loadLocalSearchConfig = () => {
    try {
      const raw = localStorage.getItem(SEARCH_CONFIG_KEY);
      if (!raw) return;
      const cfg = JSON.parse(raw);
      if (cfg && (cfg.mode === 'internal' || cfg.mode === 'external')) {
        setSearchMode(cfg.mode);
        if (Array.isArray(cfg.externalSources)) setExternalSearchSources(sanitizeSearchSources(cfg.externalSources));
        if (cfg.selectedSource) setSelectedSearchSource(cfg.selectedSource);
      }
    } catch (e) {}
  };

  const handleSaveSearchConfig = async (sources: ExternalSearchSource[], mode: SearchMode, selectedSource?: ExternalSearchSource | null, persistToCloud: boolean = true) => {
      const cleanSources = sanitizeSearchSources(sources);
      // selectedSource 同样清洗：必须是清洗后列表中的 https 源
      const rawSelected = selectedSource !== undefined ? selectedSource : selectedSearchSource;
      const selectedValid = !!rawSelected && typeof rawSelected === 'object' &&
          typeof rawSelected.id === 'string' && typeof rawSelected.url === 'string' &&
          /^https:\/\//i.test(rawSelected.url) && rawSelected.url.includes('{query}') &&
          cleanSources.some(s => s.id === rawSelected.id);
      const searchConfig: SearchConfig = {
          mode,
          externalSources: cleanSources,
          selectedSource: selectedValid ? rawSelected : null
      };
      
      setExternalSearchSources(sources);
      setSearchMode(mode);
      if (selectedSource !== undefined) {
          setSelectedSearchSource(selectedSource);
      }
      
      // 始终写本地缓存：云端暂时不可用时搜索配置仍保留
      try {
          localStorage.setItem(SEARCH_CONFIG_KEY, JSON.stringify(searchConfig));
      } catch (e) {}
      
      // 保存到KV空间（搜索配置允许无密码访问）；返回是否成功（未登录/未持久化视为本地成功）
      if (!persistToCloud || !authToken) {
          return true;
      }

      try {
          const response = await fetch('/api/storage', {
              method: 'POST',
              headers: buildAuthHeaders(authToken, {
                  'Content-Type': 'application/json'
              }),
              body: JSON.stringify({
                  saveConfig: 'search',
                  config: searchConfig
              })
          });
          
          if (!response.ok) {
              console.error('Failed to save search config to KV:', response.statusText);
              return false;
          }
          return true;
      } catch (error) {
          console.error('Error saving search config to KV:', error);
          return false;
      }
  };

  const openSearchConfigModal = () => {
      if (!requireAuth()) return;
      setIsSearchConfigModalOpen(true);
  };

  const handleSearchConfigModalSave = async (sources: ExternalSearchSource[]) => {
      if (!requireAuth()) return;
      await handleSaveSearchConfig(sources, searchMode, undefined, true);
  };

  const handleSearchModeChange = (mode: SearchMode) => {
      setSearchMode(mode);
      
      // 如果切换到外部搜索模式且搜索源列表为空，自动加载默认搜索源
      if (mode === 'external' && externalSearchSources.length === 0) {
          const defaultSources: ExternalSearchSource[] = [
              {
                  id: 'bing',
                  name: '必应',
                  url: 'https://www.bing.com/search?q={query}',
                  icon: 'Search',
                  enabled: true,
                  createdAt: Date.now()
              },
              {
                  id: 'google',
                  name: 'Google',
                  url: 'https://www.google.com/search?q={query}',
                  icon: 'Search',
                  enabled: true,
                  createdAt: Date.now()
              },
              {
                  id: 'baidu',
                  name: '百度',
                  url: 'https://www.baidu.com/s?wd={query}',
                  icon: 'Globe',
                  enabled: true,
                  createdAt: Date.now()
              },
              {
                  id: 'sogou',
                  name: '搜狗',
                  url: 'https://www.sogou.com/web?query={query}',
                  icon: 'Globe',
                  enabled: true,
                  createdAt: Date.now()
              },
              {
                  id: 'yandex',
                  name: 'Yandex',
                  url: 'https://yandex.com/search/?text={query}',
                  icon: 'Globe',
                  enabled: true,
                  createdAt: Date.now()
              },
              {
                  id: 'github',
                  name: 'GitHub',
                  url: 'https://github.com/search?q={query}',
                  icon: 'Github',
                  enabled: true,
                  createdAt: Date.now()
              },
              {
                  id: 'linuxdo',
                  name: 'Linux.do',
                  url: 'https://linux.do/search?q={query}',
                  icon: 'Terminal',
                  enabled: true,
                  createdAt: Date.now()
              },
              {
                  id: 'bilibili',
                  name: 'B站',
                  url: 'https://search.bilibili.com/all?keyword={query}',
                  icon: 'Play',
                  enabled: true,
                  createdAt: Date.now()
              },
              {
                  id: 'youtube',
                  name: 'YouTube',
                  url: 'https://www.youtube.com/results?search_query={query}',
                  icon: 'Video',
                  enabled: true,
                  createdAt: Date.now()
              },
              {
                  id: 'wikipedia',
                  name: '维基',
                  url: 'https://zh.wikipedia.org/wiki/Special:Search?search={query}',
                  icon: 'BookOpen',
                  enabled: true,
                  createdAt: Date.now()
              }
          ];
          
          // 保存默认搜索源到状态和KV空间
          handleSaveSearchConfig(defaultSources, mode);
      } else {
          handleSaveSearchConfig(externalSearchSources, mode);
      }
  };

  const handleExternalSearch = () => {
      if (searchQuery.trim() && searchMode === 'external') {
          // 如果搜索源列表为空，自动加载默认搜索源
          if (externalSearchSources.length === 0) {
              const defaultSources: ExternalSearchSource[] = [
                  {
                      id: 'bing',
                      name: '必应',
                      url: 'https://www.bing.com/search?q={query}',
                      icon: 'Search',
                      enabled: true,
                      createdAt: Date.now()
                  },
                  {
                      id: 'google',
                      name: 'Google',
                      url: 'https://www.google.com/search?q={query}',
                      icon: 'Search',
                      enabled: true,
                      createdAt: Date.now()
                  },
                  {
                      id: 'baidu',
                      name: '百度',
                      url: 'https://www.baidu.com/s?wd={query}',
                      icon: 'Globe',
                      enabled: true,
                      createdAt: Date.now()
                  },
                  {
                      id: 'sogou',
                      name: '搜狗',
                      url: 'https://www.sogou.com/web?query={query}',
                      icon: 'Globe',
                      enabled: true,
                      createdAt: Date.now()
                  },
                  {
                      id: 'yandex',
                      name: 'Yandex',
                      url: 'https://yandex.com/search/?text={query}',
                      icon: 'Globe',
                      enabled: true,
                      createdAt: Date.now()
                  },
                  {
                      id: 'github',
                      name: 'GitHub',
                      url: 'https://github.com/search?q={query}',
                      icon: 'Github',
                      enabled: true,
                      createdAt: Date.now()
                  },
                  {
                      id: 'linuxdo',
                      name: 'Linux.do',
                      url: 'https://linux.do/search?q={query}',
                      icon: 'Terminal',
                      enabled: true,
                      createdAt: Date.now()
                  },
                  {
                      id: 'bilibili',
                      name: 'B站',
                      url: 'https://search.bilibili.com/all?keyword={query}',
                      icon: 'Play',
                      enabled: true,
                      createdAt: Date.now()
                  },
                  {
                      id: 'youtube',
                      name: 'YouTube',
                      url: 'https://www.youtube.com/results?search_query={query}',
                      icon: 'Video',
                      enabled: true,
                      createdAt: Date.now()
                  },
                  {
                      id: 'wikipedia',
                      name: '维基',
                      url: 'https://zh.wikipedia.org/wiki/Special:Search?search={query}',
                      icon: 'BookOpen',
                      enabled: true,
                      createdAt: Date.now()
                  }
              ];
              
              // 保存默认搜索源到状态和KV空间
              handleSaveSearchConfig(defaultSources, 'external');
              
              // 使用第一个默认搜索源立即执行搜索
              const searchUrl = defaultSources[0].url.replace('{query}', encodeURIComponent(searchQuery));
              openSearchUrl(searchUrl);
              return;
          }
          
          // 如果有选中的搜索源，使用选中的搜索源；否则使用第一个启用的搜索源
          let source = selectedSearchSource;
          if (!source) {
              const enabledSources = externalSearchSources.filter(s => s.enabled);
              if (enabledSources.length > 0) {
                  source = enabledSources[0];
              }
          }
          
          if (source) {
              const searchUrl = source.url.replace('{query}', encodeURIComponent(searchQuery));
              openSearchUrl(searchUrl);
          }
      }
  };

  const handleRestoreBackup = async (restoredLinks: LinkItem[], restoredCategories: Category[]): Promise<boolean> => {
      // 恢复入口统一 sanitize（与云端/本地/KV 加载一致，防止畸形备份进入 React 状态）
      const cleanLinks = sanitizeLinks(restoredLinks);
      const cleanCategories = sanitizeCategories(restoredCategories);
      setLinks(cleanLinks);
      setCategories(cleanCategories);
      try {
          localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify({ links: cleanLinks, categories: cleanCategories }));
      } catch (e) {}
      // 主数据同步到云端成功才算恢复成功（登录时）
      const token = authToken || localStorage.getItem(AUTH_KEY);
      if (token) {
          return await syncToCloud(cleanLinks, cleanCategories, token);
      }
      return true;
  };

  const handleRestoreSearchConfig = async (restoredSearchConfig: SearchConfig): Promise<boolean> => {
      return handleSaveSearchConfig(restoredSearchConfig.externalSources || [], restoredSearchConfig.mode || 'internal');
  };

  const handleRestoreSiteConfig = async (config: SiteSettings): Promise<boolean> => {
      setSiteSettings(config);
      try { localStorage.setItem(SITE_SETTINGS_KEY, JSON.stringify(config)); } catch (e) {}
      const token = authToken || localStorage.getItem(AUTH_KEY);
      if (!token) return true;
      try {
          const response = await fetch('/api/storage', {
              method: 'POST',
              headers: buildAuthHeaders(token, { 'Content-Type': 'application/json' }),
              body: JSON.stringify({ saveConfig: 'website', config }),
          });
          return response.ok;
      } catch (e) {
          return false;
      }
  };

  const handleRestoreToolsConfig = async (config: ToolsConfig): Promise<boolean> => {
      setToolsConfig(config);
      try { localStorage.setItem(TOOLS_CONFIG_KEY, JSON.stringify(config)); } catch (e) {}
      const token = authToken || localStorage.getItem(AUTH_KEY);
      if (!token) return true;
      try {
          const response = await fetch('/api/storage', {
              method: 'POST',
              headers: buildAuthHeaders(token, { 'Content-Type': 'application/json' }),
              body: JSON.stringify({ saveConfig: 'tools', config }),
          });
          return response.ok;
      } catch (e) {
          return false;
      }
  };

  // --- Filtering & Memo ---

  const requiresGlobalCategoryAuth = (catId: string) => {
      const cat = categories.find(c => c.id === catId);
      return !!cat?.requireAuth && !authToken;
  };

  // Helper to check if a category is "Locked"
  const isCategoryLocked = (catId: string) => {
      const cat = categories.find(c => c.id === catId);
      if (!cat) return false;
      if (cat.requireAuth && !authToken) return true;
      // 分类密码：匿名时服务端不下发明文，只有 hasPassword 标记
      if (!cat.hasPassword && !cat.password) return false;
      return !unlockedCategoryIds.has(catId);
  };

  const pinnedLinks = useMemo(() => {
      // Don't show pinned links if they belong to a locked category
      const filteredPinnedLinks = links.filter(l => l.pinned && !isCategoryLocked(l.categoryId) && !l.hidden);
      // 按照pinnedOrder字段排序，如果没有pinnedOrder字段则按创建时间排序
      return filteredPinnedLinks.sort((a, b) => {
        // 如果有pinnedOrder字段，则使用pinnedOrder排序
        if (a.pinnedOrder !== undefined && b.pinnedOrder !== undefined) {
          return a.pinnedOrder - b.pinnedOrder;
        }
        // 如果只有一个有pinnedOrder字段，有pinnedOrder的排在前面
        if (a.pinnedOrder !== undefined) return -1;
        if (b.pinnedOrder !== undefined) return 1;
        // 如果都没有pinnedOrder字段，则按创建时间排序
        return a.createdAt - b.createdAt;
      });
  }, [links, categories, unlockedCategoryIds]);

  const displayedLinks = useMemo(() => {
    let result = links;
    
    // Security Filter: Always hide links from locked categories
    result = result.filter(l => !isCategoryLocked(l.categoryId));

    // 隐藏过滤：不显示用户隐藏的链接
    result = result.filter(l => !l.hidden);

    // Search Filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(l => 
        l.title.toLowerCase().includes(q) || 
        l.url.toLowerCase().includes(q) ||
        (l.description && l.description.toLowerCase().includes(q))
      );
    }

    // Category Filter
    if (selectedCategory !== 'all') {
      result = result.filter(l => l.categoryId === selectedCategory);
    }
    
    // 按照order字段排序，如果没有order字段则按创建时间排序
    // 修改排序逻辑：order值越大排在越前面，新增的卡片order值最大，会排在最前面
    // 我们需要反转这个排序，让新增的卡片(order值最大)排在最后面
    return result.sort((a, b) => {
      const aOrder = a.order !== undefined ? a.order : a.createdAt;
      const bOrder = b.order !== undefined ? b.order : b.createdAt;
      // 改为升序排序，这样order值小(旧卡片)的排在前面，order值大(新卡片)的排在后面
      return aOrder - bOrder;
    });
  }, [links, selectedCategory, searchQuery, categories, unlockedCategoryIds]);

  // 计算其他目录的搜索结果
  const otherCategoryResults = useMemo(() => {
    if (!searchQuery.trim() || selectedCategory === 'all') {
      return [];
    }

    const q = searchQuery.toLowerCase();
    
    // 获取其他目录中匹配的链接
    const otherLinks = links.filter(link => {
      // 排除当前目录的链接
      if (link.categoryId === selectedCategory) {
        return false;
      }
      
      // 排除锁定的目录
      if (isCategoryLocked(link.categoryId)) {
        return false;
      }

      // 排除用户隐藏的链接
      if (link.hidden) {
        return false;
      }
      
      // 搜索匹配
      return (
        link.title.toLowerCase().includes(q) || 
        link.url.toLowerCase().includes(q) ||
        (link.description && link.description.toLowerCase().includes(q))
      );
    });

    // 按目录分组
    const groupedByCategory = otherLinks.reduce((acc, link) => {
      if (!acc[link.categoryId]) {
        acc[link.categoryId] = [];
      }
      acc[link.categoryId].push(link);
      return acc;
    }, {} as Record<string, LinkItem[]>);

    // 对每个目录内的链接进行排序
    Object.keys(groupedByCategory).forEach(categoryId => {
      groupedByCategory[categoryId].sort((a, b) => {
        const aOrder = a.order !== undefined ? a.order : a.createdAt;
        const bOrder = b.order !== undefined ? b.order : b.createdAt;
        return aOrder - bOrder;
      });
    });

    return groupedByCategory;
  }, [links, selectedCategory, searchQuery, categories, unlockedCategoryIds]);


  // --- Render Components ---

  // 创建可排序的链接卡片组件
  const SortableLinkCard = ({ link }: { link: LinkItem }) => {
    const {
      attributes,
      listeners,
      setNodeRef,
      transform,
      transition,
      isDragging,
    } = useSortable({ id: link.id });
    
    // 根据视图模式决定卡片样式
    const isDetailedView = siteSettings.cardStyle === 'detailed';
    
    const style = {
      transform: CSS.Transform.toString(transform),
      transition: isDragging ? 'none' : transition,
      opacity: isDragging ? 0.5 : 1,
      zIndex: isDragging ? 1000 : 'auto',
    };

    return (
      <div
        ref={setNodeRef}
        style={style}
        className={`group relative transition-all duration-200 cursor-grab active:cursor-grabbing min-w-0 max-w-full overflow-hidden ${
          isSortingMode || isSortingPinned
            ? 'bg-green-20 dark:bg-green-900/30 border-green-200 dark:border-green-800' 
            : 'bg-white/70 dark:bg-slate-800/70 backdrop-blur-md border-slate-200/70 dark:border-slate-700/70'
        } ${isDragging ? 'shadow-2xl scale-105' : ''} ${
          isDetailedView 
            ? 'flex flex-col rounded-[13px] border p-3.5 min-h-[85px] hover:border-green-400 dark:hover:border-green-500' 
            : 'flex items-center rounded-[13px] border p-2.5 hover:border-green-300 dark:hover:border-green-600'
        }`}
        {...attributes}
        {...listeners}
      >
        {/* 链接内容 - 移除a标签，改为div防止点击跳转 */}
        <div className={`flex flex-1 min-w-0 overflow-hidden ${
          isDetailedView ? 'flex-col' : 'items-center gap-3'
        }`}>
          {/* 第一行：图标和标题水平排列 */}
          <div className={`flex items-center gap-3 mb-2 ${
            isDetailedView ? '' : 'w-full'
          }`}>
            {/* Icon */}
            <div className={`text-blue-600 dark:text-blue-400 flex items-center justify-center text-sm font-bold uppercase shrink-0 w-7 h-7 rounded-lg bg-slate-100/80 dark:bg-slate-700/80`}>
                {link.icon ? <img src={link.icon} alt="" className="w-4 h-4"/> : link.title.charAt(0)}
            </div>
            
            {/* 标题 */}
            <h3 className={`text-slate-900 dark:text-slate-100 truncate overflow-hidden text-ellipsis ${
              isDetailedView ? 'text-sm' : 'text-[13px] font-medium text-slate-800 dark:text-slate-200'
            }`} title={link.title}>
                {link.title}
            </h3>
          </div>
          
          {/* 第二行：描述文字 */}
             {isDetailedView && link.description && (
               <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed line-clamp-2">
                 {link.description}
               </p>
             )}
        </div>
      </div>
    );
  };

  const renderLinkCard = (link: LinkItem) => {
    const isSelected = selectedLinks.has(link.id);
    
    // 根据视图模式决定卡片样式
    const isDetailedView = siteSettings.cardStyle === 'detailed';
    
    return (
      <div
        key={link.id}
        className={`group relative transition-all duration-200 ${
          isSelected 
            ? 'bg-red-50 dark:bg-red-900/30 border-red-200 dark:border-red-800' 
            : 'bg-white/70 dark:bg-slate-800/70 backdrop-blur-md hover:bg-blue-50/70 dark:hover:bg-blue-900/20 border-slate-200/70 dark:border-slate-700/70'
        } ${isBatchEditMode ? 'cursor-pointer' : ''} ${
          isDetailedView 
            ? 'flex flex-col rounded-[13px] border p-3.5 min-h-[85px] hover:border-blue-400 dark:hover:border-blue-500' 
            : 'flex items-center justify-between rounded-[13px] border p-2.5 hover:border-blue-300 dark:hover:border-blue-600'
        }`}
        onClick={() => isBatchEditMode && toggleLinkSelection(link.id)}
        onContextMenu={(e) => handleContextMenu(e, link)}
      >
        {/* 链接内容 - 在批量编辑模式下不使用a标签 */}
        {isBatchEditMode ? (
          <div className={`flex flex-1 min-w-0 overflow-hidden h-full ${
            isDetailedView ? 'flex-col' : 'items-center'
          }`}>
            {/* 第一行：图标和标题水平排列 */}
            <div className={`flex items-center gap-3 w-full`}>
              {/* Icon */}
              <div className={`text-blue-600 dark:text-blue-400 flex items-center justify-center text-sm font-bold uppercase shrink-0 w-7 h-7 rounded-lg bg-slate-100/80 dark:bg-slate-700/80`}>
                  {link.icon ? <img src={link.icon} alt="" className="w-4 h-4"/> : link.title.charAt(0)}
              </div>
              
              {/* 标题 */}
              <h3 className={`text-slate-900 dark:text-slate-100 truncate overflow-hidden text-ellipsis ${
                isDetailedView ? 'text-sm' : 'text-[13px] font-medium text-slate-800 dark:text-slate-200'
              }`} title={link.title}>
                  {link.title}
              </h3>
            </div>
            
            {/* 第二行：描述文字 */}
            {isDetailedView && link.description && (
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed line-clamp-2">
                {link.description}
              </p>
            )}
          </div>
        ) : (
          <a
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className={`flex flex-1 min-w-0 overflow-hidden h-full ${
              isDetailedView ? 'flex-col' : 'items-center'
            }`}
            title={isDetailedView ? link.url : (link.description || link.url)} // 详情版视图只显示URL作为tooltip
          >
            {/* 第一行：图标和标题水平排列 */}
            <div className={`flex items-center gap-3 w-full`}>
              {/* Icon */}
              <div className={`text-blue-600 dark:text-blue-400 flex items-center justify-center text-sm font-bold uppercase shrink-0 w-7 h-7 rounded-lg bg-slate-100/80 dark:bg-slate-700/80`}>
                  {link.icon ? <img src={link.icon} alt="" className="w-4 h-4"/> : link.title.charAt(0)}
              </div>
              
              {/* 标题 */}
                <h3 className={`text-slate-800 dark:text-slate-200 truncate whitespace-nowrap overflow-hidden text-ellipsis group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors ${
                  isDetailedView ? 'text-sm' : 'text-[13px] font-medium'
                }`} title={link.title}>
                    {link.title}
                </h3>
            </div>
            
            {/* 第二行：描述文字 */}
              {isDetailedView && link.description && (
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed line-clamp-2">
                  {link.description}
                </p>
              )}
            {!isDetailedView && link.description && (
              <div className="tooltip-custom absolute left-0 -top-8 w-max max-w-[200px] bg-black text-white text-xs p-2 rounded opacity-0 invisible group-hover:visible group-hover:opacity-100 transition-all z-20 pointer-events-none truncate">
                {link.description}
              </div>
            )}
          </a>
        )}

        {/* Hover Actions (Absolute Right) - 在批量编辑模式下隐藏 */}
        {!isBatchEditMode && (
          <div className={`flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity bg-blue-50 dark:bg-blue-900/20 backdrop-blur-sm rounded-md p-1 absolute ${
            isDetailedView ? 'top-2.5 right-2.5' : 'top-1/2 -translate-y-1/2 right-1.5'
          }`}>
              <button 
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); if(!requireAuth()) return; setEditingLink(link); setIsModalOpen(true); }}
                  className="p-1 text-slate-400 hover:text-blue-500 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-md"
                  title="编辑"
              >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M12 15.5A3.5 3.5 0 0 1 8.5 12A3.5 3.5 0 0 1 12 8.5a3.5 3.5 0 0 1 3.5 3.5a3.5 3.5 0 0 1-3.5 3.5m7.43-2.53c.04-.32.07-.64.07-.97c0-.33-.03-.65-.07-.97l2.11-1.63c.19-.15.24-.42.12-.64l-2-3.46c-.12-.22-.39-.3-.61-.22l-2.49 1c-.52-.39-1.06-.73-1.69-.98l-.37-2.65A.506.506 0 0 0 14 2h-4c-.25 0-.46.18-.5.42l-.37 2.65c-.63.25-1.17.59-1.69.98l-2.49-1c-.22-.08-.49 0-.61.22l-2 3.46c-.13.22-.07.49.12.64L4.57 11c-.04.32-.07.64-.07.97c0 .33.03.65.07.97l-2.11 1.63c-.19.15-.24.42-.12.64l2 3.46c.12.22.39.3.61.22l2.49-1c.52.39 1.06.73 1.69.98l.37 2.65c.04.24.25.42.5.42h4c.25 0 .46-.18.5-.42l.37-2.65c.63-.25 1.17-.59 1.69-.98l2.49 1c.22.08.49 0 .61-.22l2-3.46c.13-.22.07-.49-.12-.64l-2.11-1.63Z" fill="currentColor"/>
                  </svg>
              </button>
          </div>
        )}
      </div>
    );
  };

  if (isCheckingAuth && requiresAuth === null) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50 dark:bg-slate-900 text-slate-500 dark:text-slate-400">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden text-slate-900 dark:text-slate-50">
      {/* 全局背景层（Bing 壁纸 / 自定义图片 / 纯色） */}
      <BackgroundLayer config={siteSettings.background} darkMode={darkMode} syncSignal={bgSyncSignal} />
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-[120] will-change-[clip-path,opacity,background-color] transition-[clip-path,opacity,background-color] duration-[620ms]"
        style={{
          backgroundColor: themeTransition.targetDark ? '#020617' : '#f8fafc',
          opacity: themeTransition.visible ? 1 : 0,
          clipPath: `circle(${themeTransition.radius}px at ${themeTransition.x}px ${themeTransition.y}px)`,
          transitionTimingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)',
        }}
      />
      <AuthModal
        isOpen={isAuthOpen}
        onLogin={handleLogin}
        onClose={() => setIsAuthOpen(false)}
        canClose={true}
        description="输入部署时设置的 PASSWORD，验证后就能继续操作。"
      />
      {requiresAuth && !authToken && (
        <AuthModal
          isOpen={true}
          onLogin={handleLogin}
          description="这个站点开了访问验证，先输密码才能看。"
        />
      )}
      {(!requiresAuth || authToken) && (
      <>
      <CategoryAuthModal 
        isOpen={!!catAuthModalData}
        category={catAuthModalData}
        onClose={() => setCatAuthModalData(null)}
        onUnlock={handleUnlockCategory}
      />

      <Suspense fallback={null}>
        <CategoryManagerModal 
          isOpen={isCatManagerOpen} 
          onClose={() => setIsCatManagerOpen(false)}
          categories={categories}
          onUpdateCategories={handleUpdateCategories}
          onDeleteCategory={handleDeleteCategory}
          onVerifyPassword={handleCategoryActionAuth}
        />
      </Suspense>

      <Suspense fallback={null}>
        <BackupModal
          isOpen={isBackupModalOpen}
          onClose={() => setIsBackupModalOpen(false)}
          links={links}
          categories={categories}
          onRestore={handleRestoreBackup}
          webDavConfig={webDavConfig}
          onSaveWebDavConfig={handleSaveWebDavConfig}
          onRestoreWebDavConfig={handleRestoreWebDavConfig}
          searchConfig={{ mode: searchMode, externalSources: externalSearchSources }}
          onRestoreSearchConfig={handleRestoreSearchConfig}
          aiConfig={aiConfig}
          onRestoreAIConfig={handleRestoreAIConfig}
          siteSettings={siteSettings}
          toolsConfig={toolsConfig}
          onRestoreSiteConfig={handleRestoreSiteConfig}
          onRestoreToolsConfig={handleRestoreToolsConfig}
        />
      </Suspense>

      <Suspense fallback={null}>
        <ImportModal
          isOpen={isImportModalOpen}
          onClose={() => setIsImportModalOpen(false)}
          existingLinks={links}
          categories={categories}
          onImport={handleImportConfirm}
          onImportSearchConfig={handleRestoreSearchConfig}
          onImportAIConfig={handleRestoreAIConfig}
          onImportWebDavConfig={handleRestoreWebDavConfig}
        />
      </Suspense>

      <Suspense fallback={null}>
        <SettingsModal
          isOpen={isSettingsModalOpen}
          onClose={() => setIsSettingsModalOpen(false)}
          config={aiConfig}
          siteSettings={siteSettings}
          onSave={handleSaveAIConfig}
          onBingSync={handleBingSync}
          links={links}
          onUpdateLinks={(newLinks) => updateData(newLinks, categories)}
          authToken={authToken}
          toolsConfig={toolsConfig}
          onSaveToolsConfig={handleSaveToolsConfig}
          onPasswordChanged={(sessionCredential) => {
              setAuthToken(sessionCredential);
              localStorage.setItem(AUTH_KEY, sessionCredential);
              localStorage.setItem(AUTH_TIME_KEY, String(Date.now()));
              // 密码已变更：清空旧同步任务与 pending 快照、递增代次，防止旧任务用旧 token 写回或清除新会话
              if (syncTimerRef.current) { clearTimeout(syncTimerRef.current); syncTimerRef.current = null; }
              pendingSyncRef.current = null;
              syncGenerationRef.current += 1;
              syncQueueRef.current = Promise.resolve();
          }}
          initialTab={settingsInitialTab}
        />
      </Suspense>

      <Suspense fallback={null}>
        <SearchConfigModal
          isOpen={isSearchConfigModalOpen}
          onClose={() => setIsSearchConfigModalOpen(false)}
          sources={externalSearchSources}
          onSave={handleSearchConfigModalSave}
        />
      </Suspense>

      {/* Sidebar Mobile Overlay */}
      {sidebarOpen && (
        <div 
          className="fixed inset-0 z-20 bg-black/50 lg:hidden backdrop-blur-sm"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside 
        className={`
          fixed lg:static inset-y-0 left-0 z-30 w-[205px] transition-all duration-300 ease-in-out
          bg-white/75 dark:bg-slate-800/75 backdrop-blur-md border-r border-slate-200 dark:border-slate-700 flex flex-col
        `}
        style={{ left: sidebarOpen ? '0px' : '-205px' }}
      >
        {/* Logo */}
        <div className={`h-16 flex items-center px-6 border-b border-slate-100 dark:border-slate-700 shrink-0 ${siteSettings.navTitleAlign === 'center' ? 'justify-center' : siteSettings.navTitleAlign === 'right' ? 'justify-end' : 'justify-start'}`}>
            <span className="text-lg font-bold bg-gradient-to-r from-blue-500 to-purple-500 bg-clip-text text-transparent">
              {siteSettings.navTitle || 'CloudNav'}
            </span>
        </div>

        {/* Categories List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-1 scrollbar-hide">
            <button
              onClick={() => { setSelectedCategory('all'); setSidebarOpen(false); }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${
                selectedCategory === 'all' 
                  ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 font-medium' 
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700'
              }`}
            >
              <div className="p-1"><Icon name="LayoutGrid" size={18} /></div>
              <span className="text-sm">置顶网站</span>
            </button>
            
            <div className="flex items-center justify-between pt-4 pb-2 px-4">
               <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">分类目录</span>
               <button 
                  onClick={() => { if(!authToken) setIsAuthOpen(true); else setIsCatManagerOpen(true); }}
                  className="p-1 text-slate-400 hover:text-blue-500 hover:bg-slate-100 dark:hover:bg-slate-700 rounded"
                  title="管理分类"
               >
                  <Settings size={14} />
               </button>
            </div>

            {categories.map(cat => {
                const isLocked = isCategoryLocked(cat.id);
                return (
                  <button
                    key={cat.id}
                    onClick={() => handleCategoryClick(cat)}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all group ${
                      selectedCategory === cat.id 
                        ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 font-medium' 
                        : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700'
                    }`}
                  >
                    <div className={`p-1.5 rounded-lg transition-colors flex items-center justify-center ${selectedCategory === cat.id ? 'bg-blue-100 dark:bg-blue-800' : 'bg-slate-100 dark:bg-slate-800'}`}>
                      {isLocked ? <Lock size={16} className="text-amber-500" /> : <Icon name={cat.icon} size={16} />}
                    </div>
                    <span className="truncate flex-1 text-left text-sm">{cat.name}</span>
                    {requiresGlobalCategoryAuth(cat.id) && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                        需登录
                      </span>
                    )}
                    {selectedCategory === cat.id && <div className="w-1.5 h-1.5 rounded-full bg-blue-500"></div>}
                  </button>
                );
            })}
        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t border-slate-100 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/50 shrink-0">
            
            <div className="grid grid-cols-3 gap-2 mb-2">
                <button 
                    onClick={() => { if(!authToken) setIsAuthOpen(true); else setIsImportModalOpen(true); }}
                    className="flex flex-col items-center justify-center gap-1 p-2 text-[10px] text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700 rounded-lg border border-slate-200 dark:border-slate-600 transition-all"
                    title="导入书签"
                >
                    <Upload size={14} />
                    <span>导入</span>
                </button>
                
                <button 
                    onClick={() => { if(!authToken) setIsAuthOpen(true); else setIsBackupModalOpen(true); }}
                    className="flex flex-col items-center justify-center gap-1 p-2 text-[10px] text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700 rounded-lg border border-slate-200 dark:border-slate-600 transition-all"
                    title="备份与恢复"
                >
                    <CloudCog size={14} />
                    <span>备份</span>
                </button>

                <button 
                    onClick={() => { if(!authToken) setIsAuthOpen(true); else setIsSettingsModalOpen(true); }}
                    className="flex flex-col items-center justify-center gap-1 p-2 text-[10px] text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700 rounded-lg border border-slate-200 dark:border-slate-600 transition-all"
                    title="AI 设置"
                >
                    <Settings size={14} />
                    <span>设置</span>
                </button>
            </div>
            
            <div className="text-[10px] px-2 mt-2">
               <div className="flex items-center gap-1 text-slate-400">
                 {syncStatus === 'saving' && <Loader2 className="animate-spin w-3 h-3 text-blue-500" />}
                 {syncStatus === 'saved' && <CheckCircle2 className="w-3 h-3 text-green-500" />}
                 {syncStatus === 'error' && <AlertCircle className="w-3 h-3 text-red-500" />}
                 {authToken ? <span className="text-green-600">已同步</span> : <span className="text-amber-500">离线</span>}
               </div>
               {/* 扩展收件箱状态 */}
               {(inboxStatus === 'pending' || inboxStatus === 'importing' || inboxStatus === 'imported' || inboxStatus === 'error') && authToken && (
                 <div className="flex items-center gap-1 text-[10px] mt-0.5">
                   {inboxStatus === 'importing'
                     ? <Loader2 className="animate-spin w-3 h-3 text-blue-500" />
                     : inboxStatus === 'imported'
                       ? <CheckCircle2 className="w-3 h-3 text-green-500" />
                       : inboxStatus === 'error'
                         ? <AlertCircle className="w-3 h-3 text-red-500" />
                         : <span className="w-3 h-3" />}
                   <span className={inboxStatus === 'error' ? 'text-red-500' : 'text-slate-400'}>
                     {inboxStatus === 'pending' && '扩展待处理'}
                     {inboxStatus === 'importing' && '正在导入扩展链接…'}
                     {inboxStatus === 'imported' && '扩展链接已导入'}
                     {inboxStatus === 'error' && '扩展导入失败，稍后重试'}
                   </span>
                 </div>
               )}
            </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-full bg-slate-50/80 dark:bg-slate-900/80 backdrop-blur-xl overflow-hidden relative">
        
        {/* Header */}
        <header className="h-16 px-4 lg:px-8 flex items-center justify-between bg-white/80 dark:bg-slate-800/80 backdrop-blur-md border-b border-slate-200 dark:border-slate-700 sticky top-0 z-10 shrink-0">
          <div className="flex items-center gap-4 flex-1">
            <button onClick={() => setSidebarOpen(true)} className="lg:hidden p-2 -ml-2 text-slate-600 dark:text-slate-300">
              <Menu size={24} />
            </button>

            {/* 搜索模式切换 + 搜索框 */}
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <button 
                onClick={() => {
                  setIsMobileSearchOpen(!isMobileSearchOpen);
                  if (searchMode !== 'external') {
                    handleSearchModeChange('external');
                  }
                }}
                className="sm:flex md:hidden lg:hidden p-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-full transition-colors"
                title="搜索"
              >
                <Search size={20} />
              </button>

              {/* 搜索模式切换 - 平板端和桌面端显示，手机端隐藏 */}
              <div className="hidden sm:hidden md:flex lg:flex items-center gap-2 flex-shrink-0">
                <div className="flex items-center bg-slate-100 dark:bg-slate-700 rounded-full p-1">
                  <button
                    onClick={() => handleSearchModeChange('internal')}
                    className={`px-3 py-1 text-xs font-medium rounded-full transition-all flex items-center justify-center min-h-[24px] min-w-[40px] ${
                      searchMode === 'internal'
                        ? 'bg-white dark:bg-slate-600 text-blue-600 dark:text-blue-400 shadow-sm'
                        : 'text-slate-600 dark:text-slate-300 hover:text-slate-800 dark:hover:text-slate-100'
                    }`}
                    title="站内搜索"
                  >
                    站内
                  </button>
                  <button
                    onClick={() => handleSearchModeChange('external')}
                    className={`px-3 py-1 text-xs font-medium rounded-full transition-all flex items-center justify-center min-h-[24px] min-w-[40px] ${
                      searchMode === 'external'
                        ? 'bg-white dark:bg-slate-600 text-blue-600 dark:text-blue-400 shadow-sm'
                        : 'text-slate-600 dark:text-slate-300 hover:text-slate-800 dark:hover:text-slate-100'
                    }`}
                    title="站外搜索"
                  >
                    站外
                  </button>
                </div>
                {searchMode === 'external' && (
                  <button
                    onClick={openSearchConfigModal}
                    className="p-1.5 text-slate-400 hover:text-blue-500 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-full transition-colors"
                    title="管理搜索源"
                  >
                    <Settings size={14} />
                  </button>
                )}
              </div>

              {/* 搜索框 */}
              <div className={`relative w-full max-w-lg ${isMobileSearchOpen ? 'block' : 'hidden'} sm:block`}>
                {/* 搜索源选择弹出窗口 */}
                {searchMode === 'external' && showSearchSourcePopup && (
                  <div 
                    className="absolute left-0 top-full mt-2 w-full bg-white dark:bg-slate-800 rounded-lg shadow-lg border border-slate-200 dark:border-slate-700 p-3 z-50"
                    onMouseEnter={() => setIsPopupHovered(true)}
                    onMouseLeave={() => setIsPopupHovered(false)}
                  >
                    <div className="grid grid-cols-5 sm:grid-cols-5 gap-2">
                      {externalSearchSources
                        .filter(source => source.enabled)
                        .map((source, index) => (
                          <button
                            key={index}
                            onClick={() => handleSearchSourceSelect(source)}
                            onMouseEnter={() => setHoveredSearchSource(source)}
                            onMouseLeave={() => setHoveredSearchSource(null)}
                            className="px-2 py-2 text-sm rounded-md hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 flex items-center gap-1 justify-center"
                          >
                            <img 
                              src={`https://www.faviconextractor.com/favicon/${new URL(source.url).hostname}?larger=true`}
                              alt={source.name}
                              className="w-4 h-4"
                              onError={(e) => {
                                const target = e.target as HTMLImageElement;
                                target.src = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxNiIgaGVpZ2h0PSIxNiIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9ImN1cnJlbnRDb2xvciIgc3Ryb2tlLXdpZHRoPSIyIiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiIGNsYXNzPSJsdWNpZGUgbHVjaWRlLXNlYXJjaCI+PHBhdGggZD0ibTIxIDIxLTQuMzQtNC4zNCI+PC9wYXRoPjxjaXJjbGUgY3g9IjExIiBjeT0iMTEiIHI9IjgiPjwvY2lyY2xlPjwvc3ZnPg==';
                              }}
                            />
                            <span className="truncate hidden sm:inline">{source.name}</span>
                          </button>
                        ))}
                    </div>
                  </div>
                )}

                <div 
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 cursor-pointer"
                  onMouseEnter={() => searchMode === 'external' && setIsIconHovered(true)}
                  onMouseLeave={() => setIsIconHovered(false)}
                  onClick={() => {
                    if (searchMode === 'external') {
                      setShowSearchSourcePopup(!showSearchSourcePopup);
                    }
                  }}
                >
                  {searchMode === 'internal' ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-search">
                      <path d="m21 21-4.35-4.35"></path>
                      <circle cx="11" cy="11" r="8"></circle>
                    </svg>
                  ) : (hoveredSearchSource || selectedSearchSource) ? (
                    <img 
                      src={(() => {
                        const source = hoveredSearchSource || selectedSearchSource;
                        try {
                          return `https://www.faviconextractor.com/favicon/${new URL(source.url).hostname}?larger=true`;
                        } catch {
                          // 数据异常（如 KV 中 selectedSource 缺失/格式错误）时降级为通用图标
                          return 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxNiIgaGVpZ2h0PSIxNiIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9ImN1cnJlbnRDb2xvciIgc3Ryb2tlLXdpZHRoPSIyIiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiIGNsYXNzPSJsdWNpZGUgbHVjaWRlLXNlYXJjaCI+PHBhdGggZD0ibTIxIDIxLTQuMzQtNC4zNCI+PC9wYXRoPjxjaXJjbGUgY3g9IjExIiBjeT0iMTEiIHI9IjgiPjwvY2lyY2xlPjwvc3ZnPg==';
                        }
                      })()}
                      alt={(hoveredSearchSource || selectedSearchSource).name}
                      className="w-4 h-4"
                      onError={(e) => {
                        const target = e.target as HTMLImageElement;
                        target.src = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxNiIgaGVpZ2h0PSIxNiIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9ImN1cnJlbnRDb2xvciIgc3Ryb2tlLXdpZHRoPSIyIiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiIGNsYXNzPSJsdWNpZGUgbHVjaWRlLXNlYXJjaCI+PHBhdGggZD0ibTIxIDIxLTQuMzQtNC4zNCI+PC9wYXRoPjxjaXJjbGUgY3g9IjExIiBjeT0iMTEiIHI9IjgiPjwvY2lyY2xlPjwvc3ZnPg==';
                      }}
                    />
                  ) : (
                    <Search size={16} />
                  )}
                </div>
                
                <input
                  type="text"
                  placeholder={
                    searchMode === 'internal' 
                      ? "搜索站内内容..." 
                      : selectedSearchSource 
                        ? `在${selectedSearchSource.name}搜索内容` 
                        : "搜索站外内容..."
                  }
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && searchMode === 'external') {
                      handleExternalSearch();
                    }
                  }}
                  className="w-full pl-9 pr-4 py-2 rounded-full bg-slate-100 dark:bg-slate-700/50 border-none text-sm focus:ring-2 focus:ring-blue-500 dark:text-white placeholder-slate-400 outline-none transition-all"
                  // 移动端优化：防止页面缩放
                  style={{ fontSize: '16px' }}
                  inputMode="search"
                  enterKeyHint="search"
                />

                {searchMode === 'external' && searchQuery.trim() && (
                  <button
                    onClick={handleExternalSearch}
                    className="absolute right-10 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-blue-500"
                    title="执行站外搜索"
                  >
                    <ExternalLink size={14} />
                  </button>
                )}
                
                {searchQuery.trim() && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center rounded-full bg-slate-200 dark:bg-slate-600 text-slate-500 dark:text-slate-300 hover:bg-red-100 dark:hover:bg-red-900/30 hover:text-red-500 dark:hover:text-red-400 transition-all"
                    title="清空搜索"
                  >
                    <X size={12} strokeWidth={2.5} />
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* 视图切换控制器 - 移动端：搜索框展开时隐藏，桌面端始终显示 */}
            <div className={`${isMobileSearchOpen ? 'hidden' : 'flex'} lg:flex items-center bg-slate-100 dark:bg-slate-700 rounded-full p-1`}>
              <button
                onClick={() => handleViewModeChange('simple')}
                className={`px-3 py-1 text-xs font-medium rounded-full transition-all ${
                  siteSettings.cardStyle === 'simple'
                    ? 'bg-white dark:bg-slate-600 text-blue-600 dark:text-blue-400 shadow-sm'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-800 dark:hover:text-slate-100'
                }`}
                title="简约版视图"
              >
                简约
              </button>
              <button
                onClick={() => handleViewModeChange('detailed')}
                className={`px-3 py-1 text-xs font-medium rounded-full transition-all ${
                  siteSettings.cardStyle === 'detailed'
                    ? 'bg-white dark:bg-slate-600 text-blue-600 dark:text-blue-400 shadow-sm'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-800 dark:hover:text-slate-100'
                }`}
                title="详情版视图"
              >
                详情
              </button>
            </div>

            {/* 主题切换按钮 - 移动端：搜索框展开时隐藏，桌面端始终显示 */}
            <button ref={themeButtonRef} onClick={toggleTheme} className={`${isMobileSearchOpen ? 'hidden' : 'flex'} lg:flex p-2 rounded-full text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700`}>
              {darkMode ? <Sun size={18} /> : <Moon size={18} />}
            </button>

            {/* 登录/退出按钮 - 移动端：搜索框展开时隐藏，桌面端始终显示 */}
            <div className={`${isMobileSearchOpen ? 'hidden' : 'flex'}`}>
              {!authToken ? (
                  <button onClick={() => setIsAuthOpen(true)} className="flex items-center gap-2 bg-slate-200 dark:bg-slate-700 px-3 py-1.5 rounded-full text-xs font-medium">
                      <Cloud size={14} /> <span className="hidden sm:inline">登录</span>
                  </button>
              ) : (
                  <button onClick={handleLogout} className="flex items-center gap-2 bg-slate-200 dark:bg-slate-700 px-3 py-1.5 rounded-full text-xs font-medium">
                      <LogOut size={14} /> <span className="hidden sm:inline">退出</span>
                  </button>
              )}
            </div>

            {/* 添加按钮 - 移动端：搜索框展开时隐藏，桌面端始终显示 */}
            <div className={`${isMobileSearchOpen ? 'hidden' : 'flex'}`}>
              <button
                onClick={() => { if(!authToken) setIsAuthOpen(true); else { setEditingLink(undefined); setIsModalOpen(true); }}}
                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded-full text-sm font-medium shadow-lg shadow-blue-500/30"
              >
                <Plus size={16} /> <span className="hidden sm:inline">添加</span>
              </button>
            </div>
          </div>
        </header>

        {/* Content Scroll Area */}
        <div className="flex-1 overflow-y-auto pt-1.5 lg:pt-[22px] px-4 lg:px-8 pb-4 lg:pb-8 space-y-8 [scrollbar-gutter:stable]">

            {/* 0. 实用工具面板（可折叠） */}
            <ToolsPanel
              toolsConfig={toolsConfig}
              authToken={authToken}
              aiConfig={aiConfig}
              onSaveConfig={handleSaveToolsConfig}
              onOpenSettings={() => {
                if (!authToken) { setIsAuthOpen(true); return; }
                setSettingsInitialTab('utilities');
                setIsSettingsModalOpen(true);
              }}
              onOpenAISettings={() => {
                setSettingsInitialTab('ai');
                setIsSettingsModalOpen(true);
              }}
            />

            {/* 1. Pinned Area (Custom Top Area) */}
            {pinnedLinks.length > 0 && !searchQuery && (selectedCategory === 'all') && (
                <section className="-mt-2.5" style={{ marginTop: 22 }}>
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                            <Pin size={16} className="text-blue-500 fill-blue-500" />
                            <h2 className="text-sm font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                置顶 / 常用
                            </h2>
                            <span className="ml-2 px-2 py-0.5 text-xs font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-300 rounded-full">
                                {pinnedLinks.length}
                            </span>
                        </div>
                        {isSortingPinned ? (
                            <div className="flex gap-2">
                                <button 
                                    onClick={savePinnedSorting}
                                    className="flex items-center gap-1 px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-xs font-medium rounded-full transition-colors"
                                    title="保存顺序"
                                >
                                    <Save size={14} />
                                    <span>保存顺序</span>
                                </button>
                                <button 
                                    onClick={cancelPinnedSorting}
                                    className="px-3 py-1.5 bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-xs font-medium rounded-full hover:bg-slate-300 dark:hover:bg-slate-600 transition-all"
                                    title="取消排序"
                                >
                                    取消
                                </button>
                            </div>
                        ) : (
                            <button 
                                onClick={() => { if(!requireAuth()) return; setIsSortingPinned(true); }}
                                className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-full transition-colors"
                                title="排序"
                            >
                                <GripVertical size={14} />
                                <span>排序</span>
                            </button>
                        )}
                    </div>
                    {isSortingPinned ? (
                        <DndContext
                            sensors={sensors}
                            collisionDetection={closestCorners}
                            onDragEnd={handlePinnedDragEnd}
                        >
                            <SortableContext
                                items={pinnedLinks.map(link => link.id)}
                                strategy={rectSortingStrategy}
                            >
                                <div className={`grid gap-3 ${
                                  siteSettings.cardStyle === 'detailed' 
                                    ? 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6' 
                                    : 'grid-cols-2 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8'
                                }`}>
                                    {pinnedLinks.map(link => (
                                        <SortableLinkCard key={link.id} link={link} />
                                    ))}
                                </div>
                            </SortableContext>
                        </DndContext>
                    ) : (
                        <div className={`grid gap-3 ${
                          siteSettings.cardStyle === 'detailed' 
                            ? 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6' 
                            : 'grid-cols-2 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8'
                        }`}>
                            {pinnedLinks.map(link => renderLinkCard(link))}
                        </div>
                    )}
                </section>
            )}

            {/* 2. Main Grid */}
            {(selectedCategory !== 'all' || searchQuery) && (
            <section>
                 {(!pinnedLinks.length && !searchQuery && selectedCategory === 'all') && (
                    <div className="mb-6 p-4 rounded-xl bg-gradient-to-r from-blue-500 to-indigo-600 text-white shadow-lg flex items-center justify-between">
                         <div>
                            <h1 className="text-xl font-bold">早安 👋</h1>
                            <p className="text-sm opacity-90 mt-1">
                                {links.length} 个链接 · {categories.length} 个分类
                            </p>
                         </div>
                         <Icon name="Compass" size={48} className="opacity-20" />
                    </div>
                 )}

                 <div className="flex items-center justify-between mb-4">
                     <h2 className="text-sm font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-2">
                         {selectedCategory === 'all' 
                            ? (searchQuery ? '搜索结果' : '所有链接') 
                            : (
                                <>
                                    {categories.find(c => c.id === selectedCategory)?.name}
                                    {isCategoryLocked(selectedCategory) && <Lock size={14} className="text-amber-500" />}
                                    <span className="ml-2 px-2 py-0.5 text-xs font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-300 rounded-full">
                                        {displayedLinks.length}
                                    </span>
                                </>
                            )
                         }
                     </h2>
                     {selectedCategory !== 'all' && !isCategoryLocked(selectedCategory) && (
                         isSortingMode === selectedCategory ? (
                             <div className="flex gap-2">
                                 <button 
                                     onClick={saveSorting}
                                     className="flex items-center gap-1 px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-xs font-medium rounded-full transition-colors"
                                     title="保存顺序"
                                 >
                                     <Save size={14} />
                                     <span>保存顺序</span>
                                 </button>
                                 <button 
                                     onClick={cancelSorting}
                                     className="px-3 py-1.5 bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-xs font-medium rounded-full hover:bg-slate-300 dark:hover:bg-slate-600 transition-all"
                                     title="取消排序"
                                 >
                                     取消
                                 </button>
                             </div>
                         ) : (
                             <div className="flex gap-2">
                                 <button 
                                     onClick={toggleBatchEditMode}
                                     className={`flex items-center gap-1 px-3 py-1.5 text-white text-xs font-medium rounded-full transition-colors ${
                                         isBatchEditMode 
                                             ? 'bg-red-600 hover:bg-red-700' 
                                             : 'bg-blue-600 hover:bg-blue-700'
                                     }`}
                                     title={isBatchEditMode ? "退出批量编辑" : "批量编辑"}
                                 >
                                     {isBatchEditMode ? '取消' : '批量编辑'}
                                 </button>
                                 {isBatchEditMode ? (
                                     <>
                                         <button 
                                             onClick={handleBatchDelete}
                                             className="flex items-center gap-1 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-medium rounded-full transition-colors"
                                             title="批量删除"
                                         >
                                             <Trash2 size={14} />
                                             <span>批量删除</span>
                                         </button>
                                         <button 
                                             onClick={handleSelectAll}
                                             className="flex items-center gap-1 px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-xs font-medium rounded-full transition-colors"
                                             title="全选/取消全选"
                                         >
                                             <CheckSquare size={14} />
                                             <span>{selectedLinks.size === displayedLinks.length ? '取消全选' : '全选'}</span>
                                         </button>
                                         <div className="relative group">
                                              <button 
                                                  className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-full transition-colors"
                                                  title="批量移动"
                                              >
                                                  <Upload size={14} />
                                                  <span>批量移动</span>
                                              </button>
                                              <div className="absolute top-full right-0 mt-1 w-48 bg-white dark:bg-slate-800 rounded-lg shadow-lg border border-slate-200 dark:border-slate-700 z-20 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200">
                                                  {categories.filter(cat => cat.id !== selectedCategory).map(cat => (
                                                      <button
                                                          key={cat.id}
                                                          onClick={() => handleBatchMove(cat.id)}
                                                          className="w-full text-left px-4 py-2 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 first:rounded-t-lg last:rounded-b-lg"
                                                      >
                                                          {cat.name}
                                                      </button>
                                                  ))}
                                              </div>
                                          </div>
                                     </>
                                 ) : (
                                     <button 
                                         onClick={() => startSorting(selectedCategory)}
                                         className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-full transition-colors"
                                         title="排序"
                                     >
                                         <GripVertical size={14} />
                                         <span>排序</span>
                                     </button>
                                 )}
                             </div>
                         )
                     )}
                 </div>

                 {/* 隐藏链接入口 */}
                 {(() => {
                     // 当前可见区域的隐藏链接数（锁定分类除外）
                     const hiddenCount = links.filter(l => l.hidden && !isCategoryLocked(l.categoryId) && (selectedCategory === 'all' || l.categoryId === selectedCategory)).length;
                     if (hiddenCount === 0) return null;
                     return (
                         <div className="mb-3">
                             <button
                                 onClick={() => setShowHiddenLinks(!showHiddenLinks)}
                                 className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
                             >
                                 <EyeOff size={13} />
                                 已隐藏 {hiddenCount} 个链接
                                 <ChevronDown size={12} className={`transition-transform ${showHiddenLinks ? 'rotate-180' : ''}`} />
                             </button>
                             {showHiddenLinks && (
                                 <div className="mt-2 flex flex-wrap gap-2">
                                     {links.filter(l => l.hidden && !isCategoryLocked(l.categoryId) && (selectedCategory === 'all' || l.categoryId === selectedCategory)).map(hiddenLink => (
                                         <div
                                             key={hiddenLink.id}
                                             className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 text-xs text-slate-500 dark:text-slate-300"
                                         >
                                             <span className="max-w-[140px] truncate">{hiddenLink.title}</span>
                                             <button
                                                 onClick={() => {
                                                     const updated = links.map(l => l.id === hiddenLink.id ? { ...l, hidden: false } : l);
                                                     updateData(updated, categories);
                                                 }}
                                                 className="flex items-center gap-0.5 text-blue-500 hover:text-blue-700 dark:hover:text-blue-300 transition-colors flex-shrink-0"
                                                 title="恢复显示"
                                             >
                                                 <Eye size={11} /> 恢复
                                             </button>
                                         </div>
                                     ))}
                                 </div>
                             )}
                         </div>
                     );
                 })()}

                 {displayedLinks.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 text-slate-400 border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-xl">
                        {isCategoryLocked(selectedCategory) ? (
                            <>
                                <Lock size={40} className="text-amber-400 mb-4" />
                                <p>该目录已锁定</p>
                                <button onClick={() => setCatAuthModalData(categories.find(c => c.id === selectedCategory) || null)} className="mt-4 px-4 py-2 bg-amber-500 text-white rounded-lg">输入密码解锁</button>
                            </>
                        ) : (
                            <></>
                        )}
                    </div>
                 ) : (
                    isSortingMode === selectedCategory ? (
                        <DndContext
                            sensors={sensors}
                            collisionDetection={closestCorners}
                            onDragEnd={handleDragEnd}
                        >
                            <SortableContext
                                items={displayedLinks.map(link => link.id)}
                                strategy={rectSortingStrategy}
                            >
                                <div className={`grid gap-3 ${
                                  siteSettings.cardStyle === 'detailed' 
                                    ? 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6' 
                                    : 'grid-cols-2 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8'
                                }`}>
                                    {displayedLinks.map(link => (
                                        <SortableLinkCard key={link.id} link={link} />
                                    ))}
                                </div>
                            </SortableContext>
                        </DndContext>
                    ) : (
                        <div className={`grid gap-3 ${
                          siteSettings.cardStyle === 'detailed' 
                            ? 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6' 
                            : 'grid-cols-2 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8'
                        }`}>
                            {displayedLinks.map(link => renderLinkCard(link))}
                        </div>
                    )
                 )}
            </section>
            )}

            {/* 其他目录搜索结果区域 */}
            {searchQuery.trim() && selectedCategory !== 'all' && (
              <section className="mt-8 pt-8 border-t-2 border-slate-200 dark:border-slate-700">
                <h2 className="text-sm font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-2 mb-4">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-folder-search">
                    <circle cx="11" cy="11" r="8"></circle>
                    <path d="m21 21-4.35-4.35"></path>
                    <path d="M11 11h.01"></path>
                  </svg>
                  其他目录搜索结果
                  <span className="ml-2 px-2 py-0.5 text-xs font-medium bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-300 rounded-full">
                    {Object.values(otherCategoryResults).flat().length}
                  </span>
                </h2>

                {Object.keys(otherCategoryResults).length > 0 ? (
                  Object.entries(otherCategoryResults).map(([categoryId, links]) => {
                    const category = categories.find(c => c.id === categoryId);
                    if (!category) return null;

                    return (
                      <div key={categoryId} className="mb-6 last:mb-0">
                        <div className="flex items-center gap-2 mb-4">
                          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                            {category.name}
                          </h3>
                          <span className="px-2 py-0.5 text-xs font-medium bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400 rounded-full">
                            {links.length}
                          </span>
                        </div>

                        <div className={`grid gap-3 ${
                          siteSettings.cardStyle === 'detailed' 
                            ? 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6' 
                            : 'grid-cols-2 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8'
                        }`}>
                          {links.map(link => renderLinkCard(link))}
                        </div>
                      </div>
                    );
                  })
                ) : null}
              </section>
            )}
        </div>
      </main>

          <Suspense fallback={null}>
            <LinkModal
              isOpen={isModalOpen}
              onClose={() => { setIsModalOpen(false); setEditingLink(undefined); setPrefillLink(undefined); }}
              onSave={editingLink ? handleEditLink : handleAddLink}
              onDelete={editingLink ? handleDeleteLink : undefined}
              categories={categories}
              initialData={editingLink || (prefillLink as LinkItem)}
              aiConfig={aiConfig}
              defaultCategoryId={selectedCategory !== 'all' ? selectedCategory : undefined}
            />
          </Suspense>

          {/* 右键菜单 */}
          <ContextMenu
            isOpen={contextMenu.isOpen}
            position={contextMenu.position}
            onClose={closeContextMenu}
            onCopyLink={copyLinkToClipboard}
            onShowQRCode={showQRCode}
            onEditLink={editLinkFromContextMenu}
            onDeleteLink={deleteLinkFromContextMenu}
            onTogglePin={togglePinFromContextMenu}
            onToggleHidden={toggleHiddenFromContextMenu}
            isHidden={!!contextMenu.link?.hidden}
          />

          {/* 二维码模态框 */}
          <QRCodeModal
            isOpen={qrCodeModal.isOpen}
            url={qrCodeModal.url || ''}
            title={qrCodeModal.title || ''}
            onClose={() => setQrCodeModal({ isOpen: false, url: '', title: '' })}
          />
      </>
      )}
    </div>
  );
}

export default App;

