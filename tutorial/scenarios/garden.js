'use strict';

// The Community Garden scenario: the cast and documents of specs/tutorial-video-script.md, plus the targets
// the chapter action scripts click, select and type (tutorial/chapters/*.js read scenario.targets).

const CHARTER_TEXT = [
    'Community Garden Charter',
    '',
    'Section 1 — Purpose',
    '',
    '1.1 The community garden exists to give every resident access to a plot of soil, sunlight, and good company.',
    '1.2 The garden is maintained collectively, and every member shares responsibility for the common areas.',
    '1.3 Decisions about the garden are made openly, with every member entitled to propose changes and vote.',
    '',
    'Section 2 — Membership',
    '',
    '2.1 Membership is open to all residents of the neighbourhood on payment of the annual fee.',
    '2.2 The annual fee is 250 kroner, payable before the first of April.',
    '2.3 Members who do not tend their plot for a full season may lose it to the waiting list.',
    '2.4 Guests are welcome during opening hours when accompanied by a member.',
    '',
    'Section 3 — Plots and Common Areas',
    '',
    '3.1 Each membership includes one plot of ten square metres.',
    '3.2 Plots must be kept free of invasive species and tall structures.',
    '3.3 The tool shed, compost bins, and water taps are shared by all members.',
    '3.4 The rose bed by the gate is maintained by volunteers and funded from the common budget.',
    '',
    'Section 4 — Conduct',
    '',
    '4.1 Members shall treat each other, and each other’s plots, with respect.',
    '4.2 Radios and speakers may not be used in the garden.',
    '4.3 Dogs must be kept on a leash at all times.',
    '4.4 Disputes between members are brought to the garden committee before anything else.',
    '',
    'Section 5 — Meetings and Decisions',
    '',
    '5.1 The garden assembly meets twice a year, in March and September.',
    '5.2 Proposals to change this charter are published at least two weeks before the assembly.',
    '5.3 Changes to this charter require a simple majority of the votes cast.',
    '5.4 The committee may adopt temporary rules between assemblies, valid until the next meeting.',
].join('\n');

const BUDGET_TEXT = [
    'Garden Budget Priorities 2027',
    '',
    '1. The common budget for 2027 is 18,000 kroner, carried by membership fees and the autumn plant sale.',
    '2. The largest single expense is water, estimated at 6,000 kroner for the season.',
    '3. The committee proposes to spend 4,000 kroner on new hand tools for the shared shed.',
    '4. The remaining funds are reserved for compost, seeds for the common beds, and small repairs.',
    '5. Any surplus at the end of the season is carried over to the next year.',
].join('\n');

const WATERING_TEXT = [
    'Watering Schedule Amendment',
    '',
    '1. Watering is permitted on weekday evenings between six and nine.',
    '2. Weekend watering is permitted in the morning between eight and eleven.',
    '3. Sprinklers may only be used on the common beds.',
    '4. During drought restrictions, the committee posts a reduced schedule at the gate.',
].join('\n');

const SHED_TEXT = [
    'Tool Shed Rules 2026',
    '',
    '1. The shed is open whenever the garden is open.',
    '2. Tools are returned clean and dry the same day they are borrowed.',
    '3. Power tools may be borrowed for up to two days with a note in the logbook.',
    '4. Broken tools are reported to the committee, not returned quietly to the rack.',
].join('\n');

