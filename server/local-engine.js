/**
 * Supernova Engine — moteur IA intégré, 100 % local, sans clé d'API.
 * Ce n'est pas un LLM : c'est un moteur heuristique honnête qui sait
 *  - générer de petits projets web complets (5 modèles soignés),
 *  - modifier un projet existant (couleurs, thème, titre, finitions),
 *  - répondre à des questions techniques courantes,
 *  - chercher des informations sur le web et les résumer.
 * Il parle le même protocole de fichiers que les grands modèles.
 */

import { searchWeb } from './search.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function escHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function hexToRgb(hex) {
  const clean = String(hex).replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const n = parseInt(full, 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

function hashHue(text) {
  let hash = 0;
  for (let i = 0; i < String(text).length; i++) hash = (hash * 31 + String(text).charCodeAt(i)) % 360;
  return hash;
}

const PALETTES = {
  bleu: ['#3b82f6', '#22d3ee'],
  violet: ['#8b5cf6', '#ec4899'],
  vert: ['#10b981', '#84cc16'],
  rouge: ['#ef4444', '#f97316'],
  orange: ['#f97316', '#facc15'],
  jaune: ['#eab308', '#f59e0b'],
  rose: ['#ec4899', '#f472b6'],
  cyan: ['#06b6d4', '#3b82f6'],
  turquoise: ['#14b8a6', '#22d3ee'],
  noir: ['#64748b', '#94a3b8'],
  or: ['#d4af37', '#f59e0b'],
};

function paletteFor(name) {
  const hue = hashHue(name);
  const palette = Object.values(PALETTES)[hue % Object.keys(PALETTES).length];
  return { accent: palette[0], accent2: palette[1] };
}

const fileBlock = (filePath, content) => `<file path="${filePath}">\n${String(content).trim()}\n</file>`;

/* ── Feuille de style commune ────────────────────────────────────────────── */

function baseCss(accent, accent2) {
  return `:root{
  --bg:#0a0c16;
  --panel:#111527;
  --panel-2:#161c33;
  --line:rgba(255,255,255,.09);
  --text:#eef1fb;
  --muted:#98a3c2;
  --accent:${accent};
  --accent-2:${accent2};
  --glow:${hexToRgb(accent)};
  --radius:16px;
  --shadow:0 24px 60px rgba(0,0,0,.45);
}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{
  margin:0;
  min-height:100vh;
  font-family:"Inter",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  color:var(--text);
  background:
    radial-gradient(900px 480px at 12% -10%, rgba(var(--glow),.28), transparent 65%),
    radial-gradient(700px 420px at 100% 0%, rgba(var(--glow),.14), transparent 60%),
    var(--bg);
  -webkit-font-smoothing:antialiased;
  line-height:1.6;
}
a{color:inherit;text-decoration:none}
h1,h2,h3{line-height:1.15;margin:0 0 .5em}
p{margin:0 0 1em;color:var(--muted)}
.wrap{width:min(1120px,92vw);margin:0 auto}
.badge{display:inline-flex;align-items:center;gap:8px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--accent-2);background:rgba(var(--glow),.14);border:1px solid rgba(var(--glow),.35);padding:7px 13px;border-radius:999px}
.btn{display:inline-flex;align-items:center;gap:9px;padding:12px 20px;border-radius:12px;border:1px solid transparent;font-weight:600;font-size:15px;cursor:pointer;transition:transform .18s ease,box-shadow .18s ease,background .18s ease}
.btn:hover{transform:translateY(-2px)}
.btn.primary{background:linear-gradient(135deg,var(--accent),var(--accent-2));color:#08090f;box-shadow:0 12px 30px rgba(var(--glow),.35)}
.btn.ghost{background:rgba(255,255,255,.04);border-color:var(--line);color:var(--text)}
.card{background:linear-gradient(180deg,rgba(255,255,255,.045),rgba(255,255,255,.015));border:1px solid var(--line);border-radius:var(--radius);padding:22px}
input,select,textarea{font:inherit;color:var(--text);background:rgba(255,255,255,.05);border:1px solid var(--line);border-radius:11px;padding:12px 14px;outline:none;width:100%}
input:focus,textarea:focus,select:focus{border-color:var(--accent);box-shadow:0 0 0 3px rgba(var(--glow),.18)}
::selection{background:rgba(var(--glow),.35)}
.fade-in{opacity:0;transform:translateY(16px);transition:opacity .6s ease,transform .6s ease}
.fade-in.visible{opacity:1;transform:none}
`;
}

/* ── Modèles de projets ──────────────────────────────────────────────────── */

function tplLanding(name) {
  const safe = escHtml(name);
  const { accent, accent2 } = paletteFor(name);
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${safe}</title>
  <meta name="description" content="${safe} — modern, fast, polished product." />
  <link rel="stylesheet" href="styles.css" />
</head>
<body>
  <header class="nav">
    <a class="brand" href="#top"><span class="spark"></span>${safe}</a>
    <nav class="nav-links" id="navLinks">
      <a href="#fonctionnalites">Features</a>
      <a href="#apercu">Preview</a>
      <a href="#contact">Contact</a>
    </nav>
    <button class="btn ghost small" id="themeBtn" aria-label="Change theme">🌙</button>
    <button class="menu-btn" id="menuBtn" aria-label="Open menu">☰</button>
  </header>

  <main>
    <section class="hero wrap" id="top">
      <div class="hero-copy">
        <span class="badge">New · generated with Supernova AI</span>
        <h1>Build <span class="grad">faster</span><br />than your imagination.</h1>
        <p>${safe} brings together what matters: a clear interface, real performance, and an experience designed to convert.</p>
        <div class="cta-row">
          <a class="btn primary" href="#contact">Get started</a>
          <a class="btn ghost" href="#fonctionnalites">See details</a>
        </div>
        <ul class="stats">
          <li><strong>100%</strong><span>responsive</span></li>
          <li><strong>0</strong><span>dependencies</span></li>
          <li><strong>&lt;1s</strong><span>to load</span></li>
        </ul>
      </div>
      <div class="hero-art" aria-hidden="true">
        <div class="orb"></div>
        <div class="ring"></div>
        <div class="float-card">
          <div class="dot-row"><span></span><span></span><span></span></div>
          <p class="mini">Supernova UI</p>
          <div class="bar"><i style="width:82%"></i></div>
          <div class="bar"><i style="width:64%"></i></div>
          <div class="bar"><i style="width:91%"></i></div>
        </div>
      </div>
    </section>

    <section class="wrap section" id="fonctionnalites">
      <h2 class="section-title fade-in">Everything you need, nothing more.</h2>
      <div class="grid">
        <article class="card fade-in"><span class="ico">⚡</span><h3>Fast by default</h3><p>No framework, no unnecessary weight: the site loads instantly.</p></article>
        <article class="card fade-in"><span class="ico">🎨</span><h3>Polished design</h3><p>Typography, spacing, and animations designed for a professional result.</p></article>
        <article class="card fade-in"><span class="ico">📱</span><h3>Mobile first</h3><p>A layout that adapts effortlessly from phone to large screen.</p></article>
        <article class="card fade-in"><span class="ico">🔒</span><h3>Zero trackers</h3><p>No third-party cookies, no hidden analytics. Just readable code.</p></article>
      </div>
    </section>

    <section class="wrap section split" id="apercu">
      <div class="fade-in">
        <h2>An honest preview.</h2>
        <p>This project was generated by Supernova AI: every file is editable, versionable, and exportable as a ZIP in one click.</p>
        <ul class="checklist">
          <li>Accessible semantic HTML</li>
          <li>CSS moderne (variables, grid, clamp)</li>
          <li>Dependency-free JavaScript</li>
        </ul>
      </div>
      <div class="window fade-in" aria-hidden="true">
        <div class="window-bar"><span></span><span></span><span></span></div>
        <div class="window-body">
          <div class="skel big"></div>
          <div class="skel"></div>
          <div class="skel short"></div>
          <div class="pill-row"><em></em><em></em><em></em></div>
        </div>
      </div>
    </section>

    <section class="wrap section" id="contact">
      <div class="card contact fade-in">
        <div>
          <h2>Let's talk.</h2>
          <p>Leave your email: this demo form validates input on the client side.</p>
        </div>
        <form id="contactForm" novalidate>
          <label for="email">Email</label>
          <input id="email" name="email" type="email" placeholder="you@example.com" required />
          <label for="message">Message</label>
          <textarea id="message" name="message" rows="3" placeholder="Your idea in one sentence…"></textarea>
          <button class="btn primary" type="submit">Send</button>
          <p class="form-note" id="formNote" role="status"></p>
        </form>
      </div>
    </section>
  </main>

  <footer class="footer wrap">
    <p>© <span id="year"></span> ${safe} · built with Supernova AI</p>
    <a href="#top">Back to top ↑</a>
  </footer>
  <script src="app.js"></script>
</body>
</html>`;

  const css = `${baseCss(accent, accent2)}
/* — Navigation — */
.nav{position:sticky;top:0;z-index:20;display:flex;align-items:center;gap:18px;padding:16px 4vw;backdrop-filter:blur(14px);background:rgba(10,12,22,.72);border-bottom:1px solid var(--line)}
.brand{display:flex;align-items:center;gap:10px;font-weight:800;letter-spacing:-.02em;font-size:18px}
.spark{width:12px;height:12px;border-radius:50%;background:linear-gradient(135deg,var(--accent),var(--accent-2));box-shadow:0 0 18px rgba(var(--glow),.9)}
.nav-links{display:flex;gap:22px;margin-left:auto;font-size:14.5px;color:var(--muted)}
.nav-links a:hover{color:var(--text)}
.btn.small{padding:8px 12px;font-size:14px}
.menu-btn{display:none;background:none;border:1px solid var(--line);border-radius:10px;color:var(--text);font-size:18px;padding:4px 10px;cursor:pointer}

/* — Hero — */
.hero{display:grid;grid-template-columns:1.05fr .95fr;gap:44px;align-items:center;padding:72px 0 48px}
.hero h1{font-size:clamp(2.4rem,5.2vw,4.1rem);letter-spacing:-.035em;margin-top:20px}
.grad{background:linear-gradient(120deg,var(--accent),var(--accent-2));-webkit-background-clip:text;background-clip:text;color:transparent}
.hero p{font-size:17.5px;max-width:52ch}
.cta-row{display:flex;gap:12px;margin:26px 0 30px;flex-wrap:wrap}
.stats{display:flex;gap:28px;list-style:none;padding:0;margin:0}
.stats li{display:flex;flex-direction:column}
.stats strong{font-size:22px;letter-spacing:-.02em}
.stats span{font-size:12.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.08em}

/* — Hero art — */
.hero-art{position:relative;height:390px;display:grid;place-items:center}
.orb{position:absolute;width:280px;height:280px;border-radius:50%;background:radial-gradient(circle at 35% 30%,var(--accent),var(--accent-2) 55%,transparent 72%);filter:blur(6px);opacity:.85;animation:pulse 6s ease-in-out infinite}
.ring{position:absolute;width:340px;height:340px;border-radius:50%;border:1px dashed rgba(255,255,255,.22);animation:spin 26s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.05)}}
.float-card{position:relative;z-index:2;width:min(300px,80%);background:rgba(12,16,30,.86);border:1px solid var(--line);border-radius:18px;padding:18px;box-shadow:var(--shadow);backdrop-filter:blur(8px);animation:float 7s ease-in-out infinite}
@keyframes float{0%,100%{transform:translateY(-6px)}50%{transform:translateY(10px)}}
.dot-row{display:flex;gap:6px;margin-bottom:14px}
.dot-row span{width:9px;height:9px;border-radius:50%;background:rgba(255,255,255,.22)}
.float-card .mini{margin:0 0 12px;color:var(--text);font-weight:600;font-size:13px;letter-spacing:.06em;text-transform:uppercase}
.bar{height:8px;border-radius:99px;background:rgba(255,255,255,.08);margin-bottom:10px;overflow:hidden}
.bar i{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,var(--accent),var(--accent-2))}

