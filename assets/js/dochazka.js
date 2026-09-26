/* ==========================================================================
   FK AGRO VNOROVY – DOCHÁZKA
   Docházka dorostu z Týmuj. Data do databáze plní synchronizace na GitHubu
   (scripts/tymuj-sync.mjs) – tahle stránka je jen čte a zobrazuje.
   Dokument: dochazka/dorost, pole `data` (JSON), `chyba` (poslední chyba).

   Omluvy (komentáře hráčů v Týmuj) vidí jen přihlášený. Pozor: je to jen
   skrytí v prohlížeči, data v databázi jsou čitelná stejně jako zbytek webu.
   ========================================================================== */

import {
    docIn, whenReady, onDbError, setStatus, initAuth, isAdmin, esc
} from "./core.js?v=9";
import { DRUHY, DOCHAZKA_KOLEKCE, DOCHAZKA_DOKUMENT } from "./tymuj.js?v=1";

import { onSnapshot } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

/* ------------------------------------------------------------------ stav --- */

let data = null;          // poslední data z databáze
let meta = {};            // aktualizovano, chyba, chybaKdy
let pohled = "sezona";    // sezona | mesice | tydny
let vse = false;          // v týdnech ukázat i áčko, béčko a přáteláky
let tyden = null;         // zobrazený týden (pondělí YYYY-MM-DD), null = poslední
let mesic = null;         // zobrazený měsíc (YYYY-MM), null = poslední
const otevreni = new Set();   // rozbalení hráči v přehledu sezóny

const el = (id) => document.getElementById(id);

/* ------------------------------------------------------------- pomocné --- */

const DNY = ["Ne", "Po", "Út", "St", "Čt", "Pá", "So"];
const datum = (iso) => { const [r, m, d] = iso.slice(0, 10).split("-"); return `${+d}. ${+m}.`; };
const datumRok = (iso) => datum(iso) + " " + iso.slice(0, 4);
const denTydne = (iso) => new Date(iso.slice(0, 10) + "T12:00:00Z").getUTCDay();
const cas = (iso) => iso.slice(11, 16);

