//=============================================================================
// Translation.js
// Soft translation loader for RPG Maker MV / MZ
// Version: 1.1.1
// Auto-managed by install.bat — do not edit the js/plugins.js entry manually.
//=============================================================================
/*:
 * @target MV MZ
 * @plugindesc Soft translation loader (text + images, optional scaling/wrap).
 * @author _translation
 *
 * @help
 * This plugin is installed/removed by the install script inside the
 * "_translation" folder. It does not need any parameters.
 *
 * Text: reads the JSON file named in _translation/config.ini (default
 * "translation.json"), a flat { "original": "translated" } map, and
 * replaces any matching string it finds in loaded game data (database +
 * maps/events) and in anything drawn to screen.
 *
 * Images: if _translation/images/ exists, any image the game loads is
 * checked against the same relative path under that folder. If a file
 * exists there, it is loaded instead of the original.
 *
 * Text scaling (config.ini, off by default): adjusts font size only
 * (never the font itself) to help translated text fit. scaling_mode=1
 * restricts it to the message box, name box, and choice box; mode=2
 * applies it everywhere. scaling_percent=100 always means disabled.
 *
 * Word wrap (config.ini, off by default): reflows long lines in the
 * message box only, without breaking words apart.
 *
 * Processing order: translation, then scaling, then word wrap. Either
 * feature is skipped entirely at startup when left off — no hooks are
 * installed and there is no runtime cost.
 */

(() => {
  'use strict';

  const fs = require('fs');
  const path = require('path');

  const GAME_ROOT = (() => {
    try {
      return process.cwd();
    } catch (e) {
      return '.';
    }
  })();

  // The game's actual working directory at runtime is the folder that
  // holds index.html/package.json. For a flattened MZ (or flattened MV)
  // game that's the same folder "_translation" was copied next to. For
  // an MV game packaged with a "www" subfolder, it's one level down —
  // so "_translation" is one level *up* from there instead.
  function findTransDir() {
    const candidates = [
      path.join(GAME_ROOT, '_translation'),
      path.join(GAME_ROOT, '..', '_translation')
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }
    return candidates[0];
  }

  const TRANS_DIR  = findTransDir();
  const TRANS_URL_PREFIX = path.relative(GAME_ROOT, TRANS_DIR).split(path.sep).join('/') || '_translation';
  const IMAGES_DIR = path.join(TRANS_DIR, 'images');

  function loadConfig() {
    const defaults = {
      file: 'translation.json',
      scaling_mode: '0',
      scaling_percent: '100',
      word_wrap: '0',
      use_common_terms: '0'
    };
    const configPath = path.join(TRANS_DIR, 'config.ini');
    if (!fs.existsSync(configPath)) return defaults;
    try {
      const raw = fs.readFileSync(configPath, 'utf8');
      const cfg = Object.assign({}, defaults);
      for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('#') || trimmed.startsWith('[')) continue;
        const idx = trimmed.indexOf('=');
        if (idx === -1) continue;
        const key = trimmed.slice(0, idx).trim();
        const value = trimmed.slice(idx + 1).trim();
        if (key) cfg[key] = value;
      }
      return cfg;
    } catch (e) {
      console.error('[Translation] Failed to read config.ini:', e);
      return defaults;
    }
  }

  const config = loadConfig();
  const TEXT_FILE = path.join(TRANS_DIR, config.file);

  const SCALING_MODE = parseInt(config.scaling_mode, 10) || 0;
  const SCALING_PERCENT = parseInt(config.scaling_percent, 10) || 100;
  const SCALE_FACTOR = SCALING_PERCENT / 100;
  // scaling_percent=100 always means "disabled", regardless of scaling_mode.
  const SCALING_ENABLED = SCALING_MODE !== 0 && SCALING_PERCENT !== 100;

  const WORD_WRAP_ENABLED = config.word_wrap === '1';
  const USE_COMMON_TERMS = config.use_common_terms === '1';

