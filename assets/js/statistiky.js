/* ==========================================================================
   FK AGRO VNOROVY · Statistiky hráčů (áčko, béčko, dorost)
   Data = zápisy o utkání z fotbal.cz, uložené ve Firestore v kolekci
   `statistiky` (dokument na sezónu `s2023`…, pole `data` = JSON se zápasy).
   Nahrává je Claude přes Chrome (fotbal.cz skripty mimo prohlížeč blokuje).
   Všechno ostatní se počítá tady v prohlížeči.
   ========================================================================== */

import { getDocs } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { col, whenReady, onDbError, setStatus, esc, slug } from "./core.js?v=11";

const TEAMS = { A: "A tým", B: "B tým", D: "Dorost" };
const MIN_PRO_POMER = 300;          // od kolika minut ukazovat góly na 90 min
const DELKA = 90;                   // délka zápasu (dospělí i starší dorost)

const st = { matches: [], old: [], tables: [], rodiny: {}, recMode: (() => { try { return localStorage.getItem("statRecMode") || "prehled"; } catch { return "prehled"; } })(), tabTeam: "all", benfika: [], bfSez: null, bfCast: "vse", bfSort: "b", bfOtevreny: null, team: "all", from: null, to: null, seasons: new Set(), allSeasons: [], comps: new Set(), q: "", sort: "min", dir: -1, players: new Map() };

/* ------------------------------------------------------------ načtení ---- */

whenReady(async () => {
    try {
        const snap = await getDocs(col("statistiky"));
        let upd = "", is = [], asist = [];
        snap.forEach(d => {
            const x = d.data();
            try {                                         // jeden poškozený dokument nesmí shodit celou stránku
                if (d.id === "rodiny") { const r = JSON.parse(x.data || "{}"); if (r && typeof r === "object") st.rodiny = r; return; }
                if (d.id === "benfika") { const b = JSON.parse(x.benfika || "[]"); if (Array.isArray(b)) st.benfika = b; return; }
                if (d.id === "asistence") { asist = JSON.parse(x.data || "[]"); st.asistZdroj = String(x.zdroj || ""); return; }
                if (d.id === "is" && x.souhrny) is = JSON.parse(x.souhrny).filter(c => c && Array.isArray(c.rows));
                if (d.id === "tabulky" && x.tabulky) st.tables = JSON.parse(x.tabulky);
                if (x.data) JSON.parse(x.data).forEach(m => st.matches.push(m));
                if (x.aktualizovano && x.aktualizovano > upd) upd = x.aktualizovano;
            } catch (e) { console.warn("Statistiky: dokument", d.id, "se nedá přečíst", e); }
        });
        cistaData();
        asistence(asist);
        nactiIS(is, sjednotJmena(st.matches, is));
        st.matches.forEach(m => { m.t = teamOf(m); m.u = uroven(m.c); });
        pohary();
        st.old.forEach(o => { o.t = teamOf(o); o.u = uroven(o.c); });
        st.tables.forEach(t => { t.nas = t.rows.find(r => /vnorov/i.test(r[1])); t.t = teamOf({ c: t.c, vn: t.nas ? t.nas[1] : "" }); t.u = uroven(t.c); });
        st.tables = st.tables.filter(t => t.nas);
        st.matches.sort((a, b) => (a.d || "").localeCompare(b.d || ""));
        document.getElementById("updInfo").textContent = upd ? "aktualizováno " + new Date(upd).toLocaleDateString("cs-CZ") : "";
        setStatus("online");
        buildFilters();
        route();
    } catch (err) { onDbError(err); document.getElementById("loadInfo").textContent = "Data se nepodařilo načíst."; }
});

window.addEventListener("hashchange", route);

function teamOf(m) {
    if (/dorost/i.test(m.c)) return "D";
    if (/\bB\b/.test(m.vn || "")) return "B";          // „Vnorovy B“, „Vnorovy ,,B''“
    return "A";
}
/** Pohár nemusí mít v názvu A/B – tým se určí podle hráčů, kteří v té sezóně hráli ligu za A nebo B. */
function pohary() {
    const liga = {};
    st.matches.filter(m => !/pohár/i.test(m.c) && m.t !== "D").forEach(m => (m.lu || []).forEach(r => {
        const k = m.s + "|" + r[0]; liga[k] = liga[k] || { A: 0, B: 0 }; liga[k][m.t]++;
    }));
    st.matches.filter(m => /pohár/i.test(m.c) && m.t !== "D" && (m.lu || []).length).forEach(m => {
        let a = 0, b = 0;
        m.lu.forEach(r => { const x = liga[m.s + "|" + r[0]]; if (x) { if (x.A >= x.B) a++; else b++; } });
        m.t = b > a ? "B" : "A";
    });
}

/** Čísla z databáze jako čísla a texty jako texty – do stránky se pak nedostane nic jiného (data zapisuje anonymní účet). */
function cistaData() {
    const n = x => (x == null || x === "" || !Number.isFinite(+x) ? null : +x);
    const s = x => String(x ?? "");
    const gol = g => [s(g[0]), n(g[1]) ?? 0, g[2] ? 1 : 0, g[3] ? 1 : 0];
    st.matches = st.matches.filter(m => m && Number.isFinite(+m.s)).map(m => ({
        ...m, id: s(m.id), vn: s(m.vn), o: s(m.o), c: s(m.c), d: s(m.d), h: m.h ? 1 : 0, s: +m.s,
        k: n(m.k), f: n(m.f), a: n(m.a), hf: n(m.hf), ha: n(m.ha),
        pen: Array.isArray(m.pen) && m.pen.length === 2 ? [n(m.pen[0]) ?? 0, n(m.pen[1]) ?? 0] : null,
        lu: (m.lu || []).map(r => [s(r[0]), r[1] ? 1 : 0, n(r[2]), n(r[3]), n(r[4]), r[5] ? s(r[5]) : null, s(r[6]), r[7] ? 1 : 0]),
        g: (m.g || []).map(gol), ga: (m.ga || []).map(gol)
    }));
    st.tables = st.tables.filter(t => t && Array.isArray(t.rows)).map(t => ({
        ...t, s: +t.s, c: s(t.c), id: s(t.id), stav: t.stav === "p" || t.stav === "n" ? t.stav : "",
        rows: t.rows.map(r => [n(r[0]) ?? 0, s(r[1]), n(r[2]) ?? 0, n(r[3]) ?? 0, n(r[4]) ?? 0, n(r[5]) ?? 0, s(r[6]), n(r[7]) ?? 0])
    }));
}

/** Asistence z vlastní evidence (FAČR je nevede): [{id zápasu, a: [[minuta gólu, kdo přihrál, nejisté]]}]. */
function asistence(seznam) {
    const podleId = new Map(st.matches.map(m => [m.id, m]));
    for (const z of Array.isArray(seznam) ? seznam : []) {
        const m = podleId.get(String(z && z.id));
        if (!m) continue;
        m.asist = 1;
        for (const [min, kdo, nej, oprava] of z.a || []) {
            const g = m.g.find(g => g[1] === +min && !g[3] && !g[4] && !g[6]) || m.g.find(g => g[1] === +min && g[3] && !g[4]);
            if (!g) continue;
            if (oprava) { g[6] = g[0]; g[0] = String(oprava); }        // střelec opravený podle Michala, g[6] = jméno ze zápisu FAČR
            if (kdo) { g[4] = String(kdo); g[5] = nej ? 1 : 0; }
        }
    }
}

/** Stejný hráč bývá v zápisech zapsaný různě (bez háčku, i/y, jméno před příjmením) a měl by pak dvě karty.
    Zápisy se stejným klíčem (bez diakritiky, y = i, slova podle abecedy) se sjednotí na ten naposledy použitý.
    Přepíše jména v zápasech a vrátí funkci pro jména z IS. */
function sjednotJmena(matches, souteze) {
    const klic = n => n.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/y/g, "i").split(/\s+/).sort().join(" ");
    const tvary = {};                                  // klíč → {zápis jména: [naposledy, kolikrát]}
    const vid = (n, kdy) => { const x = (tvary[klic(n)] = tvary[klic(n)] || {}), y = (x[n] = x[n] || ["", 0]); if (kdy > y[0]) y[0] = kdy; y[1]++; };
    matches.forEach(m => { (m.lu || []).forEach(r => vid(r[0], m.d || "")); (m.g || []).forEach(g => { if (!g[3]) vid(g[0], m.d || ""); }); });
    souteze.forEach(c => c.rows.forEach(r => vid(`${r[2]} ${r[1]}`.trim(), String(c.s))));
    const kanon = {};
    for (const x of Object.values(tvary)) {
        const v = Object.entries(x);
        if (v.length < 2) continue;
        const nej = v.sort((a, b) => b[1][0].localeCompare(a[1][0]) || b[1][1] - a[1][1])[0][0];
        v.forEach(([n]) => { if (n !== nej) kanon[n] = nej; });
    }
    const k = n => kanon[n] || n;
    matches.forEach(m => {
        (m.lu || []).forEach(r => { r[0] = k(r[0]); if (r[5]) r[5] = k(r[5]); });
        (m.g || []).forEach(g => { if (!g[3]) g[0] = k(g[0]); if (g[4]) g[4] = k(g[4]); });
        (m.ga || []).forEach(g => { if (g[3]) g[0] = k(g[0]); });
    });
    return k;
}

/** Statistiky soutěží ze starého IS FAČR: řádek [id, jméno, příjmení, tým, G, Z, ŽK, ČK, min] → skupiny podle týmu. */
function nactiIS(souteze, k = n => n) {
    /* jmenovci (otec a syn …) mají v IS různé ID: čisté jméno dostane ten, kdo hrál nejpozději (navazuje na zápisy
       od 2020/21, kde ID není), ostatní „(ročník RRRR)“ – ročník = první dvě číslice ID */
    const podleJmena = {};
    souteze.forEach(c => c.rows.forEach(r => {
        const n = k(`${r[2]} ${r[1]}`.trim()), x = (podleJmena[n] = podleJmena[n] || {});
        x[r[0]] = x[r[0]] || { s: 0, z: 0 }; x[r[0]].s = Math.max(x[r[0]].s, c.s); x[r[0]].z += +r[5] || 0;
    }));
    const jmeno = {};
    for (const [n, ids] of Object.entries(podleJmena)) {
        const poradi = Object.entries(ids).sort((a, b) => b[1].s - a[1].s || b[1].z - a[1].z);
        poradi.forEach(([id], i) => { const rr = +id.slice(0, 2); jmeno[id] = i === 0 ? n : `${n} (ročník ${rr > 30 ? 1900 + rr : 2000 + rr})`; });
    }
    for (const c of souteze) {
        const tymy = new Map();
        for (const r of c.rows) {
            const vn = r[3];
            if (!tymy.has(vn)) tymy.set(vn, []);
            tymy.get(vn).push([jmeno[r[0]] || k(`${r[2]} ${r[1]}`.trim()), +r[4] || 0, +r[6] || 0, +r[7] || 0, +r[5] || 0, +r[8] || 0]);
        }
        for (const [vn, rows] of tymy) st.old.push({ s: c.s, c: c.c, vn, rows });
    }
}

/** Soutěž sjednocená přes přejmenování (od 2025/26 se krajské a okresní třídy jmenují „N. liga“). */
function uroven(c) {
    c = c || "";
    if (/dorost/i.test(c)) {
        const druh = /mladší/i.test(c) ? "ml. dorost" : "dorost";
        if (/4\. liga|krajský přebor/i.test(c) || /\bKP\b/.test(c)) return `Krajský přebor – ${druh}`;
        if (/5\. liga|(^|[^I])I\.\s*tř|(^|[^I])I\.\s*A|krajská/i.test(c)) return `Krajská soutěž – ${druh}`;
        return `Okresní přebor – ${druh}`;
    }
    if (/pohár/i.test(c)) return /krajsk/i.test(c) ? "Krajský pohár" : "Okresní pohár";
    if (/5\. liga|krajský přebor/i.test(c)) return "Krajský přebor (5. liga)";
    if (/9\. liga|III/.test(c)) return "III. třída (9. liga)";      // před I.A/I.B – „III.A“ obsahuje „I.A“
    if (/IV\./.test(c)) return "IV. třída";
    if (/6\. liga|I\.\s*A/.test(c)) return "I.A třída (6. liga)";
    if (/7\. liga|I\.\s*B/.test(c)) return "I.B třída (7. liga)";
    if (/8\. liga|OP muži|okresní přebor/i.test(c)) return "Okresní přebor (8. liga)";
    return c;
}
const UROVNE_PORADI = ["Krajský přebor (5. liga)", "I.A třída (6. liga)", "I.B třída (7. liga)", "Okresní přebor (8. liga)", "III. třída (9. liga)", "IV. třída", "Krajský pohár", "Okresní pohár"];
const poradi = u => { const i = UROVNE_PORADI.indexOf(u); return i < 0 ? 50 + u.charCodeAt(0) : i; };

