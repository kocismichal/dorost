/* ==========================================================================
   FK AGRO VNOROVY – DOROST · Pokutníček
   Zápis a přehled pokut. Firebase, přihlášení a soupiska jsou ve sdíleném
   jádru (core.js), tady žije jen to, co se týká pokut.
   ========================================================================== */

import {
    addDoc, deleteDoc, setDoc, onSnapshot, serverTimestamp, query, orderBy
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

import {
    col, docIn, whenReady, onDbError, setStatus,
    roster, playerById, saveDefaultRoster, nextRosterOrder, slug,
    AdminStore, isAdmin, initAuth, updateAuthUI,
    esc, money, czDateTime, closeOverlays, openOverlay, toast
} from "./core.js?v=6";

/* --------------------------------------------------------- druhy pokut ---
   perMinute: při kliknutí se zeptá na počet minut, částka = amount * minuty
   custom:    otevře modal na částku + důvod (položka „Ostatní“)
   ------------------------------------------------------------------- */

const FINE_TYPES = [
    { key: "trenink_pozde", label: "Pozdní příchod na trénink", desc: "Trénink 5 minut před začátkem na hřišti", amount: 10, btn: "Pozdní příchod - trénink" },
    { key: "zapas_pozde", label: "Pozdní příchod na zápas", desc: "10 Kč za každou minutu", amount: 10, perMinute: true, btn: "Pozdní příchod - zápas" },
    { key: "neprihlasen", label: "Nepřihlášen do 12:00", amount: 20, btn: "Nepřihlášení" },
    { key: "duvod_nepritomnosti", label: "Neudán důvod nepřítomnosti", amount: 10, btn: "Důvod nepřítomnosti" },
    { key: "balon", label: "Překopnutý balon přes plot/síť", amount: 10, btn: "Balon přes plot" },
    { key: "sprosta_slova", label: "Sprostá slova", amount: 10, btn: "Sprostá slova" },
    { key: "zluta_karta", label: "Žlutá karta za kecy, oplácení a nesportovní chování", amount: 50, btn: "Žlutá karta - chování" },
    { key: "cervena_karta", label: "Červená karta", amount: 50, btn: "Červená karta" },
    { key: "zivotosprava", label: "Životospráva", amount: 50, btn: "Životospráva" },
    { key: "mobil", label: "Mobil v ruce před zápasem po čase srazu", amount: 20, btn: "Mobil" }
];
const DEDUCTION = { key: "trenink_tyden", label: "Splnění tréninkového týdne", desc: "3 tréninky týdně", amount: -50, btn: "Tréninkový týden" };
const OTHER_KEY = "ostatni";

/** Kolik posledních pohybů se ukáže v detailu hráče. */
const DETAIL_LIMIT = 10;

const fineByKey = (key) => FINE_TYPES.find(f => f.key === key) || (key === DEDUCTION.key ? DEDUCTION : null);

/** Popis položky tak, jak se má ukázat v přehledu (u „Ostatní“ i s důvodem). */
const fineLabel = (f) => f.typeKey === OTHER_KEY ? ("Ostatní – " + (f.note || "bez popisu")) : f.label;

/* ------------------------------------------------------------- stav ---- */

const state = { fines: [] };

whenReady(() => {
    onSnapshot(query(col("fines"), orderBy("createdAt", "desc")), (snapshot) => {
        state.fines = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        setStatus("online");
        renderAll();
    }, onDbError);
});

/* ------------------------------------------------------------- výpočet ---- */

function sumsForPlayer(playerId) {
    const mine = state.fines.filter(f => f.playerId === playerId);

    // rozpis – kolik dohromady za každou položku
    const rows = new Map();
    mine.forEach(f => {
        const key = f.typeKey === OTHER_KEY ? (OTHER_KEY + "|" + (f.note || "")) : f.typeKey;
        const prev = rows.get(key) || { label: fineLabel(f), amount: 0 };
        prev.amount += f.amount;
        rows.set(key, prev);
    });

    /* Bilance je prostý součet všeho – na pořadí zápisů nezáleží, odečet
       se hráči veze dál a umazává i pokuty, které přijdou až po něm.
       Na kartě se ale mínus neukazuje: dluh spadne na nulu a přeplatek
       se vypíše zvlášť jako kredit na příští pokuty. */
    const balance = mine.reduce((sum, f) => sum + f.amount, 0);
    const total = Math.max(balance, 0);
    const credit = balance < 0 ? -balance : 0;

    const list = Array.from(rows.values());
    if (credit > 0) list.push({
        label: "K dobru na příští pokuty", amount: -credit, muted: true,
        display: credit.toLocaleString("cs-CZ") + " Kč"
    });

    const weeks = mine.filter(f => f.typeKey === DEDUCTION.key).length;
    return { rows: list, total, weeks, count: mine.length };
}

/* --------------------------------------------------------------- render ---- */

function renderCatalog() {
    const host = document.getElementById("catalogList");
    const rows = FINE_TYPES.map(f => `
        <div class="catalog__row">
            <div>
                <div class="catalog__name">${esc(f.label)}</div>
                ${f.desc ? `<div class="catalog__desc">${esc(f.desc)}</div>` : ""}
            </div>
            <div class="catalog__amount">${f.amount} Kč${f.perMinute ? "/minuta" : ""}</div>
        </div>
    `).join("") + `
        <div class="catalog__row catalog__row--deduct">
            <div>
                <div class="catalog__name">${esc(DEDUCTION.label)}</div>
                <div class="catalog__desc">${esc(DEDUCTION.desc)}</div>
            </div>
            <div class="catalog__amount">${DEDUCTION.amount} Kč</div>
        </div>
        <div class="catalog__row">
            <div>
                <div class="catalog__name">Ostatní</div>
                <div class="catalog__desc">Jiný prohřešek – částka a důvod se zapíší ručně</div>
            </div>
            <div class="catalog__amount">dle zápisu</div>
        </div>
    `;
    host.innerHTML = rows;
}

function renderPlayers() {
    const host = document.getElementById("playerGrid");
    const list = roster();

    if (!list.length) {
        host.innerHTML = `<div class="pcard" style="padding:26px;text-align:center;color:var(--muted);font-size:13.5px">
            Na soupisce zatím není nikdo. Po přihlášení přidej hráče tlačítkem <b>+ Přidat hráče</b>.
        </div>`;
        updateAuthUI();
        return;
    }

    host.innerHTML = list.map(p => {
        const { rows, total, weeks, count } = sumsForPlayer(p.id);
        const breakdown = rows.length
            ? rows.map(r => `
                <div class="brow${r.muted ? " brow--muted" : ""}">
                    <span class="brow__label">${esc(r.label)}</span>
                    <span class="brow__amount${r.amount < 0 ? " brow__amount--ok" : ""}">${r.display || money(r.amount)}</span>
                </div>`).join("")
            : `<div class="pcard__empty">Zatím žádné pokuty</div>`;

        const fineBtns = FINE_TYPES.map(f => `
            <button type="button" class="finebtn" data-player="${p.id}" data-type="${f.key}">
                ${esc(f.btn)}
                <span class="finebtn__amount">${f.amount} Kč${f.perMinute ? "/min" : ""}</span>
            </button>`).join("");

        return `
        <div class="pcard">
            <div class="pcard__head">
                <div class="pcard__avatar" title="Splněné tréninkové týdny: ${weeks}">${weeks}</div>
                <div class="pcard__name">${esc(p.name)}</div>
                <div class="pcard__total${total <= 0 ? " pcard__total--zero" : ""}">
                    <b>${total === 0 ? "0 Kč" : money(total)}</b>
                    <span>celkem</span>
                </div>
            </div>
            <div class="pcard__body">
                <div class="pcard__breakdown">${breakdown}</div>
                ${count ? `<button type="button" class="pcard__detail" data-detail="${p.id}">
                    Poslední zápisy →
                </button>` : ""}
            </div>
            <div class="pcard__admin admin-only" hidden>
                <div class="finebtns">
                    ${fineBtns}
                    <button type="button" class="finebtn finebtn--ok" data-player="${p.id}" data-type="${DEDUCTION.key}">
                        ${esc(DEDUCTION.btn)} <span class="finebtn__amount">${DEDUCTION.amount} Kč</span>
                    </button>
                    <button type="button" class="finebtn finebtn--other" data-player="${p.id}" data-type="${OTHER_KEY}">
                        + Jiná pokuta (Ostatní)
                    </button>
                </div>
                <button type="button" class="pcard__remove" data-remove="${p.id}">Odebrat hráče ze soupisky</button>
            </div>
        </div>`;
    }).join("");

    host.querySelectorAll(".finebtn").forEach(btn => {
        btn.addEventListener("click", () => onFineClick(btn.dataset.player, btn.dataset.type));
    });
    host.querySelectorAll("[data-remove]").forEach(btn => {
        btn.addEventListener("click", () => onRemovePlayer(btn.dataset.remove));
    });
    host.querySelectorAll("[data-detail]").forEach(btn => {
        btn.addEventListener("click", () => openDetail(btn.dataset.detail));
    });
    updateAuthUI();
}

/* ------------------------------------------------------- detail hráče ----
   Posledních pár pohybů i s datem – vidí je každý, i nepřihlášený.
   Zápisy jdou z databáze seřazené od nejnovějšího, takže stačí useknout.
   ------------------------------------------------------------------- */

function openDetail(playerId) {
    const player = playerById(playerId);
    if (!player) return;

    const mine = state.fines.filter(f => f.playerId === playerId);
    const { total } = sumsForPlayer(playerId);

    document.getElementById("detailPlayerName").textContent = player.name;
    document.getElementById("detailSummary").innerHTML = mine.length > DETAIL_LIMIT
        ? `Posledních ${DETAIL_LIMIT} z celkem ${mine.length} zápisů · aktuálně dluží <b>${total === 0 ? "0 Kč" : money(total)}</b>`
        : `Celkem ${mine.length} ${mine.length === 1 ? "zápis" : mine.length < 5 ? "zápisy" : "zápisů"} · aktuálně dluží <b>${total === 0 ? "0 Kč" : money(total)}</b>`;

    document.getElementById("detailList").innerHTML = mine.slice(0, DETAIL_LIMIT).map(f => `
        <div class="drow">
            <div class="drow__main">
                <div class="drow__label">${esc(fineLabel(f))}</div>
                <div class="drow__date">${czDateTime(f.createdAt)}${f.addedBy ? " · zapsal " + esc(f.addedBy) : ""}</div>
            </div>
            <div class="drow__amount${f.amount < 0 ? " drow__amount--ok" : ""}">${money(f.amount)}</div>
        </div>`).join("");

    openOverlay("detailOverlay");
}

function renderArchive() {
    const host = document.getElementById("archiveBody");
    if (!state.fines.length) {
        host.innerHTML = `<div class="archive__empty">Zatím žádné záznamy.</div>`;
        return;
    }
    host.innerHTML = `
    <div class="archive__scroll">
    <table class="archive__table">
        <thead><tr>
            <th>Datum</th><th>Hráč</th><th>Položka</th><th>Částka</th><th>Zapsal</th><th></th>
        </tr></thead>
        <tbody>
        ${state.fines.map(f => `
            <tr>
                <td>${czDateTime(f.createdAt)}</td>
                <td>${esc(f.playerName)}</td>
                <td>${esc(fineLabel(f))}</td>
                <td class="archive__amount${f.amount < 0 ? " archive__amount--ok" : ""}">${money(f.amount)}</td>
                <td>${esc(f.addedBy || "?")}</td>
                <td><button type="button" class="archive__del" data-id="${f.id}" title="Smazat záznam">✕</button></td>
            </tr>`).join("")}
        </tbody>
    </table>
    </div>`;
    host.querySelectorAll(".archive__del").forEach(btn => {
        btn.addEventListener("click", () => onDeleteFine(btn.dataset.id));
    });
}

function renderAll() {
    renderPlayers();
    renderArchive();
}

/* ---------------------------------------------------------------- akce ---- */

async function saveFine({ playerId, playerName, typeKey, label, amount, note }) {
    try {
        await addDoc(col("fines"), {
            playerId, playerName, typeKey, label: label || null, amount, note: note || null,
            addedBy: AdminStore.name, createdAt: serverTimestamp()
        });
        toast(`${playerName}: ${money(amount)} zapsáno`);
    } catch (err) {
        console.error(err);
        toast("Nepodařilo se zapsat – zkontroluj připojení.");
    }
}

async function addPlayer(name) {
    const id = slug(name);
    if (!id) throw new Error("Jméno musí obsahovat aspoň jedno písmeno nebo číslici.");
    if (roster().some(p => p.id === id)) throw new Error("Hráč s tímto jménem už na soupisce je.");

    const order = nextRosterOrder();
    await saveDefaultRoster();
    await setDoc(docIn("players", id), { name, order });
}

async function onRemovePlayer(id) {
    if (!isAdmin()) return;
    const player = playerById(id);
    if (!player) return;

    const count = state.fines.filter(f => f.playerId === id).length;
    const warning = count
        ? `\n\nMá zapsáno ${count} ${count === 1 ? "pokutu" : count < 5 ? "pokuty" : "pokut"} – ty zůstanou v historii zápisů, ale zmizí z přehledu.`
        : "";
    if (!confirm(`Odebrat hráče ${player.name} ze soupisky?${warning}`)) return;

    try {
        await saveDefaultRoster();
        await deleteDoc(docIn("players", id));
        toast(`${player.name} odebrán ze soupisky`);
    } catch (err) {
        console.error(err);
        toast("Odebrání se nepovedlo.");
    }
}

async function onDeleteFine(id) {
    if (!isAdmin()) return;
    if (!confirm("Opravdu smazat tento záznam?")) return;
    try {
        await deleteDoc(docIn("fines", id));
        toast("Záznam smazán");
    } catch (err) {
        console.error(err);
        toast("Smazání se nepovedlo.");
    }
}

function onFineClick(playerId, typeKey) {
    if (!isAdmin()) return;
    const player = playerById(playerId);
    if (!player) return;

    if (typeKey === OTHER_KEY) {
        openCustomModal(player);
        return;
    }
    const f = fineByKey(typeKey);
    if (!f) return;

    if (f.perMinute) {
        openMinutesModal(player, f);
        return;
    }
    saveFine({ playerId: player.id, playerName: player.name, typeKey: f.key, label: f.label, amount: f.amount });
}

/* --------------------------------------------------------------- modaly ---- */

function openCustomModal(player) {
    const overlay = document.getElementById("customOverlay");
    document.getElementById("customPlayerName").textContent = player.name;
    document.getElementById("customAmount").value = "";
    document.getElementById("customNote").value = "";
    document.getElementById("customErr").classList.remove("is-on");
    overlay.dataset.playerId = player.id;
    overlay.dataset.playerName = player.name;
    openOverlay("customOverlay");
    setTimeout(() => document.getElementById("customAmount").focus(), 50);
}

function openMinutesModal(player, fineType) {
    const overlay = document.getElementById("minutesOverlay");
    document.getElementById("minutesPlayerName").textContent = player.name;
    document.getElementById("minutesValue").value = "";
    document.getElementById("minutesErr").classList.remove("is-on");
    overlay.dataset.playerId = player.id;
    overlay.dataset.playerName = player.name;
    overlay.dataset.typeKey = fineType.key;
    overlay.dataset.rate = fineType.amount;
    openOverlay("minutesOverlay");
    setTimeout(() => document.getElementById("minutesValue").focus(), 50);
}

/* --------------------------------------------------------------- init ---- */

document.addEventListener("DOMContentLoaded", () => {
    renderCatalog();
    renderPlayers();
    renderArchive();
    initAuth(renderAll);

    document.getElementById("addPlayerBtn").addEventListener("click", () => {
        document.getElementById("playerName").value = "";
        document.getElementById("playerErr").classList.remove("is-on");
        openOverlay("playerOverlay");
        setTimeout(() => document.getElementById("playerName").focus(), 50);
    });

    document.getElementById("playerForm").addEventListener("submit", async (e) => {
        e.preventDefault();
        const name = document.getElementById("playerName").value.trim();
        const err = document.getElementById("playerErr");
        if (!name) { err.textContent = "Zadej jméno hráče."; err.classList.add("is-on"); return; }
        try {
            await addPlayer(name);
            closeOverlays();
            toast(`${name} přidán na soupisku`);
        } catch (ex) {
            console.error(ex);
            err.textContent = ex.message || "Přidání se nepovedlo.";
            err.classList.add("is-on");
        }
    });

    document.getElementById("customForm").addEventListener("submit", (e) => {
        e.preventDefault();
        const overlay = document.getElementById("customOverlay");
        const amount = parseInt(document.getElementById("customAmount").value, 10);
        const note = document.getElementById("customNote").value.trim();
        const err = document.getElementById("customErr");
        if (!amount || amount <= 0) { err.textContent = "Zadej platnou částku."; err.classList.add("is-on"); return; }
        if (!note) { err.textContent = "Zadej důvod."; err.classList.add("is-on"); return; }
        closeOverlays();
        saveFine({
            playerId: overlay.dataset.playerId, playerName: overlay.dataset.playerName,
            typeKey: OTHER_KEY, amount, note
        });
    });

    document.getElementById("minutesForm").addEventListener("submit", (e) => {
        e.preventDefault();
        const overlay = document.getElementById("minutesOverlay");
        const minutes = parseInt(document.getElementById("minutesValue").value, 10);
        const err = document.getElementById("minutesErr");
        if (!minutes || minutes <= 0) { err.textContent = "Zadej platný počet minut."; err.classList.add("is-on"); return; }
        const rate = parseInt(overlay.dataset.rate, 10);
        const f = fineByKey(overlay.dataset.typeKey);
        closeOverlays();
        saveFine({
            playerId: overlay.dataset.playerId, playerName: overlay.dataset.playerName,
            typeKey: f.key, label: `${f.label} (${minutes} min)`, amount: rate * minutes
        });
    });
});
