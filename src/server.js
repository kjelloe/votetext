'use strict';

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');

const { optionalAuth } = require('./middleware/auth');
const { errorHandler } = require('./middleware/errors');

const authRoutes = require('./routes/auth');
const documentsRoutes = require('./routes/documents');
const variantsRoutes = require('./routes/variants');
const commentsRoutes = require('./routes/comments');
const activityRoutes = require('./routes/activity');

const app = express();
const PORT = parseInt(process.env.PORT || '3000');

const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:3000').split(',').map(s => s.trim());

app.set('trust proxy', 1);

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

// SPA fallback
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.use(errorHandler);

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`VoteText running on http://localhost:${PORT}`);
    });
}

module.exports = app;
