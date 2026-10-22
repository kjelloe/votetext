'use strict';

// scripts/migrate.js must turn a database created from ANY earlier schema.sql
// into exactly what a fresh schema.sql produces, keep every row, and change
// nothing when it fails. Fixtures are schema.sql as committed on the given dates.

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const Database = require('better-sqlite3');

const ROOT = path.join(__dirname, '..');
const MIGRATE = path.join(ROOT, 'scripts', 'migrate.js');
const SCHEMA = fs.readFileSync(path.join(ROOT, 'schema.sql'), 'utf8');
const FIXTURES = ['schema-2026-05-23.sql', 'schema-2026-06-07.sql', 'schema-2026-07-11.sql', 'schema-2026-10-03.sql'];
const fixture = name => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'votetext-migrate-'));
after(() => fs.rmSync(TMP, { recursive: true, force: true }));

let counter = 0;
function createDb(sql) {
    const file = path.join(TMP, `db-${++counter}.db`);
    const db = new Database(file);
    db.exec(sql);
    db.close();
    return file;
}

function migrate(file) {
    const r = spawnSync(process.execPath, [MIGRATE], { env: { ...process.env, DATABASE_PATH: file }, encoding: 'utf8' });
    return { status: r.status, out: r.stdout + r.stderr };
}

