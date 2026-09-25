/* ==========================================================================
   FK AGRO VNOROVY – DOROST · Taktická tabule
   Tabule s rozestavením, rohy a pokyny, uložené po složkách v databázi.
   Firebase, přihlášení a soupiska jsou ve sdíleném jádru (core.js).

   Souřadnice všech prvků jsou v metrech celého hřiště 105 × 68:
   x = délka (0 = levá branka, 105 = pravá), y = šířka (0 = horní lajna).
   Pohled „Polovina“ jen otočí a ořízne pravou polovinu (branka nahoře),
   takže se při přepínání pohledu nic nepřepočítává.
   ========================================================================== */

import {
    addDoc, setDoc, deleteDoc, onSnapshot, serverTimestamp, query, orderBy, writeBatch
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

import {
    db, col, docIn, whenReady, onDbError, setStatus,
    roster, onRoster,
    AdminStore, isAdmin, initAuth,
    esc, slug, openOverlay, closeOverlays, toast
} from "./core.js?v=9";

/* ------------------------------------------------------------ nastavení ---- */

const L = 105, W = 68;

/* barvy šipek, prostorů a textu; "auto" = bílá na trávě, tmavá na tabuli */
const COLORS = [
    ["auto", "Automaticky"], ["#c8102e", "Červená"], ["#facc15", "Žlutá"],
    ["#2563eb", "Modrá"], ["#111827", "Černá"]
];
const AWAY_COLORS = ["#1d4ed8", "#111827", "#ffffff", "#eab308", "#ea580c", "#7c3aed"];

/* Rozestavení z pohledu našeho týmu útočícího doprava, [x, y] v metrech.
   První pozice je vždy brankář. */
const FORMATIONS = {
    "4-4-2":   [[5,34], [18,10],[16,26],[16,42],[18,58], [34,10],[32,27],[32,41],[34,58], [47,27],[47,41]],
    "4-3-3":   [[5,34], [18,10],[16,26],[16,42],[18,58], [26,34],[33,21],[33,47], [46,12],[49,34],[46,56]],
    "4-2-3-1": [[5,34], [18,10],[16,26],[16,42],[18,58], [28,26],[28,42], [40,12],[40,34],[40,56], [49,34]],
    "4-1-4-1": [[5,34], [18,10],[16,26],[16,42],[18,58], [25,34], [36,10],[34,26],[34,42],[36,58], [48,34]],
    "3-5-2":   [[5,34], [16,18],[15,34],[16,50], [33,7],[31,23],[26,34],[31,45],[33,61], [47,27],[47,41]],
    "5-3-2":   [[5,34], [22,6],[16,20],[15,34],[16,48],[22,62], [32,20],[30,34],[32,48], [46,27],[46,41]]
};

/* Standardky u pravé branky (v pohledu „Polovina“ je nahoře). Rohy jsou
   zadané zleva (roh u horní lajny, y = 0), zprava se zrcadlí. */
const PRESETS = {
    cornerAtt: {
        ball: [104.4, 0.6],
        home: [[103.2, 2.6], [101.5, 29], [100, 33], [101, 40], [95, 36], [92, 29], [86, 34], [84, 22], [68, 20], [68, 46]]
    },
    cornerDef: {
        ball: [104.4, 0.6],
        home: [[103.6, 34, "gk"], [104.2, 30.2], [100.2, 28.5], [100.2, 34], [100.2, 39.5], [95, 26], [95, 34], [95, 42], [89, 31], [101, 7], [78, 34]]
    },
    freeKick: {
        ball: [80, 30],
        home: [[79, 29.3], [78.6, 31.6], [93, 23], [94, 30], [93, 38], [90, 45]],
        away: [[103.6, 34, "gk"]],   // + zeď, dopočítá se
        wall: 4
    }
};

const TOOL_HINTS = {
    move: "Klikni na prvek a táhni ho. Dvojklik na hráče bez jména nebo na text ho přepíše. Delete smaže vybrané.",
    home: "Klikni do hřiště – přidá se náš hráč. Jméno mu přiřadíš kliknutím na hráče v seznamu vpravo.",
    away: "Klikni do hřiště – přidá se hráč soupeře.",
    ball: "Klikni do hřiště – přidá se míč.",
    cone: "Klikni do hřiště – přidá se kužel.",
    run: "Táhni myší (prstem) – běh bez míče. U vybrané šipky se prostředním bodem dá prohnout.",
    pass: "Táhni myší (prstem) – přihrávka. U vybrané šipky se prostředním bodem dá prohnout.",
    dribble: "Táhni myší (prstem) – vedení míče.",
    zone: "Táhni myší (prstem) – vyznačí se prostor.",
    text: "Klikni do hřiště a napiš text."
};

/* ------------------------------------------------------------------ stav ---- */

const state = {
    folders: [], boards: [], matches: [], guests: [], jerseys: {},
    currentId: null,
    board: null,          // pracovní kopie otevřené tabule
    selId: null,
    tool: "move",
    color: "auto",
    undo: [],
    drag: null,
    lastDown: { id: null, t: 0 }
};

let saveTimer = null;
let openFolders = loadOpenFolders();

function loadOpenFolders() {
    try { return new Set(JSON.parse(localStorage.getItem("taktikaOpenFolders") || "[]")); }
    catch { return new Set(); }
}
function storeOpenFolders() {
    try { localStorage.setItem("taktikaOpenFolders", JSON.stringify([...openFolders])); } catch { /* nevadí */ }
}

const $ = (id) => document.getElementById(id);
const uid = () => Math.random().toString(36).slice(2, 10);
const clone = (o) => JSON.parse(JSON.stringify(o));
const canEdit = () => isAdmin() && !!state.board;

/* -------------------------------------------------------------- databáze ---- */

whenReady(() => {
    onSnapshot(col("tacticFolders"), (snap) => {
        state.folders = snap.docs.map(d => ({ id: d.id, ...d.data() }))
            .sort((a, b) => (a.name || "").localeCompare(b.name || "", "cs"));
        setStatus("online");
        renderTree();
        renderFolderSelect();
    }, onDbError);

    onSnapshot(col("tactics"), (snap) => {
        state.boards = snap.docs.map(d => ({ id: d.id, ...d.data() }))
            .sort((a, b) => (a.title || "").localeCompare(b.title || "", "cs"));
        setStatus("online");

        if (!state.currentId) {
            const fromHash = decodeURIComponent(location.hash.slice(1));
            if (fromHash && state.boards.some(b => b.id === fromHash)) openBoard(fromHash);
        } else {
            const remote = state.boards.find(b => b.id === state.currentId);
            if (!remote) { closeBoard(); toast("Tabule byla smazána"); }
            else if (!saveTimer && !state.drag) { state.board = normalize(clone(remote)); renderBoardAll(); }
        }
        renderTree();
    }, onDbError);

    onSnapshot(col("matches"), (snap) => {
        state.matches = snap.docs.map(d => d.data());
        renderPlayers();
    }, onDbError);

    onSnapshot(query(col("guests"), orderBy("order")), (snap) => {
        state.guests = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        renderPlayers();
        renderBoard();
    }, onDbError);

    onSnapshot(docIn("meta", "jerseys"), (snap) => {
        state.jerseys = (snap.exists() && snap.data().numbers) || {};
        renderPlayers();
        renderBoard();
    }, onDbError);
});

onRoster(() => { renderPlayers(); renderBoard(); });

function normalize(b) {
    b.items = Array.isArray(b.items) ? b.items : [];
    b.bg = b.bg === "white" ? "white" : "grass";
    b.view = b.view === "half" ? "half" : "full";
    b.names = b.names !== false;
    b.awayColor = b.awayColor || AWAY_COLORS[0];
    b.notes = b.notes || "";
    b.folderId = b.folderId || "";
    return b;
}

function scheduleSave() {
    if (!canEdit()) return;
    $("savedState").textContent = "Ukládám…";
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, 700);
}

