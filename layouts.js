// Définitions des dispositions physiques. Chaque touche est identifiée par son
// KeyboardEvent.code, ce qui permet aussi de la sélectionner au clavier sur ordinateur.
//
// Syntaxe d'une ligne : "Code" = 1u, "Code@1.5" = largeur, "Code^2" = hauteur,
// "Enter@iso" = Entrée ISO, "+0.5" = espace horizontal, "|0.5" = espace vertical.
(() => {
  const seq = (prefix, a, b) => Array.from({ length: b - a + 1 }, (_, i) => prefix + (a + i)).join(' ');

  const NUMS = `${seq('Digit', 1, 9)} Digit0 Minus Equal Backspace@2`;
  const A1 = 'KeyQ KeyW KeyE KeyR KeyT KeyY KeyU KeyI KeyO KeyP BracketLeft BracketRight';
  const A2 = 'KeyA KeyS KeyD KeyF KeyG KeyH KeyJ KeyK KeyL Semicolon Quote';
  const A3 = 'KeyZ KeyX KeyC KeyV KeyB KeyN KeyM Comma Period Slash';
  const MODS8 = 'ControlLeft@1.25 MetaLeft@1.25 AltLeft@1.25 Space@6.25 AltRight@1.25 MetaRight@1.25 ContextMenu@1.25 ControlRight@1.25';
  const MODS65 = 'ControlLeft@1.25 MetaLeft@1.25 AltLeft@1.25 Space@6.25 AltRight Fn ControlRight ArrowLeft ArrowDown ArrowRight';

  function rowsFor(size, iso) {
    const core = (first) => [
      `${first} ${NUMS}`,
      `Tab@1.5 ${A1} ${iso ? 'Enter@iso' : 'Backslash@1.5'}`,
      `CapsLock@1.75 ${A2} ${iso ? 'Backslash +1.25' : 'Enter@2.25'}`,
      `${iso ? 'ShiftLeft@1.25 IntlBackslash' : 'ShiftLeft@2.25'} ${A3}`,
    ];
    let r;
    switch (size) {
      case '60':
        r = core('Escape');
        r[3] += ' ShiftRight@2.75';
        r.push(MODS8);
        return r;
      case '65':
        r = core('Escape');
        r[0] += ' Delete'; r[1] += ' PageUp'; r[2] += ' PageDown';
        r[3] += ' ShiftRight@1.75 ArrowUp End';
        r.push(MODS65);
        return r;
      case '75':
        r = core('Backquote');
        r[0] += ' Home'; r[1] += ' PageUp'; r[2] += ' PageDown';
        r[3] += ' ShiftRight@1.75 ArrowUp End';
        r.push(MODS65);
        return [`Escape ${seq('F', 1, 12)} PrintScreen Insert Delete`, ...r];
      case 'tkl':
      case 'full':
        r = core('Backquote');
        r[0] += ' +0.25 Insert Home PageUp';
        r[1] += ' +0.25 Delete End PageDown';
        r[3] += ' ShiftRight@2.75 +1.25 ArrowUp';
        r.push(`${MODS8} +0.25 ArrowLeft ArrowDown ArrowRight`);
        if (size === 'full') {
          r[0] += ' +0.25 NumLock NumpadDivide NumpadMultiply NumpadSubtract';
          r[1] += ' +0.25 Numpad7 Numpad8 Numpad9 NumpadAdd^2';
          r[2] += ' +3.5 Numpad4 Numpad5 Numpad6';
          r[3] += ' +1.25 Numpad1 Numpad2 Numpad3 NumpadEnter^2';
          r[4] += ' +0.25 Numpad0@2 NumpadDecimal';
        }
        r[0] = '|0.5 ' + r[0];
        return [`Escape +1 ${seq('F', 1, 4)} +0.5 ${seq('F', 5, 8)} +0.5 ${seq('F', 9, 12)} +0.25 PrintScreen ScrollLock Pause`, ...r];
    }
    throw new Error('Taille inconnue : ' + size);
  }

  function parse(rows) {
    const keys = [];
    let y = 0, W = 0, H = 0;
    for (const row of rows) {
      let x = 0;
      for (const t of row.trim().split(/\s+/)) {
        if (t[0] === '|') { y += parseFloat(t.slice(1)); continue; }
        if (t[0] === '+') { x += parseFloat(t.slice(1)); continue; }
        const m = t.match(/^(\w+)(?:@([\d.]+|iso))?(?:\^([\d.]+))?$/);
        const iso = m[2] === 'iso';
        const w = iso ? 1.5 : m[2] ? parseFloat(m[2]) : 1;
        const h = iso ? 2 : m[3] ? parseFloat(m[3]) : 1;
        keys.push({ code: m[1], x, y, w, h, iso });
        x += w;
        W = Math.max(W, x);
        H = Math.max(H, y + h);
      }
      y += 1;
    }
    return { keys, W, H };
  }

  // ---------- Libellés
  const BASE = {
    Escape: 'Esc', Backquote: '`', Minus: '-', Equal: '=', Backspace: '⌫', Tab: 'Tab',
    BracketLeft: '[', BracketRight: ']', Backslash: '\\', CapsLock: 'Caps', Semicolon: ';', Quote: "'",
    Enter: 'Entrée', ShiftLeft: 'Shift', ShiftRight: 'Shift', IntlBackslash: '\\', Comma: ',', Period: '.',
    Slash: '/', ControlLeft: 'Ctrl', ControlRight: 'Ctrl', MetaLeft: 'Win', MetaRight: 'Win', AltLeft: 'Alt',
    AltRight: 'Alt', ContextMenu: 'Menu', Space: 'Espace', Fn: 'Fn', PrintScreen: 'Impr', ScrollLock: 'Défil',
    Pause: 'Pause', Insert: 'Inser', Home: 'Début', PageUp: 'PgUp', Delete: 'Suppr', End: 'Fin', PageDown: 'PgDn',
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', NumLock: 'Num', NumpadDivide: '/',
    NumpadMultiply: '*', NumpadSubtract: '-', NumpadAdd: '+', NumpadEnter: 'Entr', NumpadDecimal: '.',
  };
  for (let i = 0; i < 26; i++) { const c = String.fromCharCode(65 + i); BASE['Key' + c] = c; }
  for (let i = 0; i <= 9; i++) { BASE['Digit' + i] = String(i); BASE['Numpad' + i] = String(i); }
  for (let i = 1; i <= 12; i++) BASE['F' + i] = 'F' + i;

  const FULL = {
    Backspace: 'Retour arrière', ShiftLeft: 'Shift gauche', ShiftRight: 'Shift droit',
    ControlLeft: 'Ctrl gauche', ControlRight: 'Ctrl droit', MetaLeft: 'Win gauche', MetaRight: 'Win droit',
    AltLeft: 'Alt gauche', AltRight: 'Alt droit', CapsLock: 'Verr. maj', PrintScreen: 'Impr. écran',
    ScrollLock: 'Arrêt défil', NumLock: 'Verr. num', NumpadEnter: 'Entrée (pavé num.)',
  };
  for (const c of Object.keys(BASE)) if (c.startsWith('Numpad') && !FULL[c]) FULL[c] = BASE[c] + ' (pavé num.)';

  const VARIANTS = {
    iso_fr: {
      name: 'ISO · AZERTY (FR)', iso: true,
      labels: {
        Backquote: '²', Digit1: '1\n&', Digit2: '2\né', Digit3: '3\n"', Digit4: "4\n'", Digit5: '5\n(',
        Digit6: '6\n-', Digit7: '7\nè', Digit8: '8\n_', Digit9: '9\nç', Digit0: '0\nà', Minus: ')', Equal: '=',
        KeyQ: 'A', KeyW: 'Z', KeyA: 'Q', KeyZ: 'W', KeyM: ',', Semicolon: 'M', Quote: 'ù',
        BracketLeft: '^', BracketRight: '$', Backslash: '*', IntlBackslash: '<', Comma: ';', Period: ':',
        Slash: '!', AltRight: 'AltGr',
      },
      full: { AltRight: 'AltGr' },
    },
    iso_uk: { name: 'ISO · QWERTY (UK)', iso: true, labels: { Backslash: '#', AltRight: 'AltGr' }, full: { AltRight: 'AltGr' } },
    ansi: { name: 'ANSI · QWERTY (US)', iso: false, labels: {}, full: {} },
  };

  const SIZES = { '60': '60 %', '65': '65 %', '75': '75 %', tkl: 'TKL (sans pavé num.)', full: '100 % (complet)' };

  const cache = {};
  function build(size, variant) {
    const id = size + ':' + variant;
    return cache[id] || (cache[id] = parse(rowsFor(size, VARIANTS[variant]?.iso)));
  }
  const label = (code, variant) => VARIANTS[variant]?.labels[code] ?? BASE[code] ?? code;
  const name = (code, variant) =>
    VARIANTS[variant]?.full[code] ?? FULL[code] ?? label(code, variant).split('\n').reverse().join(' ');

  // Caractère produit sans modificateur, ou null (touche de commande, touche morte) : sert au test de frappe.
  const TYPING = /^(Key|Digit|Numpad(\d|Decimal|Divide|Multiply|Subtract|Add)$|Minus|Equal|Bracket|Backslash|Semicolon|Quote|Backquote|IntlBackslash|Comma|Period|Slash)/;
  function char(code, variant) {
    if (code === 'Space') return ' ';
    if (code === 'Enter' || code === 'NumpadEnter') return '\n';
    if (!TYPING.test(code)) return null;
    const c = label(code, variant).split('\n').pop().toLowerCase();
    return c.length === 1 && c !== '^' ? c : null;
  }

  window.Layouts = { SIZES, VARIANTS, build, label, name, char };
})();