/* — Sections — */
.section{padding:64px 0}
.section-title{font-size:clamp(1.7rem,3.4vw,2.5rem);letter-spacing:-.03em;max-width:22ch}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;margin-top:28px}
.card h3{font-size:17px}
.card p{margin:0;font-size:14.5px}
.ico{display:grid;place-items:center;width:40px;height:40px;border-radius:11px;background:rgba(var(--glow),.16);font-size:19px;margin-bottom:14px}
.split{display:grid;grid-template-columns:1fr 1fr;gap:40px;align-items:center}
.checklist{list-style:none;padding:0;margin:18px 0 0;display:grid;gap:10px}
.checklist li{position:relative;padding-left:28px;color:var(--muted)}
.checklist li::before{content:"✓";position:absolute;left:0;top:0;color:var(--accent-2);font-weight:800}
.window{border:1px solid var(--line);border-radius:16px;overflow:hidden;background:var(--panel);box-shadow:var(--shadow)}
.window-bar{display:flex;gap:6px;padding:12px;border-bottom:1px solid var(--line)}
.window-bar span{width:10px;height:10px;border-radius:50%;background:rgba(255,255,255,.16)}
.window-body{padding:22px}
.skel{height:12px;border-radius:8px;background:rgba(255,255,255,.08);margin-bottom:12px}
.skel.big{height:34px;width:70%;background:linear-gradient(90deg,rgba(var(--glow),.5),rgba(var(--glow),.14))}
.skel.short{width:52%}
.pill-row{display:flex;gap:8px;margin-top:18px}
.pill-row em{height:26px;flex:1;border-radius:8px;background:rgba(255,255,255,.06)}

/* — Contact — */
.contact{display:grid;grid-template-columns:1fr 1fr;gap:32px}
.contact label{display:block;font-size:13px;color:var(--muted);margin:12px 0 6px}
.contact .btn{width:100%;justify-content:center;margin-top:14px}
.form-note{font-size:13.5px;margin:12px 0 0;min-height:20px;color:var(--accent-2)}

/* — Footer — */
.footer{display:flex;justify-content:space-between;gap:16px;padding:28px 0 40px;border-top:1px solid var(--line);font-size:13.5px;flex-wrap:wrap}
.footer p{margin:0}
.footer a{color:var(--muted)}

