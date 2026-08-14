import React, { useState, useEffect } from 'react';
import { X, Cloud, Download, Upload, CheckCircle2, AlertCircle, Save } from 'lucide-react';
import { Category, LinkItem, WebDavConfig, SearchConfig, AIConfig, SiteSettings, ToolsConfig } from '../types';
import { checkWebDavConnection, uploadBackup, uploadBackupWithTimestamp, downloadBackup } from '../services/webDavService';
import { generateBookmarkHtml, downloadHtmlFile } from '../services/exportService';

interface BackupModalProps {
  isOpen: boolean;
  onClose: () => void;
  links: LinkItem[];
  categories: Category[];
  onRestore: (links: LinkItem[], categories: Category[]) => Promise<boolean>;
  webDavConfig: WebDavConfig;
  onSaveWebDavConfig: (config: WebDavConfig) => void;
  onRestoreWebDavConfig: (config: WebDavConfig) => Promise<boolean>;
  searchConfig: SearchConfig;
  onRestoreSearchConfig: (searchConfig: SearchConfig) => Promise<boolean>;
  aiConfig: AIConfig;
  onRestoreAIConfig: (aiConfig: AIConfig) => Promise<boolean>;
  siteSettings: SiteSettings;
  toolsConfig: ToolsConfig;
  onRestoreSiteConfig: (config: SiteSettings) => Promise<boolean>;
  onRestoreToolsConfig: (config: ToolsConfig) => Promise<boolean>;
}

const APP_VERSION = '1.0.0';

