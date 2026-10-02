# _translation

Copy this whole folder into the game's main directory (the one containing
the game .exe / package.json).

## Install / uninstall
Run `install.bat` (Windows), `install_linux.sh` (Linux), or
`install_macos.sh` (macOS). The Linux/macOS scripts need `python3` on
the system (not the game — just for running the installer). Each script:

- detects MV vs MZ by checking for `js/rpg_core.js` / `js/rmmz_core.js`,
  either directly or under a `www/` subfolder; if that fails, it falls
  back to locating the game's executable and inferring the layout from
  whether a `www/` folder is present
- not installed → offers to install (copies `Translation.js` into
  `js/plugins/` and adds an entry to `js/plugins.js`)
- installed → offers to uninstall (removes both)

Nothing outside `js/plugins/Translation.js` and the single entry in `js/plugins.js` is
touched, so this survives most game updates as long as those two aren't
overwritten. The installer only ever edits its own single entry in
`js/plugins.js` as raw text — it never re-parses or reformats the rest
of the file, so other installed plugins' data is never at risk. The
first time it runs it also saves an untouched copy as
`js/plugins.js.bak` (or `www/js/plugins.js.bak`), which you can copy
back over `plugins.js` at any time to fully undo everything.

## Editing translations
By default text comes from `translation.json`, a flat map of exact
original string → translated string:

```json
{
    "original text1": "translated text1",
    "original text2": "translated text2"
}
```

Any exact match found in game data (database + maps/events) or drawn to
screen gets replaced. No need to re-run the installer — just relaunch
the game after editing the file.

### Multiple languages
`config.ini` controls which JSON file is loaded:

```ini
[translation]
file=translation.json
```

Keep separate files (e.g. `translation_de.json`, `translation_fr.json`)
side by side and change `file=` to switch between them.

## Common Terms
A chunk of translation time is often wasted translating rpg makers
stock names and items, and phrases commonly appearing in games.
Now, such common terms can be saved in `commonTerms.json` as portable
translation file. Extractor script will offer to prune these terms
from extracted text, saving you translation time. 
Even in case your translation file is not pruned, common terms load
after translation, and overwrite terms in translation file.
This feature is off by default, set by `use_common_terms` in `config.ini`.

## Text scaling (off by default)
Font *size* only — not the font itself — is adjusted to help translated
text fit better. Controlled in `config.ini`:

```ini
[text_scaling]
scaling_mode=0     ; 0 = off, 1 = message/name/choice box only, 2 = global
scaling_percent=100 ; 100 = unscaled. Leaving this at 100 disables scaling
                     ; entirely, whatever scaling_mode is set to.
```

## Word wrap (off by default)
Reflows long lines in the message box only, never breaking a word apart.
Existing manual line breaks in event text are kept as paragraph breaks.

```ini
[word_wrap]
word_wrap=1
```

Text scaling and wrapping are fully skipped at startup when left off,
no extra code runs and nothing is hooked.

## Extracting text
`extractor/` contains a standalone tool that scans the game's `data`
folder (and optionally `js/plugins`) and writes text it finds into
file inside its own directory. See `extractor/README.md`.

## Translated images
Put files under `images/`, mirroring the game's own path and filename,
e.g. `images/img/pictures/picture1.png`. See `images/README.txt`.
