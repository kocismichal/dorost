/* ==========================================================================
   FK AGRO VNOROVY – PRO HRÁČE
   Statická stránka s přehledem regenerace, pomůcek a jídla. Z databáze nic
   nečte – jádro se načítá jen kvůli hlavičce (stav připojení, přihlášení).
   Navíc přehrávače videí (seznam cviků vpravo, video vlevo).
   ========================================================================== */

import { whenReady, setStatus, initAuth, esc } from "./core.js?v=9";

initAuth();
whenReady(() => setStatus("online"));

document.getElementById("printBtn").addEventListener("click", () => window.print());

/* ------------------------------------------------------------ videa ---
   Na stránce stačí <div class="ph-pl" data-videa="klic"></div> a sada
   VIDEA[klic]. Cvik může mít víc úrovní – každá má vlastní video,
   dávkování a popis.
   Pozor: některé kanály (např. oficiální FIFA) vkládání na cizí weby
   blokují – nové video je potřeba vyzkoušet na živé stránce.
   ------------------------------------------------------------------- */

/* FIFA 11+: souhrny částí od University of Iowa Health Care, jednotlivé
   cviky od Ontario Soccer (playlist PLWrJzdUX9i5ywhgsDGJcrLiZYoltVmn_h). */
const FIFA = [
    { cast: "souhrn", cislo: "1", nazev: "Část 1 – běh a zahřátí", uroven: [
        { yt: "pK5jcQalrSs", davka: "8 minut", popis: "Souhrn celé první části. Šest běžeckých cviků mezi kužely (6 párů kuželů, dráha asi 20 m), každý 2× tam a zpět. Pomalé tempo, aktivní protažení a kontakt se spoluhráčem." } ] },
    { cast: "souhrn", cislo: "2", nazev: "Část 2 – síla, rovnováha, skoky", uroven: [
        { yt: "Ov9PHeUdg5Q", davka: "10 minut", popis: "Celá druhá část cvik po cviku: plank, boční plank, zadní stehna, stoj na jedné noze, dřepy a skoky. Každý cvik má tři úrovně – začíná se úrovní 1 a výš se jde, až když ji zvládáš čistě." } ] },
    { cast: "souhrn", cislo: "3", nazev: "Část 3 – běh", uroven: [
        { yt: "dzgvdl9FlCk", davka: "2 minuty", popis: "Souhrn třetí části: rychlý běh přes hřiště, běh s odrazy a změny směru." } ] },

    { cast: "c1", cislo: "1", nazev: "Běh rovně", uroven: [
        { yt: "_jKFgzb8SS0", davka: "2 série", popis: "Lehký běh k poslednímu kuželu a zpět. Tělo vzpřímené, kyčel, koleno a chodidlo v jedné přímce – koleno nepadá dovnitř." } ] },
    { cast: "c1", cislo: "2", nazev: "Běh – kyčel ven", uroven: [
        { yt: "8R3ILRa0PZw", davka: "2 série", popis: "U každého kužele se zastav, zvedni koleno vpřed a vytoč ho ven („otevírání brány“). Střídej nohy." } ] },
    { cast: "c1", cislo: "3", nazev: "Běh – kyčel dovnitř", uroven: [
        { yt: "oWs0QQ8uzYA", davka: "2 série", popis: "U každého kužele zvedni koleno do strany a vytoč ho dovnitř před tělo („zavírání brány“). Střídej nohy." } ] },
    { cast: "c1", cislo: "4", nazev: "Běh – kroužení kolem spoluhráče", uroven: [
        { yt: "UAKcm1ev5hk", davka: "2 série", popis: "Ve dvojici doběhnete k sobě, úkroky jeden kolem druhého a zpět. Pokrčená kolena, těžiště nízko." } ] },
    { cast: "c1", cislo: "5", nazev: "Běh – výskok s kontaktem ramenem", uroven: [
        { yt: "pmOQSVoKO0c", davka: "2 série", popis: "Ve dvojici úkroky k sobě, výskok a kontakt ramenem ve vzduchu. Doskok na obě nohy, měkce, kolena pokrčená a nepadají dovnitř." } ] },
    { cast: "c1", cislo: "6", nazev: "Běh – rychle vpřed a vzad", uroven: [
        { yt: "uc-ZFmnQOsU", davka: "2 série", popis: "Rychle ke druhému kuželu, zpětným během k prvnímu, pak zase dva vpřed a jeden zpět. Malé rychlé kroky, kolena lehce pokrčená." } ] },

    { cast: "c2", cislo: "7", nazev: "Plank (vzpor na předloktích)", uroven: [
        { yt: "Xet49p8dHN0", davka: "3× 20–30 s", popis: "Úroveň 1 – výdrž. Lokty pod rameny, tělo v jedné přímce od hlavy k patám. Nepropadat v bedrech, nezvedat zadek." },
        { yt: "Ku1DNx61lwQ", davka: "3× 40 s", popis: "Úroveň 2 – střídání nohou. Z planku střídavě zvedej nohy asi na 2 vteřiny. Pánev se nekýve do stran." },
        { yt: "HetOV-PRdy0", davka: "3× 20–30 s na nohu", popis: "Úroveň 3 – jedna noha nahoře. Zvedni jednu nohu asi 10–15 cm a drž. Tělo zůstává rovné." } ] },
    { cast: "c2", cislo: "8", nazev: "Boční plank", uroven: [
        { yt: "PVsv8__2Gsg", davka: "3× 20–30 s na stranu", popis: "Úroveň 1 – výdrž. Loket pod ramenem, spodní koleno pokrčené na zemi, pánev nahoru, tělo v přímce." },
        { yt: "IWmvrDY0m9Q", davka: "3× 20–30 s na stranu", popis: "Úroveň 2 – zvedání pánve. Nohy natažené, pánev spouštěj k zemi a zase zvedej." },
        { yt: "Z09J2j_4JCg", davka: "3× 20–30 s na stranu", popis: "Úroveň 3 – s nohou nahoře. V bočním planku zvedni horní nohu a pomalu ji spouštěj a zvedej." } ] },
    { cast: "c2", cislo: "9", nazev: "Zadní stehna (nordický ohyb)", uroven: [
        { yt: "-rb-vEwoqfg", davka: "3–5 opakování", popis: "Klek, spoluhráč drží kotníky. Tělo rovné od kolen k hlavě, pomalu se nakláněj vpřed a brzdi zadními stehny co nejdéle, pak se zachyť rukama. Nejlepší cvik proti natržení zadního stehna. Úroveň 2 = 7–10 opakování, úroveň 3 = 12–15." } ] },
    { cast: "c2", cislo: "10", nazev: "Stoj na jedné noze", uroven: [
        { yt: "HHpcfBID_Hc", davka: "2× 30 s na nohu", popis: "Úroveň 1 – s míčem v rukou. Koleno lehce pokrčené a nad špičkou, váha na přední části chodidla. Míč můžeš obtáčet kolem pasu." },
        { yt: "AQtBnSeucCY", davka: "2× 30 s na nohu", popis: "Úroveň 2 – házení míče se spoluhráčem, oba na jedné noze. Břicho zpevněné, koleno nepadá dovnitř." },
        { yt: "qbIVRU85R00", davka: "2× 30 s na nohu", popis: "Úroveň 3 – testuj spoluhráče. Oba na jedné noze, střídavě se snažíte druhého lehce vychýlit z rovnováhy." } ] },
    { cast: "c2", cislo: "11", nazev: "Dřepy", uroven: [
        { yt: "ns7nOEhQd6Q", davka: "2× 30 s", popis: "Úroveň 1 – dřep s výponem. Ruce v bok, pomalý dřep (kyčle, kolena a kotníky ohnuté do 90°), nahoře výpon na špičky. Kolena nad špičkami." },
        { yt: "yxYnumb1rKk", davka: "2× přes hřiště (asi 10 na nohu)", popis: "Úroveň 2 – chůze ve výpadech. Pomalé výpady vpřed, přední koleno nad chodidlem, nepadá dovnitř, trup rovně." },
        { yt: "2-zyfIcPQPc", davka: "2× 10 na nohu", popis: "Úroveň 3 – dřep na jedné noze. Drž se spoluhráče, pomalu do dřepu co nejhlouběji zvládneš s kolenem nad špičkou." } ] },
    { cast: "c2", cislo: "12", nazev: "Skoky", uroven: [
        { yt: "GXwBsF_UbNg", davka: "2× 30 s", popis: "Úroveň 1 – výskoky nahoru. Z pokrčení výskok co nejvýš, doskok měkce na přední část chodidel, kolena pokrčená a nad špičkami." },
        { yt: "VZY1v2BkHNI", davka: "2× 30 s", popis: "Úroveň 2 – boční skoky. Na jedné noze skoky asi 1 m do strany na druhou nohu. Měkký doskok, koleno nepadá dovnitř." },
        { yt: "VokMNbduf0w", davka: "2× 30 s", popis: "Úroveň 3 – skoky do kříže. Snožmo skoky vpřed, vzad a do stran jako po kříži. Rychle, ale s kontrolou doskoku." } ] },

    { cast: "c3", cislo: "13", nazev: "Běh přes hřiště", uroven: [
        { yt: "77uITp1GBq4", davka: "2 série", popis: "Běh přes celé hřiště na 75–80 % maxima, zpátky lehce vyklusat." } ] },
    { cast: "c3", cislo: "14", nazev: "Běh s odrazy", uroven: [
        { yt: "gmQ5jsT97Rc", davka: "2 série", popis: "Dlouhé skokové kroky s vysokým zvednutím kolena a švihem opačné ruky. Doskok měkce na přední část chodidla." } ] },
    { cast: "c3", cislo: "15", nazev: "Běh se změnou směru", uroven: [
        { yt: "aj0MgislRto", davka: "2 série", popis: "4–5 kroků rovně, pak zapíchnout vnější nohu a prudce změnit směr. Koleno při změně směru nepadá dovnitř." } ] }
];

