# VoteText — manusskript for opplæringsvideo (norsk)

Én kapittelinndelt gjennomgangsvideo, ca. 12 minutter. Fortellerteksten er skrevet for
høytlesing; `[screen: …]`-stikkordene er identiske med den engelske versjonen
(`tutorial-video-script.md`) og beholdt på engelsk siden de refererer til knapper og
elementer i grensesnittet, som er engelskspråklig. Oppsett, rollebesetning,
dokumentoversikt og innhold som skal skrives inn under opptak: se produksjonsnotatene
og vedleggene i den engelske filen.

---

## Kapittel 0 — Intro *(0:30)*

[screen: document list in Anna's profile — four documents with coloured status badges]

Dette er VoteText — et verktøy for grupper som skal bli enige om tekster sammen.
Vedtekter, reglementer, retningslinjer, møtedokumenter: overalt hvor folk foreslår
endringer i formuleringer, diskuterer dem og stemmer. I stedet for spor-endringer som
flyr rundt på e-post, jobber alle i ett felles dokument, hvert forslag er synlig, og
hver stemme telles.

De neste minuttene følger vi en parsellhage gjennom en full revisjon av vedtektene
sine — fra innlogging, via endringsforslag, til den endelige avstemningen og den
vedtatte teksten.

## Kapittel 1 — Logge inn *(1:00)* — Erik, ny nettleserprofil

[screen: clean browser at the app URL — the login page]

VoteText har ingen passord. Du logger inn med e-postadressen din.

[screen: type erik@demo.votetext, click "Send code"]

Skriv inn adressen og be om en kode. I løpet av noen sekunder ligger en sekssifret
kode i innboksen.

[screen: enter the 6-digit code from the dev console — form submits itself]

Tast inn koden — og du er inne. Det er hele innloggingen.

[screen: profile completion modal appears]

Første gang du logger inn, spør VoteText hvem du er. Navnet ditt er det de andre
deltakerne ser ved siden av forslagene og stemmene dine, så velg noe de kjenner igjen.

[screen: type "Erik Moen" and "Plot 7", click "Save and continue"]

[screen: empty document list]

Og dette er hjem: dokumentlisten. Eriks liste er tom — dokumenter dukker opp her når
noen inviterer deg, og det er akkurat det som skjer om et øyeblikk.

## Kapittel 2 — Opprette et dokument *(1:00)* — Anna

[screen: Anna's document list, click "New document"]

Nå den andre siden av historien. Anna leder hagekomiteen, og hun har en tekst gruppen
må bli enige om.

[screen: create modal — paste the "Spring Planting Plan 2027" text from Appendix A, type the title]

Å opprette et dokument er lim-inn-og-ferdig. Slipp inn en tekstfil eller lim inn
innholdet — ren tekst eller markdown — gi det en tittel, og VoteText deler det opp i
nummererte linjer og sider helt automatisk.

[screen: click Create — the document opens in the viewer, status badge "Draft"]

Det nye dokumentet starter som et *utkast*. Utkast er private: bare Anna og
eventuelle redaktører hun utpeker, kan se det. Det gir henne rom til å rette
skrivefeil før gruppen kaster seg over teksten.

[screen: click "Change status", choose Open]

Når teksten er klar, åpner hun dokumentet — og fra nå av kan inviterte medlemmer lese
det og foreslå endringer.

## Kapittel 3 — Invitere deltakere *(0:45)* — Anna

[screen: document sidebar, click "Manage access"]

Ingen ser et dokument uten å være invitert — tilgang gis per dokument, ikke for hele
nettstedet.

[screen: access modal — the role dropdown, type erik@demo.votetext, role "proposer", click Invite]

Anna inviterer Erik. Rollen avgjør hva han kan gjøre: en *viewer* bare leser, en
*commenter* deltar i diskusjonen, en *proposer* kan foreslå endringer, og en *voter*
gjør alt dette og stemmer. Erik får en e-post om at han er invitert.

[screen: point at the Default access selector]

For større grupper finnes en snarvei: *default access* gir alle innloggede brukere en
grunnrolle på akkurat dette dokumentet, så du slipper å invitere hele nabolaget én
og én.

## Kapittel 4 — Finne og lese et dokument *(1:15)* — Bjørn, Community Garden Charter

[screen: Bjørn's document list — click "Community Garden Charter" (Open badge)]

La oss følge Bjørn, som har parsell fjorten og meninger. Fra dokumentlisten åpner han
hagens vedtekter.

[screen: document view — text left, proposal sidebar right; scroll slowly]

Teksten ligger til venstre med nummererte linjer. Til høyre: alle endringene som er
foreslått så langt.

[screen: hover an amber-highlighted line — tooltip with proposal numbers]

Ravgule linjer har allerede forslag knyttet til seg. Hold pekeren over en av dem, og
du ser hvilke forslag som berører linjen.

[screen: click "All", then "On-page" in the sidebar filter]

Sidepanelet følger deg mens du leser — det viser forslagene for siden du står på,
eller hele dokumentet om du heller vil det.

[screen: click a proposal card — page jumps to the line; then click the proposal title]

Klikk på et forslagskort for å hoppe til avsnittet det endrer — og klikk på tittelen
for å åpne hele forslaget.

## Kapittel 5 — Delta i diskusjonen *(1:00)* — Clara, forslaget «Raise the annual fee»

[screen: proposal detail page — title, rationale, side-by-side diff]

Alle forslag har samme anatomi: en tittel, forslagsstillerens begrunnelse, og den
nøyaktige tekstendringen — original til venstre, forslag til høyre. Ingen gjetting om
hva forfatteren mente.

[screen: scroll to the comments — the seeded thread with Bjørn's indented reply]

Under endringen: diskusjonen. Svar henger fast på kommentaren de besvarer, så trådene
beholder formen.

[screen: Clara types a comment, clicks "Post comment" — it appears with her name and "just now"]

Clara legger til sitt syn — synlig for alle i samme øyeblikk som hun publiserer.

## Kapittel 6 — Foreslå en endring *(1:30)* — Bjørn, Community Garden Charter

[screen: document view — select the guest rule sentence with the mouse; "Propose change" button appears]

Nå selve hjertet i VoteText. Bjørn mener en setning bør endres — så han markerer den.
Og der, med en gang: en knapp.

[screen: click "Propose change" — modal with the selected text collapsed, three fields]

Forslagsskjemaet ber om tre ting: en kort tittel, den nye formuleringen, og — det
viktigste — *hvorfor*. En god begrunnelse er det som gjør et endringsønske til et
argument gruppen kan veie.

[screen: fill in title "Let guests visit without an escort", new text, rationale; click "Submit proposal"]

[screen: the new card appears in the sidebar; the selected lines turn amber]

Sendt inn. Forslaget er umiddelbart synlig for alle deltakere, festet til nøyaktig de
linjene det ville endre.

[screen: on the new proposal page, click "Edit", adjust the title, Save; then point at "Withdraw"]

Helt til avstemningen starter kan Bjørn finpusse formuleringen — eller trekke
forslaget helt, hvis diskusjonen får ham på andre tanker.

## Kapittel 7 — Stemme *(0:45)* — Clara, forslaget «Clarify the dog rule»

[screen: proposal page — the three vote buttons For / Against / Abstain]

Når du har lest et forslag, si hva du mener. Tre knapper: for, mot, avstår.

[screen: Clara clicks "For" — count increments, button highlights]

Ett klikk, én stemme. Tellingen oppdateres umiddelbart, og den markerte knappen viser
alltid hvor du står.

[screen: click "Against" — counts adjust; click "Against" again — vote retracts]

Ombestemt deg? Bare stem på nytt. Og klikker du på din egen aktive stemme, trekker du
den helt tilbake.

[screen: back on the document — sidebar cards showing ▲ and ▼ tallies]

Tilbake på dokumentet viser de løpende tellingene med ett blikk hvilke forslag som
har medvind.

## Kapittel 8 — Dele med noen utenfor *(0:45)* — Bjørn, hans kontingentforslag

[screen: proposal page, click "Share" — modal with link and Copy button]

Noen ganger vil du ha en mening fra noen utenfor gruppen. Hvert forslag har en
direkte lenke.

[screen: tick "Allow anyone to view", click Copy]

Som standard krever lenken innlogging — men forslagsstilleren kan åpne den, slik at
alle med lenken kan lese akkurat dette forslaget.

[screen: private/incognito window with the link — read-only proposal with a "Log in" invitation]

En utenforstående ser tittelen, begrunnelsen og endringen — ikke noe mer, og kan ikke
røre noe. For å stemme eller kommentere må man inviteres på ordentlig vis.

## Kapittel 9 — Lede avstemningen: gjennomgang og konflikter *(1:30)* — David, Garden Budget Priorities 2027

[screen: David's document list — open the Budget doc (Voting badge), click "Review"]

Når diskusjonen har gått sin gang, må noen lose beslutningen i havn. Det er
*supervisor*-rollen — her David, komiteens sekretær. Han kan styre hele
avstemningsprosessen uten å kunne røre selve dokumentteksten.

[screen: two-panel review view — text left, proposal cards right with action buttons]

Gjennomgangsvisningen stiller ett enkelt spørsmål for hvert forslag: hva skjer med
dette på møtet? Går det til avstemning, trekkes det, eller er det ikke lenger aktuelt?

[screen: point at the orange ⊕ badge on the two tool-budget proposals]

Og her er det interessante tilfellet: to forslag vil endre *samme setning* — det ene
kjøper en hekksaks, det andre deler budsjettet. Begge kan ikke vedtas.

[screen: click CONFLICT on both — cards turn yellow; click "Resolve conflicts"]

David markerer dem som en konflikt og åpner konfliktløsningen.

[screen: conflict group — drag one proposal above the other; blue order badge appears; drag the other onto it — amber "child of" badge]

Her bestemmer han rekkefølgen. Gruppen stemmer over det første forslaget først — og
det andre kommer bare til avstemning som reserve, hvis det første faller.

[screen: "Ready for final voting" button turns green — click it, confirm]

Når hver konflikt har fått sin rekkefølge, blir knappen grønn — og dokumentet går til
endelig avstemning.

## Kapittel 10 — Registrere den endelige avstemningen *(1:30)* — David, Watering Schedule Amendment

[screen: Watering doc in final_voting — Review view, click "Voting walkthrough"]

Selve sluttavstemningen skjer gjerne i et rom — hender i været, eller stemmesedler.
VoteTexts jobb er å holde tellingen ærlig. Avstemningsgjennomgangen lister hvert
forslag i dokumentrekkefølge, med konfliktgrupper og reserver tydelig merket.

[screen: point at the pre-recorded sprinkler tally with the green majority label]

For hvert forslag taster David inn antall ja, nei og avholdende. Flertallsindikatoren
regner i sanntid.

[screen: change the threshold dropdown on the weekend proposal to "⅔ majority" — requirement label updates]

Ikke alle beslutninger er myntkast: et forslag kan kreve absolutt flertall, to
tredjedeler eller tre fjerdedeler — og indikatoren viser umiddelbart om tellingen
kommer over lista.

[screen: enter tallies for the root conflict proposal so it passes — the child proposal greys out: "Not voting on — parent passed"]

Se på reserven: i det øyeblikket hovedforslaget vedtas, tas den automatisk av bordet.

[screen: click "Export CSV", then "Print HTML" — the printable tally sheet opens]

Trenger du papir til møtet, eller et regneark til protokollen? Ett klikk hver. Hver
lagrede telling havner dessuten i en revisjonslogg — hvem som registrerte hva, og når.

## Kapittel 11 — Lese resultatet *(0:45)* — Clara, Tool Shed Rules 2026

[screen: Clara's document list — open the resolved Tool Shed doc, click "Resolved text"]

Når avstemningen er over, er dokumentet *vedtatt* — og alle deltakere kan lese
utfallet.

[screen: resolved-text view — green PASSED banner with timestamp, final text with line numbers]

Dette er den vedtatte teksten: hvert vedtatte forslag innarbeidet, hvert forkastede
utelatt, med et banner som viser når gruppen gjorde det offisielt.

[screen: click "Export Markdown" — file downloads]

Eksporter den som fil, skriv den ut, eller bare del lenken. Dokumentet — og hele
sporet av forslag, argumenter og stemmer bak det — blir liggende i VoteText som
dokumentasjon.

## Kapittel 12 — Et ord om moderering *(0:45)* — David, Community Garden Charter

[screen: the gnome-catalogue comment on the dog proposal; click "Hide", confirm]

Én ting til for dem som drifter det hele. Av og til hører en kommentar ikke hjemme —
søppelpost, eller noe som går over streken. En supervisor kan skjule den.

[screen: the comment is replaced by "Comment hidden by moderator" for a participant view]

Deltakerne ser at *noe* ble fjernet — ærlighet er viktig — men ikke hva.

[screen: document sidebar → "Moderation" — the hidden comment listed with an Unhide button]

Og ingenting slettes i stillhet: modereringssiden viser alt som er skjult, og enhver
supervisor kan hente det fram igjen. Hver handling havner i aktivitetsloggen.

## Kapittel 13 — Avslutning *(0:20)*

[screen: back to the document list, the four documents with their status badges]

Det er VoteText: ett sted der en gruppe leser sammen, diskuterer i det åpne, stemmer —
og går derfra med en tekst alle kan peke på. Sett det opp, inviter folkene dine, og
send neste dokument til avstemning.
