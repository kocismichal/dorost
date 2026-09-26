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
let pohled = "sezona";    // sezona | tydny
let vse = false;          // v týdnech ukázat i áčko, béčko a přáteláky
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

/* ---------------------------------------------------------- statistiky --- */

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
    const zapasy = data.udalosti.filter(u => u.druh === "Z_D" && !u.zruseno).length;
    const k = (cislo, popis) => `<div class="dz-kpi"><b>${cislo}</b><span>${popis}</span></div>`;
    el("dzKpis").innerHTML =
        k(tr.length, "tréninků dorostu") +
        k(prumerHracu.toLocaleString("cs-CZ", { maximumFractionDigits: 1 }), "hráčů v průměru na tréninku") +
        k(procento(byl, pozvan) + " %", "celková docházka") +
        k(zapasy, "zápasů dorostu");
}

function bunkaDne(s, druh) {
    const [a, b] = s.dny[druh];
    return `<td class="dz-num">${b ? `${a}<small>/${b}</small>` : "–"}</td>`;
}

function vykresliSezonu() {
    const stat = statistiky().sort((a, b) => b.pct - a.pct || b.byl - a.byl || prijmeni(a.h.jmeno).localeCompare(prijmeni(b.h.jmeno), "cs"));
    vykresliKpi(stat);
    const admin = isAdmin();

    const radky = stat.map((s, i) => {
        const tridaPct = s.pct >= 70 ? "hi" : s.pct >= 45 ? "mid" : "lo";
        const stitky = [
            s.pozdejsi ? `<span class="tag">od ${datum(s.pozdejsi)}</span>` : "",
            s.h.dlouhodobaOmluva ? `<span class="tag tag--warn" title="${esc(s.h.dlouhodobaOmluva.pozn || "")}">dlouhodobě omluven</span>` : ""
        ].join("");
        const otevreny = otevreni.has(s.h.id);
        let detail = "";
        if (otevreny) {
            const chybel = data.udalosti.filter(jeTrenink).map(u => ({ u, st: stav(u, s.h.id) })).filter(x => x.st.k !== "g" && x.st.k !== "x").reverse();
            detail = `<tr class="dz-detail"><td></td><td colspan="13">${chybel.length ? `<ul class="dz-miss">${chybel.map(({ u, st }) => `
                <li class="is-${st.k}"><b>${DNY[denTydne(u.zacatek)]} ${datum(u.zacatek)}</b> ${esc(u.nazev)}
                    <span>${st.k === "o" ? (admin ? "omluva: " + esc(st.kom) : "omluven") : st.k === "n" ? "bez omluvy" : "nezapsáno"}</span></li>`).join("")}</ul>`
                : "<p>Na žádném tréninku nechyběl. 👏</p>"}
                ${admin ? "" : `<p class="dz-hint">Text omluv vidí jen přihlášený.</p>`}</td></tr>`;
        }
        return `<tr class="dz-row${otevreny ? " is-open" : ""}" data-hrac="${esc(s.h.id)}">
            <td class="ptable__rank">${i + 1}.</td>
            <td class="dz-name"><span class="dz-caret">▸</span>${esc(s.h.jmeno)}${stitky}</td>
            <td class="dz-pct"><div class="dz-meter"><i class="${tridaPct}" style="width:${s.pct}%"></i></div><b>${s.pct} %</b></td>
            <td class="dz-num"><b>${s.byl}</b><small>/${s.pozvan}</small></td>
            ${bunkaDne(s, "T_PO")}${bunkaDne(s, "T_UT")}${bunkaDne(s, "T_CT")}
            <td class="dz-num dz-o">${s.omluven || ""}</td>
            <td class="dz-num dz-n">${s.bezOmluvy || ""}</td>
            <td class="dz-num dz-z">${s.nezapsano || ""}</td>
            <td class="dz-num">${s.sA || ""}</td>
            <td class="dz-num">${s.Z_D || ""}</td><td class="dz-num">${s.Z_B || ""}</td><td class="dz-num">${s.Z_A || ""}</td>
        </tr>${detail}`;
    }).join("");

    el("dzView").innerHTML = `
        <div class="table-card"><div class="archive__scroll">
            <table class="ptable dz-table">
                <thead>
                    <tr class="dz-grp"><th colspan="4"></th><th colspan="3">Tréninky podle dne</th><th colspan="3">Chyběl na tréninku</th><th></th><th colspan="3">Zápasy</th></tr>
                    <tr><th>#</th><th>Hráč</th><th>Docházka</th><th class="dz-num">Byl</th>
                        <th class="dz-num">Po</th><th class="dz-num">Út</th><th class="dz-num">Čt</th>
                        <th class="dz-num">Omluven</th><th class="dz-num">Bez omluvy</th><th class="dz-num" title="V Týmuj bez odpovědi nebo „možná“">Nezaps.</th>
                        <th class="dz-num" title="Tréninky s áčkem">S áčkem</th>
                        <th class="dz-num">D</th><th class="dz-num">B</th><th class="dz-num">A</th></tr>
                </thead>
                <tbody>${radky}</tbody>
            </table>
        </div></div>`;
    el("dzNote").textContent = "Klikni na hráče – rozbalí se tréninky, na kterých chyběl, i s omluvou. Docházka = tréninky dorostu (Po, Út, Čt a jiné), tréninky s áčkem a zápasy se počítají zvlášť.";
}

