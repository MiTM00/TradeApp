# Trade — notes for Claude Code

## The iPhone's data comes from its repository

The iPhone is the main copy. Every product, photo, market, wish and Trash item it records is saved at once
to the user's PRIVATE GitHub data repository (`products/<id>.json`, `markets/…`, `wishes/…`, `trash/…`;
see `Cloud` in `preview/index.html`). That repository is not this code repository.

- At the start of every session a hook runs `node preview/repo-data.js --hook`: it fetches the repository into
  `data/` and puts a summary in your context. Before each message `--changes` fetches again and reports new data.
- When developing or updating Trade, use that data (`data/products/*.json` etc.) as the real data — do not invent sample products.
- If the summary says **NOT DONE YET (wali lama samayn)**, tell the user in Somali: "Wali lama samayn" — the iPhone
  has not saved anything to the repository yet, or this computer is not connected to it — and say how to connect it.
- Run `npm run data` to fetch and see it again.
- Never put products in this code repository or any public one, and never print the GitHub token (`github.config.json`).

## Devices

The iPhone app (GitHub Pages, home screen) is the only real app; the data lives permanently on the iPhone. The computer is only where Claude Code develops Trade. There is no Android app (removed 2026-11-13).

## Every code change goes live to the iPhone

After every change to the app, without being asked: test it, commit, push to `main` (the GitHub Actions workflow
`pages.yml` publishes it to GitHub Pages), then check that https://mitm00.github.io/TradeApp/version.json shows the
new build. The iPhone checks `version.json` every 30 s and updates itself (`LiveUpdate` in `preview/index.html`;
`preview/build.js` stamps the build id) — no need to bump the cache name by hand.

## Language

The user writes Somali: answer in Somali. Code, comments and README stay in English.
