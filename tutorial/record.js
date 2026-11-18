'use strict';

// Records one tutorial chapter, or all of them into one video with chapter markers:
//   node tutorial/record.js <chapter|all> [--scenario garden|oslo] [--lang en|no] [--voice bm_george] [--silent] [--scale 1.5] [--burn] [--phone] [--dark] [--list-beats]
// scale = Chromium device scale factor on the 1280×800 layout (1.5 → 1920×1200 frames); --phone records the iPhone 13
// viewport with touch (390×844, default scale 2). Output under tutorial/out/: chNN-<lang>[.phone].webm (raw), .mp4, .srt,
// .timeline.json (a scenario other than garden writes under out/<scenario>/); `all` adds votetext-tutorial[-<scenario>]-<lang>.mp4. --list-beats prints the narration per beat with the WAV name a
// recorded take must have (the Norwegian track; with `all`, every chapter) and exits

const fs = require('fs');
const path = require('path');
const { chromium, devices } = require('@playwright/test');
const { chapterBeats } = require('./lib/script');
const { startServer } = require('./lib/server');
const { CURSOR_INIT } = require('./lib/cursor');
const { Stage } = require('./lib/stage');
const { synthesise, listBeats, DEFAULT_VOICE } = require('./lib/tts');
const { loadScenario } = require('./lib/seed');
const { writeSrt, mux, concat, probeDurationMs } = require('./lib/assemble');

const VIEWPORT = { width: 1280, height: 800 };
const PHONE = devices['iPhone 13'];

function parseArgs(argv) {
    const a = { lang: 'en', scale: null, silent: false, burn: false, list: false, phone: false, dark: false, scenario: 'garden' };
    const rest = [];
    for (let i = 0; i < argv.length; i++) {
        const v = argv[i];
        if (v === '--lang') a.lang = argv[++i];
        else if (v === '--voice') a.voice = argv[++i];
        else if (v === '--scale') a.scale = parseFloat(argv[++i]);
        else if (v === '--silent') a.silent = true;
        else if (v === '--burn') a.burn = true;
        else if (v === '--list-beats') a.list = true;
        else if (v === '--phone') a.phone = true;
        else if (v === '--dark') a.dark = true;
        else if (v === '--scenario') a.scenario = argv[++i];
        else rest.push(v);
    }
    a.all = rest[0] === 'all';
    a.chapter = parseInt(rest[0]);
    if (!a.all && !a.chapter && a.chapter !== 0) throw new Error('Usage: node tutorial/record.js <chapter|all> [--lang en|no] [--voice name] [--silent] [--scale 1.5] [--burn] [--phone] [--list-beats]');
    if (a.scale == null) a.scale = a.phone ? 2 : 1.5;
    return a;
}

const CHAPTER_FILE = /^ch(\d\d)-/;

function loadChapter(n) {
    const file = fs.readdirSync(path.join(__dirname, 'chapters')).find(f => f.startsWith(`ch${String(n).padStart(2, '0')}-`));
    if (!file) throw new Error(`No action script for chapter ${n} in tutorial/chapters/`);
    return require(path.join(__dirname, 'chapters', file));
}

function allChapters() {
    return fs.readdirSync(path.join(__dirname, 'chapters')).map(f => f.match(CHAPTER_FILE)).filter(Boolean).map(m => parseInt(m[1])).sort((a, b) => a - b);
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const log = m => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);
    const scenario = loadScenario(args.scenario);
    const OUT = path.join(__dirname, 'out', scenario.outDir || '');
    if (args.list) {
        for (const n of args.all ? allChapters() : [args.chapter]) {
            const script = chapterBeats(args.lang, n, scenario.scripts);
            if (args.all) process.stdout.write(`${n === allChapters()[0] ? '' : '\n'}=== Chapter ${n} — ${script.title}\n\n`);
            process.stdout.write(listBeats(script.beats, { lang: args.lang, chapter: n, outDir: OUT }));
        }
        return;
    }
    fs.mkdirSync(OUT, { recursive: true });
    if (!args.all) { await recordChapter(args.chapter, args, scenario, OUT, log); return; }
    const items = [];
    for (const n of allChapters()) {
        const r = await recordChapter(n, args, scenario, OUT, log);
        items.push({ file: r.mp4, burned: r.burned, title: `${n}. ${r.title}`, durationMs: probeDurationMs(r.mp4) });
    }
    const out = concat(items, path.join(OUT, `votetext-tutorial-${scenario.name === 'garden' ? '' : scenario.name + '-'}${args.lang}${args.phone ? '.phone' : ''}.mp4`));
    if (args.burn) concat(items.map(i => ({ ...i, file: i.burned })), out.replace(/\.mp4$/, '.subtitled.mp4'));
    log(`all ${items.length} chapters: ${path.relative(process.cwd(), out)} (${(items.reduce((s, i) => s + i.durationMs, 0) / 60000).toFixed(1)} min)`);
}

