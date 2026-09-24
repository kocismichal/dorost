/* ==========================================================================
   FK AGRO VNOROVY – DOROST · Kanadské body
   Zápasy, branky a asistence. Gól i asistence = 1 bod.
   Firebase, přihlášení a soupiska jsou ve sdíleném jádru (core.js).
   ========================================================================== */

import {
    addDoc, deleteDoc, setDoc, onSnapshot, serverTimestamp, query, orderBy
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

import {
    col, docIn, whenReady, onDbError, setStatus,
    roster, onRoster, slug,
    AdminStore, isAdmin, initAuth, updateAuthUI,
    esc, czDay, closeOverlays, openOverlay, toast
} from "./core.js?v=9";

import { ROZPIS } from "./rozpis-dorost.js?v=10";

/* ------------------------------------------------------------- stav ----
   guests = hráči mimo soupisku dorostu (starší žáci, co vypomůžou).
   Žijí jen tady, do pokutníčku nezasahují.
   ------------------------------------------------------------------- */

const state = { matches: [], goals: [], guests: [] };

whenReady(() => {
    onSnapshot(query(col("matches"), orderBy("createdAt", "desc")), (snap) => {
        state.matches = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        setStatus("online");
        renderAll();
    }, onDbError);

    onSnapshot(query(col("goals"), orderBy("createdAt")), (snap) => {
        state.goals = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        renderAll();
    }, onDbError);

    onSnapshot(query(col("guests"), orderBy("order")), (snap) => {
        state.guests = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        renderAll();
    }, onDbError);
});

onRoster(() => renderAll());

/** Soupiska dorostu + hostující hráči dohromady, pro tabulku i výběr v modalu. */
function allPlayers() {
    return [
        ...roster().map(p => ({ id: p.id, name: p.name, guest: false })),
        ...state.guests.map(g => ({ id: g.id, name: g.name, guest: true }))
    ];
}

const playerName = (id) => allPlayers().find(p => p.id === id)?.name;

const goalsOfMatch = (matchId) => state.goals.filter(g => g.matchId === matchId);

/* ------------------------------------------------------------ tabulka ---- */

function standings() {
    const rows = allPlayers().map(p => ({ ...p, games: 0, goals: 0, assists: 0 }));
    const byId = new Map(rows.map(r => [r.id, r]));

    // odehrané zápasy = kolikrát je hráč v sestavě (základ i střídání)
    state.matches.forEach(m => (m.lineup || []).forEach(l => {
        const r = byId.get(l.id);
        if (r) r.games++;
    }));

    state.goals.forEach(g => {
        const scorer = byId.get(g.scorerId);
        if (scorer) scorer.goals++;
        const assist = g.assistId ? byId.get(g.assistId) : null;
        if (assist) assist.assists++;
    });

    rows.forEach(r => { r.points = r.goals + r.assists; });
    rows.sort((a, b) =>
        b.points - a.points ||
        b.goals - a.goals ||
        a.name.localeCompare(b.name, "cs")
    );
    return rows;
}

function renderTable() {
    const table = document.getElementById("pointsTable");
    const rows = standings();

    if (!rows.length) {
        table.innerHTML = `<tbody><tr><td class="archive__empty">Na soupisce zatím není nikdo.</td></tr></tbody>`;
        return;
    }

    /* Pořadí dostanou jen hráči, kteří už nějaký bod mají – ať se nečísluje
       půlka tabulky s nulami. Při shodě bodů i gólů sdílí stejné pořadí. */
    let rank = 0, prevKey = null;
    rows.forEach((r, i) => {
        if (!r.points) { r.rank = null; return; }
        const key = r.points + "|" + r.goals;
        if (key !== prevKey) { rank = i + 1; prevKey = key; }
        r.rank = rank;
    });

    table.innerHTML = `
        <thead><tr>
            <th class="ptable__rank">#</th>
            <th>Hráč</th>
            <th class="ptable__num" title="Odehrané zápasy (podle zapsaných sestav)">Zápasy</th>
            <th class="ptable__num">Góly</th>
            <th class="ptable__num">Asistence</th>
            <th class="ptable__num">Body</th>
            <th class="ptable__act admin-only" hidden></th>
        </tr></thead>
        <tbody>
        ${rows.map(r => `
            <tr class="${r.points ? "" : "ptable__row--zero"}">
                <td class="ptable__rank">${r.rank ?? "–"}</td>
                <td>
                    ${esc(r.name)}
                    ${r.guest ? `<span class="tag">st. žák</span>` : ""}
                </td>
                <td class="ptable__num">${r.games}</td>
                <td class="ptable__num">${r.goals}</td>
                <td class="ptable__num">${r.assists}</td>
                <td class="ptable__num ptable__points">${r.points}</td>
                <td class="ptable__act admin-only" hidden>
                    ${r.guest ? `<button type="button" class="archive__del" data-guest="${r.id}" title="Odebrat hostujícího hráče">✕</button>` : ""}
                </td>
            </tr>`).join("")}
        </tbody>`;

    table.querySelectorAll("[data-guest]").forEach(btn => {
        btn.addEventListener("click", () => onRemoveGuest(btn.dataset.guest));
    });
}

/* ------------------------------------------------------------- zápasy ---- */

/* Rozpis soutěže (rozpis-dorost.js) a zapsané zápasy dohromady.
   Zápas patří k termínu z rozpisu přes fixtureId. Zápasy zapsané ručně
   ještě před rozpisem ho nemají – ty se k termínu přiřadí podle data,
   ať se nic nezdvojí. Co k rozpisu nepatří (přátelák), jde zvlášť. */
function matchCards() {
    const used = new Set();
    const cards = ROZPIS.map(f => {
        const m = state.matches.find(x => x.fixtureId === f.id)
            || state.matches.find(x => !x.fixtureId && x.date === f.date && !used.has(x.id));
        if (m) used.add(m.id);
        return { fixture: f, match: m || null, date: m?.date || f.date };
    });
    state.matches
        .filter(m => !used.has(m.id))
        .forEach(m => cards.push({ fixture: null, match: m, date: m.date || "" }));
    return cards;
}

const todayIso = () => new Date().toLocaleDateString("sv-SE");   // YYYY-MM-DD v místním čase
const venueLabel = (v) => v === "doma" ? "doma" : "venku";

function playedCard({ fixture, match: m }) {
    const goals = goalsOfMatch(m.id);
    const res = m.goalsFor > m.goalsAgainst ? "win" : m.goalsFor < m.goalsAgainst ? "loss" : "draw";
    const resLabel = res === "win" ? "výhra" : res === "loss" ? "prohra" : "remíza";

    /* Skóre se píše klasicky od domácích – venku tedy soupeř první.
       Výhra/prohra i barva se ale pořád berou z našeho pohledu. */
    const score = m.venue === "venku"
        ? `${m.goalsAgainst}:${m.goalsFor}`
        : `${m.goalsFor}:${m.goalsAgainst}`;

    const goalRows = goals.length
        ? goals.map((g, i) => `
            <div class="grow">
                <span class="grow__no">${i + 1}.</span>
                <span class="grow__scorer">${esc(g.scorerName)}</span>
                ${g.assistName ? `<span class="grow__assist">asistence ${esc(g.assistName)}</span>` : ""}
                <button type="button" class="archive__del admin-only" hidden data-goal="${g.id}" title="Smazat branku">✕</button>
            </div>`).join("")
        : `<div class="pcard__empty">Branky zatím nejsou rozepsané.</div>`;

    /* Zapsané branky nemusí sedět se skóre – vlastní gól soupeře nebo
       zápis, co ještě nikdo nedoplnil. Radši to řekneme nahlas. */
    const missing = (m.goalsFor || 0) - goals.length;

    const lineup = m.lineup || [];
    const names = (role) => lineup.filter(l => l.role === role).map(l => esc(l.name)).join(", ");
    const lineupRows = lineup.length ? `
        <div class="mlineup">
            ${names("start") ? `<div><span class="mlineup__lbl">Základ</span>${names("start")}</div>` : ""}
            ${names("sub") ? `<div><span class="mlineup__lbl">Střídali</span>${names("sub")}</div>` : ""}
        </div>` : "";

    return `
    <div class="mcard">
        <div class="mcard__head">
            <div>
                <div class="mcard__opponent">${esc(m.opponent)}</div>
                <div class="mcard__meta">${czDay(m.date)} · ${venueLabel(m.venue)}${fixture ? "" : ` <span class="tag">mimo soutěž</span>`}</div>
            </div>
            <div class="mcard__score mcard__score--${res}">
                <b>${score}</b>
                <span>${resLabel}</span>
            </div>
        </div>
        <div class="mcard__body">
            ${goalRows}
            ${missing > 0 ? `<div class="mcard__warn">Chybí rozepsat ${missing} ${missing === 1 ? "branku" : missing < 5 ? "branky" : "branek"} ze skóre.</div>` : ""}
            ${lineupRows}
        </div>
        <div class="mcard__admin admin-only" hidden>
            <button type="button" class="btn btn--ok btn--sm" data-addgoal="${m.id}">+ Přidat branku</button>
            <button type="button" class="btn btn--ghost btn--sm" data-lineup="${m.id}">Sestava</button>
            <button type="button" class="btn btn--ghost btn--sm" data-editmatch="${m.id}" data-fixture="${fixture?.id || ""}">Upravit</button>
            <button type="button" class="mcard__remove" data-delmatch="${m.id}">${fixture ? "Smazat výsledek" : "Smazat zápas"}</button>
        </div>
    </div>`;
}

/** Termín z rozpisu, ke kterému ještě není zapsaný výsledek. */
function fixtureCard({ fixture: f }, overdue) {
    return `
    <div class="mcard mcard--todo">
        <div class="mcard__head">
            <div>
                <div class="mcard__opponent">${esc(f.opponent)}</div>
                <div class="mcard__meta">${czDay(f.date)} · ${f.time} · ${venueLabel(f.venue)}</div>
            </div>
            <div class="mcard__score mcard__score--todo">
                <b>–:–</b>
                <span>${overdue ? "chybí výsledek" : "nehráno"}</span>
            </div>
        </div>
        <div class="mcard__body">
            <div class="pcard__empty">${overdue
                ? "Výsledek zatím není zapsaný."
                : "Zápas se teprve hraje – výsledek a branky se zapíšou po něm."}</div>
        </div>
        <div class="mcard__admin admin-only" hidden>
            <button type="button" class="btn btn--primary btn--sm" data-result="${f.id}">Zapsat výsledek</button>
        </div>
    </div>`;
}

function renderMatches() {
    const host = document.getElementById("matchList");
    const today = todayIso();
    const cards = matchCards();

    /* Nahoře odehrané (a ty, co už se hrály, ale chybí jim výsledek) od
       nejnovějšího, pod nimi zbytek rozpisu v pořadí, jak se bude hrát. */
    const played = cards.filter(c => c.match || c.date <= today)
        .sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const upcoming = cards.filter(c => !c.match && c.date > today)
        .sort((a, b) => a.date.localeCompare(b.date));

    const card = (c) => c.match ? playedCard(c) : fixtureCard(c, c.date <= today);

    host.innerHTML =
        (played.length ? played.map(card).join("") : `<div class="mcard mcard--empty">Zatím se nehrál žádný zápas.</div>`)
        + (upcoming.length ? `<h3 class="matchlist__sub">Zbývá odehrát</h3>` + upcoming.map(card).join("") : "");

    host.querySelectorAll("[data-addgoal]").forEach(btn => {
        btn.addEventListener("click", () => openGoalModal(btn.dataset.addgoal));
    });
    host.querySelectorAll("[data-goal]").forEach(btn => {
        btn.addEventListener("click", () => onDeleteGoal(btn.dataset.goal));
    });
    host.querySelectorAll("[data-delmatch]").forEach(btn => {
        btn.addEventListener("click", () => onDeleteMatch(btn.dataset.delmatch));
    });
    host.querySelectorAll("[data-result]").forEach(btn => {
        btn.addEventListener("click", () => openMatchModal({ fixtureId: btn.dataset.result }));
    });
    host.querySelectorAll("[data-lineup]").forEach(btn => {
        btn.addEventListener("click", () => openLineupModal(btn.dataset.lineup));
    });
    host.querySelectorAll("[data-editmatch]").forEach(btn => {
        btn.addEventListener("click", () => openMatchModal({ editId: btn.dataset.editmatch, fixtureId: btn.dataset.fixture }));
    });
    updateAuthUI();
}

function renderAll() {
    renderTable();
    renderMatches();
    updateAuthUI();
}

/* ---------------------------------------------------------------- akce ---- */

async function onDeleteGoal(id) {
    if (!isAdmin()) return;
    const g = state.goals.find(x => x.id === id);
    if (!g) return;
    if (!confirm(`Smazat branku – ${g.scorerName}?`)) return;
    try {
        await deleteDoc(docIn("goals", id));
        toast("Branka smazána");
    } catch (err) {
        console.error(err);
        toast("Smazání se nepovedlo.");
    }
}

async function onDeleteMatch(id) {
    if (!isAdmin()) return;
    const m = state.matches.find(x => x.id === id);
    if (!m) return;
    const goals = goalsOfMatch(id);
    const warning = goals.length
        ? `\n\nSmažou se i ${goals.length} zapsané branky – body za ně hráčům odejdou.`
        : "";
    if (!confirm(`Smazat zápas se soupeřem ${m.opponent}?${warning}`)) return;

    try {
        /* Branky patří k zápasu – bez něj by zůstaly viset v databázi
           a pořád se počítaly do tabulky, tak jdou pryč s ním. */
        for (const g of goals) await deleteDoc(docIn("goals", g.id));
        await deleteDoc(docIn("matches", id));
        toast("Zápas smazán");
    } catch (err) {
        console.error(err);
        toast("Smazání se nepovedlo.");
    }
}

async function onRemoveGuest(id) {
    if (!isAdmin()) return;
    const g = state.guests.find(x => x.id === id);
    if (!g) return;
    if (!confirm(`Odebrat hostujícího hráče ${g.name}?\n\nJeho zapsané branky zůstanou u zápasů, ale zmizí z tabulky.`)) return;
    try {
        await deleteDoc(docIn("guests", id));
        toast(`${g.name} odebrán`);
    } catch (err) {
        console.error(err);
        toast("Odebrání se nepovedlo.");
    }
}

/* --------------------------------------------------------------- modaly ---- */

function playerOptions(placeholder) {
    const home = roster().map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join("");
    const guests = state.guests.map(g => `<option value="${g.id}">${esc(g.name)}</option>`).join("");
    return (placeholder ? `<option value="">${placeholder}</option>` : "")
        + (home ? `<optgroup label="Soupiska dorostu">${home}</optgroup>` : "")
        + (guests ? `<optgroup label="Hostující hráči">${guests}</optgroup>` : "");
}

/* Jeden modal na tři věci: výsledek k termínu z rozpisu (předvyplněný),
   úprava už zapsaného výsledku a ruční přidání zápasu mimo rozpis. */
function openMatchModal({ editId = "", fixtureId = "" } = {}) {
    if (!isAdmin()) return;
    const overlay = document.getElementById("matchOverlay");
    const m = editId ? state.matches.find(x => x.id === editId) : null;
    const f = fixtureId ? ROZPIS.find(x => x.id === fixtureId) : null;
    if (editId && !m) return;

    document.getElementById("matchForm").reset();
    overlay.dataset.editId = editId;
    overlay.dataset.fixtureId = f ? f.id : "";

    const src = m || f;
    document.getElementById("matchOpponent").value = src?.opponent || "";
    // výchozí datum = dnešek, ať se nemusí klikat v kalendáři
    document.getElementById("matchDate").value = src?.date || new Date().toISOString().slice(0, 10);
    document.getElementById("matchVenue").value = src?.venue || "doma";
    document.getElementById("matchFor").value = m ? m.goalsFor : "";
    document.getElementById("matchAgainst").value = m ? m.goalsAgainst : "";

    document.getElementById("matchTitle").textContent =
        m ? "Upravit výsledek" : f ? "Zapsat výsledek" : "Přidat zápas mimo rozpis";
    document.getElementById("matchSubmit").textContent = m ? "Uložit" : f ? "Zapsat výsledek" : "Přidat zápas";
    document.getElementById("matchErr").classList.remove("is-on");
    openOverlay("matchOverlay");
    if (f && !m) setTimeout(() => document.getElementById("matchFor").focus(), 50);
}

/* Sestava: u každého hráče nehrál / základ / střídal. Hráči, co už ze
   soupisky zmizeli, ale v sestavě jsou, zůstanou v seznamu, ať se neztratí. */
const ROLES = [["", "–", "nehrál"], ["start", "Z", "základ"], ["sub", "S", "střídal"]];

function openLineupModal(matchId) {
    if (!isAdmin()) return;
    const m = state.matches.find(x => x.id === matchId);
    if (!m) return;

    const overlay = document.getElementById("lineupOverlay");
    overlay.dataset.matchId = matchId;
    document.getElementById("lineupMatchName").textContent =
        `${m.opponent} · ${czDay(m.date)} (${venueLabel(m.venue)})`;

    const roleOf = new Map((m.lineup || []).map(l => [l.id, l.role]));
    const players = allPlayers();
    (m.lineup || []).forEach(l => {
        if (!players.some(p => p.id === l.id)) players.push({ id: l.id, name: l.name, guest: false });
    });

    document.getElementById("lineupList").innerHTML = players.map(p => `
        <div class="lrow" data-id="${p.id}" data-name="${esc(p.name)}">
            <span class="lrow__name">${esc(p.name)}${p.guest ? `<span class="tag">st. žák</span>` : ""}</span>
            <span class="lrow__seg">
                ${ROLES.map(([role, short, title]) => `
                    <label title="${title}">
                        <input type="radio" name="l-${p.id}" value="${role}" ${(roleOf.get(p.id) || "") === role ? "checked" : ""}>
                        <span>${short}</span>
                    </label>`).join("")}
            </span>
        </div>`).join("");

    document.getElementById("lineupErr").classList.remove("is-on");
    updateLineupCount();
    openOverlay("lineupOverlay");
}

function readLineup() {
    return [...document.querySelectorAll("#lineupList .lrow")].map(row => ({
        id: row.dataset.id,
        name: row.dataset.name,
        role: row.querySelector("input:checked")?.value || ""
    })).filter(l => l.role);
}

function updateLineupCount() {
    const l = readLineup();
    document.getElementById("lineupCount").textContent =
        `Základ ${l.filter(x => x.role === "start").length} · střídali ${l.filter(x => x.role === "sub").length}`;
}

function openGoalModal(matchId) {
    if (!isAdmin()) return;
    const m = state.matches.find(x => x.id === matchId);
    if (!m) return;

    const overlay = document.getElementById("goalOverlay");
    overlay.dataset.matchId = matchId;
    document.getElementById("goalMatchName").textContent =
        `${m.opponent} · ${czDay(m.date)} (${m.venue === "doma" ? "doma" : "venku"})`;
    document.getElementById("goalScorer").innerHTML = playerOptions("— vyber střelce —");
    document.getElementById("goalAssist").innerHTML = playerOptions("— bez asistence —");
    document.getElementById("goalErr").classList.remove("is-on");
    openOverlay("goalOverlay");
}

/* --------------------------------------------------------------- init ---- */

document.addEventListener("DOMContentLoaded", () => {
    renderAll();
    initAuth(renderAll);

    /* ----------------------------------------------------------- zápas -- */
    document.getElementById("addMatchBtn").addEventListener("click", () => openMatchModal());

    document.getElementById("matchForm").addEventListener("submit", async (e) => {
        e.preventDefault();
        const err = document.getElementById("matchErr");
        const opponent = document.getElementById("matchOpponent").value.trim();
        const date = document.getElementById("matchDate").value;
        const venue = document.getElementById("matchVenue").value;
        const goalsFor = parseInt(document.getElementById("matchFor").value, 10);
        const goalsAgainst = parseInt(document.getElementById("matchAgainst").value, 10);

        if (!opponent) { err.textContent = "Zadej soupeře."; err.classList.add("is-on"); return; }
        if (!date) { err.textContent = "Zadej datum zápasu."; err.classList.add("is-on"); return; }
        if (!Number.isInteger(goalsFor) || !Number.isInteger(goalsAgainst) || goalsFor < 0 || goalsAgainst < 0) {
            err.textContent = "Zadej výsledek – obě čísla."; err.classList.add("is-on"); return;
        }

        const overlay = document.getElementById("matchOverlay");
        const { editId, fixtureId } = overlay.dataset;
        const data = { opponent, date, venue, goalsFor, goalsAgainst };
        if (fixtureId) data.fixtureId = fixtureId;

        try {
            if (editId) {
                await setDoc(docIn("matches", editId), { ...data, editedBy: AdminStore.name }, { merge: true });
                toast("Výsledek upraven");
            } else if (fixtureId) {
                // id termínu jako id dokumentu – dvojí zápis téhož zápasu se tak nezdvojí
                await setDoc(docIn("matches", fixtureId), {
                    ...data, addedBy: AdminStore.name, createdAt: serverTimestamp()
                });
                toast(`Výsledek s ${opponent} zapsán`);
            } else {
                await addDoc(col("matches"), {
                    ...data, addedBy: AdminStore.name, createdAt: serverTimestamp()
                });
                toast(`Zápas s ${opponent} přidán`);
            }
            closeOverlays();
        } catch (ex) {
            console.error(ex);
            err.textContent = "Uložení se nepovedlo – zkontroluj připojení.";
            err.classList.add("is-on");
        }
    });

    /* ---------------------------------------------------------- branka -- */
    document.getElementById("goalForm").addEventListener("submit", async (e) => {
        e.preventDefault();
        const overlay = document.getElementById("goalOverlay");
        const err = document.getElementById("goalErr");
        const scorerId = document.getElementById("goalScorer").value;
        const assistId = document.getElementById("goalAssist").value;

        if (!scorerId) { err.textContent = "Vyber střelce."; err.classList.add("is-on"); return; }
        if (assistId && assistId === scorerId) {
            err.textContent = "Střelec si nemůže přihrát sám."; err.classList.add("is-on"); return;
        }

        try {
            await addDoc(col("goals"), {
                matchId: overlay.dataset.matchId,
                scorerId, scorerName: playerName(scorerId),
                assistId: assistId || null,
                assistName: assistId ? playerName(assistId) : null,
                addedBy: AdminStore.name, createdAt: serverTimestamp()
            });
            closeOverlays();
            toast("Branka zapsána");
        } catch (ex) {
            console.error(ex);
            err.textContent = "Uložení se nepovedlo – zkontroluj připojení.";
            err.classList.add("is-on");
        }
    });

    /* --------------------------------------------------------- sestava -- */
    document.getElementById("lineupList").addEventListener("change", updateLineupCount);

    document.getElementById("lineupForm").addEventListener("submit", async (e) => {
        e.preventDefault();
        const err = document.getElementById("lineupErr");
        const matchId = document.getElementById("lineupOverlay").dataset.matchId;
        try {
            await setDoc(docIn("matches", matchId), {
                lineup: readLineup(), lineupBy: AdminStore.name
            }, { merge: true });
            closeOverlays();
            toast("Sestava uložena");
        } catch (ex) {
            console.error(ex);
            err.textContent = "Uložení se nepovedlo – zkontroluj připojení.";
            err.classList.add("is-on");
        }
    });

    /* -------------------------------------------------- hostující hráč -- */
    document.getElementById("addGuestBtn").addEventListener("click", () => {
        document.getElementById("guestName").value = "";
        document.getElementById("guestErr").classList.remove("is-on");
        openOverlay("guestOverlay");
        setTimeout(() => document.getElementById("guestName").focus(), 50);
    });

    document.getElementById("guestForm").addEventListener("submit", async (e) => {
        e.preventDefault();
        const err = document.getElementById("guestErr");
        const name = document.getElementById("guestName").value.trim();
        const id = slug(name);

        if (!id) { err.textContent = "Zadej jméno hráče."; err.classList.add("is-on"); return; }
        if (allPlayers().some(p => p.id === id)) {
            err.textContent = "Hráč s tímto jménem už tady je."; err.classList.add("is-on"); return;
        }

        try {
            const order = state.guests.reduce((max, g) => Math.max(max, g.order ?? 0), -1) + 1;
            await setDoc(docIn("guests", id), { name, order });
            closeOverlays();
            toast(`${name} přidán jako hostující hráč`);
        } catch (ex) {
            console.error(ex);
            err.textContent = "Přidání se nepovedlo.";
            err.classList.add("is-on");
        }
    });
});
