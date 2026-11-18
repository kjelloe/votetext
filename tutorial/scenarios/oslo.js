'use strict';

// The Oslo scenario: Oslo Høyre's first programme draft (oslo-program.md, pages renumbered from the source's page 3)
// as the open document, with every seeded and recorded proposal on its first pages, and three short documents
// cut from the same pages for the voting, final-voting and resolved chapters. Texts are Norwegian; the
// narration lives in specs/tutorial-video-script.oslo.md (EN) and .oslo.no.md (NO).

const fs = require('fs');
const path = require('path');
const { importPagedText } = require('../../src/lib/text');

const PROGRAM = fs.readFileSync(path.join(__dirname, 'oslo-program.md'), 'utf8');
const LINES = importPagedText(PROGRAM).lines;
const lines = (from, to) => LINES.filter(l => l.line_num >= from && l.line_num <= to).map(l => l.original_text).join('\n');

module.exports = {
    name: 'oslo',
    scripts: { en: 'tutorial-video-script.oslo.md', no: 'tutorial-video-script.oslo.no.md' },
    outDir: 'oslo',
    owner: 'anna',
    users: {
        anna:  { email: 'anna@demo.votetext',  name: 'Anna Berg',  org: 'Programkomiteen, leder', role: 'creator', label: 'Anna (chair/owner)' },
        bjorn: { email: 'bjorn@demo.votetext', name: 'Bjørn Dahl', org: 'Grünerløkka Høyre', label: 'Bjørn (proposer)' },
        clara: { email: 'clara@demo.votetext', name: 'Clara Foss', org: 'Nordstrand Høyre', label: 'Clara (voter)' },
        david: { email: 'david@demo.votetext', name: 'David Lie',  org: 'Programkomiteen, sekretær', label: 'David (supervisor)' },
    },
    documents: [
        {
            key: 'open', title: 'Oslo Høyres program 2027–2031 — 1. utkast', description: 'Programkomiteens første utkast, til innspill fra foreningene', status: 'open', text: PROGRAM, linesPerPage: 'auto', note: 'chapters 4–8, 12',
            access: { bjorn: 'proposer', clara: 'voter', david: 'supervisor' },
            variants: [
                { key: 'tax', by: 'bjorn', line: 'uten at du må betale høyere skatter og avgifter.', newText: 'uten at du må betale høyere skatter og avgifter – og med en eiendomsskatt som avvikles i løpet av perioden.',
                  title: 'Si tydelig at eiendomsskatten skal avvikles', rationale: 'Eiendomsskatten er saken flest velgere spør oss om. Innledningen bør si rett ut hva vi vil, ikke bare at skattene ikke skal opp.',
                  votes: [['anna', 1], ['clara', 1]],
                  comments: [{ by: 'clara', text: 'Enig i retningen. Bør vi si når – «i løpet av perioden» – eller er det for bindende?', replies: [{ by: 'bjorn', text: 'Jeg la inn «i løpet av perioden» nettopp for at det skal forplikte. Kan tas ut hvis komiteen vil.' }] }] },
                { key: 'barnehage', by: 'clara', line: '• sikre likebehandling av kommunale og private barnehager', newText: '• sikre reell likebehandling av kommunale og private barnehager, også i tilskudd og tomtetildeling',
                  title: 'Konkretiser likebehandlingen av barnehager', rationale: '«Likebehandling» er lett å love. Tilskudd og tomter er der forskjellen faktisk oppstår, så de bør nevnes.',
                  votes: [['bjorn', 1], ['anna', 0]],
                  comments: [{ by: 'clara', text: 'Forresten – jeg selger en nesten ubrukt el-sykkel, send meg en melding om noen er interessert!' }] },
            ],
        },
        {
            key: 'voting', title: 'Kapittel 1: Mulighetenes by — innledningen', description: 'Innledningen til programmet, behandlet for seg', status: 'voting', text: lines(1, 20), linesPerPage: 30, note: 'chapter 9',
            access: { bjorn: 'voter', clara: 'voter', david: 'supervisor' },
            variants: [
                { key: 'ja1', by: 'bjorn', line: 'I mulighetenes by skal det være enkelt å få et «ja»', newText: 'I mulighetenes by skal du få svar fra kommunen innen fire uker, og et «ja» når reglene tillater det, uavhengig av om du vil',
                  title: 'Lov svar innen fire uker', rationale: 'Et løfte om tempo er noe velgerne kan måle oss på. «Enkelt å få et ja» kan bety hva som helst.', votes: [['clara', 1], ['anna', 1]] },
                { key: 'ja2', by: 'clara', line: 'I mulighetenes by skal det være enkelt å få et «ja»', newText: 'I mulighetenes by skal kommunen lete etter grunner til å si «ja», uavhengig av om du vil',
                  title: 'Kommunen skal lete etter grunner til å si ja', rationale: 'Holdningen er poenget, ikke en frist. En frist kan bli et nytt byråkratisk mål i seg selv.', votes: [['bjorn', 1], ['anna', -1]] },
                { key: 'bolig', by: 'bjorn', line: 'skal ikke tvinges ut av Oslo fordi kommunen', newText: 'skal ikke tvinges ut av Oslo fordi kommunen ikke sørger for at det er nok byggeklare tomter – målet er minst 5 000 nye boliger i året. I',
                  title: 'Tallfest boligmålet', rationale: 'Uten et tall er boligløftet umulig å følge opp. 5 000 i året er det Oslo trenger for å holde tritt med befolkningsveksten.', votes: [['clara', 1], ['anna', 1], ['david', 1]] },
            ],
        },
        {
            key: 'final', title: '2.1 Barnehagen skal gi alle barn en god start', description: 'Barnehagekapittelet, til endelig avstemning i programkomiteen', status: 'final_voting', text: lines(24, 43), linesPerPage: 30, note: 'chapter 10',
            access: { bjorn: 'voter', clara: 'voter', david: 'supervisor' },
            variants: [
                { key: 'root', by: 'bjorn', line: '• sikre at flere barn får tilbud om barnehageplass', newText: '• sikre at alle barn får tilbud om barnehageplass fra de har fylt ett år gjennom å',
                  title: 'Alle barn, ikke flere barn', rationale: '«Flere» er ikke et mål, det er en retning. Programmet bør love plass til alle ettåringer.', status: 'conflict', vote_order: 1, votes: [['clara', 1], ['anna', 1]] },
                { key: 'child', by: 'clara', line: '• sikre at flere barn får tilbud om barnehageplass', newText: '• innføre løpende barnehageopptak gjennom hele året ved å',
                  title: 'Løpende opptak hele året', rationale: 'Reserveløsning hvis «alle» faller: løpende opptak er det foreldrene faktisk merker.', status: 'conflict', parent: 'root', vote_order: 1 },
                { key: 'sprak', by: 'bjorn', line: '• styrke språkarbeidet med flere fysiske bøker', newText: '• styrke språkarbeidet med flere fysiske bøker, daglig høytlesing og en sterkere lesekultur',
                  title: 'Daglig høytlesing', rationale: '«Mer høytlesing» kan ikke måles. «Daglig» kan.', final: { yes: 11, no: 1, abstain: 2, ago: 3600000 } },
                { key: 'ansatte', by: 'clara', line: '• ha flere ansatte med relevant utdanning', newText: '• ha flere ansatte med relevant utdanning og kompetanse inn i barnehagene, med mål om 50 prosent barnehagelærere',
                  title: 'Mål om 50 prosent barnehagelærere', rationale: 'Et tallfestet mål gjør punktet forpliktende og lett å rapportere på.' },
            ],
        },
        {
            key: 'resolved', title: '2.2 En skole der alle kan lykkes — innledningen', description: 'Vedtatt i programkomiteen', status: 'resolved', text: lines(45, 62), linesPerPage: 30, note: 'chapter 11',
            access: { bjorn: 'voter', clara: 'voter', david: 'supervisor' },
            variants: [
                { key: 'lese', by: 'bjorn', line: 'forutsetning for all annen læring, og må tidlig læres', newText: 'forutsetning for all annen læring, og må læres i løpet av de første skoleårene.',
                  title: 'Presiser hva «tidlig» betyr', rationale: '«Tidlig» er et ord alle er enige om og ingen forplikter seg til. De første skoleårene er noe skolene kan styres etter.', status: 'approved', final: { yes: 14, no: 3, abstain: 1, ago: 86400000 } },
                { key: 'foreldre', by: 'clara', line: 'Foreldrene må bevisstgjøres på det ansvaret', newText: 'Foreldrene har ansvaret for oppdragelse, dannelse og oppfølging',
                  title: 'Stram inn setningen om foreldreansvar', rationale: '«Bevisstgjøres» høres ut som om kommunen skal oppdra foreldrene. Si heller rett ut hvem som har ansvaret.', status: 'rejected', final: { yes: 6, no: 9, abstain: 3, ago: 86400000 } },
            ],
            resolve: { docVote: { yes: 15, no: 2, abstain: 1 }, ago: 86400000 },
        },
    ],
    targets: {
        inviteEmail: 'erik@demo.votetext',
        newUser: { name: 'Erik Moen', org: 'Frogner Høyre' },
        newDoc: {
            title: 'Kapittel 3: Byen med det store hjertet — utkast',
            text: ['Kapittel 3: Byen med det store hjertet', '', '1. Oslo skal være en by der alle kan delta, uansett bakgrunn og lommebok.',
                '2. Idretten og frivilligheten er limet i nabolagene, og kommunen skal gjøre det enkelt å drive dem.',
                '3. Kulturlivet skal være fritt, mangfoldig og tilgjengelig i hele byen.', '4. Alle som kan jobbe, skal få hjelp til å komme i arbeid.',
                '5. Integrering skjer gjennom språk, arbeid og deltakelse.'].join('\n'),
        },
        readDoc: 'Oslo Høyres program', firstCard: 'eiendomsskatten', jumpCard: 'likebehandlingen av barnehager', jumpLine: 'sikre likebehandling av kommunale',
        discussCard: 'eiendomsskatten', comment: 'Støtter dette. Kan vi også si hva den avviklede eiendomsskatten erstattes med, så ingen tror velferden kuttes?', commentMatch: 'erstattes med',
        propose: {
            line: 'går, sykler, reiser kollektivt eller med bil.', title: 'Nevn ytre by i innledningen',
            text: 'går, sykler, reiser kollektivt eller kjører bil – og uansett om du bor i sentrum eller i ytre by.',
            rationale: 'Innledningen nevner marka og fjorden, men ikke at avstandene er størst i ytre by. Én setning gjør at flere kjenner seg igjen.',
            editedTitle: 'Nevn ytre by allerede i innledningen',
        },
        voteCard: 'likebehandlingen av barnehager', shareCard: 'eiendomsskatten',
        votingDoc: 'Mulighetenes by', conflictA: 'Lov svar innen fire uker', conflictB: 'lete etter grunner',
        passedCard: 'Daglig høytlesing', thresholdCard: '50 prosent barnehagelærere', rootCard: 'Alle barn, ikke flere barn',
        resolvedDoc: 'En skole der alle kan lykkes', modCard: 'likebehandlingen av barnehager', modComment: 'el-sykkel',
    },
};
