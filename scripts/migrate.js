'use strict';

// Brings an existing database in line with schema.sql, the single source of
// truth. Missing tables and indexes are created. A table whose definition
// differs is rebuilt: new table from schema.sql, rows copied by column name,
// old table dropped, new one renamed. Everything runs in one transaction, so a
// failure leaves the database exactly as it was. Safe to run on every deploy.
//
// A table that has columns schema.sql does not know is left untouched — that
// means the database is newer than the code (a rollback), and nothing is dropped.

const fs = require('fs');
const path = require('path');
require('dotenv').config();
const Database = require('better-sqlite3');

const dbPath = process.env.DATABASE_PATH || './data/votetext.db';
const schema = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');

const reference = new Database(':memory:');
reference.exec(schema);
const db = new Database(dbPath);

function objects(conn, type) {
    return conn.prepare(
        "SELECT name, sql FROM sqlite_master WHERE type = ? AND sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY rowid"
    ).all(type);
}

function columns(conn, table) {
    return conn.pragma(`table_info(${table})`).map(c => c.name);
}

// Definition without the name, comments and layout, so a rebuilt or re-indented
// table compares equal to its schema.sql original.
function definition(sql) {
    return sql.slice(sql.search(/\(|\bON\b/)).replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim();
}

function rebuild(name, sql) {
    const wanted = columns(reference, name);
    const shared = columns(db, name).filter(c => wanted.includes(c)).join(', ');
    const hasSequences = db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'sqlite_sequence'").get();
    const sequence = hasSequences && db.prepare('SELECT seq FROM sqlite_sequence WHERE name = ?').get(name);

    db.exec(`DROP TABLE IF EXISTS ${name}_new`);
    db.exec(sql.replace(/^CREATE TABLE (IF NOT EXISTS )?\S+/, `CREATE TABLE ${name}_new`));
    db.exec(`INSERT INTO ${name}_new (${shared}) SELECT ${shared} FROM ${name}`);
    db.exec(`DROP TABLE ${name}`);
    db.exec(`ALTER TABLE ${name}_new RENAME TO ${name}`);

    if (sequence) {
        db.prepare('DELETE FROM sqlite_sequence WHERE name = ?').run(name);
        db.prepare('INSERT INTO sqlite_sequence (name, seq) VALUES (?, ?)').run(name, sequence.seq);
    }
}

function migrate() {
    const done = [];
    const warnings = [];
    const violationsBefore = db.pragma('foreign_key_check').length;

    const live = new Map(objects(db, 'table').map(t => [t.name, t.sql]));
    const known = new Set();
    for (const { name, sql } of objects(reference, 'table')) {
        known.add(name);
        if (!live.has(name)) {
            db.exec(sql);
            done.push(`created table ${name}`);
            continue;
        }
        if (definition(live.get(name)) === definition(sql)) continue;

        const wanted = columns(reference, name);
        const extra = columns(db, name).filter(c => !wanted.includes(c));
        if (extra.length) {
            warnings.push(`${name} has columns schema.sql does not define (${extra.join(', ')}) — left untouched; the database looks newer than the code`);
            continue;
        }
        const added = wanted.filter(c => !columns(db, name).includes(c));
        rebuild(name, sql);
        done.push(`rebuilt ${name}` + (added.length ? ` (new columns: ${added.join(', ')})` : ' (definition changed)'));
    }
    for (const name of live.keys()) {
        if (!known.has(name) && db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name)) {
            warnings.push(`table ${name} is not in schema.sql — left untouched`);
        }
    }

    const liveIndexes = new Map(objects(db, 'index').map(i => [i.name, i.sql]));
    for (const { name, sql } of objects(reference, 'index')) {
        if (liveIndexes.has(name)) {
            if (definition(liveIndexes.get(name)) === definition(sql)) continue;
            db.exec(`DROP INDEX ${name}`);
        }
        db.exec(sql);
        done.push(`created index ${name}`);
    }

    const violationsAfter = db.pragma('foreign_key_check').length;
    if (violationsAfter > violationsBefore) {
        throw new Error(`migration would introduce ${violationsAfter - violationsBefore} foreign key violation(s)`);
    }
    return { done, warnings };
}

// Table rebuilds must not fire ON DELETE actions; the pragma cannot be changed
// inside a transaction, so it is set first.
db.pragma('foreign_keys = OFF');
try {
    const { done, warnings } = db.transaction(migrate)();
    for (const line of done) console.log(`[done] ${line}`);
    for (const line of warnings) console.warn(`[warn] ${line}`);
    console.log(done.length ? `Migration complete — ${done.length} change(s).` : 'Database already matches schema.sql.');
} catch (err) {
    console.error(`Migration failed, nothing was changed: ${err.message}`);
    process.exitCode = 1;
} finally {
    db.close();
    reference.close();
}
