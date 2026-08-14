# CloudNav (云航) — Cloudflare 部署完整教程（新手友好版）

本项目是 **React 19 单页应用 + Cloudflare Pages Functions 后端 + Cloudflare KV 存储** 的全栈个人导航站。
无需购买服务器，依托 Cloudflare 免费额度运行（注意 KV 有写入频率与用量限制，多端数据为最终一致性同步）。

> 🎯 **本教程面向零基础新手**：从注册账号到上线验证逐步说明，跟着做即可完成部署。
> 提供两条路径，任选其一：
> - **路径 A（纯网页操作）**：全程在 Cloudflare 网页点鼠标，无需安装命令行工具 —— **推荐新手**。
> - **路径 B（Wrangler 命令行）**：适合熟悉命令行的用户，可把配置固化到 `wrangler.jsonc`。

---

## 一、项目结构与数据流

```
kennav/
├── index.html / index.tsx        # 入口（构建期 Tailwind + 本地 qrcode）
├── App.tsx                       # 主应用（状态/鉴权/数据流/收件箱合并/备份恢复）
├── components/                   # 弹窗、侧边栏、工具面板
├── services/                     # Gemini、天气、汇率、WebDAV、书签解析、导出
├── functions/                    # Cloudflare Pages Functions（后端）
│   ├── api/storage.ts            # 主数据 API（KV 读写、登录、配置、分类隔离）
│   ├── api/link.ts               # 扩展收件箱入口（不读写 app_data）
│   ├── api/extension-inbox.ts    # 收件箱列表/确认（仅管理员）
│   ├── api/health.ts             # 健康检查（KV + 配置就绪探测）
│   ├── api/webdav.ts             # WebDAV 备份代理
│   ├── api/bing-wallpaper.ts     # Bing 壁纸代理
│   └── api/_middleware.ts        # /api/* 统一安全响应头
├── wrangler.jsonc                # 生产配置（唯一配置源，不包含本地绑定）
├── scripts/dev-api.mjs           # 本地开发入口（--kv 注入，不改写配置文件）
└── .dev.vars                     # 本地密钥（gitignore，不入库）
```

数据流：`浏览器/扩展 → /api/*（Pages Functions）→ Cloudflare KV（CLOUDNAV_KV）`

**扩展保存采用「异步收件箱」**：扩展把链接写入 `extension_inbox:<uuid>`（30 天 TTL，不直接写 app_data，避免与网页端并发覆盖）；管理员打开导航页面后，前端每 30 秒 / 窗口聚焦时拉取收件箱，合并进主数据并确认删除。

---

## 二、本地开发（可选，建议先跑通）

```bash
# 1. 安装依赖（Node 22.12+）
npm ci

# 2. 本地密钥（已随仓库提供模板，可修改）
#    .dev.vars: PASSWORD=<本地密码> / AUTH_SECRET=<随机串>

# 3. 一键启动完整环境（前端 :3000 + 后端 :8788，含本地 KV 模拟）
npm run dev:full
#    后端通过 scripts/dev-api.mjs 以 --kv=CLOUDNAV_KV 注入本地 KV 模拟，
#    不修改根 wrangler.jsonc（生产配置保持纯净）
```

本地 KV 数据保存在 `.wrangler/state`，删除该目录即可重置本地数据（含密码）。

---

## 三、部署到 Cloudflare Pages（完整步骤）

> 🟢 **路径选择**：绝大多数新手直接走**路径 A（纯网页操作）**即可，全程点鼠标、无需安装任何命令行工具；只有想用命令行管理配置的用户才需要**路径 B**。

### 第 0 步：准备三样东西（新手必读）

部署前请确认你有：

1. **一个 GitHub 账号**（免费）——用来存放代码，Cloudflare 从你的仓库拉取并自动构建。
2. **一个 Cloudflare 账号**（免费）——注册地址：https://dash.cloudflare.com/sign-up
3. **本项目代码已上传到你的 GitHub 仓库**（方法见 0.1）。

> 路径 A 不需要在电脑上安装 Node.js 或 Git；路径 B 需要安装 Node.js（22.12+）。

#### 0.1 把代码上传到 GitHub 仓库（已会可跳过）

1. 打开 https://github.com 注册或登录。
2. 点击右上角 **＋** → **New repository**。
3. 仓库名随意（例如 `cloudnav`），可见性选 Public 或 Private 均可，点击 **Create repository**。
4. 上传本项目全部文件（二选一）：

   - **网页上传（推荐新手）**：在新仓库页面点击 **uploading an existing file**，把本项目的文件/文件夹拖进去，点击 **Commit changes**。
     > ⚠️ 不要上传这几个目录/文件：`node_modules`、`dist`、`.wrangler`、`.dev.vars`、`.reasonix`（体积大或含本地密码，云端会重新生成/不需要）。
   - **Git 命令（进阶，需先安装 Git）**：在本项目目录下执行：
     ```bash
     git init
     git add .
     git commit -m "init"
     git branch -M main
     git remote add origin https://github.com/<你的用户名>/<仓库名>.git
     git push -u origin main
     ```
     > 仓库自带 `.gitignore`，会自动排除 `node_modules`/`dist`/`.wrangler`/`.dev.vars` 等，无需手动处理。

