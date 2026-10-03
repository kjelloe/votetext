'use strict';

// Single place that talks to Resend. The client is created on first send, so
// the app loads without RESEND_API_KEY (dev/test); sending without one throws.

const { Resend } = require('resend');

let client = null;

async function sendMail({ to, subject, text, html }) {
    if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY is not set');
    if (!client) client = new Resend(process.env.RESEND_API_KEY);
    const from = `${process.env.MAIL_FROM_NAME || 'VoteText'} <${process.env.MAIL_FROM_ADDRESS || 'votetext@kjell.solutions'}>`;
    const { data, error } = await client.emails.send({ from, to, subject, text, html });
    if (error) throw error;
    return data;
}

module.exports = { sendMail };
