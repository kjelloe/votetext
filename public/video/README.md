# Tutorial videos

`npm run tutorial:publish` copies the finished `votetext-tutorial-<lang>.subtitled.mp4` files here from
`tutorial/out/`. They are not committed (tens of MB each, re-recorded after every UI change): the root
`.gitignore` excludes `public/video/*.mp4`, and `scripts/deploy.sh` ships whatever is in this folder from the
working tree next to the committed release. The app links from the login page and the footer to every
`votetext-tutorial[-<scenario>]-<lang>.subtitled.mp4` present here when the server starts.
