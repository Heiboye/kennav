# CloudNav-Oorz（修改版）
本项目基于
https://github.com/sese972010/CloudNav-
https://github.com/aabacada/CloudNav-abcd
两个融合 并根据自身需求做了一些修改 

<details>
<summary>更新日志</summary>

### 2026.04.07

1. 修复 AI 配置可被未授权读取的问题，`/api/storage?getConfig=ai` 现已要求登录校验。
2. 修复 WebDAV 代理接口未鉴权的问题，备份、恢复、测试连接现在都需要有效登录态。
3. 删除 `index.html` 里不存在的 `/index.css` 引用，避免额外 404 请求。
4. WebDAV 设置现已支持写入 KV，并在登录后自动从 KV 拉回到当前设备。

</details>

# CloudNav (云航) - 智能私有导航站

<div align="center">

![React](https://img.shields.io/badge/React-18-blue?style=flat-square&logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue?style=flat-square&logo=typescript)
![Tailwind CSS](https://img.shields.io/badge/Tailwind-3.0-38bdf8?style=flat-square&logo=tailwindcss)
![Cloudflare Pages](https://img.shields.io/badge/Cloudflare-Pages-orange?style=flat-square&logo=cloudflare)
![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)

<br/>

<!-- 请将下方的链接替换为您实际部署后的 Cloudflare Pages 域名 -->
[![Live Demo](https://img.shields.io/badge/Live%20Demo-View%20Online-7c3aed?style=for-the-badge&logo=sparkles)](https://oorz.org/)

<br/>

**一个现代化、基于 AI 辅助的全栈个人导航站。**
**无需购买服务器，依托 Cloudflare 免费额度托管（注意 KV 有写入频率与用量限制，多端数据为最终一致性同步）。**

[在线演示](https://oorz.org/) • [功能特性](#-核心功能) • [项目展示](#-项目展示) • [部署教程](#-部署教程-免费) • [使用指南](#-使用指南)

</div>

---

## ✨ 核心功能

### 🧠 AI 深度集成
*   **多模型支持**: 完美支持 **Google Gemini**、**OpenAI**、**DeepSeek**、**Claude** 等任何兼容 OpenAI 接口的模型。
*   **一键智能补全**: 在设置面板一键扫描，自动为成百上千个书签生成精准的中文简介。
*   **智能分类**: 添加链接时，AI 自动分析网页内容并推荐最合适的分类目录。

### ☁️ 数据同步与安全
*   **Cloudflare KV 同步**: 利用边缘存储实现多端数据同步（最终一致性，高频写入受 KV 频率限制约束）。
*   **链接图标持久化**: 第一次添加链接时自动抓取并存进 Cloudflare KV，换设备打开也不用重新补图标。
*   **WebDAV 双重备份**: 支持Nextcloud 等 WebDAV 网盘备份，数据自主掌控，并可选把当前 WebDAV 配置一起打包同步。
*   **隐私加密体系**:
    *   **全局锁**: 部署时设置访问密码，防止他人查看。
    *   **目录锁**: 支持对“私有资源”等特定分类单独设置密码，隐藏敏感内容。
    *   **分类联动全站密码**: 可给单个分类开启“先登录再看”，未输入全站密码时不会显示该分类内容。

### 🎨 极致体验
*   **Chrome 扩展插件 (Pro)**: 
    *   **一键保存**: 点击浏览器图标即可弹出侧边栏，快速将当前网页保存到指定分类。
    *   **侧边栏导航**: 按下快捷键 (如 Ctrl+Shift+E) 呼出侧边栏，在任意网页直接浏览、搜索和管理您的书签，无需离开当前页面。
*   **置顶专区**: 常用网站一键置顶，在首页顶部常驻显示。
*   **无缝迁移**: 支持导入 Chrome/Edge 书签 HTML 文件（智能去重）。

> 💡 部分功能创意参考自 [CloudNav-abcd](https://github.com/aabacada/CloudNav-abcd)，该分支的导航项目同样优秀，特此致谢。

---

---

## 🛠️ 本地开发

```bash
# 安装依赖
npm install

# 一键启动完整环境（前端 Vite + 后端 Cloudflare Functions，含本地 KV 模拟）
npm run dev:full
# 前端: http://localhost:3000  （含 HMR 热更新）
# 后端: http://localhost:8788  （/api/* 由 wrangler pages dev 提供）

# 或分开两个终端运行：
npm run dev      # 仅前端开发服务器（HMR）
npm run dev:api  # 仅后端 API（需先 npm run build）
```

- 本地后端通过 `scripts/dev-api.mjs` 以 `--kv=CLOUDNAV_KV` 注入本地 KV 模拟（不修改 `wrangler.jsonc`）；`PASSWORD`（默认 `123456`）与 `AUTH_SECRET` 由 `.dev.vars` 提供。
- 前端通过 `vite.config.ts` 中的 `/api` 代理将请求转发到本地后端。
- 本地 KV 数据保存在 `.wrangler/state` 中，删除该目录即可重置本地数据。
- 部署到 Cloudflare 时需配置真实的 `CLOUDNAV_KV` 绑定和 `PASSWORD` 环境变量（见下文部署教程）。

---

## 🚀 部署教程 (免费)

本应用完全基于 **Cloudflare Pages** + **KV** 构建，依托 Cloudflare 免费额度运行（KV 有每日写入次数与存储配额限制，见 Cloudflare 官方定价）。

> 📄 **完整部署指南见 [DEPLOY.md](DEPLOY.md)** —— 面向零基础新手，从注册账号、上传代码到绑定 KV、上线验证逐步说明，跟着做即可。

### 📋 简明部署步骤 (适合有经验用户)

1.  **Fork 项目**: 点击右上角 Fork 按钮，将本项目克隆到您的 GitHub 账号。
2.  **创建 Pages 应用**: 登录 Cloudflare 控制台 -> Workers 和 Pages -> 创建应用程序 -> Pages -> 连接到 Git -> 选择您 fork 的仓库。
3.  **配置构建**:
    *   框架预设: **无 (None)**
    *   构建命令: `npm run build`
    *   输出目录: `dist`
4.  **创建数据库**: 在 Workers 和 Pages -> KV 中创建一个新的命名空间，命名为 `CLOUDNAV_DB`。
5.  **绑定变量**:
    *   进入 Pages 项目设置 -> 绑定 (Bindings) -> 添加 KV 命名空间 -> 变量名填 `CLOUDNAV_KV`，值选择刚才创建的 `CLOUDNAV_DB`。
    *   添加 **Secret（机密）** 变量 `PASSWORD`，值为您的访问密码。
    *   添加 **Secret（机密）** 变量 `AUTH_SECRET`，值为随机高熵字符串（用于签发会话 token，勿与密码相同）。
6.  **重新部署**: 设置绑定和 Secret 后，回到部署页面点击「重新部署」一次，配置才会生效。

---

### 📖 新手请直接阅读 DEPLOY.md

> 完整的分步教程已整理到 [DEPLOY.md](DEPLOY.md)，从零开始逐步覆盖：
> - 注册 GitHub / Cloudflare 账号
> - 把代码上传到 GitHub 仓库
> - 创建 KV 命名空间、创建 Pages 项目、绑定 KV、设置密码 Secret
> - 重新部署与上线验证
>
> 全程提供**纯网页操作**和**命令行**两种方式，零基础照着做即可。

---

## ⚙️ 使用指南

### 1. Chrome 扩展程序 (推荐)
点击侧边栏左下角的 **“设置”** -> **“扩展工具”**。
系统会自动生成扩展压缩包（含 manifest、弹窗、侧边栏等文件）。
1. 解压到电脑新建文件夹。
2. 打开 Chrome 扩展管理页 (`chrome://extensions`)。
3. 开启右上角 **“开发者模式”**。
4. 点击 **“加载已解压的扩展程序”**，选择刚才的文件夹。
5. 以后浏览网页时，点击插件图标即可**提交当前页面**。

> ⚠️ **保存方式为「异步收件箱」**：扩展提交的链接先进入服务端收件箱（不直接写入主数据），
> 打开导航页面后由网页端自动合并导入（可能受 Cloudflare KV 最终一致性影响，延迟数秒出现）。
> 提交失败（网络/服务繁忙）会保存在扩展本地队列并自动指数退避重试；
> 若提示"凭据已过期"，请登录导航站后重新生成扩展。

### 2. 配置 AI 服务
点击侧边栏底部的 **“设置”** -> **“AI 设置”**：
*   **提供商**: Google Gemini 或 OpenAI 兼容 (DeepSeek等)。
*   **Key & Model**: 输入 API Key 和模型名称。
*   **一键补全**: 点击底部的 **“一键补全所有描述”**，AI 将自动扫描所有无描述的链接并后台生成。

### 3. WebDAV 备份
点击侧边栏的 **“备份”** 图标，配置 WebDAV 信息，即可一键上传备份到云端。
如果你想把当前 WebDAV 地址、账号和应用密码一起迁移，也可以在备份时勾选同步 WebDAV 配置，恢复或导入时再决定要不要覆盖本地配置。

### 4. 本地数据导出 (Local Data Export)
点击侧边栏的 **“备份”** 图标 -> **“导出 HTML”**。
*   生成的 HTML 文件完全兼容 **Chrome**、**Edge**、**Firefox** 等主流浏览器的导入格式。
*   完整保留您在云航中整理的分类目录结构。

**如何导入到浏览器 (以 Chrome 为例):**
1. 打开 Chrome 浏览器，点击右上角菜单 -> **书签与清单** -> **书签管理器**。
2. 点击页面右上角的三个点图标 -> **导入书签**。
3. 选择刚才从云航下载的 HTML 文件即可恢复所有书签。

---

<div align="center">

**如果您觉得项目不错，希望给本项目点一个免费的 Star ⭐️，感谢您的关注！**

**如果有 Bug 或改进的地方，请在 Issue 中提交您的建议。**

<br/>

Made with ❤️ by CloudNav Team
</div>
