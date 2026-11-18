'use strict';

// Demo data for recording the tutorial video (specs/tutorial-video-script.md): node scripts/seed-demo.js [scenario]
// The scenario (default "garden"; "oslo" for the Oslo programme draft) lives in tutorial/scenarios/<name>.js and is
// seeded by tutorial/lib/seed.js: four demo users and four documents, one per lifecycle stage, so every chapter
// can be recorded independently from the same state. Run on a fresh or dev database.

require('dotenv').config();
const { seedScenario, loadScenario } = require('../tutorial/lib/seed');

const scenario = loadScenario(process.argv[2] || 'garden');
if (seedScenario(scenario)) console.log(`\nDone. See specs/${scenario.scripts.en} for the recording script.`);
