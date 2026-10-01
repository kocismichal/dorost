# FK Agro Vnorovy – Dorost

Statický web týmu. Běží na GitHub Pages, data se ukládají do Firebase
Firestore, takže je vidí všichni živě. Stránky:

- **Pokutníček** (`index.html`) – pokuty hráčů
- **Kanadské body** (`kanadske-body.html`) – zápasy, góly a asistence
- **Docházka** (`dochazka.html`) – docházka dorostu, automaticky z Týmuj
- **Plakáty** (`plakaty.html`) – plakát A3 na víkend
- **Taktika** (`taktika.html`) – taktická tabule: rozestavení, rohy, pokyny
- **Pro hráče** (`pro-hrace*.html`) – přehled k nastudování, 5 podstránek: přehled, rozcvička a prevence, regenerace, jídlo a pití, otázky

Platí pro všechny:

- **Prohlížení** – veřejné, bez přihlášení.
- **Zápis** – jen po přihlášení (tlačítko vpravo nahoře). Heslo je společné
  pro celý tým, jméno slouží pouze k archivaci (kdo co zapsal).
  V kódu (`assets/js/core.js`) je jen otisk hesla (SHA-256 se solí), ne heslo samotné;
  jak vyrobit otisk pro nové heslo, je v komentáři u `ADMIN_PASSWORD_HASH`.

## Struktura

```
index.html               pokutníček
kanadske-body.html       kanadské bodování
dochazka.html            docházka dorostu z Týmuj
plakaty.html             plakáty na víkend
taktika.html             taktická tabule
pro-hrace.html           Pro hráče – přehled (týden, pondělí, den zápasu, bolest)
pro-hrace-rozcvicka.html   – rozcvička a prevence (FIFA 11+, guma)
pro-hrace-regenerace.html  – regenerace (válec, míček, spánek)
pro-hrace-jidlo.html       – jídlo a pití (kolem tréninku, strava a doplňky, pití)
pro-hrace-kviz.html        – otázky k nastudování
assets/css/app.css       styly webu
assets/css/plakat.css    styly plakátu (zapouzdřené pod #plakatApp)
assets/css/taktika.css   styly taktické tabule
assets/css/pro-hrace.css styly stránky Pro hráče
assets/js/dochazka.js    zobrazení docházky
assets/js/tymuj.js       stažení docházky z Týmuj + zápis do databáze (sdílí web i synchronizace)
assets/css/dochazka.css  styly docházky
scripts/tymuj-sync.mjs   synchronizace Týmuj → databáze (Node, pouští GitHub Actions)
scripts/tymuj-pokuty.mjs pondělní zápis pokut z docházky do pokutníčku
scripts/spolecne.mjs     konfigurace Firebase a token pro skripty
.github/workflows/tymuj-sync.yml    plán synchronizace (3× denně)
.github/workflows/tymuj-pokuty.yml  pokuty z docházky (každé pondělí)
assets/js/core.js        sdílené jádro – Firebase, přihlášení, soupiska
assets/js/app.js         logika pokut
assets/js/points.js      logika kanadských bodů
assets/js/rozpis-dorost.js rozpis zápasů dorostu (podzim 2026) pro kanadské body
assets/js/plakaty.js     logika plakátů
assets/js/plakat-data.js znaky, soutěže a rozlosování podzimu 2026
assets/js/taktika.js     logika taktické tabule
assets/js/pro-hrace.js   hlavička a tisk stránky Pro hráče
assets/plakat/znaky/     znaky klubů (58 souborů)
assets/plakat/qr/        QR kód na Instagram
assets/img/logo.png      logo klubu
```

## Nastavení před prvním nasazením

V [assets/js/core.js](assets/js/core.js) je potřeba doplnit `FIREBASE_CONFIG`
hodnotami z vlastního Firebase projektu (viz hlavní návod, který dostal
majitel webu). Bez toho web sice zobrazí design, ale zápisy se nikam
neuloží (stav nahoře ukáže „Offline“).

