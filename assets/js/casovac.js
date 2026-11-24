/* ==========================================================================
   FK AGRO VNOROVY – ČASOVAČ SÉRIÍ
   Cvičení / výměna / pauza mezi koly. Konec každé části odťuká tónem, změnu
   ohlásí dlouhým tónem a hlasem. Vše běží v prohlížeči, nic se neukládá do
   databáze (nastavení jen v tomto zařízení, localStorage "casovac").

   Zvuk jde přes Web Audio – na iPhonu se tak MÍCHÁ s hudbou z jiné aplikace
   a nevypíná ji (značka <audio> by hudbu zastavila). Daň za to: v tichém
   režimu telefonu tóny nehrají a stránka musí zůstat na obrazovce.
   Hlášky: assets/zvuk/<klíč>.wav, texty v assets/zvuk/hlasky.json, vyrábí je
   scripts/hlasky.ps1. Po změně hlášek zvyš ZV.
   ========================================================================== */

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => "&#" + c.charCodeAt(0) + ";");
const fmt = (s) => Math.floor(s / 60) + ":" + String(Math.floor(s % 60)).padStart(2, "0");
const ZV = "?v=1";

/* hlavička (stav připojení, přihlášení) – časovač na ní nezávisí, v posilovně bývá slabý signál */
import("./core.js?v=11").then((j) => { j.initAuth(); j.whenReady(() => j.setStatus("online")); }).catch(() => {});

/* ------------------------------------------------------------ nastavení --- */

const CASY = ["cvic", "vymena", "serii", "priprava", "kol", "pauza"];             // tohle tvoří uložené nastavení
const POLE = { cvic: "nCvic", vymena: "nVymena", serii: "nSerii", priprava: "nPriprava", kol: "nKol", pauza: "nPauza" };
const HOTOVE = [
    { nazev: "Kruh 40/20", cvic: 40, vymena: 20, serii: 8, priprava: 10, kol: 1, pauza: 120 },
    { nazev: "Stanoviště 5 + 1 min", cvic: 300, vymena: 60, serii: 6, priprava: 10, kol: 1, pauza: 120 },
];

let N = { cvic: 40, vymena: 20, serii: 8, priprava: 10, kol: 1, pauza: 120, tuk: 5, pul: false, hlas: "nahrany" };
let vlastni = [];
try {
    const u = JSON.parse(localStorage.getItem("casovac") || "{}");
    if (u.n) N = { ...N, ...u.n };
    if (Array.isArray(u.sady)) vlastni = u.sady;
} catch { /* bez úložiště běží s výchozím */ }
const uloz = () => { try { localStorage.setItem("casovac", JSON.stringify({ n: N, sady: vlastni })); } catch { /* nic */ } };

/* části za sebou: příprava, pak série (cvičení + výměna), mezi koly pauza; po poslední sérii už nic */
function osa(n) {
    const f = [];
    if (n.priprava > 0) f.push({ typ: "priprava", s: n.priprava });
    for (let k = 1; k <= n.kol; k++) {
        for (let i = 1; i <= n.serii; i++) {
            f.push({ typ: "cvic", s: n.cvic, serie: i, kolo: k });
            if (i === n.serii && k === n.kol) break;
            if (i === n.serii && n.pauza > 0) f.push({ typ: "pauza", s: n.pauza });
            else if (n.vymena > 0) f.push({ typ: "vymena", s: n.vymena });
        }
    }
    let t = 0;
    for (const x of f) { x.od = t; t += x.s; x.do = t; }
    if (n.serii * n.kol > 1) f[f.length - 1].posledni = true;
    return f;
}
const delka = (n) => { const f = osa(n); return f[f.length - 1].do; };

function ctiPole(k) {
    const el = $(POLE[k]), t = el.value.trim();
    let v = parseInt(t, 10);
    if (el.dataset.typ === "cas" && t.includes(":")) { const [m, s] = t.split(":"); v = (parseInt(m, 10) || 0) * 60 + (parseInt(s, 10) || 0); }
    if (!Number.isFinite(v)) v = N[k];
    N[k] = Math.min(+el.dataset.max, Math.max(+el.dataset.min, v));
}
function ctiVse() { CASY.forEach(ctiPole); uloz(); kresli(); }

