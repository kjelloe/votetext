#!/usr/bin/env node
'use strict';

// Set a user's site role from the server shell — the only way to create the
// first superadmin. Usage: node scripts/grant-role.js <email> <user|creator|superadmin>

require('dotenv').config();
const { getOne, run, transaction, logActivity } = require('../src/db');

const ROLES = ['user', 'creator', 'superadmin'];
const [email, role] = process.argv.slice(2);

if (!email || !ROLES.includes(role)) {
    console.error('Usage: node scripts/grant-role.js <email> <user|creator|superadmin>');
    process.exit(1);
}

const user = getOne('SELECT id, email, role FROM users WHERE email = ?', [email.trim().toLowerCase()]);
if (!user) {
    console.error(`No user with email ${email} — they must sign in once first`);
    process.exit(1);
}
if (user.role === role) {
    console.log(`${user.email} already has role ${role}`);
    process.exit(0);
}
transaction(() => {
    run("UPDATE users SET role = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?", [role, user.id]);
    logActivity(user.id, null, null, 'user_role_changed', { target_user_id: user.id, role, previous_role: user.role, by: 'cli' });
});
console.log(`${user.email}: ${user.role} → ${role}`);
