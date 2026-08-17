/* ==========================================================================
   FK AGRO VNOROVY – PLAKÁTY
   Plakát A3 na šířku pro každé kolo podzimu. Prohlížení a tisk jsou veřejné,
   úpravy jen po přihlášení. Změny se ukládají do Firestore, takže je hned
   vidí všichni – nesedí v prohlížeči jednoho člověka.
   ========================================================================== */

import {
    col, docIn, whenReady, onDbError, setStatus,
    initAuth, isAdmin, updateAuthUI, esc, toast
} from "./core.js?v=9";
import { LOGA, SOUTEZE, TYMY, SEZONA } from "./plakat-data.js?v=9";

import {
    onSnapshot, setDoc, deleteDoc
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

const ZNAKY = "assets/plakat/znaky/";
const QR = "assets/plakat/qr/instagram.png";

/* ------------------------------------------------------------------ stav --- */

let koloIdx = 0;              // které kolo je zobrazené
let stav = null;              // rozpracovaný plakát tohoto kola
const ulozene = new Map();    // idKola -> data z databáze
let ulozTimer = null;

const idKola = (i) => "kolo-" + (i + 1);

/** Výchozí plakát podle rozlosování. */
function zVikendu(w) {
    return {
        datum: w.datum, mesic: w.mesic, nadpis: "PROGRAM VÍKENDU",
        doma: w.doma.map(z => ({
            tym: TYMY[z[0]] || z[0], soutez: SOUTEZE[z[0]] || "",
            souper: z[1], logo: z[2], den: z[3], cas: z[4]
        })),
        domaMladez: w.domaM.map(z => ({ kat: z[0], souper: z[1], logo: z[2], den: z[3], cas: z[4] })),
        venku: w.venku.map(z => ({ kat: z[0], souper: z[1], logo: z[2], cas: z[3] })),
        vyzva: "PŘIJĎTE PODPOŘIT NAŠE KLUKY!",
        vTydnu: (w.tyden || []).map(z => ({ kat: z[0], doma: !!z[1], souper: z[2], den: z[3], cas: z[4] })),
        paticka: { misto: "AGRO ARÉNA VNOROVY", podtitul: "Děkujeme všem našim fanouškům za podporu!" },
        nasZnak: "vnorovy.png"
    };
}

/** Uložená verze má přednost před rozlosováním. */
function nactiKolo(i) {
    koloIdx = Math.max(0, Math.min(SEZONA.length - 1, i));
    const z = ulozene.get(idKola(koloIdx));
    stav = z ? JSON.parse(JSON.stringify(z)) : zVikendu(SEZONA[koloIdx]);
    postavEditor();
    vykresli();
    oznacKolo();
}

/* -------------------------------------------------------------- databáze --- */

function uloz() {
    if (!isAdmin()) return;
    clearTimeout(ulozTimer);
    ulozTimer = setTimeout(async () => {
        try {
            await setDoc(docIn("posters", idKola(koloIdx)), JSON.parse(JSON.stringify(stav)));
            setStatus("online");
        } catch (err) {
            onDbError(err);
            toast("Uložení se nepovedlo – zkontroluj připojení.");
        }
    }, 700);
}

async function vratVychozi() {
    if (!isAdmin()) return;
    if (!confirm("Vrátit tohle kolo do podoby podle rozlosování? Uložené úpravy se smažou.")) return;
    try {
        await deleteDoc(docIn("posters", idKola(koloIdx)));
        ulozene.delete(idKola(koloIdx));
        nactiKolo(koloIdx);
        toast("Vráceno podle rozlosování");
    } catch (err) {
        onDbError(err);
    }
}

/* -------------------------------------------------------------- vykreslení --- */

const zkratka = n => esc(String(n).replace(/^(FK|TJ|SK|FC)\s+/i, "").slice(0, 10));

function znak(logo, nazev, velikost) {
    const c = velikost ? " " + velikost : "";
    return logo
        ? `<img class="badge${c}" src="${ZNAKY}${esc(logo)}" alt="${esc(nazev)}">`
        : `<div class="ph${c}">${zkratka(nazev)}</div>`;
}

function vykresli() {
    const d = stav, jeden = d.doma.length === 1;

    const heroes = d.doma.map(z => `
    <div class="hero${jeden ? " single" : ""}">
      <div class="team">${esc(z.tym)}</div>
      <div class="comp">${esc(z.soutez)}</div>
      <div class="mid">
        <div class="duel">
          <img class="badge" src="${ZNAKY}${esc(d.nasZnak)}" alt="FK Agro Vnorovy">
          <span class="vs">VS</span>
          ${znak(z.logo, z.souper)}
        </div>
        <div class="opp">${esc(z.souper)}</div>
      </div>
      <div class="when">${esc(z.den)} &nbsp;|&nbsp; ${esc(z.cas)}</div>
    </div>`).join("");

    const mladez = d.domaMladez.map(m => `
    <div class="row">
      <span class="cat">${esc(m.kat)}</span>
      ${znak(m.logo, m.souper, "xs")}
      <span class="opp">${esc(m.souper)}</span>
      <span class="when">${esc([m.den, m.cas].filter(Boolean).join("  "))}</span>
    </div>`).join("");

    const venku = d.venku.map(v => `
    <div class="awayrow">
      ${znak(v.logo, v.souper, "sm")}
      <div class="meta">
        <div class="cat">${esc(v.kat)}</div>
        <div class="opp">${esc(v.souper)}</div>
      </div>
      <div class="when">${esc(v.cas)}</div>
    </div>`).join("");

    const tyden = (d.vTydnu && d.vTydnu.length) ? `
    <div class="wk">
      <div class="wkh">V TÝDNU</div>
      ${d.vTydnu.map(t => `
        <div class="wkr">
          <div class="wkline">
            <span class="wkc">${esc(t.kat)}</span>
            <span class="wkt">${esc([t.den, t.cas].filter(Boolean).join("  "))}</span>
          </div>
          <div class="wkm">${t.doma
        ? "AGRO – " + esc(t.souper)
        : esc(t.souper) + " – AGRO"}</div>
        </div>`).join("")}
    </div>` : "";

    const mCls = d.domaMladez.length >= 4 ? " m4"
        : d.domaMladez.length === 3 ? " m3"
            : d.domaMladez.length === 2 ? " m2" : "";
    const vCls = (d.venku.length >= 5 ? " v5" : d.venku.length === 4 ? " v4" : "")
        + ((d.vTydnu && d.vTydnu.length) ? " tyden" : "");

    document.getElementById("poster").innerHTML = `
    <div class="design">
    <div class="corner tl"><i class="t1 k"></i><i class="t1 r"></i><i class="t1 r"></i><i></i></div>
    <div class="corner tr"><i class="t2 r"></i><i class="t2 k"></i><i></i><i class="t2 r"></i></div>
    <div class="corner br"><i></i><i class="t4 r"></i><i class="t4 r"></i><i class="t4 k"></i></div>
    <div class="dots l"></div><div class="dots rt"></div>

    <div class="phead">
      <img class="clublogo" src="${ZNAKY}${esc(d.nasZnak)}" alt="FK Agro Vnorovy">
      <div class="phead-mid">
        <div class="kicker">FK AGRO VNOROVY</div>
        <div class="ptitle">${esc(d.nadpis)}</div>
      </div>
      <div class="pdate"><div class="d">${esc(d.datum)}</div><div class="m">${esc(d.mesic)}</div></div>
    </div>
    <div class="rule"></div>

    <div class="body2">
      <div class="left${mCls}">
        ${(d.doma.length || d.domaMladez.length) ? `
          <div class="band home">HRAJEME DOMA<span class="sub">${esc(d.paticka.misto)}</span></div>
          ${d.doma.length ? `<div class="heroes">${heroes}</div>` : ""}
          ${mladez}`
            : `<div class="nicdoma">TENTO VÍKEND<br>HRAJEME JEN VENKU</div>`}
        <div class="pfoot">
          <div>
            <div class="venue">${esc(d.vyzva)}</div>
            <div class="txt">${esc(d.paticka.podtitul)}</div>
          </div>
        </div>
      </div>
      <div class="right${vCls}">
        <div class="band away">VENKU</div>
        <div class="rowlist">${venku}</div>
        ${tyden}
        <div class="qr">
          <div class="qrbox">
            <img src="${QR}" alt="Instagram">
            <span>@FKAGROVNOROVY</span>
          </div>
        </div>
      </div>
    </div>
    </div>`;

    zkratitDlouhe();
    dolad();
}

/* dlouhý název soupeře radši zmenšíme, než aby se uřízl třemi tečkami */
function zkratitDlouhe() {
    document.querySelectorAll("#poster .hero .opp, #poster .row .opp, #poster .awayrow .opp, #poster .wkm")
        .forEach(el => {
            el.style.fontSize = "";
            let px = parseFloat(getComputedStyle(el).fontSize);
            const dno = Math.max(13, px * 0.62);
            let pojistka = 0;
            while (el.scrollWidth > el.clientWidth + 1 && px > dno && pojistka++ < 40) {
                px -= 0.5;
                el.style.fontSize = px + "px";
            }
        });
}

/* QR si vezme tolik místa, kolik v pravém sloupci zbylo (96–240 px) */
const QR_MIN = 96, QR_MAX = 240, QR_KROK = 4;
function dolad() {
    const right = document.querySelector("#poster .right");
    const list = document.querySelector("#poster .rowlist");
    const img = document.querySelector("#poster .qr img");
    if (!right || !img) return;

    const preteka = () =>
        right.scrollHeight > right.clientHeight + 1
        || list.scrollHeight > list.clientHeight + 1
        || [...list.children].some(r => r.scrollHeight > r.clientHeight + 1);

    const nastav = px => { img.style.width = img.style.height = px + "px"; };
    let px = QR_MIN;
    nastav(px);
    let pojistka = 0;
    while (!preteka() && px < QR_MAX && pojistka++ < 200) { px += QR_KROK; nastav(px); }
    while (preteka() && px > QR_MIN) { px -= QR_KROK; nastav(px); }
}

/** Náhled se zmenší, aby se plakát vešel do šířky stránky. */
function fit() {
    const box = document.querySelector("#plakatApp .preview");
    if (!box) return;
    const st = getComputedStyle(box);
    const sirka = box.clientWidth - parseFloat(st.paddingLeft) - parseFloat(st.paddingRight);
    const s = Math.min(1, sirka / 1400);
    document.getElementById("plakatApp").style.setProperty("--s", Math.max(0.2, s).toFixed(4));
}

/* ----------------------------------------------------------------- editor --- */

function opt(list, val) {
    return list.map(o => `<option value="${esc(o[0])}"${o[0] === val ? " selected" : ""}>${esc(o[1])}</option>`).join("");
}
function znakSelect(path, val) {
    const list = [["", "— bez znaku —"]].concat(LOGA.map(f => [f, f.replace(/\.(png|jpg)$/, "")]));
    return `<select class="field" data-path="${path}">${opt(list, val || "")}</select>`;
}
function txt(path, val) {
    return `<input class="field" type="text" data-path="${path}" value="${esc(val)}">`;
}

function postavEditor() {
    const box = document.getElementById("plakatEditor");
    if (!box) return;
    const d = stav;
    let h = "";

    h += `<div class="pl-grid3">
    <div><label class="label">Datum</label>${txt("datum", d.datum)}</div>
    <div><label class="label">Měsíc a rok</label>${txt("mesic", d.mesic)}</div>
    <div><label class="label">Nadpis</label>${txt("nadpis", d.nadpis)}</div>
  </div>`;

    h += `<h3 class="pl-h">Hrajeme doma – velké dlaždice</h3>`;
    d.doma.forEach((z, i) => {
        h += `<div class="pl-card">
      <div class="pl-cardhead"><b>Dlaždice ${i + 1}</b>
        <button type="button" class="btn btn--ghost btn--sm" data-del="doma:${i}">Smazat</button></div>
      <div class="pl-grid2">
        <div><label class="label">Tým</label>${txt("doma." + i + ".tym", z.tym)}</div>
        <div><label class="label">Čas</label>${txt("doma." + i + ".cas", z.cas)}</div>
      </div>
      <label class="label">Soutěž</label>${txt("doma." + i + ".soutez", z.soutez)}
      <label class="label">Soupeř</label>${txt("doma." + i + ".souper", z.souper)}
      <div class="pl-grid2">
        <div><label class="label">Znak soupeře</label>${znakSelect("doma." + i + ".logo", z.logo)}</div>
        <div><label class="label">Den a datum</label>${txt("doma." + i + ".den", z.den)}</div>
      </div></div>`;
    });
    h += `<button type="button" class="btn btn--ghost" data-add="doma">+ Přidat domácí zápas</button>`;

    h += `<h3 class="pl-h">Doma – mládež (úzké řádky)</h3>`;
    d.domaMladez.forEach((m, i) => {
        h += `<div class="pl-card">
      <div class="pl-cardhead"><b>Řádek ${i + 1}</b>
        <button type="button" class="btn btn--ghost btn--sm" data-del="domaMladez:${i}">Smazat</button></div>
      <div class="pl-grid2">
        <div><label class="label">Kategorie</label>${txt("domaMladez." + i + ".kat", m.kat)}</div>
        <div><label class="label">Soupeř</label>${txt("domaMladez." + i + ".souper", m.souper)}</div>
      </div>
      <div class="pl-grid3">
        <div><label class="label">Znak</label>${znakSelect("domaMladez." + i + ".logo", m.logo)}</div>
        <div><label class="label">Den</label>${txt("domaMladez." + i + ".den", m.den)}</div>
        <div><label class="label">Čas</label>${txt("domaMladez." + i + ".cas", m.cas)}</div>
      </div></div>`;
    });
    h += `<button type="button" class="btn btn--ghost" data-add="domaMladez">+ Přidat řádek mládeže</button>`;

    h += `<h3 class="pl-h">Venku</h3>`;
    d.venku.forEach((v, i) => {
        h += `<div class="pl-card">
      <div class="pl-cardhead"><b>Řádek ${i + 1}</b>
        <button type="button" class="btn btn--ghost btn--sm" data-del="venku:${i}">Smazat</button></div>
      <div class="pl-grid2">
        <div><label class="label">Kategorie</label>${txt("venku." + i + ".kat", v.kat)}</div>
        <div><label class="label">Čas</label>${txt("venku." + i + ".cas", v.cas)}</div>
      </div>
      <label class="label">Soupeř</label>${txt("venku." + i + ".souper", v.souper)}
      <label class="label">Znak soupeře</label>${znakSelect("venku." + i + ".logo", v.logo)}
    </div>`;
    });
    h += `<button type="button" class="btn btn--ghost" data-add="venku">+ Přidat řádek venku</button>`;

    h += `<h3 class="pl-h">V týdnu (zápasy mimo víkend)</h3>`;
    (d.vTydnu || []).forEach((t, i) => {
        h += `<div class="pl-card">
      <div class="pl-cardhead"><b>Řádek ${i + 1}</b>
        <button type="button" class="btn btn--ghost btn--sm" data-del="vTydnu:${i}">Smazat</button></div>
      <div class="pl-grid2">
        <div><label class="label">Kategorie</label>${txt("vTydnu." + i + ".kat", t.kat)}</div>
        <div><label class="label">Hrajeme</label>
          <select class="field" data-path="vTydnu.${i}.doma" data-bool="1">
            <option value="1"${t.doma ? " selected" : ""}>Doma</option>
            <option value=""${t.doma ? "" : " selected"}>Venku</option>
          </select></div>
      </div>
      <label class="label">Soupeř</label>${txt("vTydnu." + i + ".souper", t.souper)}
      <div class="pl-grid2">
        <div><label class="label">Den a datum</label>${txt("vTydnu." + i + ".den", t.den)}</div>
        <div><label class="label">Čas</label>${txt("vTydnu." + i + ".cas", t.cas)}</div>
      </div></div>`;
    });
    h += `<button type="button" class="btn btn--ghost" data-add="vTydnu">+ Přidat zápas v týdnu</button>`;

    h += `<h3 class="pl-h">Patička</h3>
    <label class="label">Velký text vlevo dole</label>${txt("vyzva", d.vyzva)}
    <label class="label">Druhý řádek patičky</label>${txt("paticka.podtitul", d.paticka.podtitul)}
    <div class="pl-grid2">
      <div><label class="label">Místo (v červeném pruhu)</label>${txt("paticka.misto", d.paticka.misto)}</div>
      <div><label class="label">Náš znak</label>${znakSelect("nasZnak", d.nasZnak)}</div>
    </div>`;

    const chybi = chybejiciZnaky();
    if (chybi.length) {
        h += `<p class="pl-warn">Bez znaku se vykreslí čárkovaný rámeček: <b>${chybi.map(esc).join(" · ")}</b></p>`;
    }

    box.innerHTML = h;

    box.querySelectorAll("[data-path]").forEach(el => {
        el.addEventListener("input", () => {
            nastavCestu(el.dataset.path, el.dataset.bool ? !!el.value : el.value);
            vykresli(); uloz();
        });
    });
    box.querySelectorAll("[data-add]").forEach(el => {
        el.addEventListener("click", () => pridej(el.dataset.add));
    });
    box.querySelectorAll("[data-del]").forEach(el => {
        el.addEventListener("click", () => {
            const [kde, i] = el.dataset.del.split(":");
            stav[kde].splice(Number(i), 1);
            postavEditor(); vykresli(); uloz();
        });
    });
}

function nastavCestu(path, val) {
    const p = path.split("."); let o = stav;
    for (let i = 0; i < p.length - 1; i++) o = o[p[i]];
    o[p[p.length - 1]] = val;
}

function pridej(kde) {
    if (kde === "doma") stav.doma.push({ tym: "A-TÝM", soutez: SOUTEZE.A, souper: "", logo: "", den: "", cas: "" });
    if (kde === "domaMladez") stav.domaMladez.push({ kat: "", souper: "", logo: "", den: "", cas: "" });
    if (kde === "venku") stav.venku.push({ kat: "", souper: "", logo: "", cas: "" });
    if (kde === "vTydnu") (stav.vTydnu ||= []).push({ kat: "", doma: false, souper: "", den: "", cas: "" });
    postavEditor(); vykresli(); uloz();
}

function chybejiciZnaky() {
    const out = [];
    const zkus = (s, l) => { if (s && !l && out.indexOf(s) < 0) out.push(s); };
    stav.doma.forEach(z => zkus(z.souper, z.logo));
    stav.domaMladez.forEach(z => zkus(z.souper, z.logo));
    stav.venku.forEach(z => zkus(z.souper, z.logo));
    return out;
}

/* -------------------------------------------------------------- přepínač --- */

function postavPrepinac() {
    const sel = document.getElementById("koloSelect");
    sel.innerHTML = SEZONA.map((w, i) =>
        `<option value="${i}">${i + 1}. kolo · ${esc(w.id)}</option>`).join("");
    sel.addEventListener("change", e => nactiKolo(Number(e.target.value)));
    document.getElementById("koloPrev").addEventListener("click", () => nactiKolo(koloIdx - 1));
    document.getElementById("koloNext").addEventListener("click", () => nactiKolo(koloIdx + 1));
    document.getElementById("printBtn").addEventListener("click", () => window.print());
    document.getElementById("resetBtn").addEventListener("click", vratVychozi);
}

function oznacKolo() {
    document.getElementById("koloSelect").value = String(koloIdx);
    document.getElementById("koloPrev").disabled = koloIdx === 0;
    document.getElementById("koloNext").disabled = koloIdx === SEZONA.length - 1;
    const znacka = document.getElementById("koloStav");
    if (znacka) {
        const upraveno = ulozene.has(idKola(koloIdx));
        znacka.textContent = upraveno ? "upraveno ručně" : "podle rozlosování";
        znacka.dataset.upraveno = upraveno ? "1" : "";
    }
}

/* ------------------------------------------------------------------ start --- */

postavPrepinac();
initAuth(() => { postavEditor(); oznacKolo(); });
nactiKolo(0);
fit();
window.addEventListener("resize", fit);

whenReady(() => {
    setStatus("online");
    onSnapshot(col("posters"), snap => {
        ulozene.clear();
        snap.docs.forEach(d => ulozene.set(d.id, d.data()));
        // co je zrovna na obrazovce, znovu načíst jen když to sám needituju
        if (!document.activeElement || !document.activeElement.closest("#plakatEditor")) {
            nactiKolo(koloIdx);
        } else {
            oznacKolo();
        }
    }, onDbError);
});
