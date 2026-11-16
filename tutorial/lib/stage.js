'use strict';

// Acting primitives on top of a Playwright page: a pointer that glides, clicks with a ripple, types like a
// person, a spotlight ring for "pointing", and beats that hold the screen until the narration has finished.

const sleep = ms => new Promise(r => setTimeout(r, ms));
const ease = t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

class Stage {
    constructor(page, { audio = {}, log = () => {} } = {}) {
        this.page = page;
        this.audio = audio;
        this.log = log;
        this.t0 = Date.now();
        this.timeline = [];
        this.pos = { x: 40, y: 40 };
        this.vars = {};
    }

    now() { return Date.now() - this.t0; }

    async target(sel) {
        const loc = typeof sel === 'string' ? this.page.locator(sel).first() : sel;
        await loc.waitFor({ state: 'visible' });
        await loc.scrollIntoViewIfNeeded();
        const box = await loc.boundingBox();
        if (!box) throw new Error(`No box for ${sel}`);
        return { x: box.x + box.width / 2, y: box.y + box.height / 2, box };
    }

    async moveTo(x, y, ms = 600) {
        const from = { ...this.pos };
        const steps = Math.max(8, Math.round(ms / 24));
        for (let i = 1; i <= steps; i++) {
            const k = ease(i / steps);
            await this.page.mouse.move(from.x + (x - from.x) * k, from.y + (y - from.y) * k);
            await sleep(ms / steps);
        }
        this.pos = { x, y };
    }

    async glide(sel, ms) {
        const { x, y } = await this.target(sel);
        await this.moveTo(x, y, ms);
    }

    async click(sel) {
        await this.glide(sel);
        await sleep(140);
        await this.page.mouse.down();
        await sleep(90);
        await this.page.mouse.up();
        await sleep(250);
    }

    async type(sel, text, { clear = false } = {}) {
        await this.click(sel);
        if (clear) { await this.page.keyboard.press('ControlOrMeta+a'); await this.page.keyboard.press('Backspace'); await sleep(150); }
        for (const ch of text) {
            if (ch === '\n') await this.page.keyboard.press('Enter');
            else await this.page.keyboard.type(ch);
            await sleep(/[.,;:!?]/.test(ch) ? 220 : 45 + Math.random() * 30);
        }
        await sleep(300);
    }

    // Drag-select [from, to) inside the text node of a line, as a reader would with the mouse
    async selectText(lineSel, from, to) {
        const loc = this.page.locator(lineSel).first();
        await loc.waitFor({ state: 'visible' });
        await loc.scrollIntoViewIfNeeded();
        const rects = await loc.evaluate((el, [a, b]) => {
            const node = el.firstChild;
            const r = (s, e) => { const range = document.createRange(); range.setStart(node, s); range.setEnd(node, e); return range.getBoundingClientRect(); };
            const start = r(a, a + 1), end = r(b - 1, b);
            return { sx: start.left + 1, sy: start.top + start.height / 2, ex: end.right - 1, ey: end.top + end.height / 2 };
        }, [from, to]);
        await this.moveTo(rects.sx, rects.sy);
        await sleep(150);
        await this.page.mouse.down();
        await this.moveTo(rects.ex, rects.ey, 900);
        await sleep(120);
        await this.page.mouse.up();
    }

    async spotlight(sel, ms = 1500) {
        const { box } = await this.target(sel);
        await this.page.evaluate(b => {
            const s = document.createElement('div');
            s.className = 'tutorial-spot';
            Object.assign(s.style, { left: `${b.x - 6}px`, top: `${b.y - 6}px`, width: `${b.width + 12}px`, height: `${b.height + 12}px` });
            document.body.appendChild(s);
            s.id = 'tutorial-spot';
        }, box);
        await sleep(ms);
        await this.page.evaluate(() => { const s = document.getElementById('tutorial-spot'); if (s) s.remove(); });
    }

    async titleCard(title, subtitle, ms = 3000) {
        await this.page.setContent(`<!doctype html><html><body style="margin:0;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#1e293b;color:#f8fafc;font-family:system-ui,sans-serif">
            <div style="font-size:1.1rem;letter-spacing:.3em;text-transform:uppercase;opacity:.7">VoteText</div>
            <div style="font-size:3rem;font-weight:700;margin:.6rem 0 .3rem">${title}</div>
            <div style="font-size:1.4rem;opacity:.8">${subtitle}</div></body></html>`);
        await sleep(ms);
    }

    // The narration starts with the beat unless the actions call narrate() at the moment it should begin
    // (e.g. after a long stretch of typing, when the words describe what has just happened)
    async narrate() { this.narrateAt = this.now(); }

    async beat(beat, actions) {
        const start = this.now();
        this.narrateAt = null;
        this.log(`beat ${beat.index} @${(start / 1000).toFixed(1)}s — ${beat.cue}`);
        await actions();
        const voice = this.audio[beat.index];
        const duration = voice ? voice.duration : 0;
        const voiceStart = this.narrateAt ?? start;
        await sleep(Math.max(0, voiceStart + duration * 1000 - this.now()) + 500);
        this.timeline.push({ beat: beat.index, cue: beat.cue, text: beat.text, beatStart: start, start: voiceStart, end: this.now(), audio: voice ? voice.file : null, duration });
    }
}

module.exports = { Stage, sleep };
