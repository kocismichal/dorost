/* ==========================================================================
   FK AGRO VNOROVY · Přehled návštěvnosti (navstevy.html, není v menu)
   Čte dokumenty navstevy/<RRRR-MM-DD>, které zapisuje navstevy.js.
   ========================================================================== */

import { getDocs } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { col, whenReady, setStatus, esc } from "./core.js?v=11";

const STRANKY = { index: "Pokutníček", "kanadske-body": "Kanadské body", dochazka: "Docházka", taktika: "Taktika", statistiky: "Statistiky", "statistiky-klub": "Statistiky (odkaz bez lišty)",
    "pro-hrace": "Pro hráče", "pro-hrace-jidlo": "Pro hráče – jídlo", "pro-hrace-kviz": "Pro hráče – kvíz", "pro-hrace-regenerace": "Pro hráče – regenerace",
    "pro-hrace-rozcvicka": "Pro hráče – rozcvička" };
const fmt = n => n.toLocaleString("cs-CZ");
const czd = d => { const [y, m, dd] = d.split("-"); return `${+dd}. ${+m}.`; };
let DNY = [], obdobi = 30;

whenReady(async () => {
    try {
        const snap = await getDocs(col("navstevy"));
        DNY = snap.docs.filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d.id)).map(d => ({ d: d.id, ...d.data() })).sort((a, b) => a.d.localeCompare(b.d));
        setStatus("online");
        kresli();
    } catch (e) { setStatus("offline"); document.getElementById("obsah").innerHTML = `<p class="nv-p">Data se nepodařilo načíst.</p>`; }
});

function kresli() {
    const seg = document.getElementById("obdobi");
    seg.innerHTML = [[7, "7 dní"], [30, "30 dní"], [0, "Celkem"]].map(([k, l]) => `<button type="button" data-k="${k}" class="${k === obdobi ? "is-on" : ""}">${l}</button>`).join("");
    seg.onclick = (e) => { const b = e.target.closest("button"); if (!b) return; obdobi = +b.dataset.k; kresli(); };
    const od = obdobi ? new Date(Date.now() - (obdobi - 1) * 864e5).toLocaleDateString("sv-SE") : "0000";
    const V = DNY.filter(x => x.d >= od);
    const soucet = (pole) => { const s = {}; V.forEach(x => Object.entries(x[pole] || {}).forEach(([k, n]) => { s[k] = (s[k] || 0) + n; })); return s; };
    const celkem = V.reduce((a, x) => a + (x.celkem || 0), 0);
    const zarizeni = Object.keys(soucet("zarizeni")).length;
    const dnes = DNY.find(x => x.d === new Date().toLocaleDateString("sv-SE"));
    const typ = soucet("typ"), str = soucet("stranky"), karty = soucet("karty");
    /* graf po dnech (i dny bez návštěv) */
    const dny = [];
    if (DNY.length) {
        const start = obdobi && od > DNY[0].d ? od : DNY[0].d;      // graf až od prvního dne počítání
        for (let t = new Date(start + "T12:00"); t <= new Date(); t = new Date(t.getTime() + 864e5)) dny.push(t.toLocaleDateString("sv-SE"));
    }
    const max = Math.max(1, ...dny.map(d => (DNY.find(x => x.d === d) || {}).celkem || 0));
    const graf = dny.map(d => { const x = DNY.find(y => y.d === d) || {}; const n = x.celkem || 0, u = Object.keys(x.zarizeni || {}).length;
        return `<div class="nv-sl" title="${czd(d)}: ${n} návštěv, ${u} zařízení"><b>${n || ""}</b><i style="height:${Math.round(n / max * 100)}%"></i><small>${czd(d)}</small></div>`; }).join("");
    const hezky = k => k.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");     // „bacik-michal“ → „Bacik Michal“ (bez háčků, jak je v odkazu)
    const radky = (o, nazvy) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, n]) => `<tr><td>${nazvy === 1 ? `<a href="statistiky.html#hrac=${encodeURIComponent(k)}">${esc(hezky(k))}</a>` : esc(nazvy ? nazvy[k] || k : k)}</td><td class="n"><b>${fmt(n)}</b></td></tr>`).join("");
    document.getElementById("obsah").innerHTML = !DNY.length ? `<p class="nv-p">Zatím žádná návštěva – data přibudou, jakmile někdo web otevře.</p>` : `
        <div class="nv-tiles">
            <div class="nv-tile"><span>Návštěv</span><b>${fmt(celkem)}</b><small>${obdobi ? `za posledních ${obdobi} dní` : "od začátku počítání"}</small></div>
            <div class="nv-tile"><span>Různých zařízení</span><b>${fmt(zarizeni)}</b><small>≈ různých lidí</small></div>
            <div class="nv-tile"><span>Dnes</span><b>${fmt(dnes ? dnes.celkem || 0 : 0)}</b><small>${dnes ? Object.keys(dnes.zarizeni || {}).length : 0} zařízení</small></div>
            <div class="nv-tile"><span>Mobil / PC</span><b>${fmt(typ.mobil || 0)} / ${fmt(typ.pc || 0)}</b><small>návštěv</small></div>
        </div>
        <div class="nv-box"><h3>Návštěvy po dnech</h3><div class="nv-graf">${graf}</div></div>
        <div class="nv-grid">
            <div class="nv-box"><h3>Stránky</h3><table><thead><tr><th>Stránka</th><th class="n">Návštěv</th></tr></thead><tbody>${radky(str, STRANKY)}</tbody></table></div>
            ${Object.keys(karty).length ? `<div class="nv-box"><h3>Nejotevíranější karty hráčů</h3><table><thead><tr><th>Hráč</th><th class="n">Otevřeno</th></tr></thead><tbody>${radky(karty, 1).split("</tr>").slice(0, 20).join("</tr>")}</tbody></table></div>` : ""}
        </div>`;
    /* moje zařízení nepočítat */
    let vyp = false; try { vyp = localStorage.getItem("navstevyNepocitat") === "1"; } catch { /* nic */ }
    const ja = document.getElementById("ja");
    ja.innerHTML = `<span>Toto zařízení se ${vyp ? "<b>nepočítá</b>" : "<b>počítá</b>"} do návštěv.</span><button type="button" class="btn btn--ghost">${vyp ? "Znovu počítat" : "Nepočítat moje zařízení"}</button>`;
    ja.querySelector("button").onclick = () => { try { if (vyp) localStorage.removeItem("navstevyNepocitat"); else localStorage.setItem("navstevyNepocitat", "1"); } catch { /* nic */ } kresli(); };
}