const BackupModal: React.FC<BackupModalProps> = ({
  isOpen, onClose, links, categories, onRestore, webDavConfig, onSaveWebDavConfig, onRestoreWebDavConfig,
  searchConfig, onRestoreSearchConfig, aiConfig, onRestoreAIConfig, siteSettings, toolsConfig,
  onRestoreSiteConfig, onRestoreToolsConfig,
}) => {
  const [config, setConfig] = useState<WebDavConfig>(webDavConfig);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<'success' | 'fail' | null>(null);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'uploading' | 'downloading' | 'success' | 'error'>('idle');
  const [statusMsg, setStatusMsg] = useState('');
  const [testMessage, setTestMessage] = useState('');
  const [includeWebDavConfig, setIncludeWebDavConfig] = useState(false);
  const [restoreWebDavConfig, setRestoreWebDavConfig] = useState(false);
  const [includeAIConfig, setIncludeAIConfig] = useState(false);

  // 备份格式：schemaVersion 2 完整覆盖主数据与配置；AI/WebDAV 配置（含敏感字段）默认不打包，需显式勾选
  // 禁止包含：PASSWORD / AUTH_SECRET / 会话 token / auth_epoch / 登录限流记录 / 扩展收件箱记录
  const buildBackupPayload = () => ({
    appName: 'cloudnav',
    appVersion: APP_VERSION,
    schemaVersion: 2,
    exportedAt: new Date().toISOString(),
    links,
    categories,
    websiteConfig: siteSettings,
    searchConfig,
    toolsConfig,
    ...(includeAIConfig ? { aiConfig } : {}),
    ...(includeWebDavConfig ? { webDavConfig: config } : {})
  });

  useEffect(() => {
    if(isOpen) {
        setConfig(webDavConfig);
        setTestResult(null);
        setTestMessage('');
        setSyncStatus('idle');
        setIncludeWebDavConfig(false);
        setRestoreWebDavConfig(false);
        setIncludeAIConfig(false); // 敏感选项每次打开重置，避免上次勾选延续导致意外携带 API Key
    }
  }, [isOpen, webDavConfig]);

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestResult(null);
    setTestMessage('');
    const result = await checkWebDavConnection(config);
    setTestResult(result.success ? 'success' : 'fail');
    setTestMessage(result.success ? '连接成功' : (result.error || '连接失败'));
    setIsTesting(false);
  };

  const handleSaveConfig = () => {
    onSaveWebDavConfig(config);
    // Automatically test upon save if enabled
    if (config.enabled) {
        handleTestConnection();
    }
  };

  const handleBackupToCloud = async () => {
    setSyncStatus('uploading');
    setStatusMsg('正在上传...');
    const result = await uploadBackup(config, buildBackupPayload());
    if (result.success) {
        setSyncStatus('success');
        setStatusMsg('备份成功！');
    } else {
        setSyncStatus('error');
        setStatusMsg(result.error || '上传失败，请检查配置或网络。');
    }
  };

  const handleBackupToCloudWithTimestamp = async () => {
    setSyncStatus('uploading');
    setStatusMsg('正在上传...');
    const result = await uploadBackupWithTimestamp(config, buildBackupPayload());
    if (result.success) {
        setSyncStatus('success');
        setStatusMsg(`备份成功！文件名: ${result.filename}`);
    } else {
        setSyncStatus('error');
        setStatusMsg(result.error || '上传失败，请检查配置或网络。');
    }
  };

  // 下载 JSON 文件（恢复前安全备份 / 本地导出共用）
  const downloadBackupFile = (data: unknown, filename: string) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleRestoreFromCloud = async () => {
    if (!confirm("确定要从 WebDAV 恢复吗？这将覆盖当前的本地数据。")) return;

    setSyncStatus('downloading');
    setStatusMsg('正在下载...');
    const data: any = await downloadBackup(config);

    // 结构校验：主数据必须为数组且逐元素合法；配置类字段做深层结构校验（任一无效整单拒绝，不静默过滤）
    const isValidLink = (l: any) =>
        l && typeof l === 'object' && typeof l.id === 'string' &&
        typeof l.title === 'string' && typeof l.url === 'string' &&
        typeof l.categoryId === 'string' && (typeof l.createdAt === 'number' || typeof l.createdAt === 'string');
    const isValidCat = (c: any) =>
        c && typeof c === 'object' && typeof c.id === 'string' && typeof c.name === 'string';
    const isValidSearchConfig = (s: any) =>
        !s || (typeof s === 'object' &&
          (s.mode === undefined || s.mode === 'internal' || s.mode === 'external') &&
          (s.externalSources === undefined || (Array.isArray(s.externalSources) &&
            s.externalSources.every((src: any) =>
              src && typeof src === 'object' && typeof src.id === 'string' && typeof src.name === 'string' &&
              typeof src.url === 'string' && /^https:\/\//i.test(src.url) && src.url.includes('{query}')))) &&
          (s.selectedSource === undefined || s.selectedSource === null ||
            (typeof s.selectedSource === 'object' && typeof s.selectedSource.id === 'string' &&
             typeof s.selectedSource.url === 'string' && /^https:\/\//i.test(s.selectedSource.url) &&
             s.selectedSource.url.includes('{query}'))));
    const isValidAIConfig = (a: any) =>
        !a || (typeof a === 'object' &&
          (a.provider === undefined || typeof a.provider === 'string') &&
          (a.apiKey === undefined || typeof a.apiKey === 'string') &&
          (a.model === undefined || typeof a.model === 'string'));
    const isValidWebDavConfig = (w: any) =>
        !w || (typeof w === 'object' && typeof w.url === 'string' &&
          (w.username === undefined || typeof w.username === 'string') &&
          (w.enabled === undefined || typeof w.enabled === 'boolean'));
    const isValidSiteSettings = (s: any) =>
        !s || (typeof s === 'object' && typeof s.title === 'string' && typeof s.navTitle === 'string' &&
          typeof s.favicon === 'string' && (s.cardStyle === 'detailed' || s.cardStyle === 'simple') &&
          typeof s.requirePasswordOnVisit === 'boolean' && typeof s.passwordExpiryDays === 'number');
    const isValidToolsConfig = (t: any) =>
        !t || (typeof t === 'object' && (t.weather === undefined || typeof t.weather === 'object') &&
          (t.translate === undefined || typeof t.translate === 'object') &&
          (t.worldClock === undefined || typeof t.worldClock === 'object') &&
          (t.currency === undefined || typeof t.currency === 'object'));
    const isValidRestore =
        data && data.success !== false &&
        Array.isArray(data.links) && Array.isArray(data.categories) &&
        data.links.every(isValidLink) &&
        data.categories.every(isValidCat) &&
        isValidSiteSettings(data.websiteConfig) &&
        isValidSearchConfig(data.searchConfig) &&
        isValidToolsConfig(data.toolsConfig) &&
        isValidAIConfig(data.aiConfig) &&
        isValidWebDavConfig(data.webDavConfig);

    // 文件大小限制 5MB
    let fileSizeOk = true;
    try {
      const blob = new Blob([JSON.stringify(data)]);
      if (blob.size > 5 * 1024 * 1024) fileSizeOk = false;
    } catch { /* 无法计算大小时不阻塞 */ }

    if (!isValidRestore || !fileSizeOk) {
        setSyncStatus('error');
        setStatusMsg(fileSizeOk ? (data.error || '下载失败或文件格式错误（已拒绝，未做任何更改）。') : '备份文件超过 5MB 限制（已拒绝，未做任何更改）。');
        return;
    }

    // 恢复前安全备份：原数据与配置文件写入本地 JSON（失败不阻塞，但提示）
    try {
        downloadBackupFile(buildBackupPayload(), `cloudnav_pre_restore_${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    } catch (e) {
        setStatusMsg('警告：恢复前备份下载失败，建议先手动导出');
    }

    // 逐项恢复，每项检查响应；部分失败明确提示，不得显示“全部恢复成功”
    const failed: string[] = [];
    setStatusMsg('正在恢复主数据...');
    const mainOk = await onRestore(data.links, data.categories);
    if (!mainOk) failed.push('主数据');
    if (isValidRestore && data.websiteConfig && !(await onRestoreSiteConfig(data.websiteConfig))) failed.push('网站配置');
    if (data.searchConfig && !(await onRestoreSearchConfig(data.searchConfig))) failed.push('搜索配置');
    if (data.toolsConfig && !(await onRestoreToolsConfig(data.toolsConfig))) failed.push('工具配置');
    if (data.aiConfig && !(await onRestoreAIConfig(data.aiConfig))) failed.push('AI 配置');
    if (restoreWebDavConfig && data.webDavConfig && !(await onRestoreWebDavConfig(data.webDavConfig))) failed.push('WebDAV 配置');

    if (failed.length > 0) {
        setSyncStatus('error');
        setStatusMsg(`恢复不完整，以下项目失败：${failed.join('、')}。原数据与备份文件仍可用，请重试。`);
        return;
    }
    // WebDAV 恢复后必须重新测试连接
    if (restoreWebDavConfig && data.webDavConfig) {
        handleTestConnection();
    }
    setSyncStatus('success');
    setStatusMsg('恢复成功！');
  };

  const handleExportHtml = () => {
    const html = generateBookmarkHtml(links, categories);
    const dateStr = new Date().toISOString().split('T')[0];
    downloadHtmlFile(html, `bookmarks_${dateStr}.html`);
  };

  const handleExportJson = () => {
    const data = buildBackupPayload();
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'cloudnav_backup.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden border border-slate-200 dark:border-slate-700 max-h-[90vh] flex flex-col">
        <div className="flex justify-between items-center p-4 border-b border-slate-200 dark:border-slate-700">
          <h3 className="text-lg font-semibold dark:text-white flex items-center gap-2">
            <Cloud className="text-blue-500" /> 备份与恢复
          </h3>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-full transition-colors">
            <X className="w-5 h-5 dark:text-slate-400" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-8">
            
            {/* Section 1: WebDAV Configuration */}
            <section className="space-y-4">
                <div className="flex items-center justify-between">
                    <h4 className="font-medium text-slate-800 dark:text-slate-200">WebDAV 设置</h4>
                    <label className="flex items-center gap-2 cursor-pointer">
                        <input 
                            type="checkbox" 
                            checked={config.enabled}
                            onChange={(e) => setConfig({...config, enabled: e.target.checked})}
                            className="rounded text-blue-600 focus:ring-blue-500"
                        />
                        <span className="text-sm text-slate-600 dark:text-slate-400">启用 WebDAV</span>
                    </label>
                </div>

                <div className={`space-y-3 transition-opacity ${!config.enabled ? 'opacity-50 pointer-events-none' : ''}`}>
                    <div>
                        <label className="block text-xs font-medium text-slate-500 mb-1">服务器地址 (URL)</label>
                        <input 
                            type="text" 
                            value={config.url}
                            onChange={(e) => setConfig({...config, url: e.target.value})}
                            placeholder="https://your-webdav-server.example/path/"
                            className="w-full p-2 text-sm rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-blue-500"
                        />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs font-medium text-slate-500 mb-1">用户名</label>
                            <input 
                                type="text" 
                                value={config.username}
                                onChange={(e) => setConfig({...config, username: e.target.value})}
                                className="w-full p-2 text-sm rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-blue-500"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-slate-500 mb-1">应用密码</label>
                            <input 
                                type="password" 
                                value={config.password}
                                onChange={(e) => setConfig({...config, password: e.target.value})}
                                className="w-full p-2 text-sm rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-blue-500"
                            />
                        </div>
                    </div>
                    
                    <div className="flex items-center gap-3 pt-2">
                        <button 
                            onClick={handleTestConnection}
                            disabled={isTesting}
                            className="px-3 py-1.5 text-xs font-medium bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 rounded-md transition-colors"
                        >
                            {isTesting ? '连接中...' : '测试连接'}
                        </button>
                        <button 
                            onClick={handleSaveConfig}
                            className="px-3 py-1.5 text-xs font-medium bg-blue-600 text-white hover:bg-blue-700 rounded-md transition-colors flex items-center gap-1"
                        >
                            <Save size={12} /> 保存配置
                        </button>
                        {testResult === 'success' && <span className="text-xs text-green-500 flex items-center gap-1"><CheckCircle2 size={12}/> {testMessage || '连接成功'}</span>}
                        {testResult === 'fail' && <span className="text-xs text-red-500 flex items-center gap-1"><AlertCircle size={12}/> {testMessage || '连接失败'}</span>}
                    </div>
                </div>
            </section>

            <hr className="border-slate-200 dark:border-slate-700" />

            {/* Section 2: Sync Actions */}
            <section className="space-y-4">
                <h4 className="font-medium text-slate-800 dark:text-slate-200">云端同步操作</h4>
                <div className="grid grid-cols-3 gap-4">
                    <button 
                        onClick={handleBackupToCloud}
                        disabled={!config.enabled}
                        className="flex flex-col items-center justify-center p-4 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-all disabled:opacity-50 disabled:cursor-not-allowed group"
                    >
                        <Upload className="w-8 h-8 text-blue-500 mb-2 group-hover:-translate-y-1 transition-transform" />
                        <span className="text-sm font-medium dark:text-white">上传备份</span>
                        <span className="text-xs text-slate-500 mt-1">覆盖云端数据</span>
                    </button>

                    <button 
                        onClick={handleRestoreFromCloud}
                        disabled={!config.enabled}
                        className="flex flex-col items-center justify-center p-4 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-all disabled:opacity-50 disabled:cursor-not-allowed group"
                    >
                        <Download className="w-8 h-8 text-purple-500 mb-2 group-hover:-translate-y-1 transition-transform" />
                        <span className="text-sm font-medium dark:text-white">从 WebDAV 恢复</span>
                        <span className="text-xs text-slate-500 mt-1">覆盖本地数据</span>
                    </button>

                    <button 
                        onClick={handleBackupToCloudWithTimestamp}
                        disabled={!config.enabled}
                        className="flex flex-col items-center justify-center p-4 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-all disabled:opacity-50 disabled:cursor-not-allowed group"
                    >
                        <Upload className="w-8 h-8 text-green-500 mb-2 group-hover:-translate-y-1 transition-transform" />
                        <span className="text-sm font-medium dark:text-white">双重备份</span>
                        <span className="text-xs text-slate-500 mt-1">带时间戳</span>
                    </button>
                </div>
                <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                    <input
                        type="checkbox"
                        checked={includeWebDavConfig}
                        onChange={(e) => setIncludeWebDavConfig(e.target.checked)}
                        className="rounded text-blue-600 focus:ring-blue-500"
                    />
                    <span>备份时带上当前 WebDAV 配置</span>
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                    <input
                        type="checkbox"
                        checked={includeAIConfig}
                        onChange={(e) => setIncludeAIConfig(e.target.checked)}
                        className="rounded text-blue-600 focus:ring-blue-500"
                    />
                    <span>备份时带上 AI 配置（含 API Key，默认不包含）</span>
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                    <input
                        type="checkbox"
                        checked={restoreWebDavConfig}
                        onChange={(e) => setRestoreWebDavConfig(e.target.checked)}
                        className="rounded text-blue-600 focus:ring-blue-500"
                    />
                    <span>恢复时同步覆盖本地 WebDAV 配置</span>
                </label>
                
                {syncStatus !== 'idle' && (
                    <div className={`text-sm text-center p-2 rounded ${
                        syncStatus === 'success' ? 'bg-green-50 text-green-600 dark:bg-green-900/20' : 
                        syncStatus === 'error' ? 'bg-red-50 text-red-600 dark:bg-red-900/20' : 
                        'bg-blue-50 text-blue-600 dark:bg-blue-900/20'
                    }`}>
                        {statusMsg}
                    </div>
                )}
            </section>

            <hr className="border-slate-200 dark:border-slate-700" />

             {/* Section 3: HTML Export */}
             <section className="space-y-4">
                <h4 className="font-medium text-slate-800 dark:text-slate-200">本地导出</h4>
                <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-700/30 flex items-center justify-between">
                    <div>
                        <h5 className="text-sm font-medium dark:text-slate-200">导出 HTML 书签文件</h5>
                        <p className="text-xs text-slate-500 mt-1">兼容 Chrome, Edge, Firefox 导入格式，保留目录结构</p>
                    </div>
                    <button 
                        onClick={handleExportHtml}
                        className="px-4 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 hover:border-blue-500 text-slate-700 dark:text-slate-200 rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
                    >
                        <Download size={16} /> 导出 HTML
                    </button>
                </div>
                
                <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-700/30 flex items-center justify-between">
                    <div>
                        <h5 className="text-sm font-medium dark:text-slate-200">导出 cloudnav_backup.json 文件</h5>
                        <p className="text-xs text-slate-500 mt-1">与 WebDAV 备份格式一致，可按上面的开关决定是否带上 WebDAV 配置</p>
                    </div>
                    <button 
                        onClick={handleExportJson}
                        className="px-4 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 hover:border-blue-500 text-slate-700 dark:text-slate-200 rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
                    >
                        <Download size={16} /> 导出 JSON
                    </button>
                </div>
             </section>

        </div>
      </div>
    </div>
  );
};

export default BackupModal;
