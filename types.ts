export interface LinkItem {
  id: string;
  title: string;
  url: string;
  icon?: string;
  description?: string;
  categoryId: string;
  createdAt: number;
  pinned?: boolean; // New field for pinning
  pinnedOrder?: number; // Field for pinned link sorting order
  order?: number; // Field for category link sorting order
  hidden?: boolean; // 是否隐藏（不显示在首页，可通过管理恢复）
}

export interface Category {
  id: string;
  name: string;
  icon: string; // Lucide icon name or emoji
  password?: string; // Optional password for category protection
  hasPassword?: boolean; // 服务端下发标记：该分类设有密码（明文密码仅站长登录后可见）
  requireAuth?: boolean; // 使用全站密码后才可查看该分类内容
}

export type BackgroundType = 'bing' | 'custom' | 'solid';
export type BingResolution = '1080p' | '4k' | 'mobile';

export interface BackgroundConfig {
  enabled: boolean;
  type: BackgroundType;
  bingResolution: BingResolution;
  customUrl: string;      // 自定义图片 URL
  solidColor: string;     // 纯色模式颜色
  overlayOpacity: number; // 遮罩不透明度 0-0.7
  dailySync: boolean;     // 每日自动同步最新 Bing 壁纸
  imageOpacity: number;   // 壁纸图片透明度 0.3-1
}

export interface FontConfig {
  family: string; // '' = 系统默认
}

export interface SiteSettings {
  title: string;
  navTitle: string;
  favicon: string;
  cardStyle: 'detailed' | 'simple';
  requirePasswordOnVisit: boolean;
  passwordExpiryDays: number; // 密码过期天数，0表示永久不退出
  background: BackgroundConfig;
  font: FontConfig;
  navTitleAlign?: 'left' | 'center' | 'right'; // 导航栏标题对齐方式
}

export interface AppState {
  links: LinkItem[];
  categories: Category[];
  darkMode: boolean;
  settings?: SiteSettings;
}

export interface WebDavConfig {
  url: string;
  username: string;
  password: string;
  enabled: boolean;
}

export type AIProvider = 'gemini' | 'openai' | 'deepseek' | 'custom';

export interface AIConfig {
  provider: AIProvider;
  apiKey: string;
  baseUrl: string;
  model: string;
  websiteTitle?: string; // 网站标题 (浏览器标签)
  faviconUrl?: string; // 网站图标URL
  navigationName?: string;
}



// 搜索模式类型
export type SearchMode = 'internal' | 'external';

// 外部搜索源配置
export interface ExternalSearchSource {
  id: string;
  name: string;
  url: string;
  icon?: string;
  enabled: boolean;
  createdAt: number;
}

// 搜索配置
export interface SearchConfig {
  mode: SearchMode;
  externalSources: ExternalSearchSource[];
  selectedSource?: ExternalSearchSource | null; // 选中的搜索源
}

export const DEFAULT_CATEGORIES: Category[] = [
  { id: 'common', name: '常用推荐', icon: 'Star' },
  { id: 'dev', name: '开发工具', icon: 'Code' },
  { id: 'design', name: '设计资源', icon: 'Palette' },
  { id: 'read', name: '阅读资讯', icon: 'BookOpen' },
  { id: 'ent', name: '休闲娱乐', icon: 'Gamepad2' },
  { id: 'ai', name: '人工智能', icon: 'Bot' },
];

// ===== 实用工具配置（KV 云端同步） =====

export type WeatherProvider = 'qweather' | 'openweather';

// 工具模块配置（id 与工具模块注册表对应）
export interface ToolModuleConfig {
  id: string;      // 模块 id：weather / calendar / clock / translate / currency / 未来新增
  enabled: boolean; // 是否启用显示
  order: number;   // 显示顺序（升序）
}

export interface WorldClockCity {
  label: string;   // 城市显示名
  timezone: string; // IANA 时区，如 Asia/Shanghai
}