/* — Thème clair — */
body.light{--bg:#f6f7fb;--panel:#fff;--panel-2:#eef1f8;--line:rgba(15,23,42,.1);--text:#0f172a;--muted:#5a6478;--shadow:0 20px 50px rgba(15,23,42,.12)}
body.light .nav{background:rgba(246,247,251,.82)}
body.light .float-card{background:rgba(255,255,255,.92)}
body.light .window-body .skel{background:rgba(15,23,42,.08)}
body.light .hero-art .ring{border-color:rgba(15,23,42,.18)}

@media (max-width:900px){
  .hero{grid-template-columns:1fr;padding-top:48px}
  .hero-art{height:300px;order:-1}
  .split,.contact{grid-template-columns:1fr}
}
@media (max-width:720px){
  .nav-links{position:absolute;top:64px;right:4vw;flex-direction:column;background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:16px;gap:14px;display:none;box-shadow:var(--shadow)}
  .nav-links.open{display:flex}
  .menu-btn{display:block;margin-left:auto}
  .nav .btn.small{margin-left:0}
  .stats{gap:18px}
}
`;

  const js = `// ${name} — interactions (no dependencies)
(function () {
  var year = document.getElementById('year');
  if (year) year.textContent = new Date().getFullYear();

  var menuBtn = document.getElementById('menuBtn');
  var navLinks = document.getElementById('navLinks');
  if (menuBtn && navLinks) {
    menuBtn.addEventListener('click', function () {
      navLinks.classList.toggle('open');
    });
    navLinks.addEventListener('click', function (event) {
      if (event.target.tagName === 'A') navLinks.classList.remove('open');
    });
  }

  var themeBtn = document.getElementById('themeBtn');
  var stored = localStorage.getItem('theme');
  if (stored === 'light') document.body.classList.add('light');
  function syncTheme() {
    if (themeBtn) themeBtn.textContent = document.body.classList.contains('light') ? '☀️' : '🌙';
  }
  syncTheme();
  if (themeBtn) {
    themeBtn.addEventListener('click', function () {
      document.body.classList.toggle('light');
      localStorage.setItem('theme', document.body.classList.contains('light') ? 'light' : 'dark');
      syncTheme();
    });
  }

  var observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) entry.target.classList.add('visible');
    });
  }, { threshold: 0.18 });
  document.querySelectorAll('.fade-in').forEach(function (el) { observer.observe(el); });

  var form = document.getElementById('contactForm');
  if (form) {
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var email = document.getElementById('email');
      var note = document.getElementById('formNote');
      var valid = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}$/.test(email.value.trim());
      if (!valid) {
        note.textContent = 'Please enter a valid email.';
        note.style.color = '#f87171';
        email.focus();
        return;
      }
      note.style.color = '';
      note.textContent = 'Thanks! Message saved locally (serverless demo).';
      form.reset();
    });
  }
})();
`;

  return {
    label: 'a showcase site / landing page',
    files: { 'index.html': html, 'styles.css': css, 'app.js': js },
    notes: [
      'Responsive home page with animated hero, feature grid, and validated form.',
      'Light/dark theme remembered in the browser.',
      'Scroll reveal animations (IntersectionObserver).',
    ],
  };
}

function tplTodo(name) {
  const safe = escHtml(name);
  const { accent, accent2 } = paletteFor(name);
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${safe}</title>
  <link rel="stylesheet" href="styles.css" />
</head>
<body>
  <main class="app">
    <header>
      <h1>${safe}</h1>
      <p class="sub" id="sub">0 tasks</p>
    </header>

    <form id="form" class="composer">
      <input id="input" type="text" placeholder="Add a task…" autocomplete="off" maxlength="160" />
      <button class="btn primary" type="submit">Add</button>
    </form>

    <div class="toolbar">
      <div class="filters" role="tablist">
        <button class="chip active" data-filter="all">All</button>
        <button class="chip" data-filter="active">To do</button>
        <button class="chip" data-filter="done">Done</button>
      </div>
      <button class="chip danger" id="clear">Clear all</button>
    </div>

    <ul class="list" id="list"></ul>
    <p class="empty" id="empty">No tasks yet. Add your first one ✨</p>
    <div class="progress"><div class="progress-bar" id="progress"></div></div>
  </main>
  <script src="app.js"></script>
</body>
</html>`;

  const css = `${baseCss(accent, accent2)}
body{display:grid;place-items:start center;padding:48px 16px}
.app{width:min(620px,100%)}
h1{font-size:clamp(1.7rem,4vw,2.3rem);letter-spacing:-.03em;margin-bottom:4px}
.sub{font-size:14px;margin:0 0 26px}
.composer{display:flex;gap:10px;margin-bottom:16px}
.composer input{flex:1}
.composer .btn{white-space:nowrap}
.toolbar{display:flex;justify-content:space-between;gap:10px;align-items:center;margin-bottom:14px;flex-wrap:wrap}
.filters{display:flex;gap:8px}
.chip{border:1px solid var(--line);background:rgba(255,255,255,.04);color:var(--muted);border-radius:999px;padding:7px 14px;font-size:13px;cursor:pointer;transition:.18s}
.chip:hover{color:var(--text)}
.chip.active{background:rgba(var(--glow),.18);border-color:rgba(var(--glow),.5);color:var(--text)}
.chip.danger:hover{border-color:#f87171;color:#f87171}
.list{list-style:none;padding:0;margin:0;display:grid;gap:10px}
.item{display:flex;align-items:center;gap:12px;background:var(--panel);border:1px solid var(--line);border-radius:13px;padding:14px 16px;animation:pop .22s ease}
@keyframes pop{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
.item.done .label{text-decoration:line-through;color:var(--muted)}
.item input{width:18px;height:18px;accent-color:var(--accent);cursor:pointer;flex:none}
.label{flex:1;word-break:break-word;font-size:15px}
.del{background:none;border:none;color:var(--muted);font-size:17px;cursor:pointer;padding:4px 6px;border-radius:8px}
.del:hover{color:#f87171;background:rgba(248,113,113,.12)}
.empty{text-align:center;color:var(--muted);font-size:14px;padding:26px 0}
.progress{height:6px;border-radius:99px;background:rgba(255,255,255,.07);margin-top:22px;overflow:hidden}
.progress-bar{height:100%;width:0;border-radius:99px;background:linear-gradient(90deg,var(--accent),var(--accent-2));transition:width .3s ease}
`;

  const js = `// ${name} — task logic with local save
(function () {
  var STORAGE_KEY = '${normalize(name).replace(/[^a-z0-9]+/g, '-')}-todos';
  var state = { tasks: [], filter: 'all' };
  try { state.tasks = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch (e) { state.tasks = []; }

  var list = document.getElementById('list');
  var empty = document.getElementById('empty');
  var sub = document.getElementById('sub');
  var progress = document.getElementById('progress');
  var input = document.getElementById('input');

  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.tasks));
  }

  function visible() {
    if (state.filter === 'active') return state.tasks.filter(function (t) { return !t.done; });
    if (state.filter === 'done') return state.tasks.filter(function (t) { return t.done; });
    return state.tasks;
  }

  function render() {
    var items = visible();
    list.innerHTML = '';
    items.forEach(function (task) {
      var li = document.createElement('li');
      li.className = 'item' + (task.done ? ' done' : '');

      var box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = task.done;
      box.addEventListener('change', function () {
        task.done = box.checked;
        save();
        render();
      });

      var label = document.createElement('span');
      label.className = 'label';
      label.textContent = task.text;

      var del = document.createElement('button');
      del.className = 'del';
      del.textContent = '✕';
      del.setAttribute('aria-label', 'Delete task');
      del.addEventListener('click', function () {
        state.tasks = state.tasks.filter(function (t) { return t.id !== task.id; });
        save();
        render();
      });

      li.appendChild(box);
      li.appendChild(label);
      li.appendChild(del);
      list.appendChild(li);
    });

    empty.style.display = items.length ? 'none' : 'block';
    var left = state.tasks.filter(function (t) { return !t.done; }).length;
    sub.textContent = state.tasks.length
      ? state.tasks.length + ' task' + (state.tasks.length > 1 ? 's' : '') + ' · ' + left + ' remaining'
      : '0 tasks';
    var ratio = state.tasks.length ? Math.round(((state.tasks.length - left) / state.tasks.length) * 100) : 0;
    progress.style.width = ratio + '%';
  }

  document.getElementById('form').addEventListener('submit', function (event) {
    event.preventDefault();
    var text = input.value.trim();
    if (!text) return;
    state.tasks.unshift({ id: Date.now().toString(36), text: text, done: false });
    input.value = '';
    save();
    render();
  });

  document.querySelectorAll('[data-filter]').forEach(function (button) {
    button.addEventListener('click', function () {
      state.filter = button.dataset.filter;
      document.querySelectorAll('[data-filter]').forEach(function (other) {
        other.classList.toggle('active', other === button);
      });
      render();
    });
  });

  document.getElementById('clear').addEventListener('click', function () {
    if (!state.tasks.length) return;
    if (confirm('Clear all tasks?')) {
      state.tasks = [];
      save();
      render();
    }
  });

  render();
})();
`;

  return {
    label: 'a task app (to-do)',
    files: { 'index.html': html, 'styles.css': css, 'app.js': js },
    notes: [
      'Add, complete, delete, and filter tasks (all / to do / done).',
      'Automatic save in browser localStorage.',
      'Progress bar and counters update live.',
    ],
  };
}

