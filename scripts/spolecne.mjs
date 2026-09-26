/* Společné pro skripty v scripts/: konfigurace Firebase a token do Týmuj. */

import { readFileSync } from "node:fs";

/** Konfigurace Firebase se čte z core.js, ať není na dvou místech. */
export function firebaseKonfigurace() {
    const core = readFileSync(new URL("../assets/js/core.js", import.meta.url), "utf8");
    const najdi = (re) => { const m = core.match(re); if (!m) throw new Error("V core.js chybí " + re); return m[1]; };
    return {
        apiKey: najdi(/apiKey:\s*"([^"]+)"/),
        projectId: najdi(/projectId:\s*"([^"]+)"/),
        appId: najdi(/const APP_ID\s*=\s*"([^"]+)"/)
    };
}

/** Token do Týmuj z proměnné TYMUJ_TOKEN (na GitHubu secret) + upozornění na konec platnosti. */
export function tokenTymuj() {
    const token = (process.env.TYMUJ_TOKEN || "").trim().replace(/^Bearer\s+/i, "");
    if (!token) {
        console.error("Chybí TYMUJ_TOKEN.");
        process.exit(1);
    }
    try {
        const exp = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).exp;
        const dni = Math.floor((exp * 1000 - Date.now()) / 86400000);
        console.log(`Token platí ještě ${dni} dní (do ${new Date(exp * 1000).toLocaleDateString("cs-CZ")}).`);
        if (dni < 7) console.log("::warning::Token do Týmuj brzy vyprší – vlož nový do secretu TYMUJ_TOKEN.");
    } catch { /* token není JWT – nevadí */ }
    return token;
}
