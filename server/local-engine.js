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
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${safe}</title>
  <meta name="description" content="${safe} — produit moderne, rapide et soigné." />
  <link rel="stylesheet" href="styles.css" />
</head>
<body>
  <header class="nav">
    <a class="brand" href="#top"><span class="spark"></span>${safe}</a>
    <nav class="nav-links" id="navLinks">
      <a href="#fonctionnalites">Fonctionnalités</a>
      <a href="#apercu">Aperçu</a>
      <a href="#contact">Contact</a>
    </nav>
    <button class="btn ghost small" id="themeBtn" aria-label="Changer de thème">🌙</button>
    <button class="menu-btn" id="menuBtn" aria-label="Ouvrir le menu">☰</button>
  </header>

  <main>
    <section class="hero wrap" id="top">
      <div class="hero-copy">
        <span class="badge">Nouveau · généré avec Supernova IA</span>
        <h1>Construis <span class="grad">plus vite</span><br />que ton imagination.</h1>
        <p>${safe} réunit l'essentiel : une interface claire, des performances réelles et une expérience pensée pour convertir.</p>
        <div class="cta-row">
          <a class="btn primary" href="#contact">Commencer maintenant</a>
          <a class="btn ghost" href="#fonctionnalites">Voir les détails</a>
        </div>
        <ul class="stats">
          <li><strong>100%</strong><span>responsive</span></li>
          <li><strong>0</strong><span>dépendance</span></li>
          <li><strong>&lt;1s</strong><span>au chargement</span></li>
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
      <h2 class="section-title fade-in">Tout ce qu'il faut, rien de trop.</h2>
      <div class="grid">
        <article class="card fade-in"><span class="ico">⚡</span><h3>Rapide par défaut</h3><p>Aucun framework, aucun poids inutile : le site s'affiche instantanément.</p></article>
        <article class="card fade-in"><span class="ico">🎨</span><h3>Design soigné</h3><p>Typographie, espacements et animations pensés pour un rendu professionnel.</p></article>
        <article class="card fade-in"><span class="ico">📱</span><h3>Mobile first</h3><p>Une mise en page qui s'adapte du téléphone au grand écran, sans effort.</p></article>
        <article class="card fade-in"><span class="ico">🔒</span><h3>Zéro tracker</h3><p>Pas de cookie tiers, pas d'analytics caché. Juste du code lisible.</p></article>
      </div>
    </section>

    <section class="wrap section split" id="apercu">
      <div class="fade-in">
        <h2>Un aperçu honnête.</h2>
        <p>Ce projet a été généré par Supernova IA : chaque fichier est éditable, versionnable et exportable en ZIP en un clic.</p>
        <ul class="checklist">
          <li>HTML sémantique accessible</li>
          <li>CSS moderne (variables, grid, clamp)</li>
          <li>JavaScript sans dépendance</li>
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
          <h2>On en parle ?</h2>
          <p>Laisse ton email : ce formulaire de démonstration valide la saisie côté client.</p>
        </div>
        <form id="contactForm" novalidate>
          <label for="email">Email</label>
          <input id="email" name="email" type="email" placeholder="toi@exemple.com" required />
          <label for="message">Message</label>
          <textarea id="message" name="message" rows="3" placeholder="Ton idée en une phrase…"></textarea>
          <button class="btn primary" type="submit">Envoyer</button>
          <p class="form-note" id="formNote" role="status"></p>
        </form>
      </div>
    </section>
  </main>

  <footer class="footer wrap">
    <p>© <span id="year"></span> ${safe} · construit avec Supernova IA</p>
    <a href="#top">Retour en haut ↑</a>
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

  const js = `// ${name} — interactions (aucune dépendance)
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
        note.textContent = 'Merci de saisir un email valide.';
        note.style.color = '#f87171';
        email.focus();
        return;
      }
      note.style.color = '';
      note.textContent = 'Merci ! Message enregistré localement (démo sans serveur).';
      form.reset();
    });
  }
})();
`;

  return {
    label: 'un site vitrine / landing page',
    files: { 'index.html': html, 'styles.css': css, 'app.js': js },
    notes: [
      'Page d’accueil responsive avec hero animé, grille de fonctionnalités et formulaire validé.',
      'Thème clair/sombre mémorisé dans le navigateur.',
      'Animations d’apparition au scroll (IntersectionObserver).',
    ],
  };
}