function tplCalculator(name) {
  const safe = escHtml(name);
  const { accent, accent2 } = paletteFor(name);
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${safe}</title>
  <link rel="stylesheet" href="styles.css" />
</head>
<body>
  <main class="calc">
    <header><h1>${safe}</h1><p>Keyboard enabled: digits, + − × ÷, Enter, Escape.</p></header>
    <div class="screen">
      <div class="history" id="history"></div>
      <output class="display" id="display">0</output>
    </div>
    <div class="keys">
      <button class="key fn" data-action="clear">AC</button>
      <button class="key fn" data-action="sign">±</button>
      <button class="key fn" data-action="percent">%</button>
      <button class="key op" data-op="/">÷</button>
      <button class="key" data-digit="7">7</button>
      <button class="key" data-digit="8">8</button>
      <button class="key" data-digit="9">9</button>
      <button class="key op" data-op="*">×</button>
      <button class="key" data-digit="4">4</button>
      <button class="key" data-digit="5">5</button>
      <button class="key" data-digit="6">6</button>
      <button class="key op" data-op="-">−</button>
      <button class="key" data-digit="1">1</button>
      <button class="key" data-digit="2">2</button>
      <button class="key" data-digit="3">3</button>
      <button class="key op" data-op="+">+</button>
      <button class="key wide" data-digit="0">0</button>
      <button class="key" data-action="dot">.</button>
      <button class="key equals" data-action="equals">=</button>
    </div>
  </main>
  <script src="app.js"></script>
</body>
</html>`;

  const css = `${baseCss(accent, accent2)}
body{display:grid;place-items:center;padding:32px 16px}
.calc{width:min(380px,100%)}
header h1{font-size:1.4rem;letter-spacing:-.02em;margin-bottom:2px}
header p{font-size:12.5px;margin:0 0 18px}
.screen{background:linear-gradient(180deg,rgba(255,255,255,.06),rgba(255,255,255,.02));border:1px solid var(--line);border-radius:16px;padding:16px 18px;margin-bottom:14px;box-shadow:var(--shadow);overflow:hidden}
.history{min-height:18px;text-align:right;color:var(--muted);font-size:13px;font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.display{display:block;text-align:right;font-size:clamp(1.9rem,7vw,2.6rem);font-weight:700;letter-spacing:-.03em;font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:4px}
.keys{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
.key{border:1px solid var(--line);background:rgba(255,255,255,.05);color:var(--text);border-radius:13px;padding:16px 0;font-size:18px;font-weight:600;cursor:pointer;transition:transform .12s ease,background .18s ease}
.key:hover{background:rgba(255,255,255,.1)}
.key:active{transform:scale(.96)}
.key.fn{color:var(--accent-2);background:rgba(var(--glow),.1)}
.key.op{color:var(--accent-2)}
.key.wide{grid-column:span 2}
.key.equals{background:linear-gradient(135deg,var(--accent),var(--accent-2));color:#08090f;border:none;box-shadow:0 10px 24px rgba(var(--glow),.32)}
`;

  const js = `// ${name} — calculatrice (sans eval)
(function () {
  var display = document.getElementById('display');
  var historyEl = document.getElementById('history');
  var current = '0';
  var previous = null;
  var operator = null;
  var fresh = true;

  function show(value) {
    var text = String(value);
    if (text.length > 14) text = Number(value).toPrecision(10).replace(/\\.?0+$/, '');
    display.textContent = text;
  }

  function reset() {
    current = '0';
    previous = null;
    operator = null;
    fresh = true;
    historyEl.textContent = '';
    show(current);
  }

  function compute(a, b, op) {
    var x = parseFloat(a);
    var y = parseFloat(b);
    if (op === '+') return x + y;
    if (op === '-') return x - y;
    if (op === '*') return x * y;
    if (op === '/') return y === 0 ? NaN : x / y;
    return y;
  }

  document.querySelectorAll('[data-digit]').forEach(function (button) {
    button.addEventListener('click', function () {
      var digit = button.dataset.digit;
      if (fresh) { current = digit === '.' ? '0.' : digit; fresh = false; }
      else if (digit === '.' && current.indexOf('.') === -1) current += '.';
      else if (digit !== '.') current = current === '0' ? digit : current + digit;
      show(current);
    });
  });

  document.querySelectorAll('[data-op]').forEach(function (button) {
    button.addEventListener('click', function () {
      if (operator && !fresh) {
        current = String(compute(previous, current, operator));
        show(current);
      }
      previous = current;
      operator = button.dataset.op;
      historyEl.textContent = previous + ' ' + button.textContent;
      fresh = true;
    });
  });

  document.querySelector('[data-action="equals"]').addEventListener('click', function () {
    if (operator === null) return;
    var result = compute(previous, current, operator);
    historyEl.textContent = previous + ' ' + operator.replace('*', '×').replace('/', '÷') + ' ' + current + ' =';
    current = isNaN(result) ? 'Error' : String(Math.round(result * 1e10) / 1e10);
    operator = null;
    fresh = true;
    show(current);
  });

  document.querySelector('[data-action="clear"]').addEventListener('click', reset);
  document.querySelector('[data-action="dot"]').addEventListener('click', function () {
    if (fresh) { current = '0.'; fresh = false; }
    else if (current.indexOf('.') === -1) current += '.';
    show(current);
  });
  document.querySelector('[data-action="sign"]').addEventListener('click', function () {
    current = String(parseFloat(current) * -1);
    show(current);
  });
  document.querySelector('[data-action="percent"]').addEventListener('click', function () {
    current = String(parseFloat(current) / 100);
    show(current);
  });

  window.addEventListener('keydown', function (event) {
    if (/^[0-9]$/.test(event.key)) {
      document.querySelector('[data-digit="' + event.key + '"]').click();
    } else if (['+', '-', '*', '/'].indexOf(event.key) !== -1) {
      document.querySelector('[data-op="' + event.key + '"]').click();
    } else if (event.key === 'Enter' || event.key === '=') {
      document.querySelector('[data-action="equals"]').click();
    } else if (event.key === 'Escape') {
      reset();
    } else if (event.key === '.') {
      document.querySelector('[data-action="dot"]').click();
    }
  });

  reset();
})();
`;

  return {
    label: 'an interactive calculator',
    files: { 'index.html': html, 'styles.css': css, 'app.js': js },
    notes: [
      'Chained calculations, sign change, percentage, and divide-by-zero handling.',
      'Full keyboard support (digits, operators, Enter, Escape).',
      'No eval: explicit operations.',
    ],
  };
}

function tplSnake(name) {
  const safe = escHtml(name);
  const { accent, accent2 } = paletteFor(name);
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
  <title>${safe}</title>
  <link rel="stylesheet" href="styles.css" />
</head>
<body>
  <main class="game-shell">
    <header>
      <h1>${safe}</h1>
      <p>Arrow keys / WASD to play · Space to pause</p>
    </header>
    <div class="hud">
      <div><span>Score</span><strong id="score">0</strong></div>
      <div><span>Best</span><strong id="best">0</strong></div>
      <button class="btn primary small" id="restart">Restart</button>
    </div>
    <div class="canvas-wrap">
      <canvas id="game" width="400" height="400" aria-label="Snake game"></canvas>
      <div class="overlay" id="overlay">
        <h2 id="overlayTitle">Ready?</h2>
        <p id="overlayText">Press an arrow key to start.</p>
      </div>
    </div>
    <div class="dpad" aria-hidden="true">
      <button data-dir="up">▲</button>
      <div>
        <button data-dir="left">◀</button>
        <button data-dir="down">▼</button>
        <button data-dir="right">▶</button>
      </div>
    </div>
  </main>
  <script src="app.js"></script>
</body>
</html>`;

  const css = `${baseCss(accent, accent2)}
body{display:grid;place-items:center;padding:28px 16px}
.game-shell{width:min(460px,100%)}
header h1{font-size:1.5rem;margin-bottom:2px;letter-spacing:-.02em}
header p{font-size:12.5px;margin:0 0 18px}
.hud{display:flex;align-items:center;gap:22px;margin-bottom:12px}
.hud div{display:flex;flex-direction:column}
.hud span{font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
.hud strong{font-size:20px;font-variant-numeric:tabular-nums}
.hud .btn{margin-left:auto}
.btn.small{padding:9px 15px;font-size:13.5px}
.canvas-wrap{position:relative;border-radius:18px;overflow:hidden;border:1px solid var(--line);box-shadow:var(--shadow);background:#070a14}
canvas{display:block;width:100%;height:auto;touch-action:none}
.overlay{position:absolute;inset:0;display:grid;place-content:center;text-align:center;background:rgba(6,8,16,.78);backdrop-filter:blur(3px);padding:20px;transition:opacity .25s}
.overlay.hidden{opacity:0;pointer-events:none}
.overlay h2{font-size:1.4rem;margin-bottom:6px}
.overlay p{margin:0;font-size:14px}
.dpad{display:none;margin-top:16px;justify-content:center;gap:8px;flex-direction:column;align-items:center}
.dpad div{display:flex;gap:8px}
.dpad button{width:58px;height:48px;border-radius:12px;border:1px solid var(--line);background:rgba(255,255,255,.06);color:var(--text);font-size:16px}
@media (max-width:720px){.dpad{display:flex}}
`;

  const js = `// ${name} — canvas snake
(function () {
  var canvas = document.getElementById('game');
  var ctx = canvas.getContext('2d');
  var scoreEl = document.getElementById('score');
  var bestEl = document.getElementById('best');
  var overlay = document.getElementById('overlay');
  var overlayTitle = document.getElementById('overlayTitle');
  var overlayText = document.getElementById('overlayText');
  var CELL = 20;
  var COLS = canvas.width / CELL;
  var ROWS = canvas.height / CELL;
  var ACCENT = '${accent}';
  var ACCENT2 = '${accent2}';

  var snake, dir, nextDir, food, score, best, running, timer, speed;

  best = Number(localStorage.getItem('snake-best') || 0);
  bestEl.textContent = best;

  function reset() {
    snake = [{ x: 9, y: 10 }, { x: 8, y: 10 }, { x: 7, y: 10 }];
    dir = { x: 1, y: 0 };
    nextDir = dir;
    score = 0;
    speed = 130;
    running = false;
    placeFood();
    scoreEl.textContent = '0';
    draw();
    overlay.classList.remove('hidden');
    overlayTitle.textContent = 'Ready?';
    overlayText.textContent = 'Press an arrow key to start.';
  }

  function placeFood() {
    do {
      food = { x: Math.floor(Math.random() * COLS), y: Math.floor(Math.random() * ROWS) };
    } while (snake.some(function (part) { return part.x === food.x && part.y === food.y; }));
  }

  function step() {
    if (!running) return;
    if (nextDir.x !== -dir.x || nextDir.y !== -dir.y) dir = nextDir;
    var head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };

    if (head.x < 0 || head.y < 0 || head.x >= COLS || head.y >= ROWS) return gameOver();
    if (snake.some(function (part) { return part.x === head.x && part.y === head.y; })) return gameOver();

    snake.unshift(head);
    if (head.x === food.x && head.y === food.y) {
      score += 10;
      scoreEl.textContent = score;
      if (score > best) {
        best = score;
        bestEl.textContent = best;
        localStorage.setItem('snake-best', String(best));
      }
      placeFood();
      speed = Math.max(60, speed - 4);
      clearInterval(timer);
      timer = setInterval(step, speed);
    } else {
      snake.pop();
    }
    draw();
  }

  function draw() {
    ctx.fillStyle = '#070a14';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = 'rgba(255,255,255,.04)';
    for (var i = 1; i < COLS; i++) {
      ctx.beginPath();
      ctx.moveTo(i * CELL, 0);
      ctx.lineTo(i * CELL, canvas.height);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i * CELL);
      ctx.lineTo(canvas.width, i * CELL);
      ctx.stroke();
    }

    var glow = ctx.createRadialGradient(food.x * CELL + 10, food.y * CELL + 10, 2, food.x * CELL + 10, food.y * CELL + 10, 14);
    glow.addColorStop(0, ACCENT2);
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(food.x * CELL + 10, food.y * CELL + 10, 12, 0, Math.PI * 2);
    ctx.fill();

    snake.forEach(function (part, index) {
      var ratio = 1 - index / (snake.length + 4);
      ctx.fillStyle = index === 0 ? ACCENT2 : ACCENT;
      ctx.globalAlpha = Math.max(0.35, ratio);
      ctx.beginPath();
      ctx.roundRect(part.x * CELL + 1.5, part.y * CELL + 1.5, CELL - 3, CELL - 3, 6);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
  }

  function gameOver() {
    running = false;
    clearInterval(timer);
    overlay.classList.remove('hidden');
    overlayTitle.textContent = 'Game over!';
    overlayText.textContent = 'Score: ' + score + ' · Press an arrow to play again.';
  }

  function start() {
    if (running) return;
    running = true;
    overlay.classList.add('hidden');
    clearInterval(timer);
    timer = setInterval(step, speed);
  }

  function turn(x, y) {
    nextDir = { x: x, y: y };
    if (!running && snake.length) {
      if (overlayTitle.textContent === 'Game over!') return reset(), start();
      start();
    }
  }

  window.addEventListener('keydown', function (event) {
    var key = event.key.toLowerCase();
    if (key === 'arrowup' || key === 'z' || key === 'w') { event.preventDefault(); turn(0, -1); }
    else if (key === 'arrowdown' || key === 's') { event.preventDefault(); turn(0, 1); }
    else if (key === 'arrowleft' || key === 'q' || key === 'a') { event.preventDefault(); turn(-1, 0); }
    else if (key === 'arrowright' || key === 'd') { event.preventDefault(); turn(1, 0); }
    else if (key === ' ') {
      event.preventDefault();
      if (running) { running = false; clearInterval(timer); overlay.classList.remove('hidden'); overlayTitle.textContent = 'Paused'; overlayText.textContent = 'Press Space to resume.'; }
      else start();
    }
  });

  document.querySelectorAll('[data-dir]').forEach(function (button) {
    button.addEventListener('click', function () {
      var map = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
      var dirs = map[button.dataset.dir];
      turn(dirs[0], dirs[1]);
    });
  });

  var touchStart = null;
  canvas.addEventListener('touchstart', function (event) {
    touchStart = event.touches[0];
  }, { passive: true });
  canvas.addEventListener('touchend', function (event) {
    if (!touchStart) return;
    var dx = event.changedTouches[0].clientX - touchStart.clientX;
    var dy = event.changedTouches[0].clientY - touchStart.clientY;
    if (Math.abs(dx) > Math.abs(dy)) turn(dx > 0 ? 1 : -1, 0);
    else turn(0, dy > 0 ? 1 : -1);
    touchStart = null;
  }, { passive: true });

  document.getElementById('restart').addEventListener('click', function () { reset(); start(); });

  reset();
})();
`;

  return {
    label: 'a game (snake)',
    files: { 'index.html': html, 'styles.css': css, 'app.js': js },
    notes: [
      'Complete canvas game: collisions, score, saved high score, progressive acceleration.',
      'Keyboard controls (arrows / WASD) and touch (swipe + mobile D-pad).',
      'Pause with Space and instant restart.',
    ],
  };
}

function tplWeather(name) {
  const safe = escHtml(name);
  const { accent, accent2 } = paletteFor(name);
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${safe}</title>
  <link rel="stylesheet" href="styles.css" />
</head>
<body>
  <main class="app">
    <header>
      <h1>${safe}</h1>
      <p>Real-time weather — Open-Meteo data, no API key.</p>
      <form id="search">
        <input id="city" type="search" placeholder="City (e.g. Paris, Montreal, Dakar…)" autocomplete="off" />
        <button class="btn primary" type="submit">Search</button>
      </form>
    </header>

    <section class="current card" id="current" hidden>
      <div class="place">
        <h2 id="placeName">—</h2>
        <p id="placeMeta"></p>
      </div>
      <div class="temp"><span id="temp">—</span><sup>°C</sup></div>
      <div class="details">
        <div><span>Feels like</span><strong id="feels">—</strong></div>
        <div><span>Humidity</span><strong id="humidity">—</strong></div>
        <div><span>Wind</span><strong id="wind">—</strong></div>
        <div><span>Condition</span><strong id="condition">—</strong></div>
      </div>
    </section>

    <section class="forecast" id="forecast"></section>
    <p class="status" id="status">Enter a city to see the weather.</p>
  </main>
  <script src="app.js"></script>
</body>
</html>`;

  const css = `${baseCss(accent, accent2)}
body{display:grid;place-items:start center;padding:40px 16px}
.app{width:min(760px,100%)}
h1{font-size:clamp(1.6rem,4vw,2.2rem);margin-bottom:4px;letter-spacing:-.03em}
header p{font-size:14px;margin:0 0 20px}
#search{display:flex;gap:10px;margin-bottom:22px}
#search input{flex:1}
.current{display:grid;grid-template-columns:1fr auto;gap:18px;align-items:center;margin-bottom:18px}
.place h2{margin:0 0 2px;font-size:1.5rem;letter-spacing:-.02em}
.place p{margin:0;font-size:13px}
.temp{font-size:clamp(2.6rem,9vw,3.6rem);font-weight:700;letter-spacing:-.05em;line-height:1}
.temp sup{font-size:.4em;vertical-align:super;opacity:.7}
.details{grid-column:1/-1;display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:12px;border-top:1px solid var(--line);padding-top:16px}
.details div{display:flex;flex-direction:column;gap:2px}
.details span{font-size:11.5px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)}
.details strong{font-size:15px}
.forecast{display:grid;grid-template-columns:repeat(auto-fit,minmax(96px,1fr));gap:10px}
.day{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:14px 10px;text-align:center;transition:transform .18s}
.day:hover{transform:translateY(-3px);border-color:rgba(var(--glow),.4)}
.day .d{font-size:12px;text-transform:capitalize;color:var(--muted);margin-bottom:8px}
.day .emoji{font-size:24px;margin-bottom:6px}
.day .hi{font-weight:700}
.day .lo{font-size:12.5px;color:var(--muted)}
.status{font-size:13.5px;color:var(--muted);margin-top:18px;min-height:20px}
.status.error{color:#f87171}
`;

  const js = `// ${name} — Open-Meteo weather (no key)
(function () {
  var form = document.getElementById('search');
  var input = document.getElementById('city');
  var status = document.getElementById('status');
  var current = document.getElementById('current');
  var forecast = document.getElementById('forecast');

  var CODES = {
    0: ['Clear sky', '☀️'], 1: ['Mostly clear', '🌤️'], 2: ['Partly cloudy', '⛅'], 3: ['Overcast', '☁️'],
    45: ['Fog', '🌫️'], 48: ['Freezing fog', '🌫️'], 51: ['Light drizzle', '🌦️'], 53: ['Drizzle', '🌦️'],
    55: ['Heavy drizzle', '🌧️'], 61: ['Light rain', '🌧️'], 63: ['Rain', '🌧️'], 65: ['Heavy rain', '⛈️'],
    71: ['Light snow', '🌨️'], 73: ['Snow', '🌨️'], 75: ['Heavy snow', '❄️'], 80: ['Showers', '🌦️'],
    81: ['Heavy showers', '🌧️'], 82: ['Violent showers', '⛈️'], 95: ['Thunderstorm', '⛈️'], 96: ['Thunderstorm with hail', '⛈️'], 99: ['Severe thunderstorm', '⛈️']
  };

  function describe(code) {
    return CODES[code] || ['Unknown condition', '🌡️'];
  }

  function setStatus(text, isError) {
    status.textContent = text || '';
    status.className = 'status' + (isError ? ' error' : '');
  }

  async function load(city) {
    setStatus('Searching for “' + city + '”…');
    try {
      var geoRes = await fetch('https://geocoding-api.open-meteo.com/v1/search?count=1&language=en&format=json&name=' + encodeURIComponent(city));
      var geo = await geoRes.json();
      var place = geo.results && geo.results[0];
      if (!place) { setStatus('City not found. Try another name.', true); return; }

      var url = 'https://api.open-meteo.com/v1/forecast?latitude=' + place.latitude + '&longitude=' + place.longitude
        + '&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code'
        + '&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=6';
      var res = await fetch(url);
      var data = await res.json();

      var info = describe(data.current.weather_code);
      document.getElementById('placeName').textContent = place.name + (place.country ? ', ' + place.country : '');
      document.getElementById('placeMeta').textContent = (place.admin1 ? place.admin1 + ' · ' : '') + data.timezone;
      document.getElementById('temp').textContent = Math.round(data.current.temperature_2m);
      document.getElementById('feels').textContent = Math.round(data.current.apparent_temperature) + ' °C';
      document.getElementById('humidity').textContent = data.current.relative_humidity_2m + ' %';
      document.getElementById('wind').textContent = Math.round(data.current.wind_speed_10m) + ' km/h';
      document.getElementById('condition').textContent = info[1] + ' ' + info[0];
      current.hidden = false;

      forecast.innerHTML = '';
      data.daily.time.forEach(function (iso, index) {
        var day = describe(data.daily.weather_code[index]);
        var card = document.createElement('article');
        card.className = 'day';
        var label = new Date(iso).toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' });
        card.innerHTML = '<div class="d"></div><div class="emoji"></div><div class="hi"></div><div class="lo"></div>';
        card.querySelector('.d').textContent = label;
        card.querySelector('.emoji').textContent = day[1];
        card.querySelector('.hi').textContent = Math.round(data.daily.temperature_2m_max[index]) + '°';
        card.querySelector('.lo').textContent = Math.round(data.daily.temperature_2m_min[index]) + '°';
        card.title = day[0];
        forecast.appendChild(card);
      });
      setStatus('Open-Meteo data · ' + new Date().toLocaleTimeString('en-US'));
    } catch (error) {
      setStatus('Unable to load the weather (network?). ' + error.message, true);
    }
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    var city = input.value.trim();
    if (city) load(city);
  });

  load('London');
})();
`;

  return {
    label: 'a weather app',
    files: { 'index.html': html, 'styles.css': css, 'app.js': js },
    notes: [
      'City search via the Open-Meteo geocoding API (free, no key).',
      'Current weather + 6-day forecast with icons and temperatures.',
      'Network error handling with a clear message.',
    ],
  };
}

const TEMPLATES = {
  landing: tplLanding,
  todo: tplTodo,
  calculator: tplCalculator,
  snake: tplSnake,
  weather: tplWeather,
};

function pickTemplate(prompt) {
  const text = normalize(prompt);
  if (/(snake|serpent|jeu|game|arcade|pong|casse-brique)/.test(text)) return 'snake';
  if (/(calculatrice|calculator|calc\b)/.test(text)) return 'calculator';
  if (/(meteo|weather|temperature|previsions)/.test(text)) return 'weather';
  if (/(todo|to-do|tache|liste de course|checklist|task)/.test(text)) return 'todo';
  return 'landing';
}

function extractName(prompt, fallback) {
  const text = String(prompt || '');
  const quoted = text.match(/[«"“']([^»"”']{2,60})[»"”']/);
  if (quoted) return quoted[1].trim();
  const named = text.match(/(?:appel[ée]e?|nomm[ée]e?|s'?appelle|qui s'appelle|pour)\s+([A-Za-zÀ-ÿ0-9][\wÀ-ÿ' -]{1,40})/i);
  if (named) return named[1].trim().replace(/[.,;!?].*$/, '');
  return fallback;
}

/* ── Modifications d'un projet existant ─────────────────────────────────── */

const LIGHT_TOKENS = `  --bg:#f7f8fc;
  --panel:#ffffff;
  --panel-2:#eef1f8;
  --line:rgba(15,23,42,.12);
  --text:#0f172a;
  --muted:#5b657a;
  --shadow:0 20px 50px rgba(15,23,42,.12);`;

const DARK_TOKENS = `  --bg:#0a0c16;
  --panel:#111527;
  --panel-2:#161c33;
  --line:rgba(255,255,255,.09);
  --text:#eef1fb;
  --muted:#98a3c2;
  --shadow:0 24px 60px rgba(0,0,0,.45);`;

function findCssFile(files) {
  return files.find((file) => /\.css$/i.test(file.path));
}

function patchEdits(prompt, files) {
  const text = normalize(prompt);
  const cssFile = findCssFile(files);
  const changes = [];
  const blocks = [];

  if (!cssFile) {
    return {
      ok: false,
      message:
        "I cannot find a stylesheet in this project. For reliable edits, connect a model via **Settings → AI Connection** (OpenAI, Claude, Gemini, Ollama…).",
    };
  }

  let css = cssFile.content;

  const colorKey = Object.keys(PALETTES).find((key) => text.includes(key));
  const wantsColor = colorKey && /(couleur|palette|theme|accent|change|passe|met|plus)/.test(text);
  if (wantsColor) {
    const [accent, accent2] = PALETTES[colorKey];
    const before = css;
    css = css.replace(/--accent\s*:\s*[^;]+;/, `--accent:${accent};`);
    css = css.replace(/--accent-2\s*:\s*[^;]+;/, `--accent-2:${accent2};`);
    css = css.replace(/--glow\s*:\s*[^;]+;/, `--glow:${hexToRgb(accent)};`);
    if (css !== before) changes.push(`palette updated (${accent} / ${accent2})`);
  }

  if (/(clair|light mode|mode clair|fond blanc)/.test(text)) {
    css = css.replace(/:root\{[\s\S]*?\}/, `:root{\n${LIGHT_TOKENS}\n}`);
    changes.push('light theme applied');
  } else if (/(sombre|dark mode|mode sombre|noir)/.test(text)) {
    css = css.replace(/:root\{[\s\S]*?\}/, `:root{\n${DARK_TOKENS}\n}`);
    changes.push('dark theme applied');
  }

  if (/(moderne|ameliore|polish|plus beau|animations?|finition)/.test(text)) {
    const polish = `
/* — Polish added by Supernova Engine — */
.card,.day,.item,.current{transition:transform .22s ease,border-color .22s ease,box-shadow .22s ease}
.card:hover,.day:hover,.item:hover{border-color:rgba(var(--glow),.4);box-shadow:0 18px 40px rgba(0,0,0,.28)}
.btn:focus-visible,.key:focus-visible,input:focus-visible,button:focus-visible{outline:2px solid var(--accent-2);outline-offset:2px}
h1,h2{text-wrap:balance}
@keyframes rise{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
.section,.hero,.card{animation:rise .5s ease both}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
`;
    if (!css.includes('Polish added by Supernova Engine')) {
      css += polish;
      changes.push('visual polish (hover, focus, soft animations)');
    }
  }

  if (changes.length) blocks.push(fileBlock(cssFile.path, css));

  const renameMatch = prompt.match(/(?:appel[ée]e?|nomm[ée]e?|renomm[ée]e?|titre)\s*[:=]?\s*[«"“']?([A-Za-zÀ-ÿ0-9][\wÀ-ÿ' -]{1,40})[»"”']?/i);
  if (renameMatch && /(renomm|titre|nomme|appelle)/.test(text)) {
    const newName = renameMatch[1].trim().replace(/[.,;!?].*$/, '');
    const htmlFile = files.find((file) => /\.html?$/i.test(file.path));
    if (htmlFile) {
      let html = htmlFile.content;
      html = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escHtml(newName)}</title>`);
      html = html.replace(/(<h1[^>]*>)[\s\S]*?(<\/h1>)/i, `$1${escHtml(newName)}$2`);
      blocks.push(fileBlock(htmlFile.path, html));
      changes.push(`title changed to “${newName}”`);
    }
  }

  if (!blocks.length) {
    return {
      ok: false,
      message:
        "I can edit locally: the **palette** (say “make it purple”), the **theme** (light/dark), the **title**, and add **polish** (“make it more modern”). For finer changes (add a section, change logic), connect a model API in **Settings → AI Connection**.",
    };
  }

  return {
    ok: true,
    blocks: blocks.join('\n'),
    summary: changes.join(', '),
  };
}

