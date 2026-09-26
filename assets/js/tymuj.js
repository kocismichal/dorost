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
            userId: String((m.user && m.user.id) || ""),
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

/* ------------------------------------------------- historie odpovědí ---
   Týmuj si u každé odpovědi pamatuje čas a kdo ji zadal (hráč sám, nebo
   trenér za něj). Stahuje se po dvojicích událost × hráč, proto se znovu
   stahují jen události z posledních 14 dní a ty, které v historii chybí.
   Dokument dochazka/historie, pole `data` = JSON:
   { aktualizovano, udalosti: { [idUdalosti]: { [idClena]: [[čas, odpověď, kdo, komentář], …] } } }
   čas = místní čas Týmuj „2026-08-25T13:46:08“, odpověď G/N/M,
   kdo = "" když odpověděl sám hráč, jinak jméno toho, kdo odpověď zadal.
   ------------------------------------------------------------------- */

export const HISTORIE_DOKUMENT = "historie";

export async function nactiHistorii(token, data, predchozi = null, soubezne = 6) {
    const vysledek = { aktualizovano: new Date().toISOString(), udalosti: {} };
    const hranice = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
    const ukoly = [];
    for (const u of data.udalosti) {
        const stara = predchozi && predchozi.udalosti && predchozi.udalosti[u.id];
        if (stara && u.zacatek.slice(0, 10) < hranice) { vysledek.udalosti[u.id] = stara; continue; }
        vysledek.udalosti[u.id] = {};
        for (const h of data.hraci) if (u.ucast[h.id] && h.userId) ukoly.push({ u, h });
    }
    let i = 0;
    const pracovnik = async () => {
        while (i < ukoly.length) {
            const { u, h } = ukoly[i++];
            const r = await volej(`/api/v3/attendances/history?event_id=${u.id}&user_id=${h.userId}`, token);
            const zaznamy = (Array.isArray(r) ? r : [])
                .map(x => [
                    String(x.created_at || "").slice(0, 19),
                    ODPOVED[x.answer] || "",
                    x.create_user && x.user && x.create_user.id !== x.user.id
                        ? `${x.create_user.first_name || ""} ${x.create_user.last_name || ""}`.replace(/\s+/g, " ").trim() : "",
                    String(x.comment || "").trim()
                ])
                .sort((a, b) => a[0].localeCompare(b[0]));
            if (zaznamy.length) vysledek.udalosti[u.id][h.id] = zaznamy;
        }
    };
    await Promise.all(Array.from({ length: soubezne }, pracovnik));
    return { historie: vysledek, stazeno: ukoly.length };
}

/* ------------------------------------------ obecné čtení/zápis dokumentu --- */

async function anonymniToken(apiKey) {
    const a = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ returnSecureToken: true })
    }).then(r => r.json());
    if (!a.idToken) throw new Error("Anonymní přihlášení do Firebase selhalo: " + JSON.stringify(a.error || a));
    return a.idToken;
}
const cestaDat = ({ projectId, appId }) => `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/artifacts/${appId}/public/data`;

/** Přečte JSON z pole `data` dokumentu dochazka/<id>; když není, vrátí null. */
export async function nactiDokument(id, cfg) {
    const t = await anonymniToken(cfg.apiKey);
    const r = await fetch(`${cestaDat(cfg)}/${DOCHAZKA_KOLEKCE}/${id}`, { headers: { authorization: "Bearer " + t } });
    if (r.status === 404) return null;
    const d = await r.json();
    try { return d.fields && d.fields.data ? JSON.parse(d.fields.data.stringValue) : null; } catch { return null; }
}

