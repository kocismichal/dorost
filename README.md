# FK Agro Vnorovy – Dorost · Pokutníček

Statický web pro zápis pokut v týmu. Běží na GitHub Pages, data (zápisy pokut)
se ukládají do Firebase Firestore, takže je vidí všichni živě.

- **Prohlížení** – veřejné, bez přihlášení. Kdokoliv vidí seznam hráčů,
  jejich pokuty a druhy pokut.
- **Zápis pokuty** – jen po přihlášení (tlačítko vpravo nahoře). Heslo je
  společné pro celý tým, jméno slouží pouze k archivaci (kdo co zapsal).

## Struktura

```
index.html            hlavní stránka
assets/css/app.css     styly
assets/js/app.js       logika + napojení na Firebase (hráči, druhy pokut, heslo)
assets/img/logo.png    logo klubu
```

## Nastavení před prvním nasazením

V [assets/js/app.js](assets/js/app.js) je potřeba doplnit `FIREBASE_CONFIG`
hodnotami z vlastního Firebase projektu (viz hlavní návod, který dostal
majitel webu). Bez toho web sice zobrazí design, ale zápisy pokut se
nikam neuloží (stav nahoře ukáže „Offline“).

## Soupiska hráčů

Mění se **přímo na webu** – po přihlášení se objeví tlačítko „+ Přidat hráče“
nad seznamem a u každého hráče dole „Odebrat hráče ze soupisky“. Změna se
uloží do databáze a hned ji vidí všichni.

Odebraný hráč zmizí z přehledu, ale jeho zapsané pokuty zůstanou v historii
zápisů (kvůli dohledatelnosti).

Seznam `DEFAULT_PLAYERS` v `assets/js/app.js` je jen výchozí stav pro úplně
první spuštění – jakmile se soupiska poprvé uloží do databáze, tenhle seznam
se už nepoužívá a ruční úpravy v něm nemají efekt.

## Úprava druhů pokut

Nahoře v `assets/js/app.js`:

- `FINE_TYPES` – druhy pokut (název, popis, částka, text na tlačítku)
- `DEDUCTION` – zelené tlačítko na odečet

Po úpravě soubor commitni a nahraj na GitHub – stránka se aktualizuje
automaticky (GitHub Pages).

> **Důležité:** po každé změně v `app.js` nebo `app.css` zvyš číslo `?v=`
> u obou odkazů na konci/začátku `index.html`. Bez toho si prohlížeče drží
> starou verzi a lidem se změna neprojeví.
