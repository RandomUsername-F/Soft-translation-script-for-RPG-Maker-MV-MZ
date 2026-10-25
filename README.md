# Soft Translation for RPG Maker MV / MZ

A "soft" translation plugin for RPG Maker MV and MZ games. Everything lives in a single
`_translation` folder that you copy next to the game. No game data files are modified, so the
translation survives game updates and can be removed cleanly at any time.

## Features

- **Soft translation.** The game's data files are never edited. The only changes to the game are
  one plugin file (`js/plugins/Translation.js`) and one entry in `js/plugins.js`.
- **MV and MZ support**, including MV games packaged with a `www/` folder.
- **Simple translation file.** A flat JSON map of `"original": "translated"`.
- **Text translation** in database entries, maps, events, choices and system terms, plus a
  catch-all for text drawn by the game or by plugins.
- **Multiple languages.** Keep several JSON files and pick one in `config.ini`.
- **Common terms.** Optional shared `commonTerms.json` with translations of RPG Maker's stock
  terms and phrases.
- **Translated images.** Drop replacement images into `_translation/images/` and they are loaded
  instead of the originals.
- **Text scaling** (optional). Adjusts font *size* only, never the game's font, to help
  translated text fit.
- **Word wrap** (optional). Wraps long lines in the message box without breaking words.
- **In-game shortcuts** to reload the translation, toggle it off and on, and show text instantly.
- **Extractor tool.** Pulls translatable text out of a game into a JSON file and prunes it, so you
  only translate what you need to.
- **Safe installers** for Windows, Linux and macOS.

## Installation

1. Copy the whole `_translation` folder into the game's main directory, the one containing the
   game executable and `package.json`.
2. Run the installer for your system from inside `_translation`:

   | System  | Script             |
   |---------|--------------------|
   | Windows | `install.bat`      |
   | Linux   | `install_linux.sh` |
   | macOS   | `install_macos.sh` |

   The Linux and macOS scripts need `python3` installed on the system (to run the installer,
   not for the game itself).
3. If the plugin is not installed, the installer offers to install it. If it is already
   installed, it offers to uninstall it.
4. Launch the game.

To uninstall, run the installer again and choose uninstall.

### What the installer changes

- It copies `Translation.js` to `js/plugins/`.
- It adds one entry to `js/plugins.js`.
- It saves an untouched copy of `plugins.js` as `plugins.js.bak` the first time it runs.
  Copying that file back over `plugins.js` fully undoes the install.

The installer edits only its own entry in `plugins.js`, as plain text. Other plugins' entries are
never re-parsed or reformatted.

## Usage

### Translation file

By default the plugin reads `_translation/translation.json`:

```json
{
    "original text 1": "translated text 1",
    "original text 2": "translated text 2"
}
```

An exact match is replaced first. If there is none, any dictionary key found inside a longer
string is replaced, longest keys first. No reinstall is needed after editing: relaunch the game,
or press **Left Ctrl+R** in-game.

### Configuration (`config.ini`)

```ini
[translation]
file=translation.json      ; translation file to load (e.g. translation_de.json)
use_common_terms=0         ; 1 = also load commonTerms.json (it overrides identical keys)
extra_text_keys=           ; extra data fields to translate, comma separated

[text_scaling]
scaling_mode=0             ; 0 = off, 1 = message/name/choice boxes only, 2 = all windows
scaling_percent=100        ; 100 = unscaled (also disables scaling regardless of mode)

[word_wrap]
word_wrap=0                ; 1 = wrap long lines in the message box
```

Scaling and word wrap are off by default. When off, their code is not installed at all.
Processing order is translation, then scaling, then word wrap.

`extra_text_keys` is for games that keep text in non-standard fields. Do not add fields that hold
file names, or the game will fail to find those files.

### Translated images

Place replacement images under `_translation/images/`, mirroring the game's `img/` folder without
the `img` part. For example, to replace `img/pictures/picture1.png`, use:

```
_translation/images/pictures/picture1.png
```

Images not found there load from the game as normal. Image replacement is independent of text
translation: file names are never translated.

### Shortcuts

Shortcuts use the **left** Ctrl key only, so right Ctrl keeps working as the game intends.

| Shortcut     | Action                                                     |
|--------------|------------------------------------------------------------|
| Left Ctrl+R  | Reload the translation files and re-apply them             |
| Left Ctrl+D  | Toggle translation off (show originals) and on             |
| Left Ctrl+A  | Toggle instant text display                                |

A short notification appears in the upper-left corner of the game window.

## Extractor

`_translation/extractor/` contains a standalone tool that scans the game's `data` folder, and
optionally `js/plugins`, for text to translate. It needs Python 3. Launch it with `extract.bat`
(Windows), `extract_linux.sh` or `extract_macos.sh`.

Main menu:

1. **Extract text.** Choose to scan the data folder only, or data plus `js/plugins`. Plugin text
   is found heuristically and needs manual review. The result is written to
   `extractor/textForTranslation.json`. It never touches your live translation file. If the output
   already exists, you are asked before overwriting.
2. **Process extracted text.** Prunes `textForTranslation.json` in place:
   1. Remove entries already in `commonTerms.json`.
   2. Remove entries already in `commonTerms.json` or in your current translation file.
   3. Remove text with no Japanese characters.
   4. Remove entries made only of symbols.

See `extractor/README.md` for details.

## Project layout

```
_translation/
  Translation.js      the runtime plugin
  translation.json    your translations
  commonTerms.json    shared common terms
  config.ini          settings
  images/             translated images
  extractor/          text extraction tool
  install.*           installers
```

## Notes

- Text that is only drawn on screen (for example some plugin UI) is translated at draw time. Text
  stored in places the plugin does not read, such as plugin parameters or notes, is not.
- Strings already copied into a save file or running game state are not changed by a reload.