const seasonLbl = s => `${s}/${String((s + 1) % 100).padStart(2, "0")}`;
const czd = iso => { if (!iso) return ""; const [y, mo, d] = iso.split("-"); return `${+d}. ${+mo}. ${y}`; };
const fmt = n => n.toLocaleString("cs-CZ");
const r1 = n => (Math.round(n * 100) / 100).toLocaleString("cs-CZ");
const goly = n => `${n} ${n === 1 ? "gól" : n >= 2 && n <= 4 ? "góly" : "gólů"}`;

/* --------------------------------------------------------- výpočet ---- */

/** Kdo kdy hrál: z řádku sestavy udělá {in, out} nebo null (jen na lavičce). */
function cas(row) {
    const [, start, sub, , ck] = row;
    let tin = null, tout = null;
    if (start) { tin = 0; tout = sub != null ? Math.min(sub, DELKA) : DELKA; }
    else if (sub != null) { tin = Math.min(sub, DELKA); tout = DELKA; }
    if (tin == null) return null;
    if (ck != null) tout = Math.max(tin, Math.min(tout, ck));
    return { tin, tout, min: tout - tin };
}

/** V / R / P z pohledu Vnorov; pohárový zápas po remíze rozhodnou penalty (m.pen = [naše, soupeře]). */
function vysledek(m) {
    if (m.f == null) return null;
    const [x, y] = m.f === m.a && m.pen ? m.pen : [m.f, m.a];
    return x > y ? "V" : x === y ? "R" : "P";
}

/** Spočítá statistiky všech hráčů pro zvolený filtr. */
function compute(matches, old = []) {
    const P = new Map();
    const get = (n) => {
        if (!P.has(n)) P.set(n, {
            name: n, id: slug(n), teams: new Set(), seasons: new Set(), apps: 0, starts: 0, subIn: 0, bench: 0, min: 0, full: 0,
            goals: 0, goalsLu: 0, assists: 0, kbG: 0, kbApps: 0, kbMin: 0, prihral: {}, odKoho: {}, pens: 0, subGoals: 0, og: 0, zk: 0, ck: 0, kap: 0, pos: {}, gMin: [], home: 0, away: 0,
            h1: 0, h2: 0, bands: [0, 0, 0, 0, 0, 0], perMatch: [], vsOpp: {}, partners: {}, multi: 0, hat: 0, best: null
        });
        return P.get(n);
    };
    for (const m of matches) {
        const lu = m.lu || [];
        const inMatch = new Map();
        for (const row of lu) {
            const p = get(row[0]);
            const c = cas(row);
            inMatch.set(row[0], { row, c });
            if (row[6] && row[6] !== "N") p.pos[row[6]] = (p.pos[row[6]] || 0) + 1;
            if (row[7]) p.kap++;
            if (row[3] != null) p.zk++;
            if (row[4] != null) p.ck++;
            if (!c) { p.bench++; continue; }
            p.teams.add(m.t); p.seasons.add(m.s);
            p.apps++; p.min += c.min;
            if (row[1]) p.starts++; else p.subIn++;
            if (c.tin === 0 && c.tout === DELKA) p.full++;
            if (row[5]) { const k = row[5]; p.partners[k] = (p.partners[k] || 0) + 1; }
            if (m.asist) { p.kbApps++; p.kbMin += c.min; }
        }
        const gBy = {};
        for (const [n, mn, pen, own] of (m.g || [])) {
            if (own) continue;
            const p = get(n);
            p.teams.add(m.t); p.seasons.add(m.s);
            p.goals++; gBy[n] = (gBy[n] || 0) + 1;
            if (pen) p.pens++;
            if (lu.length) p.goalsLu++;
            p.gMin.push(mn);
            p.bands[Math.min(5, Math.max(0, Math.floor((mn - 1) / 15)))]++;
            if (mn <= 45) p.h1++; else p.h2++;
            if (m.h) p.home++; else p.away++;
            p.vsOpp[m.o] = (p.vsOpp[m.o] || 0) + 1;
            const im = inMatch.get(n);
            if (im && im.c && !im.row[1]) p.subGoals++;
        }
        if (m.asist) for (const g of m.g) {
            if (!g[3]) get(g[0]).kbG++;
            if (!g[4]) continue;
            const a = get(g[4]);
            a.assists++;
            if (g[3]) continue;                          // vlastní gól soupeře: asistence ano, „přihrál komu“ ne
            a.prihral[g[0]] = (a.prihral[g[0]] || 0) + 1;
            const s = get(g[0]); s.odKoho[g[4]] = (s.odKoho[g[4]] || 0) + 1;
        }
        for (const [n, , , own] of (m.ga || [])) if (own && inMatch.has(n)) get(n).og++;
        for (const [n, k] of Object.entries(gBy)) {
            const p = get(n);
            if (k >= 2) p.multi++;
            if (k >= 3) p.hat++;
            if (!p.best || k > p.best.k) p.best = { k, m };
        }
        const names = new Set([...inMatch.keys(), ...Object.keys(gBy), ...m.g.filter(g => g[4]).map(g => g[4])]);
        for (const n of names) {
            const im = inMatch.get(n);
            get(n).perMatch.push({ m, c: im ? im.c : null, row: im ? im.row : null, g: (m.g || []).filter(x => x[0] === n && !x[3]) });
        }
    }
    /* sezóny bez sestav (do 2022/23) ze statistik soutěží IS FAČR: zápasy, minuty, karty;
       góly do 2019/20 (od 2020/21 jsou góly ze zápisů a tam se jen přičtou do poměru gólů na minutu) */
    const seSestavou = new Set(matches.filter(m => (m.lu || []).length).map(m => `${m.s}|${m.t}|${m.u}`));
    for (const o of old) {
        if (o.s >= 2023 || seSestavou.has(`${o.s}|${o.t}|${o.u}`)) continue;
        for (const [n, g, zk, ck, z, mn] of o.rows) {
            const p = get(n);
            p.teams.add(o.t); p.seasons.add(o.s);
            p.apps += z; p.isApps = (p.isApps || 0) + z; p.min += mn; p.zk += zk; p.ck += ck;
            p.goalsLu += g;
            if (o.s < 2020) { p.goals += g; p.oldGoals = (p.oldGoals || 0) + g; }
        }
    }
    for (const p of P.values()) {
        p.g90 = p.min >= MIN_PRO_POMER ? p.goalsLu * 90 / p.min : null;
        p.kb = p.kbG + p.assists;
        p.posMain = Object.entries(p.pos).sort((a, b) => b[1] - a[1])[0]?.[0] || "";
    }
    return P;
}

const vyber = x => (st.team === "all" || x.t === st.team) && (!st.seasons.size || st.seasons.has(x.s)) && (!st.comps.size || st.comps.has(x.u));
function filtered() { return st.matches.filter(vyber); }
function filteredOld() { return st.old.filter(vyber); }

/* ----------------------------------------------------------- filtry ---- */

