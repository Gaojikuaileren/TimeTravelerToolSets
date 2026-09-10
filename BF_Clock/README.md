# BF Clock · 逆行时间导航仪

**Temporal Navigation Instrument · Backward Flow**

给处在逆行状态的人用的一台仪器：判断自己现在位于什么时间、已经逆行了多久、距离目标还有多远。

线上：<https://gaojikuaileren.github.io/TimeTravelerToolSets/BF_Clock/>

---

## Concept · 这是什么

进入逆行之后，两个时间方向同时存在：

```
YOU     →   +1.000 s/s     你本人照常经历时间
WORLD   ←   −1.000 s/s     你所在的世界时间向过去移动
```

这不是一只坏掉的钟，也不是倒计时。它是一个**正在反向流动的时间坐标**——
你的主观时间仍在累加，而外部世界的时刻在持续减小。整个界面就是围绕这一组
相反方向组织的。

## Temporal model · 时间模型

```
SUBJECTIVE   +1 second / second
WORLD        −1 second / second
```

## Formula · 公式

```
elapsed   = now − anchor
worldTime = anchor − elapsed
worldTime = 2 × anchor − now
```

`anchor` 是进入逆行的那一刻（INVERSION START）。世界时间不靠计时器累加，
每一帧都由绝对时间戳现算。

### 广义形式

为支持可调的世界向量（WORLD VECTOR / 回溯倍率），内部把「一段以恒定倍率
逆行的航程」记作一个段 `(d0, t0, rate)`：

```
worldTime = d0 − rate × (now − t0)
```

换挡时先把当前世界时间存成新的 `d0`、此刻存成新的 `t0`，再改 `rate`，
所以画面连续、不跳变。**当 rate = 1 且从未换挡时，上式精确退化为
`worldTime = 2 × anchor − now`（实测差值 0 ms）**，默认状态下向量正好读作
`−1.000 s/s`。

## 界面

| 区域 | 含义 |
| --- | --- |
| WORLD TIME | 你当前所在的世界时间，第一视觉焦点 |
| 逆行表盘 | 世界时间的模拟表达，指针逆时针走 |
| TEMPORAL VECTOR | 两个方向的对照：YOU → / WORLD ← |
| SUBJECTIVE ELAPSED | 进入逆行后你本人经历了多久 |
| INVERSION START | 逆行起点（可点击自定义） |
| JOURNEY | 航程轨迹，光点从 START 向 TARGET 移动 |
| TARGET / TIME TO TARGET | 导航目标与剩余距离 |

## Target · 目标

TARGET 是**导航标记，不是自动停止**。

到达目标后显示 `TARGET REACHED`，但世界时间**继续逆行**，装置不会替你停下——
网页无从得知你是否真的执行了转向动作。

目标必须早于当前世界时间；逆行只往过去走，设成「未来」会被拒绝并提示。

状态机很简单：

```
NO TARGET  →  INVERSION ACTIVE  →  TARGET APPROACHING (剩余 < 5 min)  →  TARGET REACHED
```

### 设定方式

点 `SET TARGET` 打开面板，可用快捷档（相对**当前世界时间**向过去偏移）：

```
-5 MIN   -30 MIN   -1 HOUR   -6 HOURS   -1 DAY
```

也可以直接填日期与时间。点 `INVERSION START` 的值则可以自定义逆行起点本身，
快捷档为 `NOW / -1 HOUR / -1 DAY / -1 WEEK / -1 YEAR`。改起点后主观时间从设定
的这一刻重新计；若原目标已不在逆行方向上会被清除并提示。

## WORLD VECTOR · 回溯倍率

默认 `×1`，即 `−1.000 s/s`。可调 `HOLD(0) / ×0.5 / ×1 / ×2 / ×10 / ×60 / ×3600`
或自定义 `0 ~ 100000`。

- `HOLD` 时世界时间凝固，主观时间照常流逝。
- 倍率不为 1 时，「世界时间距离」与「还要等多久」不再是一回事，面板会补一行
  现实 ETA，并显示世界位移。
- 超过 `×120` 时秒针只剩残影，会自动隐藏。

## Persistence · 存储

状态存在 `localStorage` 的 `bf_clock.journey.v2`：

```json
{ "origin": …, "originReal": …, "d0": …, "t0": …, "rate": 1, "target": … }
```

旧版的 `bf_clock.anchor.v1` 会被自动读取并无痛迁移，**已有航程不会丢**。

优先级：`URL 参数` → `本机存档` → `v1 存档迁移` → `此时此刻`。

## Share · 分享链接

```
?anchor=<ms>                 只带锚点（v1 起就支持，仍然有效）
?anchor=<ms>&target=<ms>     锚点 + 目标
```

自定义过起点或换过挡的航程会用完整形式
`?origin=&originReal=&d0=&t0=&rate=&target=`，以便在另一台设备上得到**完全一致**
的世界时间与 ETA。

## Offline / closed page · 为什么关掉也成立

因为时间是**算**出来的，不是**数**出来的。

页面关闭后 JavaScript 就停了，任何 `setInterval(() => time--)` 都会随之停摆，
一刷新还会归零并累积误差。这里每一帧都用 `Date.now()` 从锚点重新推算，所以：

- 标签页被浏览器节流 → 无影响
- 设备休眠 / 关机 → 无影响
- 刷新 / 关闭数日后重开 → 直接落在正确的航程位置

刷新率与逻辑时间是两回事：`requestAnimationFrame` 负责指针和百分秒的高帧率
表现，另有一路 1Hz 兜底和 `visibilitychange` 回调保证 rAF 被节流甚至停摆时读数
依然更新——它们只是触发重画，时间值始终来自 `Date.now()`。

## Limitations · 限制

- **时间基准取自本机系统时钟。修改系统时间会直接改变计算出的航程位置。**
  BF Clock uses the device system clock as its reference. Changing system time
  will change the calculated journey position.
- 没有服务器校时，也不联网。
- 检测到系统时钟**倒退**超过 2 秒时会提示 `SYSTEM TIME SHIFT DETECTED`。
  只检测倒退——向前的跳变与设备休眠、标签页节流无法区分，不做误报。
- 锚点与目标存在本地浏览器，换设备或清空站点数据会重新开始；用分享链接可带走。
- 它没有真的改变现实时间。

## Accessibility

语义化 HTML；世界时间用 `<time datetime>`；秒级读数不进 `aria-live`（只有状态
变化才播报）；Modal 有 `role="dialog"`、焦点陷阱、ESC 关闭、关闭后焦点回到触发
按钮；触控目标 ≥ 44px；支持 `prefers-reduced-motion`；表盘 `aria-hidden`，因为数字
读数已提供准确时间。

## 技术栈

Vanilla HTML / CSS / JS。无框架、无构建、无依赖、无后端、无追踪。

```
BF_Clock/
├── index.html
├── style.css
├── script.js
└── README.md
```

## 本地预览

```bash
python -m http.server 8000
```

然后访问 <http://localhost:8000/BF_Clock/>。