let dict = {};
  if (fs.existsSync(TEXT_FILE)) {
    try {
      const rawData = fs.readFileSync(TEXT_FILE, 'utf8');
      const parsed = JSON.parse(rawData);

      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('JSON root must be a key-value object mapping {"original": "translated"}.');
      }

      dict = parsed;

      // Optionally merge common terms in memory. Common terms are loaded
      // after the selected translation file so identical keys are overridden
      // by commonTerms.json. Neither source file is modified or rewritten.
      if (USE_COMMON_TERMS) {
        const commonTermsPath = path.join(TRANS_DIR, 'commonTerms.json');
        if (fs.existsSync(commonTermsPath)) {
          try {
            const commonTermsRaw = fs.readFileSync(commonTermsPath, 'utf8');
            const commonTerms = JSON.parse(commonTermsRaw);

            if (typeof commonTerms !== 'object' || commonTerms === null || Array.isArray(commonTerms)) {
              throw new Error('JSON root must be a key-value object mapping {"original": "translated"}.');
            }

            dict = Object.assign({}, dict, commonTerms);
          } catch (commonError) {
            console.error('[Translation] commonTerms.json load error:', commonError);
          }
        } else {
          console.warn('[Translation] commonTerms.json not found; continuing without common terms.');
        }
      }
    } catch (e) {
      console.error('[Translation] JSON load error:', e);

      const warningMessage = 
        `[Translation Plugin Error]\n` +
        `Failed to parse file: ${config.file}\n\n` +
        `Details: ${e.message}\n\n` +
        `Please check your JSON formatting (missing commas, quotes, or trailing commas).`;

      if (typeof window !== 'undefined' && window.alert) {
        window.alert(warningMessage);
      } else if (typeof alert !== 'undefined') {
        alert(warningMessage);
      }
    }
  }

  const hasImages = fs.existsSync(IMAGES_DIR);

  function translate(str) {
    if (typeof str !== 'string' || str.length === 0) return str;
    const hit = dict[str];
    return hit !== undefined ? hit : str;
  }

  // Recursively replace any string value in a loaded data object that
  // exactly matches a dictionary key. Covers database entries (names,
  // descriptions, messages) and map/event data (Show Text, choices,
  // names, scrolling text, comments, etc.) since both load through
  // DataManager.
  function walk(obj, seen) {
    if (obj === null || typeof obj !== 'object') return;
    if (seen.has(obj)) return;
    seen.add(obj);
    for (const key of Object.keys(obj)) {
      const val = obj[key];
      if (typeof val === 'string') {
        const t = translate(val);
        if (t !== val) obj[key] = t;
      } else if (val !== null && typeof val === 'object') {
        walk(val, seen);
      }
    }
  }