/** Přepíše dokument dochazka/<id> – pole `data` (JSON) a `aktualizovano`. */
export async function ulozDokument(id, obsah, cfg) {
    const t = await anonymniToken(cfg.apiKey);
    const r = await fetch(`${cestaDat(cfg)}/${DOCHAZKA_KOLEKCE}/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", authorization: "Bearer " + t },
        body: JSON.stringify({ fields: {
            data: { stringValue: JSON.stringify(obsah) },
            aktualizovano: { timestampValue: obsah.aktualizovano || new Date().toISOString() }
        } })
    });
    if (!r.ok) throw new Error(`Zápis dochazka/${id} selhal: ${r.status} ${await r.text()}`);
}

/* ---------------------------------------------------- pokuty z docházky ---
   Pravidla domluvená s Michalem (26. 9. 2026), jen tréninky dorostu:
   - Nepřihlášen do 12:00 (20 Kč): v den tréninku do 12:00 žádná odpověď
     (jde / nejde / možná). Pozdější změna odpovědi nevadí.
   - Neudán důvod nepřítomnosti (10 Kč): výsledně „nejde“ bez komentáře.
   - Splnění tréninkového týdne (−50 Kč): tréninky dorostu + s áčkem ≥ 3.
   Každý zápis má autoKey, aby se nic nezapsalo dvakrát.
   ------------------------------------------------------------------- */

export const POKUTY_VYNECHAT = [/šebesta/i];   // hráči, kterým se pokuty nepíšou
const TRENINKY_DOROSTU = ["T_PO", "T_UT", "T_CT", "T_JINY"];

/** Pondělí týdne (YYYY-MM-DD) podle data v ISO řetězci. */
export function pondeliTydne(iso) {
    const d = new Date(iso.slice(0, 10) + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
}

/** Byl hráč u tréninku přihlášený do 12:00 v den tréninku? (podle historie) */
export function prihlasenVcas(zaznamy, denTreninku) {
    return (zaznamy || []).some(x => x[1] && x[0] < denTreninku + "T12:00:00");
}

/**
 * Pokuty za jeden týden (pondělí = YYYY-MM-DD).
 * Vrací [{ clen, jmeno, typeKey, label, amount, note, createdAt, klic }] – klic
 * je začátek autoKey (id hráče pokutníčku doplní volající).
 */
export function pokutyZaTyden(data, historie, pondeli) {
    const DNY = ["Ne", "Po", "Út", "St", "Čt", "Pá", "So"];
    const den = iso => DNY[new Date(iso.slice(0, 10) + "T12:00:00Z").getUTCDay()] + " " + (+iso.slice(8, 10)) + ". " + (+iso.slice(5, 7)) + ".";
    const nedele = new Date(pondeli + "T12:00:00Z"); nedele.setUTCDate(nedele.getUTCDate() + 6);
    const konec = nedele.toISOString().slice(0, 10);
    const vTydnu = data.udalosti.filter(u => !u.zruseno && pondeliTydne(u.zacatek) === pondeli);
    const out = [];
    const vynechat = h => POKUTY_VYNECHAT.some(re => re.test(h.jmeno));

    for (const u of vTydnu.filter(u => TRENINKY_DOROSTU.includes(u.druh))) {
        const denTr = u.zacatek.slice(0, 10);
        const hu = (historie && historie.udalosti && historie.udalosti[u.id]) || {};
        for (const h of data.hraci) {
            const z = u.ucast[h.id];
            if (!z || vynechat(h)) continue;
            const zaznamy = hu[h.id] || [];
            if (!prihlasenVcas(zaznamy, denTr)) {
                const prvni = zaznamy[0];
                const popis = prvni ? `první odpověď ${den(prvni[0])} ${prvni[0].slice(11, 16)} (${{ G: "jde", N: "nejde", M: "možná" }[prvni[1]] || "?"})${prvni[2] ? " – zadal " + prvni[2] : ""}` : "bez odpovědi";
                out.push({ clen: h.id, jmeno: h.jmeno, typeKey: "neprihlasen", label: "Nepřihlášen do 12:00", amount: 20,
                    note: `Týmuj: ${den(u.zacatek)} ${u.nazev} – ${popis}`, createdAt: new Date(u.zacatek).toISOString(), klic: `neprihlasen|${u.id}` });
            }
            if (z[0] === "N" && !z[1]) {
                out.push({ clen: h.id, jmeno: h.jmeno, typeKey: "duvod_nepritomnosti", label: "Neudán důvod nepřítomnosti", amount: 10,
                    note: `Týmuj: ${den(u.zacatek)} ${u.nazev}`, createdAt: new Date(u.zacatek).toISOString(), klic: `duvod|${u.id}` });
            }
        }
    }

    for (const h of data.hraci) {
        if (vynechat(h)) continue;
        let d = 0, a = 0;
        for (const u of vTydnu) {
            const z = u.ucast[h.id];
            if (!z || z[0] !== "G") continue;
            if (TRENINKY_DOROSTU.includes(u.druh)) d++;
            else if (u.druh === "T_A") a++;
        }
        if (d + a >= 3) {
            out.push({ clen: h.id, jmeno: h.jmeno, typeKey: "trenink_tyden", label: "Splnění tréninkového týdne", amount: -50,
                note: `Týmuj: týden ${den(pondeli).slice(3)}–${den(konec).slice(3)} (dorost ${d}${a ? ", s áčkem " + a : ""})`,
                createdAt: konec + "T18:00:00Z", klic: `tyden|${pondeli}` });
        }
    }
    return out;
}
