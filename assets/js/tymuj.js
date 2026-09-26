/* ==========================================================================
   FK AGRO VNOROVY – DOROST · stahování docházky z Týmuj
   Sdílený kód: používá ho synchronizace na GitHubu (scripts/tymuj-sync.mjs,
   běží v Node) i stránka docházky (jen konstanty a druhy událostí).
   Nic tu nesmí záviset na prohlížeči ani na Node – jen fetch.

   Týmuj nemá veřejné API. Tohle je to samé API, přes které funguje jejich
   webová aplikace (rust-api.tymuj.cz). Přístup je přes token přihlášeného
   uživatele (cookie userToken na app.tymuj.cz), platí 60 dní.
   ========================================================================== */

export const TYMUJ = {
    api: "https://rust-api.tymuj.cz",
    tymId: 59342,            // AGRO VNOROVY
    podskupina: "DOROST",    // podskupina v Týmuj, jejíž hráče sledujeme
    odData: "2026-07-13"     // začátek sezóny 2026/27 (první pondělní kondice)
};

/* Kam se data ukládají: artifacts/<APP_ID>/public/data/dochazka/dorost,
   jako jeden dokument s polem `data` (JSON text). */
export const DOCHAZKA_KOLEKCE = "dochazka";
export const DOCHAZKA_DOKUMENT = "dorost";

/* ------------------------------------------------------ druhy událostí ---
   Týmuj rozlišuje jen zápas / ostatní, zbytek se pozná z názvu a dne.
   Při nových názvech událostí zkontrolovat, že spadnou správně.
   ------------------------------------------------------------------- */

export const DRUHY = {
    T_PO:   { nazev: "Po – kondice",      kratce: "Po",    trenink: true },
    T_UT:   { nazev: "Út – trénink",      kratce: "Út",    trenink: true },
    T_CT:   { nazev: "Čt – trénink",      kratce: "Čt",    trenink: true },
    T_JINY: { nazev: "Jiný trénink",      kratce: "Jiný",  trenink: true },
    T_A:    { nazev: "Trénink s áčkem",   kratce: "S A",   trenink: false },
    PRAT:   { nazev: "Přátelák / pohár",  kratce: "Přát.", trenink: false },
    Z_D:    { nazev: "Zápas dorostu",     kratce: "D",     trenink: false },
    Z_B:    { nazev: "Zápas B",           kratce: "B",     trenink: false },
    Z_A:    { nazev: "Zápas A",           kratce: "A",     trenink: false },
    Z_X:    { nazev: "Zápas",             kratce: "Z",     trenink: false }
};

export function druhUdalosti(e) {
    const nazev = String(e.name || (e.opponent && e.opponent.name) || "").toUpperCase();
    if (e.is_game) {
        const m = nazev.match(/^([ABD])\s*-/);
        return m ? "Z_" + m[1] : "Z_X";
    }
    if (/PŘÁT|POHÁR|TURNAJ/.test(nazev)) return "PRAT";
    if (/ÁČKO/.test(nazev) && !/DOROST/.test(nazev)) return "T_A";
    // den podle místního data v start_time (GitHub běží v UTC), 0 = neděle
    const den = new Date(e.start_time.slice(0, 10) + "T12:00:00Z").getUTCDay();
    if (den === 1 || /KONDI|BĚŽ/.test(nazev)) return "T_PO";
    if (den === 2) return "T_UT";
    if (den === 4) return "T_CT";
    return "T_JINY";
}

/* ------------------------------------------------------------ stažení --- */

const ODPOVED = { GOING: "G", NOT_GOING: "N", MAYBE: "M" };

async function volej(cesta, token, init = {}) {
    const r = await fetch(TYMUJ.api + cesta, {
        ...init,
        headers: {
            "authorization": "Bearer " + token,
            "X-Tymuj-Origin": "tymuj",
            "X-Tymuj-Platform": "web",
            "content-type": "application/json"
        }
    });
    if (r.status === 401) throw new Error("Týmuj odmítl token (401) – vypršel nebo je špatně zkopírovaný.");
    if (!r.ok) throw new Error(`Týmuj vrátil ${r.status} pro ${cesta}`);
    return r.json();
}

/**
 * Stáhne z Týmuj hráče podskupiny Dorost a všechny odehrané události od
 * začátku sezóny. Vrací kompaktní objekt, který se ukládá do databáze.
 */