// --- Enhanced Translation Helper (with line break normalization & partial match) ---
  let _sortedDictKeys = null;

  function translate(str) {
    if (typeof str !== 'string' || str.length === 0) return str;
    if (dict[str] !== undefined) return dict[str];
    
    const normalized = str.replace(/\r\n/g, '\n');
    if (dict[normalized] !== undefined) return dict[normalized];

    // Initialize and cache sorted keys on first partial match attempt
    if (!_sortedDictKeys) {
      _sortedDictKeys = Object.keys(dict).sort((a, b) => b.length - a.length);
    }

    let partialStr = normalized;
    let modified = false;

    // Iterate through keys from longest to shortest to prevent fragment overlap
    for (const key of _sortedDictKeys) {
      if (partialStr.includes(key)) {
        partialStr = partialStr.split(key).join(dict[key]);
        modified = true;
      }
    }

    return modified ? partialStr : str;
  }

  // --- 1. Data-Driven Text (Database & Map Objects) ---
  const _DataManager_onLoad = DataManager.onLoad;
  DataManager.onLoad = function(object) {
    _DataManager_onLoad.call(this, object);
    try {
      walk(object, new WeakSet());
    } catch (e) {
      console.error('[Translation] DataManager walk failed:', e);
    }
  };

  // --- 2. Dynamic Event Text & Choices Hook ---
  if (typeof Game_Message !== 'undefined') {
    const _Game_Message_add = Game_Message.prototype.add;
    Game_Message.prototype.add = function(text) {
      _Game_Message_add.call(this, translate(text));
    };

    const _Game_Message_setChoices = Game_Message.prototype.setChoices;
    Game_Message.prototype.setChoices = function(choices, defaultType, cancelType) {
      const translatedChoices = Array.isArray(choices)
        ? choices.map(c => translate(c))
        : choices;
      _Game_Message_setChoices.call(this, translatedChoices, defaultType, cancelType);
    };
  }

  // --- 3. Window Text Hooks (MV vs MZ Engine Detection) ---
  if (typeof Window_Base !== 'undefined') {
    const isMZ = typeof Utils !== 'undefined' && Utils.RPGMAKER_NAME === 'MZ';

    // Standard Window Text
    const _Window_Base_drawText = Window_Base.prototype.drawText;
    Window_Base.prototype.drawText = function(text, x, y, maxWidth, align) {
      _Window_Base_drawText.call(this, translate(text), x, y, maxWidth, align);
    };

    // Pre-process translation before escape codes evaluate and handle string variables
    const _Window_Base_convertEscapeCharacters = Window_Base.prototype.convertEscapeCharacters;
    Window_Base.prototype.convertEscapeCharacters = function(text) {
      // 1. Translate the raw text string (e.g. keeping \V[22] intact for matching)
      let translatedText = translate(text);

      // 2. Temporarily intercept game variables to translate non-numeric variable values
      if (typeof $gameVariables !== 'undefined' && $gameVariables !== null) {
        const _original_gameVariables_value = $gameVariables.value;
        
        $gameVariables.value = function(variableId) {
          const val = _original_gameVariables_value.call(this, variableId);
          // If the variable is a string and not a valid number, translate it
          if (typeof val === 'string' && isNaN(Number(val))) {
            return translate(val);
          }
          return val;
        };
        
        // Run standard engine escape replacements using our intercepted variable reader
        const result = _Window_Base_convertEscapeCharacters.call(this, translatedText);
        
        // Restore standard game variable functionality
        $gameVariables.value = _original_gameVariables_value;
        return result;
      }

      return _Window_Base_convertEscapeCharacters.call(this, translatedText);
    };

    // Formatted Text / Escape Sequences (Message Box, Descriptions)
    const _Window_Base_drawTextEx = Window_Base.prototype.drawTextEx;
    Window_Base.prototype.drawTextEx = function(text, x, y, width) {
      // Translation is now handled in convertEscapeCharacters, but we keep this
      // as a fallback for any custom plugins bypassing standard text processing.
      const translated = translate(text);
      if (isMZ) {
        return _Window_Base_drawTextEx.call(this, translated, x, y, width);
      } else {
        return _Window_Base_drawTextEx.call(this, translated, x, y);
      }
    };
  }

  // --- 4. Bitmap Catch-All Hook (Plugin/Direct Canvas Rendering) ---
  const _Bitmap_drawText = Bitmap.prototype.drawText;
  Bitmap.prototype.drawText = function(text, x, y, w, h, align) {
    _Bitmap_drawText.call(this, translate(text), x, y, w, h, align);
  };

  // --- 5. PIXI Text Catch-All Hook ---
  //
  // Some custom windows/panels do not use Window_Base.drawText() or
  // Bitmap.drawText(). Plugins may create PIXI.Text / PIXI.BitmapText
  // objects directly and set their .text property. Hook the property
  // setter so those renderers are translated as well.
  //
  // This is renderer-level rather than class-level, so it also covers
  // custom Window classes that override drawText() completely.
  function hookPixiTextProperty(ctorName) {
    try {
      if (typeof PIXI === 'undefined' || !PIXI[ctorName]) return;

      const proto = PIXI[ctorName].prototype;
      if (!proto) return;

      const descriptor = Object.getOwnPropertyDescriptor(proto, 'text');
      if (!descriptor || typeof descriptor.set !== 'function' || typeof descriptor.get !== 'function') {
        return;
      }

      if (descriptor.set.__translationHook) return;

      const originalGetter = descriptor.get;
      const originalSetter = descriptor.set;

      const translatedSetter = function(value) {
        originalSetter.call(this, translate(value));
      };

      Object.defineProperty(translatedSetter, '__translationHook', {
        value: true,
        configurable: false
      });

      Object.defineProperty(proto, 'text', {
        configurable: descriptor.configurable,
        enumerable: descriptor.enumerable,
        get: originalGetter,
        set: translatedSetter
      });
    } catch (e) {
      console.warn('[Translation] PIXI text hook failed for ' + ctorName + ':', e);
    }
  }

  if (typeof PIXI !== 'undefined') {
    hookPixiTextProperty('Text');
    hookPixiTextProperty('BitmapText');
  }