function kresli() {
    for (const k of CASY) { const el = $(POLE[k]); el.value = el.dataset.typ === "cas" ? fmt(N[k]) : N[k]; }
    $("nTuk").value = String(N.tuk);
    $("nHlas").value = N.hlas;
    $("nPul").checked = !!N.pul;
    $("polePauza").classList.toggle("is-vyp", N.kol < 2);
    $("souhrn").innerHTML = `Celkem <b>${fmt(delka(N))}</b>${N.serii} × (${fmt(N.cvic)} + ${fmt(N.vymena)})${N.kol > 1 ? `, kol: ${N.kol}` : ""}`;
    $("sady").innerHTML = [...HOTOVE, ...vlastni].map((s, i) =>
        `<span class="cas-sada${CASY.every((k) => s[k] === N[k]) ? " is-on" : ""}">` +
        `<button type="button" data-sada="${i}">${esc(s.nazev)}<small>${fmt(delka(s))}</small></button>` +
        (i >= HOTOVE.length ? `<button type="button" class="cas-sada__x" data-smaz="${i - HOTOVE.length}" aria-label="Smazat ${esc(s.nazev)}">×</button>` : "") +
        `</span>`).join("");
}

for (const k of CASY) $(POLE[k]).addEventListener("change", ctiVse);
$("nTuk").addEventListener("change", (e) => { N.tuk = +e.target.value; uloz(); });
$("nHlas").addEventListener("change", (e) => { N.hlas = e.target.value; uloz(); });
$("nPul").addEventListener("change", (e) => { N.pul = e.target.checked; uloz(); });

/* − / + : časy po 5 s (do 2 min), po 30 s (do 10 min), pak po minutě; počty po jedné */
document.querySelectorAll(".cas-krok button").forEach((b) => b.addEventListener("click", () => {
    const k = Object.keys(POLE).find((x) => POLE[x] === b.dataset.pro), el = $(POLE[k]), smer = +b.dataset.smer;
    ctiPole(k);
    let d = 1;
    if (el.dataset.typ === "cas") { const v = N[k] - (smer < 0 ? 1 : 0); d = v < 120 ? 5 : v < 600 ? 30 : 60; }
    N[k] = Math.min(+el.dataset.max, Math.max(+el.dataset.min, N[k] + smer * d));
    uloz(); kresli();
}));

$("sady").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.smaz !== undefined) vlastni.splice(+b.dataset.smaz, 1);
    else { const s = [...HOTOVE, ...vlastni][+b.dataset.sada]; for (const k of CASY) N[k] = s[k]; }
    uloz(); kresli();
});

$("ulozForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const nazev = $("ulozNazev").value.trim();
    if (!nazev) { $("ulozNazev").focus(); return; }
    ctiVse();
    const s = { nazev };
    for (const k of CASY) s[k] = N[k];
    const i = vlastni.findIndex((x) => x.nazev === nazev);
    if (i >= 0) vlastni[i] = s; else vlastni.push(s);
    $("ulozNazev").value = "";
    uloz(); kresli();
});

/* ----------------------------------------------------------------- zvuk --- */

/* iPhone: typ „ambient“ = hrát spolu s hudbou z jiných aplikací a nepřerušovat ji */
try { if (navigator.audioSession) navigator.audioSession.type = "ambient"; } catch { /* starší prohlížeč */ }

let ctx = null, texty = {}, dekodovano = null;
const surove = {}, zvuky = {};
const nacteno = fetch("assets/zvuk/hlasky.json" + ZV).then((r) => r.json()).then((t) => {
    texty = t;
    return Promise.all(Object.keys(t).map(async (k) => { surove[k] = await (await fetch(`assets/zvuk/${k}.wav${ZV}`)).arrayBuffer(); }));
}).catch(() => { /* bez hlášek zůstanou tóny */ });

/* zvuk se smí spustit až po klepnutí – volá se z tlačítek Start, Zkusit zvuk, Pokračovat */
function zvuk() {
    if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        ctx = new AC();
        dekodovano = nacteno.then(() => Promise.all(Object.keys(surove).map(async (k) => {
            try { zvuky[k] = await ctx.decodeAudioData(surove[k]); } catch { /* hláška nebude */ }
        })));
    }
    if (ctx.state !== "running") ctx.resume().catch(() => {});
    return ctx;
}
function odemkni() {
    zvuk();
    if (N.hlas === "telefon" && window.speechSynthesis) {            // hlas telefonu se taky musí poprvé spustit klepnutím
        const u = new SpeechSynthesisUtterance(" ");
        u.volume = 0; u.lang = "cs-CZ";
        speechSynthesis.speak(u);
    }
}

/* ostrý obdélníkový tón – přes hudbu je slyšet líp než čistý */
function ton(hz, za, jakDlouho, sila = 0.5) {
    if (!zvuk()) return;
    const t = ctx.currentTime + za, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = "square";
    o.frequency.value = hz;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(sila, t + 0.008);
    g.gain.setValueAtTime(sila, t + jakDlouho - 0.03);
    g.gain.linearRampToValueAtTime(0, t + jakDlouho);
    o.connect(g); g.connect(ctx.destination);
    o.start(t); o.stop(t + jakDlouho + 0.02);
}

