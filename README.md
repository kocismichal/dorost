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

## Úprava seznamu hráčů nebo druhů pokut

Obojí je nahoře v `assets/js/app.js`:

- `PLAYERS` – pole jmen hráčů
- `FINE_TYPES` – druhy pokut (název, popis, částka, text na tlačítku)
- `DEDUCTION` – zelené tlačítko na odečet

Po úpravě stačí soubor commitnout a nahrát na GitHub – stránka se aktualizuje
automaticky (GitHub Pages).
