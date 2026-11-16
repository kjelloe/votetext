'use strict';

// Parses one chapter of specs/tutorial-video-script(.no).md into beats: each [screen: …] cue with the
// narration paragraphs that follow it. The cues are identical in both languages (tests/unit.test.js).

const fs = require('fs');
const path = require('path');

const FILES = { en: 'tutorial-video-script.md', no: 'tutorial-video-script.no.md' };
const CUE = /^\[screen: (.*)\]$/;
const HEADING = /^## (?:Chapter|Kapittel) (\d+) — (.*?)(?: \*\(.*)?$/;

function scriptPath(lang) {
    if (!FILES[lang]) throw new Error(`Unknown language "${lang}" (en or no)`);
    return path.join(__dirname, '..', '..', 'specs', FILES[lang]);
}

function plainText(markdown) {
    return markdown
        .replace(/`([^`]*)`/g, '$1')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/\*([^*]+)\*/g, '$1')
        .replace(/\s*—\s*/g, ', ')
        .replace(/\s+/g, ' ')
        .trim();
}

function parseChapters(lang) {
    const lines = fs.readFileSync(scriptPath(lang), 'utf8').split('\n');
    const chapters = [];
    let chapter = null;
    let beat = null;
    let paragraph = [];
    const flush = () => {
        if (beat && paragraph.length) beat.text = [beat.text, plainText(paragraph.join(' '))].filter(Boolean).join(' ');
        paragraph = [];
    };
    for (const line of lines) {
        const h = line.match(HEADING);
        if (h) {
            flush();
            chapter = { number: parseInt(h[1]), title: h[2].trim(), beats: [] };
            chapters.push(chapter);
            beat = null;
            continue;
        }
        if (line.startsWith('## ')) { flush(); chapter = null; beat = null; continue; }
        if (!chapter) continue;
        const c = line.match(CUE);
        if (c) {
            flush();
            beat = { index: chapter.beats.length + 1, cue: c[1], text: '' };
            chapter.beats.push(beat);
            continue;
        }
        if (!beat) continue;
        if (line.trim() === '') flush();
        else paragraph.push(line.trim());
    }
    flush();
    return chapters;
}

function chapterBeats(lang, number) {
    const chapter = parseChapters(lang).find(c => c.number === number);
    if (!chapter) throw new Error(`Chapter ${number} not found in the ${lang} script`);
    return chapter;
}

module.exports = { parseChapters, chapterBeats, plainText };