async function flushSave() {
    clearTimeout(saveTimer);
    saveTimer = null;
    const b = state.board;
    if (!b || !isAdmin()) return;
    try {
        await setDoc(docIn("tactics", b.id), {
            title: b.title || "Bez názvu",
            folderId: b.folderId,
            bg: b.bg, view: b.view, names: b.names, awayColor: b.awayColor,
            notes: b.notes,
            items: clone(b.items),
            updatedAt: serverTimestamp(),
            updatedBy: AdminStore.name
        }, { merge: true });
        const t = new Date().toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" });
        $("savedState").textContent = `Uloženo ${t}`;
    } catch (err) {
        console.error(err);
        $("savedState").textContent = "Neuloženo!";
        toast("Uložení se nepovedlo – zkontroluj připojení");
    }
}

window.addEventListener("pagehide", () => { if (saveTimer) flushSave(); });

/* ------------------------------------------------------------- hráči ---- */

function allPlayers() {
    const games = new Map();
    state.matches.forEach(m => (m.lineup || []).forEach(l => games.set(l.id, (games.get(l.id) || 0) + 1)));
    return [
        ...roster().map(p => ({ id: p.id, name: p.name, guest: false })),
        ...state.guests.map(g => ({ id: g.id, name: g.name, guest: true }))
    ].map(p => ({ ...p, games: games.get(p.id) || 0, num: state.jerseys[p.id] || "" }))
     .sort((a, b) => b.games - a.games || a.name.localeCompare(b.name, "cs"));
}

const playerOf = (id) => allPlayers().find(p => p.id === id);

function initials(name) {
    return String(name || "").split(/\s+/).filter(Boolean).map(w => w[0]).join("").slice(0, 2).toUpperCase();
}
const surname = (name) => String(name || "").trim().split(/\s+/).slice(-1)[0] || "";

/** Co se napíše do kolečka a pod něj. */
function tokenText(it) {
    if (it.side === "home" && it.pid) {
        const p = playerOf(it.pid);
        const name = p ? p.name : (it.pname || "");
        return { mark: (p && p.num) || initials(name), name: surname(name) };
    }
    return { mark: it.num || "", name: "" };
}

function renderPlayers() {
    const host = $("playerList");
    const players = allPlayers();
    const onBoard = new Set((state.board?.items || []).filter(i => i.pid).map(i => i.pid));
    const edit = canEdit();

    $("playersHint").textContent = !state.board
        ? "Otevři tabuli a klikáním přidávej hráče."
        : edit
            ? "Klik na jméno doplní hráče do volného kolečka (brankář první), když volné není, přidá ho na hřiště. Vybranému kolečku se přiřadí přímo. Číslo dresu se píše vlevo a platí pro všechny tabule."
            : "Seřazeno podle počtu odehraných zápasů.";

    host.innerHTML = players.map(p => `
        <div class="tk-prow ${onBoard.has(p.id) ? "is-on" : ""}">
            ${edit
                ? `<input class="tk-num" data-num="${p.id}" value="${esc(p.num)}" maxlength="2" inputmode="numeric" title="Číslo dresu">`
                : `<span class="tk-num tk-num--ro">${esc(p.num || "–")}</span>`}
            <button type="button" class="tk-pbtn" data-pick="${p.id}" ${edit ? "" : "disabled"}>
                <span class="tk-pname">${esc(p.name)}${p.guest ? ` <span class="tag">st. žák</span>` : ""}</span>
                <span class="tk-pgames" title="Odehrané zápasy podle sestav v kanadských bodech">${p.games} z.</span>
            </button>
        </div>`).join("") || `<p class="tk-note">Soupiska je prázdná.</p>`;

    host.querySelectorAll("[data-pick]").forEach(b => b.addEventListener("click", () => pickPlayer(b.dataset.pick)));
    host.querySelectorAll("[data-num]").forEach(inp => inp.addEventListener("change", () => saveJersey(inp.dataset.num, inp.value)));
}

async function saveJersey(id, value) {
    const v = String(value).replace(/\D/g, "").slice(0, 2);
    try {
        await setDoc(docIn("meta", "jerseys"), { numbers: { [id]: v } }, { merge: true });
    } catch (err) { onDbError(err); toast("Číslo se neuložilo"); }
}

function pickPlayer(pid) {
    if (!canEdit()) return;
    const b = state.board;
    const sel = b.items.find(i => i.id === state.selId);
    const p = playerOf(pid);
    pushUndo();

    const assign = (tok) => {
        b.items.forEach(i => { if (i.pid === pid) { delete i.pid; delete i.pname; } });
        tok.pid = pid; tok.pname = p?.name || "";
    };

    if (sel && sel.t === "p" && sel.side === "home") {
        if (sel.pid === pid) { delete sel.pid; delete sel.pname; }
        else assign(sel);
        state.selId = null;
    } else {
        const existing = b.items.find(i => i.pid === pid);
        if (existing) { state.undo.pop(); state.selId = existing.id; renderBoard(); renderPlayers(); return; }
        /* po rozestavení se jména doplňují do volných koleček (brankář první) */
        const free = b.items.filter(i => i.t === "p" && i.side === "home" && !i.pid)
            .sort((a, z) => (z.gk ? 1 : 0) - (a.gk ? 1 : 0))[0];
        if (free) assign(free);
        else {
            const [x, y] = freeSpot();
            b.items.push({ t: "p", id: uid(), side: "home", x, y, pid, pname: p?.name || "" });
        }
    }
    changed();
}

