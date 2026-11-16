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

const st = { matches: [], old: [], tables: [], team: "all", from: null, to: null, seasons: new Set(), allSeasons: [], comps: new Set(), q: "", sort: "min", dir: -1, players: new Map() };

/* ------------------------------------------------------------ načtení ---- */

whenReady(async () => {
    try {
        const snap = await getDocs(col("statistiky"));
        let upd = "", is = [];
        snap.forEach(d => {
            const x = d.data();
            try {                                         // jeden poškozený dokument nesmí shodit celou stránku
                if (d.id === "is" && x.souhrny) is = JSON.parse(x.souhrny).filter(c => c && Array.isArray(c.rows));
                if (d.id === "tabulky" && x.tabulky) st.tables = JSON.parse(x.tabulky);
                if (x.data) JSON.parse(x.data).forEach(m => st.matches.push(m));
                if (x.aktualizovano && x.aktualizovano > upd) upd = x.aktualizovano;
            } catch (e) { console.warn("Statistiky: dokument", d.id, "se nedá přečíst", e); }
        });
        cistaData();
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
        (m.g || []).forEach(g => { if (!g[3]) g[0] = k(g[0]); });
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
            goals: 0, goalsLu: 0, pens: 0, subGoals: 0, og: 0, zk: 0, ck: 0, kap: 0, pos: {}, gMin: [], home: 0, away: 0,
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
        for (const [n, , , own] of (m.ga || [])) if (own && inMatch.has(n)) get(n).og++;
        for (const [n, k] of Object.entries(gBy)) {
            const p = get(n);
            if (k >= 2) p.multi++;
            if (k >= 3) p.hat++;
            if (!p.best || k > p.best.k) p.best = { k, m };
        }
        const names = new Set([...inMatch.keys(), ...Object.keys(gBy)]);
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
        p.posMain = Object.entries(p.pos).sort((a, b) => b[1] - a[1])[0]?.[0] || "";
    }
    return P;
}

const vyber = x => (st.team === "all" || x.t === st.team) && (!st.seasons.size || st.seasons.has(x.s)) && (!st.comps.size || st.comps.has(x.u));
function filtered() { return st.matches.filter(vyber); }
function filteredOld() { return st.old.filter(vyber); }

/* ----------------------------------------------------------- filtry ---- */

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
        cChips.innerHTML = comps.map(c => `<button type="button" class="st-cchip ${st.comps.has(c) ? "is-on" : ""}" data-c="${esc(c)}">${esc(c)}</button>`).join("");
    };
    window.__drawChips = drawChips;
    drawChips();
    sChips.onclick = (e) => { const b = e.target.closest("button"); if (!b) return; const s = +b.dataset.s; st.seasons.has(s) ? st.seasons.delete(s) : st.seasons.add(s); drawChips(); renderOverview(); };
    cChips.onclick = (e) => { const b = e.target.closest("button"); if (!b) return; const c = b.dataset.c; st.comps.has(c) ? st.comps.delete(c) : st.comps.add(c); drawChips(); renderOverview(); };
    document.getElementById("seasonAll").onclick = () => { st.seasons.clear(); drawChips(); renderOverview(); };
    document.getElementById("compAll").onclick = () => { st.comps.clear(); drawChips(); renderOverview(); };
    document.getElementById("searchInp").oninput = (e) => { st.q = e.target.value.trim().toLowerCase(); renderTable(); };
}

/* ------------------------------------------------------------ routing ---- */

