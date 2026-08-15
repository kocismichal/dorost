/* ==========================================================================
   FK AGRO VNOROVY – DOROST · sdílené jádro
   Používají ho obě stránky (pokutníček i kanadské body): napojení na
   Firebase, přihlášení "admina", soupiska hráčů a pár drobných pomocníků.
   Konfigurace a heslo tak žijí na jednom místě.
   ========================================================================== */

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import {
    getFirestore, collection, doc, onSnapshot, query, orderBy, writeBatch
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

/* ---------------------------------------------------------------- config ---
   TOTO DOPLŇ podle vlastního Firebase projektu (Firebase Console →
   Project settings → General → Your apps → SDK setup and configuration).
   ---------------------------------------------------------------------- */
const FIREBASE_CONFIG = {
    apiKey: "AIzaSyAkDXYhRK3YwNlg00PntMJ88qVwyHkT7Fw",
    authDomain: "dorost-vnorovy.firebaseapp.com",
    projectId: "dorost-vnorovy",
    storageBucket: "dorost-vnorovy.firebasestorage.app",
    messagingSenderId: "547110091681",
    appId: "1:547110091681:web:e417f869fba98fd85169e0"
};
const APP_ID = "dorost-pokuty";
const ADMIN_PASSWORD = "AgroDorost26";

/* ------------------------------------------------------------- hráči ----
   Soupiska žije v databázi, aby se dala měnit přímo na webu (po přihlášení).
   Tenhle seznam je jen výchozí stav – použije se, dokud soupisku někdo
   poprvé neuloží. Ruční úpravy tady proto nemají smysl, měň ji na webu.

   Vnitřní ID je natvrdo a záměrně neodpovídá jménu – vzniklo z původního
   zápisu „příjmení jméno“. Zápisy pokut i gólů se na hráče vážou přes tohle
   ID, takže přejmenování hráče nesmí ID měnit, jinak by se záznamy odpojily.
   ------------------------------------------------------------------- */

export const DEFAULT_PLAYERS = [
    ["chudik-vit",       "Vít Chudík"],
    ["janousek-tobias",  "Tobiáš Janoušek"],
    ["kominek-stepan",   "Štěpán Komínek"],
    ["kucera-david",     "David Kučera"],
    ["smetka-michal",    "Michal Smetka"],
    ["ivan-marian",      "Marián Ivan"],
    ["tomecek-denis",    "Denis Tomeček"],
    ["ficnar-tobias",    "Tobias Ficnar"],
    ["herodes-lukas",    "Lukáš Herodes"],
    ["hribek-josef",     "Josef Hříbek"],
    ["chudik-simon",     "Šimon Chudík"],
    ["palenik-krystof",  "Kryštof Páleník"],
    ["slavik-david",     "David Slavík"],
    ["bellingham",       "Bellingham"],
    ["vsetula-jakub",    "Jakub Všetula"],
    ["knotek-petr",      "Petr Knotek"],
    ["konecny-adam",     "Adam Konečný"],
    ["kren-tomas",       "Tomáš Křen"],
    ["krizka-matyas",    "Matyáš Křižka"],
    ["neumann-jiri",     "Jiří Neumann"],
    ["hala-patrik",      "Patrik Hála"],
    ["stepan-machacek",  "Štěpán Macháček"]
].map(([id, name], i) => ({ id, name, order: i }));

export function slug(str) {
    return str.normalize("NFD").replace(/[̀-ͯ]/g, "")
        .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/* ------------------------------------------------------------ databáze ---- */

export let db = null;

/** Kolekce pod společným kořenem projektu (fines, players, matches, goals…). */
export function col(name)      { return collection(db, "artifacts", APP_ID, "public", "data", name); }
export function docIn(name, id) { return doc(db, "artifacts", APP_ID, "public", "data", name, id); }

/* Dokud soupisku nikdo neuložil, jede se podle výchozího seznamu. Příznak
   v databázi (rosterSaved) odlišuje „ještě se needitovalo“ od „všichni hráči
   byli smazáni“ – jinak by se po smazání posledního hráče vrátil výchozí
   seznam zpátky. */
const rosterState = { players: [], saved: false };
const rosterSubs = [];

export function roster() { return rosterState.saved ? rosterState.players : DEFAULT_PLAYERS; }
export function playerById(id) { return roster().find(p => p.id === id); }

/** Zavolá se pokaždé, když se soupiska změní (i při prvním načtení). */
export function onRoster(cb) { rosterSubs.push(cb); }
function rosterChanged() { rosterSubs.forEach(cb => cb()); }

/* Před první úpravou se výchozí seznam musí uložit do databáze, jinak by
   se přidaný hráč mísil s pevným seznamem v kódu a odebrání by nefungovalo. */
export async function saveDefaultRoster() {
    if (rosterState.saved) return;
    const batch = writeBatch(db);
    DEFAULT_PLAYERS.forEach(p => batch.set(docIn("players", p.id), { name: p.name, order: p.order }));
    batch.set(docIn("meta", "config"), { rosterSaved: true }, { merge: true });
    await batch.commit();
    rosterState.saved = true;
    rosterState.players = DEFAULT_PLAYERS.map(p => ({ ...p }));
}

/** Nejvyšší pořadí na soupisce +1 – pro nově přidaného hráče. */
export function nextRosterOrder() {
    return roster().reduce((max, p) => Math.max(max, p.order ?? 0), -1) + 1;
}

/* ---------------------------------------------------------------- start ---
   Anonymní přihlášení proběhne pro každého návštěvníka (i bez zadání
   hesla) – jinak by Firestore pravidla nepustila ani čtení. Heslo teprve
   odemyká admin tlačítka v UI.
   ------------------------------------------------------------------- */

let authed = false;
const authWaiters = [];

/** Spustí callback, jakmile je připojení k databázi připravené. */
export function whenReady(cb) { authed ? cb() : authWaiters.push(cb); }

export function onDbError(err) {
    console.error("Firestore chyba:", err);
    setStatus("offline");
}

try {
    const app = initializeApp(FIREBASE_CONFIG);
    const auth = getAuth(app);
    db = getFirestore(app);

    signInAnonymously(auth).catch(err => {
        console.error("Anonymní přihlášení k Firebase selhalo:", err);
        setStatus("offline");
    });

    onAuthStateChanged(auth, (user) => {
        if (!user || authed) return;
        authed = true;

        onSnapshot(query(col("players"), orderBy("order")), (snapshot) => {
            rosterState.players = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
            rosterChanged();
        }, onDbError);

        onSnapshot(docIn("meta", "config"), (snapshot) => {
            rosterState.saved = snapshot.exists() && snapshot.data().rosterSaved === true;
            rosterChanged();
        }, onDbError);

        authWaiters.splice(0).forEach(cb => cb());
    });
} catch (err) {
    console.error("Firebase se nepodařilo nastartovat:", err);
    setStatus("offline");
}

export function setStatus(s) {
    const el = document.getElementById("connStatus");
    if (!el) return;
    el.dataset.state = s;
    el.textContent = s === "online" ? "● Online" : s === "offline" ? "● Offline" : "● Připojuji…";
}

/* -------------------------------------------------------------- admin ----
   Přihlášení je jen na straně prohlížeče (společné heslo pro celý tým) –
   slouží k odemčení tlačítek pro zápis, ne jako bezpečnostní bariéra.
   ------------------------------------------------------------------- */

export const AdminStore = {
    get name() { return localStorage.getItem("dorostAdminName") || ""; },
    set name(v) { localStorage.setItem("dorostAdminName", v); },
    get on() { return localStorage.getItem("dorostAdminOn") === "1"; },
    set on(v) { v ? localStorage.setItem("dorostAdminOn", "1") : localStorage.removeItem("dorostAdminOn"); }
};

export function isAdmin() { return AdminStore.on && !!AdminStore.name; }

/** Skryje/odkryje vše s třídou .admin-only a přepne hlavičku. */
export function updateAuthUI() {
    const loginBtn = document.getElementById("loginBtn");
    const authbox = document.getElementById("authbox");
    if (loginBtn && authbox) {
        loginBtn.hidden = isAdmin();
        authbox.hidden = !isAdmin();
        if (isAdmin()) document.getElementById("authName").textContent = AdminStore.name;
    }
    document.querySelectorAll(".admin-only").forEach(el => { el.hidden = !isAdmin(); });
}

/**
 * Napojí přihlašovací tlačítka a formulář v hlavičce.
 * onChange se zavolá po přihlášení i odhlášení, ať stránka překreslí obsah.
 */
export function initAuth(onChange) {
    const done = () => { updateAuthUI(); onChange && onChange(); };

    document.getElementById("loginBtn").addEventListener("click", () => {
        document.getElementById("loginName").value = AdminStore.name || "";
        document.getElementById("loginPassword").value = "";
        document.getElementById("loginErr").classList.remove("is-on");
        document.getElementById("loginOverlay").classList.add("is-open");
        setTimeout(() => document.getElementById("loginName").focus(), 50);
    });

    document.getElementById("logoutBtn").addEventListener("click", () => {
        AdminStore.on = false;
        done();
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
        done();
        toast(`Přihlášen(a) jako ${name}`);
    });

    /* zavírání modalů – křížek, tlačítko Zrušit, klik mimo, Escape */
    document.querySelectorAll("[data-close]").forEach(el => el.addEventListener("click", closeOverlays));
    document.querySelectorAll(".overlay").forEach(o => {
        o.addEventListener("click", (e) => { if (e.target === o) closeOverlays(); });
    });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeOverlays(); });

    updateAuthUI();
}

/* ------------------------------------------------------------- pomocné ---- */

export function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export const money = (n) => (n > 0 ? "+" : "") + n.toLocaleString("cs-CZ") + " Kč";

export const czDate = (ts) => (ts && ts.toDate ? ts.toDate().toLocaleDateString("cs-CZ") : "…");

export const czDateTime = (ts) => {
    if (!ts || !ts.toDate) return "…";
    const d = ts.toDate();
    return d.toLocaleDateString("cs-CZ") + " " + d.toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" });
};

/** "2026-08-15" → "15. 8. 2026" (datum zápasu se ukládá jako text z inputu). */
export function czDay(iso) {
    if (!iso) return "";
    const [y, m, d] = String(iso).split("-");
    return `${Number(d)}. ${Number(m)}. ${y}`;
}

export function closeOverlays() {
    document.querySelectorAll(".overlay").forEach(o => o.classList.remove("is-open"));
}

export function openOverlay(id) {
    document.getElementById(id).classList.add("is-open");
}

let toastTimer = null;
export function toast(msg) {
    const el = document.getElementById("toast");
    if (!el) return;
    el.textContent = msg;
    el.classList.add("is-on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("is-on"), 2600);
}
