'use strict';

// Narration per beat. A recorded take (out/audio/<lang>/chNN-<beat>.wav, any mono PCM16/float WAV) wins for
// every language; the rest is synthesised with Kokoro (kokoro-js, Apache-2.0, 82M ONNX on the CPU) at
// build time and cached by voice + text hash, so unchanged narration is never re-rendered.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { wavDuration } = require('./wav');

const MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const DEFAULT_VOICE = { en: 'bm_george' };
let ttsPromise = null;

function loadKokoro() {
    if (!ttsPromise) {
        ttsPromise = import('kokoro-js').then(({ KokoroTTS }) => KokoroTTS.from_pretrained(MODEL, { dtype: 'q8', device: 'cpu' }));
    }
    return ttsPromise;
}

function audioFile(outDir, lang, voice, text) {
    const hash = crypto.createHash('sha256').update(`${voice}\n${text}`).digest('hex').slice(0, 16);
    return path.join(outDir, 'audio', lang, `${voice}-${hash}.wav`);
}

function recordedFile(outDir, lang, chapter, beat) {
    return path.join(outDir, 'audio', lang, `ch${String(chapter).padStart(2, '0')}-${beat}.wav`);
}

// The text to read per beat and the file each take must be saved as (npm run tutorial -- 6 --lang no --list-beats)
function listBeats(beats, { lang, chapter, outDir }) {
    return beats.filter(b => b.text).map(b => {
        const file = recordedFile(outDir, lang, chapter, b.index);
        return `${path.relative(process.cwd(), file)}${fs.existsSync(file) ? '  (recorded)' : ''}\n  ${b.text}\n`;
    }).join('\n');
}

async function synthesise(beats, { lang, chapter, voice = DEFAULT_VOICE[lang], outDir, log = () => {} }) {
    const audio = {};
    const missing = [];
    for (const beat of beats) {
        if (!beat.text) continue;
        const take = recordedFile(outDir, lang, chapter, beat.index);
        if (fs.existsSync(take)) {
            audio[beat.index] = { file: take, duration: wavDuration(take) };
            continue;
        }
        if (!voice) { missing.push(path.relative(process.cwd(), take)); continue; }
        const file = audioFile(outDir, lang, voice, beat.text);
        if (!fs.existsSync(file)) {
            fs.mkdirSync(path.dirname(file), { recursive: true });
            log(`voice ${voice}: beat ${beat.index} (${beat.text.length} chars)`);
            const tts = await loadKokoro();
            const out = await tts.generate(beat.text, { voice });
            await out.save(file);
        }
        audio[beat.index] = { file, duration: wavDuration(file) };
    }
    if (missing.length) {
        throw new Error(`No Kokoro voice for "${lang}" and no recorded take for ${missing.length} beat(s):\n  ${missing.join('\n  ')}\nRecord them (--list-beats prints the text per file) or run with --silent`);
    }
    return audio;
}

module.exports = { synthesise, audioFile, recordedFile, listBeats, DEFAULT_VOICE, MODEL };