/** Volné místo pro nově přidaného hráče – řada u spodní lajny. */
function freeSpot() {
    const half = state.board.view === "half";
    const used = state.board.items.filter(i => i.t === "p");
    for (let k = 0; k < 40; k++) {
        const x = half ? 55.5 + Math.floor(k / 12) * 4.5 : 8 + (k % 18) * 5.2;
        const y = half ? 6 + (k % 12) * 5.2 : 64 - Math.floor(k / 18) * 5;
        if (!used.some(i => Math.hypot(i.x - x, i.y - y) < 3)) return [x, y];
    }
    return half ? [78, 50] : [52, 34];
}

/* ------------------------------------------------------------ složky ---- */

function renderTree() {
    const host = $("tree");
    const groups = state.folders.map(f => ({ ...f, boards: state.boards.filter(b => b.folderId === f.id) }));
    const known = new Set(state.folders.map(f => f.id));
    const loose = state.boards.filter(b => !b.folderId || !known.has(b.folderId));
    const admin = isAdmin();

    const boardRow = (b) => `
        <button type="button" class="tk-brow ${b.id === state.currentId ? "is-on" : ""}" data-board="${b.id}">
            <span class="tk-brow__ic" data-bg="${b.bg === "white" ? "white" : "grass"}"></span>
            <span class="tk-brow__name">${esc(b.title || "Bez názvu")}</span>
        </button>`;

    const folderHtml = groups.map(f => {
        const open = openFolders.has(f.id) || f.boards.some(b => b.id === state.currentId);
        return `
        <div class="tk-folder ${open ? "is-open" : ""}">
            <div class="tk-folder__head">
                <button type="button" class="tk-folder__toggle" data-folder="${f.id}">
                    <span class="tk-folder__arrow">▸</span>
                    <span class="tk-folder__name">${esc(f.name)}</span>
                    <span class="tk-folder__count">${f.boards.length}</span>
                </button>
                ${admin ? `
                <button type="button" class="tk-ic" data-rename="${f.id}" title="Přejmenovat složku">✎</button>
                <button type="button" class="tk-ic" data-delfolder="${f.id}" title="Smazat složku">✕</button>` : ""}
            </div>
            <div class="tk-folder__body">
                ${f.boards.map(boardRow).join("") || `<div class="tk-folder__empty">prázdná složka</div>`}
            </div>
        </div>`;
    }).join("");

    const looseHtml = loose.length ? `
        <div class="tk-folder is-open tk-folder--loose">
            ${state.folders.length ? `<div class="tk-folder__head"><span class="tk-folder__name tk-folder__name--plain">Bez složky</span></div>` : ""}
            <div class="tk-folder__body">${loose.map(boardRow).join("")}</div>
        </div>` : "";

    host.innerHTML = folderHtml + looseHtml ||
        `<p class="tk-note">Zatím tu není žádná tabule.${admin ? " Založ ji tlačítkem „+ Tabule“." : ""}</p>`;

    host.querySelectorAll("[data-board]").forEach(b => b.addEventListener("click", () => openBoard(b.dataset.board)));
    host.querySelectorAll("[data-folder]").forEach(b => b.addEventListener("click", () => {
        const id = b.dataset.folder;
        openFolders.has(id) ? openFolders.delete(id) : openFolders.add(id);
        storeOpenFolders();
        renderTree();
    }));
    host.querySelectorAll("[data-rename]").forEach(b => b.addEventListener("click", () => renameFolder(b.dataset.rename)));
    host.querySelectorAll("[data-delfolder]").forEach(b => b.addEventListener("click", () => removeFolder(b.dataset.delfolder)));
}

function renderFolderSelect() {
    const sel = $("folderSel");
    sel.innerHTML = `<option value="">— bez složky —</option>` +
        state.folders.map(f => `<option value="${f.id}">${esc(f.name)}</option>`).join("");
    if (state.board) sel.value = state.board.folderId || "";
}

/** Modal s jedním textovým polem. Vrací zadaný text, nebo null při zrušení. */
function ask(title, hint, value = "", okLabel = "Uložit") {
    return new Promise(resolve => {
        $("askTitle").textContent = title;
        $("askHint").textContent = hint;
        $("askOk").textContent = okLabel;
        const input = $("askInput");
        input.value = value;
        const form = $("askForm");
        const overlay = $("askOverlay");
        const finish = (v) => {
            form.removeEventListener("submit", onSubmit);
            observer.disconnect();
            resolve(v);
        };
        const onSubmit = (e) => { e.preventDefault(); const v = input.value.trim(); closeOverlays(); finish(v); };
        /* zavření křížkem, Escape nebo klikem mimo = zrušení */
        const observer = new MutationObserver(() => { if (!overlay.classList.contains("is-open")) finish(null); });
        form.addEventListener("submit", onSubmit);
        openOverlay("askOverlay");
        observer.observe(overlay, { attributes: true, attributeFilter: ["class"] });
        setTimeout(() => { input.focus(); input.select(); }, 50);
    });
}

async function newFolder() {
    const name = await ask("Nová složka", "Třeba „Rohy“, „Rozestavení“ nebo název soupeře.", "", "Založit");
    if (!name) return;
    try {
        const ref = await addDoc(col("tacticFolders"), { name, createdAt: serverTimestamp(), createdBy: AdminStore.name });
        openFolders.add(ref.id); storeOpenFolders();
        toast(`Složka „${name}“ založena`);
    } catch (err) { onDbError(err); toast("Složku se nepodařilo založit"); }
}

async function renameFolder(id) {
    const f = state.folders.find(x => x.id === id);
    if (!f) return;
    const name = await ask("Přejmenovat složku", "", f.name);
    if (!name || name === f.name) return;
    try { await setDoc(docIn("tacticFolders", id), { name }, { merge: true }); }
    catch (err) { onDbError(err); }
}

