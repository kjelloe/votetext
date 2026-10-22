'use strict';

// Single place that talks to Resend. The client is created on first send, so
// the app loads without RESEND_API_KEY (dev/test); sending without one throws.

const { Resend } = require('resend');

let client = null;

// Process-wide send budget: sign-in codes and invites together. Protects the
// sender reputation and the Resend quota against floods; resets every hour.
const MAIL_BUDGET_PER_HOUR = 300;
let sent = [];

class MailBudgetError extends Error {}

function budgetLeft() {
    const now = Date.now();
    sent = sent.filter(t => now - t < 3600000);
    return sent.length < MAIL_BUDGET_PER_HOUR;
}

function withinBudget() {
    if (!budgetLeft()) return false;
    sent.push(Date.now());
    return true;
}

async function sendMail({ to, subject, text, html }) {
    if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY is not set');
    if (!withinBudget()) throw new MailBudgetError(`Mail budget of ${MAIL_BUDGET_PER_HOUR} per hour exhausted`);
    if (!client) client = new Resend(process.env.RESEND_API_KEY);
    const from = `${process.env.MAIL_FROM_NAME || 'VoteText'} <${process.env.MAIL_FROM_ADDRESS || 'votetext@kjell.solutions'}>`;
    const { data, error } = await client.emails.send({ from, to, subject, text, html });
    if (error) throw error;
    return data;
}

module.exports = { sendMail, budgetLeft, MailBudgetError, MAIL_BUDGET_PER_HOUR };