export async function nactiZTymuj(token) {
    const q = `query { teams { id name members { id isActive nonAttendanceStart nonAttendanceEnd nonAttendanceNote
        teamSubgroup { id name } user { id userProfile { fullName } } } } }`;
    const g = await volej("/graphql", token, { method: "POST", body: JSON.stringify({ query: q }) });
    if (g.errors) throw new Error("GraphQL: " + g.errors.map(e => e.message).join("; "));
    const tym = (g.data.teams || []).find(t => Number(t.id) === TYMUJ.tymId);
    if (!tym) throw new Error("Tým " + TYMUJ.tymId + " v Týmuj nenalezen.");

    const hraci = tym.members
        .filter(m => m.teamSubgroup && m.teamSubgroup.name === TYMUJ.podskupina)
        .map(m => ({
            id: String(m.id),
            jmeno: String((m.user && m.user.userProfile && m.user.userProfile.fullName) || "").replace(/\s+/g, " ").trim(),
            aktivni: m.isActive !== false,
            dlouhodobaOmluva: m.nonAttendanceStart ? {
                od: m.nonAttendanceStart, do: m.nonAttendanceEnd, pozn: m.nonAttendanceNote || ""
            } : null
        }))
        .sort((a, b) => a.jmeno.localeCompare(b.jmeno, "cs"));
    const idHracu = new Set(hraci.map(h => h.id));

    const udalosti = [];
    for (let strana = 0; strana < 20; strana++) {
        const r = await volej(`/api/v3/attendances/events?team_id=${TYMUJ.tymId}&upcoming=false&past=true&page=${strana}&page_size=200`, token);
        udalosti.push(...r.payload);
        if (udalosti.length >= r.total || !r.payload.length) break;
    }

    const vysledek = udalosti
        .filter(e => e.start_time.slice(0, 10) >= TYMUJ.odData)
        .map(e => {
            const ucast = {};
            for (const p of e.event_players) {
                const id = String(p.team_member_id);
                if (!idHracu.has(id)) continue;
                ucast[id] = [ODPOVED[p.answer] || "", String(p.comment || "").trim()];
            }
            return {
                id: e.id,
                zacatek: e.start_time,
                nazev: String(e.name || (e.opponent && e.opponent.name) || "").trim(),
                druh: druhUdalosti(e),
                zruseno: !!e.is_cancelled,
                venku: !!e.is_away,
                ucast
            };
        })
        .sort((a, b) => a.zacatek.localeCompare(b.zacatek));

    return {
        verze: 1,
        aktualizovano: new Date().toISOString(),
        od: TYMUJ.odData,
        hraci,
        udalosti: vysledek
    };
}

/* ------------------------------------------------------- uložení (REST) ---
   Zápis přes REST API Firestore, aby to fungovalo i bez knihovny Firebase.
   Přihlásí se anonymně stejně jako web a přepíše jeden dokument.
   ------------------------------------------------------------------- */

export async function ulozDoFirestore(data, { apiKey, projectId, appId }) {
    const a = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ returnSecureToken: true })
    }).then(r => r.json());
    if (!a.idToken) throw new Error("Anonymní přihlášení do Firebase selhalo: " + JSON.stringify(a.error || a));

    const cesta = `projects/${projectId}/databases/(default)/documents/artifacts/${appId}/public/data/${DOCHAZKA_KOLEKCE}/${DOCHAZKA_DOKUMENT}`;
    const r = await fetch(`https://firestore.googleapis.com/v1/${cesta}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", "authorization": "Bearer " + a.idToken },
        body: JSON.stringify({ fields: {
            data: { stringValue: JSON.stringify(data) },
            aktualizovano: { timestampValue: data.aktualizovano }
        } })
    });
    if (!r.ok) throw new Error(`Zápis do Firestore selhal: ${r.status} ${await r.text()}`);
}

/* Zapíše do stejného dokumentu jen chybu (např. vypršelý token), aby ji
   stránka mohla ukázat. Data zůstanou z poslední úspěšné synchronizace. */
export async function ulozChybu(zprava, { apiKey, projectId, appId }) {
    const a = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ returnSecureToken: true })
    }).then(r => r.json());
    if (!a.idToken) return;
    const cesta = `projects/${projectId}/databases/(default)/documents/artifacts/${appId}/public/data/${DOCHAZKA_KOLEKCE}/${DOCHAZKA_DOKUMENT}`;
    await fetch(`https://firestore.googleapis.com/v1/${cesta}?updateMask.fieldPaths=chyba&updateMask.fieldPaths=chybaKdy`, {
        method: "PATCH",
        headers: { "content-type": "application/json", "authorization": "Bearer " + a.idToken },
        body: JSON.stringify({ fields: {
            chyba: { stringValue: zprava },
            chybaKdy: { timestampValue: new Date().toISOString() }
        } })
    });
}