const GUMA = [
    { cislo: "1", nazev: "Monster walk", uroven: [
        { yt: "42cYOwpwOIc", davka: "2× 10 kroků na stranu", popis: "Miniband nad koleny (ve videu ukazují i jiné polohy gumy). Pokrčená kolena, záda rovně, úkroky do strany, guma stále napnutá." } ] },
    { cislo: "2", nazev: "Mušle (clamshell)", uroven: [
        { yt: "39vuP5xozsI", davka: "2× 12 na nohu", popis: "Leh na boku, kolena pokrčená, guma nad koleny. Paty u sebe, horní koleno otevírej nahoru, pánev se nepřeklápí dozadu." } ] },
    { cislo: "3", nazev: "Hýžďový most", uroven: [
        { yt: "6oYSPzZlwL0", davka: "2× 12", popis: "Leh na zádech, guma nad koleny. Zvedni pánev, nahoře vydrž 2 vteřiny a tlač kolena lehce od sebe." } ] },
    { cislo: "4", nazev: "Rozpažování (pull-apart)", uroven: [
        { yt: "bYsgk9SrJ48", davka: "2× 15", popis: "Guma v natažených rukou před hrudníkem. Roztáhni ji k hrudníku, lopatky k sobě, ramena dole – ne u uší." } ] },
    { cislo: "5", nazev: "Výpad s gumou", uroven: [
        { yt: "ffzwFJP-2Sw", davka: "2× 8 na nohu", popis: "Miniband nad koleny. Krok vpřed, koleno přední nohy míří nad špičku a nepadá dovnitř – guma ho táhne dovnitř a ty se jí bráníš." } ] }
];

