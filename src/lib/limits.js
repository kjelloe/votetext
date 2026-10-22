'use strict';

// Size caps for user-supplied text. Every route that stores free text runs it
// through checkText() first; the caps are deliberately generous for real use
// and far below the 2 MB request body limit.
const LIMITS = {
    title: 200,
    description: 2000,
    new_text: 50000,
    rationale: 5000,
    comment: 5000,
    display_name: 100,
    organization: 100,
};

const SETTINGS_KEYS = ['lines_per_page', 'majority_threshold', 'default_access', 'allow_anonymous_view'];

// Returns an error message, or null when the value is acceptable. undefined is
// always acceptable (field not supplied); null only when allowNull is set.
function checkText(value, key, { required = false } = {}) {
    const max = LIMITS[key];
    if (value === undefined || value === null) return required ? `${key} is required` : null;
    if (typeof value !== 'string') return `${key} must be text`;
    if (required && !value.trim()) return `${key} is required`;
    if (value.length > max) return `${key} is too long (max ${max} characters)`;
    return null;
}

// Keeps only the settings keys the app knows about.
function pickSettings(settings) {
    const out = {};
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return out;
    for (const k of SETTINGS_KEYS) if (settings[k] !== undefined) out[k] = settings[k];
    return out;
}

module.exports = { LIMITS, SETTINGS_KEYS, checkText, pickSettings };
