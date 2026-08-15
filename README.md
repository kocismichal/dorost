# FK Agro Vnorovy – Dorost

Statický web týmu. Běží na GitHub Pages, data se ukládají do Firebase
Firestore, takže je vidí všichni živě. Dvě stránky:

- **Pokutníček** (`index.html`) – pokuty hráčů
- **Kanadské body** (`kanadske-body.html`) – zápasy, góly a asistence

Platí pro obě:

- **Prohlížení** – veřejné, bez přihlášení.
- **Zápis** – jen po přihlášení (tlačítko vpravo nahoře). Heslo je společné
  pro celý tým, jméno slouží pouze k archivaci (kdo co zapsal).

## Struktura

```
index.html            pokutníček
kanadske-body.html    kanadské bodování
assets/css/app.css    styly obou stránek
assets/js/core.js     sdílené jádro – Firebase, přihlášení, soupiska
assets/js/app.js      logika pokut
assets/js/points.js   logika kanadských bodů
assets/img/logo.png   logo klubu
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

> **Důležité:** po každé změně v `app.js`, `points.js`, `core.js` nebo
> `app.css` zvyš číslo `?v=` u odkazů v `index.html` i v
> `kanadske-body.html` (a u importu `core.js` v obou skriptech). Bez toho si
> prohlížeče drží starou verzi a lidem se změna neprojeví.