async function removeFolder(id) {
    const f = state.folders.find(x => x.id === id);
    if (!f) return;
    const inside = state.boards.filter(b => b.folderId === id);
    const msg = inside.length
        ? `Smazat složku „${f.name}“? Tabule v ní (${inside.length}) se nesmažou, přesunou se mezi tabule bez složky.`
        : `Smazat prázdnou složku „${f.name}“?`;
    if (!confirm(msg)) return;
    try {
        const batch = writeBatch(db);
        inside.forEach(b => batch.set(docIn("tactics", b.id), { folderId: "" }, { merge: true }));
        batch.delete(docIn("tacticFolders", id));
        await batch.commit();
        if (state.board && state.board.folderId === id) state.board.folderId = "";
    } catch (err) { onDbError(err); }
}

/* ------------------------------------------------------------ tabule ---- */

async function newBoard() {
    const title = await ask("Nová tabule", "Třeba „Roh zleva – na první tyč“ nebo „Rozestavení na Kyjov“.", "", "Založit");
    if (!title) return;
    const folderId = state.board?.folderId || "";
    try {
        const ref = await addDoc(col("tactics"), {
            title, folderId, bg: "grass", view: "full", names: true, awayColor: AWAY_COLORS[0],
            notes: "", items: [],
            createdAt: serverTimestamp(), createdBy: AdminStore.name,
            updatedAt: serverTimestamp(), updatedBy: AdminStore.name
        });
        openBoard(ref.id);
    } catch (err) { onDbError(err); toast("Tabuli se nepodařilo založit"); }
}

async function duplicateBoard() {
    const b = state.board;
    if (!b) return;
    if (saveTimer) await flushSave();
    try {
        const ref = await addDoc(col("tactics"), {
            title: `${b.title || "Bez názvu"} (kopie)`, folderId: b.folderId,
            bg: b.bg, view: b.view, names: b.names, awayColor: b.awayColor,
            notes: b.notes, items: clone(b.items),
            createdAt: serverTimestamp(), createdBy: AdminStore.name,
            updatedAt: serverTimestamp(), updatedBy: AdminStore.name
        });
        openBoard(ref.id);
        toast("Tabule zkopírována");
    } catch (err) { onDbError(err); }
}

async function removeBoard() {
    const b = state.board;
    if (!b || !confirm(`Opravdu smazat tabuli „${b.title || "Bez názvu"}“?`)) return;
    clearTimeout(saveTimer); saveTimer = null;
    const id = b.id;
    closeBoard();
    try { await deleteDoc(docIn("tactics", id)); toast("Tabule smazána"); }
    catch (err) { onDbError(err); }
}

function openBoard(id) {
    if (saveTimer) flushSave();
    const b = state.boards.find(x => x.id === id);
    if (!b) return;
    state.currentId = id;
    state.board = normalize(clone(b));
    state.selId = null;
    state.undo = [];
    history.replaceState(null, "", "#" + encodeURIComponent(id));
    if (b.folderId) { openFolders.add(b.folderId); storeOpenFolders(); }
    const by = b.updatedBy ? ` · ${b.updatedBy}` : "";
    $("savedState").textContent = b.updatedAt?.toDate
        ? `Upraveno ${b.updatedAt.toDate().toLocaleDateString("cs-CZ")}${by}` : "";
    renderBoardAll();
    renderTree();
}

function closeBoard() {
    state.currentId = null;
    state.board = null;
    state.selId = null;
    history.replaceState(null, "", location.pathname + location.search);
    renderBoardAll();
    renderTree();
}

function renderBoardAll() {
    const b = state.board;
    $("emptyState").hidden = !!b;
    $("boardWrap").hidden = !b;
    $("panel").hidden = !b;
    $("emptyLogin").hidden = isAdmin();
    if (b) {
        const title = $("boardTitle");
        if (document.activeElement !== title) title.value = b.title || "";
        title.readOnly = !isAdmin();
        const notes = $("notes");
        if (document.activeElement !== notes) notes.value = b.notes;
        notes.readOnly = !isAdmin();
        notes.placeholder = isAdmin() ? "Taktické pokyny k téhle tabuli…" : "Bez pokynů.";
        document.querySelectorAll("#bgSeg [data-bg]").forEach(x => x.classList.toggle("is-on", x.dataset.bg === b.bg));
        document.querySelectorAll("#viewSeg [data-view]").forEach(x => x.classList.toggle("is-on", x.dataset.view === b.view));
        $("namesChk").checked = b.names;
        renderFolderSelect();
        renderSwatches();
    }
    renderColors();
    renderBoard();
    renderPlayers();
    updateToolUI();
}

/** Po každé změně prvků: překreslit, uložit. */
function changed() {
    renderBoard();
    renderPlayers();
    scheduleSave();
}

function pushUndo() {
    if (!state.board) return;
    state.undo.push(JSON.stringify(state.board.items));
    if (state.undo.length > 60) state.undo.shift();
}

function undo() {
    if (!canEdit() || !state.undo.length) return;
    state.board.items = JSON.parse(state.undo.pop());
    state.selId = null;
    changed();
}

function deleteSelected() {
    if (!canEdit() || !state.selId) return;
    pushUndo();
    state.board.items = state.board.items.filter(i => i.id !== state.selId);
    state.selId = null;
    changed();
}

/* ------------------------------------------------------------ kreslení ---- */

const isHalf = () => state.board?.view === "half";
/* v pohledu Polovina se celý svět otočí o 90° (pravá branka nahoru);
   texty a značky se otáčí zpátky, aby byly čitelné */
const WORLD_T = "matrix(0 -1 1 0 0 105)";
const UPRIGHT = "matrix(0 1 -1 0 0 0)";

function palette() {
    const grass = state.board?.bg !== "white";
    return {
        grass,
        surround: grass ? "#2c7a37" : "#e4e8e5",
        line: grass ? "rgba(255,255,255,.92)" : "#2d3339",
        ink: grass ? "#ffffff" : "#1f2937",
        halo: grass ? "rgba(10,30,15,.75)" : "rgba(255,255,255,.95)"
    };
}

const colorOf = (c) => (!c || c === "auto") ? palette().ink : c;