const VALEC = [
    { cislo: "1", nazev: "Lýtka", uroven: [
        { yt: "nZZe9ai7Vvw", davka: "1 min na nohu", popis: "Sed, válec pod lýtkem, zvedni se na rukou. Pro větší tlak dej druhou nohu navrch, vytáčej špičku dovnitř a ven." } ] },
    { cislo: "2", nazev: "Zadní stehno", uroven: [
        { yt: "6NxiLQ5FpeI", davka: "1 min na nohu", popis: "Sed, válec pod stehnem, jeď od sedací kosti ke koleni. Koleno samotné vynech." } ] },
    { cislo: "3", nazev: "Přední stehno", uroven: [
        { yt: "cv57kA6rktc", davka: "1 min na nohu", popis: "Vzpor na předloktích, válec pod stehny. Od kyčle nad koleno, břicho zpevněné, nepropadat v bedrech." } ] },
    { cislo: "4", nazev: "Vnitřní stehno (třísla)", uroven: [
        { yt: "h1xQabdHdes", davka: "1 min na nohu", popis: "Na břiše, noha pokrčená do strany, válec pod vnitřní stranou stehna. U fotbalistů hodně důležité." } ] },
    { cislo: "5", nazev: "Hýždě", uroven: [
        { yt: "F3TJyU8ET7k", davka: "1 min na stranu", popis: "Sed na válci, kotník přes druhé koleno (čtyřka), nakloň se na stranu pokrčené nohy." } ] },
    { cislo: "6", nazev: "Horní záda", uroven: [
        { yt: "SQF-0s1CckA", davka: "1 min", popis: "Válec pod lopatkami, ruce za hlavou, pánev na zemi. Pomalu se zakláněj přes válec. Jen hrudní část – ne bedra." } ] }
];