// 实用工具配置
export interface ToolsConfig {
  // 天气
  weather: {
    provider: WeatherProvider; // 默认 qweather（和风天气）
    qweatherKey: string;       // 和风天气 API Key
    qweatherLocationId: string;// 和风天气 LocationID
    qweatherHost: string;      // 和风天气 API Host（在控制台设置中查看，默认 https://devapi.qweather.com）
    openweatherKey: string;    // OpenWeatherMap API Key
    openweatherCity: string;   // OpenWeatherMap 城市名
  };
  // 翻译
  translate: {
    targetLang: string; // 默认目标语言代码，如 zh-CN / en
    role: string;       // 角色设定（如：专业翻译助手 / 医学翻译专家）
    industry: string;   // 行业领域（如：通用 / 医疗 / 法律 / 技术）
    requirements: string[]; // 翻译要求（多选：术语保留 / 语气正式 / 直译等）
    prompt: string;     // 自定义补充提示词（追加在系统提示词末尾）
  };
  // 世界时间
  worldClock: {
    cities: WorldClockCity[];
  };
  // 汇率
  currency: {
    apiKey: string;      // exchangerate-api Key
    baseCurrency: string;
    favorites: string[]; // 常用币种列表
  };
  // 工具模块（启停 + 排序，可扩展）
  modules: ToolModuleConfig[];
}

export const DEFAULT_TOOLS_CONFIG: ToolsConfig = {
  weather: {
    provider: 'qweather',
    qweatherKey: '',
    qweatherLocationId: '',
    qweatherHost: 'https://devapi.qweather.com',
    openweatherKey: '',
    openweatherCity: '',
  },
  translate: {
    targetLang: 'zh-CN',
    role: '专业翻译助手',
    industry: '通用',
    requirements: ['术语保留原文', '只输出翻译结果'],
    prompt: '',
  },
  worldClock: {
    cities: [
      { label: '北京', timezone: 'Asia/Shanghai' },
      { label: '东京', timezone: 'Asia/Tokyo' },
      { label: '伦敦', timezone: 'Europe/London' },
      { label: '纽约', timezone: 'America/New_York' },
      { label: '巴黎', timezone: 'Europe/Paris' },
      { label: '悉尼', timezone: 'Australia/Sydney' },
    ],
  },
  currency: {
    apiKey: '',
    baseCurrency: 'CNY',
    favorites: ['USD', 'CNY', 'EUR', 'JPY', 'GBP', 'HKD', 'KRW', 'AUD'],
  },
  // 默认全部工具模块启用（按注册表顺序）
  modules: [
    { id: 'weather', enabled: true, order: 1 },
    { id: 'calendar', enabled: true, order: 2 },
    { id: 'clock', enabled: true, order: 3 },
    { id: 'translate', enabled: true, order: 4 },
    { id: 'currency', enabled: true, order: 5 },
  ],
};

export const INITIAL_LINKS: LinkItem[] = [
  { id: '1', title: 'GitHub', url: 'https://github.com', categoryId: 'dev', createdAt: Date.now(), description: '代码托管平台', pinned: true, icon: 'https://www.faviconextractor.com/favicon/github.com?larger=true' },
  { id: '2', title: 'React', url: 'https://react.dev', categoryId: 'dev', createdAt: Date.now(), description: '构建Web用户界面的库', pinned: true, icon: 'https://www.faviconextractor.com/favicon/react.dev?larger=true' },
  { id: '3', title: 'Tailwind CSS', url: 'https://tailwindcss.com', categoryId: 'design', createdAt: Date.now(), description: '原子化CSS框架', pinned: true, icon: 'https://www.faviconextractor.com/favicon/tailwindcss.com?larger=true' },
  { id: '4', title: 'ChatGPT', url: 'https://chat.openai.com', categoryId: 'ai', createdAt: Date.now(), description: 'OpenAI聊天机器人', pinned: true, icon: 'https://www.faviconextractor.com/favicon/chat.openai.com?larger=true' },
  { id: '5', title: 'Gemini', url: 'https://gemini.google.com', categoryId: 'ai', createdAt: Date.now(), description: 'Google DeepMind AI', pinned: true, icon: 'https://www.faviconextractor.com/favicon/gemini.google.com?larger=true' },
];
