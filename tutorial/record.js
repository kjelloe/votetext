'use strict';

// Records one tutorial chapter: node tutorial/record.js <chapter> [--lang en|no] [--voice bm_george]
//   [--silent] [--scale 1.5] [--burn] [--list-beats]   (scale = Chromium device scale factor on the 1280×800 layout; 1.5 → 1920×1200 frames)
// Output under tutorial/out/: chNN-<lang>.webm (raw), .mp4, .srt, .timeline.json
// --list-beats prints the narration per beat with the WAV name a recorded take must have (the Norwegian track) and exits

const fs = require('fs');
const path = require('path');
const { chromium } = require('@playwright/test');
const { chapterBeats } = require('./lib/script');
const { startServer } = require('./lib/server');
const { CURSOR_INIT } = require('./lib/cursor');
const { Stage } = require('./lib/stage');
const { synthesise, listBeats, DEFAULT_VOICE } = require('./lib/tts');
const { writeSrt, mux } = require('./lib/assemble');

const OUT = path.join(__dirname, 'out');
const VIEWPORT = { width: 1280, height: 800 };

function parseArgs(argv) {
    const a = { lang: 'en', scale: 1.5, silent: false, burn: false, list: false };
    const rest = [];
    for (let i = 0; i < argv.length; i++) {
        const v = argv[i];
        if (v === '--lang') a.lang = argv[++i];
        else if (v === '--voice') a.voice = argv[++i];
        else if (v === '--scale') a.scale = parseFloat(argv[++i]);
        else if (v === '--silent') a.silent = true;
        else if (v === '--burn') a.burn = true;
        else if (v === '--list-beats') a.list = true;
        else rest.push(v);
    }
    a.chapter = parseInt(rest[0]);
    if (!a.chapter && a.chapter !== 0) throw new Error('Usage: node tutorial/record.js <chapter> [--lang en|no] [--voice name] [--silent] [--scale 1.5] [--burn] [--list-beats]');
    return a;
}

function loadChapter(n) {
    const file = fs.readdirSync(path.join(__dirname, 'chapters')).find(f => f.startsWith(`ch${String(n).padStart(2, '0')}-`));
    if (!file) throw new Error(`No action script for chapter ${n} in tutorial/chapters/`);
    return require(path.join(__dirname, 'chapters', file));
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const log = m => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);
    const script = chapterBeats(args.lang, args.chapter);
    if (args.list) { process.stdout.write(listBeats(script.beats, { lang: args.lang, chapter: args.chapter, outDir: OUT })); return; }
    const actions = loadChapter(args.chapter);
    if (actions.beats.length !== script.beats.length) throw new Error(`Chapter ${args.chapter}: ${actions.beats.length} actions but ${script.beats.length} cues in the ${args.lang} script`);
    fs.mkdirSync(OUT, { recursive: true });
    const base = path.join(OUT, `ch${String(args.chapter).padStart(2, '0')}-${args.lang}`);

    const audio = args.silent ? {} : await synthesise(script.beats, { lang: args.lang, chapter: args.chapter, voice: args.voice || DEFAULT_VOICE[args.lang], outDir: OUT, log });
    const server = await startServer();
    log(`server on ${server.baseUrl}, documents ${JSON.stringify(server.docs)}`);
    const browser = await chromium.launch({ args: [`--force-device-scale-factor=${args.scale}`] });
    let videoPath;
    let stage;
    try {
        // Playwright's recorder takes frames at the page's real device pixels: an emulated deviceScaleFactor only pads
        // the frame, so the scale goes in as a Chromium launch flag (see main) and the viewport stays the script's 1280×800
        const size = { width: Math.round(VIEWPORT.width * args.scale), height: Math.round(VIEWPORT.height * args.scale) };
        const context = await browser.newContext({ viewport: VIEWPORT, baseURL: server.baseUrl, recordVideo: { dir: OUT, size } });
        await context.addInitScript(CURSOR_INIT);
        if (actions.persona) await context.addCookies([{ name: 'session_id', value: server.cookies[actions.persona], domain: 'localhost', path: '/' }]);
        const page = await context.newPage();
        stage = new Stage(page, { audio, log });
        await stage.titleCard(`${args.chapter}. ${script.title}`, actions.subtitle || '');
        for (let i = 0; i < script.beats.length; i++) {
            await stage.beat(script.beats[i], () => actions.beats[i](stage, { page, docs: server.docs, cookies: server.cookies }));
        }
        const total = stage.now();
        videoPath = await page.video().path();
        await context.close();
        fs.renameSync(videoPath, `${base}.webm`);
        fs.writeFileSync(`${base}.timeline.json`, JSON.stringify({ chapter: args.chapter, lang: args.lang, totalMs: total, beats: stage.timeline }, null, 2));
        const srt = writeSrt(stage.timeline, `${base}.srt`);
        const outputs = mux({ video: `${base}.webm`, timeline: stage.timeline, totalMs: total, out: `${base}.mp4`, trackFile: `${base}.track.wav`, srt, burn: args.burn, size });
        log(`done: ${[...outputs, srt].map(f => path.relative(process.cwd(), f)).join(', ')} (${(total / 1000).toFixed(1)} s)`);
    } finally {
        await browser.close();
        await server.stop();
    }
}

main().catch(err => { console.error(err.stack || err.message); process.exit(1); });
