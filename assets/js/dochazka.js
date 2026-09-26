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
import { DRUHY, DOCHAZKA_KOLEKCE, DOCHAZKA_DOKUMENT, HISTORIE_DOKUMENT, prihlasenVcas } from "./tymuj.js?v=2";

import { onSnapshot } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

/* ------------------------------------------------------------------ stav --- */

let data = null;          // poslední data z databáze
let meta = {};            // aktualizovano, chyba, chybaKdy
let historie = null;      // časy odpovědí z Týmuj (dokument dochazka/historie)
let pohled = "sezona";    // sezona | mesice | tydny
let vse = false;          // v týdnech ukázat i áčko, béčko a přáteláky
let tyden = null;         // zobrazený týden (pondělí YYYY-MM-DD), null = poslední
let mesic = null;         // zobrazený měsíc (YYYY-MM), null = poslední

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
const tridaMetru = (pct) => pct > 100 ? "plus" : pct >= 70 ? "hi" : pct >= 45 ? "mid" : "lo";

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

/* ------------------------------------------------- historie odpovědí ---
   Záznam = [čas "2026-08-25T13:46:08", odpověď G/N/M, kdo zadal ("" = hráč
   sám), komentář]. Komentáře (omluvy) vidí jen přihlášený.
   ------------------------------------------------------------------- */

const ODP_TEXT = { G: "jde", N: "nejde", M: "možná", "": "bez odpovědi" };
const hist = (u, idHrace) => (historie && historie.udalosti && historie.udalosti[u.id] && historie.udalosti[u.id][idHrace]) || [];
const maHistorii = (u) => !!(historie && historie.udalosti && historie.udalosti[u.id]);
const casZaznamu = (c) => `${+c.slice(8, 10)}. ${+c.slice(5, 7)}. ${c.slice(11, 16)}`;

/** Přihlásil se pozdě (po 12:00 v den tréninku)? Jen tréninky dorostu a jen když historii máme. */
function pozde(u, idHrace) {
    if (!jeTrenink(u) || !maHistorii(u) || !u.ucast[idHrace]) return false;
    return !prihlasenVcas(hist(u, idHrace), u.zacatek.slice(0, 10));
}

/** Historie jako text (do title) – jeden řádek na změnu. */
function historieText(u, idHrace, admin) {
    const z = hist(u, idHrace);
    if (!z.length) return maHistorii(u) ? "Bez odpovědi v Týmuj" : "";
    return z.map(([c, o, kdo, kom]) => `${casZaznamu(c)}  ${ODP_TEXT[o] || o}${kdo ? " – zadal " + kdo : ""}${kom && admin ? " – „" + kom + "“" : ""}`).join("\n");
}

/** Historie jako HTML (karta hráče a detail události). */
function historieHtml(u, idHrace, admin) {
    const z = hist(u, idHrace);
    if (!z.length) return maHistorii(u) ? `<span class="dz-h dz-h--none">bez odpovědi</span>` : "";
    return z.map(([c, o, kdo, kom]) => `<span class="dz-h dz-h--${o || "x"}"><b>${casZaznamu(c)}</b> ${ODP_TEXT[o] || esc(o)}${kdo ? ` <em>(${esc(kdo)})</em>` : ""}${kom && admin ? ` – „${esc(kom)}“` : ""}</span>`).join("");
}

/* ---------------------------------------------------------- statistiky ---
   Dvě docházky:
   - tréninky dorostu = kolik tréninků dorostu hráč odchodil
   - tréninkové jednotky = tréninky dorostu + tréninky s áčkem (domluva:
     trénink s áčkem se počítá místo tréninku dorostu). Bez stropu – kdo
     trénuje navíc s áčkem, může mít přes 100 % (počítá se z tréninků dorostu).
   ------------------------------------------------------------------- */