/* ── Base de connaissances locale ───────────────────────────────────────── */

const KNOWLEDGE = [
  {
    test: /(mcp|model context protocol)/,
    answer:
      "**MCP (Model Context Protocol)** is an open standard that lets an AI agent use external tools (files, databases, GitHub, browser, etc.) through servers. An MCP server exposes a list of tools (<code>tools/list</code>) that the agent calls (<code>tools/call</code>). In Supernova AI, add your servers in **Settings → MCP servers** (stdio command or HTTP URL): their tools are offered to the model, and every call appears in the chat.",
  },
  {
    test: /(api|key|token|openrouter|openai|anthropic|gemini|ollama|cle)/,
    answer:
      "Supernova AI talks to **all OpenAI-compatible APIs** (<code>/v1/chat/completions</code>): OpenAI, OpenRouter, Groq, Mistral, DeepSeek, xAI, Together, Ollama, LM Studio, vLLM… plus native **Anthropic** and **Google Gemini**. Choose the provider in **Settings → AI Connection**, paste your key (it stays in the browser's localStorage, never on disk), and you are ready. Without a key, the **local engine** still works.",
  },
  {
    test: /(react|vue|svelte|next|vite|framework)/,
    answer:
      "Projects generated by the local engine use **plain HTML/CSS/JS** (zero dependencies), so live preview works immediately. For React/Vue/Next, connect a model: the agent will create the files, then run <code>npm install &amp;&amp; npm run dev</code> in the **Terminal** tab. Live preview also accepts a custom URL (e.g. <code>http://localhost:5173</code>) to show your dev server.",
  },
  {
    test: /(agent|claude code|bolt)/,
    answer:
      "A **coding agent** does more than answer: it reads the file tree, writes files, runs commands, and verifies the result. Supernova AI combines both approaches: a **Claude Code**-style agent loop (files + shell + MCP tools) and a **bolt.new**-style instant preview interface (code, terminal, console, live app).",
  },
  {
    test: /(localhost|port|local server|serveur local|demarrer|start)/,
    answer:
      "Supernova AI is a **local site**: run <code>npm install</code> then <code>npm start</code>, and it runs at <code>http://localhost:3000</code>. Nothing is sent to the internet except your requests to the AI provider you chose (or your web searches). In **PC** mode, projects are real folders under <code>workspaces/</code>.",
  },
  {
    test: /(zip|export|download|telecharger|sauvegarde)/,
    answer:
      "The **Cloud** tab writes the project to Supernova AI's internal folder (<code>data/cloud/</code>), then offers **Download ZIP** (server-generated archive, readable with unzip, Finder, or Windows). The **PC** tab writes directly to a working folder, and ZIP export remains available too.",
  },
  {
    test: /(javascript|js\b)/,
    answer:
      "A few modern JavaScript habits: <code>const</code>/<code>let</code> instead of <code>var</code>, <code>async/await</code> for asynchronous code, <code>Array.prototype.at()</code> for the last item, optional chaining <code>obj?.prop</code>, and <code>structuredClone()</code> for deep copies. ES modules (<code>import</code>/<code>export</code>) are standard in both browsers and Node.",
  },
  {
    test: /(css|design|responsive|style)/,
    answer:
      "For solid design without a framework: CSS variables (<code>:root</code>), <code>clamp()</code> for fluid typography, <code>grid</code> with <code>repeat(auto-fit, minmax(…, 1fr))</code>, and <code>prefers-reduced-motion</code> for accessibility. Colors in <code>rgba()</code> from variables let you manage transparency and glows.",
  },
  {
    test: /(html|accessibility|accessibilite|a11y|semantic|semantique)/,
    answer:
      "Accessible HTML: semantic structure (<code>header</code>, <code>main</code>, <code>nav</code>, <code>footer</code>), a single <code>h1</code>, labels associated with fields, <code>alt</code> on images, sufficient contrast, keyboard navigation, and visible <code>:focus-visible</code>. These basics cost little and improve SEO.",
  },
  {
    test: /(node|backend|express)/,
    answer:
      "Node.js runs JavaScript on the server. Express remains the minimal choice for an HTTP API: <code>app.get()</code>, <code>app.use(express.json())</code>, and routers separated by domain. For light realtime, <code>ws</code> is enough; for long tasks, a separate process and a queue avoid blocking the event loop.",
  },
  {
    test: /(who are you|your name|about you|qui es tu|qui es-tu|ton nom|presente toi|tu es qui)/,
    answer:
      "I am **Supernova Engine**, the built-in engine of Supernova AI: a small local engine, with no network or key, that can generate simple web projects (landing page, to-do, calculator, game, weather), modify an existing project, answer technical questions, and search the web. I am not an LLM: for complex code, connect a model via **Settings → AI Connection**.",
  },
];