async function recordChapter(chapter, args, scenario, OUT, log) {
    const script = chapterBeats(args.lang, chapter, scenario.scripts);
    const actions = loadChapter(chapter);
    if (actions.beats.length !== script.beats.length) throw new Error(`Chapter ${chapter}: ${actions.beats.length} actions but ${script.beats.length} cues in the ${args.lang} script`);
    const base = path.join(OUT, `ch${String(chapter).padStart(2, '0')}-${args.lang}${args.phone ? '.phone' : ''}`);
    log(`chapter ${chapter} — ${script.title} (scenario ${scenario.name})`);

    const audio = args.silent ? {} : await synthesise(script.beats, { lang: args.lang, chapter, voice: args.voice || DEFAULT_VOICE[args.lang], outDir: OUT, log });
    const server = await startServer({ scenario });
    log(`server on ${server.baseUrl}, documents ${JSON.stringify(server.docs)}`);
    const browser = await chromium.launch({ args: [`--force-device-scale-factor=${args.scale}`] });
    let videoPath;
    let stage;
    try {
        // Playwright's recorder takes frames at the page's real device pixels: an emulated deviceScaleFactor only pads
        // the frame, so the scale goes in as a Chromium launch flag (see above) and the viewport stays the layout size
        const viewport = args.phone ? PHONE.viewport : VIEWPORT;
        const size = { width: Math.round(viewport.width * args.scale), height: Math.round(viewport.height * args.scale) };
        const emulation = args.phone ? { userAgent: PHONE.userAgent, isMobile: true, hasTouch: true, deviceScaleFactor: 1 } : {};
        const context = await browser.newContext({ ...emulation, viewport, baseURL: server.baseUrl, recordVideo: { dir: OUT, size } });
        await context.addInitScript(CURSOR_INIT);
        if (args.dark) await context.addInitScript(() => { try { localStorage.setItem('vt_theme', 'dark'); } catch (e) {} });
        if (actions.persona) await context.addCookies([{ name: 'session_id', value: server.cookies[actions.persona], domain: 'localhost', path: '/' }]);
        const page = await context.newPage();
        context.on('page', p => p.close().catch(() => {}));
        const signIn = async persona => {
            await context.clearCookies();
            if (persona) await context.addCookies([{ name: 'session_id', value: typeof persona === 'string' ? server.cookies[persona] : persona.cookie, domain: 'localhost', path: '/' }]);
        };
        stage = new Stage(page, { audio, log, touch: args.phone });
        await stage.titleCard(`${chapter}. ${script.title}`, actions.subtitle || '');
        const ctx = { page, context, docs: server.docs, cookies: server.cookies, server, signIn, scenario, t: scenario.targets };
        for (let i = 0; i < script.beats.length; i++) {
            await stage.beat(script.beats[i], () => actions.beats[i](stage, ctx));
        }
        const total = stage.now();
        videoPath = await page.video().path();
        await context.close();
        fs.renameSync(videoPath, `${base}.webm`);
        fs.writeFileSync(`${base}.timeline.json`, JSON.stringify({ chapter, lang: args.lang, phone: args.phone, totalMs: total, beats: stage.timeline }, null, 2));
        const srt = writeSrt(stage.timeline, `${base}.srt`);
        const outputs = mux({ video: `${base}.webm`, timeline: stage.timeline, totalMs: total, out: `${base}.mp4`, trackFile: `${base}.track.wav`, srt, burn: args.burn, size });
        log(`done: ${[...outputs, srt].map(f => path.relative(process.cwd(), f)).join(', ')} (${(total / 1000).toFixed(1)} s)`);
        return { mp4: outputs[0], burned: outputs[1], title: script.title, totalMs: total };
    } finally {
        await browser.close();
        await server.stop();
    }
}

main().catch(err => { console.error(err.stack || err.message); process.exit(1); });