function pitchSvg(pal) {
    const s = pal.line, sw = 0.18;
    const stripes = pal.grass
        ? Array.from({ length: 10 }, (_, i) =>
            `<rect x="${i * 10.5}" y="0" width="10.5" height="${W}" fill="${i % 2 ? "#368a41" : "#3c9347"}"/>`).join("")
        : `<rect x="0" y="0" width="${L}" height="${W}" fill="#ffffff"/>`;
    return `
        ${stripes}
        <g fill="none" stroke="${s}" stroke-width="${sw}">
            <rect x="0" y="0" width="${L}" height="${W}"/>
            <line x1="52.5" y1="0" x2="52.5" y2="${W}"/>
            <circle cx="52.5" cy="34" r="9.15"/>
            <rect x="0" y="13.84" width="16.5" height="40.32"/>
            <rect x="88.5" y="13.84" width="16.5" height="40.32"/>
            <rect x="0" y="24.84" width="5.5" height="18.32"/>
            <rect x="99.5" y="24.84" width="5.5" height="18.32"/>
            <path d="M16.5 26.688 A9.15 9.15 0 0 1 16.5 41.312"/>
            <path d="M88.5 26.688 A9.15 9.15 0 0 0 88.5 41.312"/>
            <path d="M1 0 A1 1 0 0 1 0 1"/>
            <path d="M104 0 A1 1 0 0 0 105 1"/>
            <path d="M0 67 A1 1 0 0 1 1 68"/>
            <path d="M104 68 A1 1 0 0 1 105 67"/>
            <rect x="-2" y="30.34" width="2" height="7.32" fill="${pal.grass ? "rgba(255,255,255,.18)" : "rgba(0,0,0,.05)"}"/>
            <rect x="105" y="30.34" width="2" height="7.32" fill="${pal.grass ? "rgba(255,255,255,.18)" : "rgba(0,0,0,.05)"}"/>
        </g>
        <g fill="${s}">
            <circle cx="52.5" cy="34" r="0.28"/>
            <circle cx="11" cy="34" r="0.28"/>
            <circle cx="94" cy="34" r="0.28"/>
        </g>`;
}

/* bod na kvadratické křivce a její řídicí bod */
function ctrlOf(a) { return [(a.x1 + a.x2) / 2 + (a.bx || 0), (a.y1 + a.y2) / 2 + (a.by || 0)]; }
function qAt(a, t) {
    const [cx, cy] = ctrlOf(a), u = 1 - t;
    return [u * u * a.x1 + 2 * u * t * cx + t * t * a.x2, u * u * a.y1 + 2 * u * t * cy + t * t * a.y2];
}

function arrowSvg(a, pal) {
    const c = colorOf(a.color);
    const [cx, cy] = ctrlOf(a);
    let tx = a.x2 - cx, ty = a.y2 - cy;
    if (Math.hypot(tx, ty) < 0.01) { tx = a.x2 - a.x1; ty = a.y2 - a.y1; }
    const tl = Math.hypot(tx, ty) || 1;
    const ux = tx / tl, uy = ty / tl;
    const head = 1.7, hw = 0.95;
    const bx = a.x2 - ux * head, by = a.y2 - uy * head;
    const headPts = `${a.x2},${a.y2} ${bx - uy * hw},${by + ux * hw} ${bx + uy * hw},${by - ux * hw}`;
    const ex = a.x2 - ux * head * 0.8, ey = a.y2 - uy * head * 0.8;   // čára končí pod hrotem

    let d;
    if (a.style === "dribble") {
        const len = Math.hypot(a.x2 - a.x1, a.y2 - a.y1) + Math.hypot(cx - a.x1, cy - a.y1) * 0.2;
        const n = Math.max(12, Math.round(len / 0.35));
        const pts = [];
        for (let i = 0; i <= n; i++) {
            const t = i / n;
            const [px, py] = qAt(a, t);
            const [qx, qy] = qAt(a, Math.min(1, t + 0.01));
            let nx = -(qy - py), ny = qx - px;
            const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl;
            const damp = Math.min(1, t * 8, (1 - t) * 6);
            const amp = 0.45 * damp * Math.sin(t * len / 1.5 * Math.PI * 2);
            pts.push(`${(px + nx * amp).toFixed(2)},${(py + ny * amp).toFixed(2)}`);
        }
        pts.push(`${ex.toFixed(2)},${ey.toFixed(2)}`);
        d = "M" + pts.join(" L");
    } else {
        d = `M${a.x1} ${a.y1} Q${cx} ${cy} ${ex} ${ey}`;
    }
    const dash = a.style === "pass" ? `stroke-dasharray="1.1 0.8"` : "";
    const sel = a.id === state.selId;
    return `
        <g class="it" data-id="${a.id}">
            <path d="${d}" fill="none" stroke="${pal.halo}" stroke-width="0.62" stroke-linecap="round" opacity=".35"/>
            <path d="${d}" fill="none" stroke="${c}" stroke-width="${sel ? 0.42 : 0.32}" stroke-linecap="round" ${dash}/>
            <polygon points="${headPts}" fill="${c}"/>
            <path d="M${a.x1} ${a.y1} Q${cx} ${cy} ${a.x2} ${a.y2}" fill="none" stroke="transparent" stroke-width="2.6" class="hit"/>
        </g>`;
}

function itemSvg(it, pal, S) {
    const up = isHalf() ? ` ${UPRIGHT}` : "";
    const sel = it.id === state.selId;
    const ring = (r) => sel ? `<circle r="${r}" fill="none" stroke="#facc15" stroke-width="0.4"/>` : "";

    if (it.t === "p") {
        const home = it.side === "home";
        const gk = !!it.gk;
        let fill = home ? (gk ? "#f2c200" : "#c8102e") : state.board.awayColor;
        if (!home && gk) fill = "#16a34a";
        const light = ["#ffffff", "#eab308", "#f2c200", "#facc15"].includes(fill);
        const txt = light ? "#111827" : "#ffffff";
        const { mark, name } = tokenText(it);
        const r = 2 * S;
        const fs = (mark.length > 2 ? 1.5 : 2.1) * S;
        const showName = state.board.names && name;
        return `
            <g class="it" data-id="${it.id}" transform="translate(${it.x} ${it.y})${up}">
                ${ring(r + 0.7)}
                <circle r="${r}" fill="${fill}" stroke="${light ? "#374151" : "#ffffff"}" stroke-width="${0.28 * S}"/>
                <text y="${fs * 0.36}" font-size="${fs}" font-weight="900" fill="${txt}" text-anchor="middle">${esc(mark)}</text>
                ${showName ? `<text y="${r + 1.9 * S}" font-size="${1.55 * S}" font-weight="800" fill="${pal.ink}" stroke="${pal.halo}" stroke-width="${0.45 * S}" paint-order="stroke" text-anchor="middle">${esc(name)}</text>` : ""}
            </g>`;
    }
    if (it.t === "ball") {
        const r = 0.95 * S;
        return `
            <g class="it" data-id="${it.id}" transform="translate(${it.x} ${it.y})${up}">
                ${ring(r + 0.6)}
                <circle r="${r}" fill="#ffffff" stroke="#111827" stroke-width="0.18"/>
                <polygon points="0,${-0.38 * S} ${0.36 * S},${-0.12 * S} ${0.22 * S},${0.31 * S} ${-0.22 * S},${0.31 * S} ${-0.36 * S},${-0.12 * S}" fill="#111827"/>
            </g>`;
    }
    if (it.t === "cone") {
        const h = 1.5 * S;
        return `
            <g class="it" data-id="${it.id}" transform="translate(${it.x} ${it.y})${up}">
                ${ring(1.6 * S)}
                <polygon points="0,${-h * 0.62} ${h * 0.55},${h * 0.45} ${-h * 0.55},${h * 0.45}" fill="#f97316" stroke="#ffffff" stroke-width="0.15"/>
            </g>`;
    }
    if (it.t === "text") {
        const c = colorOf(it.color);
        return `
            <g class="it" data-id="${it.id}" transform="translate(${it.x} ${it.y})${up}">
                <text font-size="${2.3 * S}" font-weight="800" fill="${c}" stroke="${pal.halo}" stroke-width="${0.5 * S}" paint-order="stroke" text-anchor="middle" dominant-baseline="middle"
                    ${sel ? `text-decoration="underline"` : ""}>${esc(it.text)}</text>
            </g>`;
    }
    if (it.t === "zone") {
        const c = colorOf(it.color);
        const x = Math.min(it.x, it.x + it.w), y = Math.min(it.y, it.y + it.h);
        return `
            <g class="it" data-id="${it.id}">
                <rect x="${x}" y="${y}" width="${Math.abs(it.w)}" height="${Math.abs(it.h)}" rx="0.8"
                    fill="${c}" fill-opacity=".2" stroke="${c}" stroke-width="${sel ? 0.34 : 0.24}" stroke-dasharray="0.9 0.6"/>
            </g>`;
    }
    return "";
}

