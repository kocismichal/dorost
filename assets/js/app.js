/* ==========================================================================
   FK AGRO VNOROVY – DOROST · Pokutníček
   Datová vrstva: Firebase Firestore (živá synchronizace, zdarma).
   Přihlášení "admina" je jen na straně prohlížeče (společné heslo pro celý
   tým) – slouží k odemčení tlačítek pro zápis, ne jako bezpečnostní bariéra.
   ========================================================================== */

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import {
    getFirestore, collection, addDoc, deleteDoc, doc,
    onSnapshot, serverTimestamp, query, orderBy
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

/* ---------------------------------------------------------------- config ---
   TOTO DOPLŇ podle vlastního Firebase projektu (Firebase Console →
   Project settings → General → Your apps → SDK setup and configuration).
   ---------------------------------------------------------------------- */
const FIREBASE_CONFIG = {
    apiKey: "REPLACE_ME",
    authDomain: "REPLACE_ME.firebaseapp.com",
    projectId: "REPLACE_ME",
    storageBucket: "REPLACE_ME.firebasestorage.app",
    messagingSenderId: "REPLACE_ME",
    appId: "REPLACE_ME"
};
const APP_ID = "dorost-pokuty";
const ADMIN_PASSWORD = "AgroDorost26";

/* ------------------------------------------------------------- hráči ---- */

const PLAYERS = [
    "Chudík Vít", "Janoušek Tobiáš", "Komínek Štěpán", "Kučera David",
    "Smetka Michal", "Ivan Marián", "Tomeček Denis", "Ficnar Tobias",
    "Herodes Lukáš", "Hříbek Josef", "Chudík Šimon", "Páleník Kryštof",
    "Slavík David", "Bellingham", "Všetula Jakub", "Knotek Petr",
    "Konečný Adam", "Křen Tomáš", "Křižka Matyáš", "Neumann Jiří",
    "Hála Patrik", "Štěpán Macháček"
].map(name => ({ id: slug(name), name }));

function slug(str) {
    return str.normalize("NFD").replace(/[̀-ͯ]/g, "")
        .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/* --------------------------------------------------------- druhy pokut ---
   perMinute: při kliknutí se zeptá na počet minut, částka = amount * minuty
   custom:    otevře modal na částku + důvod (položka „Ostatní“)
   ------------------------------------------------------------------- */

const FINE_TYPES = [
    { key: "trenink_pozde", label: "Pozdní příchod na trénink", desc: "Trénink 5 minut před začátkem na hřišti", amount: 10, btn: "Pozdní příchod - trénink" },
    { key: "zapas_pozde", label: "Pozdní příchod na zápas", desc: "10 Kč za každou minutu", amount: 10, perMinute: true, btn: "Pozdní příchod - zápas" },
    { key: "neprihlasen", label: "Nepřihlášen do 12:00", amount: 20, btn: "Nepřihlášení" },
    { key: "duvod_nepritomnosti", label: "Neudán důvod nepřítomnosti", amount: 20, btn: "Důvod nepřítomnosti" },
    { key: "balon", label: "Překopnutý balon přes plot/síť", amount: 10, btn: "Balon přes plot" },
    { key: "sprosta_slova", label: "Sprostá slova", amount: 10, btn: "Sprostá slova" },
    { key: "zluta_karta", label: "Žlutá karta za kecy", amount: 50, btn: "Žlutá karta - kecy" },
    { key: "cervena_karta", label: "Červená karta", amount: 50, btn: "Červená karta" },
    { key: "zivotosprava", label: "Životospráva", amount: 50, btn: "Životospráva" },
    { key: "mobil", label: "Mobil v ruce před zápasem po čase srazu", amount: 20, btn: "Mobil" }
];
const DEDUCTION = { key: "trenink_tyden", label: "Splnění tréninkového týdne", desc: "3 tréninky týdně", amount: -50, btn: "Tréninkový týden" };
const OTHER_KEY = "ostatni";

const fineByKey = (key) => FINE_TYPES.find(f => f.key === key) || (key === DEDUCTION.key ? DEDUCTION : null);

/* ------------------------------------------------------------- stav ---- */

const state = { fines: [], status: "connecting", ready: false };

let db = null;

function finesCol() { return collection(db, "artifacts", APP_ID, "public", "data", "fines"); }

/* ---------------------------------------------------------------- start ---
   Anonymní přihlášení proběhne pro každého návštěvníka (i bez zadání
   hesla) – jinak by Firestore pravidla nepustila ani čtení. Heslo teprve
   odemyká admin tlačítka v UI.
   ------------------------------------------------------------------- */

try {
    const app = initializeApp(FIREBASE_CONFIG);
    const auth = getAuth(app);
    db = getFirestore(app);

    signInAnonymously(auth).catch(err => {
        console.error("Anonymní přihlášení k Firebase selhalo:", err);
        setStatus("offline");
    });

    onAuthStateChanged(auth, (user) => {
        if (!user) return;
        const q = query(finesCol(), orderBy("createdAt", "desc"));
        onSnapshot(q, (snapshot) => {
            state.fines = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
            state.ready = true;
            setStatus("online");
            renderAll();
        }, (err) => {
            console.error("Firestore chyba:", err);
            setStatus("offline");
        });
    });
} catch (err) {
    console.error("Firebase se nepodařilo nastartovat:", err);
    setStatus("offline");
}

function setStatus(s) {
    state.status = s;
    const el = document.getElementById("connStatus");
    if (!el) return;
    el.dataset.state = s;
    el.textContent = s === "online" ? "● Online" : s === "offline" ? "● Offline" : "● Připojuji…";
}

/* -------------------------------------------------------------- admin ---- */

const AdminStore = {
    get name() { return localStorage.getItem("dorostAdminName") || ""; },
    set name(v) { localStorage.setItem("dorostAdminName", v); },
    get on() { return localStorage.getItem("dorostAdminOn") === "1"; },
    set on(v) { v ? localStorage.setItem("dorostAdminOn", "1") : localStorage.removeItem("dorostAdminOn"); }
};

function isAdmin() { return AdminStore.on && !!AdminStore.name; }

function updateAuthUI() {
    const loginBtn = document.getElementById("loginBtn");
    const authbox = document.getElementById("authbox");
    const nameEl = document.getElementById("authName");
    if (isAdmin()) {
        loginBtn.hidden = true;
        authbox.hidden = false;
        nameEl.textContent = AdminStore.name;
    } else {
        loginBtn.hidden = false;
        authbox.hidden = true;
    }
    document.querySelectorAll(".pcard__admin").forEach(el => el.classList.toggle("is-on", isAdmin()));
    document.getElementById("archiveSection").hidden = !isAdmin();
}

/* ------------------------------------------------------------- pomocné ---- */

const money = (n) => (n > 0 ? "+" : "") + n.toLocaleString("cs-CZ") + " Kč";
const initials = (name) => name.split(" ").filter(Boolean).slice(0, 2).map(w => w[0]).join("").toUpperCase();
const czDateTime = (ts) => {
    if (!ts || !ts.toDate) return "…";
    const d = ts.toDate();
    return d.toLocaleDateString("cs-CZ") + " " + d.toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" });
};

function sumsForPlayer(playerId) {
    const rows = new Map();
    let total = 0;
    state.fines.filter(f => f.playerId === playerId).forEach(f => {
        total += f.amount;
        const key = f.typeKey === OTHER_KEY ? (OTHER_KEY + "|" + (f.note || "")) : f.typeKey;
        const prev = rows.get(key) || { label: f.typeKey === OTHER_KEY ? ("Ostatní – " + (f.note || "bez popisu")) : f.label, amount: 0 };
        prev.amount += f.amount;
        rows.set(key, prev);
    });
    return { rows: Array.from(rows.values()), total };
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
    host.innerHTML = PLAYERS.map(p => {
        const { rows, total } = sumsForPlayer(p.id);
        const breakdown = rows.length
            ? rows.map(r => `
                <div class="brow">
                    <span class="brow__label">${esc(r.label)}</span>
                    <span class="brow__amount${r.amount < 0 ? " brow__amount--ok" : ""}">${money(r.amount)}</span>
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
                <div class="pcard__avatar">${esc(initials(p.name))}</div>
                <div class="pcard__name">${esc(p.name)}</div>
                <div class="pcard__total${total <= 0 ? " pcard__total--zero" : ""}">
                    <b>${total === 0 ? "0 Kč" : money(total)}</b>
                    <span>celkem</span>
                </div>
            </div>
            <div class="pcard__body">
                <div class="pcard__breakdown">${breakdown}</div>
            </div>
            <div class="pcard__admin">
                <div class="finebtns">
                    ${fineBtns}
                    <button type="button" class="finebtn finebtn--ok" data-player="${p.id}" data-type="${DEDUCTION.key}">
                        ${esc(DEDUCTION.btn)} <span class="finebtn__amount">${DEDUCTION.amount} Kč</span>
                    </button>
                    <button type="button" class="finebtn finebtn--other" data-player="${p.id}" data-type="${OTHER_KEY}">
                        + Jiná pokuta (Ostatní)
                    </button>
                </div>
            </div>
        </div>`;
    }).join("");

    document.querySelectorAll(".finebtn").forEach(btn => {
        btn.addEventListener("click", () => onFineClick(btn.dataset.player, btn.dataset.type));
    });
    updateAuthUI();
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
                <td>${esc(f.typeKey === OTHER_KEY ? ("Ostatní – " + (f.note || "")) : f.label)}</td>
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

function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ---------------------------------------------------------------- akce ---- */

async function saveFine({ playerId, playerName, typeKey, label, amount, note }) {
    try {
        await addDoc(finesCol(), {
            playerId, playerName, typeKey, label: label || null, amount, note: note || null,
            addedBy: AdminStore.name, createdAt: serverTimestamp()
        });
        toast(`${playerName}: ${money(amount)} zapsáno`);
    } catch (err) {
        console.error(err);
        toast("Nepodařilo se zapsat – zkontroluj připojení.");
    }
}

async function onDeleteFine(id) {
    if (!isAdmin()) return;
    if (!confirm("Opravdu smazat tento záznam?")) return;
    try {
        await deleteDoc(doc(db, "artifacts", APP_ID, "public", "data", "fines", id));
        toast("Záznam smazán");
    } catch (err) {
        console.error(err);
        toast("Smazání se nepovedlo.");
    }
}

function onFineClick(playerId, typeKey) {
    if (!isAdmin()) return;
    const player = PLAYERS.find(p => p.id === playerId);
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
    overlay.classList.add("is-open");
    overlay.dataset.playerId = player.id;
    overlay.dataset.playerName = player.name;
    setTimeout(() => document.getElementById("customAmount").focus(), 50);
}

function openMinutesModal(player, fineType) {
    const overlay = document.getElementById("minutesOverlay");
    document.getElementById("minutesPlayerName").textContent = player.name;
    document.getElementById("minutesValue").value = "";
    document.getElementById("minutesErr").classList.remove("is-on");
    overlay.classList.add("is-open");
    overlay.dataset.playerId = player.id;
    overlay.dataset.playerName = player.name;
    overlay.dataset.typeKey = fineType.key;
    overlay.dataset.rate = fineType.amount;
    setTimeout(() => document.getElementById("minutesValue").focus(), 50);
}

function closeOverlays() {
    document.querySelectorAll(".overlay").forEach(o => o.classList.remove("is-open"));
}

let toastTimer = null;
function toast(msg) {
    const el = document.getElementById("toast");
    el.textContent = msg;
    el.classList.add("is-on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("is-on"), 2600);
}

/* --------------------------------------------------------------- init ---- */

document.addEventListener("DOMContentLoaded", () => {
    renderCatalog();
    renderPlayers();
    renderArchive();
    updateAuthUI();

    document.getElementById("loginBtn").addEventListener("click", () => {
        document.getElementById("loginName").value = AdminStore.name || "";
        document.getElementById("loginPassword").value = "";
        document.getElementById("loginErr").classList.remove("is-on");
        document.getElementById("loginOverlay").classList.add("is-open");
        setTimeout(() => document.getElementById("loginName").focus(), 50);
    });

    document.getElementById("logoutBtn").addEventListener("click", () => {
        AdminStore.on = false;
        updateAuthUI();
        renderPlayers();
        toast("Odhlášeno");
    });

    document.getElementById("loginForm").addEventListener("submit", (e) => {
        e.preventDefault();
        const name = document.getElementById("loginName").value.trim();
        const pass = document.getElementById("loginPassword").value;
        const err = document.getElementById("loginErr");
        if (!name) { err.textContent = "Zadej své jméno."; err.classList.add("is-on"); return; }
        if (pass !== ADMIN_PASSWORD) { err.textContent = "Špatné heslo."; err.classList.add("is-on"); return; }
        AdminStore.name = name;
        AdminStore.on = true;
        closeOverlays();
        updateAuthUI();
        renderPlayers();
        toast(`Přihlášen(a) jako ${name}`);
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

    document.querySelectorAll("[data-close]").forEach(el => el.addEventListener("click", closeOverlays));
    document.querySelectorAll(".overlay").forEach(o => {
        o.addEventListener("click", (e) => { if (e.target === o) closeOverlays(); });
    });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeOverlays(); });
});
