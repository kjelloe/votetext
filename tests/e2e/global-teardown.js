'use strict';

const fs = require('fs');
const path = require('path');

const DB_PATH = path.resolve('data/e2e_votetext.db');
const AUTH_DIR = path.resolve('tests/e2e/.auth');

module.exports = async function globalTeardown() {
    const pidFile = path.join(AUTH_DIR, 'server.pid');
    if (fs.existsSync(pidFile)) {
        const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
        try { process.kill(pid, 'SIGTERM'); } catch (_) {}
        fs.unlinkSync(pidFile);
    }
    for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) {
        if (fs.existsSync(f)) fs.unlinkSync(f);
    }
};
