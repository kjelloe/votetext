'use strict';

const { getOne } = require('../db');

// Per-user minimum interval between two rows of the same kind. Returns the
// 429 body or null. Table and column are fixed by the two wrappers below.
function cooldown(table, column, userId, seconds, what) {
    if (process.env.NODE_ENV === 'test') return null;
    const last = getOne(`SELECT created_at FROM ${table} WHERE ${column} = ? ORDER BY created_at DESC LIMIT 1`, [userId]);
    if (!last) return null;
    const elapsed = (Date.now() - new Date(last.created_at).getTime()) / 1000;
    if (elapsed >= seconds) return null;
    const retryAfter = Math.ceil(seconds - elapsed);
    return { error: `Please wait ${retryAfter} more second${retryAfter !== 1 ? 's' : ''} before ${what}.`, retry_after: retryAfter };
}

const proposalCooldown = userId => cooldown('variants', 'proposed_by', userId, parseInt(process.env.VARIANT_COOLDOWN_SECONDS || '5'), 'submitting a new proposal');
const commentCooldown = userId => cooldown('comments', 'user_id', userId, parseInt(process.env.COMMENT_COOLDOWN_SECONDS || '5'), 'commenting');

module.exports = { proposalCooldown, commentCooldown };
