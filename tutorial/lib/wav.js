'use strict';

// Minimal WAV handling: read PCM16 or float32 mono files, measure duration, and lay the narration of a
// chapter onto one 16-bit mono track at the offsets the timeline recorded.

const fs = require('fs');

function readWav(file) {
    const buf = fs.readFileSync(file);
    if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error(`${file} is not a WAV file`);
    let off = 12, fmt = null, data = null;
    while (off + 8 <= buf.length) {
        const id = buf.toString('ascii', off, off + 4);
        const size = buf.readUInt32LE(off + 4);
        if (id === 'fmt ') fmt = { format: buf.readUInt16LE(off + 8), channels: buf.readUInt16LE(off + 10), rate: buf.readUInt32LE(off + 12), bits: buf.readUInt16LE(off + 22) };
        if (id === 'data') data = buf.subarray(off + 8, off + 8 + size);
        off += 8 + size + (size % 2);
    }
    if (!fmt || !data) throw new Error(`${file}: missing fmt or data chunk`);
    const frames = data.length / (fmt.channels * fmt.bits / 8);
    const samples = new Float32Array(frames);
    for (let i = 0; i < frames; i++) {
        const p = i * fmt.channels * fmt.bits / 8;
        if (fmt.format === 3 && fmt.bits === 32) samples[i] = data.readFloatLE(p);
        else if (fmt.format === 1 && fmt.bits === 16) samples[i] = data.readInt16LE(p) / 32768;
        else throw new Error(`${file}: unsupported WAV format ${fmt.format}/${fmt.bits}`);
    }
    return { rate: fmt.rate, samples, duration: frames / fmt.rate };
}

function wavDuration(file) { return readWav(file).duration; }

function writeWav(file, samples, rate) {
    const data = Buffer.alloc(samples.length * 2);
    for (let i = 0; i < samples.length; i++) data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767))), i * 2);
    const header = Buffer.alloc(44);
    header.write('RIFF', 0); header.writeUInt32LE(36 + data.length, 4); header.write('WAVE', 8);
    header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
    header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
    header.write('data', 36); header.writeUInt32LE(data.length, 40);
    fs.writeFileSync(file, Buffer.concat([header, data]));
}

function buildTrack(timeline, totalMs, outFile) {
    const clips = timeline.filter(t => t.audio).map(t => ({ start: t.start, ...readWav(t.audio) }));
    const rate = clips.length ? clips[0].rate : 24000;
    const track = new Float32Array(Math.ceil(totalMs / 1000 * rate));
    for (const c of clips) {
        if (c.rate !== rate) throw new Error('All narration files must share one sample rate');
        const at = Math.round(c.start / 1000 * rate);
        for (let i = 0; i < c.samples.length && at + i < track.length; i++) track[at + i] += c.samples[i];
    }
    writeWav(outFile, track, rate);
    return outFile;
}

module.exports = { readWav, wavDuration, writeWav, buildTrack };
