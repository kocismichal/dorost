/* ==========================================================================
   FK AGRO VNOROVY – PLAKÁTY · data
   Znaky klubů, názvy soutěží a celé rozlosování podzimu 2026.
   Tenhle soubor je jen výchozí stav. Co se upraví na webu, se uloží do
   databáze a při dalším načtení má přednost.
   ========================================================================== */

export const LOGA = ["agroken-dorost.png","blatnice.jpg","breclav.png","brumovice.png","bzenec.jpg",
"charvatska-nova-ves.jpg","damborice.jpg","dolni-bojanovice.jpg","domanin.png",
"dubnany.png","hodonin.png","hroznova-lhota.png","hruba-vrbka.png","knezdub.png",
"kostelec.jpg","kozojidky.png","krivky.png","krumvir.png","kyjov.png","lanzhot.png",
"lipov.png","luzice.jpg","lysovice.png","milotice.png","moravsky-pisek.png",
"mutenice.png","nasedlovice.jpg","nikolcice.png","nova-lhota.jpg","orechov.png",
"petrov.jpg","poddvorov.png","podluzi.png","podoli.png","prusanky.png",
"ratiskovice.jpg","rohatec.png","sardice.jpg","slatina.png","start-brno.png",
"straznice.jpg","suchov.jpg","temice.png","tesany.jpg","tvarozna-lhota.png",
"uhersky-brod.png","vacenovice.png","velka-nad-velickou.png","velke-pavlovice.png",
"veseli-nad-moravou.png","vnorovy.png","vojkovice.png","vyskov.png","zadovice.jpg",
"zarazice.png","zdanice.jpg","zeravice.png","zidlochovice.jpg"];

/* =======================================================================
   2) NÁZVY SOUTĚŽÍ — mění se jen tady, propíšou se do všech víkendů
   ======================================================================= */
export const SOUTEZE = {
  A: "6. LIGA DOSPĚLÍ JMKFS (B)",
  B: "9. LIGA DOSPĚLÍ SK. C",
  D: "5. LIGA STARŠÍHO DOROSTU JMKFS (C)"
};
export const TYMY = { A:"A-TÝM", B:"BENFIKA", D:"DOROST" };

/* =======================================================================
   3) CELÝ PODZIM 2026 z rozlosování
      doma / domaM:  [kategorie, soupeř, logo, den, čas]
      venku:         [kategorie, soupeř, logo, čas]
      tyden:         [kategorie, hrajeme doma?, soupeř, den, čas]
   ======================================================================= */
