# Time Traveler Tool Sets

给未来的时间旅行者准备的一套小工具。每件工具住在自己的文件夹里，互不依赖、互不打扰，新工具直接加一个文件夹即可。

## 工具

| # | 名字 | 说明 |
| --- | --- | --- |
| 01 | [BF Clock](BF_Clock/) | 逆行时间导航仪。你的主观时间继续向前，世界时间向过去移动；可设定目标与 ETA。关掉页面也不中断。 |

## 结构

```
TimeTravelerToolSets/
├── index.html      工具集首页（列出所有工具）
├── .nojekyll       让 GitHub Pages 原样发布静态文件
├── BF_Clock/       01 · 逆行时钟
│   ├── index.html
│   ├── style.css
│   ├── script.js
│   └── README.md
└── README.md
```

新增工具的约定：

1. 建一个用途明确的文件夹（如 `Chrono_Compass/`）；
2. 里面自带 `index.html` 和自己的 `README.md`，不共用外层的 CSS/JS，保持独立；
3. 在根 `index.html` 和上面的表格里加一行。

## 部署

整个仓库是纯静态的 —— 没有构建步骤，没有后端。放哪都能跑，下面两种任选（也可以同时用）。

### 方案 A · GitHub Pages

```bash
git remote add origin https://github.com/<你的用户名>/TimeTravelerToolSets.git
git push -u origin main
```

然后在仓库的 **Settings → Pages** 里，Source 选 `Deploy from a branch`，分支选 `main`、目录选 `/ (root)`，保存。一两分钟后：

- 首页 `https://<用户名>.github.io/TimeTravelerToolSets/`
- 时钟 `https://<用户名>.github.io/TimeTravelerToolSets/BF_Clock/`

### 方案 B · Cloudflare Pages

国内访问通常比 GitHub Pages 快，且自带全球 CDN、免费自定义域名和 HTTPS。

**从 GitHub 仓库连（推荐，推送即自动发布）**

Cloudflare 控制台 → Workers & Pages → Create → Pages → Connect to Git，选中这个仓库，构建设置留空：

| 字段 | 填 |
| --- | --- |
| Framework preset | None |
| Build command | *（留空）* |
| Build output directory | `/` |

**或者用命令行直接传，连 GitHub 都不需要**

```bash
npx wrangler pages deploy . --project-name=time-traveler-tools
```

拿到的地址形如 `https://time-traveler-tools.pages.dev/BF_Clock/`。

### 关于「要不要服务器」

不需要。逆行时钟靠**锚点推算**而非计时器 —— 时间是每帧现算出来的（`2 × 锚点 − 此刻`），页面关着的那段时间照样算得出来，所以没有任何东西需要在服务器上「持续运行」。静态托管足矣。

服务器只在一种情况下才有意义：想让同一段旅程**自动**跨设备同步，而不是靠手动复制那条 `?anchor=` 链接。那需要账号和一个存锚点的接口 —— 目前的设计刻意避开了这些。