/* rychlé skupiny soutěží (úrovně): kraj = I.B třída a výš, okres = okresní přebor a níž, dorost */
const SKUPINY = {
    "I.B a výš": c => /^(Krajský přebor \(|I\.A |I\.B |Krajský pohár)/.test(c),
    "Okres": c => /^(Okresní přebor \(|III\. |IV\. |Okresní pohár)/.test(c),
    "Dorost": c => / – (ml\. )?dorost$/.test(c)
};

/* ------------------------------------------------- levá lišta sekcí ---- */

const SEKCE = [["teamsSec", "Týmy"], ["recordsSec", "Rekordy"], ["tableSec", "Všichni hráči"], ["kanadskeSec", "Kanadské bodování"], ["benfikaSec", "Benfika – evidence"],
    ["brankariSec", "Brankáři"], ["plusminusSec", "+/− na hřišti"], ["seasonTopSec", "Góly za sezónu"], ["rodinySec", "Rodinné góly"], ["tabulkySec", "Ligové tabulky"]];

function renderNav() {
    const nav = document.getElementById("sideNav");
    nav.innerHTML = `<button type="button" class="st-side__btn" aria-expanded="false">☰ Sekce</button><div class="st-side__list">
        <a href="#" data-sek="top">↑ Nahoru (filtry)</a>
        ${SEKCE.filter(([id]) => !document.getElementById(id).hidden).map(([id, l]) => `<a href="#" data-sek="${id}">${l}</a>`).join("")}</div>`;
    nav.onclick = (e) => {
        if (e.target.closest(".st-side__btn")) { nav.classList.toggle("is-open"); return; }
        const a = e.target.closest("[data-sek]"); if (!a) return;
        e.preventDefault(); nav.classList.remove("is-open");
        if (a.dataset.sek === "top") { window.scrollTo({ top: 0, behavior: "smooth" }); return; }
        const sec = document.getElementById(a.dataset.sek);
        const det = sec.querySelector("details"); if (det) det.open = true;         // sbalenou sekci rovnou rozbalit
        sec.scrollIntoView({ behavior: "smooth", block: "start" });
    };
    hlidejSekce();
}

/** Výška lepivých filtrů → odsazení sekcí při skoku a pozice levé lišty; zvýraznění sekce, kde právě jsem. */
let pozorovatel = null;
function hlidejSekce() {
    const bar = document.getElementById("filterBar");
    const nastav = () => document.documentElement.style.setProperty("--fbar-h", (bar.hidden ? 0 : bar.offsetHeight) + "px");
    nastav();
    if (!window.__fbarHlidac) { window.__fbarHlidac = 1; window.addEventListener("resize", nastav); }
    if (pozorovatel) pozorovatel.disconnect();
    pozorovatel = new IntersectionObserver((zaznamy) => {
        zaznamy.forEach(z => {
            if (!z.isIntersecting) return;
            document.querySelectorAll("#sideNav [data-sek]").forEach(a => a.classList.toggle("is-on", a.dataset.sek === z.target.id));
        });
    }, { rootMargin: "-30% 0px -60% 0px" });
    SEKCE.forEach(([id]) => { const s = document.getElementById(id); if (s && !s.hidden) pozorovatel.observe(s); });
}

function buildFilters() {
    const seg = document.getElementById("teamSeg");
    const opts = [["all", "Všechny"], ...Object.entries(TEAMS)];
    seg.innerHTML = opts.map(([k, l]) => `<button type="button" data-k="${k}" class="${k === st.team ? "is-on" : ""}">${l}</button>`).join("");
    seg.onclick = (e) => { const b = e.target.closest("button"); if (!b) return; st.team = b.dataset.k; seg.querySelectorAll("button").forEach(x => x.classList.toggle("is-on", x === b)); drawChips(); renderOverview(); };

    const sChips = document.getElementById("seasonChips"), cChips = document.getElementById("compChips");
    /* nabízí se jen sezóny a soutěže, které má vybraný tým; vybrané, co tým nemá, se zruší */
    const drawChips = () => {
        const zdroj = [...st.matches, ...st.old].filter(x => st.team === "all" || x.t === st.team);
        const seasons = [...new Set(zdroj.map(x => x.s))].sort((a, b) => b - a);
        const comps = [...new Set(zdroj.map(x => x.u))].sort((a, b) => poradi(a) - poradi(b) || a.localeCompare(b, "cs"));
        [...st.seasons].forEach(s => { if (!seasons.includes(s)) st.seasons.delete(s); });
        [...st.comps].forEach(c => { if (!comps.includes(c)) st.comps.delete(c); });
        st.allSeasons = seasons;
        sChips.innerHTML = seasons.map(s => `<button type="button" class="st-cchip st-cchip--s ${st.seasons.has(s) ? "is-on" : ""}" data-s="${s}">${seasonLbl(s)}</button>`).join("");
        const skupiny = Object.entries(SKUPINY).map(([nazev, f]) => [nazev, comps.filter(f)]).filter(([, cs]) => cs.length);
        const stejne = cs => cs.length === st.comps.size && cs.every(c => st.comps.has(c));
        cChips.innerHTML = skupiny.map(([nazev, cs]) => `<button type="button" class="st-cchip st-cchip--g ${stejne(cs) ? "is-on" : ""}" data-g="${esc(nazev)}" title="${esc(cs.join(", "))}">${esc(nazev)}</button>`).join("")
            + `<span class="st-chips__sep"></span>`
            + comps.map(c => `<button type="button" class="st-cchip ${st.comps.has(c) ? "is-on" : ""}" data-c="${esc(c)}">${esc(c)}</button>`).join("");
        st.skupinyAkt = Object.fromEntries(skupiny);
    };
    window.__drawChips = drawChips;
    drawChips();
    sChips.onclick = (e) => { const b = e.target.closest("button"); if (!b) return; const s = +b.dataset.s; st.seasons.has(s) ? st.seasons.delete(s) : st.seasons.add(s); drawChips(); renderOverview(); };
    cChips.onclick = (e) => {
        const b = e.target.closest("button"); if (!b) return;
        if (b.dataset.g) {                                  // skupina: zapne právě její soutěže, druhý klik zruší
            const cs = st.skupinyAkt[b.dataset.g] || [];
            const uz = cs.length === st.comps.size && cs.every(c => st.comps.has(c));
            st.comps = new Set(uz ? [] : cs);
        } else { const c = b.dataset.c; st.comps.has(c) ? st.comps.delete(c) : st.comps.add(c); }
        drawChips(); renderOverview();
    };
    document.getElementById("seasonAll").onclick = () => { st.seasons.clear(); drawChips(); renderOverview(); };
    document.getElementById("compAll").onclick = () => { st.comps.clear(); drawChips(); renderOverview(); };
    document.getElementById("searchInp").oninput = (e) => { st.q = e.target.value.trim().toLowerCase(); renderTable(); };
}

/* ------------------------------------------------------------ routing ---- */

function route() {
    const m = location.hash.match(/^#hrac=(.+)$/);
    const ov = document.getElementById("viewOverview"), pv = document.getElementById("viewPlayer");
    document.getElementById("filterBar").hidden = !!m;
    document.getElementById("sideNav").hidden = !!m;
    document.getElementById("stLayout").classList.toggle("is-hrac", !!m);
    if (m) { ov.hidden = true; pv.hidden = false; let id = m[1]; try { id = decodeURIComponent(id); } catch { /* poškozený odkaz → „Hráč nenalezen“ */ } renderPlayer(id); window.scrollTo(0, 0); }
    else { pv.hidden = true; ov.hidden = false; renderOverview(); }
}

/* ----------------------------------------------------------- přehled ---- */

function renderOverview() {
    const vybr = st.seasons.size ? [...st.seasons] : st.allSeasons;      // rozsah pro popis a poznámky o zdrojích
    st.from = vybr.length ? Math.min(...vybr) : 0; st.to = vybr.length ? Math.max(...vybr) : 0;
    const ms = filtered();
    st.players = compute(ms, filteredOld());
    document.getElementById("loadInfo").hidden = true;
    ["teamsSec", "recordsSec", "seasonTopSec", "tableSec"].forEach(id => document.getElementById(id).hidden = false);
    DETAIL.length = 0;
    const rod = rodiny(ms);
    renderPopis(ms);
    renderTeams(ms);
    renderTabulky();
    renderRecords(ms, rod);
    renderSeasonTop(ms, filteredOld());
    renderKanadske(ms);
    renderBenfika();
    renderBrankari(ms);
    renderPlusMinus(ms);
    renderRodiny(rod);
    renderTable();
    renderNav();
}

/* ------------------------------------------- rozkliknutí a zápis ---- */

const DETAIL = [];            // co se má ukázat po kliknutí na dlaždici (index v data-det)

document.addEventListener("click", (e) => {
    if (e.target.closest(".st-rec a, .st-team a")) return;           // jméno vede na kartu hráče
    const d = e.target.closest("[data-det]");
    if (d) { otevriDetail(DETAIL[+d.dataset.det]); return; }
    const z = e.target.closest("[data-zap]");
    if (z) { prepniZapis(z); return; }
    const t = e.target.closest("[data-tab]");
    if (t) { prepniTabulku(t); return; }
    if (e.target.closest("[data-zavrit]") || e.target.id === "detailOverlay") zavriDetail();
});
document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") zavriDetail();
    if (e.key !== "Enter" || !e.target.matches) return;
    if (e.target.matches(".st-rec")) otevriDetail(DETAIL[+e.target.dataset.det]);
    if (e.target.matches("[data-zap]")) prepniZapis(e.target);
    if (e.target.matches("[data-tab]")) prepniTabulku(e.target);
});
function zavriDetail() { const o = document.getElementById("detailOverlay"); if (o) o.classList.remove("is-open"); document.body.style.overflow = ""; }

const ZAP = new Map();        // id zápasu → zápas (pro rozbalení zápisu)
function radekZapasu(m, extra = "") {
    ZAP.set(m.id, m);
    const v = vysledek(m);
    return `<div class="st-zrow" data-zap="${esc(m.id)}" role="button" tabindex="0">
        <span class="st-zrow__d">${czd(m.d)}</span>
        <span class="st-chip st-chip--${m.t}">${m.t === "D" ? "Dor" : m.t}</span>
        <span class="st-zrow__o">${m.h ? "" : "@ "}${esc(kratce(m.o))}${extra ? `<small>${esc(extra)}</small>` : ""}</span>
        <span class="st-res st-res--${v}">${esc(m.f ?? "?")}:${esc(m.a ?? "?")}</span><span class="st-zrow__x">▾</span></div>`;
}
function prepniZapis(row) {
    if (!row) return;
    const next = row.nextElementSibling;
    if (next && next.classList.contains("st-zapis")) { next.remove(); row.classList.remove("is-open"); return; }
    row.insertAdjacentHTML("afterend", zapisHtml(ZAP.get(row.dataset.zap)));
    row.classList.add("is-open");
}

/** Pořadí k rekordu: TOP 5, další do desítky po rozbalení. */
function poradiHtml(top) {
    const li = ({ p, jm, v, r }, i) => `<li class="${(r || i + 1) === 1 ? "is-1" : ""}"><span class="st-top__r">${r || i + 1}.</span>${p ? `<a href="#hrac=${encodeURIComponent(p.id)}" data-zavrit>${esc(p.name)}</a>` : `<b>${esc(jm)}</b>`}<span class="st-top__v">${esc(v)}</span></li>`;
    return `<div class="st-modal__l">Pořadí – TOP ${Math.min(5, top.length)}</div><ol class="st-top">${top.slice(0, 5).map(li).join("")}</ol>
        ${top.length > 5 ? `<details class="st-top__vic"><summary>Zobrazit do ${top.length}. místa</summary><ol class="st-top">${top.slice(5).map((x, i) => li(x, i + 5)).join("")}</ol></details>` : ""}`;
}

function otevriDetail(det) {
    if (!det) return;
    const box = document.getElementById("detailBox");
    const p = det.hrac;
    let zs = (det.zapasy || []).map((m, i) => ({ m, kdo: det.kdo ? det.kdo[i] : "" }));
    if (!det.kdo) zs.sort((a, b) => (b.m.d || "").localeCompare(a.m.d || ""));
    box.innerHTML = `<div class="st-modal__head"><h3>${esc(det.titul)}</h3><button type="button" class="st-modal__x" data-zavrit aria-label="Zavřít">✕</button></div>
        ${p ? `<a class="st-modal__card" href="#hrac=${encodeURIComponent(p.id)}" data-zavrit>Otevřít kartu hráče ${esc(p.name)} ›</a>` : ""}
        ${(det.top || []).length ? poradiHtml(det.top) : ""}
        ${(det.souhrny || []).length ? `<div class="st-modal__l">Starší sezóny</div><ul class="st-modal__sum">${det.souhrny.map(s => `<li>${esc(s)}</li>`).join("")}</ul>` : ""}
        ${zs.length ? `<div class="st-modal__l">${zs.length === 1 ? "Zápas" : `Zápasy (${zs.length})`} – klikni a rozbalí se zápis</div>
            <div class="st-zlist">${zs.map(({ m, kdo }) => {
                const g = p && !det.kdo ? golyHrace(m, p.name) : [];
                return radekZapasu(m, kdo || (g.length ? g.map(x => `⚽ ${x[1]}'`).join(" ") : ""));
            }).join("")}</div>` : (det.souhrny || []).length || (det.top || []).length ? "" : `<p class="st-note">K tomu nejsou zápisy jednotlivých zápasů – podrobnosti jsou na kartě hráče.</p>`}`;
    document.getElementById("detailOverlay").classList.add("is-open");
    document.body.style.overflow = "hidden";
    if (det.otevrit && zs.length) prepniZapis(box.querySelector("[data-zap]"));
}

/** Zápis zápasu: góly obou týmů v čase, sestava Vnorov se střídáním a kartami. */
function zapisHtml(m) {
    const domaci = m.h ? m.vn : m.o, hoste = m.h ? m.o : m.vn;
    const sk = esc(m.f == null ? "?" : m.h ? `${m.f}:${m.a}` : `${m.a}:${m.f}`);
    const pol = esc((m.hf != null ? (m.h ? ` (${m.hf}:${m.ha})` : ` (${m.ha}:${m.hf})`) : "")
        + (m.pen ? ` · na penalty ${m.h ? m.pen[0] : m.pen[1]}:${m.h ? m.pen[1] : m.pen[0]}` : ""));
    const vse = [...(m.g || []).map(g => ({ g, nas: 1 })), ...(m.ga || []).map(g => ({ g, nas: 0 }))].sort((a, b) => a.g[1] - b.g[1]);
    let a = 0, b = 0;
    const casova = vse.map(({ g, nas }) => {
        if (nas) a++; else b++;
        const stav = m.h ? `${a}:${b}` : `${b}:${a}`;
        const hracSoupere = nas ? g[3] : !g[3];
        return `<div class="st-gl ${nas ? "is-nas" : ""}"><span class="st-gl__m">${esc(g[1])}'</span><span class="st-gl__s">${stav}</span>
            <span>${esc(g[0])}${g[2] ? " (pen.)" : ""}${g[3] ? " (vlastní)" : ""}${nas && g[6] ? ` <small>(v zápisu FAČR: ${esc(g[6])})</small>` : ""}${nas && g[4] ? ` <small>asistence ${esc(g[4])}${g[5] ? " (nejisté)" : ""}</small>` : ""}${hracSoupere ? ` <small>${esc(kratce(m.o))}</small>` : ""}</span></div>`;
    }).join("");
    const lu = m.lu || [];
    const hrac = r => {
        const c = cas(r);
        const g = golyHrace(m, r[0]).map(x => `⚽${esc(x[1])}'`).join(" ");
        const stridani = r[1] ? (r[2] != null ? `↓ ${esc(r[2])}'` : "") : c ? `↑ ${esc(r[2])}'` : "nenastoupil";
        return `<div class="st-lu"><span class="st-lu__n"><a href="#hrac=${encodeURIComponent(slug(r[0]))}" data-zavrit>${esc(r[0])}</a>${r[7] ? " ©" : ""}</span>
            <span class="st-lu__i">${stridani}${r[3] != null ? ` <span class="st-card st-card--y"></span>` : ""}${r[4] != null ? ` <span class="st-card st-card--r"></span>` : ""} ${g}</span></div>`;
    };
    return `<div class="st-zapis">
        <div class="st-zapis__h">${esc(domaci)} – ${esc(hoste)} <b>${sk}</b>${pol}</div>
        <div class="st-zapis__m">${czd(m.d)}${m.k ? ` · ${esc(m.k)}. kolo` : ""} · ${esc(m.c)}</div>
        ${casova ? `<div class="st-zapis__l">Góly</div>${casova}` : `<div class="st-note">Bez gólů.</div>`}
        ${lu.length ? `<div class="st-zapis__l">Základní sestava Vnorov</div><div class="st-lugrid">${lu.filter(r => r[1]).map(hrac).join("")}</div>
            <div class="st-zapis__l">Náhradníci</div><div class="st-lugrid">${lu.filter(r => !r[1]).map(hrac).join("")}</div>`
            : `<div class="st-note">Zápis této sezóny nemá sestavy.</div>`}
        <a class="st-zapis__ext" href="https://www.fotbal.cz/souteze/zapasy/zapas/${encodeURIComponent(m.id)}" target="_blank" rel="noopener">Zápis na fotbal.cz ↗</a>
    </div>`;
}

/** Popis toho, co je vybrané a odkud čísla pro tyto sezóny jsou. */
function renderPopis(ms) {
    const el = document.getElementById("popis");
    const vyb = [...st.seasons].sort((a, b) => a - b);
    const souvisle = vyb.length && vyb[vyb.length - 1] - vyb[0] === vyb.length - 1;
    const sez = st.from === st.to ? `sezóna ${seasonLbl(st.from)}` : !vyb.length || souvisle ? `sezóny ${seasonLbl(st.from)} – ${seasonLbl(st.to)}` : `sezóny ${vyb.map(seasonLbl).join(", ")}`;
    const tym = st.team === "all" ? "áčko, béčko i dorost" : TEAMS[st.team];
    const sout = st.comps.size ? [...st.comps].join(", ") : "všechny soutěže";
    const P = [...st.players.values()];
    const sum = k => P.reduce((a, p) => a + (p[k] || 0), 0);
    const zdroje = [];
    if (st.from <= 2019) zdroje.push(`<b>do 2019/20</b> jen součty za sezónu a soutěž ze statistik IS FAČR (zápasy, minuty, góly, karty)`);
    if (st.to >= 2020 && st.from <= 2022) zdroje.push(`<b>2020/21–2022/23</b> součty z IS FAČR a k tomu střelci s minutou gólu ze zápisů`);
    if (st.to >= 2023) zdroje.push(`<b>od 2023/24</b> celé sestavy ze zápisů – střídání, minuty po zápasech, kdo kdy dal gól, tým s hráčem a bez něj`);
    const b = bilance(ms);
    el.hidden = false;
    el.innerHTML = `<div class="st-popis__t">Vybráno: ${esc(tym)} · ${sez} · ${esc(sout)}</div>
        <div class="st-popis__nums"><span><b>${P.filter(p => p.apps || p.goals).length}</b> hráčů${P.some(p => !p.apps && !p.goals) ? ` (+ ${P.filter(p => !p.apps && !p.goals).length} jen na lavičce)` : ""}</span><span><b>${fmt(sum("goals"))}</b> gólů</span>
        <span><b>${fmt(sum("min"))}</b> odehraných minut</span>${b.z ? `<span><b>${b.z}</b> zápasů se zápisem (${b.v} V · ${b.r} R · ${b.p} P)</span>` : ""}</div>
        <div class="st-popis__src">Odkud jsou čísla: ${zdroje.join("; ")}.</div>`;
}

/** Nejvíc gólů za jednu sezónu – hráč, sezóna, tým. */
function sezonniStrelci(ms, os) {
    const out = [];
    const seasons = [...new Set([...ms, ...os].map(x => x.s))];
    for (const s of seasons) for (const t of Object.keys(TEAMS)) {
        const P = compute(ms.filter(m => m.s === s && m.t === t), os.filter(o => o.s === s && o.t === t));
        for (const p of P.values()) if (p.goals) out.push({ p, s, t, g: p.goals, z: p.apps, min: p.min });
    }
    return out.sort((a, b) => b.g - a.g || a.z - b.z);
}

function renderSeasonTop(ms, os) {
    const top = sezonniStrelci(ms, os).slice(0, 15);
    document.getElementById("seasonTop").innerHTML = top.length ? `<table class="ptable st-small">
        <thead><tr><th>#</th><th>Hráč</th><th>Sezóna</th><th>Tým</th><th class="ptable__num">Góly</th><th class="ptable__num">Z</th></tr></thead>
        <tbody>${top.map((x, i) => `<tr class="st-row" data-id="${esc(x.p.id)}"><td class="ptable__rank">${i + 1}</td><td><b>${esc(x.p.name)}</b></td>
            <td>${seasonLbl(x.s)}</td><td><span class="st-chip st-chip--${x.t}">${TEAMS[x.t]}</span></td>
            <td class="ptable__num ptable__points">${x.g}</td><td class="ptable__num">${x.z || "–"}</td></tr>`).join("")}</tbody></table>`
        : `<div class="st-empty">Pro tento výběr nejsou data.</div>`;
    document.querySelectorAll("#seasonTop tr.st-row").forEach(r => r.onclick = () => { location.hash = "hrac=" + encodeURIComponent(r.dataset.id); });
}

function bilance(ms) {
    const b = { z: 0, v: 0, r: 0, p: 0, f: 0, a: 0 };
    ms.forEach(m => { const v = vysledek(m); if (!v) return; b.z++; b[v.toLowerCase()]++; b.f += m.f; b.a += m.a; });
    b.body = b.v * 3 + b.r;
    return b;
}

function renderTeams(ms) {
    const el = document.getElementById("teamCards");
    const os = filteredOld();
    const teams = st.team === "all" ? Object.keys(TEAMS) : [st.team];
    el.innerHTML = teams.map(t => {
        const tm = ms.filter(m => m.t === t), to = os.filter(o => o.t === t);
        if (!tm.length && !to.length) return "";
        const b = bilance(tm);
        const P = compute(tm, to);                    // střelci i ze starších sezón (IS FAČR)
        const top = [...P.values()].sort((a, b) => b.goals - a.goals)[0];
        const big = tm.filter(m => m.f != null && m.f > m.a).sort((a, b) => (b.f - b.a) - (a.f - a.a) || b.f - a.f)[0];
        if (big) DETAIL.push({ titul: `${TEAMS[t]} – nejvyšší výhra`, zapasy: [big], otevrit: true });
        const iBig = DETAIL.length - 1;
        return `<div class="st-team">
            <div class="st-team__name">${TEAMS[t]}</div>
            ${b.z ? `<div class="st-team__row"><b>${b.z}</b> zápasů se zápisem · <span class="c-ok">${b.v} V</span> · ${b.r} R · <span class="c-bad">${b.p} P</span></div>
            <div class="st-team__row">skóre <b>${b.f}:${b.a}</b> · ${r1(b.body / b.z)} bodu na zápas</div>` : `<div class="st-team__row">v těchto sezónách jen součty za soutěž, bez výsledků zápasů</div>`}
            ${top && top.goals ? `<div class="st-team__row">nejlepší střelec <a href="#hrac=${encodeURIComponent(top.id)}">${esc(top.name)}</a> (${goly(top.goals)})</div>` : ""}
            ${big ? `<div class="st-team__row">nejvyšší výhra <button type="button" class="st-tlink" data-det="${iBig}">${big.f}:${big.a} ${big.h ? "doma s" : "v"} ${esc(kratce(big.o))} (${czd(big.d)})</button></div>` : ""}
            ${b.z && to.some(o => o.s < 2020) ? `<div class="st-team__note">výsledky zápasů jsou od 2020/21, starší sezóny jen součty</div>` : ""}
        </div>`;
    }).join("");
}

function kratce(o) { return String(o || "").replace(/,?\s*z\.\s*s\.?/g, "").replace(/\s+/g, " ").trim(); }

const golyHrace = (m, n) => (m.g || []).filter(g => g[0] === n && !g[3]);
const rowOf = (m, n) => (m.lu || []).find(r => r[0] === n);

function renderRecords(ms, rod) {
    const P = [...st.players.values()];
    const os = filteredOld();
    const stare = st.from < 2020;                      // výběr obsahuje sezóny bez zápisů
    const link = p => `<a href="#hrac=${encodeURIComponent(p.id)}">${esc(p.name)}</a>`;
    const cards = [];

    /* Položka pořadí: {p (hráč) nebo jm (text), k (číslo pro pořadí – větší = lepší), kv (krátká hodnota), v (celý text), pozn}.
       Místo r = 1 + počet lepších → shoda (stejné k) dává stejné místo. */
    const poradi = items => items.map(x => ({ ...x, r: 1 + items.filter(y => y.k > x.k).length }));
    const zeb = (key, kv, v = kv, f = x => x[key] > 0, k = x => x[key]) =>
        poradi(P.filter(f).sort((a, b) => k(b) - k(a)).slice(0, 10).map(x => ({ p: x, k: k(x), kv: kv(x), v: v(x) })));
    const jmeno = x => x.p ? link(x.p) : esc(x.jm);

    /* det = {titul, zapasy, kdo, souhrny, otevrit, hracove: true = pořadí hráčů ukázat i v okně} */
    const add = (ico, title, items, det = {}, zdroj = "") => {
        if (!items.length) return;
        const lidri = items.filter(x => x.r === 1), shoda = lidri.length > 1, p1 = items[0];
        DETAIL.push({ hrac: !shoda && p1.p ? p1.p : null, ...det, top: det.hracove === false ? null : items,
            titul: det.titul || `${title} – ${shoda ? lidri.map(x => x.p ? x.p.name : x.jm).join(", ") : (p1.p ? p1.p.name : p1.jm)}` });
        const src = zdroj && stare ? ` <span class="st-rec__src">${zdroj}</span>` : "";
        const prehled = shoda
            ? `<div class="st-rec__p">${lidri.slice(0, 3).map(x => `${jmeno(x)}${x.pozn ? ` <small>${esc(x.pozn)}</small>` : ""}`).join("<br>")}${lidri.length > 3 ? `<br><small>+ další ${lidri.length - 3}</small>` : ""}</div>
               <div class="st-rec__v">${esc(p1.kv)} · shodně ${lidri.length}${det.hracove === false ? "×" : lidri.length < 5 ? " hráči" : " hráčů"}</div>`
            : `<div class="st-rec__p">${jmeno(p1)}</div><div class="st-rec__v">${esc(p1.v)}</div>`;
        const top3 = `<ol class="st-rec__top">${items.filter(x => x.r <= 3).slice(0, 5).map(x => `<li><span class="st-rec__r">${x.r}.</span><span class="st-rec__n">${jmeno(x)}${x.pozn ? ` <small>${esc(x.pozn)}</small>` : ""}</span><span class="st-rec__k">${esc(x.kv)}</span></li>`).join("")}</ol>`;
        cards.push(`<div class="st-rec" data-det="${DETAIL.length - 1}" role="button" tabindex="0"><div class="st-rec__ico">${ico}</div><div class="st-rec__b">
            <div class="st-rec__t">${title}${src}</div>${st.recMode === "top3" ? top3 : prehled}</div>
            <div class="st-rec__more">›</div></div>`);
    };
    const golZapasy = (p, f = () => true) => ms.filter(m => golyHrace(m, p.name).length && f(m));
    const souhrnyHrace = (p, f = () => true) => os.filter(o => o.s < 2020 && f(o)).flatMap(o => o.rows.filter(r => r[0] === p.name && r[1])
        .map(r => `${seasonLbl(o.s)} · ${o.u}: ${goly(r[1])} v ${r[4]} zápasech (jen součet za soutěž, zápisy zápasů nejsou)`));
    const proLidra = (items, fn) => (items.length && items[0].p && items.filter(x => x.r === 1).length === 1 ? fn(items[0].p) : {});
    const tymK = t => (t === "D" ? "Dor" : t);
    let it;

    it = zeb("goals", x => goly(x.goals), x => goly(x.goals) + (x.pens ? ` · ${x.pens} z penalty od 2020/21` : ""));
    add("⚽", "Nejlepší střelec", it, proLidra(it, p => ({ zapasy: golZapasy(p), souhrny: souhrnyHrace(p) })));

    const ssAll = sezonniStrelci(ms, os).slice(0, 10);
    it = poradi(ssAll.map(x => ({ p: x.p, k: x.g, kv: goly(x.g), v: `${goly(x.g)} · ${seasonLbl(x.s)} · ${TEAMS[x.t]}`, pozn: `${seasonLbl(x.s)} ${tymK(x.t)}`, s: x.s, t: x.t })));
    add("🏆", "Nejvíc gólů za sezónu", it, it.length && it.filter(x => x.r === 1).length === 1
        ? { titul: `${it[0].p.name} – ${goly(it[0].k)} v sezóně ${seasonLbl(it[0].s)}`, zapasy: golZapasy(it[0].p, m => m.s === it[0].s && m.t === it[0].t), souhrny: souhrnyHrace(it[0].p, o => o.s === it[0].s && o.t === it[0].t) }
        : { titul: "Nejvíc gólů za sezónu" });

    it = zeb("min", x => `${fmt(x.min)} min`, x => `${fmt(x.min)} min · ${x.apps} zápasů`);
    add("⏱️", "Nejvíc minut", it);

    it = zeb("g90", x => `${r1(x.g90)} na 90`, x => `${r1(x.g90)} gólu na 90 min · gól každých ${Math.round(x.min / x.goalsLu)} min`, x => x.g90 != null && x.goalsLu > 0);
    add("🎯", "Nejlepší poměr", it, proLidra(it, p => ({ zapasy: golZapasy(p) })));

    it = zeb("full", x => `${x.full}× celých 90`, x => `${x.full}× celých 90 minut`);
    add("🛡️", "Železný muž", it, proLidra(it, p => ({ zapasy: ms.filter(m => { const r = rowOf(m, p.name); const c = r && cas(r); return c && c.tin === 0 && c.tout === DELKA; }) })), "od 2023/24");

    it = zeb("subGoals", x => goly(x.subGoals), x => `${goly(x.subGoals)} po střídání`);
    add("🔁", "Žolík z lavičky", it, proLidra(it, p => ({ zapasy: golZapasy(p, m => { const r = rowOf(m, p.name); return r && !r[1] && cas(r); }) })), "od 2023/24");

    /* TOP 10, ale se všemi, kdo mají stejnou hodnotu jako první (shoda na 1. místě se neusekne) */
    const doDeseti = (arr, k) => arr.slice(0, Math.max(10, arr.filter(x => k(x) === k(arr[0])).length));
    const multi = [];
    ms.forEach(m => { const c = {}; m.g.forEach(g => { if (!g[3]) c[g[0]] = (c[g[0]] || 0) + 1; }); Object.entries(c).forEach(([n, k]) => { if (k >= 2) multi.push({ m, n, k }); }); });
    multi.sort((a, b) => b.k - a.k || (b.m.d || "").localeCompare(a.m.d || ""));
    const hatAll = multi.filter(x => x.k >= 3);
    it = zeb("hat", x => `${x.hat}×`, x => `${x.hat}× tři a víc gólů · všech hattricků ${hatAll.length}`);
    add("🎩", "Hattricky", it, { titul: `Hattricky (${hatAll.length})`, zapasy: hatAll.map(x => x.m), kdo: hatAll.map(x => `${x.n} – ${goly(x.k)}`) }, "od 2020/21");

    const zapasItem = (x, k, kv) => ({ p: st.players.get(x.n), jm: x.n, k, kv, v: `${kv} · ${kratce(x.m.o)} ${x.m.f}:${x.m.a}, ${czd(x.m.d)}`, pozn: `${kratce(x.m.o)}, ${czd(x.m.d)}` });
    const multi10 = doDeseti(multi, x => x.k);
    it = poradi(multi10.map(x => zapasItem(x, x.k, goly(x.k))));
    add("🔥", "Nejvíc gólů v zápase", it, { titul: `Nejvíc gólů v zápase – TOP ${multi10.length}`, hracove: false, zapasy: multi10.map(x => x.m), kdo: multi10.map(x => `${x.n} – ${goly(x.k)}`), otevrit: true }, "od 2020/21");

    const rz = rod.flatMap(r => r.zapasy.filter(z => z.strelcu > 1).map(z => ({ ...z, k: r.k }))).sort((a, b) => b.g - a.g || (b.m.d || "").localeCompare(a.m.d || "")).slice(0, 10);
    it = poradi(rz.map(z => ({ jm: `${z.k} – ${kdoDal(z.kdo)}`, k: z.g, kv: goly(z.g), v: `${goly(z.g)} · ${kratce(z.m.o)} ${z.m.f}:${z.m.a}, ${czd(z.m.d)}`, pozn: `${kratce(z.m.o)}, ${czd(z.m.d)}` })));
    add("👨‍👦", "Rodinné góly v zápase", it, { titul: "Rodinné góly v zápase – TOP 10", hracove: false, zapasy: rz.map(z => z.m), kdo: rz.map(z => `${z.k}: ${kdoDal(z.kdo)} = ${goly(z.g)}`), otevrit: true }, "od 2020/21");

    const vsechnyGoly = ms.flatMap(m => m.g.filter(g => !g[3] && g[1] >= 1).map(g => ({ g, m, n: g[0] })));
    const rychle = doDeseti([...vsechnyGoly].sort((a, b) => a.g[1] - b.g[1] || (b.m.d || "").localeCompare(a.m.d || "")), x => x.g[1]);
    const pozde = doDeseti([...vsechnyGoly].sort((a, b) => b.g[1] - a.g[1] || (b.m.d || "").localeCompare(a.m.d || "")), x => x.g[1]);
    const golDet = (seznam, titul) => ({ titul, hracove: false, zapasy: seznam.map(x => x.m), kdo: seznam.map(x => `${x.n} – ${x.g[1]}. minuta${x.g[2] ? " (pen.)" : ""}`), otevrit: true });
    add("⚡", "Nejrychlejší gól", poradi(rychle.map(x => zapasItem(x, -x.g[1], `${x.g[1]}. minuta`))), golDet(rychle, `Nejrychlejší góly – TOP ${rychle.length}`), "od 2020/21");
    add("🕐", "Nejpozdější gól", poradi(pozde.map(x => zapasItem(x, x.g[1], `${x.g[1]}. minuta`))), golDet(pozde, `Nejpozdější góly – TOP ${pozde.length}`), "od 2020/21");

    it = zeb("assists", x => `${x.assists} asistencí`);
    add("🅰️", "Nejvíc asistencí", it, proLidra(it, p => ({ zapasy: ms.filter(m => m.g.some(g => g[4] === p.name)),
        kdo: ms.filter(m => m.g.some(g => g[4] === p.name)).map(m => m.g.filter(g => g[4] === p.name).map(g => `🅰️ ${g[1]}' → ${g[0]}${g[3] ? " (vlastní gól soupeře)" : ""}`).join(", ")) })), "vlastní evidence");
    it = zeb("kb", x => `${x.kb} bodů`, x => `${x.kb} bodů · ${x.kbG} G + ${x.assists} A`, x => x.kb > 0, x => x.kb * 1000 + x.kbG);
    add("🍁", "Kanadské body", it, {}, "vlastní evidence");

    it = zeb("zk", x => `${x.zk} ŽK`, x => `${x.zk} žlutých${x.ck ? ` · ${x.ck}× červená` : ""}`);
    add("🟨", "Nejvíc žlutých", it, proLidra(it, p => ({ zapasy: ms.filter(m => { const r = rowOf(m, p.name); return r && (r[3] != null || r[4] != null); }) })));
    it = zeb("kap", x => `${x.kap}× s páskou`);
    add("©️", "Kapitán", it, proLidra(it, p => ({ zapasy: ms.filter(m => { const r = rowOf(m, p.name); return r && r[7]; }) })), "od 2023/24");
    it = zeb("apps", x => `${x.apps} zápasů`, x => `${x.apps} zápasů` + (x.starts ? ` · od 2023/24 ${x.starts}× v základu` : ""));
    add("👟", "Nejvíc zápasů", it);
    it = zeb("vicTymu", x => `${x.apps} zápasů`, x => `${[...x.teams].sort().map(t => TEAMS[t]).join(" + ")} · ${x.apps} zápasů`, x => x.teams.size > 1, x => x.teams.size * 10000 + x.apps)
        .map(x => ({ ...x, pozn: [...x.p.teams].sort().map(tymK).join("+") }));
    add("🔀", "Za víc týmů", it);

    const el = document.getElementById("records");
    el.innerHTML = cards.join("") || `<div class="st-empty">Pro tento výběr nejsou data.</div>`;
    el.classList.toggle("is-top3", st.recMode === "top3");
    const seg = document.getElementById("recMode");
    seg.innerHTML = [["prehled", "Přehled"], ["top3", "TOP 3"]].map(([k, l]) => `<button type="button" data-k="${k}" class="${st.recMode === k ? "is-on" : ""}">${l}</button>`).join("");
    seg.onclick = (e) => { const bt = e.target.closest("button"); if (!bt) return; st.recMode = bt.dataset.k; try { localStorage.setItem("statRecMode", st.recMode); } catch { /* bez úložiště */ } renderOverview(); };
}

/* --------------------------------------- góly na hřišti, brankáři ---- */

/** Padl gól v minutě `min`, když byl hráč (okno c = {tin, tout}) na hřišti? Do konce = i nastavení. */
function naHristi(c, min) {
    if (!c) return false;
    const od = c.tin === 0 ? min >= 0 : min > c.tin;
    return od && (c.tout >= DELKA || min <= c.tout);
}

/** Pro zápasy se sestavou: každý hráč na hřišti – minuty, góly dané (i vlastní soupeře) a obdržené v tu dobu;
    brankář (pozice B) navíc zápasy, celé zápasy, čistá konta a V/R/P. */
function naHristiStat(ms) {
    const H = new Map(), tym = { z: 0, f: 0, a: 0, v: 0, r: 0, p: 0 };
    for (const m of ms) {
        if (!(m.lu || []).length || m.f == null) continue;
        tym.z++; tym.f += m.f; tym.a += m.a;
        const vys = vysledek(m); if (vys === "V") tym.v++; else if (vys === "R") tym.r++; else tym.p++;
        /* brankář = pozice B, nebo náhradník, který šel za brankáře (v zápise mívá pozici N) */
        const gk = new Set(m.lu.filter(r => r[6] === "B").map(r => r[0]));
        m.lu.forEach(r => { if (!r[1] && r[5] && gk.has(r[5])) gk.add(r[0]); });
        for (const r of m.lu) {
            const c = cas(r);
            if (!c) continue;
            const x = H.get(r[0]) || { n: r[0], z: 0, min: 0, gf: 0, ga: 0, b: 0, bz: 0, bcele: 0, bmin: 0, bga: 0, cista: 0, v: 0, rem: 0, p: 0, teams: new Set() };
            H.set(r[0], x);
            const gf = m.g.filter(g => naHristi(c, g[1])).length, ga = m.ga.filter(g => naHristi(c, g[1])).length;
            x.z++; x.min += c.min; x.gf += gf; x.ga += ga; x.teams.add(m.t);
            if (gk.has(r[0])) {
                const cely = c.tin === 0 && c.tout >= DELKA;
                x.b = 1; x.bz++; x.bmin += c.min; x.bga += ga; if (cely) x.bcele++;
                if (cely && m.a === 0) x.cista++;
                const v = vysledek(m); if (v === "V") x.v++; else if (v === "R") x.rem++; else x.p++;
            }
        }
    }
    return { H, tym };
}

const f2 = (x, d = 2) => (Number.isFinite(x) ? (Math.round(x * 10 ** d) / 10 ** d).toLocaleString("cs-CZ", { minimumFractionDigits: d }).replace("-", "−") : "–");
const pm = n => (n > 0 ? "+" : n < 0 ? "−" : "") + Math.abs(n);
const odkazHrace = n => `<a class="st-kb__n" href="#hrac=${encodeURIComponent(slug(n))}">${esc(n)}</a>`;

function renderBrankari(ms) {
    const { H, tym } = naHristiStat(ms);
    const B = [...H.values()].filter(x => x.b).sort((a, b) => b.bmin - a.bmin);
    document.getElementById("brankariSec").hidden = !B.length;
    if (!B.length) return;
    const sum = k => B.reduce((a, x) => a + x[k], 0);
    const radek = (jm, x, cls = "") => `<tr class="${cls}"><td>${jm}</td><td class="ptable__num">${x.bz}</td><td class="ptable__num">${x.bcele}</td>
        <td class="ptable__num">${fmt(x.bmin)}</td><td class="ptable__num">${f2(x.bmin * 100 / (tym.z * DELKA), 1)} %</td>
        <td class="ptable__num ptable__points">${x.bga}</td><td class="ptable__num"><b>${f2(x.bga * 90 / x.bmin)}</b></td>
        <td class="ptable__num">${x.cista}</td><td class="ptable__num">${x.v}–${x.rem}–${x.p}</td>
        <td class="ptable__num">${tym.a ? f2(x.bga * 100 / tym.a, 1) + " %" : "–"}</td></tr>`;
    document.getElementById("brankari").innerHTML = `<table class="ptable st-small st-gk">
        <thead><tr><th>Brankář</th><th class="ptable__num">Z</th><th class="ptable__num">Celých</th><th class="ptable__num">Minut</th><th class="ptable__num">%</th>
        <th class="ptable__num">Obdržel</th><th class="ptable__num">Ø na 90</th><th class="ptable__num">Čistá konta</th><th class="ptable__num">V–R–P</th><th class="ptable__num">Podíl obdržených</th></tr></thead>
        <tbody>${B.map(x => radek(`${odkazHrace(x.n)} ${[...x.teams].sort().map(k => `<span class="st-chip st-chip--${k}">${k === "D" ? "Dor" : k}</span>`).join("")}`, x)).join("")}
        ${radek("<b>Celkem tým</b>", { bz: tym.z, bcele: sum("bcele"), bmin: sum("bmin"), bga: sum("bga"), cista: sum("cista"), v: tym.v, rem: tym.r, p: tym.p }, "st-kb__sum")}</tbody></table>`;
}

function renderPlusMinus(ms) {
    const { H, tym } = naHristiStat(ms);
    const P = [...H.values()].sort((a, b) => b.min - a.min);
    document.getElementById("plusminusSec").hidden = !P.length;
    if (!P.length) return;
    document.getElementById("plusminusPocet").textContent = `${P.length} hráčů · ${tym.z} zápasů`;
    document.getElementById("plusminus").innerHTML = `<table class="ptable st-small st-pm">
        <thead><tr><th>Hráč</th><th class="ptable__num">Minut</th><th class="ptable__num">G+</th><th class="ptable__num">% z ${tym.f}</th><th class="ptable__num">G−</th><th class="ptable__num">% z ${tym.a}</th>
        <th class="ptable__num">+/−</th><th class="ptable__num">G+/90</th><th class="ptable__num">G−/90</th><th class="ptable__num">Rozdíl/90</th></tr></thead>
        <tbody>${P.map(x => { const d = x.gf - x.ga, d90 = d * 90 / x.min; return `<tr><td>${odkazHrace(x.n)}</td><td class="ptable__num">${fmt(x.min)}</td>
            <td class="ptable__num">${x.gf}</td><td class="ptable__num">${tym.f ? f2(x.gf * 100 / tym.f, 1) : "–"}</td>
            <td class="ptable__num">${x.ga}</td><td class="ptable__num">${tym.a ? f2(x.ga * 100 / tym.a, 1) : "–"}</td>
            <td class="ptable__num"><b class="${d > 0 ? "c-plus" : d < 0 ? "c-minus" : ""}">${pm(d)}</b></td>
            <td class="ptable__num">${f2(x.gf * 90 / x.min)}</td><td class="ptable__num">${f2(x.ga * 90 / x.min)}</td>
            <td class="ptable__num"><b class="${d90 > 0 ? "c-plus" : d90 < 0 ? "c-minus" : ""}">${d90 > 0 ? "+" : ""}${f2(d90)}</b></td></tr>`; }).join("")}</tbody></table>`;
}

/* ------------------------------------------- kanadské bodování ---- */

/** Góly + asistence jen ze zápasů, ke kterým je vlastní evidence asistencí (FAČR je nevede). */
function renderKanadske(ms) {
    const sMs = ms.filter(m => m.asist);
    const sec = document.getElementById("kanadskeSec");
    sec.hidden = !sMs.length;
    if (!sMs.length) return;
    const P = [...st.players.values()].filter(p => p.kb || p.kbMin).sort((a, b) => b.kb - a.kb || b.kbG - a.kbG || (b.kb / (b.kbMin || 1)) - (a.kb / (a.kbMin || 1)));   // při shodě bodů víc gólů, pak lepší B/90
    const f = (x, d = 2) => x ? (Math.round(x * 10 ** d) / 10 ** d).toLocaleString("cs-CZ", { minimumFractionDigits: d }) : "–";
    const sum = k => P.reduce((a, p) => a + p[k], 0);
    const seas = [...new Set(sMs.map(m => `${TEAMS[m.t]} ${seasonLbl(m.s)}`))].join(", ");
    const radek = (i, jm, z, min, g, a, kb, cls = "") => `<tr class="${cls}">${i}<td>${jm}</td><td class="ptable__num">${z}</td><td class="ptable__num">${fmt(min)}</td>
        <td class="ptable__num">${g}</td><td class="ptable__num">${a}</td><td class="ptable__num ptable__points">${kb}</td>
        <td class="ptable__num">${f(g * 90 / min)}</td><td class="ptable__num">${f(a * 90 / min)}</td><td class="ptable__num"><b>${f(kb * 90 / min)}</b></td>
        <td class="ptable__num">${kb ? Math.round(min / kb) : "–"}</td></tr>`;
    document.getElementById("kanadskePopis").textContent = `Góly + asistence v přepočtu na odehrané minuty. Asistence jsou z vlastní evidence (FAČR je nevede) – zatím ${seas} (${sMs.length} zápasů); góly a minuty jsou proto jen z těchto zápasů. Klik na hráče otevře kartu.`;
    document.getElementById("kanadske").innerHTML = `<table class="ptable st-small st-kb">
        <thead><tr><th>#</th><th>Hráč</th><th class="ptable__num">Z</th><th class="ptable__num">Min</th><th class="ptable__num">G</th><th class="ptable__num">A</th><th class="ptable__num">Body</th>
        <th class="ptable__num">G/90</th><th class="ptable__num">A/90</th><th class="ptable__num">B/90</th><th class="ptable__num">Min/bod</th></tr></thead>
        <tbody>${P.filter(p => p.kb).map((p, i) => radek(`<td class="ptable__rank">${i + 1}</td>`, `<a class="st-kb__n" href="#hrac=${encodeURIComponent(p.id)}">${esc(p.name)}</a>`, p.kbApps, p.kbMin, p.kbG, p.assists, p.kb)).join("")}
        ${radek("<td></td>", "<b>Celkem tým</b>", sMs.length, sum("kbMin"), sum("kbG"), sum("assists"), sum("kb"), "st-kb__sum")}</tbody></table>`;
}

/* ------------------------------------- Benfika – Michalova evidence ----
   Dokument statistiky/benfika (pole `benfika` = JSON): sezóny → části (podzim, jaro) → soupeři a hráči
   { n, b: body po zápasech (null = nehrál), min: minuty po zápasech, bil: [V, R, P], g, a, zk, ck }.
   Body a minuty jsou z Michalových Excelů, ne ze zápisů – proto samostatná sekce. */

const klicJmena = n => String(n || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().split(/\s+/).filter(Boolean).sort().join(" ");
let JMENA_WEBU = null;    // klíč jména → jméno, jak ho zná zbytek stránky (pro odkaz na kartu hráče)
function jmenoWebu(n) {
    if (!JMENA_WEBU) {
        JMENA_WEBU = new Map();
        st.matches.forEach(m => { (m.lu || []).forEach(r => JMENA_WEBU.set(klicJmena(r[0]), r[0])); (m.g || []).forEach(g => JMENA_WEBU.set(klicJmena(g[0]), g[0])); });
    }
    return JMENA_WEBU.get(klicJmena(n)) || null;
}

/** Hráči vybrané části (vse = podzim + jaro sečtené). */
function benfikaHraci(sez, cast) {
    const casti = sez.casti.filter((c, i) => cast === "vse" || String(i) === cast);
    const P = new Map();
    casti.forEach(c => c.hraci.forEach(h => {
        const k = klicJmena(h.n);
        const p = P.get(k) || { n: h.n, z: 0, min: 0, b: 0, g: 0, a: 0, v: 0, r: 0, p: 0, zk: 0, ck: 0, zapasy: [] };
        (h.b || []).forEach((b, i) => {
            const min = (h.min || [])[i] || 0;
            const hral = b !== null && b !== undefined;
            if (hral) { p.z++; p.b += b; }
            if (hral || min) p.zapasy.push({ c: c.nazev, s: c.zapasy[i], b: hral ? b : null, min });
        });
        p.min += (h.min || []).reduce((a, x) => a + (x || 0), 0);
        p.g += h.g || 0; p.a += h.a || 0; p.zk += h.zk || 0; p.ck += h.ck || 0;
        if (Array.isArray(h.bil)) { p.v += h.bil[0]; p.r += h.bil[1]; p.p += h.bil[2]; }
        P.set(k, p);
    }));
    return [...P.values()];
}

function renderBenfika() {
    const sec = document.getElementById("benfikaSec");
    const sezony = st.benfika.filter(s => s && Array.isArray(s.casti) && (!st.seasons.size || st.seasons.has(s.s)));
    sec.hidden = !(sezony.length && (st.team === "all" || st.team === "B"));
    if (sec.hidden) return;
    if (!sezony.some(s => s.s === st.bfSez)) st.bfSez = sezony[sezony.length - 1].s;
    const sez = sezony.find(s => s.s === st.bfSez);
    if (st.bfCast !== "vse" && !sez.casti[+st.bfCast]) st.bfCast = "vse";
    const P = benfikaHraci(sez, st.bfCast);
    const klice = { b: p => p.b, z: p => p.z, min: p => p.min, g: p => p.g, a: p => p.a, ga: p => p.g + p.a, prum: p => (p.z ? p.b / p.z : -99), n: null };
    const kl = klice[st.bfSort];
    P.sort((x, y) => kl ? (kl(y) - kl(x) || y.b - x.b || x.n.localeCompare(y.n, "cs")) : x.n.localeCompare(y.n, "cs"));
    const seg = (pol, akt, attr) => pol.map(([k, l]) => `<button type="button" data-${attr}="${k}" class="${String(k) === String(akt) ? "is-on" : ""}">${esc(l)}</button>`).join("");
    const sum = k => P.reduce((a, p) => a + p[k], 0);
    const th = (k, l, num = true) => `<th class="${num ? "ptable__num " : ""}st-bf__th${st.bfSort === k ? " is-on" : ""}" data-bfsort="${k}">${l}</th>`;
    const radky = P.map((p, i) => {
        const web = jmenoWebu(p.n);
        const jm = web ? `<a class="st-kb__n" href="#hrac=${encodeURIComponent(slug(web))}">${esc(p.n)}</a>` : `<span class="st-kb__n">${esc(p.n)}</span>`;
        const otevreny = st.bfOtevreny === klicJmena(p.n);
        const detail = otevreny ? `<tr class="st-bf__det"><td colspan="11"><div class="st-bf__zapasy">${p.zapasy.map(z =>
            `<span class="st-bf__z${z.b === null ? " is-nehral" : z.b > 0 ? " is-plus" : z.b < 0 ? " is-minus" : ""}"><small>${esc(z.c.split(" ")[0])}</small> ${esc(z.s)}
             <b>${z.b === null ? "–" : z.b === 0 ? "0" : pm(z.b)}</b><small>${z.min ? z.min + "′" : ""}</small></span>`).join("")}</div></td></tr>` : "";
        return `<tr class="st-bf__radek${otevreny ? " is-open" : ""}" data-bfhrac="${esc(klicJmena(p.n))}"><td class="ptable__rank">${i + 1}</td><td>${jm} <span class="st-bf__sip">${otevreny ? "▴" : "▾"}</span></td>
            <td class="ptable__num">${p.z}</td><td class="ptable__num">${fmt(p.min)}</td><td class="ptable__num">${p.g}</td><td class="ptable__num">${p.a}</td>
            <td class="ptable__num">${p.g + p.a}</td><td class="ptable__num ptable__points">${p.b === 0 ? "0" : pm(p.b)}</td><td class="ptable__num">${p.z ? f2(p.b / p.z, 1) : "–"}</td>
            <td class="ptable__num st-bf__vrp">${p.v}–${p.r}–${p.p}</td><td class="ptable__num">${p.zk ? `<span class="st-bf__k st-bf__k--y">${p.zk}</span>` : ""}${p.ck ? `<span class="st-bf__k st-bf__k--r">${p.ck}</span>` : ""}</td></tr>${detail}`;
    }).join("");
    const vybraneCasti = st.bfCast === "vse" ? sez.casti : [sez.casti[+st.bfCast]];
    const zap = vybraneCasti.reduce((a, c) => a + c.zapasy.length, 0);
    const pohar = vybraneCasti.some(c => c.zapasy.some(z => /\(P\)/.test(z)));
    document.getElementById("benfikaPopis").textContent = `Benfika (B tým) ${seasonLbl(sez.s)} podle tvé evidence – ${zap} zápasů${pohar ? " (P = pohár)" : ""}. Body = tvoje hodnocení hráčů po zápasech; góly, asistence a karty z tvých souhrnů. Řadit jde klikem na záhlaví, klik na hráče ukáže body a minuty po zápasech.`;
    document.getElementById("benfikaVolby").innerHTML = `<div class="st-seg st-seg--sm">${seg(sezony.map(s => [s.s, seasonLbl(s.s)]), st.bfSez, "bfsez")}</div>
        <div class="st-seg st-seg--sm">${seg([["vse", "Celá sezóna"], ...sez.casti.map((c, i) => [i, c.nazev])], st.bfCast, "bfcast")}</div>`;
    document.getElementById("benfika").innerHTML = `<table class="ptable st-small st-bf">
        <thead><tr><th>#</th>${th("n", "Hráč", false)}${th("z", "Z")}${th("min", "Min")}${th("g", "G")}${th("a", "A")}${th("ga", "G+A")}${th("b", "Body")}${th("prum", "Ø")}<th class="ptable__num">V–R–P</th><th class="ptable__num">Karty</th></tr></thead>
        <tbody>${radky}<tr class="st-kb__sum"><td></td><td><b>Celkem</b></td><td class="ptable__num">${zap}</td><td class="ptable__num">${fmt(sum("min"))}</td><td class="ptable__num">${sum("g")}</td>
        <td class="ptable__num">${sum("a")}</td><td class="ptable__num">${sum("g") + sum("a")}</td><td></td><td></td><td></td><td class="ptable__num">${sum("zk") || sum("ck") ? `${sum("zk")} ŽK · ${sum("ck")} ČK` : ""}</td></tr></tbody></table>`;
    sec.onclick = (e) => {
        const b = e.target.closest("[data-bfsez], [data-bfcast], [data-bfsort], [data-bfhrac]");
        if (!b || e.target.closest("a")) return;
        if (b.dataset.bfsez) { st.bfSez = +b.dataset.bfsez; st.bfCast = "vse"; st.bfOtevreny = null; }
        else if (b.dataset.bfcast) st.bfCast = b.dataset.bfcast;
        else if (b.dataset.bfsort) st.bfSort = b.dataset.bfsort;
        else st.bfOtevreny = st.bfOtevreny === b.dataset.bfhrac ? null : b.dataset.bfhrac;
        renderBenfika();
    };
}

/* ------------------------------------------ rodiny (stejné příjmení) ---- */

const bezRocniku = n => n.replace(/\s*\(ročník \d+\)$/, "");
const prijmeni = n => { const t = bezRocniku(n).split(" "); return t.length > 1 ? t.slice(0, -1).join(" ") : t[0]; };
const krestni = n => n.slice(prijmeni(n).length + 1) || n;
const kdoDal = kdo => Object.entries(kdo).filter(x => x[1]).sort((a, b) => b[1] - a[1]).map(([n, g]) => `${krestni(n)} ${g}`).join(" + ");

/** Příjmení s víc hráči ve výběru: hráči, součty a zápasy, kde byli aspoň dva (na hřišti nebo mezi střelci). */
function rodiny(ms) {
    const R = new Map();
    /* u příjmení, která jsou v dokumentu `rodiny`, se počítají jen tam vypsaní hráči (potvrzená rodina) */
    const clen = n => { const pot = st.rodiny[prijmeni(n)]; return !Array.isArray(pot) || pot.includes(n); };
    for (const p of st.players.values()) {
        if (!p.apps && !p.goals) continue;
        if (!clen(p.name)) continue;
        const k = prijmeni(p.name);
        if (!R.has(k)) R.set(k, { k, hraci: [], zapasy: [] });
        R.get(k).hraci.push(p);
    }
    for (const [k, r] of R) if (r.hraci.length < 2) R.delete(k);
    for (const m of ms) {
        const by = {};                                   // příjmení → {hráč: góly v zápase}
        const pridej = (n, g) => { const k = prijmeni(n); if (R.has(k) && clen(n)) { by[k] = by[k] || {}; by[k][n] = (by[k][n] || 0) + g; } };
        (m.lu || []).forEach(row => { if (cas(row)) pridej(row[0], 0); });
        (m.g || []).forEach(g => { if (!g[3]) pridej(g[0], 1); });
        for (const [k, kdo] of Object.entries(by)) {
            const jm = Object.keys(kdo);
            if (jm.length > 1) R.get(k).zapasy.push({ m, kdo, g: jm.reduce((a, n) => a + kdo[n], 0), strelcu: jm.filter(n => kdo[n]).length });
        }
    }
    return [...R.values()].map(r => {
        r.hraci.sort((a, b) => b.goals - a.goals || b.apps - a.apps);
        r.zapasy.sort((a, b) => b.g - a.g || b.strelcu - a.strelcu || (b.m.d || "").localeCompare(a.m.d || ""));
        return { ...r, overeno: Array.isArray(st.rodiny[r.k]), goly: r.hraci.reduce((a, p) => a + p.goals, 0), apps: r.hraci.reduce((a, p) => a + p.apps, 0) };
    }).sort((a, b) => b.overeno - a.overeno || b.goly - a.goly || b.apps - a.apps);
}

function renderRodiny(rod) {
    document.getElementById("rodinySec").hidden = !rod.length;
    document.getElementById("rodinyPocet").textContent = rod.length ? `${rod.length} příjmení` : "";
    document.getElementById("rodiny").innerHTML = `<table class="ptable st-small">
        <thead><tr><th>Příjmení</th><th>Hráči (góly)</th><th class="ptable__num">Góly</th><th class="ptable__num">Zápasů</th><th>Nejlepší společný zápas</th></tr></thead>
        <tbody>${rod.map(r => {
            const spolu = r.zapasy.filter(z => z.g);
            const b = spolu[0];
            if (b) DETAIL.push({ titul: `${r.k} – společné zápasy s gólem (${spolu.length})`, zapasy: spolu.slice(0, 40).map(z => z.m), kdo: spolu.slice(0, 40).map(z => `${kdoDal(z.kdo)} = ${goly(z.g)}`) });
            return `<tr><td><b>${esc(r.k)}</b><br><span class="st-rod ${r.overeno ? "is-ok" : ""}">${r.overeno ? "rodina" : "stejné příjmení"}</span></td>
            <td class="st-rodina">${r.hraci.map(p => `<a href="#hrac=${encodeURIComponent(p.id)}">${esc(krestni(p.name))}</a> <small>${p.goals}</small>`).join(", ")}</td>
            <td class="ptable__num ptable__points">${r.goly}</td><td class="ptable__num">${r.apps}</td>
            <td>${b ? `<button type="button" class="st-zlink" data-det="${DETAIL.length - 1}">${goly(b.g)} (${esc(kdoDal(b.kdo))}) · ${esc(kratce(b.m.o))} ${b.m.f}:${b.m.a}, ${czd(b.m.d)}</button>` : `<span class="st-dim">–</span>`}</td></tr>`;
        }).join("")}</tbody></table>`;
}

/* ------------------------------------------------- ligové tabulky ---- */

let TAB = [];                 // tabulky pro aktuální výběr (index v data-tab)
const STAV = { p: "průběžná", n: "nedohráno" };

function renderTabulky() {
    const vse = st.tables.filter(vyber);
    TAB = vse.filter(x => st.tabTeam === "all" || x.t === st.tabTeam).sort((a, b) => b.s - a.s || a.t.localeCompare(b.t));
    document.getElementById("tabulkySec").hidden = !vse.length;
    document.getElementById("tabulkyPocet").textContent = vse.length ? `${vse.length} ${vse.length === 1 ? "tabulka" : vse.length < 5 ? "tabulky" : "tabulek"}` : "";
    /* vlastní přepínač týmu jen pro tabulky (nabízí týmy, které ve výběru tabulku mají) */
    const tymy = Object.keys(TEAMS).filter(k => vse.some(x => x.t === k));
    if (st.tabTeam !== "all" && !tymy.includes(st.tabTeam)) { st.tabTeam = "all"; return renderTabulky(); }
    const seg = document.getElementById("tabTeamSeg");
    seg.hidden = tymy.length < 2;
    seg.innerHTML = [["all", "Všechny"], ...tymy.map(k => [k, TEAMS[k]])].map(([k, l]) => `<button type="button" data-k="${k}" class="${k === st.tabTeam ? "is-on" : ""}">${l}</button>`).join("");
    seg.onclick = (e) => { const b = e.target.closest("button"); if (!b) return; st.tabTeam = b.dataset.k; renderTabulky(); };
    document.getElementById("tabulky").innerHTML = `<table class="ptable st-small st-tabs">
        <thead><tr><th>Sezóna</th><th>Soutěž</th><th class="ptable__num">Místo</th><th class="ptable__num">Z</th><th class="ptable__num">V</th><th class="ptable__num">R</th><th class="ptable__num">P</th><th class="ptable__num">Skóre</th><th class="ptable__num">Body</th><th></th></tr></thead>
        <tbody>${TAB.map((t, i) => { const r = t.nas; return `${i === 0 || TAB[i - 1].s !== t.s ? `<tr class="st-sez"><td colspan="10">Sezóna ${seasonLbl(t.s)}</td></tr>` : ""}<tr class="st-row" data-tab="${i}" tabindex="0">
            <td>${seasonLbl(t.s)}</td>
            <td><span class="st-chip st-chip--${t.t}">${t.t === "D" ? "Dor" : t.t}</span> ${esc(t.c)}${t.stav ? ` <span class="st-stav">${STAV[t.stav]}</span>` : ""}</td>
            <td class="ptable__num"><b class="st-misto${r[0] <= 3 ? " is-top" : ""}">${esc(r[0])}.</b> <span class="st-dim">/ ${t.rows.length}</span></td>
            <td class="ptable__num">${esc(r[2])}</td><td class="ptable__num">${esc(r[3])}</td><td class="ptable__num">${esc(r[4])}</td><td class="ptable__num">${esc(r[5])}</td>
            <td class="ptable__num">${esc(r[6])}</td><td class="ptable__num ptable__points">${esc(r[7])}</td><td class="st-zrow__x">▾</td></tr>`; }).join("")}</tbody></table>`;
}

function prepniTabulku(tr) {
    const next = tr.nextElementSibling;
    if (next && next.classList.contains("st-tfull")) { next.remove(); tr.classList.remove("is-open"); return; }
    const t = TAB[+tr.dataset.tab];
    if (!t) return;
    tr.insertAdjacentHTML("afterend", `<tr class="st-tfull"><td colspan="10"><table class="ptable st-small st-liga">
        <thead><tr><th>#</th><th>Tým</th><th class="ptable__num">Z</th><th class="ptable__num">V</th><th class="ptable__num">R</th><th class="ptable__num">P</th><th class="ptable__num">Skóre</th><th class="ptable__num">Body</th></tr></thead>
        <tbody>${t.rows.map(r => `<tr class="${r === t.nas ? "is-nas" : ""}"><td>${esc(r[0])}.</td><td>${esc(kratce(r[1]))}</td><td class="ptable__num">${esc(r[2])}</td><td class="ptable__num">${esc(r[3])}</td>
            <td class="ptable__num">${esc(r[4])}</td><td class="ptable__num">${esc(r[5])}</td><td class="ptable__num">${esc(r[6])}</td><td class="ptable__num"><b>${esc(r[7])}</b></td></tr>`).join("")}</tbody></table>
        <a class="st-zapis__ext" href="https://www.fotbal.cz/souteze/turnaje/table/${encodeURIComponent(t.id)}" target="_blank" rel="noopener">Tabulka na fotbal.cz ↗</a></td></tr>`);
    tr.classList.add("is-open");
}

const COLS = [
    ["name", "Hráč", false], ["team", "Tým", false], ["apps", "Z", true], ["starts", "Základ", true], ["subIn", "Střídal", true],
    ["min", "Minuty", true], ["goals", "Góly", true], ["g90", "G/90", true], ["zk", "ŽK", true], ["ck", "ČK", true]
];

function renderTable() {
    const P = [...st.players.values()].filter(p => !st.q || p.name.toLowerCase().includes(st.q));
    const key = st.sort;
    P.sort((a, b) => {
        if (key === "name") return st.dir * a.name.localeCompare(b.name, "cs");
        if (key === "team") return st.dir * [...a.teams].sort().join().localeCompare([...b.teams].sort().join());
        return st.dir * (((a[key] ?? -1) - (b[key] ?? -1)) || (a.goals - b.goals) || (a.min - b.min));
    });
    const th = COLS.map(([k, l, num]) => `<th data-k="${k}" class="${num ? "ptable__num" : ""} st-sort ${k === key ? "is-sorted" : ""}">${l}${k === key ? (st.dir < 0 ? " ▾" : " ▴") : ""}</th>`).join("");
    const rows = P.map((p, i) => `<tr data-id="${esc(p.id)}" class="st-row">
        <td><span class="st-rank">${i + 1}</span> <b>${esc(p.name)}</b>${p.posMain ? `<span class="tag">${esc(p.posMain)}</span>` : ""}</td>
        <td class="st-teamcell">${[...p.teams].sort().map(t => `<span class="st-chip st-chip--${t}">${t === "D" ? "Dor" : t}</span>`).join("")}</td>
        <td class="ptable__num">${p.apps || "–"}</td><td class="ptable__num">${p.starts || "–"}</td><td class="ptable__num">${p.subIn || "–"}</td>
        <td class="ptable__num">${p.min ? fmt(p.min) : "–"}</td><td class="ptable__num ptable__points">${p.goals || "–"}</td>
        <td class="ptable__num">${p.g90 != null ? r1(p.g90) : "–"}</td><td class="ptable__num">${p.zk || "–"}</td><td class="ptable__num">${p.ck || "–"}</td>
    </tr>`).join("");
    const t = document.getElementById("playersTable");
    t.innerHTML = `<thead><tr>${th}</tr></thead><tbody>${rows || `<tr><td colspan="10" class="st-empty">Nikdo neodpovídá.</td></tr>`}</tbody>`;
    t.querySelectorAll("th").forEach(h => h.onclick = () => { const k = h.dataset.k; if (st.sort === k) st.dir *= -1; else { st.sort = k; st.dir = k === "name" || k === "team" ? 1 : -1; } renderTable(); });
    t.querySelectorAll("tr.st-row").forEach(r => r.onclick = () => { location.hash = "hrac=" + encodeURIComponent(r.dataset.id); });
}

/* ------------------------------------------------------- karta hráče ---- */

const POZICE = { B: "brankář", O: "obránce", Z: "záložník", Ú: "útočník" };

function renderPlayer(id) {
    const el = document.getElementById("viewPlayer");
    const all = compute(st.matches, st.old);
    const p = [...all.values()].find(x => x.id === id);
    if (!p) { el.innerHTML = `<a class="st-back" href="#">← Zpět na přehled</a><p class="st-empty">Hráč nenalezen.</p>`; return; }

    // po sezónách, týmech a soutěžích + součet za každou soutěž
    const klice = new Map();
    p.perMatch.forEach(({ m }) => klice.set(`${m.s}|${m.t}|${m.u}`, { s: m.s, t: m.t, u: m.u }));
    st.old.forEach(o => { if (o.rows.some(r => r[0] === p.name)) klice.set(`${o.s}|${o.t}|${o.u}`, { s: o.s, t: o.t, u: o.u }); });
    const radek = (fm, fo) => {
        const ms = st.matches.filter(fm), os = st.old.filter(fo);
        const x = compute(ms, os).get(p.name);
        return x && (x.apps || x.goals || x.bench || x.zk) ? { x, lu: os.length > 0 || ms.some(m => (m.lu || []).length) } : null;
    };
    const bySeason = [...klice.values()].sort((a, b) => b.s - a.s || a.t.localeCompare(b.t) || poradi(a.u) - poradi(b.u))
        .map(k => ({ ...k, ...(radek(m => m.s === k.s && m.t === k.t && m.u === k.u, o => o.s === k.s && o.t === k.t && o.u === k.u) || {}) }))
        .filter(r => r.x);
    const urovne = [...new Set(bySeason.map(r => r.u))].sort((a, b) => poradi(a) - poradi(b));
    const byComp = urovne.map(u => {
        const rs = bySeason.filter(r => r.u === u);
        const z = radek(m => m.u === u, o => o.u === u);
        return { u, sez: new Set(rs.map(r => r.s)).size, x: z.x, lu: rs.some(r => r.lu), vsechnyLu: rs.every(r => r.lu) };
    });

    // tým s ním a bez něj (jen zápasy se sestavou, v týmech, kde hrál)
    const kde = new Set(p.perMatch.filter(x => x.row).map(x => x.m.s + "|" + x.m.t));      // sezóna a tým, kde byl v sestavě
    const luMs = st.matches.filter(m => (m.lu || []).length && kde.has(m.s + "|" + m.t));
    const s_ = luMs.filter(m => m.lu.some(r => r[0] === p.name && cas(r)));
    const bez = luMs.filter(m => !m.lu.some(r => r[0] === p.name && cas(r)));
    const bS = bilance(s_), bB = bilance(bez);
    const naH = naHristiStat(luMs).H.get(p.name);

    // série zápasů s gólem
    let ser = 0, maxSer = 0;
    p.perMatch.filter(x => x.c).forEach(x => { ser = x.g.length ? ser + 1 : 0; maxSer = Math.max(maxSer, ser); });      // jen zápasy se sestavou – jinde nevíme, kdy hrál bez gólu

    const partners = Object.entries(p.partners).sort((a, b) => b[1] - a[1]).slice(0, 3);
    const opp = Object.entries(p.vsOpp).sort((a, b) => b[1] - a[1])[0];
    const firstG = p.perMatch.find(x => x.g.length);
    const maxBand = Math.max(1, ...p.bands);
    const bandsLbl = ["1–15", "16–30", "31–45", "46–60", "61–75", "76–90"];
    const tile = (v, l, s = "") => `<div class="st-tile"><div class="st-tile__v">${v}</div><div class="st-tile__l">${l}</div>${s ? `<div class="st-tile__s">${s}</div>` : ""}</div>`;
    const fakta = [];
    if (p.best && p.best.k >= 2) fakta.push(`Nejlepší zápas: <b>${goly(p.best.k)}</b> proti ${esc(kratce(p.best.m.o))} (${p.best.m.f}:${p.best.m.a}, ${czd(p.best.m.d)}).`);
    if (p.hat) fakta.push(`Hattrick nebo víc: <b>${p.hat}×</b>.`);
    if (maxSer >= 2) fakta.push(`Nejdelší série zápasů s gólem: <b>${maxSer}</b> v řadě (od 2023/24).`);
    if (opp && opp[1] >= 2) fakta.push(`Nejradši střílí týmu <b>${esc(kratce(opp[0]))}</b> (${goly(opp[1])}).`);
    if (p.gMin.some(x => x >= 1)) fakta.push(`Nejrychlejší gól v <b>${Math.min(...p.gMin.filter(x => x >= 1))}. minutě</b>, nejpozdější v ${Math.max(...p.gMin)}. minutě.`);
    if (p.subGoals) fakta.push(`Po příchodu z lavičky dal <b>${goly(p.subGoals)}</b>.`);
    if (p.og) fakta.push(`Vlastní góly: ${p.og} (i to se počítá 😅).`);
    if (p.kap) fakta.push(`Kapitánskou pásku měl <b>${p.kap}×</b>.`);
    if (firstG) fakta.push(`První gól v zápisech${p.oldGoals ? " (ty jsou od 2020/21)" : ""}: ${czd(firstG.m.d)} proti ${esc(kratce(firstG.m.o))}.`);
    const naKoho = Object.entries(p.prihral).sort((a, b) => b[1] - a[1])[0], odKoho = Object.entries(p.odKoho).sort((a, b) => b[1] - a[1])[0];
    if (naKoho) fakta.push(`Nejčastěji přihrál na gól hráči <a href="#hrac=${encodeURIComponent(slug(naKoho[0]))}">${esc(naKoho[0])}</a> (${naKoho[1]}×).`);
    if (odKoho) fakta.push(`Nejvíc gólů mu přihrál <a href="#hrac=${encodeURIComponent(slug(odKoho[0]))}">${esc(odKoho[0])}</a> (${odKoho[1]}×).`);
    if (partners.length) fakta.push(`Nejčastěji se střídal s: ${partners.map(([n, k]) => `<a href="#hrac=${encodeURIComponent(slug(n))}">${esc(n)}</a> (${k}×)`).join(", ")}.`);

    DETAIL.length = 0;
    const mrows = [...p.perMatch].reverse().map(({ m, c, row, g }) => {
        const v = vysledek(m);
        DETAIL.push({ titul: `${kratce(m.vn)} – ${kratce(m.o)}, ${czd(m.d)}`, zapasy: [m], otevrit: true });
        return `<tr class="st-row" data-det="${DETAIL.length - 1}"><td>${czd(m.d)}</td><td><span class="st-chip st-chip--${m.t}">${m.t === "D" ? "Dor" : m.t}</span></td>
        <td>${m.h ? "" : "@ "}${esc(kratce(m.o))}</td>
        <td class="st-res st-res--${v}">${m.f ?? "?"}:${m.a ?? "?"}</td>
        <td class="ptable__num">${c ? (c.tin === 0 ? (c.tout === DELKA ? "90'" : `0–${c.tout}'`) : `${c.tin}–${c.tout}'`) : row ? "lavička" : (m.lu || []).length ? "" : "?"}</td>
        <td>${g.map(x => `⚽${x[1]}'${x[2] ? " (pen.)" : ""}`).join(" ")}${m.g.filter(x => x[4] === p.name).map(x => ` 🅰️${x[1]}'`).join("")}${row && row[3] != null ? ` <span class="st-card st-card--y"></span>` : ""}${row && row[4] != null ? ` <span class="st-card st-card--r"></span>` : ""}</td></tr>`;
    }).join("");

    el.innerHTML = `
    <a class="st-back" href="#">← Zpět na přehled</a>
    <section class="st-hero">
        <div class="st-hero__av">${esc(p.name.split(" ").map(s => s[0]).slice(0, 2).join(""))}</div>
        <div>
            <h2 class="st-hero__name">${esc(p.name)}</h2>
            <div class="st-hero__meta">${[...p.teams].sort().map(t => `<span class="st-chip st-chip--${t}">${TEAMS[t]}</span>`).join("")}
                ${p.posMain ? `<span class="st-hero__pos">${POZICE[p.posMain] || esc(p.posMain)}</span>` : ""}
                <span class="st-hero__pos">sezóny ${[...p.seasons].sort().map(seasonLbl).join(", ")}</span></div>
        </div>
    </section>
    <div class="st-tiles">
        ${tile(p.apps || "–", "zápasů", p.starts + p.subIn ? `od 2023/24: ${p.starts} v základu · ${p.subIn} střídal` : "")}
        ${tile(p.min ? fmt(p.min) : "–", "minut", p.apps ? `${Math.round(p.min / p.apps)} min na zápas` : "")}
        ${tile(p.goals, "gólů", p.pens ? `${p.pens} z penalty (od 2020/21)` : "")}
        ${p.kb || p.kbMin ? tile(p.assists, "asistencí", `kanadské body ${p.kb} (${p.kbG} G + ${p.assists} A) · vlastní evidence`) : ""}
        ${tile(p.g90 != null ? r1(p.g90) : "–", "gólů na 90 min", p.goalsLu && p.min ? `gól každých ${Math.round(p.min / p.goalsLu)} min` : "")}
        ${tile(p.starts + p.subIn ? p.full : "–", "celých 90 minut", p.starts + p.subIn ? "od 2023/24" : "známe až ze sestav od 2023/24")}
        ${tile(`${p.zk} / ${p.ck}`, "žluté / červené")}
    </div>

    <div class="st-grid2">
        <section class="st-box">
            <h3>Po sezónách</h3>
            <div class="archive__scroll"><table class="ptable st-small">
                <thead><tr><th>Sezóna</th><th>Soutěž</th><th class="ptable__num">Z</th><th class="ptable__num">Min</th><th class="ptable__num">Góly</th><th class="ptable__num">ŽK</th></tr></thead>
                <tbody>${bySeason.map(({ s, t, u, x, lu }) => `<tr><td>${seasonLbl(s)}</td>
                    <td><span class="st-chip st-chip--${t}">${t === "D" ? "Dor" : t}</span> ${esc(u)}</td>
                    <td class="ptable__num">${lu ? x.apps : "?"}</td>
                    <td class="ptable__num">${lu ? fmt(x.min) : "?"}</td><td class="ptable__num ptable__points">${x.goals}</td><td class="ptable__num">${x.zk}</td></tr>`).join("")}</tbody>
            </table></div>
            <p class="st-note">Do 2022/23 jsou zápasy, minuty a karty ze statistik soutěží IS FAČR (góly do 2019/20 taky), od 2020/21 góly ze zápisů, od 2023/24 všechno ze sestav.</p>
        </section>

        <section class="st-box">
            <h3>Podle soutěže</h3>
            <div class="archive__scroll"><table class="ptable st-small">
                <thead><tr><th>Soutěž</th><th class="ptable__num">Sezón</th><th class="ptable__num">Z</th><th class="ptable__num">Min</th><th class="ptable__num">Góly</th><th class="ptable__num">G/90</th></tr></thead>
                <tbody>${byComp.map(({ u, sez, x, lu, vsechnyLu }) => `<tr><td>${esc(u)}</td><td class="ptable__num">${sez}</td>
                    <td class="ptable__num">${lu ? x.apps + (vsechnyLu ? "" : "+") : "?"}</td>
                    <td class="ptable__num">${lu ? fmt(x.min) + (vsechnyLu ? "" : "+") : "?"}</td>
                    <td class="ptable__num ptable__points">${x.goals}</td><td class="ptable__num">${x.g90 != null ? r1(x.g90) : "–"}</td></tr>`).join("")}</tbody>
            </table></div>
            <p class="st-note">G/90 = góly na 90 odehraných minut.</p>
        </section>

        <section class="st-box">
            <h3>Kdy dává góly</h3>
            ${p.goals ? `<div class="st-bars">${p.bands.map((v, i) => `<div class="st-bar"><div class="st-bar__col"><div class="st-bar__fill" style="height:${Math.round(v / maxBand * 100)}%"></div></div><div class="st-bar__v">${v}</div><div class="st-bar__l">${bandsLbl[i]}'</div></div>`).join("")}</div>
            <div class="st-split">
                <div><b>${p.h1}</b> v 1. poločase</div><div><b>${p.h2}</b> ve 2. poločase</div>
                <div><b>${p.home}</b> doma</div><div><b>${p.away}</b> venku</div>
            </div>${p.oldGoals ? `<p class="st-note">Jen ${goly(p.goals - p.oldGoals)} ze zápisů od 2020/21 – u starších ${p.oldGoals} známe jen součet za sezónu.</p>` : ""}` : `<p class="st-empty">Zatím bez zapsaného gólu.</p>`}
        </section>
    </div>

    ${bS.z && bB.z ? `<section class="st-box">
        <h3>Tým s ním a bez něj</h3>
        <p class="st-note">Zápasy se sestavou v sezónách a týmech, kde hrál. „S ním“ = byl na hřišti.</p>
        <div class="st-vs">
            ${[["S ním", bS], ["Bez něj", bB]].map(([l, b]) => `<div class="st-vs__col">
                <div class="st-vs__t">${l}</div>
                <div class="st-vs__big">${r1(b.body / b.z)}</div><div class="st-vs__l">bodu na zápas</div>
                <div class="st-vs__row">${b.z} zápasů · ${b.v} V · ${b.r} R · ${b.p} P</div>
                <div class="st-vs__row">dáno ${r1(b.f / b.z)} · inkasováno ${r1(b.a / b.z)} na zápas</div></div>`).join("")}
        </div>
        ${naH && naH.min ? `<p class="st-pmrow">Když byl na hřišti (${fmt(naH.min)} min): tým dal <b>${naH.gf}</b>, dostal <b>${naH.ga}</b> → <b class="${naH.gf > naH.ga ? "c-plus" : naH.gf < naH.ga ? "c-minus" : ""}">${pm(naH.gf - naH.ga)}</b>
            (${f2((naH.gf - naH.ga) * 90 / naH.min)} na 90 min)${naH.b ? ` · v brance ${naH.bz}× · obdržel ${naH.bga} (${f2(naH.bga * 90 / naH.bmin)} na 90) · čistá konta ${naH.cista}` : ""}.</p>` : ""}
    </section>` : ""}

    ${fakta.length ? `<section class="st-box"><h3>Zajímavosti</h3><ul class="st-facts">${fakta.map(f => `<li>${f}</li>`).join("")}</ul></section>` : ""}

    <section class="st-box">
        <h3>Zápasy</h3>
        <div class="archive__scroll"><table class="ptable st-small">
            <thead><tr><th>Datum</th><th>Tým</th><th>Soupeř</th><th>Skóre</th><th class="ptable__num">Na hřišti</th><th>Góly a karty</th></tr></thead>
            <tbody>${mrows}</tbody>
        </table></div>
        <p class="st-note">@ = venku. Skóre je z pohledu Vnorov. Klik na zápas ukáže jeho zápis.</p>
    </section>`;
}
