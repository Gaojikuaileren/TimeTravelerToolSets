/*
 * BF Clock — 逆行时间导航仪 / Temporal Navigation Instrument
 *
 * 时间模型
 * ────────
 *   你（主观）  +1 s/s   subjectiveElapsed = now − originReal
 *   世界        −1 s/s   worldTime         = anchor − (now − anchor)
 *                                          = 2 × anchor − now
 *
 * 一切都由绝对时间戳推算，没有任何计时器在累加。所以标签页被节流、
 * 设备休眠、页面关闭数日，重新打开时航程位置依然准确，且无累积误差。
 *
 * 广义形式
 * ────────
 * 为了支持可调的世界向量（回溯倍率），内部把「一段以恒定倍率逆行的航程」
 * 记作一个段 (d0, t0, rate)：
 *
 *   worldTime = d0 − rate × (now − t0)
 *
 * 换挡时先把当前世界时间存成新的 d0、此刻存成新的 t0，再改 rate，
 * 于是画面连续、不跳变。当 rate = 1 且从未换挡时，上式精确退化为
 * worldTime = 2 × anchor − now。
 *
 * 状态
 * ────
 *   origin      逆行起点的世界时间（默认等于进入逆行的现实时刻）
 *   originReal  进入逆行的现实时刻，主观时间从这里开始计
 *   d0, t0      当前段的起点
 *   rate        世界向量的倍率
 *   target      导航目标（世界时间），可为 null
 */
