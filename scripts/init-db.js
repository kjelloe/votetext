'use strict';

const fs = require('fs');
const path = require('path');
require('dotenv').config();
const Database = require('better-sqlite3');

const DB_PATH = process.env.DATABASE_PATH || './data/votetext.db';
const SCHEMA_PATH = path.join(__dirname, '..', 'schema.sql');

const dataDir = path.dirname(path.resolve(DB_PATH));
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
    console.log(`Created directory: ${dataDir}`);
}

const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
const db = new Database(path.resolve(DB_PATH));
db.exec(schema);

const { count } = db.prepare("SELECT count(*) as count FROM sqlite_master WHERE type='table'").get();
console.log(`Database initialized: ${path.resolve(DB_PATH)}`);
console.log(`Tables: ${count}`);
db.close();
