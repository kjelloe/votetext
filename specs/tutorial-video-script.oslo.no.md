# VoteText — manusskript for opplæringsvideo, Oslo-scenarioet (norsk)

Samme fjorten kapitler som `tutorial-video-script.no.md`, fortalt på et ekte dokument: Oslo Høyres
første utkast til program for 2027–2031 (`tutorial/scenarios/oslo-program.md`, sidetallene telles fra
kildens side 3). `[screen: …]`-stikkordene er identiske med den engelske Oslo-filen
(`tutorial-video-script.oslo.md`) og beholdt på engelsk. Kokoro har ingen norsk stemme, så denne
fortellerteksten leses inn per stikkord:

```bash
npm run tutorial -- all --scenario oslo --lang no --list-beats   # teksten per stikkord og filnavnet opptaket skal lagres som (alle kapitlene)
npm run tutorial -- all --scenario oslo --lang no --burn         # hele videoen fra opptakene i tutorial/out/oslo/audio/no/
```

Trinn for trinn (opptaker, format, kontroll av ett kapittel, publisering): `tutorial-norwegian-recording.md`.

---

## Kapittel 0 — Intro *(0:30)*

[screen: Anna's document list — the programme draft and three chapter documents with coloured status badges]

Dette er VoteText – et verktøy for grupper som skal bli enige om tekster sammen. Her er det et partiprogram: Oslo Høyres programkomité har et første utkast til programmet for 2027, og lokalforeningene inviteres til å foreslå endringer, argumentere for dem og stemme. I stedet for spor-endringer som flyr rundt på e-post, jobber alle i ett felles dokument, hvert forslag er synlig, og hver stemme telles. De neste minuttene følger vi komiteen fra første utkast til et vedtatt kapittel.

---

## Kapittel 1 — Pålogging *(0:45)*

[screen: clean browser at the app URL — the login page]

Det finnes ingen passord i VoteText. Du logger inn med e-postadressen din.

[screen: type erik@demo.votetext, click "Send code"]

Skriv inn adressen og be om en kode. I løpet av noen sekunder kommer en sekssifret kode i innboksen.

[screen: enter the 6-digit code from the dev console — form submits itself]

Skriv inn koden, og du er inne. Det er hele påloggingen.

[screen: profile completion modal appears]

Første gang du logger inn, spør VoteText hvem du er. Navnet ditt er det de andre ser ved siden av forslagene og stemmene dine, så velg det foreningen kjenner deg som. Organisasjon er valgfritt; her er det lokallaget.

[screen: type "Erik Moen" and "Frogner Høyre", click "Save and continue"]

[screen: empty document list]

Og dette er hjem: dokumentlisten. Eriks liste er tom – dokumenter dukker opp her når noen inviterer deg, og det er akkurat det som skjer om et øyeblikk.

---

## Kapittel 2 — Opprette et dokument *(1:00)*

[screen: Anna's document list, click "New document"]

> Merk: Anna leder programkomiteen og har rollen creator, og derfor ser hun New document; medlemmer som Bjørn og Clara gjør ikke det. Nå den andre siden: Anna legger inn neste kapittel i utkastet som et eget dokument.

[screen: create modal — paste the "Kapittel 3" draft, type the title]

Å opprette et dokument er lim-inn-og-gå. Slipp inn en tekstfil eller lim inn innholdet, ren tekst eller markdown, gi det en tittel, og VoteText deler det opp i nummererte linjer og sider. Et utkast eksportert fra PDF beholder sidetallene fra trykken, så komiteen kan si «side fire, linje tolv» og mene det samme på papir og på skjerm.

[screen: click Create — the document opens in the viewer, status badge "Draft"]

Det nye dokumentet starter som et utkast. Utkast er private: bare Anna og de redaktørene hun oppnevner kan se det. Det gir henne tid til å sjekke at teksten kom riktig inn før noen andre leser den.

[screen: click "Change status", choose Open]

Når teksten er klar, åpner hun den – og fra nå av kan inviterte medlemmer lese den og foreslå endringer.

---

## Kapittel 3 — Invitere deltakere *(0:45)*

[screen: document sidebar, click "Manage access"]

Ingen kan se et dokument før de er invitert – tilgang gis per dokument, ikke per nettsted.

[screen: access modal — the role dropdown, type erik@demo.votetext, role "proposer", click Invite]

Anna inviterer Erik. Rollen avgjør hva han kan gjøre: en viewer bare leser, en commenter deltar i diskusjonen, en proposer kan foreslå endringer, og en voter gjør alt det og stemmer. En supervisor styrer avstemningen uten å kunne redigere teksten, og en editor kan det. Erik er proposer: han kan argumentere for endringer, men stemmer ikke over dem.

[screen: point at the Default access selector]

For en hel forening finnes det en snarvei: standardtilgang gir hvert innlogget medlem som åpner dokumentets lenke en grunnrolle, så komiteen kan dele én lenke i stedet for å invitere noen hundre mennesker én og én.

---

## Kapittel 4 — Finne og lese et dokument *(1:00)*

[screen: Bjørn's document list — click "Oslo Høyres program 2027–2031" (Open badge)]

La oss følge Bjørn fra Grünerløkka, som har lest utkastet og har meninger. Fra dokumentlisten åpner han programmet.

[screen: document view — text left, proposal sidebar right; scroll slowly]

Teksten ligger til venstre med nummererte linjer og sidetallene fra trykken. Til høyre: hver endring som er foreslått så langt.

[screen: hover a blue-highlighted line — tooltip with proposal numbers]

Blåmarkerte linjer har allerede forslag knyttet til seg. Hold pekeren over en av dem, og du ser hvilke forslag som berører linjen.

[screen: pick "This page" in the filter above the proposal list, then "All"; open the order selector and pick "Most voted", then back to "Document order"]

Sidepanelet følger deg mens du leser og viser forslagene for siden du er på, eller hele programmet, i den rekkefølgen du vil: som skrevet, mest diskutert, flest stemmer eller nyeste.

[screen: hover a proposal card — click the ↗ link that appears: the page jumps to the line; then click the card itself]

Hold pekeren over et forslagskort og følg pilen for å hoppe til passasjen det endrer, her et kulepunkt på side to, eller klikk på kortet for å åpne hele forslaget.

---

## Kapittel 5 — Delta i diskusjonen *(0:45)*

[screen: proposal detail page — title, rationale, side-by-side diff]

Hvert forslag har samme anatomi: en tittel, forslagsstillerens begrunnelse, og den nøyaktige tekstendringen – original til venstre, forslag til høyre. Ingen gjetting på hva noen mente med «stram inn skatteformuleringen».

[screen: scroll to the comments — the seeded thread with Bjørn's indented reply]

Under endringen: diskusjonen. Svar henger fast ved kommentaren de svarer på, så trådene beholder formen.

[screen: Clara types a comment, clicks "Post comment" — it appears with her name and "just now"]

Clara fra Nordstrand legger til sitt syn – det er synlig for alle i det øyeblikket hun sender det.

---

## Kapittel 6 — Foreslå en endring *(1:30)*

[screen: document view — select the sentence about getting around the city with the mouse; the floating "Propose" bar appears above the selection]

Nå selve hjertet i VoteText. Bjørn mener en setning i innledningen bør endres, så han markerer den, og en liten Propose-knapp dukker opp rett på markeringen. På mobil ligger den rett under de markerte ordene.

[screen: click "Propose" on the floating bar — modal showing the selected text, the operation selector and three fields]

Forslagsskjemaet ber om tre ting: en kort tittel, den nye formuleringen, og, det viktigste, hvorfor. En god begrunnelse er det som gjør et endringsønske til et argument komiteen kan veie.

[screen: fill in title "Nevn ytre by i innledningen", new text, rationale; click "Submit proposal" — the sheet closes, the lines turn blue, a toast "Proposal #N added · Open" appears; click "Open"]

Sendt inn. Bjørn står fortsatt i dokumentet: linjen er blåmarkert, kortet ligger i listen, og en liten melding tilbyr forslagssiden. Han åpner den.

[screen: on the proposal page, click "Edit", adjust the title, Save; then point at "Withdraw"]

Helt til avstemningen starter kan Bjørn finpusse formuleringen, eller trekke forslaget helt, hvis diskusjonen får ham på andre tanker.

[screen: click "← Back to document" — the new card in the sidebar, the selected line now highlighted in blue]

Tilbake i dokumentet er forslaget festet til nøyaktig den linjen det ville endre, og på mobil går samme flyt fra en knapperad som flyter på de markerte ordene.

---

## Kapittel 7 — Stemme *(0:45)*

[screen: proposal page — the three vote buttons For / Against / Abstain]

Når du har lest et forslag, si hva du mener. Tre knapper: for, mot, avstår.

[screen: Clara clicks "For" — count increments, button highlights]

Ett klikk, én stemme. Opptellingen oppdateres med en gang, og den uthevede knappen viser alltid hvor du står.

[screen: click "Against" — counts adjust; click "Against" again — vote retracts]

Ombestemt deg? Bare stem igjen. Og klikker du på din egen aktive stemme, trekkes den helt.

[screen: back on the document — sidebar cards showing ▲ and ▼ tallies]

Tilbake i dokumentet viser de løpende opptellingene med ett blikk hvilke forslag som har medvind før komiteen møtes.

---

## Kapittel 8 — Dele med en utenforstående *(0:45)*

[screen: proposal page, click "Share" — modal with link and Copy button]

Noen ganger vil du ha en mening fra noen utenfor komiteen – en politisk rådgiver, for eksempel. Hvert forslag har en direkte lenke.

[screen: tick "Allow anyone to view", click Copy]

Som standard krever lenken innlogging, men forslagsstilleren kan åpne den, slik at alle med lenken kan lese akkurat dette forslaget.

[screen: private/incognito window with the link — read-only proposal with a "Log in" invitation]

En utenforstående ser tittelen, begrunnelsen og endringen – ikke noe annet – og kan ikke røre noe. For å stemme eller kommentere må de inviteres på ordentlig vis.

---

## Kapittel 9 — Gjennomføre avstemningen: gjennomgang og konflikter *(1:30)*

[screen: David's document list — open the introduction chapter (Voting badge), click "Review"]

Når diskusjonen har gått sin gang, må noen lose avgjørelsen i havn. Det er supervisoren – her David, komiteens sekretær. Han kan styre hele avstemningen uten å kunne endre et ord i teksten selv. Innledningskapittelet er allerede til avstemning.

[screen: two-panel review view — text left, proposal cards right with action buttons]

Gjennomgangsvisningen viser hvert forslag med ett enkelt spørsmål: hva skjer med dette på komitémøtet? Går til avstemning, trekkes, eller er ikke lenger relevant.

[screen: point at the orange ⊕ badge on the two proposals about getting a "yes" from the city]

Og her er det interessante tilfellet: to forslag vil endre samme setning om å få et «ja» fra kommunen – det ene lover svar innen fire uker, det andre sier kommunen skal lete etter grunner til å si ja. Begge kan ikke vedtas.

[screen: click CONFLICT on both — cards turn yellow; click "Resolve conflicts"]

David merker dem som en konflikt og åpner løsningsvisningen.

[screen: conflict group — drag one proposal above the other; blue order badge appears; drag the other onto it — amber "child of" badge]

Her bestemmer han avstemningsrekkefølgen. Komiteen stemmer over fireukersløftet først, og den andre formuleringen settes bare under avstemning som en reserve, hvis den første faller.

[screen: "Ready for final voting" button turns green — click it, confirm]

Når hver konflikt har en rekkefølge, blir knappen grønn, og kapittelet går til endelig avstemning.

---

## Kapittel 10 — Registrere den endelige avstemningen *(1:30)*

[screen: the kindergarten chapter in final_voting — Review view, click "Voting walkthrough"]

Selve den endelige avstemningen skjer i komitérommet – hender i været, eller stemmesedler. VoteTexts jobb er å holde opptellingen ærlig. Avstemningsgjennomgangen lister hvert forslag i rekkefølgen som nettopp ble bestemt, med original og forslag side om side, så ingen stemmer over et sammendrag.

[screen: point at the pre-recorded tally on "Daglig høytlesing" with the green majority label]

For hvert forslag skriver David inn ja-, nei- og avholdende-tallene. Flertallsindikatoren regner i sanntid.

[screen: change the threshold dropdown on the "50 prosent barnehagelærere" proposal to "⅔ majority" — requirement label updates]

Ikke alle avgjørelser er myntkast: et forslag kan kreve absolutt flertall, to tredjedeler eller tre fjerdedeler, og indikatoren viser med en gang om opptellingen klarer kravet. Programendringer med budsjettkonsekvenser trenger ofte den høyere terskelen.

[screen: enter tallies for the root conflict proposal so it passes — the child proposal greys out: "Not voting on — parent passed"]

Se på reserven: i det øyeblikket hovedforslaget vedtas, tas den automatisk av bordet.

[screen: click "Export CSV", then "Print HTML" — the printable tally sheet opens]

Trenger du papir til møtet, eller et regneark til referatet? Ett klikk hver. Hver lagret opptelling føres også i en revisjonslogg – hvem registrerte hva, og når. Og VoteText nekter å kalle et kapittel ferdigbehandlet så lenge to vedtatte forslag overlapper eller et forslag fortsatt mangler opptelling.

---

## Kapittel 11 — Lese resultatet *(0:45)*

[screen: Clara's document list — open the resolved school chapter, click "Resolved text"]

Når avstemningen er ferdig, er kapittelet ferdigbehandlet, og hver deltaker kan lese utfallet.

[screen: resolved-text view — green PASSED banner with timestamp, final text with line numbers]

Dette er den vedtatte teksten: hvert vedtatte forslag lagt inn, hvert forkastede utelatt, med et banner som viser når komiteen gjorde det offisielt.

[screen: click "Export Markdown" — file downloads]

Eksporter den som fil til dem som setter opp programmet, skriv den ut, eller bare send medlemmene lenken hit. Kapittelet, og hele sporet av forslag, argumenter og stemmer bak det, blir i VoteText til neste revisjon.

---

## Kapittel 12 — Et ord om moderering *(0:45)*

[screen: the e-bike comment on the kindergarten proposal; click "Hide", confirm]

Én ting til for dem som styrer. Av og til hører en kommentar ikke hjemme – en annonse, eller noe som går over streken. En supervisor kan skjule den.

[screen: the comment is replaced by "Comment hidden by moderator" for a participant view]

Deltakerne ser at noe ble fjernet – ærlighet betyr noe – men ikke hva.

[screen: document sidebar → "Moderation" — the hidden comment listed with an Unhide button]

Og ingenting slettes i det stille: modereringssiden lister alt som er skjult, og enhver supervisor kan gjenopprette det. Hver handling havner i aktivitetsloggen.

---

## Kapittel 13 — Avslutning *(0:30)*

[screen: back to the document list, the programme and its chapters with their status badges]

Det er VoteText: ett sted der en komité leser sammen, diskuterer i det åpne, stemmer, og går derfra med en programtekst alle kan peke på. Sett det opp, inviter foreningene, og la neste program skrive seg selv – ett begrunnet forslag om gangen.
