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
} from "./core.js?v=6";

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

/** Zápasy odshora od nejnovějšího – rozhoduje datum zápasu, ne kdy se zapsal. */
function matchesByDate() {
    return state.matches.slice().sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
}

const goalsOfMatch = (matchId) => state.goals.filter(g => g.matchId === matchId);

/* ------------------------------------------------------------ tabulka ---- */

function standings() {
    const rows = allPlayers().map(p => ({ ...p, goals: 0, assists: 0 }));
    const byId = new Map(rows.map(r => [r.id, r]));

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
                    ${r.guest ? `<span class="tag">host</span>` : ""}
                </td>
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

function renderMatches() {
    const host = document.getElementById("matchList");
    const list = matchesByDate();

    if (!list.length) {
        host.innerHTML = `<div class="mcard mcard--empty">
            Zatím není zapsaný žádný zápas. Po přihlášení ho přidáš tlačítkem <b>+ Přidat zápas</b>.
        </div>`;
        updateAuthUI();
        return;
    }

    host.innerHTML = list.map(m => {
        const goals = goalsOfMatch(m.id);
        const res = m.goalsFor > m.goalsAgainst ? "win" : m.goalsFor < m.goalsAgainst ? "loss" : "draw";
        const resLabel = res === "win" ? "výhra" : res === "loss" ? "prohra" : "remíza";

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

        return `
        <div class="mcard">
            <div class="mcard__head">
                <div>
                    <div class="mcard__opponent">${esc(m.opponent)}</div>
                    <div class="mcard__meta">${czDay(m.date)} · ${m.venue === "doma" ? "doma" : "venku"}</div>
                </div>
                <div class="mcard__score mcard__score--${res}">
                    <b>${m.goalsFor}:${m.goalsAgainst}</b>
                    <span>${resLabel}</span>
                </div>
            </div>
            <div class="mcard__body">
                ${goalRows}
                ${missing > 0 ? `<div class="mcard__warn">Chybí rozepsat ${missing} ${missing === 1 ? "branku" : missing < 5 ? "branky" : "branek"} ze skóre.</div>` : ""}
            </div>
            <div class="mcard__admin admin-only" hidden>
                <button type="button" class="btn btn--ok btn--sm" data-addgoal="${m.id}">+ Přidat branku</button>
                <button type="button" class="mcard__remove" data-delmatch="${m.id}">Smazat zápas</button>
            </div>
        </div>`;
    }).join("");

    host.querySelectorAll("[data-addgoal]").forEach(btn => {
        btn.addEventListener("click", () => openGoalModal(btn.dataset.addgoal));
    });
    host.querySelectorAll("[data-goal]").forEach(btn => {
        btn.addEventListener("click", () => onDeleteGoal(btn.dataset.goal));
    });
    host.querySelectorAll("[data-delmatch]").forEach(btn => {
        btn.addEventListener("click", () => onDeleteMatch(btn.dataset.delmatch));
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
    document.getElementById("addMatchBtn").addEventListener("click", () => {
        document.getElementById("matchForm").reset();
        // výchozí datum = dnešek, ať se nemusí klikat v kalendáři
        document.getElementById("matchDate").value = new Date().toISOString().slice(0, 10);
        document.getElementById("matchErr").classList.remove("is-on");
        openOverlay("matchOverlay");
    });

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

        try {
            await addDoc(col("matches"), {
                opponent, date, venue, goalsFor, goalsAgainst,
                addedBy: AdminStore.name, createdAt: serverTimestamp()
            });
            closeOverlays();
            toast(`Zápas s ${opponent} přidán`);
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