### 第 1 步：创建 KV 命名空间（拿到「命名空间 ID」）

**路径 A（网页）**：
1. 登录 https://dash.cloudflare.com 。
2. 左侧菜单找到 **Workers 和 Pages**，进入后点顶部的 **KV** 标签页。
3. 点击 **创建命名空间**，名称填 `CLOUDNAV_DB`（可自定义，建议照填），点击 **添加**。
4. 创建完成后页面会显示一长串十六进制的 **命名空间 ID**，**先复制保存好**（路径 B 编辑 `wrangler.jsonc` 时要用）。

**路径 B（命令行）**：
```bash
npx wrangler kv namespace create CLOUDNAV_DB
# 命令输出里的 id 即「命名空间 ID」
```

**路径 B 专属：编辑 `wrangler.jsonc`**

路径 B 需要把项目名和 KV ID 写进仓库根目录的 `wrangler.jsonc`（路径 A 完全不用动这个文件，在控制台绑定即可）：

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "<你的 Pages 项目名>",
  "compatibility_date": "2025-04-01",
  "pages_build_output_dir": "dist",
  "kv_namespaces": [
    {
      "binding": "CLOUDNAV_KV",
      "id": "<第 1 步拿到的命名空间 ID>"
    }
  ]
}
```

### 第 2 步：创建 Pages 项目并连接 Git

1. Cloudflare 仪表盘左侧菜单 → **Workers 和 Pages** → 点击 **创建应用程序**。
2. 选择 **Pages** 标签页 → **连接到 Git** → 授权 Cloudflare 访问 GitHub → 选择第 0 步上传的仓库。
3. 构建设置填写：
   - **框架预设**：`无 (None)`
   - **构建命令**：`npm run build`
   - **构建输出目录**：`dist`
4. 点击 **保存并部署**，等待首次构建完成（一般几分钟）。
5. 完成后你的站点地址是 `https://<你的项目名>.pages.dev`。

> 💡 首次部署后页面可能提示「密码未配置 / 未绑定 KV」，这是正常的，继续第 3 步配置即可。

### 第 3 步：绑定 KV + 设置 Secret（关键，缺一不可）

> 这两步都在 Pages 项目的 **设置（Settings）** 里完成。

#### 3.1 绑定 KV（变量名必须是 `CLOUDNAV_KV`）

1. 进入你的 Pages 项目 → **设置（Settings）** → **绑定（Bindings）**。
2. 点击 **添加** → 选择 **KV 命名空间**。
3. **变量名** 填 `CLOUDNAV_KV`（必须一模一样，区分大小写）。
4. **KV 命名空间** 选择第 1 步创建的 `CLOUDNAV_DB`。
5. 保存。

#### 3.2 设置两个 Secret（`PASSWORD` 和 `AUTH_SECRET`）

1. 进入 **设置（Settings）** → **变量和机密（Variables and Secrets）** → **添加** → 选择 **机密（Secret）**，分两次添加：

| 名称 | 值 | 说明 |
|---|---|---|
| `PASSWORD` | 你自己定一个登录密码 | 打开导航页时登录用 |
| `AUTH_SECRET` | 一串随机字符（生成方法见下） | 会话签名密钥，**不能和 PASSWORD 相同** |

**`AUTH_SECRET` 生成方法（任选其一）：**
- Mac / Linux / 已装 OpenSSL 的 Windows：`openssl rand -hex 32`
- Windows PowerShell：
  `powershell -Command "[guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')"`
- 或随手敲一串 32 位以上的随机字母数字（越长越安全）。

> 路径 B 也可用命令行设置 Secret：
> ```bash
> npx wrangler pages secret put PASSWORD --project-name <你的 Pages 项目名>
> npx wrangler pages secret put AUTH_SECRET --project-name <你的 Pages 项目名>
> ```

### 第 4 步：重新部署（让绑定和 Secret 生效）

绑定和 Secret 设置后，需要**重新部署一次**才会生效，任选其一：
- Pages 项目 → **部署（Deployments）** → 最近一次部署右侧 **⋯** → **重试部署（Retry deployment）**；
- 或修改仓库任意文件并提交，触发自动构建。

### 第 5 步：验证部署成功

1. 健康检查（把 `<项目名>` 换成你的 Pages 项目名）：
   ```bash
   curl https://<项目名>.pages.dev/api/health
   ```
   应返回 `{"kvConnected":true,"passwordConfigured":true,"authSecretConfigured":true}`，**三项全 true 即成功**。
   也可以在浏览器直接打开 `https://<项目名>.pages.dev/api/health` 查看。
2. 浏览器打开 `https://<项目名>.pages.dev`，输入 `PASSWORD` 登录 → 左下角显示「已同步」。
3. 添加一个链接 → 刷新页面数据不丢失 → 部署完成 🎉

---

## 四、部署前自检（进阶 / 可选）