function route() {
    const m = location.hash.match(/^#hrac=(.+)$/);
    const ov = document.getElementById("viewOverview"), pv = document.getElementById("viewPlayer");
    document.getElementById("filterBar").hidden = !!m;
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
    renderRodiny(rod);
    renderTable();
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

function otevriDetail(det) {
    if (!det) return;
    const box = document.getElementById("detailBox");
    const p = det.hrac;
    let zs = (det.zapasy || []).map((m, i) => ({ m, kdo: det.kdo ? det.kdo[i] : "" }));
    if (!det.kdo) zs.sort((a, b) => (b.m.d || "").localeCompare(a.m.d || ""));
    box.innerHTML = `<div class="st-modal__head"><h3>${esc(det.titul)}</h3><button type="button" class="st-modal__x" data-zavrit aria-label="Zavřít">✕</button></div>
        ${p ? `<a class="st-modal__card" href="#hrac=${encodeURIComponent(p.id)}" data-zavrit>Otevřít kartu hráče ${esc(p.name)} ›</a>` : ""}
        ${(det.souhrny || []).length ? `<div class="st-modal__l">Starší sezóny</div><ul class="st-modal__sum">${det.souhrny.map(s => `<li>${esc(s)}</li>`).join("")}</ul>` : ""}
        ${zs.length ? `<div class="st-modal__l">${zs.length === 1 ? "Zápas" : `Zápasy (${zs.length})`} – klikni a rozbalí se zápis</div>
            <div class="st-zlist">${zs.map(({ m, kdo }) => {
                const g = p && !det.kdo ? golyHrace(m, p.name) : [];
                return radekZapasu(m, kdo || (g.length ? g.map(x => `⚽ ${x[1]}'`).join(" ") : ""));
            }).join("")}</div>` : (det.souhrny || []).length ? "" : `<p class="st-note">K tomu nejsou zápisy jednotlivých zápasů – podrobnosti jsou na kartě hráče.</p>`}`;
    document.getElementById("detailOverlay").classList.add("is-open");
    document.body.style.overflow = "hidden";
    if (det.otevrit && zs.length === 1) prepniZapis(box.querySelector("[data-zap]"));
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
            <span>${esc(g[0])}${g[2] ? " (pen.)" : ""}${g[3] ? " (vlastní)" : ""}${hracSoupere ? ` <small>${esc(kratce(m.o))}</small>` : ""}</span></div>`;
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
    const top = (key, f = x => x[key] > 0) => P.filter(f).sort((a, b) => b[key] - a[key])[0];
    const cards = [];
    /* det = {titul, zapasy, souhrny (řádky textu), kdo (popisky řádků), otevrit (rovnou zápis jediného zápasu)} */
    const add = (ico, title, p, val, sub = "", det = null, zdroj = "") => {
        if (!p) return;
        const popisek = typeof p === "string";             // místo hráče jen text (rodinné góly)
        DETAIL.push({ hrac: popisek ? null : p, ...(det || {}), titul: (det && det.titul) || `${title} – ${popisek ? p : p.name}` });
        cards.push(`<div class="st-rec" data-det="${DETAIL.length - 1}" role="button" tabindex="0"><div class="st-rec__ico">${ico}</div><div class="st-rec__b">
            <div class="st-rec__t">${title}${zdroj && stare ? ` <span class="st-rec__src">${zdroj}</span>` : ""}</div>
            <div class="st-rec__p">${popisek ? esc(p) : link(p)}</div><div class="st-rec__v">${esc(val)}${sub ? ` · ${esc(sub)}` : ""}</div></div>
            <div class="st-rec__more">›</div></div>`);
    };
    const golZapasy = (p, f = () => true) => ms.filter(m => golyHrace(m, p.name).length && f(m));
    const souhrnyHrace = (p, f = () => true) => os.filter(o => o.s < 2020 && f(o)).flatMap(o => o.rows.filter(r => r[0] === p.name && r[1])
        .map(r => `${seasonLbl(o.s)} · ${o.u}: ${goly(r[1])} v ${r[4]} zápasech (jen součet za soutěž, zápisy zápasů nejsou)`));
    let p;
    if ((p = top("goals"))) add("⚽", "Nejlepší střelec", p, goly(p.goals), p.pens ? `${p.pens} z penalty od 2020/21` : "",
        { zapasy: golZapasy(p), souhrny: souhrnyHrace(p) });
    const ss = sezonniStrelci(ms, os)[0];
    if (ss) add("🏆", "Nejvíc gólů za sezónu", ss.p, goly(ss.g), `${seasonLbl(ss.s)} · ${TEAMS[ss.t]}`,
        { titul: `${ss.p.name} – ${goly(ss.g)} v sezóně ${seasonLbl(ss.s)}`, zapasy: golZapasy(ss.p, m => m.s === ss.s && m.t === ss.t), souhrny: souhrnyHrace(ss.p, o => o.s === ss.s && o.t === ss.t) });
    if ((p = top("min"))) add("⏱️", "Nejvíc minut", p, `${fmt(p.min)} min`, `${p.apps} zápasů`);
    if ((p = top("g90", x => x.g90 != null && x.goalsLu > 0))) add("🎯", "Nejlepší poměr", p, `${r1(p.g90)} gólu na 90 min`, `gól každých ${Math.round(p.min / p.goalsLu)} min`,
        { zapasy: golZapasy(p) });
    if ((p = top("full"))) add("🛡️", "Železný muž", p, `${p.full}× celých 90 minut`, "",
        { zapasy: ms.filter(m => { const r = rowOf(m, p.name); const c = r && cas(r); return c && c.tin === 0 && c.tout === DELKA; }) }, "od 2023/24");
    if ((p = top("subGoals"))) add("🔁", "Žolík z lavičky", p, `${goly(p.subGoals)} po střídání`, "",
        { zapasy: golZapasy(p, m => { const r = rowOf(m, p.name); return r && !r[1] && cas(r); }) }, "od 2023/24");
    const hatAll = [];
    ms.forEach(m => { const c = {}; (m.g || []).forEach(g => { if (!g[3]) c[g[0]] = (c[g[0]] || 0) + 1; }); Object.entries(c).forEach(([n, k]) => { if (k >= 3) hatAll.push({ m, n, k }); }); });
    hatAll.sort((a, b) => b.k - a.k || (b.m.d || "").localeCompare(a.m.d || ""));
    if ((p = top("hat"))) add("🎩", "Hattricky", p, `${p.hat}× tři a víc gólů`, `všech hattricků: ${hatAll.length}`,
        { titul: `Hattricky – všichni hráči (${hatAll.length})`, zapasy: hatAll.map(x => x.m), kdo: hatAll.map(x => `${x.n} – ${goly(x.k)}`) }, "od 2020/21");
    const best = P.filter(x => x.best).sort((a, b) => b.best.k - a.best.k)[0];
    if (best) add("🔥", "Nejvíc gólů v zápase", best, goly(best.best.k), `${kratce(best.best.m.o)} ${best.best.m.f}:${best.best.m.a}, ${czd(best.best.m.d)}`,
        { zapasy: [best.best.m], otevrit: true }, "od 2020/21");
    const rz = rod.flatMap(r => r.zapasy.filter(z => z.strelcu > 1).map(z => ({ ...z, k: r.k }))).sort((a, b) => b.g - a.g || (b.m.d || "").localeCompare(a.m.d || ""));
    if (rz.length) add("👨‍👦", "Rodinné góly v zápase", `${rz[0].k} – ${kdoDal(rz[0].kdo)}`, goly(rz[0].g), `${kratce(rz[0].m.o)} ${rz[0].m.f}:${rz[0].m.a}, ${czd(rz[0].m.d)}`,
        { titul: "Rodinné góly – nejvíc gólů hráčů se stejným příjmením v zápase", zapasy: rz.slice(0, 30).map(z => z.m), kdo: rz.slice(0, 30).map(z => `${z.k}: ${kdoDal(z.kdo)} = ${goly(z.g)}`) }, "od 2020/21");
    let fast = null;
    ms.forEach(m => (m.g || []).forEach(g => { if (!g[3] && g[1] >= 1 && (!fast || g[1] < fast.g[1])) fast = { g, m }; }));
    if (fast) add("⚡", "Nejrychlejší gól", st.players.get(fast.g[0]), `${fast.g[1]}. minuta`, `${kratce(fast.m.o)}, ${czd(fast.m.d)}`, { zapasy: [fast.m], otevrit: true }, "od 2020/21");
    let late = null;
    ms.forEach(m => (m.g || []).forEach(g => { if (!g[3] && (!late || g[1] > late.g[1])) late = { g, m }; }));
    if (late) add("🕐", "Nejpozdější gól", st.players.get(late.g[0]), `${late.g[1]}. minuta`, `${kratce(late.m.o)}, ${czd(late.m.d)}`, { zapasy: [late.m], otevrit: true }, "od 2020/21");
    if ((p = top("zk"))) add("🟨", "Nejvíc žlutých", p, `${p.zk} žlutých`, p.ck ? `${p.ck}× červená` : "",
        { zapasy: ms.filter(m => { const r = rowOf(m, p.name); return r && (r[3] != null || r[4] != null); }) });
    if ((p = top("kap"))) add("©️", "Kapitán", p, `${p.kap}× s páskou`, "", { zapasy: ms.filter(m => { const r = rowOf(m, p.name); return r && r[7]; }) }, "od 2023/24");
    if ((p = top("apps"))) add("👟", "Nejvíc zápasů", p, `${p.apps} zápasů`, p.starts ? `od 2023/24 ${p.starts}× v základu` : "");
    if ((p = P.filter(x => x.teams.size > 1).sort((a, b) => b.teams.size - a.teams.size || b.apps - a.apps)[0])) add("🔀", "Za víc týmů", p, [...p.teams].map(t => TEAMS[t]).join(" + "));
    document.getElementById("records").innerHTML = cards.join("") || `<div class="st-empty">Pro tento výběr nejsou data.</div>`;
}

/* ------------------------------------------ rodiny (stejné příjmení) ---- */

const bezRocniku = n => n.replace(/\s*\(ročník \d+\)$/, "");
const prijmeni = n => { const t = bezRocniku(n).split(" "); return t.length > 1 ? t.slice(0, -1).join(" ") : t[0]; };
const krestni = n => n.slice(prijmeni(n).length + 1) || n;
const kdoDal = kdo => Object.entries(kdo).filter(x => x[1]).sort((a, b) => b[1] - a[1]).map(([n, g]) => `${krestni(n)} ${g}`).join(" + ");

/** Příjmení s víc hráči ve výběru: hráči, součty a zápasy, kde byli aspoň dva (na hřišti nebo mezi střelci). */
function rodiny(ms) {
    const R = new Map();
    for (const p of st.players.values()) {
        if (!p.apps && !p.goals) continue;
        const k = prijmeni(p.name);
        if (!R.has(k)) R.set(k, { k, hraci: [], zapasy: [] });
        R.get(k).hraci.push(p);
    }
    for (const [k, r] of R) if (r.hraci.length < 2) R.delete(k);
    for (const m of ms) {
        const by = {};                                   // příjmení → {hráč: góly v zápase}
        const pridej = (n, g) => { const k = prijmeni(n); if (R.has(k)) { by[k] = by[k] || {}; by[k][n] = (by[k][n] || 0) + g; } };
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
        return { ...r, goly: r.hraci.reduce((a, p) => a + p.goals, 0), apps: r.hraci.reduce((a, p) => a + p.apps, 0) };
    }).sort((a, b) => b.goly - a.goly || b.apps - a.apps);
}

function renderRodiny(rod) {
    document.getElementById("rodinySec").hidden = !rod.length;
    document.getElementById("rodiny").innerHTML = `<table class="ptable st-small">
        <thead><tr><th>Příjmení</th><th>Hráči (góly)</th><th class="ptable__num">Góly</th><th class="ptable__num">Zápasů</th><th>Nejlepší společný zápas</th></tr></thead>
        <tbody>${rod.map(r => {
            const spolu = r.zapasy.filter(z => z.g);
            const b = spolu[0];
            if (b) DETAIL.push({ titul: `${r.k} – společné zápasy s gólem (${spolu.length})`, zapasy: spolu.slice(0, 40).map(z => z.m), kdo: spolu.slice(0, 40).map(z => `${kdoDal(z.kdo)} = ${goly(z.g)}`) });
            return `<tr><td><b>${esc(r.k)}</b></td>
            <td class="st-rodina">${r.hraci.map(p => `<a href="#hrac=${encodeURIComponent(p.id)}">${esc(krestni(p.name))}</a> <small>${p.goals}</small>`).join(", ")}</td>
            <td class="ptable__num ptable__points">${r.goly}</td><td class="ptable__num">${r.apps}</td>
            <td>${b ? `<button type="button" class="st-zlink" data-det="${DETAIL.length - 1}">${goly(b.g)} (${esc(kdoDal(b.kdo))}) · ${esc(kratce(b.m.o))} ${b.m.f}:${b.m.a}, ${czd(b.m.d)}</button>` : `<span class="st-dim">–</span>`}</td></tr>`;
        }).join("")}</tbody></table>`;
}

/* ------------------------------------------------- ligové tabulky ---- */

let TAB = [];                 // tabulky pro aktuální výběr (index v data-tab)
const STAV = { p: "průběžná", n: "nedohráno" };

function renderTabulky() {
    TAB = st.tables.filter(vyber).sort((a, b) => b.s - a.s || a.t.localeCompare(b.t));
    document.getElementById("tabulkySec").hidden = !TAB.length;
    document.getElementById("tabulky").innerHTML = `<table class="ptable st-small st-tabs">
        <thead><tr><th>Sezóna</th><th>Soutěž</th><th class="ptable__num">Místo</th><th class="ptable__num">Z</th><th class="ptable__num">V</th><th class="ptable__num">R</th><th class="ptable__num">P</th><th class="ptable__num">Skóre</th><th class="ptable__num">Body</th><th></th></tr></thead>
        <tbody>${TAB.map((t, i) => { const r = t.nas; return `<tr class="st-row" data-tab="${i}" tabindex="0">
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
    if (partners.length) fakta.push(`Nejčastěji se střídal s: ${partners.map(([n, k]) => `<a href="#hrac=${encodeURIComponent(slug(n))}">${esc(n)}</a> (${k}×)`).join(", ")}.`);

    DETAIL.length = 0;
    const mrows = [...p.perMatch].reverse().map(({ m, c, row, g }) => {
        const v = vysledek(m);
        DETAIL.push({ titul: `${kratce(m.vn)} – ${kratce(m.o)}, ${czd(m.d)}`, zapasy: [m], otevrit: true });
        return `<tr class="st-row" data-det="${DETAIL.length - 1}"><td>${czd(m.d)}</td><td><span class="st-chip st-chip--${m.t}">${m.t === "D" ? "Dor" : m.t}</span></td>
        <td>${m.h ? "" : "@ "}${esc(kratce(m.o))}</td>
        <td class="st-res st-res--${v}">${m.f ?? "?"}:${m.a ?? "?"}</td>
        <td class="ptable__num">${c ? (c.tin === 0 ? (c.tout === DELKA ? "90'" : `0–${c.tout}'`) : `${c.tin}–${c.tout}'`) : row ? "lavička" : (m.lu || []).length ? "" : "?"}</td>
        <td>${g.map(x => `⚽${x[1]}'${x[2] ? " (pen.)" : ""}`).join(" ")}${row && row[3] != null ? ` <span class="st-card st-card--y"></span>` : ""}${row && row[4] != null ? ` <span class="st-card st-card--r"></span>` : ""}</td></tr>`;
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
