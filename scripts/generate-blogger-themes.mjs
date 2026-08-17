import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const sourcePath = resolve(root, "themes", "desk-gear-lab-geek.xml");
const source = readFileSync(sourcePath, "utf8");
const overrideStart = source.indexOf(
  "/* =========================================================\n   Desk Gear Lab / Geek Interface Theme v1",
);
const overrideEnd = source.indexOf("  ]]></b:skin>", overrideStart);

if (overrideStart < 0 || overrideEnd < 0) {
  throw new Error("Desk Gear theme override block was not found.");
}

const themes = [
  {
    file: "compatibility-database-blueprint.xml",
    color: "#081a2c",
    css: String.raw`/* =========================================================
   Compatibility Database / Blueprint Theme v1
   ========================================================= */
:root{--bg:#061422;--surface:#0b2033;--text:#e8f4fb;--muted:#8da8b9;--line:#24465e;--accent:#16d9e3;--accent-dark:#0ca7b0;--nav:#081a2c;--radius:8px;--shadow:0 14px 38px rgba(0,0,0,.25);--signal:#b5f43c;--mono:"Cascadia Code",Consolas,monospace}
body{background-color:var(--bg);background-image:linear-gradient(rgba(22,217,227,.045) 1px,transparent 1px),linear-gradient(90deg,rgba(22,217,227,.045) 1px,transparent 1px);background-size:28px 28px;color:var(--text)}
::selection{background:rgba(181,244,60,.28)}
.site-header{background:linear-gradient(110deg,#071827,#0d2a3d);border-bottom:1px solid var(--line)}
.header-inner::before{content:"COMPATIBILITY MATRIX // VERIFIED DATA";display:block;margin-bottom:10px;color:var(--signal);font:700 10px/1.4 var(--mono);letter-spacing:.14em}
.site-title{font-family:var(--mono);letter-spacing:-.035em}.site-title a::before{content:"[ ";color:var(--accent)}.site-title a::after{content:" ]";color:var(--accent)}
.site-description{color:#9db2c0}.primary-nav{background:#071522;border-bottom:1px solid var(--line)}
.nav-home{background:var(--accent);color:#031014}.menu-slot a{font-family:var(--mono);font-size:12px;color:#c5d7e1}
.post-card,.single-post,.sidebar-column .widget,.pager a{background:rgba(11,32,51,.96);border-color:var(--line);box-shadow:var(--shadow)}
.post-card{border-left:4px solid var(--accent)}.post-card-title,.single-title{color:#f5fbff}.post-snippet,.post-body{color:#c5d5df}
.post-labels a{background:rgba(181,244,60,.12);border:1px solid rgba(181,244,60,.4);color:var(--signal);border-radius:3px;font-family:var(--mono)}
.read-more{color:var(--accent);font-family:var(--mono)}.read-more::before{content:"CHECK_RESULT: "}
.post-body h2{color:#f5fbff;background:rgba(22,217,227,.08);border:1px solid var(--line);border-left:5px solid var(--accent)}
.post-body h2::before{content:"// ";color:var(--accent)}.post-body h3{color:#eaf5fa;border-color:var(--line)}
.post-body table{border:1px solid var(--line)}.post-body th{color:#061422;background:var(--accent);border-color:#0baeb7}.post-body td{border-color:var(--line)}.post-body tr:nth-child(even) td{background:rgba(22,217,227,.035)}
.post-body code{color:var(--signal);background:#04101a;border:1px solid var(--line);padding:.15em .4em;border-radius:3px}
.sidebar-column .widget-title{color:var(--accent);border-color:var(--line);font-family:var(--mono)}.sidebar-column li{border-color:#183449}.site-footer{background:#030c13;border-top:1px solid var(--line)}
.back-to-top{background:var(--signal);color:#061422}
@media(max-width:680px){.header-inner::before{font-size:8px}.primary-nav{position:relative}}`,
  },
  {
    file: "game-platform-lab-platform-grid.xml",
    color: "#130d2b",
    css: String.raw`/* =========================================================
   Game Platform Lab / Platform Grid Theme v1
   ========================================================= */
:root{--bg:#0d0a1b;--surface:#17112c;--text:#f0ecff;--muted:#9f96bd;--line:#33285a;--accent:#8d5cff;--accent-dark:#7040e6;--nav:#130d2b;--radius:12px;--shadow:0 18px 44px rgba(0,0,0,.3);--cyan:#20e0e8;--pink:#f15bb5;--mono:"Cascadia Code",Consolas,monospace}
body{background:radial-gradient(circle at 50% -10%,rgba(141,92,255,.2),transparent 38%),var(--bg);color:var(--text)}
.site-header{background:linear-gradient(120deg,#120c29,#21134a);border-bottom:1px solid var(--line)}
.header-inner::before{content:"PLATFORM / ENGINE / OWNERSHIP";display:block;margin-bottom:10px;color:var(--cyan);font:700 10px/1.4 var(--mono);letter-spacing:.16em}
.site-title{font-weight:900}.site-title a::before{content:"[GP] ";color:var(--pink);font-family:var(--mono);font-size:.72em}.site-description{color:#b0a8ca}
.primary-nav{background:rgba(13,10,27,.95);border-bottom:1px solid var(--line);backdrop-filter:blur(12px)}.nav-home{background:var(--accent)}
.menu-slot a{color:#d8d1f0}.menu-slot a:hover{background:rgba(32,224,232,.1);color:var(--cyan)}
.post-card,.single-post,.sidebar-column .widget,.pager a{background:linear-gradient(145deg,#191330,#120e23);border-color:var(--line);box-shadow:var(--shadow)}
.post-card{position:relative;overflow:hidden}.post-card::before{content:"";position:absolute;inset:0 auto 0 0;width:3px;background:linear-gradient(var(--pink),var(--accent),var(--cyan));z-index:2}
.post-card-title,.single-title{color:#fff}.post-snippet,.post-body{color:#d3cce5}.post-meta,.single-meta{color:var(--muted);font-family:var(--mono)}
.post-labels a{background:rgba(141,92,255,.16);border:1px solid rgba(141,92,255,.48);color:#cbb9ff;border-radius:999px}.read-more{color:var(--cyan);font-family:var(--mono)}
.post-body h2{color:#fff;background:linear-gradient(90deg,rgba(141,92,255,.16),rgba(32,224,232,.03));border:1px solid var(--line);border-left:5px solid var(--accent)}
.post-body h3{color:#f5f1ff;border-color:#473770}.post-body blockquote{color:#c7c0dc;background:#100c20;border-left-color:var(--pink)}
.post-body table{border:1px solid var(--line)}.post-body th{color:var(--cyan);background:#100c20}.post-body th,.post-body td{border-color:var(--line)}
.post-body code{color:var(--cyan);background:#0a0715;border:1px solid var(--line);padding:.16em .4em;border-radius:4px}
.sidebar-column .widget-title{color:#fff;border-color:var(--line)}.sidebar-column .widget-title::before{content:"PLAYER DATA // ";color:var(--pink);font:700 10px var(--mono)}.sidebar-column li{border-color:#292044}
.site-footer{background:#080613;border-top:1px solid var(--line)}.back-to-top{background:var(--cyan);color:#090615}
@media(max-width:680px){.header-inner::before{font-size:8px}.primary-nav{position:relative}}`,
  },
  {
    file: "global-app-spec-lab-app-console.xml",
    color: "#10172d",
    css: String.raw`/* =========================================================
   Global App Spec Lab / App Console Theme v1
   ========================================================= */
:root{--bg:#f3f5fb;--surface:#fff;--text:#172039;--muted:#65708a;--line:#dce2ef;--accent:#ec168c;--accent-dark:#c20e70;--nav:#10172d;--radius:14px;--shadow:0 10px 30px rgba(25,36,68,.1);--cyan:#00aeca;--indigo:#4f46e5;--mono:"Cascadia Code",Consolas,monospace}
body{background:linear-gradient(180deg,#eef2ff 0,#f7f8fc 360px);color:var(--text)}
.site-header{background:#fff;border-bottom:1px solid var(--line)}.header-inner{position:relative}.header-inner::before{content:"GLOBAL APP CHANGELOG";display:inline-block;margin-bottom:10px;padding:4px 9px;color:#fff;background:var(--accent);border-radius:999px;font:700 10px/1.4 var(--mono);letter-spacing:.12em}
.site-title{letter-spacing:-.035em}.site-title a::after{content:" ::";color:var(--cyan);font-family:var(--mono)}.site-description{color:var(--muted)}
.primary-nav{background:var(--nav)}.nav-home{background:var(--accent)}.menu-slot a:hover{background:rgba(236,22,140,.18)}
.post-card,.single-post,.sidebar-column .widget,.pager a{border-color:var(--line);border-radius:var(--radius);box-shadow:var(--shadow)}
.post-card{position:relative}.post-card::before{content:"UPDATE";position:absolute;right:14px;top:14px;z-index:3;padding:4px 8px;color:#fff;background:var(--indigo);border-radius:999px;font:700 9px var(--mono);letter-spacing:.08em}
.post-labels a{background:#fff0f8;color:var(--accent-dark);border:1px solid #fac2df;border-radius:999px}.read-more{color:var(--indigo)}
.post-body h2{background:#f6f4ff;border:1px solid #e3defc;border-left:5px solid var(--indigo);border-radius:8px}.post-body h3{border-color:#d9deeb}
.post-body blockquote{background:#edfafd;border-left-color:var(--cyan);color:#41536d;border-radius:0 8px 8px 0}
.post-body table{border:1px solid var(--line);border-radius:8px}.post-body th{background:#10172d;color:#fff}.post-body tr:nth-child(even) td{background:#f8f9fd}
.post-body code{color:#b20d68;background:#fff1f8;border:1px solid #f8c9e1;padding:.16em .42em;border-radius:4px}
.sidebar-column .widget-title{color:#202944}.sidebar-column .widget-title::before{content:"[APP] ";color:var(--cyan);font:700 10px var(--mono)}.site-footer{background:#10172d}.back-to-top{background:var(--accent)}
@media(max-width:680px){.post-card::before{top:9px;right:9px}.primary-nav{position:relative}}`,
  },
  {
    file: "pc-game-troubleshooting-diagnostic.xml",
    color: "#071623",
    css: String.raw`/* =========================================================
   PC Game Troubleshooting / Diagnostic Console Theme v1
   ========================================================= */
:root{--bg:#06101a;--surface:#0b1b29;--text:#e5f3f5;--muted:#87a1ad;--line:#244252;--accent:#39ef75;--accent-dark:#18bd50;--nav:#071623;--radius:7px;--shadow:0 15px 38px rgba(0,0,0,.28);--cyan:#19d9e6;--warn:#ffc857;--mono:"Cascadia Code",Consolas,monospace}
body{background:radial-gradient(circle at 80% 0,rgba(25,217,230,.09),transparent 34%),var(--bg);color:var(--text)}
.site-header{background:#071623;border-bottom:1px solid var(--line)}.header-inner::before{content:"DIAGNOSTIC STATUS: READY";display:block;margin-bottom:11px;color:var(--accent);font:700 10px/1.4 var(--mono);letter-spacing:.15em}
.site-title{font-family:var(--mono);letter-spacing:-.04em}.site-title a::before{content:"> ";color:var(--cyan)}.site-title a::after{content:"_";color:var(--accent)}.site-description{color:#9cb0ba}
.primary-nav{background:#040c13;border-bottom:1px solid var(--line)}.nav-home{background:var(--accent);color:#031008}.menu-slot a{font-family:var(--mono);font-size:12px;color:#c6d7dc}
.post-card,.single-post,.sidebar-column .widget,.pager a{background:linear-gradient(145deg,#0d2030,#081722);border-color:var(--line);box-shadow:var(--shadow)}
.post-card{border-top:2px solid var(--accent)}.post-card-title,.single-title{color:#f4fcfd}.post-snippet,.post-body{color:#c7d8dd}.post-meta,.single-meta{font-family:var(--mono);color:var(--muted)}
.post-labels a{background:rgba(57,239,117,.1);border:1px solid rgba(57,239,117,.38);color:var(--accent);border-radius:3px;font-family:var(--mono)}.read-more{color:var(--cyan);font-family:var(--mono)}.read-more::before{content:"RUN_FIX / "}
.post-body h2{color:#f4fcfd;background:rgba(57,239,117,.065);border:1px solid var(--line);border-left:5px solid var(--accent)}.post-body h2::before{content:"[CHECK] ";color:var(--accent);font-family:var(--mono);font-size:.75em}
.post-body h3{color:#e9f5f7;border-color:#315466}.post-body blockquote{color:#d8d1b5;background:#17170f;border-left-color:var(--warn)}
.post-body pre{position:relative;background:#02070b;border:1px solid var(--line);color:#b9f9ca;padding:38px 18px 18px}.post-body pre::before{content:"SYSTEM LOG";position:absolute;left:0;right:0;top:0;padding:7px 12px;color:var(--cyan);background:#091722;border-bottom:1px solid var(--line);font:700 10px var(--mono)}
.post-body code{color:var(--accent);font-family:var(--mono)}.post-body th{background:#071623;color:var(--cyan)}.post-body th,.post-body td{border-color:var(--line)}
.sidebar-column .widget-title{color:#edf9fa;border-color:var(--line);font-family:var(--mono)}.sidebar-column .widget-title::before{content:"$ ";color:var(--accent)}.sidebar-column li{border-color:#1b3544}.site-footer{background:#02080d;border-top:1px solid var(--line)}.back-to-top{background:var(--accent);color:#031008}
@media(max-width:680px){.header-inner::before{font-size:8px}.primary-nav{position:relative}}`,
  },
  {
    file: "repair-maintenance-lab-workshop.xml",
    color: "#232721",
    css: String.raw`/* =========================================================
   Repair and Maintenance Lab / Workshop Manual Theme v1
   ========================================================= */
:root{--bg:#f1f0e8;--surface:#fffef8;--text:#252922;--muted:#6e756a;--line:#d7d8cb;--accent:#f07818;--accent-dark:#c95b08;--nav:#232721;--radius:5px;--shadow:0 5px 18px rgba(45,49,40,.1);--green:#4ca66a;--paper:#fffef8;--mono:"Cascadia Code",Consolas,monospace}
body{background-color:var(--bg);background-image:linear-gradient(rgba(60,70,55,.035) 1px,transparent 1px);background-size:100% 28px;color:var(--text)}
.site-header{background:var(--paper);border-bottom:5px solid var(--accent)}.header-inner::before{content:"WORKSHOP MANUAL / SAFE PROCEDURE";display:inline-block;margin-bottom:10px;color:#fff;background:var(--green);padding:4px 9px;font:700 10px/1.4 var(--mono);letter-spacing:.12em}
.site-title{letter-spacing:-.035em}.site-title a::before{content:"[TOOL] ";color:var(--accent);font:700 .62em var(--mono)}.site-description{color:var(--muted)}
.primary-nav{background:var(--nav)}.nav-home{background:var(--accent)}.menu-slot a:hover{background:rgba(240,120,24,.18)}
.post-card,.single-post,.sidebar-column .widget,.pager a{background:var(--paper);border-color:var(--line);box-shadow:var(--shadow)}.post-card{border-top:4px solid var(--green)}
.post-labels a{background:#fff3e7;color:#a94700;border:1px solid #f2c59e;border-radius:3px}.read-more{color:var(--accent-dark)}
.post-body h2{background:#f7f4e9;border:1px solid var(--line);border-left:6px solid var(--accent)}.post-body h2::before{content:"STEP / ";color:var(--green);font:700 .7em var(--mono)}
.post-body h3{border-color:#bdc5b6}.post-body blockquote{background:#fff6d9;border-left-color:#e2ad20;color:#504a34}
.post-body ul{padding:16px 18px 16px 40px;background:#f4f8f2;border:1px solid #ceddcc;border-radius:5px}.post-body table{background:#fff}.post-body th{background:#30362d;color:#fff}.post-body tr:nth-child(even) td{background:#f5f4ec}
.post-body code{color:#9b4200;background:#fff0e2;border:1px solid #efcfb3;padding:.16em .42em;border-radius:3px}
.sidebar-column .widget-title{color:#30362d}.sidebar-column .widget-title::before{content:"TOOLBOX / ";color:var(--accent);font:700 10px var(--mono)}
.site-footer{background:#232721}.back-to-top{background:var(--accent)}
@media(max-width:680px){.header-inner::before{font-size:8px}.primary-nav{position:relative}}`,
  },
  {
    file: "service-change-alternatives-status.xml",
    color: "#241341",
    css: String.raw`/* =========================================================
   Service Change Alternatives / Status Board Theme v1
   ========================================================= */
:root{--bg:#f5f2fa;--surface:#fff;--text:#251b35;--muted:#736982;--line:#e3dced;--accent:#ef5d68;--accent-dark:#cf3f4b;--nav:#241341;--radius:10px;--shadow:0 9px 26px rgba(54,31,83,.1);--cyan:#06b6c9;--purple:#7446b9;--mono:"Cascadia Code",Consolas,monospace}
body{background:linear-gradient(180deg,#eee8f7 0,#faf9fc 380px);color:var(--text)}
.site-header{background:#fff;border-bottom:1px solid var(--line)}.header-inner::before{content:"SERVICE STATUS / MIGRATION / ALTERNATIVES";display:block;margin-bottom:10px;color:var(--purple);font:700 10px/1.4 var(--mono);letter-spacing:.13em}
.site-title{letter-spacing:-.04em}.site-title a::before{content:">> ";color:var(--accent);font-family:var(--mono)}.site-description{color:var(--muted)}
.primary-nav{background:var(--nav)}.nav-home{background:var(--accent)}.menu-slot a:hover{background:rgba(6,182,201,.16)}
.post-card,.single-post,.sidebar-column .widget,.pager a{border-color:var(--line);border-radius:var(--radius);box-shadow:var(--shadow)}
.post-card{position:relative;border-left:5px solid var(--cyan)}.post-card::after{content:"STATUS UPDATE";position:absolute;right:14px;top:14px;padding:4px 8px;color:#fff;background:var(--accent);border-radius:999px;font:700 9px var(--mono);letter-spacing:.06em}
.post-labels a{background:#f2ecfb;color:#5d329c;border:1px solid #d8c5f1;border-radius:999px}.read-more{color:var(--purple)}
.post-body h2{background:#f8f4fc;border:1px solid var(--line);border-left:5px solid var(--purple)}.post-body h2::before{content:"CHANGE / ";color:var(--accent);font:700 .7em var(--mono)}
.post-body h3{border-color:#ddd2e9}.post-body blockquote{background:#eefbfc;border-left-color:var(--cyan);color:#3e5860}
.post-body table{border:1px solid var(--line)}.post-body th{background:var(--nav);color:#fff}.post-body tr:nth-child(even) td{background:#faf7fc}
.post-body code{color:#a82f3a;background:#fff0f1;border:1px solid #f5c8cc;padding:.16em .42em;border-radius:4px}
.sidebar-column .widget-title::before{content:"STATUS / ";color:var(--cyan);font:700 10px var(--mono)}.site-footer{background:var(--nav)}.back-to-top{background:var(--accent)}
@media(max-width:680px){.post-card::after{display:none}.primary-nav{position:relative}}`,
  },
  {
    file: "travel-rules-lab-passport.xml",
    color: "#092b52",
    css: String.raw`/* =========================================================
   Travel Rules Lab / Passport and Rules Theme v1
   ========================================================= */
:root{--bg:#f2f6f9;--surface:#fff;--text:#182c3e;--muted:#65798a;--line:#d8e2e9;--accent:#ef6548;--accent-dark:#ca472d;--nav:#092b52;--radius:6px;--shadow:0 7px 22px rgba(20,53,80,.1);--blue:#2c91cf;--gold:#e3ad3b;--mono:"Cascadia Code",Consolas,monospace}
body{background:linear-gradient(180deg,#e8f2f8 0,#f7f9fb 420px);color:var(--text)}
.site-header{background:#fff;border-bottom:1px solid var(--line)}.header-inner::before{content:"ENTRY RULES / TRANSPORT / PASSENGER RIGHTS";display:block;margin-bottom:10px;color:var(--blue);font:700 10px/1.4 var(--mono);letter-spacing:.12em}
.site-title{letter-spacing:-.035em}.site-title a::before{content:"[AIR] ";color:var(--accent);font:700 .62em var(--mono)}.site-description{color:var(--muted)}
.primary-nav{background:var(--nav)}.nav-home{background:var(--accent)}.menu-slot a:hover{background:rgba(44,145,207,.25)}
.post-card,.single-post,.sidebar-column .widget,.pager a{border-color:var(--line);border-radius:var(--radius);box-shadow:var(--shadow)}.post-card{border-top:4px solid var(--blue)}
.post-labels a{background:#eaf6fc;color:#176b9e;border:1px solid #b8ddef;border-radius:3px}.read-more{color:var(--accent-dark)}
.post-body h2{background:#eef7fc;border:1px solid #d5e8f2;border-left:5px solid var(--blue)}.post-body h2::before{content:"RULE / ";color:var(--accent);font:700 .7em var(--mono)}
.post-body h3{border-color:#ccdbe4}.post-body blockquote{background:#fff8e8;border-left-color:var(--gold);color:#564b32}
.post-body table{border:1px solid var(--line)}.post-body th{background:var(--nav);color:#fff}.post-body tr:nth-child(even) td{background:#f5f9fb}
.post-body code{color:#a33c28;background:#fff1ed;border:1px solid #f2cdc4;padding:.16em .42em;border-radius:3px}
.sidebar-column .widget-title::before{content:"TRAVEL FILE / ";color:var(--accent);font:700 10px var(--mono)}.site-footer{background:var(--nav)}.back-to-top{background:var(--accent)}
@media(max-width:680px){.header-inner::before{font-size:8px}.primary-nav{position:relative}}`,
  },
];