> 本节命令面向**在本地改代码、想先验证再推送**的用户。纯网页部署（路径 A）可跳过，云端构建时 Cloudflare 会自动执行 `npm run build`。

```bash
# 1. 全新依赖安装（锁定文件一致性）
npm ci
# 2. 完整类型检查（前端 + Functions）
npm run typecheck
# 3. 生产构建
npm run build
# 4. Functions 正式打包
npx wrangler pages functions build
# 5. 依赖安全审计（应 0 漏洞）
npm audit
# 6. 配置复核
#    - KV 绑定：变量名 CLOUDNAV_KV 已绑定到 KV 命名空间（控制台「绑定」或 wrangler.jsonc）
#    - Secret：PASSWORD、AUTH_SECRET 均已设置（AUTH_SECRET 独立且非密码）
# 7. 部署后冒烟
#    - /api/health 三项 true
#    - 登录、刷新 token、修改密码、永久登录
#    - 增删改/置顶/隐藏/排序/批量操作
#    - 分类新增编辑删除/密码解锁/全站登录分类
#    - HTML/JSON 导入、JSON/HTML 导出、WebDAV 备份恢复
#    - 搜索源新增/恢复/站内站外搜索
#    - AI/天气/日历/时钟/翻译/汇率工具
#    - 图标自动获取/自定义 SVG/缓存回填
#    - 扩展提交链接 → 收件箱 → 打开页面自动导入
#    - Bing/自定义/纯色背景 + 深浅色模式
```

---

## 五、可选配置

### 5.1 自定义域名

Pages 项目 → 自定义域 → 添加域名 → 按提示配置 CNAME。

### 5.2 AI 功能

设置 → AI 设置：提供商（OpenAI 兼容 / Gemini）、API Key、模型。密钥保存在 KV（登录后读取），不会编译进前端 JS。

### 5.3 天气/汇率等工具

设置 → 工具设置：和风天气 Key + 城市 ID、OpenWeather、exchangerate-api Key。

### 5.4 WebDAV 备份

侧边栏"备份"：配置 WebDAV（HTTPS 地址）→ 一键上传/恢复。恢复前自动生成安全备份，恢复后自动测试连接。AI/WebDAV 配置默认不打包进备份（需勾选）。

### 5.5 Chrome 扩展（Pro，异步收件箱）

设置 → 扩展工具 → 生成并加载扩展。
- 保存为**异步收件箱**：提交后进入服务端收件箱，打开导航页面自动合并导入（受 KV 最终一致性影响，可能延迟数秒出现）
- 提交失败自动进入扩展本地队列，指数退避重试；提示"凭据已过期"时登录网站后重新生成扩展
- 侧边栏模式仅 Chrome/Edge 支持；Firefox 退化为弹窗模式

---

## 六、常见问题

| 问题 | 原因与解决 |
|---|---|
| 登录提示密码错误 | 确认 `PASSWORD` Secret 已配置并重新部署；若改过密码，KV 的 `password` 键优先 |
| `/api/health` 返回 503 | KV 未绑定 / PASSWORD 或 AUTH_SECRET 未配置 / KV 不可用；检查第 3 步并重新部署（第 4 步） |
| 扩展提交后一直不出现 | KV 最终一致性延迟（数秒内）；等待 30 秒自动轮询或刷新页面；检查侧边栏"扩展待处理"状态 |
| 扩展提示凭据过期 | 密码已修改或会话代次变更：登录网站后重新生成扩展 |
| 提示"数据已在其他设备更新" | 多端并发写冲突：页面已自动拉取最新数据，刷新后重试 |
| 数据不同步/离线 | 未登录仅本地保存；登录后自动同步云端 |
| 登录被锁定（429） | 连续 5 次错误密码后锁定 10 分钟（按 IP）；等待后重试 |

---

## 七、架构与原理（运维参考）

- **前端**：静态构建产物（`dist/`），Cloudflare 边缘分发；构建期 Tailwind（无 CDN）、本地 qrcode 生成（链接不发送第三方）
- **后端**：`functions/` 自动编译为 Workers Functions；`_middleware.ts` 仅作用于 `/api/*`（统一 no-store/nosniff/Referrer-Policy）
- **鉴权**：`x-auth-password` 携带 HMAC token（`AUTH_SECRET` 签名 + 会话代次 + 过期校验）；明文密码仅登录/改密码；登录失败按 IP 限流（5 次/10 分钟，锁定期间连正确密码也拒绝）
- **数据隔离**：匿名请求剔除受保护分类（有密码/requireAuth）与隐藏链接，分类密码不下发（`hasPassword` 标记）；分类解锁走服务端验证
- **并发写**：主站写入带 revision 冲突检测（旧版本 409 → 自动拉最新）；扩展写入走**收件箱**（不直接写 app_data）
- **KV 键**：`app_data`（links/categories/revision）、`password`、`auth_epoch`、`extension_inbox:<uuid>`、各配置键、`favicon:<domain>`、`bing_wallpaper_*`
- **备份**：schemaVersion 2（主数据 + 网站/搜索/工具配置；AI/WebDAV 需勾选；禁止含密码/token/epoch/限流/收件箱记录）