/** Pondělí týdne, do kterého datum patří (YYYY-MM-DD). */
function pondeli(iso) {
    const d = new Date(iso.slice(0, 10) + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
}
function plusDni(isoDen, n) {
    const d = new Date(isoDen + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
}

const jeTrenink = (u) => DRUHY[u.druh] && DRUHY[u.druh].trenink && !u.zruseno;
const prijmeni = (j) => j.split(" ").slice(-1)[0];
const procento = (a, b) => b ? Math.round((a / b) * 100) : 0;

function kdy(iso) {
    const d = new Date(iso);
    const dnes = new Date();
    const vcera = new Date(Date.now() - 86400000);
    const hm = d.toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" });
    if (d.toDateString() === dnes.toDateString()) return "dnes " + hm;
    if (d.toDateString() === vcera.toDateString()) return "včera " + hm;
    return d.toLocaleDateString("cs-CZ") + " " + hm;
}

/* stav hráče u události: g = byl, n = nebyl, o = nebyl s omluvou,
   z = nezapsáno / možná, x = nebyl pozvaný (ještě nebyl v týmu) */
function stav(u, idHrace) {
    const z = u.ucast[idHrace];
    if (!z) return { k: "x" };
    const [odp, kom] = z;
    if (odp === "G") return { k: "g", kom };
    if (odp === "N") return { k: kom ? "o" : "n", kom };
    return { k: "z", kom };
}

/* ---------------------------------------------------------- statistiky ---
   Dvě docházky:
   - tréninky dorostu = kolik tréninků dorostu hráč odchodil
   - tréninkové jednotky = trénink s áčkem se počítá místo tréninku dorostu
     (domluva s hráči). Počítá se po týdnech: dorost + áčko, ale nejvýš
     tolik, kolik měl dorost ten týden tréninků – navíc se nenasbírá.
   ------------------------------------------------------------------- */

/** Tréninkové jednotky hráče za dané události: { a: odchozeno, b: z kolika }. */
function jednotky(udalosti, idHrace) {
    const tydny = new Map();
    for (const u of udalosti) {
        if (u.zruseno) continue;
        const st = stav(u, idHrace).k;
        if (st === "x") continue;
        const k = pondeli(u.zacatek);
        if (!tydny.has(k)) tydny.set(k, { dor: 0, byl: 0, a: 0 });
        const t = tydny.get(k);
        if (jeTrenink(u)) { t.dor++; if (st === "g") t.byl++; }
        else if (u.druh === "T_A" && st === "g") t.a++;
    }
    let a = 0, b = 0;
    for (const t of tydny.values()) { a += Math.min(t.byl + t.a, t.dor); b += t.dor; }
    return { a, b };
}

function statistiky() {
    const udalosti = data.udalosti;
    const treninky = udalosti.filter(jeTrenink);
    const hranice = plusDni(data.od, 7);

    return data.hraci.map(h => {
        const s = { h, byl: 0, pozvan: 0, omluven: 0, bezOmluvy: 0, nezapsano: 0,
            dny: { T_PO: [0, 0], T_UT: [0, 0], T_CT: [0, 0] }, sA: 0, Z_D: 0, Z_B: 0, Z_A: 0, prvni: null };
        for (const u of udalosti) {
            if (!u.ucast[h.id]) continue;
            if (!s.prvni) s.prvni = u.zacatek;
            const st = stav(u, h.id).k;
            if (u.zruseno) continue;
            if (u.druh === "T_A" && st === "g") s.sA++;
            if (/^Z_[DBA]$/.test(u.druh) && st === "g") s[u.druh]++;
        }
        for (const u of treninky) {
            const st = stav(u, h.id).k;
            if (st === "x") continue;
            s.pozvan++;
            if (s.dny[u.druh]) s.dny[u.druh][1]++;
            if (st === "g") { s.byl++; if (s.dny[u.druh]) s.dny[u.druh][0]++; }
            else if (st === "o") s.omluven++;
            else if (st === "n") s.bezOmluvy++;
            else s.nezapsano++;
        }
        s.pct = procento(s.byl, s.pozvan);
        s.jedn = jednotky(udalosti, h.id).a;
        s.jednPct = procento(s.jedn, s.pozvan);
        s.pozdejsi = s.prvni && s.prvni.slice(0, 10) > hranice ? s.prvni : null;
        return s;
    }).filter(s => s.pozvan > 0 || s.prvni);
}

/* ------------------------------------------------------------ vykreslení --- */

function vykresliSync() {
    const box = el("dzSync");
    if (!data) { box.innerHTML = ""; return; }
    const stari = (Date.now() - new Date(data.aktualizovano).getTime()) / 3600000;
    const chybaNovejsi = meta.chyba && meta.chybaKdy && meta.chybaKdy > new Date(data.aktualizovano);
    let cls = "dz-sync__chip", text = "Aktualizováno " + kdy(data.aktualizovano);
    if (chybaNovejsi || stari > 30) cls += " is-warn";
    box.innerHTML = `<span class="${cls}" title="Data se stahují z Týmuj automaticky ráno a večer po tréninku.">${esc(text)}</span>` +
        (chybaNovejsi ? `<span class="dz-sync__err">Poslední synchronizace selhala: ${esc(meta.chyba)}</span>` : "");
}

function vykresliKpi(stat) {
    const tr = data.udalosti.filter(jeTrenink);
    const prumerHracu = tr.length ? tr.reduce((a, u) => a + Object.values(u.ucast).filter(z => z[0] === "G").length, 0) / tr.length : 0;
    const pozvan = stat.reduce((a, s) => a + s.pozvan, 0);
    const byl = stat.reduce((a, s) => a + s.byl, 0);
    const jedn = stat.reduce((a, s) => a + s.jedn, 0);
    const zapasy = data.udalosti.filter(u => u.druh === "Z_D" && !u.zruseno).length;
    const k = (cislo, popis, tip = "") => `<div class="dz-kpi"${tip ? ` title="${tip}"` : ""}><b>${cislo}</b><span>${popis}</span></div>`;
    el("dzKpis").innerHTML =
        k(tr.length, "tréninků dorostu") +
        k(prumerHracu.toLocaleString("cs-CZ", { maximumFractionDigits: 1 }), "hráčů v průměru na tréninku") +
        k(procento(jedn, pozvan) + " %", "tréninkové jednotky", "Trénink s áčkem se počítá místo tréninku dorostu") +
        k(procento(byl, pozvan) + " %", "tréninky dorostu") +
        k(zapasy, "zápasů dorostu");
}

function bunkaDne(s, druh) {
    const [a, b] = s.dny[druh];
    return `<td class="dz-num">${b ? `${a}<small>/${b}</small>` : "–"}</td>`;
}

function vykresliSezonu() {
    const stat = statistiky().sort((a, b) => b.jednPct - a.jednPct || b.pct - a.pct || b.byl - a.byl || prijmeni(a.h.jmeno).localeCompare(prijmeni(b.h.jmeno), "cs"));
    vykresliKpi(stat);
    const admin = isAdmin();
    const metr = (pct) => `<td class="dz-pct"><div class="dz-meter"><i class="${pct >= 70 ? "hi" : pct >= 45 ? "mid" : "lo"}" style="width:${pct}%"></i></div><b>${pct} %</b></td>`;

    const radky = stat.map((s, i) => {
        const stitky = [
            s.pozdejsi ? `<span class="tag">od ${datum(s.pozdejsi)}</span>` : "",
            s.h.dlouhodobaOmluva ? `<span class="tag tag--warn" title="${esc(s.h.dlouhodobaOmluva.pozn || "")}">dlouhodobě omluven</span>` : ""
        ].join("");
        const otevreny = otevreni.has(s.h.id);
        let detail = "";
        if (otevreny) {
            const chybel = data.udalosti.filter(jeTrenink).map(u => ({ u, st: stav(u, s.h.id) })).filter(x => x.st.k !== "g" && x.st.k !== "x").reverse();
            detail = `<tr class="dz-detail"><td></td><td colspan="15">${chybel.length ? `<ul class="dz-miss">${chybel.map(({ u, st }) => `
                <li class="is-${st.k}"><b>${DNY[denTydne(u.zacatek)]} ${datum(u.zacatek)}</b> ${esc(u.nazev)}
                    <span>${st.k === "o" ? (admin ? "omluva: " + esc(st.kom) : "omluven") : st.k === "n" ? "bez omluvy" : "nezapsáno"}</span></li>`).join("")}</ul>`
                : "<p>Na žádném tréninku nechyběl. 👏</p>"}
                ${admin ? "" : `<p class="dz-hint">Text omluv vidí jen přihlášený.</p>`}</td></tr>`;
        }
        return `<tr class="dz-row${otevreny ? " is-open" : ""}" data-hrac="${esc(s.h.id)}">
            <td class="ptable__rank">${i + 1}.</td>
            <td class="dz-name"><span class="dz-caret">▸</span>${esc(s.h.jmeno)}${stitky}</td>
            ${metr(s.jednPct)}
            <td class="dz-num"><b>${s.jedn}</b><small>/${s.pozvan}</small></td>
            ${metr(s.pct)}
            <td class="dz-num"><b>${s.byl}</b><small>/${s.pozvan}</small></td>
            ${bunkaDne(s, "T_PO")}${bunkaDne(s, "T_UT")}${bunkaDne(s, "T_CT")}
            <td class="dz-num dz-a">${s.sA || ""}</td>
            <td class="dz-num dz-o">${s.omluven || ""}</td>
            <td class="dz-num dz-n">${s.bezOmluvy || ""}</td>
            <td class="dz-num dz-z">${s.nezapsano || ""}</td>
            <td class="dz-num">${s.Z_D || ""}</td><td class="dz-num">${s.Z_B || ""}</td><td class="dz-num">${s.Z_A || ""}</td>
        </tr>${detail}`;
    }).join("");

    el("dzView").innerHTML = `
        <div class="table-card"><div class="archive__scroll">
            <table class="ptable dz-table">
                <thead>
                    <tr class="dz-grp"><th colspan="2"></th><th colspan="2" class="dz-grp--main">Tréninkové jednotky</th><th colspan="2">Tréninky dorostu</th><th colspan="4">Podle dne</th><th colspan="3">Chyběl na tréninku dorostu</th><th colspan="3">Zápasy</th></tr>
                    <tr><th>#</th><th>Hráč</th>
                        <th title="Trénink s áčkem se počítá místo tréninku dorostu (nejvýš tolik, kolik měl dorost ten týden tréninků)">Docházka</th><th class="dz-num">Jedn.</th>
                        <th>Docházka</th><th class="dz-num">Byl</th>
                        <th class="dz-num">Po</th><th class="dz-num">Út</th><th class="dz-num">Čt</th><th class="dz-num" title="Tréninky s áčkem">S áčkem</th>
                        <th class="dz-num">Omluven</th><th class="dz-num">Bez omluvy</th><th class="dz-num" title="V Týmuj bez odpovědi nebo „možná“">Nezaps.</th>
                        <th class="dz-num">D</th><th class="dz-num">B</th><th class="dz-num">A</th></tr>
                </thead>
                <tbody>${radky}</tbody>
            </table>
        </div></div>`;
    el("dzNote").textContent = "Řazeno podle tréninkových jednotek: trénink s áčkem se počítá místo tréninku dorostu, po týdnech a nejvýš tolik, kolik měl dorost ten týden tréninků. Tréninky dorostu = jen tréninky dorostu (Po, Út, Čt a jiné). Klikni na hráče – rozbalí se tréninky, na kterých chyběl, i s omluvou.";
}

function vykresliTydny() {
    vykresliKpi(statistiky());
    const admin = isAdmin();

    // všechny týdny sezóny, nejnovější první – zobrazuje se vždy jen jeden
    const klice = [...new Set(data.udalosti.map(u => pondeli(u.zacatek)))].sort().reverse();
    if (!klice.length) { el("dzView").innerHTML = `<p class="dz-empty">Zatím žádné události.</p>`; return; }
    if (!tyden || !klice.includes(tyden)) tyden = klice[0];
    const idx = klice.indexOf(tyden);
    const k = tyden, konec = plusDni(k, 6);

    const vTydnu = data.udalosti.filter(u => pondeli(u.zacatek) === k);
    const ud = vTydnu.filter(u => vse || DRUHY[u.druh].trenink || u.druh === "Z_D")
        .sort((a, b) => a.zacatek.localeCompare(b.zacatek));
    const tr = ud.filter(jeTrenink);
    const hraci = [...data.hraci].sort((a, b) => prijmeni(a.jmeno).localeCompare(prijmeni(b.jmeno), "cs"))
        .filter(h => vTydnu.some(u => u.ucast[h.id]));
    const prumer = tr.length ? tr.reduce((a, u) => a + Object.values(u.ucast).filter(z => z[0] === "G").length, 0) / tr.length : 0;

    const hlavicky = ud.map(u => {
        const pritomno = Object.values(u.ucast).filter(z => z[0] === "G").length;
        const d = DRUHY[u.druh];
        return `<th class="dz-ev dz-ev--${u.druh}${u.zruseno ? " is-off" : ""}${d.trenink ? "" : " is-extra"}" title="${esc(u.nazev)} · ${cas(u.zacatek)}">
            <span class="dz-ev__d">${DNY[denTydne(u.zacatek)]} ${datum(u.zacatek)}</span>
            <span class="dz-ev__n">${esc(d.kratce)}${u.druh.startsWith("Z_") ? " · " + esc(u.nazev.replace(/^[ABD]\s*-\s*/, "")) : ""}</span>
            <span class="dz-ev__c">${u.zruseno ? "zrušeno" : pritomno + " přít."}</span></th>`;
    }).join("");

    const radky = hraci.map(h => {
        let a = 0, b = 0;
        for (const u of vTydnu) { if (!jeTrenink(u)) continue; const st = stav(u, h.id).k; if (st === "x") continue; b++; if (st === "g") a++; }
        const j = jednotky(vTydnu, h.id);
        const bunky = ud.map(u => {
            const st = stav(u, h.id);
            if (u.zruseno) return `<td class="dz-c is-off"></td>`;
            const ikona = { g: "✓", n: "✗", o: "✗", z: "?", x: "" }[st.k];
            const omluva = st.k === "o"
                ? `<span class="dz-om" title="${admin ? esc(st.kom) : "omluven"}">${admin ? esc(st.kom.length > 28 ? st.kom.slice(0, 27) + "…" : st.kom) : "omluven"}</span>` : "";
            return `<td class="dz-c is-${st.k}"><i>${ikona}</i>${omluva}</td>`;
        }).join("");
        const pomer = (x, y, cls = "") => `<td class="dz-num dz-week${cls}">${y ? `<b>${x}</b><small>/${y}</small>` : "–"}</td>`;
        return `<tr><td class="dz-name">${esc(h.jmeno)}</td>${bunky}${pomer(j.a, j.b, j.a > a ? " dz-week--a" : "")}${pomer(a, b)}</tr>`;
    }).join("");

    const volby = klice.map(x => `<option value="${x}"${x === k ? " selected" : ""}>${datum(x)} – ${datumRok(plusDni(x, 6))}</option>`).join("");

    el("dzView").innerHTML = `<div class="dz-weekcard">
        <div class="dz-weekcard__head">
            <div class="dz-weeknav">
                <button type="button" class="btn btn--ghost" data-tyden="${klice[idx + 1] || ""}"${idx + 1 < klice.length ? "" : " disabled"} title="Předchozí týden">◀</button>
                <select class="field" id="dzTyden" aria-label="Týden">${volby}</select>
                <button type="button" class="btn btn--ghost" data-tyden="${klice[idx - 1] || ""}"${idx > 0 ? "" : " disabled"} title="Další týden">▶</button>
            </div>
            <span>${tr.length ? `${tr.length} ${tr.length === 1 ? "trénink" : tr.length < 5 ? "tréninky" : "tréninků"} dorostu · průměrně ${prumer.toLocaleString("cs-CZ", { maximumFractionDigits: 1 })} hráčů` : "bez tréninku dorostu"}</span>
        </div>
        <div class="archive__scroll">
            <table class="ptable dz-wtable">
                <thead><tr><th>Hráč</th>${hlavicky}<th class="dz-num" title="Tréninkové jednotky – trénink s áčkem se počítá místo tréninku dorostu">Jednotky</th><th class="dz-num">Dorost</th></tr></thead>
                <tbody>${radky}</tbody>
            </table>
        </div>
    </div>`;
    el("dzNote").innerHTML = `✓ byl · ✗ chyběl · <span class="dz-om">omluven</span> chyběl s omluvou · ? nezapsáno. Prázdné políčko = hráč tehdy ještě nebyl v týmu. <b>Jednotky</b> = tréninky dorostu + tréninky s áčkem (nejvýš tolik, kolik měl dorost ten týden tréninků).${admin ? "" : " Text omluv vidí jen přihlášený."}`;
}

const MESICE = ["leden", "únor", "březen", "duben", "květen", "červen", "červenec", "srpen", "září", "říjen", "listopad", "prosinec"];
const nazevMesice = (ym) => MESICE[+ym.slice(5, 7) - 1] + " " + ym.slice(0, 4);

/* Měsíc: pořadí podle počtu tréninkových jednotek – podklad pro odměny.
   Jednotky se počítají jen z událostí toho měsíce (týden přes přelom
   měsíce se rozdělí). */
function vykresliMesice() {
    vykresliKpi(statistiky());
    const admin = isAdmin();
    const klice = [...new Set(data.udalosti.map(u => u.zacatek.slice(0, 7)))].sort().reverse();
    if (!klice.length) { el("dzView").innerHTML = `<p class="dz-empty">Zatím žádné události.</p>`; return; }
    if (!mesic || !klice.includes(mesic)) mesic = klice[0];
    const idx = klice.indexOf(mesic);
    const probiha = mesic === new Date().toISOString().slice(0, 7);

    const vMesici = data.udalosti.filter(u => u.zacatek.slice(0, 7) === mesic);
    const tr = vMesici.filter(jeTrenink).sort((a, b) => a.zacatek.localeCompare(b.zacatek));

    const radky = data.hraci.filter(h => vMesici.some(u => u.ucast[h.id])).map(h => {
        const s = { h, byl: 0, pozvan: 0, sA: 0, omluven: 0, bezOmluvy: 0, tecky: [] };
        for (const u of tr) {
            const st = stav(u, h.id);
            s.tecky.push({ u, st });
            if (st.k === "x") continue;
            s.pozvan++;
            if (st.k === "g") s.byl++; else if (st.k === "o") s.omluven++; else if (st.k === "n") s.bezOmluvy++;
        }
        s.sA = vMesici.filter(u => u.druh === "T_A" && !u.zruseno && stav(u, h.id).k === "g").length;
        s.jedn = jednotky(vMesici, h.id).a;
        return s;
    }).sort((a, b) => b.jedn - a.jedn || b.byl - a.byl || prijmeni(a.h.jmeno).localeCompare(prijmeni(b.h.jmeno), "cs"));

    // pořadí se sdílenými místy (stejný počet = stejné místo)
    let misto = 0, minule = null;
    const medaile = ["🥇", "🥈", "🥉"];
    const html = radky.map((s, i) => {
        const klic = s.jedn + "/" + s.byl;
        if (klic !== minule) { misto = i + 1; minule = klic; }
        const top = misto <= 3 && s.jedn > 0;
        const pct = procento(s.jedn, s.pozvan);
        const tecky = s.tecky.map(({ u, st }) => {
            const co = { g: "byl", n: "chyběl bez omluvy", o: "omluven" + (admin && st.kom ? ": " + st.kom : ""), z: "nezapsáno", x: "ještě nebyl v týmu" }[st.k];
            return `<i class="is-${st.k}" title="${esc(`${DNY[denTydne(u.zacatek)]} ${datum(u.zacatek)} ${u.nazev} – ${co}`)}"></i>`;
        }).join("");
        return `<tr class="${top ? "dz-top" : ""}">
            <td class="ptable__rank">${top ? medaile[misto - 1] : misto + "."}</td>
            <td class="dz-name">${esc(s.h.jmeno)}</td>
            <td class="dz-num dz-big"><b>${s.jedn}</b><small>/${s.pozvan}</small></td>
            <td class="dz-pct"><div class="dz-meter"><i class="${pct >= 70 ? "hi" : pct >= 45 ? "mid" : "lo"}" style="width:${pct}%"></i></div><b>${pct} %</b></td>
            <td class="dz-num"><b>${s.byl}</b><small>/${s.pozvan}</small></td>
            <td class="dz-num dz-a">${s.sA || ""}</td>
            <td class="dz-num dz-o">${s.omluven || ""}</td>
            <td class="dz-num dz-n">${s.bezOmluvy || ""}</td>
            <td class="dz-dots">${tecky}</td>
        </tr>`;
    }).join("");

    const volby = klice.map(x => `<option value="${x}"${x === mesic ? " selected" : ""}>${nazevMesice(x)}</option>`).join("");
    el("dzView").innerHTML = `<div class="dz-weekcard">
        <div class="dz-weekcard__head">
            <div class="dz-weeknav">
                <button type="button" class="btn btn--ghost" data-mesic="${klice[idx + 1] || ""}"${idx + 1 < klice.length ? "" : " disabled"} title="Předchozí měsíc">◀</button>
                <select class="field" id="dzMesic" aria-label="Měsíc">${volby}</select>
                <button type="button" class="btn btn--ghost" data-mesic="${klice[idx - 1] || ""}"${idx > 0 ? "" : " disabled"} title="Další měsíc">▶</button>
            </div>
            <span>${tr.length} ${tr.length === 1 ? "trénink" : tr.length >= 2 && tr.length <= 4 ? "tréninky" : "tréninků"} dorostu${probiha ? " · měsíc ještě běží" : ""}</span>
        </div>
        <div class="archive__scroll">
            <table class="ptable dz-table dz-mtable">
                <thead><tr><th>#</th><th>Hráč</th>
                    <th class="dz-num" title="Tréninkové jednotky – trénink s áčkem se počítá místo tréninku dorostu">Jednotky</th><th></th>
                    <th class="dz-num">Dorost</th><th class="dz-num">S áčkem</th><th class="dz-num">Omluven</th><th class="dz-num">Bez omluvy</th>
                    <th>Tréninky dorostu v měsíci</th></tr></thead>
                <tbody>${html}</tbody>
            </table>
        </div>
    </div>`;
    el("dzNote").innerHTML = `Pořadí podle počtu tréninkových jednotek v měsíci (trénink s áčkem se počítá místo tréninku dorostu, v každém týdnu nejvýš tolik, kolik měl dorost tréninků), při shodě rozhoduje víc tréninků dorostu. Tečky: <i class="dz-dot is-g"></i> byl · <i class="dz-dot is-o"></i> omluven · <i class="dz-dot is-n"></i> chyběl · <i class="dz-dot is-z"></i> nezapsáno – najetím myší se ukáže trénink.`;
}

function vykresli() {
    vykresliSync();
    el("dzAllWrap").hidden = pohled !== "tydny";
    if (!data) {
        el("dzKpis").innerHTML = "";
        el("dzView").innerHTML = `<p class="dz-empty">${meta.chyba ? "Synchronizace s Týmuj selhala: " + esc(meta.chyba) : "Data z Týmuj zatím nedorazila."}</p>`;
        el("dzNote").textContent = "";
        return;
    }
    el("dzOd").textContent = datumRok(data.od);
    if (pohled === "sezona") vykresliSezonu(); else if (pohled === "mesice") vykresliMesice(); else vykresliTydny();
}

/* ------------------------------------------------------------- ovládání --- */

document.querySelectorAll(".dz-seg button").forEach(b => b.addEventListener("click", () => {
    pohled = b.dataset.view;
    document.querySelectorAll(".dz-seg button").forEach(x => x.classList.toggle("is-on", x === b));
    vykresli();
}));
el("dzAll").addEventListener("change", (e) => { vse = e.target.checked; vykresli(); });
el("dzView").addEventListener("change", (e) => {
    if (e.target.id === "dzTyden") { tyden = e.target.value; vykresli(); }
    if (e.target.id === "dzMesic") { mesic = e.target.value; vykresli(); }
});
el("dzView").addEventListener("click", (e) => {
    const m = e.target.closest("[data-mesic]");
    if (m) { if (m.dataset.mesic) { mesic = m.dataset.mesic; vykresli(); } return; }
    const t = e.target.closest("[data-tyden]");
    if (t) { if (t.dataset.tyden) { tyden = t.dataset.tyden; vykresli(); } return; }
    const r = e.target.closest(".dz-row");
    if (!r) return;
    const id = r.dataset.hrac;
    otevreni.has(id) ? otevreni.delete(id) : otevreni.add(id);
    vykresli();
});

initAuth(vykresli);

whenReady(() => {
    onSnapshot(docIn(DOCHAZKA_KOLEKCE, DOCHAZKA_DOKUMENT), (snap) => {
        setStatus("online");
        const d = snap.exists() ? snap.data() : {};
        meta = {
            chyba: d.chyba || "",
            chybaKdy: d.chybaKdy && d.chybaKdy.toDate ? d.chybaKdy.toDate() : null
        };
        try { data = d.data ? JSON.parse(d.data) : null; } catch { data = null; }
        vykresli();
    }, onDbError);
});