function renderTheme(theme) {
  return (
    source.slice(0, overrideStart) +
    theme.css.trimEnd() +
    "\n" +
    source.slice(overrideEnd)
  ).replace(
    /<meta content='#[0-9a-fA-F]{6}' name='theme-color'\/>/,
    `<meta content='${theme.color}' name='theme-color'/>`,
  );
}

function validateTheme(xml, file) {
  const required = [
    "<?xml version=\"1.0\" encoding=\"UTF-8\" ?>",
    "<b:skin><![CDATA[",
    "]]></b:skin>",
    "<b:section",
    "<b:widget",
    "</body>",
    "</html>",
  ];
  for (const token of required) {
    if (!xml.includes(token)) throw new Error(`${file}: missing ${token}`);
  }
  for (const tag of ["b:if", "b:loop", "b:section", "b:widget", "b:includable"]) {
    const opens = xml.match(new RegExp(`<${tag}(?:\\s|>)`, "g"))?.length ?? 0;
    const closes = xml.match(new RegExp(`</${tag}>`, "g"))?.length ?? 0;
    const selfClosing =
      xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?\\/>`, "g"))?.length ?? 0;
    if (opens - selfClosing !== closes) {
      throw new Error(
        `${file}: ${tag} count mismatch (${opens}/${closes}, ${selfClosing} self-closing)`,
      );
    }
  }
}

const check = process.argv.includes("--check");
let changed = false;

for (const theme of themes) {
  const outputPath = resolve(root, "themes", theme.file);
  const expected = renderTheme(theme);
  validateTheme(expected, theme.file);
  if (check) {
    const actual = readFileSync(outputPath, "utf8");
    if (actual !== expected) {
      changed = true;
      console.error(`${theme.file}: generated output is stale`);
    }
  } else {
    writeFileSync(outputPath, expected, "utf8");
    console.log(`generated themes/${theme.file}`);
  }
}

if (check && changed) process.exitCode = 1;
if (check && !changed) console.log(`${themes.length} generated themes are current`);
