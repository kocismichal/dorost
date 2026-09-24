/* ==========================================================================
   FK AGRO VNOROVY – DOROST · rozpis zápasů
   Podzim 2026, 5. liga staršího dorostu JMKFS (C) – podle rozlosování
   na fotbal.cz (stejné termíny jako v plakat-data.js).
   Na stránce Kanadské body se z každého řádku stane karta zápasu, ke které
   se po přihlášení zapíše výsledek a branky.

   id se používá jako id dokumentu v databázi – NEMĚNIT u už odehraných
   zápasů, jinak se výsledek od zápasu odpojí.
   ========================================================================== */

export const ROZPIS = [
    { id: "podzim26-01", date: "2026-08-15", time: "10:00", venue: "venku", opponent: "Prušánky" },
    { id: "podzim26-02", date: "2026-08-23", time: "16:30", venue: "doma",  opponent: "SK Podluží" },
    { id: "podzim26-03", date: "2026-08-29", time: "14:15", venue: "venku", opponent: "Ratíškovice A" },
    { id: "podzim26-04", date: "2026-09-05", time: "10:00", venue: "doma",  opponent: "Lanžhot" },
    { id: "podzim26-05", date: "2026-09-13", time: "13:45", venue: "venku", opponent: "Hroznová Lhota/Lipov" },
    { id: "podzim26-06", date: "2026-09-19", time: "15:30", venue: "doma",  opponent: "Rohatec" },
    { id: "podzim26-07", date: "2026-09-26", time: "10:00", venue: "venku", opponent: "Kyjov" },
    { id: "podzim26-08", date: "2026-10-04", time: "12:15", venue: "doma",  opponent: "Těšany" },
    { id: "podzim26-09", date: "2026-10-11", time: "12:30", venue: "venku", opponent: "Dubňany/Mutěnice" },
    { id: "podzim26-10", date: "2026-10-17", time: "10:00", venue: "venku", opponent: "Hodonín B" },
    { id: "podzim26-11", date: "2026-10-24", time: "11:45", venue: "doma",  opponent: "Velká nad Veličkou" },
    { id: "podzim26-12", date: "2026-11-01", time: "14:00", venue: "doma",  opponent: "Břeclav B" },
    { id: "podzim26-13", date: "2026-11-08", time: "14:00", venue: "venku", opponent: "Velké Pavlovice/Bořetice" }
];