// --- Image redirection ---
if (hasImages) {
  // Safe encryption bypass for unencrypted translation images
  const _Bitmap_startLoading = Bitmap.prototype._startLoading;
  Bitmap.prototype._startLoading = function() {
    if (this._url && this._url.includes('_translation')) {
      this._image = new Image();
      this._image.onload = this._onLoad.bind(this);
      this._image.onerror = this._onError.bind(this);
      if (typeof this._destroyCanvas === 'function') {
        this._destroyCanvas(); // MZ specific cleanup
      }
      this._loadingState = 'loading';
      this._image.src = this._url;
      return;
    }
    _Bitmap_startLoading.call(this);
  };

  // Hook image loaders
  if (typeof ImageManager.loadNormalBitmap === 'function') {
    // RPG Maker MV
    const _ImageManager_loadNormalBitmap = ImageManager.loadNormalBitmap;
    ImageManager.loadNormalBitmap = function(pathArg, hue) {
      const redirected = resolveTranslatedImage(pathArg);
      if (redirected === pathArg) {
        return _ImageManager_loadNormalBitmap.call(this, pathArg, hue);
      }
      return ImageManager.loadBitmapFromUrl ? ImageManager.loadBitmapFromUrl(redirected) : Bitmap.load(redirected);
    };
  } else if (typeof ImageManager.loadBitmap === 'function') {
    // RPG Maker MZ
    const _ImageManager_loadBitmap = ImageManager.loadBitmap;
    ImageManager.loadBitmap = function(folder, filename) {
      if (!filename) {
        return _ImageManager_loadBitmap.call(this, folder, filename);
      }
      
      const unencryptedPath = folder + Utils.encodeURI(filename) + ".png";
      const redirected = resolveTranslatedImage(unencryptedPath);
      
      if (redirected !== unencryptedPath) {
        return this.loadBitmapFromUrl(redirected);
      }
      
      return _ImageManager_loadBitmap.call(this, folder, filename);
    };
  }
}

  function resolveTranslatedImage(gamePath) {
    try {
      let decoded = decodeURIComponent(String(gamePath));

      decoded = decoded.replace(/\\/g, '/');
      decoded = decoded.split('?')[0].split('#')[0];
      decoded = decoded.replace(/^\/+/, '');

      // Remove RPG Maker's img/ prefix.
      let relative = decoded.replace(/^img\//i, '');

      const candidate = path.join(IMAGES_DIR, relative);

      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        const urlRelative = relative
          .split('/')
          .map(encodeURIComponent)
          .join('/');

        return TRANS_URL_PREFIX + '/images/' + urlRelative;
      }
    } catch (e) {
      console.error(
        '[Translation] Image resolution failed:',
        gamePath,
        e
      );
    }

    return gamePath;
  }

  // ---------------------------------------------------------------------
  // Text scaling (2nd pass). Adjusts contents.fontSize only — never touches
  // fontFace — so the game's configured font is never overridden. When
  // disabled (scaling_percent=100 or scaling_mode=0), none of this block's
  // hooks are installed at all: Window_Base.prototype is left completely
  // untouched and there is zero runtime overhead.
  // ---------------------------------------------------------------------
  if (SCALING_ENABLED) {
    const isEligibleWindow = function(win) {
      if (SCALING_MODE === 2) return true; // global
      if (typeof Window_Message !== 'undefined' && win instanceof Window_Message) return true;
      if (typeof Window_NameBox !== 'undefined' && win instanceof Window_NameBox) return true;
      if (typeof Window_ChoiceList !== 'undefined' && win instanceof Window_ChoiceList) return true;
      return false;
    };

    const _Window_Base_resetFontSettings = Window_Base.prototype.resetFontSettings;
    Window_Base.prototype.resetFontSettings = function() {
      _Window_Base_resetFontSettings.call(this);
      if (isEligibleWindow(this)) {
        this.contents.fontSize = Math.round(this.contents.fontSize * SCALE_FACTOR);
      }
    };

    const _Window_Base_makeFontBigger = Window_Base.prototype.makeFontBigger;
    Window_Base.prototype.makeFontBigger = function() {
      if (!isEligibleWindow(this)) {
        _Window_Base_makeFontBigger.call(this);
        return;
      }
      const step = Math.max(1, Math.round(12 * SCALE_FACTOR));
      const max = Math.round(96 * SCALE_FACTOR);
      if (this.contents.fontSize <= max) {
        this.contents.fontSize += step;
      }
    };

    const _Window_Base_makeFontSmaller = Window_Base.prototype.makeFontSmaller;
    Window_Base.prototype.makeFontSmaller = function() {
      if (!isEligibleWindow(this)) {
        _Window_Base_makeFontSmaller.call(this);
        return;
      }
      const step = Math.max(1, Math.round(12 * SCALE_FACTOR));
      const min = Math.round(24 * SCALE_FACTOR);
      if (this.contents.fontSize >= min) {
        this.contents.fontSize -= step;
      }
    };
  }

  // ---------------------------------------------------------------------
  // Word wrap (3rd pass). Message box only. Reflows on whitespace so words
  // are never broken apart; explicit "\n" line breaks in the source text
  // are preserved as paragraph boundaries. Measurement happens after the
  // scaling block above has already run (font is reset per page before
  // this fires), so wrap width naturally accounts for any active scaling.
  // When disabled, none of this block's hooks are installed at all.
  // ---------------------------------------------------------------------
  if (WORD_WRAP_ENABLED) {
    // Estimates rendered width of a token, skipping over (but not
    // stripping from the output) recognized escape-code sequences so they
    // don't get measured as literal backslash characters. \I[n] icons get
    // a fixed width; other bracketed/control codes are treated as zero
    // width, matching how they render (no visible glyph of their own).
    const measureVisibleWidth = function(win, str) {
      let width = 0;
      let i = 0;
      while (i < str.length) {
        if (str[i] === '\\' && i + 1 < str.length) {
          const rest = str.slice(i);
          const iconMatch = rest.match(/^\\I\[(\d+)\]/i);
          if (iconMatch) {
            width += (typeof win.iconWidth === 'function' ? win.iconWidth() : 32) + 4;
            i += iconMatch[0].length;
            continue;
          }
          const bracketMatch = rest.match(/^\\[A-Za-z]+\[[^\]]*\]/);
          if (bracketMatch) {
            i += bracketMatch[0].length;
            continue;
          }
          const singleMatch = rest.match(/^\\[$.|!><^{}]/);
          if (singleMatch) {
            i += singleMatch[0].length;
            continue;
          }
          if (rest[1] === '\\') {
            width += win.contents.measureTextWidth('\\');
            i += 2;
            continue;
          }
        }
        width += win.contents.measureTextWidth(str[i]);
        i++;
      }
      return width;
    };

    const wrapParagraph = function(win, paragraph, maxWidth) {
      const tokens = paragraph.split(/(\s+)/).filter(function(t) { return t.length > 0; });
      const lines = [];
      let currentLine = '';
      let currentWidth = 0;
      for (const token of tokens) {
        const isSpace = /^\s+$/.test(token);
        const tokenWidth = measureVisibleWidth(win, token);
        if (!isSpace && currentLine.length > 0 && currentWidth + tokenWidth > maxWidth) {
          lines.push(currentLine.replace(/\s+$/, ''));
          currentLine = token;
          currentWidth = tokenWidth;
        } else {
          currentLine += token;
          currentWidth += tokenWidth;
        }
      }
      if (currentLine.length > 0) lines.push(currentLine);
      return lines.join('\n');
    };

    const applyWordWrap = function(win, text) {
      const maxWidth = win.contents.width;
      return text.split('\n').map(function(p) {
        return wrapParagraph(win, p, maxWidth);
      }).join('\n');
    };

    // Do the wrapping on the first update after startMessage() has run.
    // RPG Maker initializes _textState and calls newPage()/resetFontSettings()
    // inside startMessage(). Running the wrapper from startMessage() itself is
    // therefore fragile: the text state has already entered the message
    // lifecycle, while some engine versions can subsequently rebuild/reset
    // portions of it. updateMessage() is the first common point where the
    // scaled font is active and the text has not yet been consumed.
    const _Window_Message_updateMessage = Window_Message.prototype.updateMessage;
    Window_Message.prototype.updateMessage = function() {
      if (this._textState &&
          typeof this._textState.text === 'string' &&
          !this._translationWordWrapApplied) {
        this._textState.text = applyWordWrap(this, this._textState.text);
        this._translationWordWrapApplied = true;
      }

      const result = _Window_Message_updateMessage.call(this);

      // Clear the per-message flag once the message has finished so the next
      // message can be wrapped independently.
      if (!this._textState) {
        this._translationWordWrapApplied = false;
      }

      return result;
    };
  }
})();
