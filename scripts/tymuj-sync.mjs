/* ==========================================================================
   Synchronizace docházky dorostu z Týmuj do databáze webu.
   Spouští ji GitHub Actions (.github/workflows/tymuj-sync.yml), jde pustit
   i ručně:  TYMUJ_TOKEN=... node scripts/tymuj-sync.mjs

   Ukládá dva dokumenty: dochazka/dorost (docházka) a dochazka/historie
   (časy odpovědí a kdo je zadal). Token se bere jen z proměnné prostředí
   (na GitHubu ze secretu TYMUJ_TOKEN). Do repozitáře se nikdy nezapisuje.
   ========================================================================== */

import {
    nactiZTymuj, ulozDoFirestore, ulozChybu,
    nactiHistorii, nactiDokument, ulozDokument, HISTORIE_DOKUMENT
} from "../assets/js/tymuj.js";
import { firebaseKonfigurace, tokenTymuj } from "./spolecne.mjs";

const firebase = firebaseKonfigurace();
const token = tokenTymuj();

try {
    const data = await nactiZTymuj(token);
    await ulozDoFirestore(data, firebase);
    const treninky = data.udalosti.filter(u => u.druh.startsWith("T_") && u.druh !== "T_A" && !u.zruseno).length;
    console.log(`Docházka: ${data.hraci.length} hráčů, ${data.udalosti.length} událostí (${treninky} tréninků dorostu) od ${data.od}.`);

    const predchozi = await nactiDokument(HISTORIE_DOKUMENT, firebase).catch(() => null);
    const { historie, stazeno } = await nactiHistorii(token, data, predchozi);
    await ulozDokument(HISTORIE_DOKUMENT, historie, firebase);
    console.log(`Historie odpovědí: staženo ${stazeno} dvojic událost × hráč.`);
} catch (err) {
    console.error(err.message);
    await ulozChybu(err.message, firebase).catch(() => {});
    process.exit(1);
}
