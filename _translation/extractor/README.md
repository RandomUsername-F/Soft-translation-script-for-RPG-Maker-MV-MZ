# extractor

Pulls translatable text out of the game and saves it as a JSON file in
this same `extractor/` folder — named after whatever `_translation/
config.ini`'s `file=` points to (e.g. `translation.json`), but it never
writes to the actual file the game loads. Review/rename the result and
move it into `_translation/` yourself when you're ready to use it.

Run `extract.bat` (Windows), `extract_linux.sh` (Linux), or
`extract_macos.sh` (macOS). All three need `python3` on the system (just
for running this tool, not the game).

You'll be asked what to scan:

```
What should be scanned?
  1) data folder only
  2) data folder + js/plugins
```

- **1) data folder only**: scans `data/*.json` — database entries
  (names, descriptions, state messages, etc.), map/common event/troop
  text (Show Text, Show Choices, Scrolling Text), and `System.json` UI
  terms. This is reliable, structured data.
- **2) data folder + js/plugins**: also scans every `.js` file in
  `js/plugins` for string literals that look like player-facing text.
  This is a heuristic best-effort scan of code, not structured data —
  expect some false positives (code strings that aren't actually shown
  to the player) and review the added entries before translating them.

If the output file already exists in this folder, you're prompted:

```
  1) Overwrite it
  2) Cancel
```

Nothing is merged or appended automatically — each run either writes a
fresh file or is cancelled.

Output entries start as `{"original": "original"}` (untranslated) — edit
the values once you copy the file over.

## Pruning against common terms

After the extracted JSON file is written, the extractor checks for
`_translation/commonTerms.json` and asks whether the new file should be
pruned against it:

```
Prune the extracted file against commonTerms.json? (y/n):
```

- **Yes (`y`/`yes`)**: removes extracted entries that already exist in
  `commonTerms.json`, then writes the pruned result back to the extracted
  JSON file.

Pruning matches only the **original-text** of
`commonTerms.json`. The translated second column is not used for matching.