const MICEK = [
    { cislo: "1", nazev: "Chodidlo", uroven: [
        { yt: "tu_qxzsfMRQ", davka: "2 min na nohu", popis: "Podélně od paty ke špičce, pak napříč, nakonec kroužky. Na citlivém místě 20–30 vteřin. Začni vsedě, vestoje je tlak větší." } ] },
    { cislo: "2", nazev: "Lýtko", uroven: [
        { yt: "CWi7yNrrtZE", davka: "1 min na nohu", popis: "Sed, míček pod lýtkem, druhá noha navrch. Pomalu nahoru a dolů, vytáčej špičku do stran." } ] },
    { cislo: "3", nazev: "Hýždě", uroven: [
        { yt: "PAv7bV0vq3g", davka: "1 min na stranu", popis: "Leh nebo sed, míček pod hýždí. Malé kroužky, na citlivém místě zastav a prodýchej." } ] },
    { cislo: "4", nazev: "Mezi lopatkami", uroven: [
        { yt: "ZGQTusIBjBM", davka: "1 min", popis: "Záda o zeď, míček mezi páteří a lopatkou (ne přímo na páteř). Mírně pokrčuj kolena a posouvej se." } ] }
];

const VIDEA = {
    fifa:  { cviky: FIFA, start: 3, casti: [
        { id: "souhrn", nazev: "Celá rozcvička – souhrny částí" },
        { id: "c1",     nazev: "Část 1 – běh a zahřátí (8 min)" },
        { id: "c2",     nazev: "Část 2 – síla, rovnováha, skoky (10 min)" },
        { id: "c3",     nazev: "Část 3 – běh (2 min)" } ] },
    guma:  { cviky: GUMA,  casti: [{ nazev: "Rozcvička s gumou – 5 minut" }] },
    valec: { cviky: VALEC, casti: [{ nazev: "Válec po tréninku – 8 až 10 minut" }] },
    micek: { cviky: MICEK, casti: [{ nazev: "Míček – 5 minut večer" }] }
};

function prehravac(box, { cviky, casti, start = 0 }) {
    box.innerHTML = `<div class="ph-pl__main"></div><div class="ph-pl__side"><div class="ph-pl__list"></div></div>`;
    const hrac = box.querySelector(".ph-pl__main");
    const seznam = box.querySelector(".ph-pl__list");
    let vybrany = start, uroven = 0;

    function vykresliSeznam() {
        seznam.innerHTML = casti.map(c => `
            <div class="ph-pl__group">${esc(c.nazev)}</div>
            ${cviky.map((v, i) => (c.id && v.cast !== c.id) ? "" : `
                <button type="button" class="ph-pl__item${i === vybrany ? " is-on" : ""}" data-i="${i}">
                    <span class="ph-pl__num">${esc(v.cislo)}</span>
                    <span class="ph-pl__name">${esc(v.nazev)}</span>
                    ${v.uroven.length > 1 ? `<span class="ph-pl__lvls">1–${v.uroven.length}</span>` : ""}
                </button>`).join("")}`).join("");
    }

    function vykresliHrac() {
        const v = cviky[vybrany];
        const u = v.uroven[uroven];
        hrac.innerHTML = `
            <div class="ph-pl__video">
                <iframe src="https://www.youtube-nocookie.com/embed/${u.yt}?rel=0" title="${esc(v.nazev)}" loading="lazy" allowfullscreen
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"></iframe>
            </div>
            <div class="ph-pl__info">
                <div class="ph-pl__head">
                    <h3><span>${esc(v.cislo)}</span> ${esc(v.nazev)}</h3>
                    <span class="ph-dose">${esc(u.davka)}</span>
                </div>
                ${v.uroven.length > 1 ? `<div class="ph-pl__levels">${v.uroven.map((_, k) =>
                    `<button type="button" class="ph-pl__lvl${k === uroven ? " is-on" : ""}" data-l="${k}">Úroveň ${k + 1}</button>`).join("")}</div>` : ""}
                <p>${esc(u.popis)}</p>
                <a class="ph-pl__yt" href="https://www.youtube.com/watch?v=${u.yt}" target="_blank" rel="noopener">Nejde přehrát? Otevřít na YouTube ↗</a>
            </div>`;
    }

    seznam.addEventListener("click", (e) => {
        const b = e.target.closest(".ph-pl__item");
        if (!b) return;
        vybrany = +b.dataset.i;
        uroven = 0;
        vykresliSeznam();
        vykresliHrac();
        if (window.matchMedia("(max-width: 900px)").matches) hrac.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    hrac.addEventListener("click", (e) => {
        const b = e.target.closest(".ph-pl__lvl");
        if (!b) return;
        uroven = +b.dataset.l;
        vykresliHrac();
    });
    vykresliSeznam();
    vykresliHrac();
}

document.querySelectorAll("[data-videa]").forEach(box => {
    const sada = VIDEA[box.dataset.videa];
    if (sada) prehravac(box, sada);
});
