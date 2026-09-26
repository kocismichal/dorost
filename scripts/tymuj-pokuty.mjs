/* ==========================================================================
   Pondělní zápis pokut z docházky Týmuj do pokutníčku (za uplynulý týden).
   Spouští GitHub Actions (.github/workflows/tymuj-pokuty.yml) každé pondělí.
   Ručně:  TYMUJ_TOKEN=... node scripts/tymuj-pokuty.mjs [--tyden 2026-09-21] [--nahled]

   Pravidla jsou v assets/js/tymuj.js (pokutyZaTyden). Zapisuje jako „AI“
   s autoKey – co už v pokutníčku je, se znovu nezapíše. Bere jen jeden
   týden, takže ručně smazaná pokuta se příště nevrátí.
   ========================================================================== */

import { nactiZTymuj, nactiHistorii, pokutyZaTyden, pondeliTydne } from "../assets/js/tymuj.js";
import { firebaseKonfigurace, tokenTymuj } from "./spolecne.mjs";

const cfg = firebaseKonfigurace();
const token = tokenTymuj();
const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
const NAHLED = process.argv.includes("--nahled");

// uplynulý týden = pondělí před 7 dny (podle pražského data)
const dnesPraha = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Prague" });
const minuly = new Date(pondeliTydne(dnesPraha) + "T12:00:00Z"); minuly.setUTCDate(minuly.getUTCDate() - 7);
const zadany = (arg("--tyden") || process.env.TYDEN || "").trim();
if (zadany && !/^\d{4}-\d{2}-\d{2}$/.test(zadany)) { console.error("Týden musí být ve tvaru RRRR-MM-DD."); process.exit(1); }
const tyden = zadany ? pondeliTydne(zadany) : minuly.toISOString().slice(0, 10);
console.log(`Týden od ${tyden}${NAHLED ? " (jen náhled)" : ""}`);

// --- Týmuj: docházka + historie odpovědí jen pro události toho týdne
const data = await nactiZTymuj(token);
const tydenData = { ...data, udalosti: data.udalosti.filter(u => pondeliTydne(u.zacatek) === tyden) };
const { historie } = await nactiHistorii(token, tydenData, null);
const pokuty = pokutyZaTyden(data, historie, tyden);

// --- Firestore (REST, anonymně jako web)
const a = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${cfg.apiKey}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ returnSecureToken: true })
}).then(r => r.json());
const base = `https://firestore.googleapis.com/v1/projects/${cfg.projectId}/databases/(default)/documents/artifacts/${cfg.appId}/public/data`;
const h = { authorization: "Bearer " + a.idToken, "content-type": "application/json" };
const vse = async (c) => { let out = [], t = ""; do { const r = await fetch(`${base}/${c}?pageSize=300${t ? "&pageToken=" + t : ""}`, { headers: h }).then(r => r.json()); out.push(...(r.documents || [])); t = r.nextPageToken; } while (t); return out; };

const hraciPokut = (await vse("players")).map(d => ({ id: d.name.split("/").pop(), name: d.fields.name.stringValue }));
const zapsane = new Set((await vse("fines")).map(d => d.fields.autoKey && d.fields.autoKey.stringValue).filter(Boolean));
// pokuty, které trenér na webu zrušil – ty se už nikdy nezapisují
const zrusene = new Set((await vse("pokutyZrusene")).map(d => d.fields.autoKey && d.fields.autoKey.stringValue).filter(Boolean));

// jméno z Týmuj → hráč pokutníčku (bez diakritiky, případně příjmení + první písmeno)
const norm = s => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const prijmeni = s => norm(s).split(" ").pop();
const najdi = (j) => hraciPokut.find(p => norm(p.name) === norm(j))
    || hraciPokut.find(p => prijmeni(p.name) === prijmeni(j) && norm(p.name)[0] === norm(j)[0])
    || hraciPokut.filter(p => prijmeni(p.name) === prijmeni(j)).length === 1 && hraciPokut.find(p => prijmeni(p.name) === prijmeni(j))
    || null;

let zapsano = 0, uz = 0, zruseno = 0;
const chybi = new Set(), souhrn = {};
for (const p of pokuty) {
    const hp = najdi(p.jmeno);
    if (!hp) { chybi.add(p.jmeno); continue; }
    const autoKey = `${p.klic}|${hp.id}`;
    if (zapsane.has(autoKey)) { uz++; continue; }
    if (zrusene.has(autoKey)) { zruseno++; continue; }
    souhrn[hp.name] = (souhrn[hp.name] || 0) + p.amount;
    if (!NAHLED) {
        const r = await fetch(`${base}/fines`, { method: "POST", headers: h, body: JSON.stringify({ fields: {
            playerId: { stringValue: hp.id }, playerName: { stringValue: hp.name }, typeKey: { stringValue: p.typeKey },
            label: { stringValue: p.label }, amount: { integerValue: String(p.amount) }, note: { stringValue: p.note },
            addedBy: { stringValue: "AI" }, createdAt: { timestampValue: p.createdAt }, autoKey: { stringValue: autoKey }
        } }) });
        if (!r.ok) { console.error("Zápis selhal:", r.status, await r.text()); process.exit(1); }
        zapsane.add(autoKey);
    }
    zapsano++;
}

console.table(souhrn);
console.log(`${NAHLED ? "K zápisu" : "Zapsáno"}: ${zapsano}, už bylo zapsané: ${uz}, trenér zrušil: ${zruseno}.`);
if (chybi.size) console.log(`::warning::Hráči z Týmuj, kteří nejsou v pokutníčku: ${[...chybi].join(", ")}`);