module.exports = {
    name: 'garden',
    scripts: { en: 'tutorial-video-script.md', no: 'tutorial-video-script.no.md' },
    outDir: '',
    owner: 'anna',
    users: {
        anna:  { email: 'anna@demo.votetext',  name: 'Anna Berg',  org: 'Garden Committee', role: 'creator', label: 'Anna (chair/owner)' },
        bjorn: { email: 'bjorn@demo.votetext', name: 'Bjørn Dahl', org: 'Plot 14', label: 'Bjørn (proposer)' },
        clara: { email: 'clara@demo.votetext', name: 'Clara Foss', org: 'Plot 3', label: 'Clara (voter)' },
        david: { email: 'david@demo.votetext', name: 'David Lie',  org: 'Garden Committee', label: 'David (supervisor)' },
    },
    documents: [
        {
            key: 'open', title: 'Community Garden Charter', description: 'The rules we garden by — annual revision', status: 'open', text: CHARTER_TEXT, linesPerPage: 20, note: 'chapters 4–8, 12',
            access: { bjorn: 'proposer', clara: 'voter', david: 'supervisor' },
            variants: [
                { key: 'fee', by: 'bjorn', line: '2.2 The annual fee is 250', newText: '2.2 The annual fee is 300 kroner, payable before the first of April.',
                  title: 'Raise the annual fee to 300 kroner', rationale: 'Water costs have gone up two years in a row. A modest increase keeps the budget balanced without cutting the common beds.',
                  votes: [['anna', 1], ['clara', 1]],
                  comments: [{ by: 'clara', text: 'Reasonable. Could we also mention what the extra 50 kroner is earmarked for?', replies: [{ by: 'bjorn', text: 'Good idea — the rationale now says it: water costs. I can add it to the text if others agree.' }] }] },
                { key: 'dog', by: 'clara', line: '4.3 Dogs must be kept', newText: '4.3 Dogs are welcome on a leash; they must never be left unattended in the garden.',
                  title: 'Clarify the dog rule', rationale: 'The current wording sounds unfriendly. We love dogs — we just don’t want them digging up the carrots alone.',
                  votes: [['bjorn', 1], ['anna', 0]],
                  comments: [{ by: 'clara', text: 'By the way — my cousin sells discount garden gnomes, message me for the catalogue!' }] },
            ],
        },
        {
            key: 'voting', title: 'Garden Budget Priorities 2027', description: 'How we spend the common budget next season', status: 'voting', text: BUDGET_TEXT, linesPerPage: 30, note: 'chapter 9',
            access: { bjorn: 'voter', clara: 'voter', david: 'supervisor' },
            variants: [
                { key: 'tools1', by: 'bjorn', line: '3. The committee proposes to spend 4,000', newText: '3. The committee proposes to spend 4,000 kroner on a shared battery-driven hedge trimmer and loppers.',
                  title: 'Spend the tool budget on a hedge trimmer', rationale: 'The hedges along the north fence take four weekends by hand. One good trimmer saves us all that time.', votes: [['clara', 1], ['anna', 1]] },
                { key: 'tools2', by: 'clara', line: '3. The committee proposes to spend 4,000', newText: '3. The committee proposes to spend 2,000 kroner on hand tools and 2,000 kroner on a repair fund for what we already own.',
                  title: 'Split the tool budget: half new tools, half repairs', rationale: 'Half our "broken" tools just need new handles. A repair fund stretches the budget further than buying new.', votes: [['bjorn', 1], ['anna', -1]] },
                { key: 'water', by: 'bjorn', line: '2. The largest single expense is water', newText: '2. The largest single expense is water, estimated at 6,000 kroner; the committee will obtain a rain barrel quote before the season starts.',
                  title: 'Investigate rain barrels to cut the water bill', rationale: 'A one-time investment in rain barrels could cut the recurring water cost from next year on.', votes: [['clara', 1], ['anna', 1], ['david', 1]] },
            ],
        },
        {
            key: 'final', title: 'Watering Schedule Amendment', description: 'Adjusting watering hours after last summer’s drought', status: 'final_voting', text: WATERING_TEXT, linesPerPage: 30, note: 'chapter 10',
            access: { bjorn: 'voter', clara: 'voter', david: 'supervisor' },
            variants: [
                { key: 'root', by: 'bjorn', line: '1. Watering is permitted on weekday evenings', newText: '1. Watering is permitted on weekday evenings between seven and ten.',
                  title: 'Shift evening watering one hour later', rationale: 'Most members are not home from work by six. Seven to ten matches when people actually garden.', status: 'conflict', vote_order: 1, votes: [['clara', 1], ['anna', 1]] },
                { key: 'child', by: 'clara', line: '1. Watering is permitted on weekday evenings', newText: '1. Watering is permitted on weekday evenings between six and ten.',
                  title: 'Extend evening watering instead of shifting it', rationale: 'Fallback if the shift fails: keep six o’clock for the early birds and simply add the extra hour.', status: 'conflict', parent: 'root', vote_order: 1 },
                { key: 'sprinkler', by: 'bjorn', line: '3. Sprinklers may only be used', newText: '3. Sprinklers may only be used on the common beds, and never during drought restrictions.',
                  title: 'Ban sprinklers during drought restrictions', rationale: 'Obvious in spirit, but it should be written down before the next dry summer.', final: { yes: 11, no: 1, abstain: 2, ago: 3600000 } },
                { key: 'weekend', by: 'clara', line: '2. Weekend watering is permitted', newText: '2. Weekend watering is permitted in the morning between seven and eleven.',
                  title: 'Open weekend watering an hour earlier', rationale: 'Summer mornings are cooler at seven — better for the plants and the gardeners.' },
            ],
        },
        {
            key: 'resolved', title: 'Tool Shed Rules 2026', description: 'Adopted at the spring assembly', status: 'resolved', text: SHED_TEXT, linesPerPage: 30, note: 'chapter 11',
            access: { bjorn: 'voter', clara: 'voter', david: 'supervisor' },
            variants: [
                { key: 'power', by: 'bjorn', line: '3. Power tools may be borrowed', newText: '3. Power tools may be borrowed for up to four days with a note in the logbook.',
                  title: 'Extend power tool loans to four days', rationale: 'Two days is too short for a fence project. Four days still keeps tools circulating.', status: 'approved', final: { yes: 14, no: 3, abstain: 1, ago: 86400000 } },
                { key: 'broken', by: 'clara', line: '4. Broken tools are reported', newText: '4. Broken tools are reported to the committee within a day, not returned quietly to the rack.',
                  title: 'Add a deadline for reporting broken tools', rationale: 'A deadline makes the rule enforceable instead of aspirational.', status: 'rejected', final: { yes: 6, no: 9, abstain: 3, ago: 86400000 } },
            ],
            resolve: { docVote: { yes: 15, no: 2, abstain: 1 }, ago: 86400000 },
        },
    ],
    targets: {
        inviteEmail: 'erik@demo.votetext',
        newUser: { name: 'Erik Moen', org: 'Plot 7' },
        newDoc: {
            title: 'Spring Planting Plan 2027',
            text: ['Spring Planting Plan 2027', '', '1. The common beds are planted on the last weekend of April.', "2. This year's theme crops are squash, sugar peas, and dahlias.",
                '3. Seedlings are raised in the greenhouse from mid-March; sign-up sheet on the door.', '4. Each member contributes two hours to the planting weekend or one tray of seedlings.',
                '5. The plan is evaluated at the September assembly.'].join('\n'),
        },
        readDoc: 'Community Garden Charter', firstCard: 'Raise the annual fee', jumpCard: 'Clarify the dog rule', jumpLine: '4.3 Dogs',
        discussCard: 'Raise the annual fee', comment: 'I support this. Could we phase the increase in over two years for members on a tight budget?', commentMatch: 'phase the increase',
        propose: {
            line: '2.4 Guests', title: 'Let guests visit without an escort',
            text: "2.4 Guests are welcome during opening hours; children's guests must be accompanied by a member.",
            rationale: "Requiring an escort for every adult guest is impractical, members' partners and neighbours visit all the time. Keeping the rule only for children's guests covers the actual concern.",
            editedTitle: 'Let adult guests visit without an escort',
        },
        voteCard: 'Clarify the dog rule', shareCard: 'Raise the annual fee',
        votingDoc: 'Garden Budget', conflictA: 'hedge trimmer', conflictB: 'Split the tool budget',
        passedCard: 'Ban sprinklers', thresholdCard: 'Open weekend watering', rootCard: 'Shift evening watering',
        resolvedDoc: 'Tool Shed', modCard: 'Clarify the dog rule', modComment: 'garden gnomes',
    },
};