/* ── Génération principale ──────────────────────────────────────────────── */

function projectReadme(name, label, files) {
  const list = Object.keys(files).map((file) => `- \`${file}\``).join('\n');
  return `# ${name}

${label.charAt(0).toUpperCase() + label.slice(1)} generated with **Supernova AI** (local engine).

## Run the project
Open \`index.html\` in a browser, or serve the folder:

\`\`\`bash
npx serve .
\`\`\`

## Files
${list}

## Notes
- No dependencies, no build step.
- Commented and editable code.
`;
}

export async function* runLocalEngine({ prompt, project, files = [], signal, onSearch }) {
  const text = String(prompt || '').trim();
  const normalized = normalize(text);
  const existing = Array.isArray(files) ? files : [];
  const projectName = project?.name || 'Supernova';

  const emit = async function* (content) {
    const chunks = [];
    let index = 0;
    while (index < content.length) {
      const size = 18 + Math.floor(Math.random() * 34);
      chunks.push(content.slice(index, index + size));
      index += size;
    }
    for (const chunk of chunks) {
      if (signal?.aborted) return;
      yield chunk;
      await sleep(6);
    }
  };

  if (!text) {
    yield* emit('Tell me what you want to build 🙂 For example: “build a landing page for a travel agency”.');
    return;
  }

  if (/^(salut|bonjour|hello|hey|yo|coucou|bonsoir)\b/.test(normalized) && text.length < 40) {
    yield* emit(
      `Hi 👋 I am **Supernova Engine**, the local engine. I can generate a small complete project (landing page, to-do, calculator, game, weather), modify an existing project, answer technical questions, and search the web.\n\nFor example: “build a landing page for a café in Lyon” or “find the Open-Meteo API docs”.`
    );
    return;
  }

  // 1. Recherche web
  if (/(cherche|recherche|actualite|qui est|qu'est-ce que|combien|quand|documentation|docs?)\b/.test(normalized) || /^(cherche|recherche)/.test(normalized)) {
    const query = text.replace(/^(cherche|recherche|trouve|peux-tu chercher)\s*/i, '').replace(/\?$/, '');
    yield* emit(`🔎 Searching the web for **${query}**…\n\n`);
    onSearch?.({ phase: 'start', query });
    let outcome;
    try {
      outcome = await searchWeb(query, { limit: 5 });
    } catch (error) {
      outcome = { results: [], note: `The search failed (${error.message}).` };
    }
    onSearch?.({ phase: 'results', query, results: outcome.results || [], note: outcome.note || '' });
    if (!outcome.results.length) {
      yield* emit(`${outcome.note || 'No results.'}\n\nI can still answer web basics, or generate a project: for example, “create a monitoring page”.`);
      return;
    }
    let answer = `Here is what I found for **${query}**:\n\n`;
    outcome.results.forEach((result, index) => {
      answer += `${index + 1}. **${result.title}** — ${result.snippet.slice(0, 320)}${result.snippet.length > 320 ? '…' : ''}\n   ${result.url ? `<${result.url}>` : ''}\n\n`;
    });
    answer += `_Sources: ${[...new Set(outcome.results.map((r) => r.source))].join(', ')}. The local engine summarizes results; connect a model for a finer synthesis._`;
    yield* emit(answer);
    return;
  }

  // 2. Analyse du projet
  if (/(analyse|resume|explique).{0,20}(projet|code|fichiers?)/.test(normalized) || /^analyse/.test(normalized)) {
    if (!existing.length) {
      yield* emit("The project is empty right now. Ask me to create something, for example “build a landing page for a nonprofit”.");
      return;
    }
    const total = existing.reduce((sum, file) => sum + (file.content?.length || 0), 0);
    const byType = {};
    for (const file of existing) {
      const ext = file.path.split('.').pop();
      byType[ext] = (byType[ext] || 0) + 1;
    }
    let answer = `## Analysis of “${projectName}”\n\n`;
    answer += `- **${existing.length} files**, ${(total / 1024).toFixed(1)} KB of code\n`;
    answer += `- Types: ${Object.entries(byType).map(([ext, count]) => `${count} .${ext}`).join(', ')}\n\n`;
    answer += `### Structure\n${existing.map((file) => `- \`${file.path}\` (${(file.content?.length || 0)} B)`).join('\n')}\n\n`;
    answer += `### Things to check\n`;
    const html = existing.find((file) => /\.html?$/.test(file.path));
    if (html && !/<meta[^>]+viewport/i.test(html.content)) answer += `- No meta viewport: mobile rendering may break.\n`;
    if (html && !/<main[\s>]/i.test(html.content)) answer += `- No \`<main>\` element: semantic structure needs work.\n`;
    const css = existing.find((file) => /\.css$/.test(file.path));
    if (css && !css.content.includes('@media')) answer += `- No media query: responsive behavior is not handled.\n`;
    if (!existing.some((file) => /readme/i.test(file.path))) answer += `- No README documenting how to run it.\n`;
    answer += `\nAsk me to “make it more modern” or choose a color (“make it purple”) for a local tweak.`;
    yield* emit(answer);
    return;
  }

  // 3. Modification d'un projet existant
  const isEdit = /(change|modifie|ajoute|ajouter|remplace|corrige|ameliore|améliorer|met|mets|supprime|enleve|enlève|rends|plus moderne|passe en|theme|palette|couleur)/.test(normalized);
  if (isEdit && existing.length && !/(cree|crée|genere|génère|construis|fais|developpe|développe)/.test(normalized)) {
    const result = patchEdits(text, existing);
    if (!result.ok) {
      yield* emit(result.message);
      return;
    }
    yield* emit(`Done: **${result.summary}**.\n\n${result.blocks}\n\nLive preview refreshes automatically. Tell me if you want another color, light/dark theme, or more polish.`);
    return;
  }

  // 4. Création d'un projet
  const wantsBuild =
    /(cree|crée|creer|genere|génère|construis|fais|developpe|développe|realise|réalise|build|code)/.test(normalized) ||
    /(site|app|application|page|jeu|landing|vitrine|portfolio|dashboard|outil|calculatrice|todo|meteo)/.test(normalized);

  if (wantsBuild) {
    const templateKey = pickTemplate(text);
    const template = TEMPLATES[templateKey];
    const fallbackName = {
      landing: 'My Site',
      todo: 'My Tasks',
      calculator: 'Calculator',
      snake: 'Snake',
      weather: 'Live Weather',
    }[templateKey];
    const name = extractName(text, fallbackName).slice(0, 60);
    const generated = template(name);
    const filesWithReadme = {
      ...generated.files,
      'README.md': projectReadme(name, generated.label, generated.files),
    };

    let answer = `Building **${name}** — ${generated.label}. Complete, responsive base with no dependencies.\n\n`;
    for (const [filePath, content] of Object.entries(filesWithReadme)) {
      answer += `${fileBlock(filePath, content)}\n`;
    }
    answer += `## What is included\n${generated.notes.map((note) => `- ${note}`).join('\n')}\n\n`;
    answer += `Live preview is available on the right. Ask for tweaks (“make it purple”, “make it more modern”) or connect a model to go further.`;
    yield* emit(answer);
    return;
  }

  // 5. Base de connaissances
  const knowledge = KNOWLEDGE.find((entry) => entry.test.test(normalized));
  if (knowledge) {
    yield* emit(`${knowledge.answer}\n\n_— Supernova Engine, local engine. For deeper answers, connect a model in Settings → AI Connection._`);
    return;
  }

  // 6. Réponse par défaut
  yield* emit(
    `Noted: “${text.slice(0, 160)}”.\n\nLocally, I am good at five things:\n\n1. **Create** a small web project — “build a landing page for a yoga studio”.\n2. **Modify** an existing project — “make it purple”, “make it more modern”.\n3. **Analyze** the project — “analyze the project”.\n4. **Explain** a technical concept — “what is MCP?”.\n5. **Search** the web — “find the Open-Meteo API docs”.\n\nFor more ambitious code (React, backend, refactor), add a key in **Settings → AI Connection**: the same agent will use GPT, Claude, Gemini, or a local Ollama model, with the same tools and preview.`
  );
}

/* ── Amélioration de prompt (sans clé) ─────────────────────────────────── */

export function localUpgradePrompt(prompt) {
  const base = String(prompt || '').trim();
  if (!base) return base;
  return `${base}

## Implementation requirements
- Structure: separate files (semantic HTML, CSS in styles.css, JS in app.js), relative paths.
- Design: modern, dark by default, colorful accent, rounded corners, soft shadows, fluid typography with clamp().
- Responsive: mobile first, breakpoints at 720px and 900px, touch-friendly menu.
- Accessibility: AA contrast, associated labels, keyboard navigation, visible focus, aria when needed.
- Interactions: subtle animations, hover/focus states, respect prefers-reduced-motion.
- Data: local persistence (localStorage) when relevant, input validation.
- Content: English copy, clear calls to action, no placeholder lorem ipsum.
- Quality: no external dependencies, commented code, no leftover console.log.
- Delivery: all files complete, ready to open in a browser, plus a README with instructions.`;
}