function handlesSvg() {
    const it = state.board.items.find(i => i.id === state.selId);
    if (!it || !canEdit()) return "";
    const h = (x, y, k) => `<circle class="hd" data-handle="${k}" cx="${x}" cy="${y}" r="0.9" fill="#ffffff" stroke="#c8102e" stroke-width="0.3"/>`;
    if (["run", "pass", "dribble"].includes(it.t)) {
        const [mx, my] = qAt(it, 0.5);
        return h(it.x1, it.y1, "p1") + h(it.x2, it.y2, "p2") + h(mx, my, "mid");
    }
    if (it.t === "zone") return h(it.x + it.w, it.y + it.h, "corner");
    return "";
}

function renderBoard() {
    const svg = $("board");
    const b = state.board;
    if (!b) { svg.innerHTML = ""; return; }
    const pal = palette();
    const half = isHalf();
    const S = half ? 0.85 : 1;
    svg.setAttribute("viewBox", half ? "-4 -4 76 57.5" : "-4 -4 113 76");
    svg.dataset.view = b.view;

    const arrows = b.items.filter(i => ["run", "pass", "dribble"].includes(i.t));
    const zones = b.items.filter(i => i.t === "zone");
    const rest = b.items.filter(i => !["run", "pass", "dribble", "zone"].includes(i.t));

    svg.innerHTML = `
        <rect x="-50" y="-50" width="250" height="200" fill="${pal.surround}"/>
        <g id="world" ${half ? `transform="${WORLD_T}"` : ""} font-family="Inter, Arial, sans-serif">
            ${pitchSvg(pal)}
            ${zones.map(z => itemSvg(z, pal, S)).join("")}
            ${arrows.map(a => arrowSvg(a, pal)).join("")}
            ${rest.map(i => itemSvg(i, pal, S)).join("")}
            ${handlesSvg()}
        </g>`;
    svg.classList.toggle("is-edit", canEdit());
}

/* ----------------------------------------------------------- ovládání ---- */

function worldPoint(e) {
    const world = $("world");
    const pt = $("board").createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const p = pt.matrixTransform(world.getScreenCTM().inverse());
    return [p.x, p.y];
}

function clampPt([x, y]) {
    const minX = isHalf() ? 51 : -3;
    return [Math.max(minX, Math.min(108, x)), Math.max(-3, Math.min(71, y))];
}

const round = (v) => Math.round(v * 10) / 10;

function onDown(e) {
    if (!canEdit() || e.button > 0) return;
    const svg = $("board");
    const [x, y] = clampPt(worldPoint(e));
    const handle = e.target.closest("[data-handle]");
    const itemEl = e.target.closest("[data-id]");
    const b = state.board;
    const tool = state.tool;

    if (handle && state.selId) {
        pushUndo();
        state.drag = { kind: "handle", key: handle.dataset.handle, id: state.selId };
    } else if (tool === "move" || (itemEl && !["run", "pass", "dribble", "zone"].includes(tool))) {
        if (!itemEl) { state.selId = null; renderBoard(); renderPlayers(); return; }
        const id = itemEl.dataset.id;
        const now = Date.now();
        if (state.lastDown.id === id && now - state.lastDown.t < 380) {
            state.lastDown = { id: null, t: 0 };
            editItemText(id);
            return;
        }
        state.lastDown = { id, t: now };
        state.selId = id;
        pushUndo();
        state.drag = { kind: "move", id, start: [x, y], orig: clone(b.items.find(i => i.id === id)), moved: false };
    } else if (["home", "away", "ball", "cone"].includes(tool)) {
        pushUndo();
        const it = tool === "home" || tool === "away"
            ? { t: "p", id: uid(), side: tool, x: round(x), y: round(y) }
            : { t: tool, id: uid(), x: round(x), y: round(y) };
        if (tool === "away") it.num = String(b.items.filter(i => i.t === "p" && i.side === "away").length + 1);
        b.items.push(it);
        state.selId = it.id;
        changed();
        return;
    } else if (tool === "text") {
        addText(x, y);
        return;
    } else if (["run", "pass", "dribble"].includes(tool)) {
        pushUndo();
        const it = { t: tool, id: uid(), style: tool, x1: round(x), y1: round(y), x2: round(x), y2: round(y), color: state.color };
        b.items.push(it);
        state.selId = it.id;
        state.drag = { kind: "create", id: it.id };
    } else if (tool === "zone") {
        pushUndo();
        const it = { t: "zone", id: uid(), x: round(x), y: round(y), w: 0, h: 0, color: state.color };
        b.items.push(it);
        state.selId = it.id;
        state.drag = { kind: "create", id: it.id };
    }
    svg.setPointerCapture(e.pointerId);
    e.preventDefault();
    renderBoard();
}

