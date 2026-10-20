'use strict';

// Contracts between scripts/deploy.sh and the two cloud-init templates: every
// sudo command the script runs must be allowed by the hardened sudoers, the
// embedded first-deploy.sh must parse, and placeholders must be documented.
// The end-to-end run of the script is `npm run test:deploy` (not part of npm test).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const deploy = read('scripts/deploy.sh');
const hardened = read('cloud-init-hardened-example.yaml');
const simple = read('cloud-init-example.yaml');

function bashOk(script) {
    const r = spawnSync('bash', ['-n'], { input: script, encoding: 'utf8' });
    return r.status === 0 ? null : r.stderr;
}

// Pull a `content: |` block out of a write_files entry by path
function fileBlock(yaml, filePath) {
    const start = yaml.indexOf(`- path: ${filePath}`);
    assert.ok(start >= 0, `${filePath} not in template`);
    const body = yaml.slice(yaml.indexOf('content: |', start) + 'content: |'.length);
    const lines = [];
    for (const line of body.split('\n').slice(1)) {
        if (line.trim() !== '' && !/^\s{6}/.test(line)) break;
        lines.push(line.replace(/^\s{6}/, ''));
    }
    return lines.join('\n');
}

test('deploy.sh and the wrapper parse', () => {
    assert.equal(bashOk(deploy), null);
    assert.equal(bashOk(read('tests/deploy/run-local.sh')), null);
});

test('every sudo command in deploy.sh is allowed by the hardened sudoers', () => {
    const sudoers = fileBlock(hardened, '/etc/sudoers.d/votetext');
    const allowed = [];
    for (const m of sudoers.matchAll(/Cmnd_Alias \w+ = (.+)/g)) allowed.push(...m[1].split(',').map(s => s.trim()));
    assert.ok(allowed.length >= 8, 'sudoers aliases parsed');
    assert.match(sudoers, /<DEPLOY_USER> ALL=\(votetext\) NOPASSWD: ALL/, 'deploy user may act as the service user');

    const uses = [...deploy.matchAll(/\bsudo(?: -n)? ((?:systemctl|journalctl|ufw|nginx|certbot|-l)\b[^|;&\n]*)/g)]
        .map(m => m[1].replace(/\s*\d?>.*$/, '').replace(/"?\$SERVICE"?/g, 'votetext').replace(/"$/, '').trim().replace(/\s+/g, ' '));
    assert.ok(uses.length >= 5, `found sudo uses: ${uses.length}`);
    const binaries = { systemctl: '/usr/bin/systemctl', journalctl: '/usr/bin/journalctl', nginx: '/usr/sbin/nginx', ufw: '/usr/sbin/ufw', certbot: '/usr/bin/certbot' };
    for (const use of uses) {
        if (use.startsWith('-l')) continue; // listing own privileges needs no rule
        const [cmd, ...args] = use.split(' ');
        const full = `${binaries[cmd] || cmd} ${args.join(' ')}`.trim();
        const ok = allowed.some(rule => {
            if (rule.endsWith(' *')) return full.startsWith(rule.slice(0, -2));
            return full === rule || full.startsWith(rule + ' ') && rule.includes('journalctl');
        });
        assert.ok(ok, `"sudo ${use}" is not covered by the hardened sudoers (${full})`);
    }
});

for (const [name, yaml] of [['cloud-init-example.yaml', simple], ['cloud-init-hardened-example.yaml', hardened]]) {
    test(`${name}: first-deploy.sh parses once placeholders are filled; placeholders are documented in the header`, () => {
        const placeholders = [...new Set(yaml.match(/<[A-Z_]+>/g))];
        const header = yaml.slice(0, yaml.indexOf('users:'));
        for (const p of placeholders) {
            if (p === '<STORAGE_BOX_USER>') continue; // documented next to the commented-out cron line
            assert.ok(header.includes(p), `${p} is used but not explained in the header of ${name}`);
        }
        const script = fileBlock(yaml, '/home/<DEPLOY_USER>/first-deploy.sh').replace(/<[A-Z_]+>/g, 'x');
        assert.equal(bashOk(script), null);
        assert.ok(!/npm install|init-db/.test(script), 'first-deploy.sh must leave installing and the database to scripts/deploy.sh');
    });
}

test('hardened unit runs as the service user and can only write data/ and backups/', () => {
    const unit = fileBlock(hardened, '/etc/systemd/system/votetext.service');
    assert.match(unit, /^User=votetext$/m);
    assert.match(unit, /^ProtectSystem=strict$/m);
    assert.match(unit, /^ReadWritePaths=\/opt\/votetext\/data \/opt\/votetext\/backups$/m);
    assert.match(unit, /^NoNewPrivileges=true$/m);
    assert.ok(!/MemoryDenyWriteExecute/.test(unit), 'Node needs writable+executable memory for its JIT');
});

test('deploy.env.example lists every DEPLOY_* variable the script reads, and deploy.env is ignored', () => {
    const used = new Set(deploy.match(/DEPLOY_[A-Z_]+/g));
    const example = read('deploy.env.example');
    for (const v of used) assert.ok(example.includes(v + '='), `${v} missing from deploy.env.example`);
    assert.match(read('.gitignore'), /^deploy\.env$/m);
});
