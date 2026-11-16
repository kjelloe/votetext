'use strict';

// ffmpeg steps: narration track onto the recording → mp4 (H.264 + AAC), sidecar SRT, optional burnt-in copy (ASS).

const fs = require('fs');
const { spawnSync } = require('child_process');
const { buildTrack } = require('./wav');

function ffmpeg(args) {
    const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: ['ignore', 'inherit', 'inherit'] });
    if (r.status !== 0) throw new Error(`ffmpeg failed (${r.status}): ffmpeg ${args.join(' ')}`);
}

function pad(n, w) { return String(n).padStart(w, '0'); }

function srtTime(ms) {
    return `${pad(Math.floor(ms / 3600000), 2)}:${pad(Math.floor(ms / 60000) % 60, 2)}:${pad(Math.floor(ms / 1000) % 60, 2)},${pad(ms % 1000, 3)}`;
}

function assTime(ms) {
    return `${Math.floor(ms / 3600000)}:${pad(Math.floor(ms / 60000) % 60, 2)}:${pad(Math.floor(ms / 1000) % 60, 2)}.${pad(Math.floor((ms % 1000) / 10), 2)}`;
}

// One subtitle block per beat, split into readable lines of at most ~84 characters, timed across the narration
function cueBlocks(timeline) {
    const blocks = [];
    for (const t of timeline) {
        if (!t.text) continue;
        const chunks = [];
        let cur = '';
        for (const w of t.text.split(' ')) {
            if ((cur + ' ' + w).trim().length > 84) { chunks.push(cur.trim()); cur = w; } else cur += ' ' + w;
        }
        if (cur.trim()) chunks.push(cur.trim());
        const span = (t.duration ? t.duration * 1000 : t.end - t.start);
        const per = span / chunks.length;
        chunks.forEach((text, i) => blocks.push({ start: Math.round(t.start + i * per), end: Math.round(t.start + (i + 1) * per) - 40, text }));
    }
    return blocks;
}

function writeSrt(timeline, file) {
    fs.writeFileSync(file, cueBlocks(timeline).map((b, i) => `${i + 1}\n${srtTime(b.start)} --> ${srtTime(b.end)}\n${b.text}\n`).join('\n'));
    return file;
}

// The burnt-in copy renders from an ASS file whose play resolution is the real picture: libass would otherwise lay a
// plain SRT out in its 4:3 reference frame and stretch the glyphs sideways on the 16:10 clip. Sizes are in pixels:
// ~3 % of the height for the text on a translucent box (BorderStyle 3, readable over the white page and the dark
// title card alike), a bottom margin of ~8 % so the lines sit above the app's toasts in the corner
function writeAss(timeline, file, { width, height }) {
    const fontSize = Math.round(height * 0.03), marginV = Math.round(height * 0.08), padding = Math.round(height / 150);
    const head = [
        '[Script Info]', 'ScriptType: v4.00+', `PlayResX: ${width}`, `PlayResY: ${height}`, 'WrapStyle: 0', 'ScaledBorderAndShadow: yes', '',
        '[V4+ Styles]',
        'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
        `Style: Default,Liberation Sans,${fontSize},&H00FFFFFF,&H00FFFFFF,&H00000000,&H50000000,0,0,0,0,100,100,0,0,3,${padding},0,2,${marginV},${marginV},${marginV},1`, '',
        '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ];
    const lines = cueBlocks(timeline).map(b => `Dialogue: 0,${assTime(b.start)},${assTime(b.end)},Default,,0,0,0,,${b.text.replace(/[{}]/g, '')}`);
    fs.writeFileSync(file, [...head, ...lines, ''].join('\n'));
    return file;
}

function mux({ video, timeline, totalMs, out, trackFile, srt, burn, size }) {
    const hasVoice = timeline.some(t => t.audio);
    const args = ['-i', video];
    if (hasVoice) { buildTrack(timeline, totalMs, trackFile); args.push('-i', trackFile); }
    args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart');
    if (hasVoice) args.push('-c:a', 'aac', '-b:a', '128k', '-shortest');
    ffmpeg([...args, out]);
    if (burn && srt) {
        const burned = out.replace(/\.mp4$/, '.subtitled.mp4');
        const ass = writeAss(timeline, out.replace(/\.mp4$/, '.ass'), size);
        ffmpeg(['-i', out, '-vf', `ass=${ass.replace(/([:\\'])/g, '\\$1')}`, '-c:a', 'copy', burned]);
        return [out, burned];
    }
    return [out];
}

function probeDurationMs(file) {
    const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`ffprobe failed on ${file}`);
    return Math.round(parseFloat(r.stdout) * 1000);
}

// The chapters as one video: an ffconcat list and ffmetadata chapter markers; every clip shares the encoder
// settings, so the streams are copied, not re-encoded
function concatPlan(items) {
    const list = ['ffconcat version 1.0', ...items.map(i => `file '${i.file.replace(/'/g, "'\\''")}'`)].join('\n') + '\n';
    const meta = [';FFMETADATA1'];
    let t = 0;
    for (const i of items) {
        meta.push('[CHAPTER]', 'TIMEBASE=1/1000', `START=${t}`, `END=${t + i.durationMs}`, `title=${i.title.replace(/[=;#\\\n]/g, m => '\\' + m)}`);
        t += i.durationMs;
    }
    return { list, meta: meta.join('\n') + '\n', totalMs: t };
}

function concat(items, out) {
    const { list, meta } = concatPlan(items);
    const listFile = out.replace(/\.mp4$/, '.ffconcat'), metaFile = out.replace(/\.mp4$/, '.ffmeta');
    fs.writeFileSync(listFile, list);
    fs.writeFileSync(metaFile, meta);
    ffmpeg(['-f', 'concat', '-safe', '0', '-i', listFile, '-i', metaFile, '-map_metadata', '1', '-c', 'copy', '-movflags', '+faststart', out]);
    return out;
}

module.exports = { writeSrt, writeAss, cueBlocks, mux, ffmpeg, probeDurationMs, concatPlan, concat };