/* hláška, která ještě nezazněla, se novou hláškou (nebo ukončením) ruší – při rychlém přeskakování se nepřekřikují */
let hlasCeka = null, hlasPoradi = 0, hlasZdroj = null;
function zrusHlas() {
    clearTimeout(hlasCeka);
    hlasPoradi++;
    try { if (hlasZdroj) hlasZdroj.stop(); } catch { /* už dohrál */ }
    hlasZdroj = null;
}
function rekni(klic, za) {
    zrusHlas();
    if (!N.hlas) return;
    if (N.hlas === "telefon") {
        if (!window.speechSynthesis || !texty[klic]) return;
        hlasCeka = setTimeout(() => { const u = new SpeechSynthesisUtterance(texty[klic]); u.lang = "cs-CZ"; speechSynthesis.speak(u); }, za * 1000);
        return;
    }
    if (!zvuk()) return;
    const kdy = ctx.currentTime + za, poradi = hlasPoradi;
    dekodovano.then(() => {
        if (poradi !== hlasPoradi || !zvuky[klic]) return;
        const s = hlasZdroj = ctx.createBufferSource();
        s.buffer = zvuky[klic];
        s.connect(ctx.destination);
        s.start(Math.max(kdy, ctx.currentTime));
    });
}

const ZVUK = {
    tuk:      () => ton(880, 0, 0.09),
    pul:      () => { ton(660, 0, 0.12); ton(660, 0.2, 0.12); rekni("polovina", 0.5); },
    priprava: () => { ton(660, 0, 0.15); rekni("priprava", 0.3); },
    cvic:     (posledni) => { ton(1320, 0, 0.7); rekni(posledni ? "posledni" : "cvicime", 0.85); },
    vymena:   () => { ton(990, 0, 0.25); ton(740, 0.3, 0.35); rekni("vymena", 0.8); },
    pauza:    () => { ton(990, 0, 0.25); ton(740, 0.3, 0.35); rekni("pauza", 0.8); },
    konec:    () => { ton(1320, 0, 0.3); ton(1320, 0.4, 0.3); ton(1320, 0.8, 0.9); rekni("konec", 1.9); },
};

$("zkusBtn").addEventListener("click", () => {
    odemkni();
    ton(880, 0, 0.09); ton(880, 1, 0.09); ton(880, 2, 0.09); ton(1320, 3, 0.7);
    rekni("vymena", 3.9);
});

/* ------------------------------------------------------------------ běh --- */

const NAZVY = { priprava: "Připravit", cvic: "Cvičíme", vymena: "Výměna", pauza: "Pauza" };
const POTOM = { cvic: "cvičení", vymena: "výměna", pauza: "pauza" };
let beh = null, interval = null, zamek = null, konecDotaz = null;

/* čas se počítá z hodin (ne sčítáním tiků) – po návratu z jiné aplikace sedí */
const ubehlo = () => beh.zaklad + (beh.od ? (Date.now() - beh.od) / 1000 : 0);

function start() {
    ctiVse();
    odemkni();
    const faze = osa(N);
    beh = { faze, celkem: faze[faze.length - 1].do, zaklad: 0, od: Date.now(), i: -1, sek: null, pul: false, ticho: 0 };
    $("beh").hidden = false;
    $("beh").classList.remove("is-stoji");
    $("behStop").textContent = "Pauza";
    document.body.classList.add("cas-bezi");
    nespi(true);
    interval = setInterval(tik, 25);                                  // krátký krok = ťukání přesně po vteřině
    tik();
}

