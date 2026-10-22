'use strict';

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');

const { getOne, purgeExpired } = require('./db');
const { optionalAuth } = require('./middleware/auth');
const { errorHandler } = require('./middleware/errors');

const authRoutes = require('./routes/auth');
const documentsRoutes = require('./routes/documents');
const variantsRoutes = require('./routes/variants');
const commentsRoutes = require('./routes/comments');
const activityRoutes = require('./routes/activity');
const usersRoutes = require('./routes/users');

const app = express();
const PORT = parseInt(process.env.PORT || '3000');

const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:3000').split(',').map(s => s.trim());

app.set('trust proxy', 1);
app.disable('x-powered-by');

const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";
app.use((req, res, next) => {
    res.set('Content-Security-Policy', CSP);
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('X-Frame-Options', 'DENY');
    res.set('Referrer-Policy', 'same-origin');
    if (process.env.NODE_ENV === 'production') res.set('Strict-Transport-Security', 'max-age=31536000');
    next();
});

app.use(cors({
    origin: allowedOrigins,
    credentials: true,
}));
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use(optionalAuth);

app.use('/api/auth', authRoutes);
app.use('/api/documents', documentsRoutes);
app.use('/api/variants', variantsRoutes);
app.use('/api/comments', commentsRoutes);
app.use('/api/activity', activityRoutes);
app.use('/api/users', usersRoutes);

app.get('/healthz', (req, res, next) => {
    try {
        getOne('SELECT 1');
        res.json({ ok: true });
    } catch (err) {
        next(err);
    }
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// SPA fallback
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.use(errorHandler);

if (require.main === module) {
    if (process.env.NODE_ENV === 'production') {
        for (const key of ['SESSION_SECRET', 'RESEND_API_KEY', 'VOTETEXT_URL']) {
            if (!process.env[key]) {
                console.error(`${key} is not set. Add it to .env before starting in production.`);
                process.exit(1);
            }
        }
    }
    purgeExpired();
    setInterval(() => { try { purgeExpired(); } catch (err) { console.error('purgeExpired failed:', err); } }, 24 * 3600000).unref();
    const onListen = () => console.log(`VoteText running on http://localhost:${PORT}`);
    if (process.env.NODE_ENV === 'production') app.listen(PORT, '127.0.0.1', onListen);
    else app.listen(PORT, onListen);
}

module.exports = app;