## Soupiska hráčů

Mění se **přímo na webu** – po přihlášení se objeví tlačítko „+ Přidat hráče“
nad seznamem a u každého hráče dole „Odebrat hráče ze soupisky“. Změna se
uloží do databáze a hned ji vidí všichni.

Odebraný hráč zmizí z přehledu, ale jeho zapsané pokuty zůstanou v historii
zápisů (kvůli dohledatelnosti).

Seznam `DEFAULT_PLAYERS` v `assets/js/core.js` je jen výchozí stav pro úplně
první spuštění – jakmile se soupiska poprvé uloží do databáze, tenhle seznam
se už nepoužívá a ruční úpravy v něm nemají efekt.

## Pokuty

Nahoře v `assets/js/app.js`:

- `FINE_TYPES` – druhy pokut (název, popis, částka, text na tlačítku)
- `DEDUCTION` – zelené tlačítko na odečet

Celková částka na kartě je prostý součet všech zápisů hráče. Nasbíraný
odečet se veze dál a umaže i pokutu, která přijde až po něm. Mínus se
nezobrazuje – místo toho je celkem 0 Kč a přebytek se vypíše jako řádek
„K dobru na příští pokuty“.

Tlačítko **Poslední zápisy** na kartě ukáže posledních 10 pohybů hráče
i s datem a tím, kdo je zapsal. Vidí ho i nepřihlášený.

## Kanadské body

Gól i asistence = 1 bod. Tabulka se řadí podle bodů, při shodě rozhoduje
víc gólů; pořadí dostanou jen hráči s aspoň jedním bodem.

Postup zápisu: nejdřív **+ Přidat zápas** (soupeř, datum, doma/venku,
výsledek), pak u zápasu **+ Přidat branku** (střelec a případná asistence).
Pokud je zapsaných branek míň, než kolik jich je ve skóre, karta zápasu na
to upozorní.

Do formuláře se **naše góly zadávají vždy vlevo**, ale v přehledu se skóre
píše klasicky od domácích – u venkovního zápasu je tedy soupeř první
(výhra 6:0 venku se ukáže jako 0:6). Výhra/prohra i barva se pořád počítají
z našeho pohledu.

**Hostující hráči** (starší žáci, co vypomůžou) se přidávají tlačítkem
„+ Přidat hostujícího hráče“. Objeví se jen v kanadském bodování označení
štítkem *st. žák*, do pokutníčku nezasahují.

Smazání zápasu smaže i jeho branky, aby body nezůstaly viset v tabulce.

## Docházka

Docházka dorostu se bere **automaticky z Týmuj** (app.tymuj.cz). Co trenér
v Týmuj opraví na skutečnou docházku, to platí i tady. Stránka data jen čte.

**Jak to běží:** GitHub Actions (`.github/workflows/tymuj-sync.yml`) spouští
3× denně `scripts/tymuj-sync.mjs`. Ten přes API Týmuj stáhne hráče
podskupiny **DOROST** a všechny odehrané události od začátku sezóny
(`TYMUJ.odData` v `assets/js/tymuj.js`) a uloží je jako jeden dokument
`dochazka/dorost` (pole `data` = JSON). Když synchronizace selže, zapíše
do dokumentu pole `chyba` a stránka ji ukáže u data aktualizace.
Ručně jde pustit v GitHubu: **Actions → Docházka z Týmuj → Run workflow**.

**Historie odpovědí:** synchronizace stahuje i časy odpovědí a kdo je zadal
(dokument `dochazka/historie`; znovu jen události z posledních 14 dní).
Na stránce: najetí na políčko v týdnu = všechny změny, klik na sloupec =
detail události, v kartě hráče u každé události. Štítek **po 12** = hráč se
do 12:00 v den tréninku nepřihlásil.

