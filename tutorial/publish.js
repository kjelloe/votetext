'use strict';

// Copies the finished subtitled tutorial videos from tutorial/out/ into public/video/, where scripts/deploy.sh
// ships them from the working tree (they are not committed: ~40 MB each). node tutorial/publish.js
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, 'out');
const DEST = path.join(__dirname, '..', 'public', 'video');
fs.mkdirSync(DEST, { recursive: true });
const VIDEO = /^votetext-tutorial-(?:[a-z]+-)?[a-z]{2}\.subtitled\.mp4$/;
const files = [];
if (fs.existsSync(OUT)) {
    for (const entry of fs.readdirSync(OUT, { withFileTypes: true })) {
        if (entry.isFile() && VIDEO.test(entry.name)) files.push(path.join(OUT, entry.name));
        else if (entry.isDirectory()) for (const f of fs.readdirSync(path.join(OUT, entry.name))) if (VIDEO.test(f)) files.push(path.join(OUT, entry.name, f));
    }
}
if (!files.length) { console.error('Nothing to publish: run npm run tutorial -- all --burn first'); process.exit(1); }
for (const f of files) {
    const name = path.basename(f);
    fs.copyFileSync(f, path.join(DEST, name));
    console.log(`${name} → public/video/ (${(fs.statSync(path.join(DEST, name)).size / 1048576).toFixed(1)} MB)`);
}