function tplTodo(name) {
  const safe = escHtml(name);
  const { accent, accent2 } = paletteFor(name);
  const html = `<!DOCTYPE html>
<html lang="fr">
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
      <p class="sub" id="sub">0 tâche</p>
    </header>

    <form id="form" class="composer">
      <input id="input" type="text" placeholder="Ajouter une tâche…" autocomplete="off" maxlength="160" />
      <button class="btn primary" type="submit">Ajouter</button>
    </form>

    <div class="toolbar">
      <div class="filters" role="tablist">
        <button class="chip active" data-filter="all">Toutes</button>
        <button class="chip" data-filter="active">À faire</button>
        <button class="chip" data-filter="done">Terminées</button>
      </div>
      <button class="chip danger" id="clear">Tout effacer</button>
    </div>

    <ul class="list" id="list"></ul>
    <p class="empty" id="empty">Aucune tâche pour l’instant. Ajoute la première ✨</p>
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

  const js = `// ${name} — logique de tâches avec sauvegarde locale
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
      del.setAttribute('aria-label', 'Supprimer la tâche');
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
      ? state.tasks.length + ' tâche' + (state.tasks.length > 1 ? 's' : '') + ' · ' + left + ' restante' + (left > 1 ? 's' : '')
      : '0 tâche';
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
    if (confirm('Effacer toutes les tâches ?')) {
      state.tasks = [];
      save();
      render();
    }
  });

  render();
})();
`;

  return {
    label: 'une application de tâches (to-do)',
    files: { 'index.html': html, 'styles.css': css, 'app.js': js },
    notes: [
      'Ajout, validation, suppression et filtres (toutes / à faire / terminées).',
      'Sauvegarde automatique dans le localStorage du navigateur.',
      'Barre de progression et compteurs mis à jour en direct.',
    ],
  };
}

function tplCalculator(name) {
  const safe = escHtml(name);
  const { accent, accent2 } = paletteFor(name);
  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${safe}</title>
  <link rel="stylesheet" href="styles.css" />
</head>
<body>
  <main class="calc">
    <header><h1>${safe}</h1><p>Clavier autorisé : chiffres, + − × ÷, Entrée, Échap.</p></header>
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
    current = isNaN(result) ? 'Erreur' : String(Math.round(result * 1e10) / 1e10);
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
    label: 'une calculatrice interactive',
    files: { 'index.html': html, 'styles.css': css, 'app.js': js },
    notes: [
      'Calculs en chaîne, changement de signe, pourcentage et gestion de la division par zéro.',
      'Support clavier complet (chiffres, opérateurs, Entrée, Échap).',
      'Aucun usage de eval : opérations explicites.',
    ],
  };
}

function tplSnake(name) {
  const safe = escHtml(name);
  const { accent, accent2 } = paletteFor(name);
  const html = `<!DOCTYPE html>
<html lang="fr">
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
      <p>Flèches / ZQSD pour jouer · Espace pour mettre en pause</p>
    </header>
    <div class="hud">
      <div><span>Score</span><strong id="score">0</strong></div>
      <div><span>Record</span><strong id="best">0</strong></div>
      <button class="btn primary small" id="restart">Recommencer</button>
    </div>
    <div class="canvas-wrap">
      <canvas id="game" width="400" height="400" aria-label="Jeu du serpent"></canvas>
      <div class="overlay" id="overlay">
        <h2 id="overlayTitle">Prêt ?</h2>
        <p id="overlayText">Appuie sur une flèche pour démarrer.</p>
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

  const js = `// ${name} — serpent sur canvas
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
    overlayTitle.textContent = 'Prêt ?';
    overlayText.textContent = 'Appuie sur une flèche pour démarrer.';
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
    overlayTitle.textContent = 'Perdu !';
    overlayText.textContent = 'Score : ' + score + ' · Flèche pour rejouer.';
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
      if (overlayTitle.textContent === 'Perdu !') return reset(), start();
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
      if (running) { running = false; clearInterval(timer); overlay.classList.remove('hidden'); overlayTitle.textContent = 'Pause'; overlayText.textContent = 'Espace pour reprendre.'; }
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
    label: 'un jeu (serpent)',
    files: { 'index.html': html, 'styles.css': css, 'app.js': js },
    notes: [
      'Jeu complet sur canvas : collisions, score, record sauvegardé, accélération progressive.',
      'Contrôles clavier (flèches / ZQSD) et tactile (swipe + D-pad mobile).',
      'Pause avec Espace et redémarrage instantané.',
    ],
  };
}

function tplWeather(name) {
  const safe = escHtml(name);
  const { accent, accent2 } = paletteFor(name);
  const html = `<!DOCTYPE html>