**Pokuty z docházky** (`tymuj-pokuty.yml`, každé pondělí ráno za uplynulý
týden, zapisuje jako „AI“): Nepřihlášen do 12:00 (žádná odpověď jde/nejde/
možná do 12:00 v den tréninku), Neudán důvod (výsledně „nejde“ bez
komentáře), Splnění tréninkového týdne (dorost + áčko ≥ 3 → −50 Kč). Jen
tréninky dorostu, bez hráčů v `POKUTY_VYNECHAT` (`tymuj.js`). Každý zápis
má `autoKey`, nic se nezapíše dvakrát; ručně smazaná pokuta se nevrátí.
Jiný týden: Actions → Pokuty z docházky → Run workflow → pondělí týdne.
Na stránce Docházka jsou zapsané pokuty vidět u událostí, v týdnech, měsících,
přehledu sezóny (sloupec Pokuty) i v kartě hráče – čtou se přímo z kolekce
`fines` (jen zápisy s `autoKey`), takže smazaná pokuta zmizí i tam.
**Zrušení pokuty:** přihlášený ji zruší v kartě hráče nebo v detailu události
(× u štítku → potvrdit) – nebo smazáním v pokutníčku. Pokuta se smaže a
zapíše do kolekce `pokutyZrusene` (dokument = autoKey, i s původními daty),
takže ji pondělní zápis už nikdy nevrátí. Zrušená se v kartě ukazuje
přeškrtnutě a tlačítkem ↺ jde obnovit (`zrusPokutuZDochazky` /
`obnovPokutuZDochazky` v `core.js`).

**Token do Týmuj** je v secretu repozitáře `TYMUJ_TOKEN` (nikdy ne v kódu).
Platí **60 dní**, pak synchronizace začne hlásit chybu 401. Výměna:

1. Na app.tymuj.cz (přihlášený) otevři F12 → Console a napiš
   `copy(decodeURIComponent(document.cookie.match(/userToken=([^;]+)/)[1]))`
   – token je ve schránce (Chrome se může zeptat, jestli povolit vkládání:
   napiš `allow pasting`).
2. GitHub → repo dorost → Settings → Secrets and variables → Actions →
   `TYMUJ_TOKEN` → Update, vlož, ulož. (Nebo v terminálu
   `gh secret set TYMUJ_TOKEN -R kocismichal/dorost` a vložit.)
3. Actions → Docházka z Týmuj → Run workflow.

**Co se počítá:**
- *Tréninky dorostu* = Po (kondice), Út, Čt a jiné tréninky dorostu.
  Tréninky s áčkem, přáteláky a zápasy D/B/A se počítají zvlášť. Druh se
  pozná z názvu a dne události (`druhUdalosti` v `tymuj.js`) – při nových
  názvech událostí v Týmuj zkontrolovat, kam spadnou.
- *Tréninkové jednotky* = tréninky dorostu + tréninky s áčkem (domluva:
  trénink s áčkem se počítá místo tréninku dorostu). Bez stropu, procento se
  bere z počtu tréninků dorostu, takže může být přes 100 %. Přehled sezóny
  i měsíce se řadí podle jednotek, vedle je zvlášť docházka jen dorostu.
- **Po měsících** – pořadí podle počtu tréninkových jednotek v měsíci (při
  shodě víc tréninků dorostu), medaile pro první tři, tečky za každý trénink.
  Podklad pro měsíční odměny. 
- **Karta hráče** – klik na jméno (v kterémkoli pohledu): souhrn, po měsících
  a seznam všech událostí s filtry podle druhu (Po/Út/Čt/s áčkem/zápasy…),
  stavu (byl/omluven/bez omluvy/nezapsáno) a měsíce.
- Po týdnech se zobrazuje vždy jeden týden, přepíná se šipkami nebo výběrem.
- Hráči se počítají jen události, na které byl v Týmuj pozvaný – kdo přišel
  později, má procenta od svého příchodu (na stránce štítek „od …“).
- *Omluven* = v Týmuj „nejdu“ s komentářem, *bez omluvy* = „nejdu“ bez
  komentáře, *nezapsáno* = bez odpovědi nebo „možná“.