(function () {
  'use strict';

  /* ═══ 常量 ═══════════════════════════════════════════ */

  var STORE_KEY  = 'bf_clock.journey.v2';
  var LEGACY_KEY = 'bf_clock.anchor.v1';     // v1 只存一个锚点
  var PROBE_KEY  = 'bf_clock.probe';

  var MAX_RATE    = 100000;
  var HAND_LIMIT  = 120;                     // 再快秒针就只剩残影
  var APPROACH_MS = 5 * 60 * 1000;           // 距目标 5 分钟内视为接近
  var SHIFT_MS    = 2000;                    // 系统时钟倒退多少算跳变

  var WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

  /* ═══ Storage ════════════════════════════════════════ */

  function readStore(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }

  function writeStore(key, value) {
    try { window.localStorage.setItem(key, value); return true; }
    catch (e) { return false; }              // 隐私模式 / 站点数据被禁用
  }

  /* ═══ Journey State ══════════════════════════════════ */

  var journey = null;

  function num(v) { return (v === null || v === '') ? NaN : Number(v); }

  /* 现实时刻必须为 1970 之后的正数 */
  function isRealTime(n) { return isFinite(n) && n > 0; }

  /* 世界时间回溯得够久会跌破 1970，允许为负 */
  function isWorldTime(n) { return isFinite(n); }

  function isValidRate(r) { return isFinite(r) && r >= 0 && r <= MAX_RATE; }

  function newJourney(worldStart, realNow, rate, target) {
    return {
      origin:     worldStart,
      originReal: realNow,
      d0:         worldStart,
      t0:         realNow,
      rate:       isValidRate(rate) ? rate : 1,
      target:     isWorldTime(target) ? target : null
    };
  }

  function save() { return writeStore(STORE_KEY, JSON.stringify(journey)); }

  function parseStored(raw) {
    if (!raw) return null;
    var o;
    try { o = JSON.parse(raw); } catch (e) { return null; }
    if (!o || typeof o !== 'object') return null;
    if (!isRealTime(o.originReal) || !isWorldTime(o.origin)) return null;
    if (!isWorldTime(o.d0) || !isRealTime(o.t0)) return null;
    return {
      origin:     o.origin,
      originReal: o.originReal,
      d0:         o.d0,
      t0:         o.t0,
      rate:       isValidRate(o.rate) ? o.rate : 1,
      target:     isWorldTime(o.target) ? o.target : null
    };
  }

  /* URL 可带完整段，也可只带 anchor（v1 起就支持的短链接）、target、rate */
  function stateFromUrl() {
    var q      = new URLSearchParams(location.search);
    var rate   = num(q.get('rate'));
    var target = num(q.get('target'));
    var origin = num(q.get('origin'));
    var oReal  = num(q.get('originReal'));
    var d0     = num(q.get('d0'));
    var t0     = num(q.get('t0'));
    var anchor = num(q.get('anchor'));

    var r = isValidRate(rate) ? rate : 1;
    var g = isWorldTime(target) ? target : null;

    if (isWorldTime(origin) && isRealTime(oReal) && isWorldTime(d0) && isRealTime(t0)) {
      return { origin: origin, originReal: oReal, d0: d0, t0: t0, rate: r, target: g };
    }
    if (isRealTime(anchor)) {                       // 含 v1 时代发出去的老链接
      return newJourney(anchor, anchor, r, g);
    }
    if (isValidRate(rate) || g !== null) {          // 只给了倍率或目标：从此刻出发
      var now = Date.now();
      return newJourney(now, now, r, g);
    }
    return null;
  }

  /* 优先级：URL > 本机存档 > v1 存档迁移 > 此时此刻 */
  function resolveState() {
    var fromUrl = stateFromUrl();
    if (fromUrl) { journey = fromUrl; save(); return; }

    var stored = parseStored(readStore(STORE_KEY));
    if (stored) { journey = stored; return; }

    var legacy = num(readStore(LEGACY_KEY));
    if (isRealTime(legacy)) {                       // 老访客的航程原样接上
      journey = newJourney(legacy, legacy, 1, null);
      save();
      return;
    }

    var now = Date.now();
    journey = newJourney(now, now, 1, null);
    save();
  }

  function clearUrlParams() {
    if (!location.search) return;
    try { history.replaceState(null, '', location.pathname); } catch (e) { /* 无妨 */ }
  }

  /* ═══ Time Calculation（纯函数） ═════════════════════ */

  function getWorldTime(j, realNow) {
    return j.d0 - j.rate * (realNow - j.t0);
  }

  function getSubjectiveElapsed(j, realNow) {
    return Math.max(0, realNow - j.originReal);
  }

  function getWorldDisplacement(j, worldTime) {
    return j.origin - worldTime;
  }

  /* 世界时间到目标还差多少（世界时间尺度），到达后不返回负数 */
  function getTimeToTarget(worldTime, target) {
    if (target === null) return null;
    return Math.max(0, worldTime - target);
  }

  /* 航程完成度 0→1，仅在有目标时有意义 */
  function getJourneyProgress(j, worldTime) {
    if (j.target === null) return null;
    var span = j.origin - j.target;
    if (span <= 0) return 1;
    var p = (j.origin - worldTime) / span;
    return p < 0 ? 0 : (p > 1 ? 1 : p);
  }

  function getPhase(j, remaining) {
    if (j.target === null) return 'none';
    if (remaining <= 0) return 'reached';
    if (remaining <= APPROACH_MS) return 'approach';
    return 'active';
  }

  /* ═══ Formatting ═════════════════════════════════════ */

  function pad(n, width) {
    var s = String(Math.abs(n));
    while (s.length < (width || 2)) s = '0' + s;
    return (n < 0 ? '-' : '') + s;
  }

  function formatClock(d) {
    return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }

  function formatShort(d) {
    return pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function formatDate(d) {
    return pad(d.getFullYear(), 4) + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function formatDateFull(d) {
    return formatDate(d) + '  ' + WEEKDAYS[d.getDay()];
  }

  function formatStamp(d) {
    return formatDate(d) + ' ' + formatClock(d);
  }

  /* 00:42:16 / 2 DAYS · 04:13:08 / 3 YRS · 120 DAYS（年按 365 天粗算） */
  function formatDuration(ms) {
    var total = Math.max(0, Math.floor(ms / 1000));
    var days  = Math.floor(total / 86400);
    var rest  = total % 86400;
    var hms   = pad(Math.floor(rest / 3600)) + ':' +
                pad(Math.floor(rest / 60) % 60) + ':' + pad(rest % 60);

    if (days >= 365) return Math.floor(days / 365) + ' YRS · ' + (days % 365) + ' DAYS';
    if (days > 0)    return days + (days > 1 ? ' DAYS · ' : ' DAY · ') + hms;
    return hms;
  }

  function humanizeSeconds(s) {
    function trim(n) { return String(Number(n.toFixed(2))); }
    if (s < 60)       return trim(s) + ' 秒';
    if (s < 3600)     return trim(s / 60) + ' 分钟';
    if (s < 86400)    return trim(s / 3600) + ' 小时';
    if (s < 31536000) return trim(s / 86400) + ' 天';
    return trim(s / 31536000) + ' 年';
  }

  function formatRate(r) { return r === 0 ? 'HOLD' : '×' + String(Number(r.toFixed(4))); }

  /* HOLD 时负号加在零上是错的 */
  function formatVector(r) { return (r === 0 ? '' : '−') + r.toFixed(3) + ' s/s'; }

  /* ═══ Dial Rendering ═════════════════════════════════ */

  var SVG_NS = 'http://www.w3.org/2000/svg';

  function buildFace() {
    var ticks = document.getElementById('ticks');
    var nums  = document.getElementById('numerals');

    for (var i = 0; i < 60; i++) {
      var major = i % 5 === 0;
      var rad   = i * 6 * Math.PI / 180;
      var outer = 150;
      var inner = major ? 134 : 142;
      var line  = document.createElementNS(SVG_NS, 'line');

      line.setAttribute('x1', (200 + outer * Math.sin(rad)).toFixed(2));
      line.setAttribute('y1', (200 - outer * Math.cos(rad)).toFixed(2));
      line.setAttribute('x2', (200 + inner * Math.sin(rad)).toFixed(2));
      line.setAttribute('y2', (200 - inner * Math.cos(rad)).toFixed(2));
      line.setAttribute('class', major ? 'tick major' : 'tick');
      ticks.appendChild(line);
    }

    for (var h = 1; h <= 12; h++) {
      var a = h * 30 * Math.PI / 180;
      var t = document.createElementNS(SVG_NS, 'text');
      t.setAttribute('x', (200 + 112 * Math.sin(a)).toFixed(2));
      t.setAttribute('y', (200 - 112 * Math.cos(a)).toFixed(2));
      t.setAttribute('class', 'numeral');
      t.textContent = String(h);
      nums.appendChild(t);
    }
  }

  function turn(node, deg) {
    node.setAttribute('transform', 'rotate(' + deg.toFixed(3) + ' 200 200)');
  }

  /* ═══ UI Rendering ═══════════════════════════════════ */

  var el = {}, hands = {};
  var lastStamp = null, lastRealSec = null, lastPhase = null, lastNow = 0;

  function paintPhase(phase, remaining) {
    if (phase === lastPhase) return;
    lastPhase = phase;

    var text = 'INVERSION ACTIVE', tone = '';
    if (phase === 'approach') { text = 'TARGET APPROACHING'; tone = 'approach'; }
    if (phase === 'reached')  { text = 'TARGET REACHED';     tone = 'reached';  }

    el.statusText.textContent = text;
    el.statusChip.setAttribute('data-tone', tone);
    el.targetPanel.setAttribute('data-state', phase);

    el.journeyNote.textContent = phase === 'none'
      ? 'NO TARGET SET · 未设定目标'
      : 'INVERSION TRAVEL · 逆行中';

    el.track.setAttribute('data-mode', phase === 'none' ? 'open' : 'target');
  }

  function paintTrack(worldTime, progress, subjElapsed) {
    var pct;
    if (progress === null) {
      // 无目标：不存在终点，所以用渐近曲线让光点持续向过去漂移但永不抵达左端，
      // 左侧轨道也淡出 —— 避免伪造一个完成百分比。
      var hours = subjElapsed / 3600000;
      pct = 100 - 68 * (1 - 1 / (1 + hours));
    } else {
      pct = 100 - progress * 100;
    }
    el.trackDot.style.left  = pct.toFixed(2) + '%';
    el.trackFill.style.width = (100 - pct).toFixed(2) + '%';
  }

  function paintTargetFields(worldTime, remaining, phase) {
    if (journey.target === null) {
      el.targetValue.textContent = 'NOT SET';
      el.targetDate.textContent  = '';
      el.etaValue.textContent    = 'NO TARGET';
      el.etaReal.hidden          = true;
      el.tlLeftTag.textContent   = '← PAST';
      el.tlLeftVal.textContent   = '';
      return;
    }

    // 时间与日期分行：窄屏上完整时间戳挤在半格里会被截断
    var t = new Date(Math.floor(journey.target));
    el.targetValue.textContent = formatClock(t);
    el.targetDate.textContent  = formatDateFull(t);
    el.tlLeftTag.textContent   = 'TARGET';
    el.tlLeftVal.textContent   = formatShort(t);

    if (phase === 'reached') {
      el.etaValue.textContent = 'TARGET REACHED';
      el.etaReal.hidden = true;
      return;
    }

    el.etaValue.textContent = formatDuration(remaining);

    // 倍率不为 1 时，「世界时间距离」和「还要等多久」不是一回事，补一行现实 ETA
    if (journey.rate === 1) {
      el.etaReal.hidden = true;
    } else {
      el.etaReal.hidden = false;
      el.etaReal.textContent = journey.rate === 0
        ? '现实 ETA —— 世界时间已凝固'
        : '现实 ETA ' + formatDuration(remaining / journey.rate);
    }
  }

  function paint(now) {

    // 系统时钟倒退是唯一能与「标签页节流 / 设备休眠」区分开的跳变
    if (lastNow && now < lastNow - SHIFT_MS) el.shiftNotice.hidden = false;
    lastNow = now;

    var worldTime = getWorldTime(journey, now);
    var d         = new Date(Math.floor(worldTime));

    var ms  = d.getMilliseconds();
    var sec = d.getSeconds() + ms / 1000;
    var min = d.getMinutes() + sec / 60;
    var hr  = (d.getHours() % 12) + min / 60;

    // 世界时间在减小，角度随之减小 —— 指针自然逆时针走
    turn(hands.hour,   hr  * 30);
    turn(hands.minute, min * 6);
    turn(hands.second, sec * 6);

    el.worldCentis.textContent = '.' + pad(Math.floor(ms / 10));

    var stamp = formatClock(d);
    if (stamp !== lastStamp) {
      lastStamp = stamp;
      el.worldClock.textContent = stamp;
      el.worldClock.setAttribute('datetime', d.toISOString());
      el.worldDate.textContent  = formatDateFull(d);
      document.title = stamp + ' ← BF Clock';
    }

    // 每现实秒更新一次：倍率为 0 时世界时间静止，但主观时间仍在走
    var realSec = Math.floor(now / 1000);
    if (realSec !== lastRealSec) {
      lastRealSec = realSec;

      var subj      = getSubjectiveElapsed(journey, now);
      var remaining = getTimeToTarget(worldTime, journey.target);
      var phase     = getPhase(journey, remaining === null ? null : remaining);

      el.subjElapsed.textContent = formatDuration(subj);

      if (journey.rate !== 1) {
        el.displacementRow.hidden = false;
        el.displacement.textContent = formatDuration(getWorldDisplacement(journey, worldTime));
      } else {
        el.displacementRow.hidden = true;   // 与 SUBJECTIVE ELAPSED 等值，不重复堆信息
      }

      paintPhase(phase, remaining);
      paintTargetFields(worldTime, remaining, phase);
      paintTrack(worldTime, getJourneyProgress(journey, worldTime), subj);
    }
  }

  /*
   * 刷新与计时是两回事。rAF 负责指针和百分秒的高帧率表现，但它会被浏览器
   * 节流甚至完全停摆（隐藏标签页、部分移动端浏览器回到前台之前）。所以再挂
   * 一个 1Hz 兜底和一个可见性回调 —— 它们只是触发重画，时间值始终由
   * Date.now() 现算，不存在 tick 累加，因此任何一路停摆都不会造成误差。
   */
  function loop() {
    paint(Date.now());
    requestAnimationFrame(loop);
  }

  function startRendering() {
    requestAnimationFrame(loop);
    setInterval(function () { paint(Date.now()); }, 1000);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) paint(Date.now());
    });
    window.addEventListener('pageshow', function () { paint(Date.now()); });
  }

  /* 状态变化后需要立刻重画的静态部分 */
  function paintStatics() {
    var o = new Date(Math.floor(journey.origin));
    el.btnAnchor.textContent = formatStamp(o);
    el.tlRightVal.textContent = formatShort(o);

    el.worldRate.textContent = formatVector(journey.rate);
    el.rateNow.textContent   = formatRate(journey.rate);
    el.rateInput.value       = String(journey.rate);
    el.rateHint.textContent  = journey.rate === 0
      ? '世界时间凝固，指针停住 —— 你的主观时间照常流逝。'
      : '现实每过 1 秒，世界时间向过去移动 ' + humanizeSeconds(journey.rate) + '。';

    for (var i = 0; i < el.chips.length; i++) {
      var on = Number(el.chips[i].getAttribute('data-rate')) === journey.rate;
      el.chips[i].classList.toggle('active', on);
      el.chips[i].setAttribute('aria-pressed', on ? 'true' : 'false');
    }

    hands.second.classList.toggle('mute', journey.rate > HAND_LIMIT);

    lastStamp = lastRealSec = null;   // 强制重画全部读数
    lastPhase = null;
    paint(Date.now());                // 状态一变立刻反映，不等下一帧
  }

  /* ═══ Toast ══════════════════════════════════════════ */

  var toastTimer = null;

  function toast(message) {
    el.toast.textContent = message;
    el.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.toast.classList.remove('show'); }, 3000);
  }

  /* ═══ Target / Anchor Controls ═══════════════════════ */

  var modalMode = 'target';
  var lastFocused = null;

  var QUICK = {
    target: [
      { label: '-5 MIN',   ms: 5 * 60000 },
      { label: '-30 MIN',  ms: 30 * 60000 },
      { label: '-1 HOUR',  ms: 3600000 },
      { label: '-6 HOURS', ms: 6 * 3600000 },
      { label: '-1 DAY',   ms: 86400000 }
    ],
    anchor: [
      { label: 'NOW',      ms: 0 },
      { label: '-1 HOUR',  ms: 3600000 },
      { label: '-1 DAY',   ms: 86400000 },
      { label: '-1 WEEK',  ms: 7 * 86400000 },
      { label: '-1 YEAR',  ms: 365 * 86400000 }
    ]
  };

  function fillFields(ts) {
    var d = new Date(Math.floor(ts));
    el.modalDate.value = formatDate(d);
    el.modalTime.value = formatClock(d);
  }

  function readFields() {
    var dv = el.modalDate.value, tv = el.modalTime.value;
    if (!dv || !tv) return NaN;

    var dp = dv.split('-'), tp = tv.split(':');
    if (dp.length !== 3 || tp.length < 2) return NaN;

    var d = new Date(
      Number(dp[0]), Number(dp[1]) - 1, Number(dp[2]),
      Number(tp[0]), Number(tp[1]), Number(tp[2] || 0), 0
    );
    var ms = d.getTime();
    return isFinite(ms) ? ms : NaN;
  }

  function buildQuick(mode) {
    el.modalQuick.innerHTML = '';
    var base = mode === 'target' ? getWorldTime(journey, Date.now()) : Date.now();

    QUICK[mode].forEach(function (q) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.textContent = q.label;
      b.addEventListener('click', function () {
        fillFields(base - q.ms);          // 相对当前世界时间 / 此刻向过去移动
        el.modalError.textContent = '';
      });
      el.modalQuick.appendChild(b);
    });
  }

  function openModal(mode, trigger) {
    modalMode = mode;
    // 显式记住触发元素：关闭后焦点必须回到它，不能留在已隐藏的输入框上
    lastFocused = trigger || document.activeElement;

    var isTarget = mode === 'target';
    el.modalTitle.textContent = isTarget ? 'TARGET WORLD TIME' : 'INVERSION START';
    el.modalSub.textContent   = isTarget
      ? '设定要逆行抵达的世界时间。必须早于当前世界时间 —— 逆行只往过去走。'
      : '自定义进入逆行的世界时间。主观时间从设定的这一刻重新计。';
    el.modalApply.textContent = isTarget ? 'SET TARGET' : 'SET START';
    el.modalClear.hidden      = !(isTarget && journey.target !== null);

    buildQuick(mode);
    fillFields(isTarget
      ? (journey.target !== null ? journey.target : getWorldTime(journey, Date.now()) - 3600000)
      : journey.origin);

    el.modalError.textContent = '';
    el.modalBack.hidden = false;
    el.modalDate.focus();
  }

  function closeModal() {
    el.modalBack.hidden = true;
    var back = (lastFocused && lastFocused.isConnected && lastFocused.offsetParent !== null)
             ? lastFocused
             : document.getElementById('btnTarget');
    if (back && back.focus) back.focus();
  }

  function applyModal() {
    var ms = readFields();
    if (!isFinite(ms)) {
      el.modalError.textContent = '请填写完整的日期与时间。';
      return;
    }

    if (modalMode === 'target') {
      var worldNow = getWorldTime(journey, Date.now());
      if (ms >= worldNow) {
        el.modalError.textContent = '目标必须早于当前世界时间（' +
          formatStamp(new Date(Math.floor(worldNow))) + '）—— 逆行只往过去走。';
        return;
      }
      journey.target = ms;
      save();
      clearUrlParams();
      paintStatics();
      closeModal();
      toast('TARGET SET · 目标已设定为 ' + formatStamp(new Date(ms)));
      return;
    }

    // 自定义逆行起点：现实时间从此刻重新计，旧目标若已不在逆行方向上则清除
    var now = Date.now();
    var keptTarget = (journey.target !== null && journey.target < ms) ? journey.target : null;
    var dropped = journey.target !== null && keptTarget === null;

    journey = newJourney(ms, now, journey.rate, keptTarget);
    save();
    clearUrlParams();
    paintStatics();
    closeModal();
    toast(dropped
      ? 'INVERSION START 已更新，原目标不在逆行方向上，已清除。'
      : 'INVERSION START 已设为 ' + formatStamp(new Date(ms)));
  }

  function trapKeys(e) {
    if (e.key === 'Escape') { e.preventDefault(); closeModal(); return; }
    if (e.key !== 'Tab') return;

    var nodes = el.modal.querySelectorAll('button, input');
    var list  = [];
    for (var i = 0; i < nodes.length; i++) {
      if (!nodes[i].hidden && !nodes[i].disabled && nodes[i].offsetParent !== null) list.push(nodes[i]);
    }
    if (!list.length) return;

    var first = list[0], last = list[list.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  /* ═══ Share ══════════════════════════════════════════ */

  function shareUrl() {
    var base = location.origin + location.pathname;
    var q;

    // 从未换过挡、起点未被自定义 —— 用 v1 起就通用的短链接
    var pristine = journey.rate === 1 &&
                   journey.d0 === journey.origin &&
                   journey.t0 === journey.originReal &&
                   journey.origin === journey.originReal;

    if (pristine) {
      q = '?anchor=' + journey.origin;
    } else {
      q = '?origin='   + Math.round(journey.origin) +
          '&originReal=' + journey.originReal +
          '&d0='       + Math.round(journey.d0) +
          '&t0='       + journey.t0 +
          '&rate='     + journey.rate;
    }
    if (journey.target !== null) q += '&target=' + Math.round(journey.target);
    return base + q;
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      if (ok) { resolve(); } else { reject(new Error('copy failed')); }
    });
  }

  /* ═══ 倍率 ═══════════════════════════════════════════ */

  function setRate(rate) {
    var now = Date.now();
    journey.d0   = getWorldTime(journey, now);   // 就地重新锚定，画面不跳
    journey.t0   = now;
    journey.rate = rate;
    save();
    clearUrlParams();
    paintStatics();
  }

  function applyCustomRate() {
    var r = Number(el.rateInput.value);
    if (!isValidRate(r)) {
      toast('倍率要在 0 到 ' + MAX_RATE + ' 之间。');
      el.rateInput.value = String(journey.rate);
      return;
    }
    setRate(r);
    toast('WORLD VECTOR ' + formatVector(r));
  }

  /* ═══ Initialization ═════════════════════════════════ */

  function bind() {
    var btnTarget = document.getElementById('btnTarget');
    btnTarget.addEventListener('click', function () { openModal('target', btnTarget); });
    el.btnAnchor.addEventListener('click', function () { openModal('anchor', el.btnAnchor); });

    el.modalApply.addEventListener('click', applyModal);
    el.modalCancel.addEventListener('click', closeModal);

    el.modalClear.addEventListener('click', function () {
      journey.target = null;
      save();
      clearUrlParams();
      paintStatics();
      closeModal();
      toast('TARGET CLEARED · 目标已清除');
    });

    el.modalBack.addEventListener('keydown', trapKeys);
    el.modalBack.addEventListener('mousedown', function (e) {
      if (e.target === el.modalBack) closeModal();
    });

    [el.modalDate, el.modalTime].forEach(function (input) {
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); applyModal(); }
      });
    });

    document.getElementById('btnReset').addEventListener('click', function () {
      if (!window.confirm('这会把此刻设为新的逆行起点，并清除当前目标时间。')) return;
      var now = Date.now();
      journey = newJourney(now, now, journey.rate, null);
      save();
      clearUrlParams();
      paintStatics();
      toast('INVERSION RESET · 已从此刻重新进入逆行');
    });

    document.getElementById('btnShare').addEventListener('click', function () {
      var url = shareUrl();
      copyText(url).then(
        function () { toast('JOURNEY LINK COPIED · 在别处打开即可接上这段航程'); },
        function () { window.prompt('手动复制这个链接：', url); }
      );
    });

    for (var i = 0; i < el.chips.length; i++) {
      el.chips[i].addEventListener('click', function () {
        setRate(Number(this.getAttribute('data-rate')));
        toast('WORLD VECTOR ' + formatVector(journey.rate));
      });
    }

    el.rateApply.addEventListener('click', applyCustomRate);
    el.rateInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); applyCustomRate(); }
    });

    el.btnShiftDismiss.addEventListener('click', function () { el.shiftNotice.hidden = true; });
  }

  function grab() {
    el.statusChip  = document.getElementById('statusChip');
    el.statusText  = document.getElementById('statusText');
    el.worldClock  = document.getElementById('worldClock');
    el.worldCentis = document.getElementById('worldCentis');
    el.worldDate   = document.getElementById('worldDate');
    el.subjElapsed = document.getElementById('subjElapsed');
    el.worldRate   = document.getElementById('worldRate');
    el.btnAnchor   = document.getElementById('btnAnchor');
    el.displacementRow = document.getElementById('displacementRow');
    el.displacement    = document.getElementById('displacement');

    el.journeyNote = document.getElementById('journeyNote');
    el.track       = document.getElementById('track');
    el.trackDot    = document.getElementById('trackDot');
    el.trackFill   = document.getElementById('trackFill');
    el.tlLeftTag   = document.getElementById('tlLeftTag');
    el.tlLeftVal   = document.getElementById('tlLeftVal');
    el.tlRightVal  = document.getElementById('tlRightVal');

    el.targetPanel = document.getElementById('targetPanel');
    el.targetValue = document.getElementById('targetValue');
    el.targetDate  = document.getElementById('targetDate');
    el.etaValue    = document.getElementById('etaValue');
    el.etaReal     = document.getElementById('etaReal');

    el.toast       = document.getElementById('toast');
    el.rateNow     = document.getElementById('rateNow');
    el.rateInput   = document.getElementById('rateInput');
    el.rateApply   = document.getElementById('btnRateApply');
    el.rateHint    = document.getElementById('rateHint');
    el.chips       = document.querySelectorAll('#ratePresets .chip');

    el.modalBack   = document.getElementById('modalBack');
    el.modal       = document.getElementById('modal');
    el.modalTitle  = document.getElementById('modalTitle');
    el.modalSub    = document.getElementById('modalSub');
    el.modalQuick  = document.getElementById('modalQuick');
    el.modalDate   = document.getElementById('modalDate');
    el.modalTime   = document.getElementById('modalTime');
    el.modalError  = document.getElementById('modalError');
    el.modalApply  = document.getElementById('btnModalApply');
    el.modalCancel = document.getElementById('btnModalCancel');
    el.modalClear  = document.getElementById('btnModalClear');
    el.shiftNotice = document.getElementById('shiftNotice');
    el.btnShiftDismiss = document.getElementById('btnShiftDismiss');

    hands.hour   = document.getElementById('handHour');
    hands.minute = document.getElementById('handMinute');
    hands.second = document.getElementById('handSecond');
  }

  grab();
  resolveState();
  buildFace();
  bind();
  paintStatics();

  if (!writeStore(PROBE_KEY, '1')) {
    toast('浏览器禁用了站点存储，刷新后会重新进入逆行。');
  }

  startRendering();
})();
