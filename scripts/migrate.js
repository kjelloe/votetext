'use strict';

require('dotenv').config();
const Database = require('better-sqlite3');

const dbPath = process.env.DATABASE_PATH || './data/votetext.db';
const db = new Database(dbPath);

function addColumnIfMissing(table, column, definition) {
    const cols = db.pragma(`table_info(${table})`);
    if (cols.some(c => c.name === column)) {
        console.log(`[skip] ${table}.${column} already exists`);
        return;
    }
    db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
    console.log(`[done] Added ${table}.${column}`);
}

addColumnIfMissing('documents', 'deleted_at', 'TEXT');

db.close();
console.log('Migration complete.');