<html lang="fr">
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
      <p>Météo en temps réel — données Open-Meteo, sans clé d’API.</p>
      <form id="search">
        <input id="city" type="search" placeholder="Ville (ex : Paris, Montréal, Dakar…)" autocomplete="off" />
        <button class="btn primary" type="submit">Chercher</button>
      </form>
    </header>

    <section class="current card" id="current" hidden>
      <div class="place">
        <h2 id="placeName">—</h2>
        <p id="placeMeta"></p>
      </div>
      <div class="temp"><span id="temp">—</span><sup>°C</sup></div>
      <div class="details">
        <div><span>Ressenti</span><strong id="feels">—</strong></div>
        <div><span>Humidité</span><strong id="humidity">—</strong></div>
        <div><span>Vent</span><strong id="wind">—</strong></div>
        <div><span>Condition</span><strong id="condition">—</strong></div>
      </div>
    </section>

    <section class="forecast" id="forecast"></section>
    <p class="status" id="status">Entre une ville pour voir la météo.</p>
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

  const js = `// ${name} — météo Open-Meteo (aucune clé)
(function () {
  var form = document.getElementById('search');
  var input = document.getElementById('city');
  var status = document.getElementById('status');
  var current = document.getElementById('current');
  var forecast = document.getElementById('forecast');

  var CODES = {
    0: ['Ciel dégagé', '☀️'], 1: ['Plutôt dégagé', '🌤️'], 2: ['Partiellement nuageux', '⛅'], 3: ['Couvert', '☁️'],
    45: ['Brouillard', '🌫️'], 48: ['Brouillard givrant', '🌫️'], 51: ['Bruine légère', '🌦️'], 53: ['Bruine', '🌦️'],
    55: ['Bruine forte', '🌧️'], 61: ['Pluie faible', '🌧️'], 63: ['Pluie', '🌧️'], 65: ['Pluie forte', '⛈️'],
    71: ['Neige faible', '🌨️'], 73: ['Neige', '🌨️'], 75: ['Neige forte', '❄️'], 80: ['Averses', '🌦️'],
    81: ['Averses fortes', '🌧️'], 82: ['Averses violentes', '⛈️'], 95: ['Orage', '⛈️'], 96: ['Orage grêle', '⛈️'], 99: ['Orage violent', '⛈️']
  };

  function describe(code) {
    return CODES[code] || ['Condition inconnue', '🌡️'];
  }

  function setStatus(text, isError) {
    status.textContent = text || '';
    status.className = 'status' + (isError ? ' error' : '');
  }

  async function load(city) {
    setStatus('Recherche de « ' + city + ' »…');
    try {
      var geoRes = await fetch('https://geocoding-api.open-meteo.com/v1/search?count=1&language=fr&format=json&name=' + encodeURIComponent(city));
      var geo = await geoRes.json();
      var place = geo.results && geo.results[0];
      if (!place) { setStatus('Ville introuvable. Essaie un autre nom.', true); return; }

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
        var label = new Date(iso).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' });
        card.innerHTML = '<div class="d"></div><div class="emoji"></div><div class="hi"></div><div class="lo"></div>';
        card.querySelector('.d').textContent = label;
        card.querySelector('.emoji').textContent = day[1];
        card.querySelector('.hi').textContent = Math.round(data.daily.temperature_2m_max[index]) + '°';
        card.querySelector('.lo').textContent = Math.round(data.daily.temperature_2m_min[index]) + '°';
        card.title = day[0];
        forecast.appendChild(card);
      });
      setStatus('Données Open-Meteo · ' + new Date().toLocaleTimeString('fr-FR'));
    } catch (error) {
      setStatus('Impossible de charger la météo (réseau ?). ' + error.message, true);
    }
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    var city = input.value.trim();
    if (city) load(city);
  });

  load('Paris');
})();
`;

  return {
    label: 'une application météo',
    files: { 'index.html': html, 'styles.css': css, 'app.js': js },
    notes: [
      'Recherche de ville via l’API de géocodage Open-Meteo (gratuite, sans clé).',
      'Météo actuelle + prévisions à 6 jours avec icônes et températures.',
      'Gestion d’erreur réseau avec message explicite.',
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
        "Je ne trouve pas de feuille de style dans ce projet. Pour des modifications fiables, connecte un modèle via **Paramètres → Connexion IA** (OpenAI, Claude, Gemini, Ollama…).",
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
    if (css !== before) changes.push(`palette passée en ${colorKey} (${accent} / ${accent2})`);
  }

  if (/(clair|light mode|mode clair|fond blanc)/.test(text)) {
    css = css.replace(/:root\{[\s\S]*?\}/, `:root{\n${LIGHT_TOKENS}\n}`);
    changes.push('thème clair appliqué');
  } else if (/(sombre|dark mode|mode sombre|noir)/.test(text)) {
    css = css.replace(/:root\{[\s\S]*?\}/, `:root{\n${DARK_TOKENS}\n}`);
    changes.push('thème sombre appliqué');
  }

  if (/(moderne|ameliore|polish|plus beau|animations?|finition)/.test(text)) {
    const polish = `
/* — Finitions ajoutées par Supernova Engine — */
.card,.day,.item,.current{transition:transform .22s ease,border-color .22s ease,box-shadow .22s ease}
.card:hover,.day:hover,.item:hover{border-color:rgba(var(--glow),.4);box-shadow:0 18px 40px rgba(0,0,0,.28)}
.btn:focus-visible,.key:focus-visible,input:focus-visible,button:focus-visible{outline:2px solid var(--accent-2);outline-offset:2px}
h1,h2{text-wrap:balance}
@keyframes rise{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
.section,.hero,.card{animation:rise .5s ease both}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
`;
    if (!css.includes('Finitions ajoutées par Supernova Engine')) {
      css += polish;
      changes.push('finitions visuelles (survols, focus, animations douces)');
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
      changes.push(`titre remplacé par « ${newName} »`);
    }
  }

  if (!blocks.length) {
    return {
      ok: false,
      message:
        "Je sais modifier localement : la **palette** (dis « passe en violet »), le **thème** (clair/sombre), le **titre**, et ajouter des **finitions** (« rends-le plus moderne »). Pour une modification plus fine (ajouter une section, changer la logique), connecte une API de modèle dans **Paramètres → Connexion IA**.",
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
      "**MCP (Model Context Protocol)** est un standard ouvert qui permet à un agent IA d’utiliser des outils externes (fichiers, base de données, GitHub, navigateur…) via des serveurs. Un serveur MCP expose une liste d’outils (`tools/list`) que l’agent appelle (`tools/call`). Dans Supernova IA, tu ajoutes tes serveurs dans **Paramètres → Serveurs MCP** (commande stdio ou URL HTTP) : leurs outils sont alors proposés au modèle, et chaque appel s’affiche dans le chat.",
  },
  {
    test: /(api|cle|token|openrouter|openai|anthropic|gemini|ollama)/,
    answer:
      "Supernova IA parle à **toutes les API compatibles OpenAI** (`/v1/chat/completions`) : OpenAI, OpenRouter, Groq, Mistral, DeepSeek, xAI, Together, Ollama, LM Studio, vLLM… ainsi qu’**Anthropic** et **Google Gemini** en natif. Tu choisis le fournisseur dans **Paramètres → Connexion IA**, tu colles ta clé (elle reste dans le localStorage du navigateur, jamais sur le disque) et c’est prêt. Sans clé, le **moteur local** fonctionne quand même.",
  },
  {
    test: /(react|vue|svelte|next|vite|framework)/,
    answer:
      "Les modèles générés par le moteur local sont en **HTML/CSS/JS pur** (zéro dépendance), donc l’aperçu live fonctionne immédiatement. Si tu veux du React/Vue/Next, connecte un modèle : l’agent créera les fichiers, puis tu lanceras `npm install && npm run dev` dans l’onglet **Terminal**. L’aperçu live accepte aussi une URL personnalisée (ex. `http://localhost:5173`) pour afficher ton serveur de dev.",
  },
  {
    test: /(agent|claude code|bolt)/,
    answer:
      "Un **agent de code** ne se contente pas de répondre : il lit l’arborescence, écrit des fichiers, lance des commandes et vérifie le résultat. Supernova IA mélange les deux approches : la boucle d’agent façon **Claude Code** (fichiers + shell + outils MCP) et l’interface d’aperçu instantané façon **bolt.new** (code, terminal, console, app live).",
  },
  {
    test: /(localhost|port|serveur local|demarrer)/,
    answer:
      "Supernova IA est un **site local** : `npm install` puis `npm start`, et il tourne sur `http://localhost:3000`. Rien n’est envoyé sur Internet sauf tes requêtes vers le fournisseur d’IA que tu as choisi (ou tes recherches web). En mode **PC**, les projets sont de vrais dossiers dans `workspaces/`.",
  },
  {
    test: /(zip|exporter|telecharger|sauvegarde)/,
    answer:
      "L’onglet **Cloud** écrit le projet dans un dossier interne à Supernova IA (`data/cloud/`), puis propose **Télécharger le ZIP** (archive générée côté serveur, lisible par `unzip`, Finder ou Windows). L’onglet **PC** écrit directement dans un dossier de travail, et le ZIP reste disponible aussi.",
  },
  {
    test: /(javascript|js\b)/,
    answer:
      "Quelques réflexes JavaScript modernes : `const`/`let` plutôt que `var`, `async/await` pour l’asynchrone, `Array.prototype.at()` pour le dernier élément, optional chaining `obj?.prop`, et `structuredClone()` pour copier un objet en profondeur. Les modules ES (`import`/`export`) sont le standard côté navigateur comme côté Node.",
  },
  {
    test: /(css|design|responsive|style)/,
    answer:
      "Pour un design solide sans framework : variables CSS (`:root`), `clamp()` pour la typographie fluide, `grid` avec `repeat(auto-fit, minmax(…, 1fr))`, et `prefers-reduced-motion` pour l’accessibilité. Les couleurs en `rgba()` depuis des variables permettent de gérer les transparences et les halos.",
  },
  {
    test: /(html|accessibilite|a11y|semantique)/,
    answer:
      "Un HTML accessible : structure sémantique (`header`, `main`, `nav`, `footer`), un seul `h1`, labels associés aux champs, `alt` sur les images, contrastes suffisants, navigation clavier et `:focus-visible` visible. Ces bases coûtent peu et améliorent le référencement.",
  },
  {
    test: /(node|backend|express)/,
    answer:
      "Node.js exécute du JavaScript côté serveur. Express reste le choix minimal pour une API HTTP : `app.get()`, `app.use(express.json())`, et des routeurs séparés par domaine. Pour du temps réel léger, `ws` suffit ; pour des tâches longues, un process séparé et une file d’attente évitent de bloquer l’event loop.",
  },
  {
    test: /(qui es tu|qui es-tu|ton nom|presente toi|tu es qui)/,
    answer:
      "Je suis **Supernova Engine**, le moteur intégré de Supernova IA : un petit moteur local, sans réseau ni clé, qui sait générer des projets web simples (site vitrine, to-do, calculatrice, jeu, météo), modifier un projet existant, répondre à des questions techniques et chercher des infos sur le web. Je ne suis pas un LLM : pour du code complexe, branche un modèle via **Paramètres → Connexion IA**.",
  },
];

/* ── Génération principale ──────────────────────────────────────────────── */

function projectReadme(name, label, files) {
  const list = Object.keys(files).map((file) => `- \`${file}\``).join('\n');
  return `# ${name}

${label.charAt(0).toUpperCase() + label.slice(1)} généré avec **Supernova IA** (moteur local).

## Lancer le projet
Ouvre simplement \`index.html\` dans un navigateur, ou sers le dossier :

\`\`\`bash
npx serve .
\`\`\`

## Fichiers
${list}

## Notes
- Aucune dépendance, aucun build.
- Code commenté et modifiable.
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
    yield* emit('Dis-moi ce que tu veux construire 🙂 Par exemple : « crée un site vitrine pour une agence de voyage ».');
    return;
  }

  if (/^(salut|bonjour|hello|hey|yo|coucou|bonsoir)\b/.test(normalized) && text.length < 40) {
    yield* emit(
      `Salut 👋 Je suis **Supernova Engine**, le moteur local. Je peux générer un petit projet complet (site, to-do, calculatrice, jeu, météo), modifier un projet existant, répondre à des questions techniques et chercher sur le web.\n\nDis-moi par exemple : « crée un site vitrine pour un café à Lyon » ou « cherche la doc de l’API Open-Meteo ».`
    );
    return;
  }

  // 1. Recherche web
  if (/(cherche|recherche|actualite|qui est|qu'est-ce que|combien|quand|documentation|docs?)\b/.test(normalized) || /^(cherche|recherche)/.test(normalized)) {
    const query = text.replace(/^(cherche|recherche|trouve|peux-tu chercher)\s*/i, '').replace(/\?$/, '');
    yield* emit(`🔎 Je cherche **${query}** sur le web…\n\n`);
    onSearch?.({ phase: 'start', query });
    let outcome;
    try {
      outcome = await searchWeb(query, { limit: 5 });
    } catch (error) {
      outcome = { results: [], note: `La recherche a échoué (${error.message}).` };
    }
    onSearch?.({ phase: 'results', query, results: outcome.results || [], note: outcome.note || '' });
    if (!outcome.results.length) {
      yield* emit(`${outcome.note || 'Aucun résultat.'}\n\nJe peux quand même répondre sur les bases du web, ou générer un projet : demande-moi par exemple « crée une page de veille »..`);
      return;
    }
    let answer = `Voici ce que j’ai trouvé pour **${query}** :\n\n`;
    outcome.results.forEach((result, index) => {
      answer += `${index + 1}. **${result.title}** — ${result.snippet.slice(0, 320)}${result.snippet.length > 320 ? '…' : ''}\n   ${result.url ? `<${result.url}>` : ''}\n\n`;
    });
    answer += `_Sources : ${[...new Set(outcome.results.map((r) => r.source))].join(', ')}. Le moteur local résume les résultats ; branche un modèle pour une synthèse plus fine._`;
    yield* emit(answer);
    return;
  }

  // 2. Analyse du projet
  if (/(analyse|resume|explique).{0,20}(projet|code|fichiers?)/.test(normalized) || /^analyse/.test(normalized)) {
    if (!existing.length) {
      yield* emit("Le projet est vide pour l’instant. Demande-moi de créer quelque chose, par exemple « crée un site vitrine pour une association ».");
      return;
    }
    const total = existing.reduce((sum, file) => sum + (file.content?.length || 0), 0);
    const byType = {};
    for (const file of existing) {
      const ext = file.path.split('.').pop();
      byType[ext] = (byType[ext] || 0) + 1;
    }
    let answer = `## Analyse de « ${projectName} »\n\n`;
    answer += `- **${existing.length} fichiers**, ${(total / 1024).toFixed(1)} Ko de code\n`;
    answer += `- Types : ${Object.entries(byType).map(([ext, count]) => `${count} .${ext}`).join(', ')}\n\n`;
    answer += `### Structure\n${existing.map((file) => `- \`${file.path}\` (${(file.content?.length || 0)} o)`).join('\n')}\n\n`;
    answer += `### Points d’attention\n`;
    const html = existing.find((file) => /\.html?$/.test(file.path));
    if (html && !/<meta[^>]+viewport/i.test(html.content)) answer += `- Pas de meta viewport : le rendu mobile peut casser.\n`;
    if (html && !/<main[\s>]/i.test(html.content)) answer += `- Pas d’élément \`<main>\` : structure sémantique à compléter.\n`;
    const css = existing.find((file) => /\.css$/.test(file.path));
    if (css && !css.content.includes('@media')) answer += `- Aucun media query : le responsive n’est pas géré.\n`;
    if (!existing.some((file) => /readme/i.test(file.path))) answer += `- Pas de README pour documenter le lancement.\n`;
    answer += `\nDemande-moi « rends-le plus moderne » ou une couleur (« passe en violet ») pour une retouche locale.`;
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
    yield* emit(`C’est fait : **${result.summary}**.\n\n${result.blocks}\n\nL’aperçu live se rafraîchit automatiquement. Dis-moi si tu veux une autre couleur, le thème clair/sombre, ou plus de finitions.`);
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
      landing: 'Mon Site',
      todo: 'Mes Tâches',
      calculator: 'Calculatrice',
      snake: 'Serpent',
      weather: 'Météo Live',
    }[templateKey];
    const name = extractName(text, fallbackName).slice(0, 60);
    const generated = template(name);
    const filesWithReadme = {
      ...generated.files,
      'README.md': projectReadme(name, generated.label, generated.files),
    };

    let answer = `Je pars sur **${name}** — ${generated.label}. Base complète, responsive, sans dépendance.\n\n`;
    for (const [filePath, content] of Object.entries(filesWithReadme)) {
      answer += `${fileBlock(filePath, content)}\n`;
    }
    answer += `## Ce qui est inclus\n${generated.notes.map((note) => `- ${note}`).join('\n')}\n\n`;
    answer += `L’aperçu live est disponible à droite. Tu peux demander des retouches (« passe en violet », « rends-le plus moderne ») ou brancher un modèle pour aller plus loin.`;
    yield* emit(answer);
    return;
  }

  // 5. Base de connaissances
  const knowledge = KNOWLEDGE.find((entry) => entry.test.test(normalized));
  if (knowledge) {
    yield* emit(`${knowledge.answer}\n\n_— Supernova Engine, moteur local. Pour des réponses plus poussées, connecte un modèle dans Paramètres → Connexion IA._`);
    return;
  }

  // 6. Réponse par défaut
  yield* emit(
    `Je note ta demande : « ${text.slice(0, 160)} ».\n\nEn local, je suis bon sur cinq choses :\n\n1. **Créer** un petit projet web — « crée un site vitrine pour un studio de yoga ».\n2. **Modifier** l’existant — « passe en violet », « rends-le plus moderne ».\n3. **Analyser** le projet — « analyse le projet ».\n4. **Expliquer** une notion technique — « c’est quoi MCP ? ».\n5. **Chercher** sur le web — « cherche la doc de l’API Open-Meteo ».\n\nPour du code plus ambitieux (React, backend, refactor), ajoute une clé dans **Paramètres → Connexion IA** : le même agent utilisera GPT, Claude, Gemini ou un modèle Ollama local, avec les mêmes outils et le même aperçu.`
  );
}

/* ── Amélioration de prompt (sans clé) ─────────────────────────────────── */

export function localUpgradePrompt(prompt) {
  const base = String(prompt || '').trim();
  if (!base) return base;
  return `${base}

## Exigences de réalisation
- Structure : fichiers séparés (HTML sémantique, CSS dans styles.css, JS dans app.js), chemins relatifs.
- Design : moderne, sombre par défaut, accent coloré, coins arrondis, ombres douces, typographie fluide avec clamp().
- Responsive : mobile first, points de rupture à 720px et 900px, menu adapté au tactile.
- Accessibilité : contraste AA, labels associés, navigation clavier, focus visible, aria quand nécessaire.
- Interactions : animations discrètes, états hover/focus, respect de prefers-reduced-motion.
- Données : persistance locale (localStorage) quand c’est pertinent, validation des saisies.
- Qualité : zéro dépendance externe, code commenté en français, pas de console.log oublié.
- Livraison : tous les fichiers complets, prêts à ouvrir dans un navigateur, plus un README avec les instructions.`;
}