const definition = sql => sql.slice(sql.search(/\(|\bON\b/)).replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim();

function describe(file) {
    const db = new Database(file, { readonly: true });
    const rows = db.prepare("SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type, name").all();
    const out = {};
    for (const r of rows) {
        out[`${r.type} ${r.name}`] = {
            definition: definition(r.sql),
            columns: r.type === 'table' ? db.pragma(`table_info(${r.name})`).map(c => `${c.name}|${c.type}|${c.notnull}|${c.dflt_value}|${c.pk}`) : undefined,
        };
    }
    db.close();
    return out;
}

// Rows that every schema version can hold
function seed(file) {
    const db = new Database(file);
    db.exec(`
        INSERT INTO users (email, display_name) VALUES ('ann@old.test', 'Ann'), ('bo@old.test', 'Bo'), ('gone@old.test', 'Gone');
        DELETE FROM users WHERE email = 'gone@old.test';
        INSERT INTO documents (title, owner_id, status) VALUES ('Old charter', 1, 'open');
        INSERT INTO document_lines (document_id, page_num, line_num, original_text, char_offset_start, char_offset_end) VALUES (1, 1, 1, 'First line', 0, 10);
        INSERT INTO variants (document_id, proposed_by, char_start, char_end, operation, new_text, title) VALUES (1, 2, 0, 5, 'replace', 'Prime', 'Old proposal');
        INSERT INTO votes (variant_id, user_id, vote_value) VALUES (1, 1, 1);
        INSERT INTO comments (variant_id, user_id, text) VALUES (1, 1, 'Old comment');
        INSERT INTO user_document_access (user_id, document_id, access_level) VALUES (2, 1, 'voter');
        INSERT INTO activity_log (user_id, document_id, variant_id, action, metadata) VALUES (2, 1, 1, 'variant_proposed', '{"title":"Old proposal"}');
    `);
    db.close();
}

const fresh = describe(createDb(SCHEMA));

for (const name of FIXTURES) {
    test(`migrate: ${name} → matches schema.sql, keeps data, second run is a no-op`, () => {
        const file = createDb(fixture(name));
        seed(file);

        const first = migrate(file);
        assert.equal(first.status, 0, first.out);
        assert.deepEqual(describe(file), fresh);

        const db = new Database(file);
        db.pragma('foreign_keys = ON');
        assert.deepEqual(db.pragma('foreign_key_check'), []);
        assert.equal(db.prepare('SELECT COUNT(*) n FROM users').get().n, 2);
        assert.equal(db.prepare('SELECT title FROM documents WHERE id = 1').get().title, 'Old charter');
        assert.equal(db.prepare('SELECT original_text FROM document_lines WHERE document_id = 1').get().original_text, 'First line');
        const variant = db.prepare('SELECT * FROM variants WHERE id = 1').get();
        assert.equal(variant.new_text, 'Prime');
        assert.equal(variant.allow_anonymous_share, 0, 'new NOT NULL column takes its default');
        assert.equal(variant.majority_threshold, null);
        assert.equal(db.prepare('SELECT vote_value FROM votes WHERE variant_id = 1').get().vote_value, 1);
        assert.equal(db.prepare('SELECT text FROM comments WHERE id = 1').get().text, 'Old comment');
        assert.equal(db.prepare('SELECT access_level FROM user_document_access WHERE user_id = 2').get().access_level, 'voter');
        assert.equal(db.prepare('SELECT metadata FROM activity_log WHERE id = 1').get().metadata, '{"title":"Old proposal"}');

        const next = db.prepare("INSERT INTO users (email, display_name) VALUES ('new@old.test', 'New')").run();
        assert.equal(next.lastInsertRowid, 4, 'AUTOINCREMENT sequence survives the rebuild — id 3 is not reused');

        const actions = SCHEMA.match(/CHECK \(action IN \(([\s\S]*?)\)\)/)[1].match(/'[a-z_]+'/g).map(a => a.slice(1, -1));
        assert.ok(actions.length >= 23);
        const log = db.prepare('INSERT INTO activity_log (user_id, document_id, action) VALUES (1, 1, ?)');
        for (const action of actions) log.run(action);
        db.prepare("INSERT INTO user_document_access (user_id, document_id, access_level) VALUES (1, 1, 'supervisor')").run();
        db.prepare("UPDATE documents SET status = 'final_voting' WHERE id = 1").run();
        db.close();

        const second = migrate(file);
        assert.equal(second.status, 0, second.out);
        assert.match(second.out, /already matches schema\.sql/);
        assert.deepEqual(describe(file), fresh);
    });
}

test('migrate: leftover *_new table from a crashed earlier migration does not block', () => {
    const file = createDb(fixture(FIXTURES[0]));
    seed(file);
    const db = new Database(file);
    db.exec('CREATE TABLE variants_new (id INTEGER PRIMARY KEY, junk TEXT)');
    db.close();

    const r = migrate(file);
    assert.equal(r.status, 0, r.out);
    assert.deepEqual(describe(file), fresh);
});

test('migrate: columns added with ALTER TABLE in a different order are normalised', () => {
    const file = createDb(fixture(FIXTURES[0]));
    seed(file);
    const db = new Database(file);
    db.exec(`
        ALTER TABLE variants ADD COLUMN majority_threshold TEXT;
        ALTER TABLE variants ADD COLUMN final_yes INTEGER;
        UPDATE variants SET majority_threshold = 'two_thirds', final_yes = 7 WHERE id = 1;
    `);
    db.close();

    const r = migrate(file);
    assert.equal(r.status, 0, r.out);
    assert.deepEqual(describe(file), fresh);
    const check = new Database(file, { readonly: true });
    const v = check.prepare('SELECT majority_threshold, final_yes, new_text FROM variants WHERE id = 1').get();
    check.close();
    assert.deepEqual(v, { majority_threshold: 'two_thirds', final_yes: 7, new_text: 'Prime' }, 'values follow their column names, not positions');
});

test('migrate: a row that does not fit the new schema fails the run and changes nothing', () => {
    const file = createDb(fixture(FIXTURES[0]).replace("'resolved', 'archived')", "'resolved', 'archived', 'limbo')"));
    seed(file);
    const db = new Database(file);
    db.prepare("UPDATE documents SET status = 'limbo' WHERE id = 1").run();
    db.close();
    const before = describe(file);

    const r = migrate(file);
    assert.equal(r.status, 1);
    assert.match(r.out, /Migration failed, nothing was changed/);
    assert.deepEqual(describe(file), before);
    const check = new Database(file, { readonly: true });
    assert.equal(check.prepare('SELECT status FROM documents WHERE id = 1').get().status, 'limbo');
    check.close();
});

test('migrate: a table with columns schema.sql does not know is left untouched (database newer than code)', () => {
    const file = createDb(SCHEMA);
    const db = new Database(file);
    db.exec("ALTER TABLE users ADD COLUMN from_the_future TEXT; INSERT INTO users (email, from_the_future) VALUES ('later@new.test', 'kept')");
    db.close();

    const r = migrate(file);
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /users has columns schema\.sql does not define \(from_the_future\)/);
    const check = new Database(file, { readonly: true });
    assert.equal(check.prepare("SELECT from_the_future FROM users WHERE email = 'later@new.test'").get().from_the_future, 'kept');
    check.close();
});

test('migrate: an empty database file becomes a complete schema', () => {
    const file = path.join(TMP, 'empty.db');
    const r = migrate(file);
    assert.equal(r.status, 0, r.out);
    assert.deepEqual(describe(file), fresh);
});
