/*
 * BF Clock — 逆行时钟
 *
 * 时间不靠计时器累加，而是每一帧由锚点重新推算：
 *
 *     显示时间 = 锚点 - (此刻 - 锚点) = 2 × 锚点 - 此刻
 *
 * 锚点是「第一次打开这个页面」的真实时刻，存在 localStorage 里。
 * 因此页面关闭、设备关机、隔几天再来，它都一直在往回走，
 * 而且没有任何累积误差。
 */
(function () {
  'use strict';

  var STORE_KEY = 'bf_clock.anchor.v1';
  var WEEKDAYS  = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

  // ── 锚点存取 ────────────────────────────────────────
  function readStore(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }

  function writeStore(key, value) {
    try { window.localStorage.setItem(key, value); return true; }
    catch (e) { return false; }   // 隐私模式 / 站点数据被禁用
  }

  function isValidAnchor(n) {
    return typeof n === 'number' && isFinite(n) && n > 0;
  }

  /* 优先级：URL 里的 ?anchor= > 本机存档 > 此时此刻 */
  function resolveAnchor() {
    var fromUrl = Number(new URLSearchParams(location.search).get('anchor'));
    if (isValidAnchor(fromUrl)) {
      writeStore(STORE_KEY, String(fromUrl));
      return fromUrl;
    }
    var stored = Number(readStore(STORE_KEY));
    if (isValidAnchor(stored)) return stored;

    var now = Date.now();
    writeStore(STORE_KEY, String(now));
    return now;
  }

  var anchor = resolveAnchor();

  // ── 格式化 ──────────────────────────────────────────
  function pad(n, width) {
    var s = String(Math.abs(n));
    while (s.length < (width || 2)) s = '0' + s;
    return (n < 0 ? '-' : '') + s;
  }

  function formatClock(d) {
    return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }

  function formatDate(d) {
    return pad(d.getFullYear(), 4) + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
         + ' ' + WEEKDAYS[d.getDay()];
  }

  function formatDuration(ms) {
    var total = Math.max(0, Math.floor(ms / 1000));
    var days  = Math.floor(total / 86400);
    var rest  = total % 86400;
    var hms   = pad(Math.floor(rest / 3600)) + ':' + pad(Math.floor(rest / 60) % 60) + ':' + pad(rest % 60);
    return days > 0 ? days + ' 天 ' + hms : hms;
  }

  // ── 画表盘（刻度与数字） ────────────────────────────
  var SVG_NS = 'http://www.w3.org/2000/svg';

  function buildFace() {
    var ticks = document.getElementById('ticks');
    var nums  = document.getElementById('numerals');

    for (var i = 0; i < 60; i++) {
      var major = i % 5 === 0;
      var rad   = i * 6 * Math.PI / 180;
      var outer = 168;
      var inner = major ? 151 : 160;
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
      t.setAttribute('x', (200 + 126 * Math.sin(a)).toFixed(2));
      t.setAttribute('y', (200 - 126 * Math.cos(a)).toFixed(2));
      t.setAttribute('class', 'numeral');
      t.textContent = String(h);
      nums.appendChild(t);
    }
  }

  // ── 渲染 ────────────────────────────────────────────
  var el = {};
  var hands = {};
  var lastSecondShown = null;

  function turn(node, deg) {
    node.setAttribute('transform', 'rotate(' + deg.toFixed(3) + ' 200 200)');
  }

  function render() {
    var now     = Date.now();
    var rewound = now - anchor;        // 已经往回走了多久
    var display = anchor - rewound;    // 即 2 × anchor - now
    var d       = new Date(display);

    // 时间在减小，角度随之减小 —— 指针自然逆时针走
    var ms  = d.getMilliseconds();
    var sec = d.getSeconds() + ms / 1000;
    var min = d.getMinutes() + sec / 60;
    var hr  = (d.getHours() % 12) + min / 60;

    turn(hands.hour,   hr  * 30);
    turn(hands.minute, min * 6);
    turn(hands.second, sec * 6);

    el.centis.textContent = '.' + pad(Math.floor(ms / 10));

    // 秒没变就跳过文本写入，省掉大量无谓的重排
    var stamp = formatClock(d);
    if (stamp !== lastSecondShown) {
      lastSecondShown = stamp;
      el.digital.textContent = stamp;
      el.digital.setAttribute('datetime', d.toISOString());
      el.datestamp.textContent = formatDate(d);
      el.rewound.textContent   = formatDuration(rewound);
      document.title = stamp + ' ↺ BF Clock';
    }

    requestAnimationFrame(render);
  }

  // ── 交互 ────────────────────────────────────────────
  var toastTimer = null;

  function toast(message) {
    el.toast.textContent = message;
    el.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.toast.classList.remove('show'); }, 2600);
  }

  function shareUrl() {
    return location.origin + location.pathname + '?anchor=' + anchor;
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

  function stampAnchorLabel() {
    var a = new Date(anchor);
    el.anchor.textContent = formatDate(a) + ' ' + formatClock(a);
  }

  function bindControls() {
    document.getElementById('btnReset').addEventListener('click', function () {
      if (!window.confirm('把锚点重设为此刻？当前这段回溯将被丢弃。')) return;
      anchor = Date.now();
      writeStore(STORE_KEY, String(anchor));
      // URL 里若还带着旧锚点，清掉它，否则一刷新又被拽回去
      if (new URLSearchParams(location.search).has('anchor')) {
        history.replaceState(null, '', location.pathname);
      }
      stampAnchorLabel();
      lastSecondShown = null;
      toast('已从此刻重新出发。');
    });

    document.getElementById('btnShare').addEventListener('click', function () {
      var url = shareUrl();
      copyText(url).then(
        function () { toast('链接已复制，在别处打开即可接上这段旅程。'); },
        function () { window.prompt('手动复制这个链接：', url); }
      );
    });
  }

  // ── 启动 ────────────────────────────────────────────
  el.digital   = document.getElementById('digital');
  el.centis    = document.getElementById('centis');
  el.datestamp = document.getElementById('datestamp');
  el.rewound   = document.getElementById('rewound');
  el.anchor    = document.getElementById('anchor');
  el.toast     = document.getElementById('toast');

  hands.hour   = document.getElementById('handHour');
  hands.minute = document.getElementById('handMinute');
  hands.second = document.getElementById('handSecond');

  buildFace();
  bindControls();
  stampAnchorLabel();

  if (!writeStore('bf_clock.probe', '1')) {
    toast('浏览器禁用了站点存储，刷新后会重新出发。');
  }

  render();
})();