/** Tréninkové jednotky hráče za dané události: { a: odchozeno, b: tréninků dorostu }. */
function jednotky(udalosti, idHrace) {
    let a = 0, b = 0;
    for (const u of udalosti) {
        if (u.zruseno) continue;
        const st = stav(u, idHrace).k;
        if (st === "x") continue;
        if (jeTrenink(u)) { b++; if (st === "g") a++; }
        else if (u.druh === "T_A" && st === "g") a++;
    }
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
    const metr = (pct) => `<td class="dz-pct"><div class="dz-meter"><i class="${tridaMetru(pct)}" style="width:${Math.min(pct, 100)}%"></i></div><b>${pct} %</b></td>`;

    const radky = stat.map((s, i) => {
        const stitky = [
            s.pozdejsi ? `<span class="tag">od ${datum(s.pozdejsi)}</span>` : "",
            s.h.dlouhodobaOmluva ? `<span class="tag tag--warn" title="${esc(s.h.dlouhodobaOmluva.pozn || "")}">dlouhodobě omluven</span>` : ""
        ].join("");
        return `<tr class="dz-row" data-hrac="${esc(s.h.id)}">
            <td class="ptable__rank">${i + 1}.</td>
            <td class="dz-name"><span class="dz-link">${esc(s.h.jmeno)}</span>${stitky}</td>
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
        </tr>`;
    }).join("");

    el("dzView").innerHTML = `
        <div class="table-card"><div class="archive__scroll">
            <table class="ptable dz-table">
                <thead>
                    <tr class="dz-grp"><th colspan="2"></th><th colspan="2" class="dz-grp--main">Tréninkové jednotky</th><th colspan="2">Tréninky dorostu</th><th colspan="4">Podle dne</th><th colspan="3">Chyběl na tréninku dorostu</th><th colspan="3">Zápasy</th></tr>
                    <tr><th>#</th><th>Hráč</th>
                        <th title="Tréninky dorostu + tréninky s áčkem, v poměru k počtu tréninků dorostu – může být přes 100 %">Docházka</th><th class="dz-num">Jedn.</th>
                        <th>Docházka</th><th class="dz-num">Byl</th>
                        <th class="dz-num">Po</th><th class="dz-num">Út</th><th class="dz-num">Čt</th><th class="dz-num" title="Tréninky s áčkem">S áčkem</th>
                        <th class="dz-num">Omluven</th><th class="dz-num">Bez omluvy</th><th class="dz-num" title="V Týmuj bez odpovědi nebo „možná“">Nezaps.</th>
                        <th class="dz-num">D</th><th class="dz-num">B</th><th class="dz-num">A</th></tr>
                </thead>
                <tbody>${radky}</tbody>
            </table>
        </div></div>`;
    el("dzNote").textContent = "Řazeno podle tréninkových jednotek = tréninky dorostu + tréninky s áčkem, v poměru k počtu tréninků dorostu. Kdo trénuje navíc s áčkem, může mít přes 100 %. Tréninky dorostu = jen tréninky dorostu (Po, Út, Čt a jiné). Klikni na hráče – otevře se jeho karta s celou docházkou a filtry.";
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
        return `<th class="dz-ev dz-ev--${u.druh}${u.zruseno ? " is-off" : ""}${d.trenink ? "" : " is-extra"}" data-udalost="${u.id}" title="${esc(u.nazev)} · ${cas(u.zacatek)} – klikni pro detail a časy odpovědí">
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
            const pozd = pozde(u, h.id) ? `<span class="dz-late" title="Nepřihlášen do 12:00">po 12</span>` : "";
            return `<td class="dz-c is-${st.k}" title="${esc(historieText(u, h.id, admin))}"><i>${ikona}</i>${omluva}${pozd}</td>`;
        }).join("");
        const pomer = (x, y, cls = "") => `<td class="dz-num dz-week${cls}">${y ? `<b>${x}</b><small>/${y}</small>` : "–"}</td>`;
        return `<tr><td class="dz-name"><span class="dz-link" data-hrac="${esc(h.id)}">${esc(h.jmeno)}</span></td>${bunky}${pomer(j.a, j.b, j.a > a ? " dz-week--a" : "")}${pomer(a, b)}</tr>`;
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
    el("dzNote").innerHTML = `✓ byl · ✗ chyběl · <span class="dz-om">omluven</span> chyběl s omluvou · ? nezapsáno. Prázdné políčko = hráč tehdy ještě nebyl v týmu. <b>Jednotky</b> = tréninky dorostu + tréninky s áčkem (z počtu tréninků dorostu, může být víc).${admin ? "" : " Text omluv vidí jen přihlášený."}`;
}

const MESICE = ["leden", "únor", "březen", "duben", "květen", "červen", "červenec", "srpen", "září", "říjen", "listopad", "prosinec"];
const nazevMesice = (ym) => MESICE[+ym.slice(5, 7) - 1] + " " + ym.slice(0, 4);

/* Měsíc: pořadí podle počtu tréninkových jednotek – podklad pro odměny. */
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
            <td class="dz-name"><span class="dz-link" data-hrac="${esc(s.h.id)}">${esc(s.h.jmeno)}</span></td>
            <td class="dz-num dz-big"><b>${s.jedn}</b><small>/${s.pozvan}</small></td>
            <td class="dz-pct"><div class="dz-meter"><i class="${tridaMetru(pct)}" style="width:${Math.min(pct, 100)}%"></i></div><b>${pct} %</b></td>
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
    el("dzNote").innerHTML = `Pořadí podle počtu tréninkových jednotek v měsíci (tréninky dorostu + tréninky s áčkem), při shodě rozhoduje víc tréninků dorostu. Tečky: <i class="dz-dot is-g"></i> byl · <i class="dz-dot is-o"></i> omluven · <i class="dz-dot is-n"></i> chyběl · <i class="dz-dot is-z"></i> nezapsáno – najetím myší se ukáže trénink.`;
}

/* ------------------------------------------------------- karta hráče ---
   Celá docházka jednoho hráče za sezónu: souhrn, měsíce a seznam všech
   událostí s filtry (druh, stav, měsíc). Otevírá se klikem na jméno.
   ------------------------------------------------------------------- */

const DRUHY_DOROST = ["T_PO", "T_UT", "T_CT", "T_JINY"];
const FILTR_DRUHY = [
    ["T_PO", "Po – kondice"], ["T_UT", "Út"], ["T_CT", "Čt"], ["T_JINY", "Jiný trénink"],
    ["T_A", "S áčkem"], ["Z_D", "Zápas D"], ["Z_B", "Zápas B"], ["Z_A", "Zápas A"], ["PRAT", "Přátelák"]
];
const FILTR_STAVY = [["g", "Byl"], ["o", "Omluven"], ["n", "Bez omluvy"], ["z", "Nezapsáno"]];
const STAV_TEXT = { g: "byl", o: "omluven", n: "chyběl bez omluvy", z: "nezapsáno" };

let karta = null;   // { id, druhy: Set, stavy: Set, mesic: "" }

function otevriKartu(id) {
    karta = { id, druhy: new Set(DRUHY_DOROST), stavy: new Set(["g", "o", "n", "z"]), mesic: "" };
    vykresliKartu();
    el("dzKarta").classList.add("is-open");
}

function vykresliKartu() {
    if (!karta || !data || karta.udalost) return;
    const h = data.hraci.find(x => x.id === karta.id);
    if (!h) return;
    const admin = isAdmin();
    const s = statistiky().find(x => x.h.id === h.id) || {};
    const moje = data.udalosti.filter(u => u.ucast[h.id] && !u.zruseno);

    // souhrn po měsících
    const mesice = [...new Set(moje.map(u => u.zacatek.slice(0, 7)))].sort();
    const poMesicich = mesice.map(m => {
        const um = moje.filter(u => u.zacatek.slice(0, 7) === m);
        const tr = um.filter(jeTrenink);
        const byl = tr.filter(u => stav(u, h.id).k === "g").length;
        const j = jednotky(um, h.id);
        const pct = procento(j.a, j.b);
        return `<div class="dz-kmes">
            <span class="dz-kmes__m">${nazevMesice(m)}</span>
            <div class="dz-meter"><i class="${tridaMetru(pct)}" style="width:${Math.min(pct, 100)}%"></i></div>
            <span class="dz-kmes__v"><b>${j.a}</b>/${j.b} jedn. · dorost ${byl}/${tr.length}</span>
        </div>`;
    }).join("");

    // filtrovaný seznam
    const seznam = moje.filter(u => karta.druhy.has(u.druh))
        .filter(u => !karta.mesic || u.zacatek.slice(0, 7) === karta.mesic)
        .map(u => ({ u, st: stav(u, h.id) }))
        .filter(x => karta.stavy.has(x.st.k))
        .sort((a, b) => b.u.zacatek.localeCompare(a.u.zacatek));
    const bylo = seznam.filter(x => x.st.k === "g").length;

    const chip = (typ, k, text, on) => `<button type="button" class="dz-chip${on ? " is-on" : ""}" data-${typ}="${k}">${text}</button>`;
    const kpi = (cislo, popis, cls = "") => `<div class="dz-kk${cls}"><b>${cislo}</b><span>${popis}</span></div>`;

    el("dzKartaObsah").innerHTML = `
        <div class="dz-karta__head">
            <div>
                <h3>${esc(h.jmeno)}</h3>
                <p>${s.prvni ? "V týmu od " + datum(s.prvni) + " · " : ""}sezóna od ${datumRok(data.od)}${h.dlouhodobaOmluva ? ` · <span class="tag tag--warn">dlouhodobě omluven</span>` : ""}</p>
            </div>
            <button type="button" class="btn btn--ghost btn--sm" data-close>Zavřít</button>
        </div>

        <div class="dz-kks">
            ${kpi(`${s.jednPct ?? 0} %`, `tréninkové jednotky (${s.jedn ?? 0}/${s.pozvan ?? 0})`, " is-main")}
            ${kpi(`${s.pct ?? 0} %`, `tréninky dorostu (${s.byl ?? 0}/${s.pozvan ?? 0})`)}
            ${kpi(s.dny ? `${s.dny.T_PO[0]}/${s.dny.T_PO[1]}` : "–", "pondělní kondice")}
            ${kpi(s.dny ? `${s.dny.T_UT[0]}/${s.dny.T_UT[1]} · ${s.dny.T_CT[0]}/${s.dny.T_CT[1]}` : "–", "úterý · čtvrtek")}
            ${kpi(s.sA ?? 0, "tréninků s áčkem")}
            ${kpi(`${s.Z_D ?? 0} / ${s.Z_B ?? 0} / ${s.Z_A ?? 0}`, "zápasy D / B / A")}
            ${kpi(`${s.omluven ?? 0} · ${s.bezOmluvy ?? 0} · ${s.nezapsano ?? 0}`, "omluven · bez omluvy · nezapsáno")}
        </div>

        <h4 class="dz-karta__h">Po měsících</h4>
        <div class="dz-kmesice">${poMesicich || "<p>Zatím nic.</p>"}</div>

        <h4 class="dz-karta__h">Všechny události</h4>
        <div class="dz-filtry">
            <div class="dz-filtr">
                <span>Druh</span>
                ${chip("rychle", "dorost", "Tréninky dorostu", DRUHY_DOROST.every(d => karta.druhy.has(d)) && karta.druhy.size === 4)}
                ${chip("rychle", "vse", "Vše", karta.druhy.size === FILTR_DRUHY.length)}
                <i class="dz-sep"></i>
                ${FILTR_DRUHY.map(([k, t]) => chip("druh", k, t, karta.druhy.has(k))).join("")}
            </div>
            <div class="dz-filtr">
                <span>Stav</span>
                ${FILTR_STAVY.map(([k, t]) => chip("stav", k, t, karta.stavy.has(k))).join("")}
                <select class="field dz-kselect" id="dzKartaMesic" aria-label="Měsíc">
                    <option value="">Celá sezóna</option>
                    ${mesice.slice().reverse().map(m => `<option value="${m}"${m === karta.mesic ? " selected" : ""}>${nazevMesice(m)}</option>`).join("")}
                </select>
            </div>
        </div>
        <p class="dz-kcount">${seznam.length} ${seznam.length === 1 ? "událost" : seznam.length >= 2 && seznam.length <= 4 ? "události" : "událostí"}${seznam.length ? ` · byl na ${bylo} (${procento(bylo, seznam.length)} %)` : ""}</p>
        <div class="dz-klist">
            ${seznam.map(({ u, st }) => `
                <div class="dz-kitem is-${st.k}">
                    <i>${{ g: "✓", n: "✗", o: "✗", z: "?" }[st.k]}</i>
                    <span class="dz-kitem__d">${DNY[denTydne(u.zacatek)]} ${datum(u.zacatek)}</span>
                    <span class="dz-kitem__n">${esc(u.nazev)}<small>${esc(DRUHY[u.druh].nazev)}</small></span>
                    <span class="dz-kitem__s">${STAV_TEXT[st.k]}${st.k === "o" ? (admin ? ": " + esc(st.kom) : "") : ""}${pozde(u, h.id) ? ` <span class="dz-late">po 12</span>` : ""}</span>
                    <span class="dz-kitem__h">${historieHtml(u, h.id, admin)}</span>
                </div>`).join("") || `<p class="dz-empty">Nic neodpovídá filtru.</p>`}
        </div>
        ${admin ? "" : `<p class="dz-hint">Text omluv vidí jen přihlášený.</p>`}`;
}

/* ------------------------------------------------------ detail události ---
   Klik na sloupec v týdnu: všichni hráči a všechny změny jejich odpovědí,
   seřazeno podle času první odpovědi (kdo nejdřív, ten nahoře).
   ------------------------------------------------------------------- */

function otevriUdalost(id) {
    const u = data && data.udalosti.find(x => String(x.id) === String(id));
    if (!u) return;
    karta = { udalost: u.id };
    vykresliUdalost();
    el("dzKarta").classList.add("is-open");
}

function vykresliUdalost() {
    const u = data.udalosti.find(x => x.id === karta.udalost);
    if (!u) return;
    const admin = isAdmin();
    const hraci = data.hraci.filter(h => u.ucast[h.id]).map(h => ({ h, st: stav(u, h.id), z: hist(u, h.id) }))
        .sort((a, b) => (a.z[0] ? a.z[0][0] : "9") .localeCompare(b.z[0] ? b.z[0][0] : "9") || a.h.jmeno.localeCompare(b.h.jmeno, "cs"));
    const pocty = { g: 0, o: 0, n: 0, z: 0 };
    hraci.forEach(x => pocty[x.st.k] !== undefined && pocty[x.st.k]++);
    const pozdePocet = hraci.filter(x => pozde(u, x.h.id)).length;
    el("dzKartaObsah").innerHTML = `
        <div class="dz-karta__head">
            <div>
                <h3>${esc(u.nazev)}</h3>
                <p>${DNY[denTydne(u.zacatek)]} ${datumRok(u.zacatek)} ${cas(u.zacatek)} · ${esc(DRUHY[u.druh].nazev)}${u.zruseno ? " · <b>zrušeno</b>" : ""}</p>
            </div>
            <button type="button" class="btn btn--ghost btn--sm" data-close>Zavřít</button>
        </div>
        <div class="dz-kks">
            <div class="dz-kk is-main"><b>${pocty.g}</b><span>byli</span></div>
            <div class="dz-kk"><b>${pocty.o}</b><span>omluveni</span></div>
            <div class="dz-kk"><b>${pocty.n}</b><span>bez omluvy</span></div>
            <div class="dz-kk"><b>${pocty.z}</b><span>nezapsáno</span></div>
            ${jeTrenink(u) && maHistorii(u) ? `<div class="dz-kk"><b>${pozdePocet}</b><span>nepřihlášeno do 12:00</span></div>` : ""}
        </div>
        <h4 class="dz-karta__h">Odpovědi a jejich změny</h4>
        ${maHistorii(u) ? "" : `<p class="dz-hint">Časy odpovědí se ještě nestáhly – doplní je příští synchronizace.</p>`}
        <div class="dz-klist">
            ${hraci.map(({ h, st }) => `
                <div class="dz-kitem is-${st.k === "x" ? "z" : st.k}">
                    <i>${{ g: "✓", n: "✗", o: "✗", z: "?", x: "" }[st.k]}</i>
                    <span class="dz-kitem__d"><span class="dz-link" data-hrac="${esc(h.id)}">${esc(h.jmeno)}</span></span>
                    <span class="dz-kitem__s">${STAV_TEXT[st.k] || ""}${st.k === "o" ? (admin ? ": " + esc(st.kom) : "") : ""}${pozde(u, h.id) ? ` <span class="dz-late">po 12</span>` : ""}</span>
                    <span class="dz-kitem__h">${historieHtml(u, h.id, admin)}</span>
                </div>`).join("")}
        </div>
        <p class="dz-hint">V závorce je, kdo odpověď zadal za hráče (jinak odpověděl sám).${admin ? "" : " Text omluv vidí jen přihlášený."}</p>`;
}

el("dzKarta").addEventListener("click", (e) => {
    if (e.target.closest("[data-close]")) { el("dzKarta").classList.remove("is-open"); karta = null; return; }
    const hr = e.target.closest("[data-hrac]");
    if (hr && karta && karta.udalost) { otevriKartu(hr.dataset.hrac); return; }
    if (!karta) return;
    const b = e.target.closest("[data-druh],[data-stav],[data-rychle]");
    if (!b) return;
    if (b.dataset.rychle === "dorost") karta.druhy = new Set(DRUHY_DOROST);
    else if (b.dataset.rychle === "vse") karta.druhy = new Set(FILTR_DRUHY.map(x => x[0]));
    else if (b.dataset.druh) { const k = b.dataset.druh; karta.druhy.has(k) ? karta.druhy.delete(k) : karta.druhy.add(k); }
    else if (b.dataset.stav) { const k = b.dataset.stav; karta.stavy.has(k) ? karta.stavy.delete(k) : karta.stavy.add(k); }
    vykresliKartu();
});
el("dzKarta").addEventListener("change", (e) => {
    if (e.target.id === "dzKartaMesic") { karta.mesic = e.target.value; vykresliKartu(); }
});

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
    if (karta && el("dzKarta").classList.contains("is-open")) karta.udalost ? vykresliUdalost() : vykresliKartu();
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
    const ev = e.target.closest("[data-udalost]");
    if (ev) { otevriUdalost(ev.dataset.udalost); return; }
    const r = e.target.closest("[data-hrac]");
    if (r) otevriKartu(r.dataset.hrac);
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
    onSnapshot(docIn(DOCHAZKA_KOLEKCE, HISTORIE_DOKUMENT), (snap) => {
        try { historie = snap.exists() && snap.data().data ? JSON.parse(snap.data().data) : null; } catch { historie = null; }
        if (data) vykresli();
    }, onDbError);
});