function tik() {
    if (!beh || beh.hotovo) return;
    const t = ubehlo();
    if (t >= beh.celkem) { konec(); return; }
    let i = 0;
    while (beh.faze[i].do <= t) i++;
    const f = beh.faze[i], vFazi = t - f.od;

    if (i !== beh.i) {                                               // nová část
        beh.i = i; beh.sek = null; beh.pul = vFazi >= f.s / 2;
        if (beh.od && vFazi < 1.5) ZVUK[f.typ](f.posledni);            // po návratu doprostřed části už nehlásit
        const c = beh.faze.find((x, j) => j >= i && x.typ === "cvic"), d = beh.faze[i + 1];
        $("beh").dataset.faze = f.typ;
        $("behFaze").textContent = NAZVY[f.typ];
        $("behSerie").textContent = `Série ${c.serie} / ${N.serii}` + (N.kol > 1 ? ` · kolo ${c.kolo} / ${N.kol}` : "");
        $("behPotom").textContent = d ? `Potom: ${POTOM[d.typ]} ${fmt(d.s)}` : "Potom: konec";
    }

    const sek = Math.ceil(f.do - t);
    if (sek !== beh.sek) {                                           // nová vteřina
        const prvni = beh.sek === null;
        beh.sek = sek;
        $("behCas").textContent = fmt(sek);
        if (!prvni && beh.od && sek <= N.tuk && sek < f.s) ZVUK.tuk();
    }
    if (f.typ === "cvic" && N.pul && f.s >= 20 && !beh.pul && vFazi >= f.s / 2) { beh.pul = true; if (beh.od) ZVUK.pul(); }
    $("behPruh").style.width = (100 * vFazi / f.s).toFixed(1) + "%";

    /* upozornění: zvuk čeká na klepnutí (po hovoru, po návratu z jiné aplikace) / prohlížeč neudrží obrazovku */
    beh.ticho = ctx && ctx.state !== "running" && beh.od ? beh.ticho + 1 : 0;
    const zprava = beh.ticho > 40 ? "Zvuk je pozastavený – klepni na obrazovku."
        : !("wakeLock" in navigator) ? "Tenhle prohlížeč neudrží obrazovku rozsvícenou – vypni si v telefonu automatické zamykání." : "";
    if ($("behInfo").textContent !== zprava) { $("behInfo").textContent = zprava; $("behInfo").hidden = !zprava; }
}

function skoc(t) {
    if (t >= beh.celkem) { konec(); return; }
    beh.zaklad = t;
    if (beh.od) beh.od = Date.now();
    beh.i = -1;
    tik();
}

function konec() {
    beh.hotovo = true;
    clearInterval(interval);
    if (beh.od) ZVUK.konec();
    $("beh").dataset.faze = "konec";
    $("beh").classList.remove("is-stoji");
    $("behFaze").textContent = "Hotovo";
    $("behCas").textContent = "0:00";
    $("behSerie").textContent = "";
    $("behPotom").textContent = `Odcvičeno ${fmt(beh.celkem)}`;
    $("behInfo").hidden = true;
    $("behStop").textContent = "Zavřít";
    nespi(false);
}

function zavri() {
    clearInterval(interval);
    clearTimeout(konecDotaz);
    konecDotaz = null;
    zrusHlas();
    beh = null;
    $("beh").hidden = true;
    $("behKonec").textContent = "Ukončit";
    document.body.classList.remove("cas-bezi");
    nespi(false);
}

$("startBtn").addEventListener("click", start);
$("behStop").addEventListener("click", () => {
    if (beh.hotovo) { zavri(); return; }
    if (beh.od) { beh.zaklad = ubehlo(); beh.od = null; }             // pauza
    else { odemkni(); beh.od = Date.now(); beh.i = -1; }               // pokračovat (na začátku části ji znovu ohlásí)
    $("beh").classList.toggle("is-stoji", !beh.od);
    $("behStop").textContent = beh.od ? "Pauza" : "Pokračovat";
    tik();
});
$("behDalsi").addEventListener("click", () => skoc(beh.faze[beh.i].do));
$("behZpet").addEventListener("click", () => {                       // začátek téhle části; hned na začátku o část zpět
    const f = beh.faze[beh.i];
    skoc(ubehlo() - f.od < 2 && beh.i > 0 ? beh.faze[beh.i - 1].od : f.od);
});
$("behKonec").addEventListener("click", () => {                      // druhé klepnutí do 3 s = opravdu konec
    if (konecDotaz) { konecDotaz = null; zavri(); return; }
    $("behKonec").textContent = "Opravdu ukončit?";
    konecDotaz = setTimeout(() => { konecDotaz = null; $("behKonec").textContent = "Ukončit"; }, 3000);
});
$("beh").addEventListener("pointerdown", () => { if (ctx && ctx.state !== "running") ctx.resume().catch(() => {}); });

/* obrazovka nesmí zhasnout – se zamčeným telefonem prohlížeč čas ani zvuk nepustí */
async function nespi(zapnout) {
    try {
        if (zapnout && !zamek && navigator.wakeLock && document.visibilityState === "visible") {
            zamek = await navigator.wakeLock.request("screen");
            zamek.addEventListener("release", () => { zamek = null; });
        } else if (!zapnout && zamek) { const z = zamek; zamek = null; await z.release(); }
    } catch { zamek = null; }
}
document.addEventListener("visibilitychange", () => {
    if (!beh || beh.hotovo || document.visibilityState !== "visible") return;
    nespi(true);
    if (ctx && ctx.state !== "running") ctx.resume().catch(() => {});
    tik();
});

kresli();

/* na mobilu je lišta stránek širší než displej – ukaž v ní tuhle stránku */
document.querySelector(".subnav__link.is-active")?.scrollIntoView({ block: "nearest", inline: "center" });
