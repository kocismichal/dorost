/* ==========================================================================
   Synchronizace docházky dorostu z Týmuj do databáze webu.
   Spouští ji GitHub Actions (.github/workflows/tymuj-sync.yml), jde pustit
   i ručně:  TYMUJ_TOKEN=... node scripts/tymuj-sync.mjs

   Token se bere jen z proměnné prostředí (na GitHubu ze secretu
   TYMUJ_TOKEN). Do repozitáře se nikdy nezapisuje.
   ========================================================================== */

import { readFileSync } from "node:fs";
import { nactiZTymuj, ulozDoFirestore, ulozChybu } from "../assets/js/tymuj.js";

// Konfigurace Firebase je v core.js – čteme ji odtamtud, ať není na dvou místech.
const core = readFileSync(new URL("../assets/js/core.js", import.meta.url), "utf8");
const najdi = (re) => { const m = core.match(re); if (!m) throw new Error("V core.js chybí " + re); return m[1]; };
const firebase = {
    apiKey: najdi(/apiKey:\s*"([^"]+)"/),
    projectId: najdi(/projectId:\s*"([^"]+)"/),
    appId: najdi(/const APP_ID\s*=\s*"([^"]+)"/)
};

const token = (process.env.TYMUJ_TOKEN || "").trim().replace(/^Bearer\s+/i, "");
if (!token) {
    console.error("Chybí TYMUJ_TOKEN.");
    process.exit(1);
}

// Upozornění na blížící se konec platnosti tokenu (JWT, platí 60 dní).
try {
    const exp = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).exp;
    const dni = Math.floor((exp * 1000 - Date.now()) / 86400000);
    console.log(`Token platí ještě ${dni} dní (do ${new Date(exp * 1000).toLocaleDateString("cs-CZ")}).`);
    if (dni < 7) console.log("::warning::Token do Týmuj brzy vyprší – vlož nový do secretu TYMUJ_TOKEN.");
} catch { /* token není JWT – nevadí */ }

try {
    const data = await nactiZTymuj(token);
    await ulozDoFirestore(data, firebase);
    const treninky = data.udalosti.filter(u => u.druh.startsWith("T_") && u.druh !== "T_A" && !u.zruseno).length;
    console.log(`Hotovo: ${data.hraci.length} hráčů, ${data.udalosti.length} událostí (${treninky} tréninků dorostu) od ${data.od}.`);
} catch (err) {
    console.error(err.message);
    await ulozChybu(err.message, firebase).catch(() => {});
    process.exit(1);
}
