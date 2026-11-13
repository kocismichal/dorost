/* ==========================================================================
   FK AGRO VNOROVY – CESŤÁKY
   Přehled cestovného na venkovní zápasy áčka a dorostu.
   Zápasy a hřiště jsou ze zápisů fotbal.cz, km = jedna cesta z Vnorov po
   silnici (OpenStreetMap / OSRM, ke středu obce), zaokrouhleno.
   Počítá se: km × 2 (tam a zpět) × počet aut × sazba. Zápas busem se do
   aut nepočítá, jen se k němu dá zapsat cena busu.

   Nastavení (sazba, výchozí počet aut, poháry) a úpravy jednotlivých zápasů
   (bus, počet aut, km, cena busu) jsou v databázi v dokumentu meta/cestaky.
   Měnit je jde po přihlášení, uloží se samy.

   id zápasu se nesmí měnit – úpravy v databázi se k zápasu vážou přes něj.
   ========================================================================== */

import { docIn, whenReady, onDbError, setStatus, initAuth, isAdmin, AdminStore, esc, toast } from "./core.js?v=11";
import { onSnapshot, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

/* ------------------------------------------------------------- data --- */

export const OBDOBI = [
    { id: "podzim25", nazev: "Podzim 2025", kratce: "Podz. 25" },
    { id: "jaro26",   nazev: "Jaro 2026", kratce: "Jaro 26" },
    { id: "podzim26", nazev: "Podzim 2026", kratce: "Podz. 26" }
];
const TYMY = { A: "Áčko", D: "Dorost" };

/* bus: true = výchozí stav (áčko do Kyjova jezdí busem) */
export const ZAPASY = [
    // ÁČKO – 6. liga JmKFS (B)
    { id: "A-2025-08-17", tym: "A", obdobi: "podzim25", datum: "2025-08-17", souper: "TJ Slavoj Rohatec",          hriste: "Rohatec",            km: 17 },
    { id: "A-2025-08-31", tym: "A", obdobi: "podzim25", datum: "2025-08-31", souper: "MFK Vyškov",                 hriste: "Vyškov",             km: 71 },
    { id: "A-2025-09-13", tym: "A", obdobi: "podzim25", datum: "2025-09-13", souper: "SK Slatina",                 hriste: "Brno-Slatina (Tuřanka)", km: 91 },
    { id: "A-2025-09-28", tym: "A", obdobi: "podzim25", datum: "2025-09-28", souper: "TJ Slavoj Velké Pavlovice",  hriste: "Velké Pavlovice",    km: 58 },
    { id: "A-2025-10-11", tym: "A", obdobi: "podzim25", datum: "2025-10-11", souper: "FC Veselí n. Moravou",       hriste: "Veselí n. Moravou",  km: 4 },
    { id: "A-2025-10-25", tym: "A", obdobi: "podzim25", datum: "2025-10-25", souper: "FK Šardice",                 hriste: "Šardice",            km: 38 },
    { id: "A-2025-11-02", tym: "A", obdobi: "podzim25", datum: "2025-11-02", souper: "FC Kyjov 1919",              hriste: "Kyjov",              km: 26, bus: true },
    { id: "A-2026-03-29", tym: "A", obdobi: "jaro26",   datum: "2026-03-29", souper: "FK Milotice",                hriste: "Milotice",           km: 25 },
    { id: "A-2026-04-12", tym: "A", obdobi: "jaro26",   datum: "2026-04-12", souper: "TJ Sokol Hroznová Lhota",    hriste: "Hroznová Lhota",     km: 7 },
    { id: "A-2026-04-26", tym: "A", obdobi: "jaro26",   datum: "2026-04-26", souper: "FK Mutěnice",                hriste: "Mutěnice",           km: 30 },
    { id: "A-2026-05-10", tym: "A", obdobi: "jaro26",   datum: "2026-05-10", souper: "FK Baník Dubňany",           hriste: "Dubňany",            km: 28 },
    { id: "A-2026-05-23", tym: "A", obdobi: "jaro26",   datum: "2026-05-23", souper: "FK Ořechov",                 hriste: "Ořechov",            km: 95 },
    { id: "A-2026-06-06", tym: "A", obdobi: "jaro26",   datum: "2026-06-06", souper: "SK Vojkovice",               hriste: "Vojkovice",          km: 84 },
    { id: "A-2026-08-22", tym: "A", obdobi: "podzim26", datum: "2026-08-22", souper: "FK Baník Dubňany",           hriste: "Dubňany",            km: 28 },
    { id: "A-2026-09-05", tym: "A", obdobi: "podzim26", datum: "2026-09-05", souper: "FK Židlochovice",            hriste: "Židlochovice",       km: 83 },
    { id: "A-2026-09-20", tym: "A", obdobi: "podzim26", datum: "2026-09-20", souper: "FC Kyjov 1919",              hriste: "Kyjov",              km: 26, bus: true },
    { id: "A-2026-10-03", tym: "A", obdobi: "podzim26", datum: "2026-10-03", souper: "FK Šardice",                 hriste: "Šardice",            km: 38 },
    { id: "A-2026-10-24", tym: "A", obdobi: "podzim26", datum: "2026-10-24", souper: "TJ Sokol Hroznová Lhota",    hriste: "Hroznová Lhota",     km: 7 },
    { id: "A-2026-10-31", tym: "A", obdobi: "podzim26", datum: "2026-10-31", souper: "SK Vojkovice",               hriste: "Vojkovice",          km: 84 },
    // ÁČKO – krajský pohár (červenec, počítá se k podzimu)
    { id: "A-2025-07-30-pohar", tym: "A", obdobi: "podzim25", datum: "2025-07-30", souper: "FK Šardice (pohár)",          hriste: "Šardice",            km: 38, pohar: true },
    { id: "A-2026-07-26-pohar", tym: "A", obdobi: "podzim26", datum: "2026-07-26", souper: "TJ Velká nad Veličkou (pohár)", hriste: "Velká nad Veličkou", km: 19, pohar: true },
    // DOROST – 5. liga st. dorostu JmKFS (C)
    { id: "D-2025-08-09", tym: "D", obdobi: "podzim25", datum: "2025-08-09", souper: "TJ Slavoj Rohatec",          hriste: "Rohatec",            km: 17 },
    { id: "D-2025-08-23", tym: "D", obdobi: "podzim25", datum: "2025-08-23", souper: "Prušánky/Dolní Bojanovice",  hriste: "Prušánky",           km: 36 },
    { id: "D-2025-09-06", tym: "D", obdobi: "podzim25", datum: "2025-09-06", souper: "TJ Sokol Charvátská Nová Ves", hriste: "Charvátská Nová Ves", km: 49 },
    { id: "D-2025-09-21", tym: "D", obdobi: "podzim25", datum: "2025-09-21", souper: "TJ Slovan Bzenec",           hriste: "Vracov",             km: 18 },
    { id: "D-2025-10-04", tym: "D", obdobi: "podzim25", datum: "2025-10-04", souper: "TJ Sokol Brumovice",         hriste: "Brumovice",          km: 45 },
    { id: "D-2025-10-18", tym: "D", obdobi: "podzim25", datum: "2025-10-18", souper: "FKM Podluží",                hriste: "Tvrdonice",          km: 40 },
    { id: "D-2026-03-22", tym: "D", obdobi: "jaro26",   datum: "2026-03-22", souper: "Hroznová Lhota/Lipov",       hriste: "Hroznová Lhota",     km: 7 },
    { id: "D-2026-04-04", tym: "D", obdobi: "jaro26",   datum: "2026-04-04", souper: "Dubňany/Mutěnice",           hriste: "Mutěnice",           km: 30 },
    { id: "D-2026-04-19", tym: "D", obdobi: "jaro26",   datum: "2026-04-19", souper: "MSK Břeclav B",              hriste: "Břeclav",            km: 46 },
    { id: "D-2026-05-02", tym: "D", obdobi: "jaro26",   datum: "2026-05-02", souper: "TJ Sokol Lanžhot",           hriste: "Lanžhot",            km: 44 },
    { id: "D-2026-05-16", tym: "D", obdobi: "jaro26",   datum: "2026-05-16", souper: "Velké Pavlovice/Podivín",    hriste: "Velké Pavlovice",    km: 58 },
    { id: "D-2026-05-30", tym: "D", obdobi: "jaro26",   datum: "2026-05-30", souper: "TJ Velká nad Veličkou",      hriste: "Velká nad Veličkou", km: 19 },
    { id: "D-2026-06-13", tym: "D", obdobi: "jaro26",   datum: "2026-06-13", souper: "FC Kyjov 1919",              hriste: "Kyjov",              km: 26 },
    { id: "D-2026-08-15", tym: "D", obdobi: "podzim26", datum: "2026-08-15", souper: "SK Podlužan Prušánky",       hriste: "Prušánky",           km: 36 },
    { id: "D-2026-08-29", tym: "D", obdobi: "podzim26", datum: "2026-08-29", souper: "FK Baník Ratíškovice A",     hriste: "Ratíškovice",        km: 20 },
    { id: "D-2026-09-13", tym: "D", obdobi: "podzim26", datum: "2026-09-13", souper: "Hroznová Lhota/Lipov",       hriste: "Hroznová Lhota",     km: 7 },
    { id: "D-2026-09-26", tym: "D", obdobi: "podzim26", datum: "2026-09-26", souper: "FC Kyjov 1919",              hriste: "Kyjov",              km: 26 },
    { id: "D-2026-10-11", tym: "D", obdobi: "podzim26", datum: "2026-10-11", souper: "Dubňany/Mutěnice",           hriste: "Mutěnice",           km: 30 },
    { id: "D-2026-10-17", tym: "D", obdobi: "podzim26", datum: "2026-10-17", souper: "FK Hodonín B",               hriste: "Hodonín",            km: 24 }
];

const VYCHOZI = { sazba: 5, auta: 4, pohary: false };

/* ------------------------------------------------------------- stav --- */

let nast = { ...VYCHOZI };   // sazba, auta, pohary
let upravy = {};             // id zápasu → { bus, auta, km, busKc }
let meta = {};               // kdo a kdy naposled upravil
let filtr = "vse";           // vse | A | D
let nacteno = false;
let ukladaciTimer = null;

const el = (id) => document.getElementById(id);
const kc = (n) => Math.round(n).toLocaleString("cs-CZ") + " Kč";
const cislo = (n) => Math.round(n).toLocaleString("cs-CZ");
const den = (iso) => { const [y, m, d] = iso.split("-"); return `${+d}. ${+m}. ${y}`; };

/** Výsledné hodnoty zápasu po úpravách. */
function zapas(z) {
    const u = upravy[z.id] || {};
    const bus = u.bus ?? !!z.bus;
    const auta = u.auta ?? nast.auta;
    const km = u.km ?? z.km;
    const busKc = u.busKc ?? 0;
    const autaKm = bus ? 0 : km * 2 * auta;
    const castka = bus ? busKc : autaKm * nast.sazba;
    return { ...z, bus, auta, km, busKc, autaKm, castka, upraveno: !!upravy[z.id] };
}

function vybrane() {
    return ZAPASY
        .filter(z => nast.pohary || !z.pohar)
        .filter(z => filtr === "vse" || z.tym === filtr)
        .map(zapas);
}

/* ---------------------------------------------------------- vykreslení --- */

function vykresli() {
    if (!nacteno) return;
    const admin = isAdmin();
    el("cSazba").value = nast.sazba;
    el("cAuta").value = nast.auta;
    el("cPohary").checked = nast.pohary;
    ["cSazba", "cAuta", "cPohary"].forEach(id => { el(id).disabled = !admin; });
    el("cZamek").hidden = admin;

    const vse = ZAPASY.filter(z => nast.pohary || !z.pohar).map(zapas);
    const suma = (arr) => arr.reduce((s, z) => s + z.castka, 0);

    /* souhrn: řádky týmy, sloupce období */
    const tymy = filtr === "vse" ? ["A", "D"] : [filtr];
    let h = `<table class="ptable c-souhrn"><thead><tr><th>Kč</th>${OBDOBI.map(o => `<th class="dz-num"><span class="c-pc">${o.nazev}</span><span class="c-mob">${o.kratce}</span></th>`).join("")}<th class="dz-num">Celkem</th></tr></thead><tbody>`;
    for (const t of tymy) {
        const zt = vse.filter(z => z.tym === t);
        h += `<tr><td><b>${TYMY[t]}</b></td>${OBDOBI.map(o => `<td class="dz-num">${cislo(suma(zt.filter(z => z.obdobi === o.id)))}</td>`).join("")}<td class="dz-num"><b>${cislo(suma(zt))}</b></td></tr>`;
    }
    if (tymy.length > 1) {
        h += `<tr class="c-celkem"><td>Celkem</td>${OBDOBI.map(o => `<td class="dz-num">${cislo(suma(vse.filter(z => z.obdobi === o.id)))}</td>`).join("")}<td class="dz-num">${cislo(suma(vse))}</td></tr>`;
    }
    h += `</tbody></table>`;
    el("cSouhrn").innerHTML = h;

    const zv = vybrane();
    el("cKpis").innerHTML = `
        <div class="dz-kpi"><b>${kc(suma(zv))}</b><span>celkem</span></div>
        <div class="dz-kpi"><b>${zv.length}</b><span>zápasů venku</span></div>
        <div class="dz-kpi"><b>${cislo(zv.reduce((s, z) => s + z.autaKm, 0))}</b><span>km všemi auty</span></div>
        <div class="dz-kpi"><b>${zv.filter(z => z.bus).length}</b><span>busem</span></div>`;

    /* zápasy po obdobích */
    let out = "";
    for (const o of OBDOBI) {
        const zo = zv.filter(z => z.obdobi === o.id).sort((a, b) => a.tym.localeCompare(b.tym) || a.datum.localeCompare(b.datum));
        if (!zo.length) continue;
        out += `<h3 class="c-obdobi">${o.nazev} <span>${kc(suma(zo))}</span></h3>
        <div class="table-card"><div class="archive__scroll"><table class="ptable c-tab"><thead><tr>
            <th class="c-dat">Datum</th><th>Tým</th><th><span class="c-pc">Soupeř · hřiště</span><span class="c-mob">Soupeř</span></th><th class="dz-num">km</th><th class="c-mid">Bus</th><th class="c-mid">Aut</th><th class="dz-num">Kč</th>
        </tr></thead><tbody>`;
        for (const z of zo) {
            const dis = admin ? "" : "disabled";
            out += `<tr class="${z.bus ? "c-bus" : ""}" data-id="${esc(z.id)}">
                <td class="c-dat">${den(z.datum)}</td>
                <td><span class="c-tym c-tym--${z.tym}">${z.tym === "A" ? "A" : "Dor"}</span></td>
                <td><b>${esc(z.souper)}</b><br><small><span class="c-dat-m"><span class="c-tym c-tym--${z.tym}">${z.tym === "A" ? "A" : "Dor"}</span> ${den(z.datum)} · </span>${esc(z.hriste)}${z.upraveno ? " · upraveno" : ""}</small><span class="c-kc-m">${kc(z.castka)}${z.bus ? " · bus" : ""}</span></td>
                <td class="dz-num"><input class="c-in c-in--km" type="number" min="0" step="1" data-f="km" value="${z.km}" ${dis}></td>
                <td class="c-mid"><input type="checkbox" data-f="bus" ${z.bus ? "checked" : ""} ${dis} aria-label="busem"></td>
                <td class="c-mid">${z.bus
                    ? `<input class="c-in c-in--kc" type="number" min="0" step="100" data-f="busKc" value="${z.busKc}" ${dis} title="cena busu v Kč" placeholder="Kč bus">`
                    : `<span class="c-step"><button type="button" data-krok="-1" ${dis}>−</button><b>${z.auta}</b><button type="button" data-krok="1" ${dis}>+</button></span>`}</td>
                <td class="dz-num"><b>${kc(z.castka)}</b>${z.bus ? "<br><small>bus</small>" : `<br><small>${cislo(z.autaKm)} km</small>`}</td>
            </tr>`;
        }
        out += `</tbody></table></div></div>`;
    }
    el("cZapasy").innerHTML = out || `<div class="dz-empty">Žádné zápasy.</div>`;

    el("cMeta").textContent = meta.upravil
        ? `Naposled upravil(a) ${meta.upravil}${meta.kdy ? " " + meta.kdy.toDate().toLocaleString("cs-CZ", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" }) : ""}.`
        : "";
}

/* ------------------------------------------------------------- ukládání --- */

function uloz() {
    clearTimeout(ukladaciTimer);
    ukladaciTimer = setTimeout(async () => {
        try {
            await setDoc(docIn("meta", "cestaky"), {
                sazba: nast.sazba, auta: nast.auta, pohary: nast.pohary,
                zapasy: upravy, upravil: AdminStore.name || "", kdy: serverTimestamp()
            });
            toast("Uloženo");
        } catch (err) {
            onDbError(err);
            toast("Nepodařilo se uložit");
        }
    }, 500);
}

function zmenZapas(id, f, hodnota) {
    const z = ZAPASY.find(x => x.id === id);
    const u = { ...(upravy[id] || {}) };
    u[f] = hodnota;
    /* co se rovná výchozímu stavu, neukládej */
    if (u.bus === !!z.bus) delete u.bus;
    if (u.auta === nast.auta) delete u.auta;
    if (u.km === z.km) delete u.km;
    if (!u.busKc) delete u.busKc;
    if (Object.keys(u).length) upravy[id] = u; else delete upravy[id];
    vykresli();
    uloz();
}

/* --------------------------------------------------------------- ovládání --- */

function napoj() {
    el("cFiltr").addEventListener("click", (e) => {
        const b = e.target.closest("button[data-f]");
        if (!b) return;
        filtr = b.dataset.f;
        el("cFiltr").querySelectorAll("button").forEach(x => x.classList.toggle("is-on", x === b));
        vykresli();
    });

    el("cSazba").addEventListener("change", () => {
        const v = parseFloat(String(el("cSazba").value).replace(",", "."));
        if (!(v >= 0)) { vykresli(); return; }
        nast.sazba = v; vykresli(); uloz();
    });
    el("cAuta").addEventListener("change", () => {
        const v = parseInt(el("cAuta").value, 10);
        if (!(v >= 0)) { vykresli(); return; }
        /* zápasy, které měly ručně právě nový výchozí počet, už úpravu nepotřebují */
        nast.auta = v;
        for (const [id, u] of Object.entries(upravy)) {
            if (u.auta === v) { delete u.auta; if (!Object.keys(u).length) delete upravy[id]; }
        }
        vykresli(); uloz();
    });
    el("cPohary").addEventListener("change", () => { nast.pohary = el("cPohary").checked; vykresli(); uloz(); });

    el("cZapasy").addEventListener("click", (e) => {
        const b = e.target.closest("button[data-krok]");
        if (!b || !isAdmin()) return;
        const id = b.closest("tr").dataset.id;
        const z = zapas(ZAPASY.find(x => x.id === id));
        zmenZapas(id, "auta", Math.max(0, z.auta + Number(b.dataset.krok)));
    });
    el("cZapasy").addEventListener("change", (e) => {
        const i = e.target.closest("input[data-f]");
        if (!i || !isAdmin()) return;
        const id = i.closest("tr").dataset.id;
        const f = i.dataset.f;
        if (f === "bus") zmenZapas(id, "bus", i.checked);
        else {
            const v = Math.max(0, Math.round(Number(i.value) || 0));
            zmenZapas(id, f, v);
        }
    });

    el("cReset").addEventListener("click", () => {
        if (!isAdmin()) return;
        const b = el("cReset");
        if (!b.dataset.jiste) {   // první klik jen zeptá (bez dialogu prohlížeče)
            b.dataset.jiste = "1"; b.textContent = "Opravdu? Klikni znovu";
            setTimeout(() => { delete b.dataset.jiste; b.textContent = "Vrátit vše na výchozí"; }, 4000);
            return;
        }
        delete b.dataset.jiste; b.textContent = "Vrátit vše na výchozí";
        upravy = {}; nast = { ...VYCHOZI };
        vykresli(); uloz();
    });
}

/* ---------------------------------------------------------------- start --- */

napoj();
initAuth(vykresli);

whenReady(() => {
    onSnapshot(docIn("meta", "cestaky"), (snap) => {
        setStatus("online");
        const d = snap.exists() ? snap.data() : {};
        nast = {
            sazba: typeof d.sazba === "number" ? d.sazba : VYCHOZI.sazba,
            auta: typeof d.auta === "number" ? d.auta : VYCHOZI.auta,
            pohary: typeof d.pohary === "boolean" ? d.pohary : VYCHOZI.pohary
        };
        upravy = d.zapasy && typeof d.zapasy === "object" ? d.zapasy : {};
        meta = { upravil: d.upravil, kdy: d.kdy && d.kdy.toDate ? d.kdy : null };
        nacteno = true;
        vykresli();
    }, onDbError);
});