function vykresliTydny() {
    vykresliKpi(statistiky());
    const admin = isAdmin();
    const vybrane = data.udalosti.filter(u => vse ? true : (DRUHY[u.druh].trenink || u.druh === "Z_D"));
    const tydny = new Map();
    for (const u of vybrane) {
        const k = pondeli(u.zacatek);
        if (!tydny.has(k)) tydny.set(k, []);
        tydny.get(k).push(u);
    }
    const klice = [...tydny.keys()].sort().reverse();
    const hraci = [...data.hraci].sort((a, b) => prijmeni(a.jmeno).localeCompare(prijmeni(b.jmeno), "cs"));

    el("dzView").innerHTML = klice.map(k => {
        const ud = tydny.get(k).sort((a, b) => a.zacatek.localeCompare(b.zacatek));
        const tr = ud.filter(jeTrenink);
        const vTymu = hraci.filter(h => ud.some(u => u.ucast[h.id]));
        const prumer = tr.length ? tr.reduce((a, u) => a + Object.values(u.ucast).filter(z => z[0] === "G").length, 0) / tr.length : 0;
        const konec = plusDni(k, 6);

        const hlavicky = ud.map(u => {
            const pritomno = Object.values(u.ucast).filter(z => z[0] === "G").length;
            const d = DRUHY[u.druh];
            return `<th class="dz-ev dz-ev--${u.druh}${u.zruseno ? " is-off" : ""}${d.trenink ? "" : " is-extra"}" title="${esc(u.nazev)} · ${cas(u.zacatek)}">
                <span class="dz-ev__d">${DNY[denTydne(u.zacatek)]} ${datum(u.zacatek)}</span>
                <span class="dz-ev__n">${esc(d.kratce)}${u.druh.startsWith("Z_") ? " · " + esc(u.nazev.replace(/^[ABD]\s*-\s*/, "")) : ""}</span>
                <span class="dz-ev__c">${u.zruseno ? "zrušeno" : pritomno + " přít."}</span></th>`;
        }).join("");

        const radky = vTymu.map(h => {
            let a = 0, b = 0;
            const bunky = ud.map(u => {
                const st = stav(u, h.id);
                if (jeTrenink(u) && st.k !== "x") { b++; if (st.k === "g") a++; }
                if (u.zruseno) return `<td class="dz-c is-off"></td>`;
                const ikona = { g: "✓", n: "✗", o: "✗", z: "?", x: "" }[st.k];
                const omluva = st.k === "o"
                    ? `<span class="dz-om" title="${admin ? esc(st.kom) : "omluven"}">${admin ? esc(st.kom.length > 28 ? st.kom.slice(0, 27) + "…" : st.kom) : "omluven"}</span>` : "";
                return `<td class="dz-c is-${st.k}"><i>${ikona}</i>${omluva}</td>`;
            }).join("");
            return `<tr><td class="dz-name">${esc(h.jmeno)}</td>${bunky}<td class="dz-num dz-week">${b ? `<b>${a}</b><small>/${b}</small>` : "–"}</td></tr>`;
        }).join("");

        return `<div class="dz-weekcard">
            <div class="dz-weekcard__head">
                <h3>${datum(k)} – ${datumRok(konec)}</h3>
                <span>${tr.length ? `${tr.length} ${tr.length === 1 ? "trénink" : tr.length < 5 ? "tréninky" : "tréninků"} · průměrně ${prumer.toLocaleString("cs-CZ", { maximumFractionDigits: 1 })} hráčů` : "bez tréninku dorostu"}</span>
            </div>
            <div class="archive__scroll">
                <table class="ptable dz-wtable">
                    <thead><tr><th>Hráč</th>${hlavicky}<th class="dz-num">Tréninky</th></tr></thead>
                    <tbody>${radky}</tbody>
                </table>
            </div>
        </div>`;
    }).join("") || `<p class="dz-empty">Zatím žádné události.</p>`;
    el("dzNote").innerHTML = `✓ byl · ✗ chyběl · <span class="dz-om">omluven</span> chyběl s omluvou · ? nezapsáno. Prázdné políčko = hráč tehdy ještě nebyl v týmu.${admin ? "" : " Text omluv vidí jen přihlášený."}`;
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
    pohled === "sezona" ? vykresliSezonu() : vykresliTydny();
}

/* ------------------------------------------------------------- ovládání --- */

document.querySelectorAll(".dz-seg button").forEach(b => b.addEventListener("click", () => {
    pohled = b.dataset.view;
    document.querySelectorAll(".dz-seg button").forEach(x => x.classList.toggle("is-on", x === b));
    vykresli();
}));
el("dzAll").addEventListener("change", (e) => { vse = e.target.checked; vykresli(); });
el("dzView").addEventListener("click", (e) => {
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
