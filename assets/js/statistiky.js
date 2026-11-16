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

const st = { matches: [], old: [], team: "all", from: null, to: null, comps: new Set(), allComps: [], q: "", sort: "min", dir: -1, players: new Map() };

/* ------------------------------------------------------------ načtení ---- */

whenReady(async () => {
    try {
        const snap = await getDocs(col("statistiky"));
        let upd = "";
        snap.forEach(d => {
            const x = d.data();
            if (d.id === "is" && x.souhrny) nactiIS(JSON.parse(x.souhrny));
            if (x.data) JSON.parse(x.data).forEach(m => st.matches.push(m));
            if (x.aktualizovano && x.aktualizovano > upd) upd = x.aktualizovano;
        });
        st.matches.forEach(m => { m.t = teamOf(m); m.u = uroven(m.c); });
        pohary();
        st.old.forEach(o => { o.t = teamOf(o); o.u = uroven(o.c); });
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

/** Statistiky soutěží ze starého IS FAČR: řádek [id, jméno, příjmení, tým, G, Z, ŽK, ČK, min] → skupiny podle týmu. */
function nactiIS(souteze) {
    for (const c of souteze) {
        const tymy = new Map();
        for (const r of c.rows) {
            const vn = r[3];
            if (!tymy.has(vn)) tymy.set(vn, []);
            tymy.get(vn).push([`${r[2]} ${r[1]}`.trim(), +r[4] || 0, +r[6] || 0, +r[7] || 0, +r[5] || 0, +r[8] || 0]);
        }
        for (const [vn, rows] of tymy) st.old.push({ s: c.s, c: c.c, vn, rows });
    }
}

/** Soutěž sjednocená přes přejmenování (od 2025/26 se krajské a okresní třídy jmenují „N. liga“). */
function uroven(c) {
    c = c || "";
    if (/dorost/i.test(c)) {
        const druh = /mladší/i.test(c) ? "ml. dorost" : "dorost";
        if (/4\. liga|krajský přebor|KP/i.test(c)) return `Krajský přebor – ${druh}`;
        if (/5\. liga|I\.\s*tř|I\.\s*A|krajská/i.test(c)) return `Krajská soutěž – ${druh}`;
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

function vysledek(m) { return m.f == null ? null : m.f > m.a ? "V" : m.f === m.a ? "R" : "P"; }

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
            p.teams.add(m.t); p.seasons.add(m.s);
            const c = cas(row);
            inMatch.set(row[0], { row, c });
            if (row[6] && row[6] !== "N") p.pos[row[6]] = (p.pos[row[6]] || 0) + 1;
            if (row[7]) p.kap++;
            if (row[3] != null) p.zk++;
            if (row[4] != null) p.ck++;
            if (!c) { p.bench++; continue; }
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
    for (const o of old) {
        if (o.s >= 2023) continue;
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

const vyber = x => (st.team === "all" || x.t === st.team) && x.s >= st.from && x.s <= st.to && (!st.comps.size || st.comps.has(x.u));
function filtered() { return st.matches.filter(vyber); }
function filteredOld() { return st.old.filter(vyber); }

/* ----------------------------------------------------------- filtry ---- */

function buildFilters() {
    const seg = document.getElementById("teamSeg");
    const opts = [["all", "Všechny"], ...Object.entries(TEAMS)];
    seg.innerHTML = opts.map(([k, l]) => `<button type="button" data-k="${k}" class="${k === st.team ? "is-on" : ""}">${l}</button>`).join("");
    seg.onclick = (e) => { const b = e.target.closest("button"); if (!b) return; st.team = b.dataset.k; seg.querySelectorAll("button").forEach(x => x.classList.toggle("is-on", x === b)); renderOverview(); };

    const seasons = [...new Set([...st.matches, ...st.old].map(m => m.s))].sort((a, b) => a - b);
    st.from = seasons[0]; st.to = seasons[seasons.length - 1];
    const sf = document.getElementById("seasonFrom"), stt = document.getElementById("seasonTo");
    const opt = s => `<option value="${s}">${seasonLbl(s)}</option>`;
    sf.innerHTML = seasons.map(opt).join(""); stt.innerHTML = [...seasons].reverse().map(opt).join("");
    sf.value = st.from; stt.value = st.to;
    sf.onchange = () => { st.from = +sf.value; if (st.to < st.from) { st.to = st.from; stt.value = st.to; } renderOverview(); };
    stt.onchange = () => { st.to = +stt.value; if (st.from > st.to) { st.from = st.to; sf.value = st.from; } renderOverview(); };

    st.allComps = [...new Set([...st.matches, ...st.old].map(m => m.u))].sort((a, b) => poradi(a) - poradi(b) || a.localeCompare(b, "cs"));
    const chips = document.getElementById("compChips");
    const drawChips = () => { chips.innerHTML = st.allComps.map(c => `<button type="button" class="st-cchip ${st.comps.has(c) ? "is-on" : ""}" data-c="${esc(c)}">${esc(c)}</button>`).join(""); };
    drawChips();
    chips.onclick = (e) => { const b = e.target.closest("button"); if (!b) return; const c = b.dataset.c; st.comps.has(c) ? st.comps.delete(c) : st.comps.add(c); drawChips(); renderOverview(); };
    document.getElementById("compAll").onclick = () => { st.comps.clear(); drawChips(); renderOverview(); };
    document.getElementById("searchInp").oninput = (e) => { st.q = e.target.value.trim().toLowerCase(); renderTable(); };
}

/* ------------------------------------------------------------ routing ---- */

function route() {
    const m = location.hash.match(/^#hrac=(.+)$/);
    const ov = document.getElementById("viewOverview"), pv = document.getElementById("viewPlayer");
    document.getElementById("filterBar").hidden = !!m;
    if (m) { ov.hidden = true; pv.hidden = false; renderPlayer(decodeURIComponent(m[1])); window.scrollTo(0, 0); }
    else { pv.hidden = true; ov.hidden = false; renderOverview(); }
}

/* ----------------------------------------------------------- přehled ---- */

function renderOverview() {
    const ms = filtered();
    st.players = compute(ms, filteredOld());
    document.getElementById("loadInfo").hidden = true;
    ["teamsSec", "recordsSec", "seasonTopSec", "tableSec"].forEach(id => document.getElementById(id).hidden = false);
    renderPopis(ms);
    renderTeams(ms);
    renderRecords(ms);
    renderSeasonTop(ms, filteredOld());
    renderTable();
}

/** Popis toho, co je vybrané a odkud čísla pro tyto sezóny jsou. */
function renderPopis(ms) {
    const el = document.getElementById("popis");
    const sez = st.from === st.to ? `sezóna ${seasonLbl(st.from)}` : `sezóny ${seasonLbl(st.from)} – ${seasonLbl(st.to)}`;
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
        <div class="st-popis__nums"><span><b>${P.filter(p => p.apps || p.goals).length}</b> hráčů</span><span><b>${fmt(sum("goals"))}</b> gólů</span>
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
    const teams = st.team === "all" ? Object.keys(TEAMS) : [st.team];
    el.innerHTML = teams.map(t => {
        const tm = ms.filter(m => m.t === t);
        if (!tm.length) return "";
        const b = bilance(tm);
        const P = compute(tm);
        const top = [...P.values()].sort((a, b) => b.goals - a.goals)[0];
        const big = tm.filter(m => m.f != null).sort((a, b) => (b.f - b.a) - (a.f - a.a))[0];
        return `<div class="st-team">
            <div class="st-team__name">${TEAMS[t]}</div>
            <div class="st-team__row"><b>${b.z}</b> zápasů · <span class="c-ok">${b.v} V</span> · ${b.r} R · <span class="c-bad">${b.p} P</span></div>
            <div class="st-team__row">skóre <b>${b.f}:${b.a}</b> · ${r1(b.z ? b.body / b.z : 0)} bodu na zápas</div>
            ${top ? `<div class="st-team__row">nejlepší střelec <a href="#hrac=${encodeURIComponent(top.id)}">${esc(top.name)}</a> (${goly(top.goals)})</div>` : ""}
            ${big ? `<div class="st-team__row">nejvyšší výhra ${big.f}:${big.a} ${big.h ? "doma s" : "v"} ${esc(kratce(big.o))} (${czd(big.d)})</div>` : ""}
        </div>`;
    }).join("");
}

function kratce(o) { return String(o || "").replace(/,?\s*z\.\s*s\.?/g, "").replace(/\s+/g, " ").trim(); }

function renderRecords(ms) {
    const P = [...st.players.values()];
    const link = p => `<a href="#hrac=${encodeURIComponent(p.id)}">${esc(p.name)}</a>`;
    const top = (key, f = x => x[key] > 0) => P.filter(f).sort((a, b) => b[key] - a[key])[0];
    const cards = [];
    const add = (ico, title, p, val, sub = "") => { if (p) cards.push(`<div class="st-rec"><div class="st-rec__ico">${ico}</div><div><div class="st-rec__t">${title}</div><div class="st-rec__p">${link(p)}</div><div class="st-rec__v">${val}${sub ? ` · ${sub}` : ""}</div></div></div>`); };
    let p;
    if ((p = top("goals"))) add("⚽", "Nejlepší střelec", p, goly(p.goals), p.pens ? `${p.pens} z penalty` : "");
    const ss = sezonniStrelci(ms, filteredOld())[0];
    if (ss) add("🏆", "Nejvíc gólů za sezónu", ss.p, goly(ss.g), `${seasonLbl(ss.s)} · ${TEAMS[ss.t]}`);
    if ((p = top("min"))) add("⏱️", "Nejvíc minut", p, `${fmt(p.min)} min`, `${p.apps} zápasů`);
    if ((p = top("g90", x => x.g90 != null && x.goalsLu > 0))) add("🎯", "Nejlepší poměr", p, `${r1(p.g90)} gólu na 90 min`, `gól každých ${Math.round(p.min / p.goalsLu)} min`);
    if ((p = top("full"))) add("🛡️", "Železný muž", p, `${p.full}× celých 90 minut`);
    if ((p = top("subGoals"))) add("🔁", "Žolík z lavičky", p, `${goly(p.subGoals)} po střídání`);
    if ((p = top("hat"))) add("🎩", "Hattricky", p, `${p.hat}× tři a víc gólů`);
    // nejvíc gólů v jednom zápase
    const best = P.filter(x => x.best).sort((a, b) => b.best.k - a.best.k)[0];
    if (best) add("🔥", "Nejvíc gólů v zápase", best, goly(best.best.k), `${kratce(best.best.m.o)} ${best.best.m.f}:${best.best.m.a}, ${czd(best.best.m.d)}`);
    // nejrychlejší gól
    let fast = null;
    ms.forEach(m => (m.g || []).forEach(g => { if (!g[3] && g[1] >= 1 && (!fast || g[1] < fast.g[1])) fast = { g, m }; }));
    if (fast) { const fp = st.players.get(fast.g[0]); add("⚡", "Nejrychlejší gól", fp, `${fast.g[1]}. minuta`, `${kratce(fast.m.o)}, ${czd(fast.m.d)}`); }
    // gól v nastavení / poslední minuta
    let late = null;
    ms.forEach(m => (m.g || []).forEach(g => { if (!g[3] && (!late || g[1] > late.g[1])) late = { g, m }; }));
    if (late) { const lp = st.players.get(late.g[0]); add("🕐", "Nejpozdější gól", lp, `${late.g[1]}. minuta`, `${kratce(late.m.o)}, ${czd(late.m.d)}`); }
    if ((p = top("zk"))) add("🟨", "Nejvíc žlutých", p, `${p.zk} žlutých`, p.ck ? `${p.ck}× červená` : "");
    if ((p = top("kap"))) add("©️", "Kapitán", p, `${p.kap}× s páskou`);
    if ((p = top("apps"))) add("👟", "Nejvíc zápasů", p, `${p.apps} zápasů`, `${p.starts} v základu`);
    // nejvíc různých týmů / sezón
    if ((p = P.filter(x => x.teams.size > 1).sort((a, b) => b.teams.size - a.teams.size || b.apps - a.apps)[0])) add("🔀", "Za víc týmů", p, [...p.teams].map(t => TEAMS[t]).join(" + "));
    document.getElementById("records").innerHTML = cards.join("") || `<div class="st-empty">Pro tento výběr nejsou data.</div>`;
}

const COLS = [
    ["name", "Hráč", false], ["team", "Tým", false], ["apps", "Z", true], ["starts", "Základ", true], ["subIn", "Střídal", true],
    ["min", "Minuty", true], ["goals", "Góly", true], ["g90", "G/90", true], ["zk", "ŽK", true], ["ck", "ČK", true]
];

function renderTable() {
    const P = [...st.players.values()].filter(p => !st.q || p.name.toLowerCase().includes(st.q));
    const key = st.sort;
    P.sort((a, b) => {
        if (key === "name") return st.dir * -1 * a.name.localeCompare(b.name, "cs");
        if (key === "team") return st.dir * -1 * [...a.teams].join().localeCompare([...b.teams].join());
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
        return x && (x.apps || x.goals || x.bench || x.zk || os.length) ? { x, lu: os.length > 0 || ms.some(m => (m.lu || []).length) } : null;
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
    const luMs = st.matches.filter(m => (m.lu || []).length && p.teams.has(m.t) && p.seasons.has(m.s));
    const s_ = luMs.filter(m => m.lu.some(r => r[0] === p.name && cas(r)));
    const bez = luMs.filter(m => !m.lu.some(r => r[0] === p.name && cas(r)));
    const bS = bilance(s_), bB = bilance(bez);

    // série zápasů s gólem
    let ser = 0, maxSer = 0;
    p.perMatch.filter(x => x.c || x.g.length).forEach(x => { ser = x.g.length ? ser + 1 : 0; maxSer = Math.max(maxSer, ser); });

    const partners = Object.entries(p.partners).sort((a, b) => b[1] - a[1]).slice(0, 3);
    const opp = Object.entries(p.vsOpp).sort((a, b) => b[1] - a[1])[0];
    const firstG = p.perMatch.find(x => x.g.length);
    const maxBand = Math.max(1, ...p.bands);
    const bandsLbl = ["1–15", "16–30", "31–45", "46–60", "61–75", "76–90"];
    const tile = (v, l, s = "") => `<div class="st-tile"><div class="st-tile__v">${v}</div><div class="st-tile__l">${l}</div>${s ? `<div class="st-tile__s">${s}</div>` : ""}</div>`;
    const fakta = [];
    if (p.best && p.best.k >= 2) fakta.push(`Nejlepší zápas: <b>${goly(p.best.k)}</b> proti ${esc(kratce(p.best.m.o))} (${p.best.m.f}:${p.best.m.a}, ${czd(p.best.m.d)}).`);
    if (p.hat) fakta.push(`Hattrick nebo víc: <b>${p.hat}×</b>.`);
    if (maxSer >= 2) fakta.push(`Nejdelší série zápasů s gólem: <b>${maxSer}</b> v řadě.`);
    if (opp && opp[1] >= 2) fakta.push(`Nejradši střílí týmu <b>${esc(kratce(opp[0]))}</b> (${goly(opp[1])}).`);
    if (p.gMin.some(x => x >= 1)) fakta.push(`Nejrychlejší gól v <b>${Math.min(...p.gMin.filter(x => x >= 1))}. minutě</b>, nejpozdější v ${Math.max(...p.gMin)}. minutě.`);
    if (p.subGoals) fakta.push(`Po příchodu z lavičky dal <b>${goly(p.subGoals)}</b>.`);
    if (p.og) fakta.push(`Vlastní góly: ${p.og} (i to se počítá 😅).`);
    if (p.kap) fakta.push(`Kapitánskou pásku měl <b>${p.kap}×</b>.`);
    if (firstG) fakta.push(`První zapsaný gól: ${czd(firstG.m.d)} proti ${esc(kratce(firstG.m.o))}.`);
    if (partners.length) fakta.push(`Nejčastěji se střídal s: ${partners.map(([n, k]) => `<a href="#hrac=${encodeURIComponent(slug(n))}">${esc(n)}</a> (${k}×)`).join(", ")}.`);

    const mrows = [...p.perMatch].reverse().map(({ m, c, row, g }) => {
        const v = vysledek(m);
        return `<tr><td>${czd(m.d)}</td><td><span class="st-chip st-chip--${m.t}">${m.t === "D" ? "Dor" : m.t}</span></td>
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
                ${p.posMain ? `<span class="st-hero__pos">${POZICE[p.posMain] || p.posMain}</span>` : ""}
                <span class="st-hero__pos">sezóny ${[...p.seasons].sort().map(seasonLbl).join(", ")}</span></div>
        </div>
    </section>
    <div class="st-tiles">
        ${tile(p.apps || "–", "zápasů", p.starts + p.subIn ? `od 2023/24: ${p.starts} v základu · ${p.subIn} střídal` : "")}
        ${tile(p.min ? fmt(p.min) : "–", "minut", p.apps ? `${Math.round(p.min / p.apps)} min na zápas` : "")}
        ${tile(p.goals, "gólů", p.pens ? `${p.pens} z penalty (od 2020/21)` : "")}
        ${tile(p.g90 != null ? r1(p.g90) : "–", "gólů na 90 min", p.goalsLu && p.min ? `gól každých ${Math.round(p.min / p.goalsLu)} min` : "")}
        ${tile(p.full, "celých 90 minut")}
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
            </div>` : `<p class="st-empty">Zatím bez zapsaného gólu.</p>`}
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
        <p class="st-note">@ = venku. Skóre je z pohledu Vnorov.</p>
    </section>`;
}
