/* ==========================================================================
   FK AGRO VNOROVY – PRO HRÁČE
   Statická stránka s přehledem regenerace, pomůcek a jídla. Z databáze nic
   nečte – jádro se načítá jen kvůli hlavičce (stav připojení, přihlášení).
   ========================================================================== */

import { whenReady, setStatus, initAuth } from "./core.js?v=9";

initAuth();
whenReady(() => setStatus("online"));

document.getElementById("printBtn").addEventListener("click", () => window.print());