- Text omluv vidí jen přihlášený. Je to jen skrytí v prohlížeči – v databázi
  jsou data čitelná stejně jako zbytek webu, do omluv v Týmuj tedy nepsat nic
  citlivého.

## Plakáty

Plakát A3 na šířku (420 × 297 mm) pro každé kolo podzimu. Prohlížení a tisk
jsou veřejné, úpravy jen po přihlášení.

Přepínač nahoře přepíná mezi 13 koly. Štítek vedle něj říká, jestli je kolo
**podle rozlosování** (bere se z `plakat-data.js`), nebo **upraveno ručně**
(uložené v databázi, kolekce `posters`, dokument `kolo-1` až `kolo-13`).
Tlačítko **Vrátit podle rozlosování** uloženou verzi smaže.

Úpravy se ukládají samy, asi vteřinu po posledním psaní, a rovnou do
databáze – vidí je tedy všichni, ne jen ten, kdo je zapsal.

Tisk: Ctrl+P → **A3**, **na šířku**, okraje **žádné**, zapnout **grafiku na
pozadí**. Kolem grafiky je schválně bílý okraj 9,6 mm, aby tiskárna nic
neuřízla.

Rozvržení se přizpůsobuje obsahu – čím víc řádků mládeže nebo venkovních
zápasů, tím menší znaky a QR kód. Nic se tedy nemá rozsypat, ani když se
zápasů nasype víc.

> **Pozor:** výška hlavičky plus horní okraj `.rule` musí dát 122 px. Když se
> zvětší logo nebo nadpis nad čarou, posune se čára pod „PROGRAM VÍKENDU“ a
> přeskládá se celý zbytek plakátu.

## Taktika

Taktická tabule. Prohlížení je veřejné, zakládání a úpravy jen po přihlášení.
Ukládá se samo, asi vteřinu po poslední změně.

- **Tabule a složky** – vlevo. Složky jsou v kolekci `tacticFolders`, tabule
  v `tactics`. Smazáním složky se tabule nesmažou, jen se přesunou mezi
  tabule bez složky.
- **Hřiště** – zelené / bílá tabule, celé / polovina (branka nahoře). Pohled
  i barvu si může přepnout i nepřihlášený, jen se mu to neuloží.
- **Nástroje** – náš hráč, soupeř, míč, kužel, šipky běh / přihrávka /
  vedení míče (prostředním bodem se dají prohnout), prostor, text.
  Delete smaže vybrané, Ctrl+Z vrátí.
- **Rozestavení a standardky** – přesunou hráče, kteří už na tabuli jsou
  (i s přiřazenými jmény), a chybějící doplní. Takže jde přepnout 4-4-2 na
  4-3-3 a jména zůstanou.
- **Hráči dorostu** – soupiska + hostující hráči, seřazení podle počtu
  odehraných zápasů z kanadských bodů. Klik na jméno ho doplní do volného
  kolečka (brankář první). Čísla dresů se píšou do políčka vlevo a platí pro
  všechny tabule (dokument `meta/jerseys`). Bez čísla má kolečko iniciály.
- **Poznámky** – volný text ke každé tabuli, pole je pod hřištěm.
- **Stáhnout obrázek** – PNG tabule, třeba do skupiny týmu. Obrázek, duplikování
  a smazání tabule jsou u názvu, smazat jde i křížkem ve stromu vlevo.
- **Velikost hráčů** – posuvník v panelu Hřiště, ukládá se k tabuli (`tokenScale`).
- **Výběr více prvků** – Ctrl+klik přidá do výběru, tažení po prázdném hřišti
  vybere obdélníkem. Vybrané se posouvají spolu (i v krocích animace),
  šipky na klávesnici je posunou o 0,5 m (se Shiftem o 2 m).
