'use strict';

// Narration per beat with Kokoro (kokoro-js, Apache-2.0, 82M ONNX on the CPU) at build time.
// Files are cached by voice + text hash under out/audio/<lang>/, so unchanged narration is never
// re-synthesised and a recorded human take can replace any file (same name) without touching the scripts.

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

async function synthesise(beats, { lang, voice = DEFAULT_VOICE[lang], outDir, log = () => {} }) {
    if (!voice) throw new Error(`No Kokoro voice for "${lang}" — Kokoro has no Norwegian voice; record the NO beats yourself or use --silent`);
    const audio = {};
    for (const beat of beats) {
        if (!beat.text) continue;
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
    return audio;
}

module.exports = { synthesise, audioFile, DEFAULT_VOICE, MODEL };