function onMove(e) {
    const d = state.drag;
    if (!d) return;
    const [x, y] = clampPt(worldPoint(e));
    const it = state.board.items.find(i => i.id === d.id);
    if (!it) return;

    if (d.kind === "move") {
        const dx = x - d.start[0], dy = y - d.start[1];
        if (Math.hypot(dx, dy) > 0.25) d.moved = true;
        const o = d.orig;
        if ("x1" in o) { it.x1 = round(o.x1 + dx); it.y1 = round(o.y1 + dy); it.x2 = round(o.x2 + dx); it.y2 = round(o.y2 + dy); }
        else { it.x = round(o.x + dx); it.y = round(o.y + dy); }
    } else if (d.kind === "create") {
        if (it.t === "zone") { it.w = round(x - it.x); it.h = round(y - it.y); }
        else { it.x2 = round(x); it.y2 = round(y); }
    } else if (d.kind === "handle") {
        if (d.key === "p1") { it.x1 = round(x); it.y1 = round(y); }
        else if (d.key === "p2") { it.x2 = round(x); it.y2 = round(y); }
        else if (d.key === "mid") {
            // prostřední úchyt leží na křivce: řídicí bod = 2·M − střed tětivy
            const mx = (it.x1 + it.x2) / 2, my = (it.y1 + it.y2) / 2;
            it.bx = round(2 * (x - mx)); it.by = round(2 * (y - my));
        } else if (d.key === "corner") { it.w = round(x - it.x); it.h = round(y - it.y); }
    }
    renderBoard();
}

function onUp() {
    const d = state.drag;
    if (!d) return;
    state.drag = null;
    const b = state.board;
    const it = b.items.find(i => i.id === d.id);

    if (d.kind === "move" && !d.moved) { state.undo.pop(); renderBoard(); renderPlayers(); return; }
    if (d.kind === "create" && it) {
        const tiny = it.t === "zone"
            ? Math.abs(it.w) < 1.5 || Math.abs(it.h) < 1.5
            : Math.hypot(it.x2 - it.x1, it.y2 - it.y1) < 1.5;
        if (tiny) {
            b.items = b.items.filter(i => i.id !== it.id);
            state.undo.pop();
            state.selId = null;
            renderBoard();
            return;
        }
    }
    if (it && it.t === "zone") {   // záporná šířka/výška po tažení doleva nahoru
        if (it.w < 0) { it.x = round(it.x + it.w); it.w = -it.w; }
        if (it.h < 0) { it.y = round(it.y + it.h); it.h = -it.h; }
    }
    changed();
}

async function addText(x, y) {
    const text = await ask("Text na tabuli", "Třeba „presink“, „krátce“, „2. tyč“.", "", "Přidat");
    if (!text) return;
    pushUndo();
    const it = { t: "text", id: uid(), x: round(x), y: round(y), text, color: state.color };
    state.board.items.push(it);
    state.selId = it.id;
    setTool("move");
    changed();
}

async function editItemText(id) {
    const it = state.board.items.find(i => i.id === id);
    if (!it) return;
    if (it.t === "text") {
        const text = await ask("Upravit text", "", it.text);
        if (!text) return;
        pushUndo(); it.text = text; changed();
    } else if (it.t === "p" && !it.pid) {
        const v = await ask("Označení hráče", "Číslo nebo zkratka do kolečka, třeba „10“ nebo „GK“. Prázdné = bez označení.", it.num || "");
        if (v === null) return;
        pushUndo(); it.num = v.slice(0, 3); changed();
    } else if (it.t === "p" && it.pid) {
        toast("Jméno odebereš opětovným kliknutím na hráče v seznamu");
    }
}

/* ------------------------------------------------------ rozestavení ---- */

/** Přesune hráče jedné strany na zadané pozice; chybějící doplní. */
function placeSide(side, slots) {
    const b = state.board;
    const tokens = b.items.filter(i => i.t === "p" && i.side === side)
        .sort((a, z) => (z.gk ? 1 : 0) - (a.gk ? 1 : 0));
    const gkSlot = slots.findIndex(s => s[2] === "gk");
    const ordered = [];
    if (gkSlot >= 0) {
        const gkTok = tokens.find(t => t.gk);
        if (gkTok) ordered[gkSlot] = gkTok;
    }
    /* bez pozice brankáře (náš útok v polovině) zůstává brankář, kde je */
    const pool = tokens.filter(t => !ordered.includes(t) && (gkSlot >= 0 || !t.gk));
    slots.forEach((s, i) => {
        let t = ordered[i] || pool.shift();
        if (!t) {
            t = { t: "p", id: uid(), side };
            if (side === "away") t.num = String(i + 1);
            b.items.push(t);
        }
        t.x = round(s[0]); t.y = round(s[1]);
        if (s[2] === "gk") t.gk = true; else delete t.gk;
    });
}

function placeBall(x, y) {
    const b = state.board;
    let ball = b.items.find(i => i.t === "ball");
    if (!ball) { ball = { t: "ball", id: uid() }; b.items.push(ball); }
    ball.x = x; ball.y = y;
}

function applyFormation(side) {
    if (!canEdit()) return;
    const f = FORMATIONS[$("formationSel").value];
    if (!f) return;
    pushUndo();
    const half = isHalf();
    let slots = f.map(([x, y], i) => [x, y, i === 0 ? "gk" : ""]);
    if (side === "home") {
        /* v polovině ukazujeme náš útok – brankář zůstává mimo záběr */
        slots = half
            ? slots.slice(1).map(([x, y]) => [38.3 + 1.1 * x, y, ""])
            : slots;
    } else {
        slots = slots.map(([x, y, g]) => [L - x, W - y, g]);
    }
    placeSide(side, slots);
    state.selId = null;
    changed();
    toast(`Rozestavení ${$("formationSel").value} – ${side === "home" ? "náš tým" : "soupeř"}`);
}

function applyPreset(key) {
    if (!canEdit()) return;
    pushUndo();
    const mirror = key.endsWith("R");
    const base = PRESETS[key.replace(/[LR]$/, "")];
    const my = (p) => [p[0], mirror ? W - p[1] : p[1], p[2] || ""];

    placeBall(...my(base.ball).slice(0, 2));
    placeSide("home", base.home.map(my));

    if (base.wall) {
        const [bx, by] = base.ball;
        const dx = 105 - bx, dy = 34 - by, dl = Math.hypot(dx, dy);
        const ux = dx / dl, uy = dy / dl;
        const cx = bx + ux * 9.15, cy = by + uy * 9.15;
        const wall = Array.from({ length: base.wall }, (_, i) => {
            const off = (i - (base.wall - 1) / 2) * 0.95;
            return [cx - uy * off, cy + ux * off, ""];
        });
        placeSide("away", [...base.away.map(my), ...wall]);
    }
    state.selId = null;
    changed();
}

