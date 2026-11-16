'use strict';

// ffmpeg steps: narration track onto the recording → mp4 (H.264 + AAC), sidecar SRT, optional burnt-in copy.

const fs = require('fs');
const { spawnSync } = require('child_process');
const { buildTrack } = require('./wav');

function ffmpeg(args) {
    const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: ['ignore', 'inherit', 'inherit'] });
    if (r.status !== 0) throw new Error(`ffmpeg failed (${r.status}): ffmpeg ${args.join(' ')}`);
}

function srtTime(ms) {
    const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
}

// One subtitle block per beat, split into readable lines of at most ~84 characters, timed across the narration
function writeSrt(timeline, file) {
    const blocks = [];
    let n = 1;
    for (const t of timeline) {
        if (!t.text) continue;
        const chunks = [];
        const words = t.text.split(' ');
        let cur = '';
        for (const w of words) {
            if ((cur + ' ' + w).trim().length > 84) { chunks.push(cur.trim()); cur = w; } else cur += ' ' + w;
        }
        if (cur.trim()) chunks.push(cur.trim());
        const span = (t.duration ? t.duration * 1000 : t.end - t.start);
        const per = span / chunks.length;
        chunks.forEach((c, i) => {
            const a = Math.round(t.start + i * per), b = Math.round(t.start + (i + 1) * per) - 40;
            blocks.push(`${n++}\n${srtTime(a)} --> ${srtTime(b)}\n${c}\n`);
        });
    }
    fs.writeFileSync(file, blocks.join('\n'));
    return file;
}

function mux({ video, timeline, totalMs, out, trackFile, srt, burn, height = 800 }) {
    const hasVoice = timeline.some(t => t.audio);
    const args = ['-i', video];
    if (hasVoice) { buildTrack(timeline, totalMs, trackFile); args.push('-i', trackFile); }
    args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart');
    if (hasVoice) args.push('-c:a', 'aac', '-b:a', '128k', '-shortest');
    ffmpeg([...args, out]);
    if (burn && srt) {
        const burned = out.replace(/\.mp4$/, '.subtitled.mp4');
        // libass sizes are in its 288-line reference frame; aim at ~3 % of the picture height
        const fontSize = Math.max(6, Math.round(height * 0.03 * 288 / height));
        ffmpeg(['-i', out, '-vf', `subtitles=${srt.replace(/([:\\'])/g, '\\$1')}:force_style='FontName=DejaVu Sans,FontSize=${fontSize},Outline=1,Shadow=0,MarginV=12'`, '-c:a', 'copy', burned]);
        return [out, burned];
    }
    return [out];
}

module.exports = { writeSrt, mux, ffmpeg };