export const SEZONA = [
{ id:"15.—16. 8.", datum:"15.—16.", mesic:"SRPNA 2026",
  doma:[["A","FK MUTĚNICE","mutenice.png","NEDĚLE 16. 8.","16:30"]],
  domaM:[],
  venku:[["DOROST","PRUŠÁNKY","prusanky.png","SO 10:00"]], tyden:[] },

/* POZOR: zápasy starších a mladších žáků s Rohatcem se tento víkend nehrají –
   přeloženy na ČT 10. 9. cca 17:00 (v rozlosování u nich bylo místo data „???“).
   Až Michal termín potvrdí, patří jako zápasy mimo víkend na plakát
   4. kola (5.—6. 9.) do bloku V TÝDNU. */
{ id:"22.—23. 8.", datum:"22.—23.", mesic:"SRPNA 2026",
  doma:[["B","TJ HRUBÁ VRBKA","hruba-vrbka.png","SOBOTA 22. 8.","16:30"],
        ["D","SK PODLUŽÍ","podluzi.png","NEDĚLE 23. 8.","16:30"]],
  domaM:[],
  venku:[["A-TÝM","DUBŇANY","dubnany.png","SO 16:30"],
         ["ST. PŘÍPRAVKA","HODONÍN B","hodonin.png","SO 10:00"],
         ["ML. PŘÍPRAVKA","TĚMICE B","temice.png","SO 10:00"]], tyden:[] },

{ id:"29.—30. 8.", datum:"29.—30.", mesic:"SRPNA 2026",
  doma:[["A","VESELÍ NAD MORAVOU","veseli-nad-moravou.png","NEDĚLE 30. 8.","16:30"],
        ["B","SUCHOV","suchov.jpg","NEDĚLE 30. 8.","13:45"]],
  domaM:[["ST. PŘÍPRAVKA","BLATNICE","blatnice.jpg","NEDĚLE","14:00"],
         ["ML. PŘÍPRAVKA","BLATNICE","blatnice.jpg","NEDĚLE","14:00"]],
  venku:[["DOROST","RATÍŠKOVICE A","ratiskovice.jpg","SO 14:15"],
         ["ST. ŽÁCI","MILOTICE/SVATOBOŘICE","milotice.png","SO 14:30"],
         ["ML. ŽÁCI","VELKÁ/BLATNICE","velka-nad-velickou.png","SO 10:00"]],
  tyden:[["ST. ŽÁCI", false, "HR. LHOTA/LIPOV", "ST 2. 9.", "17:30"]] },

{ id:"5.—6. 9.", datum:"5.—6.", mesic:"ZÁŘÍ 2026",
  doma:[["D","LANŽHOT","lanzhot.png","SOBOTA 5. 9.","10:00"]],
  domaM:[["ST. ŽÁCI","PETROV","petrov.jpg","SOBOTA","14:00"],
         ["ML. ŽÁCI","BZENEC-VRACOV B","bzenec.jpg","SOBOTA","12:30"]],
  venku:[["A-TÝM","ŽIDLOCHOVICE","zidlochovice.jpg","SO 16:00"],
         ["BENFIKA","TVAROŽNÁ LHOTA","tvarozna-lhota.png","NE 15:00"],
         ["ST. PŘÍPRAVKA","HR. LHOTA","hroznova-lhota.png","SO 10:00"],
         ["ML. PŘÍPRAVKA","HR. LHOTA","hroznova-lhota.png","NE 10:00"]],
  tyden:[["ML. PŘÍPRAVKA", true, "LIPOV", "ÚT 8. 9.", "16:30"]] },

{ id:"12.—13. 9.", datum:"12.—13.", mesic:"ZÁŘÍ 2026",
  doma:[["A","VELKÉ PAVLOVICE","velke-pavlovice.png","SOBOTA 12. 9.","16:00"],
        ["B","LIPOV","lipov.png","SOBOTA 12. 9.","13:15"]],
  domaM:[["ST. PŘÍPRAVKA","KNĚŽDUB","knezdub.png","NEDĚLE","10:00"],
         ["ML. PŘÍPRAVKA","KNĚŽDUB","knezdub.png","NEDĚLE","10:00"]],
  venku:[["DOROST","HR. LHOTA/LIPOV","hroznova-lhota.png","NE 13:45"],
         ["ST. ŽÁCI","NÁSEDLOVICE/ŽAROŠICE","nasedlovice.jpg","NE 13:30"],
         ["ML. ŽÁCI","ŽÁDOVICE/JEŽOV","zadovice.jpg","NE 14:00"]], tyden:[] },

{ id:"19.—20. 9.", datum:"19.—20.", mesic:"ZÁŘÍ 2026",
  doma:[["D","ROHATEC","rohatec.png","SOBOTA 19. 9.","15:30"]],
  domaM:[["ST. ŽÁCI","LUŽICE","luzice.jpg","SOBOTA","13:30"]],
  venku:[["A-TÝM","KYJOV","kyjov.png","NE 10:15"],
         ["BENFIKA","VELKÁ B","velka-nad-velickou.png","NE 10:00"],
         ["ST. PŘÍPRAVKA","STRÁŽNICE","straznice.jpg","NE 10:00"],
         ["ML. PŘÍPRAVKA","STRÁŽNICE","straznice.jpg","NE 10:00"]], tyden:[] },

{ id:"26.—27. 9.", datum:"26.—27.", mesic:"ZÁŘÍ 2026",
  doma:[["A","LYSOVICE","lysovice.png","NEDĚLE 27. 9.","15:30"],
        ["B","NOVÁ LHOTA","nova-lhota.jpg","NEDĚLE 27. 9.","12:45"]],
  domaM:[["ST. PŘÍPRAVKA","VESELÍ NAD MORAVOU","veseli-nad-moravou.png","SOBOTA","16:00"],
         ["ML. PŘÍPRAVKA","VESELÍ NAD MORAVOU","veseli-nad-moravou.png","SOBOTA","16:00"]],
  venku:[["DOROST","KYJOV","kyjov.png","SO 10:00"],
         ["ST. ŽÁCI","ŽDÁNICE","zdanice.jpg","NE 13:15"],
         ["ML. ŽÁCI","ZARAZICE","zarazice.png","NE 10:00"]],
  tyden:[["ML. PŘÍPRAVKA", false, "BZENEC-VRACOV B", "ST 30. 9.", "17:00"]] },

{ id:"3.—4. 10.", datum:"3.—4.", mesic:"ŘÍJNA 2026",
  doma:[["B","VESELÍ B","veseli-nad-moravou.png","NEDĚLE 4. 10.","15:00"],
        ["D","TĚŠANY","tesany.jpg","NEDĚLE 4. 10.","12:15"]],
  domaM:[["ST. ŽÁCI","TĚMICE","temice.png","NEDĚLE","10:45"],
         ["ML. ŽÁCI","TĚMICE","temice.png","NEDĚLE","9:15"],
         ["ST. PŘÍPRAVKA","PETROV","petrov.jpg","SOBOTA","10:00"],
         ["ML. PŘÍPRAVKA","PETROV","petrov.jpg","SOBOTA","10:00"]],
  venku:[["A-TÝM","ŠARDICE","sardice.jpg","SO 15:00"]], tyden:[] },

{ id:"10.—11. 10.", datum:"10.—11.", mesic:"ŘÍJNA 2026",
  doma:[["A","START BRNO","start-brno.png","SOBOTA 10. 10.","15:00"]],
  domaM:[],
  venku:[["DOROST","DUBŇANY/MUTĚNICE","dubnany.png","NE 12:30"],
         ["ST. ŽÁCI","STRÁŽNICE/VESELÍ","straznice.jpg","SO 9:00"],
         ["ML. ŽÁCI","STRÁŽNICE/VESELÍ","straznice.jpg","SO 11:00"],
         ["ST. PŘÍPRAVKA","VELKÁ N. VELIČKOU","velka-nad-velickou.png","NE 10:00"],
         ["ML. PŘÍPRAVKA","VELKÁ N. VELIČKOU","velka-nad-velickou.png","NE 10:00"]], tyden:[] },

{ id:"17.—18. 10.", datum:"17.—18.", mesic:"ŘÍJNA 2026",
  doma:[["A","FK MILOTICE","milotice.png","SOBOTA 17. 10.","14:30"]],
  domaM:[["ST. ŽÁCI","RATÍŠKOVICE B","ratiskovice.jpg","NEDĚLE","12:15"],
         ["ST. PŘÍPRAVKA","LIPOV","lipov.png","NEDĚLE","10:00"],
         ["ML. PŘÍPRAVKA","TĚMICE A","temice.png","NEDĚLE","10:00"]],
  venku:[["BENFIKA","PETROV","petrov.jpg","NE 14:30"],
         ["DOROST","HODONÍN B","hodonin.png","SO 10:00"]],
  tyden:[["ML. ŽÁCI", false, "HR. LHOTA/LIPOV", "PÁ 16. 10.", "16:45"]] },

{ id:"24.—25. 10.", datum:"24.—25.", mesic:"ŘÍJNA 2026",
  doma:[["B","KOZOJÍDKY","kozojidky.png","SOBOTA 24. 10.","14:30"],
        ["D","VELKÁ NAD VELIČKOU","velka-nad-velickou.png","SOBOTA 24. 10.","11:45"]],
  domaM:[],
  venku:[["A-TÝM","HROZNOVÁ LHOTA","hroznova-lhota.png","NE 14:30"],
         ["ST. ŽÁCI","VACENOVICE","vacenovice.png","SO 14:30"],
         ["ST. PŘÍPRAVKA","ROHATEC","rohatec.png","SO 10:00"]], tyden:[] },

{ id:"31. 10.—1. 11.", datum:"31. 10.—1. 11.", mesic:"2026",
  doma:[["D","BŘECLAV B","breclav.png","NEDĚLE 1. 11.","14:00"]],
  domaM:[["ST. PŘÍPRAVKA","TĚMICE","temice.png","NEDĚLE","11:00"],
         ["ML. PŘÍPRAVKA","ZARAZICE","zarazice.png","NEDĚLE","11:00"]],
  venku:[["A-TÝM","VOJKOVICE","vojkovice.png","SO 14:00"],
         ["ST. ŽÁCI","BLATNICE/VELKÁ","velka-nad-velickou.png","NE 13:30"]], tyden:[] },

{ id:"7.—8. 11.", datum:"7.—8.", mesic:"LISTOPADU 2026",
  doma:[["A","DAMBOŘICE","damborice.jpg","SOBOTA 7. 11.","14:00"]],
  domaM:[["ST. ŽÁCI","KOSTELEC","kostelec.jpg","SOBOTA","11:30"]],
  venku:[["DOROST","VELKÉ PAVLOVICE/BOŘETICE","velke-pavlovice.png","NE 14:00"]], tyden:[] }
];

/* =======================================================================
   4) LOGIKA
   ======================================================================= */
