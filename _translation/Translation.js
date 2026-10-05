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
 * Shortcuts:
 * Press Ctrl+R in-game to reload translation files and re-apply text translations.
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
  let _sortedDictKeys = null;

  function loadDictionary() {
    let newDict = {};
    if (fs.existsSync(TEXT_FILE)) {
      try {
        const rawData = fs.readFileSync(TEXT_FILE, 'utf8');
        const parsed = JSON.parse(rawData);

        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          throw new Error('JSON root must be a key-value object mapping {"original": "translated"}.');
        }

        newDict = parsed;

        if (USE_COMMON_TERMS) {
          const commonTermsPath = path.join(TRANS_DIR, 'commonTerms.json');
          if (fs.existsSync(commonTermsPath)) {
            try {
              const commonTermsRaw = fs.readFileSync(commonTermsPath, 'utf8');
              const commonTerms = JSON.parse(commonTermsRaw);

              if (typeof commonTerms !== 'object' || commonTerms === null || Array.isArray(commonTerms)) {
                throw new Error('JSON root must be a key-value object mapping {"original": "translated"}.');
              }

              newDict = Object.assign({}, newDict, commonTerms);
            } catch (commonError) {
              console.error('[Translation] commonTerms.json load error:', commonError);
            }
          } else {
            console.warn('[Translation] commonTerms.json not found; continuing without common terms.');
          }
        }

        dict = newDict;
        _sortedDictKeys = null; // Reset cached sorted keys for partial matching
        return true;
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
        return false;
      }
    }
    return false;
  }

  loadDictionary();

  const hasImages = fs.existsSync(IMAGES_DIR);

  // Recursively replace any string value in a loaded data object that
  // exactly matches a dictionary key. Covers database entries (names,
  // descriptions, messages) and map/event data (Show Text, choices,
  // names, scrolling text, comments, etc.) since both load through
  // DataManager.
  //
  // _originals remembers the untranslated string for every value replaced,
  // so a reload re-translates from the original. Without it the data holds
  // already-translated text, which matches no dictionary key.
  const _originals = new WeakMap();
  // translated string -> original, used to undo translation of file names
  // that slip through (plugin commands, scripts, etc.) at asset-load time.
  const _reverse = new Map();

  // Strings ending in an asset extension (plain or MV/MZ-encrypted) are file names.
  const FILE_EXT_RE = /\.(png|jpe?g|gif|webp|bmp|ogg|m4a|wav|mp3|mp4|webm|rpgmvp|rpgmvm|rpgmvo|png_|ogg_|m4a_)$/i;

  // Fields holding file names (images/audio/animations). Never translated,
  // otherwise the game looks for a file that doesn't exist.
  const FILE_KEYS = new Set([
    'characterName', 'faceName', 'battlerName',
    'battleback1Name', 'battleback2Name', 'parallaxName',
    'title1Name', 'title2Name', 'tilesetNames',
    'animation1Name', 'animation2Name', 'effectName'
  ]);
  // Event commands whose parameters are file names: code -> parameter indices.
  // (Show Picture, Change Battle Back, Change Parallax, Change Actor Images, Play Movie)
  const CMD_FILE_PARAMS = {
    231: [1], 283: [0, 1], 284: [0], 322: [1, 3, 5], 261: [0]
  };

  function walk(obj, seen, skip) {
    if (obj === null || typeof obj !== 'object') return;
    if (seen.has(obj)) return;
    seen.add(obj);
    let recs = _originals.get(obj);
    // Audio objects {name, volume, pitch, ...}: name is a file name.
    const isAudio = typeof obj.name === 'string' && 'volume' in obj && 'pitch' in obj;
    let paramSkip = null;
    if (typeof obj.code === 'number' && Array.isArray(obj.parameters) && CMD_FILE_PARAMS[obj.code]) {
      paramSkip = new Set(CMD_FILE_PARAMS[obj.code].map(String));
    }
    for (const key of Object.keys(obj)) {
      if (FILE_KEYS.has(key)) continue;
      if (isAudio && key === 'name') continue;
      if (skip && skip.has(key)) continue;
      const val = obj[key];
      if (typeof val === 'string') {
        const rec = recs && recs.get(key);
        const source = (rec && rec.trans === val) ? rec.orig : val;
        const t = translate(source);
        if (t !== val) obj[key] = t;
        if (t !== source) {
          if (!recs) { recs = new Map(); _originals.set(obj, recs); }
          recs.set(key, { orig: source, trans: t });
          _reverse.set(t, source);
        } else if (rec) {
          recs.delete(key);
        }
      } else if (val !== null && typeof val === 'object') {
        walk(val, seen, key === 'parameters' ? paramSkip : null);
      }
    }
  }

  // --- Enhanced Translation Helper (with line break normalization & partial match) ---
  function translate(str) {
    if (typeof str !== 'string' || str.length === 0) return str;
    if (FILE_EXT_RE.test(str)) return str;
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

  // --- On-screen notification (upper left, 1 second) ---
  let _notifyEl = null;
  let _notifyTimer = null;
  function notify(message) {
    try {
      if (!_notifyEl) {
        _notifyEl = document.createElement('div');
        _notifyEl.style.cssText =
          'position:fixed;top:8px;left:8px;z-index:100000;padding:4px 10px;' +
          'background:rgba(0,0,0,0.7);color:#fff;font:14px sans-serif;' +
          'border-radius:4px;pointer-events:none;';
        document.body.appendChild(_notifyEl);
      }
      _notifyEl.textContent = message;
      _notifyEl.style.display = 'block';
      clearTimeout(_notifyTimer);
      _notifyTimer = setTimeout(() => { _notifyEl.style.display = 'none'; }, 1000);
    } catch (e) {
      console.warn('[Translation] Notification failed:', e);
    }
  }

  // --- Reload Translation Functionality ---
  function reloadTranslation() {
    if (loadDictionary()) {
      // Re-walk database and current map data
      if (typeof $dataSystem !== 'undefined' &&$dataSystem) {
        const globalObjects = [
          $dataActors,$dataClasses, $dataSkills,$dataItems,
          $dataWeapons,$dataArmors, $dataEnemies,$dataTroops,
          $dataStates,$dataAnimations, $dataTilesets,$dataCommonEvents,
          $dataSystem,$dataMap
        ];
        const seen = new WeakSet();
        for (const obj of globalObjects) {
          if (obj) walk(obj, seen);
        }
      }

      // Refresh current scene windows/renderers if active
      if (typeof SceneManager !== 'undefined' && SceneManager._scene) {
        const scene = SceneManager._scene;
        if (typeof scene.requestUpdate === 'function') scene.requestUpdate();
        // Windows live inside scene._windowLayer, not directly in scene.children.
        const targets = [];
        if (scene.children) targets.push(...scene.children);
        if (scene._windowLayer && scene._windowLayer.children) {
          targets.push(...scene._windowLayer.children);
        }
        targets.forEach(child => {
          if (child && typeof child.refresh === 'function') {
            child.refresh();
          }
        });
      }

      console.log('[Translation] Reloaded successfully!');
      notify('Translation reloaded');
    }
  }

  // Keybind listener: Ctrl + R
  document.addEventListener('keydown', (event) => {
    if (event.ctrlKey && (event.key === 'r' || event.key === 'R')) {
      event.preventDefault();
      reloadTranslation();
    }
  });

  // --- Instant text toggle (Ctrl + A) ---
  let instantText = false;

  if (typeof Window_Message !== 'undefined') {
    // clearFlags resets _showFast on every new page; re-apply it when toggled on.
    const _Window_Message_clearFlags = Window_Message.prototype.clearFlags;
    Window_Message.prototype.clearFlags = function() {
      _Window_Message_clearFlags.call(this);
      if (instantText) this._showFast = true;
    };
  }

  document.addEventListener('keydown', (event) => {
    if (event.ctrlKey && (event.key === 'a' || event.key === 'A')) {
      event.preventDefault();
      instantText = !instantText;
      // Apply immediately to a message that is currently being shown.
      const scene = typeof SceneManager !== 'undefined' ? SceneManager._scene : null;
      const msgWin = scene && scene._messageWindow;
      if (msgWin) msgWin._showFast = instantText;
      notify('Instant text: ' + (instantText ? 'ON' : 'OFF'));
    }
  });

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
      if (typeof $gameVariables !== 'undefined' &&$gameVariables !== null) {
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

    if (typeof ImageManager.loadNormalBitmap === 'function') {
      const _ImageManager_loadNormalBitmap = ImageManager.loadNormalBitmap;
      ImageManager.loadNormalBitmap = function(pathArg, hue) {
        const redirected = resolveTranslatedImage(pathArg);
        if (redirected === pathArg) {
          return _ImageManager_loadNormalBitmap.call(this, pathArg, hue);
        }
        return ImageManager.loadBitmapFromUrl ? ImageManager.loadBitmapFromUrl(redirected) : Bitmap.load(redirected);
      };
    } else if (typeof ImageManager.loadBitmap === 'function') {
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

  // --- Undo translated file names at load time ---
  // Safety net: if a translated string reaches an asset loader, use the original name.
  if (typeof ImageManager !== 'undefined' && typeof ImageManager.loadBitmap === 'function') {
    const _ImageManager_loadBitmap_rev = ImageManager.loadBitmap;
    ImageManager.loadBitmap = function(folder, filename) {
      const args = Array.prototype.slice.call(arguments);
      if (typeof filename === 'string' && _reverse.has(filename)) args[1] = _reverse.get(filename);
      return _ImageManager_loadBitmap_rev.apply(this, args);
    };
  }
  if (typeof AudioManager !== 'undefined' && typeof AudioManager.createBuffer === 'function') {
    const _AudioManager_createBuffer = AudioManager.createBuffer;
    AudioManager.createBuffer = function(folder, name) {
      const args = Array.prototype.slice.call(arguments);
      if (typeof name === 'string' && _reverse.has(name)) args[1] = _reverse.get(name);
      return _AudioManager_createBuffer.apply(this, args);
    };
  }

  // --- Text scaling ---
  if (SCALING_ENABLED) {
    const isEligibleWindow = function(win) {
      if (SCALING_MODE === 2) return true;
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

  // --- Word wrap ---
  if (WORD_WRAP_ENABLED) {
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

    const _Window_Message_updateMessage = Window_Message.prototype.updateMessage;
    Window_Message.prototype.updateMessage = function() {
      if (this._textState &&
          typeof this._textState.text === 'string' &&
          !this._translationWordWrapApplied) {
        this._textState.text = applyWordWrap(this, this._textState.text);
        this._translationWordWrapApplied = true;
      }

      const result = _Window_Message_updateMessage.call(this);

      if (!this._textState) {
        this._translationWordWrapApplied = false;
      }

      return result;
    };
  }
})();