/* ------------------------------------------------------- nástroje a UI ---- */

function setTool(t) {
    state.tool = t;
    updateToolUI();
}

function updateToolUI() {
    document.querySelectorAll("[data-tool]").forEach(b => b.classList.toggle("is-on", b.dataset.tool === state.tool));
    $("toolHint").textContent = canEdit()
        ? TOOL_HINTS[state.tool]
        : state.board ? "Tabule je jen pro čtení – upravovat se dá po přihlášení. Pohled a barvu hřiště si můžeš přepnout jen pro sebe." : "";
    $("board").dataset.mode = state.tool;
}

function renderColors() {
    $("colors").innerHTML = COLORS.map(([c, name]) => `
        <button type="button" class="tk-sw ${state.color === c ? "is-on" : ""}" data-color="${c}" title="${name}"
            style="--sw:${c === "auto" ? "linear-gradient(135deg,#fff 50%,#1f2937 50%)" : c}"></button>`).join("");
    $("colors").querySelectorAll("[data-color]").forEach(b => b.addEventListener("click", () => {
        state.color = b.dataset.color;
        const sel = state.board?.items.find(i => i.id === state.selId);
        if (sel && canEdit() && ["run", "pass", "dribble", "zone", "text"].includes(sel.t)) {
            pushUndo(); sel.color = state.color; changed();
        }
        renderColors();
    }));
}

function renderSwatches() {
    const b = state.board;
    $("awayColor").innerHTML = AWAY_COLORS.map(c => `
        <button type="button" class="tk-sw ${b.awayColor === c ? "is-on" : ""}" data-away="${c}" style="--sw:${c}" title="${c}"></button>`).join("");
    $("awayColor").querySelectorAll("[data-away]").forEach(x => x.addEventListener("click", () => {
        b.awayColor = x.dataset.away;
        renderSwatches();
        renderBoard();
        scheduleSave();
    }));
}

/** Stáhne tabuli jako PNG (bez úchytů výběru). */
async function downloadPng() {
    const b = state.board;
    if (!b) return;
    const keepSel = state.selId;
    state.selId = null;
    renderBoard();
    const svg = $("board");
    const vb = svg.viewBox.baseVal;
    const scale = 2400 / Math.max(vb.width, vb.height);
    const w = Math.round(vb.width * scale), h = Math.round(vb.height * scale);
    const markup = new XMLSerializer().serializeToString(svg)
        .replace("<svg", `<svg width="${w}" height="${h}"`);
    state.selId = keepSel;
    renderBoard();

    const img = new Image();
    const url = URL.createObjectURL(new Blob([markup], { type: "image/svg+xml;charset=utf-8" }));
    try {
        await new Promise((ok, fail) => { img.onload = ok; img.onerror = fail; img.src = url; });
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        const a = document.createElement("a");
        a.download = `${slug(b.title || "tabule") || "tabule"}.png`;
        a.href = canvas.toDataURL("image/png");
        a.click();
    } catch (err) {
        console.error(err);
        toast("Obrázek se nepodařilo vytvořit");
    } finally {
        URL.revokeObjectURL(url);
    }
}

function wire() {
    const svg = $("board");
    svg.addEventListener("pointerdown", onDown);
    svg.addEventListener("pointermove", onMove);
    svg.addEventListener("pointerup", onUp);
    svg.addEventListener("pointercancel", onUp);

    document.querySelectorAll("[data-tool]").forEach(b => b.addEventListener("click", () => setTool(b.dataset.tool)));
    $("undoBtn").addEventListener("click", undo);
    $("delBtn").addEventListener("click", deleteSelected);

    document.addEventListener("keydown", (e) => {
        const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);
        if (typing || document.querySelector(".overlay.is-open")) return;
        if ((e.key === "Delete" || e.key === "Backspace") && state.selId) { e.preventDefault(); deleteSelected(); }
        else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); undo(); }
        else if (e.key === "Escape") { state.selId = null; setTool("move"); renderBoard(); renderPlayers(); }
        else if (e.key.toLowerCase() === "v") setTool("move");
    });

    $("newBoardBtn").addEventListener("click", newBoard);
    $("newFolderBtn").addEventListener("click", newFolder);
    $("dupBtn").addEventListener("click", duplicateBoard);
    $("removeBoardBtn").addEventListener("click", removeBoard);
    $("pngBtn").addEventListener("click", downloadPng);

    $("boardTitle").addEventListener("input", (e) => {
        if (!canEdit()) return;
        state.board.title = e.target.value;
        scheduleSave();
    });
    $("boardTitle").addEventListener("change", () => renderTree());
    $("notes").addEventListener("input", (e) => {
        if (!canEdit()) return;
        state.board.notes = e.target.value;
        scheduleSave();
    });

    /* pohled a barvu hřiště si může přepnout i nepřihlášený – jen se neuloží */
    document.querySelectorAll("#bgSeg [data-bg]").forEach(x => x.addEventListener("click", () => {
        if (!state.board) return;
        state.board.bg = x.dataset.bg;
        renderBoardAll();
        scheduleSave();
    }));
    document.querySelectorAll("#viewSeg [data-view]").forEach(x => x.addEventListener("click", () => {
        if (!state.board) return;
        state.board.view = x.dataset.view;
        renderBoardAll();
        scheduleSave();
    }));
    $("namesChk").addEventListener("change", (e) => {
        if (!state.board) return;
        state.board.names = e.target.checked;
        renderBoard();
        scheduleSave();
    });
    $("folderSel").addEventListener("change", (e) => {
        if (!canEdit()) return;
        state.board.folderId = e.target.value;
        if (e.target.value) { openFolders.add(e.target.value); storeOpenFolders(); }
        flushSave();
    });

    $("formationSel").innerHTML = Object.keys(FORMATIONS).map(k => `<option>${k}</option>`).join("");
    $("formationHome").addEventListener("click", () => applyFormation("home"));
    $("formationAway").addEventListener("click", () => applyFormation("away"));
    document.querySelectorAll("[data-preset]").forEach(b => b.addEventListener("click", () => applyPreset(b.dataset.preset)));
}

wire();
initAuth(() => { renderBoardAll(); renderTree(); });
renderBoardAll();
