/* ==========================================================================
   FK AGRO VNOROVY · Počítadlo návštěv (od 18. 11. 2026)
   Samostatný soubor – když cokoli selže, stránka o tom neví a běží dál.
   Ukládá jen součty: dokument navstevy/<RRRR-MM-DD> = {celkem, stranky: {stránka: n},
   zarizeni: {náhodné id: n}, typ: {mobil|pc: n}, karty: {hráč: n}}.
   Žádná jména, cookies ani IP – id zařízení je náhodné číslo v prohlížeči.
   Jedna stránka (a karta hráče) se za relaci prohlížeče počítá jen jednou.
   Přehled: navstevy.html (není v menu). Michalovo zařízení jde vypnout tam.
   ========================================================================== */

import { setDoc, increment } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { docIn, whenReady } from "./core.js?v=11";

const den = () => new Date().toLocaleDateString("sv-SE");              // RRRR-MM-DD podle místního času
const ulozeno = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch { return null; } return null; };
const jednou = (k) => { try { if (sessionStorage.getItem(k)) return false; sessionStorage.setItem(k, "1"); } catch { /* bez úložiště počítej */ } return true; };

function zapis(data) {
    try {
        whenReady(() => {
            try { setDoc(docIn("navstevy", den()), data, { merge: true }).catch(() => {}); } catch { /* nic */ }
        });
    } catch { /* nic */ }
}

try {
    const vypnuto = ulozeno("navstevyNepocitat") === "1" || /^(localhost|127\.|\[::1\])/.test(location.hostname) || location.protocol === "file:";
    if (!vypnuto) {
        let id = ulozeno("navstevyId");
        if (!id) { id = "z" + Math.random().toString(36).slice(2, 10); ulozeno("navstevyId", id); }
        const str = (location.pathname.split("/").pop() || "index").replace(/\.html$/, "") || "index";
        if (jednou("navstevy:" + str)) {
            zapis({ celkem: increment(1), stranky: { [str]: increment(1) }, zarizeni: { [id]: increment(1) },
                typ: { [/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) ? "mobil" : "pc"]: increment(1) } });
        }
        /* statistiky: která karta hráče se otevírá (#hrac=…) */
        if (str === "statistiky") {
            const karta = () => {
                const m = location.hash.match(/^#hrac=([a-z0-9-]{1,60})$/);
                if (m && jednou("navstevy:karta:" + m[1])) zapis({ karty: { [m[1]]: increment(1) } });
            };
            karta();
            window.addEventListener("hashchange", karta);
        }
    }
} catch { /* počítadlo nesmí nikdy shodit stránku */ }