- **Sestava na zápas** – kolekce `lineups` (název, datum, řádky s číslem,
  hráčem a rolí brankář / základ / náhradník). Načte se z obrázku zápisu
  (čtení textu tesseract.js přímo v prohlížeči, nic se nikam neposílá) nebo
  z textu, spáruje se se soupiskou a jde opravit ručně. Tabule si sestavu
  vybere (`lineupId`) – seznam hráčů pak nabízí jen ji a kolečka mají čísla
  ze sestavy. „Postavit základ“ dá brankáře do branky a ostatní do
  rozestavení. FAČR ID spárovaných hráčů se ukládá do `meta/facr`, takže
  příště se spárují i hráči se stejným jménem.
- **Hledání hráčů** – pole nad seznamem, hledá podle jména i čísla.
- **Panel vpravo má dvě záložky** – *Hřiště* (vzhled hřiště, rozestavení,
  standardky) a *Hráči* (seznam hráčů, pod ním sestava na zápas). Poslední
  záložka se pamatuje v prohlížeči.
- **Celá obrazovka** – tabule přes celé okno (a fullscreen prohlížeče, kde to
  jde). Panel vpravo jde schovat, Esc režim zavře.
- **Animace po krocích** – „+ Krok“ zkopíruje postavení (bez šipek), hráče
  a míč posuneš a „Přehrát“ je plynule přesune. Když prvek začíná u šipky
  a končí u jejího konce, jede po ní (i po prohnuté). Kroky jsou v poli
  `frames` dokumentu tabule, `items` drží kopii prvního kroku.

Souřadnice jsou v metrech hřiště 105 × 68, pohled Polovina jen otočí pravou
polovinu – při přepínání se tedy nic nepřepočítává.

## Pro hráče

Statické stránky – obsah se mění přímo v HTML, z databáze nic nečtou.
Jsou rozdělené na 5 podstránek, mezi kterými se přepíná záložkami nahoře
(`.ph-tabs` – při přidání podstránky doplnit odkaz do všech pěti souborů):

- **Přehled** (`pro-hrace.html`) – tvůj týden, dva zápasy za víkend, proč
  pondělní běh, den zápasu a taška, bolest a zranění
- **Rozcvička a prevence** (`pro-hrace-rozcvicka.html`) – FIFA 11+, guma
- **Regenerace** (`pro-hrace-regenerace.html`) – válec, míček, spánek, křeče, masti (hořčík je u jídla)
- **Jídlo a pití** (`pro-hrace-jidlo.html`) – živiny (co je co, semafor), cukry a ovoce, kolik čeho za den (tabulky podle váhy, ukázkový den, obsah v jídle), energetické nápoje, hořčík (druhy), protein a kreatin, jídlo kolem tréninku, strava
  a doplňky (jídlo podle času výkopu), pití
- **K nastudování** (`pro-hrace-kviz.html`) – otázky podle témat

Všechny sdílejí `pro-hrace.css` a `pro-hrace.js`. Každá sekce má barvu přes
třídu `ph-c-…`. Tlačítko **Vytisknout** schová menu a vytiskne jen obsah.

Sekce **Prevence zranění (FIFA 11+)**, **guma**, **válec** a **míček** mají přehrávač videí: vlevo YouTube
(přes youtube-nocookie.com), vpravo seznam cviků. Seznam videí, dávkování
a české popisy jsou v polích `FIFA`, `GUMA`, `VALEC`, `MICEK` v `assets/js/pro-hrace.js` – video se
mění prostým přepsáním ID (`yt`). Cviky 7–12 mají tři úrovně.
Oficiální videa FIFA vkládání na cizí weby blokují – proto souhrny od
University of Iowa. Nové video vždy vyzkoušet na živé stránce.

> **Důležité:** po každé změně v `app.js`, `points.js`, `core.js`,
> `plakaty.js`, `plakat-data.js`, `taktika.js`, `pro-hrace.js`, `dochazka.js`,
> `tymuj.js`, `app.css`, `plakat.css`, `taktika.css`, `pro-hrace.css` nebo `dochazka.css` zvyš číslo `?v=` u odkazů ve všech `.html` (a u importů uvnitř skriptů). Bez toho si
> prohlížeče drží starou verzi a lidem se změna neprojeví.
