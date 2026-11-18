# Recording the Norwegian narration — step by step

Kokoro, the voice behind the English videos, has no Norwegian voice, so the Norwegian videos are built from
takes you record yourself: one WAV file per narrated beat. The toolkit tells you what to read and what to
name each file, and everything else (timing, subtitles, title cards, chapter markers) is the same as for
English. One video takes about 51 takes and 10–11 minutes of speech.

| Scenario | Script to read | Takes go in | Finished video |
|---|---|---|---|
| garden (Community Garden) | `specs/tutorial-video-script.no.md` | `tutorial/out/audio/no/` | `tutorial/out/votetext-tutorial-no.subtitled.mp4` |
| oslo (Oslo Høyre's programme draft) | `specs/tutorial-video-script.oslo.no.md` | `tutorial/out/oslo/audio/no/` | `tutorial/out/oslo/votetext-tutorial-oslo-no.subtitled.mp4` |

The steps below use the Oslo scenario; drop `--scenario oslo` for the garden one.

## 1. Print the take list

```bash
npm run tutorial -- all --scenario oslo --lang no --list-beats > oslo-takes.txt
```

The file lists every chapter, and under it every narrated beat: the path the take must be saved as, then
the exact text to read. Beats without narration (chapter 1 has one) are not listed and need no file. A beat
that already has a file is marked `(recorded)`, so the same command later shows what is still missing.

```
=== Chapter 6 — Foreslå en endring

tutorial/out/oslo/audio/no/ch06-1.wav
  Nå selve hjertet i VoteText. Bjørn mener en setning i innledningen bør endres, …
```

## 2. Set up the recorder

Any recorder that saves WAV works (Audacity, a phone app, `arecord`). Settings that matter:

- **Mono**, 16-bit PCM (or 32-bit float). Stereo files are refused.
- **One sample rate for every file** of a video: 48 000 Hz or 44 100 Hz, your choice, but the same in all
  takes (the mixer refuses to lay files with different rates onto one track).
- Same microphone, same distance, same room for every take, so the chapters sound alike.
- Record in a quiet room; leave about half a second of silence at the start and end of each take. The
  toolkit holds the screen until the take has finished, so a long tail makes the video wait.

Audacity: Audio Setup → Recording Channels: 1 (Mono); project rate 48000; File → Export Audio → WAV,
Signed 16-bit PCM. Save straight into the folder from step 1 under the printed name.

## 3. Record, one beat per file

Work chapter by chapter from the printed list. Read the text as printed: the English words for buttons and
screen elements stay English, since the interface is English. Re-record a take as often as you like; only
the file matters. Keep the file name exactly as printed (`ch06-1.wav`, not `ch6-1.wav` or `ch06-01.wav`).

## 4. Check one chapter early

Before recording everything, build chapter 6 from its five takes:

```bash
npm run tutorial -- 6 --scenario oslo --lang no --burn
```

The run stops and names the files still missing if any take is absent. With all five present it writes
`tutorial/out/oslo/ch06-no.mp4` and `ch06-no.subtitled.mp4`. Watch it once: the screen actions are paced by
the length of each take, so this is where you hear whether your reading speed suits the pointer. If a take
is too fast or too slow, re-record just that file and run the command again.

## 5. Build the whole video

```bash
npm run tutorial -- all --scenario oslo --lang no --burn
```

Fourteen chapters, about fifteen minutes of machine time, no Kokoro involved. Output:
`tutorial/out/oslo/votetext-tutorial-oslo-no.mp4` (sidecar `.srt` per chapter) and
`votetext-tutorial-oslo-no.subtitled.mp4` (subtitles burnt in, this is the one that ships). The chapter title
cards and subtitles come from the Norwegian script automatically.

## 6. Publish and deploy

```bash
npm run tutorial:publish
```

copies every finished `*.subtitled.mp4` into `public/video/`. The next `./scripts/deploy.sh` ships the folder
with the release, and the app lists the new video on the login page and in the footer as "Tutorial · Oslo
(norsk)". Nothing to commit: the videos are gitignored.

## Fixing things later

- **One sentence changed in the script:** `--list-beats` shows the new text, re-record that one file, run
  step 5 again. Files for unchanged beats are reused as they are.
- **The app changed its look:** no new recording needed; run step 5 again, the takes are reused and the
  screen is recorded fresh.
- **Hear a take before building:** the files are ordinary WAVs, play them with any player.
- **English voice for one beat as a stand-in:** a recorded take wins over Kokoro in any language, so the
  mechanism also lets you replace a single English beat with your own voice; the reverse (Kokoro filling a
  missing Norwegian take) does not exist, the run stops instead. `--silent` builds the video without sound
  if you only want to check the picture.
