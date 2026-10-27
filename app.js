'use strict';
(() => {
  const CFG = window.APP_CONFIG || {};
  const L = window.Layouts;
  const SCOPE = 'https://www.googleapis.com/auth/drive.file';
  const DRIVE = 'https://www.googleapis.com/drive/v3';
  const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
  const FILE_NAME = CFG.fileName || 'double-input-tracker.json';
  const HAS_CLIENT_ID = !!CFG.clientId && !CFG.clientId.startsWith('REMPLACER');
  const K = {
    data: 'dit.data', token: 'dit.token', user: 'dit.user', fileId: 'dit.fileId',
    dirty: 'dit.dirty', kb: 'dit.kb', heat: 'dit.heat', kind: 'dit.kind',
  };
  // Types d'incidents suivis. Tous les textes de l'interface en dérivent.
  const KINDS = {
    double: { ico: '⚡', one: 'double input', many: 'doubles inputs', title: 'Doubles inputs', col: 'Doubles' },
    skip: { ico: '⊘', one: 'appui manqué', many: 'appuis manqués', title: 'Appuis manqués', col: 'Manqués' },
  };
  const cap = (t) => t[0].toUpperCase() + t.slice(1);
  // Interventions affichées comme repères sur les graphiques.
  const MARKS = { clean: '🧽', replace: '♻', swap: '⇄', note: '📝' };

  // ---------- Utilitaires
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
  function lsGet(k, def = null) {
    try { const v = localStorage.getItem(k); return v == null ? def : JSON.parse(v); } catch { return def; }
  }
  function lsSet(k, v) {
    try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch { /* stockage indisponible */ }
  }
  const dtf = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
  const dday = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });
  const rtf = new Intl.RelativeTimeFormat('fr', { numeric: 'auto' });
  function ago(ts) {
    const s = (ts - Date.now()) / 1000, a = Math.abs(s);
    if (a < 60) return "à l'instant";
    if (a < 3600) return rtf.format(Math.round(s / 60), 'minute');
    if (a < 86400) return rtf.format(Math.round(s / 3600), 'hour');
    if (a < 86400 * 14) return rtf.format(Math.round(s / 86400), 'day');
    return dtf.format(ts);
  }
  function dur(ms) {
    const h = ms / 3600000;
    if (h < 1) return '< 1 h';
    if (h < 48) return Math.round(h) + ' h';
    const d = h / 24;
    return d.toFixed(d < 10 ? 1 : 0).replace('.', ',') + ' j';
  }
  const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;
  const rate = (n, t) => (t >= 86400000 ? ((n / t) * 7 * 86400000).toFixed(1).replace('.', ',') : '—');

  // ---------- Données
  // Tout est stocké sous forme d'enregistrements { id, u (date de modif) } fusionnables :
  // la synchro fait l'union locale/distante en gardant la version la plus récente.
  // Les positions des switchs se déduisent en rejouant les événements (inversions, remplacements).
  const normalize = (d) => ({ v: 1, keyboards: d?.keyboards || {}, events: d?.events || {} });
  let data = normalize(lsGet(K.data));

  const state = { kbId: lsGet(K.kb), heat: lsGet(K.heat, 'position'), kind: KINDS[lsGet(K.kind)] ? lsGet(K.kind) : 'double', swapFrom: null, sheetKey: null, histLimit: 30, test: null };

  const keyboards = () => Object.values(data.keyboards).filter((k) => !k.deleted).sort((a, b) => a.createdAt - b.createdAt);
  function currentKb() {
    const kb = data.keyboards[state.kbId];
    return kb && !kb.deleted ? kb : keyboards()[0] || null;
  }
  const kbEvents = (id) => Object.values(data.events)
    .filter((e) => e.kb === id && !e.deleted)
    .sort((a, b) => a.ts - b.ts || (a.id < b.id ? -1 : 1));

  let localVersion = 0;
  function commit() {
    localVersion++;
    lsSet(K.data, data);
    lsSet(K.dirty, true);
    render();
    scheduleSync();
  }
  function addEvent(e) {
    const now = Date.now();
    const ev = { id: uid(), ts: now, ...e, u: now };
    data.events[ev.id] = ev;
    commit();
    return ev;
  }
  function patch(coll, id, p) {
    data[coll][id] = { ...data[coll][id], ...p, u: Date.now() };
    commit();
  }

  function merge(a, b) {
    const out = { v: 1, keyboards: {}, events: {} };
    for (const c of ['keyboards', 'events']) {
      out[c] = { ...a[c] };
      for (const [id, r] of Object.entries(b[c] || {})) {
        const l = out[c][id];
        if (!l || (r.u || 0) > (l.u || 0)) out[c][id] = r;
      }
    }
    return out;
  }
  const fingerprint = (d) => ['keyboards', 'events']
    .flatMap((c) => Object.entries(d[c] || {}).map(([id, r]) => `${c[0]}${id}:${r.u || 0}`))
    .sort().join('|');

  // ---------- Calcul de l'état d'un clavier
  // Compte les incidents du type `kind` ; les autres incidents restent dans `events` et `swAt`.
  function computeState(kb, kind) {
    const layout = L.build(kb.size, kb.variant);
    const name = (code) => L.name(code, kb.variant);
    const pos = {};        // position (code) -> id du switch installé
    const switches = {};   // id -> infos
    const seg = {};        // id -> { pos, since } segment en cours
    const keyCount = {};
    const swAt = {};       // id d'événement -> switch concerné
    const replaced = {};   // id d'événement "replace" -> switch retiré
    const swapped = {};    // id d'événement "swap" -> [switch a, switch b]
    let newN = 0;

    for (const k of layout.keys) {
      pos[k.code] = k.code;
      switches[k.code] = { id: k.code, origin: k.code, label: `« ${name(k.code)} »`, since: kb.createdAt, isNew: false, removed: false, count: 0, byPos: {}, time: {} };
      seg[k.code] = { pos: k.code, since: kb.createdAt };
    }
    const close = (id, t) => {
      const s = seg[id];
      if (!s) return;
      const S = switches[id];
      S.time[s.pos] = (S.time[s.pos] || 0) + Math.max(0, t - s.since);
      delete seg[id];
    };

    const events = kbEvents(kb.id);
    for (const e of events) {
      if (KINDS[e.type]) {
        if (!(e.key in pos)) continue;
        const S = switches[pos[e.key]];
        swAt[e.id] = S.id;
        if (e.type !== kind) continue;
        S.count++;
        S.byPos[e.key] = (S.byPos[e.key] || 0) + 1;
        keyCount[e.key] = (keyCount[e.key] || 0) + 1;
      } else if (e.type === 'swap') {
        if (!(e.a in pos) || !(e.b in pos)) continue;
        const sa = pos[e.a], sb = pos[e.b];
        close(sa, e.ts); close(sb, e.ts);
        pos[e.a] = sb; pos[e.b] = sa;
        swapped[e.id] = [sa, sb];
        seg[sb] = { pos: e.a, since: e.ts };
        seg[sa] = { pos: e.b, since: e.ts };
      } else if (e.type === 'clean') {
        if (e.key in pos) swAt[e.id] = pos[e.key];
      } else if (e.type === 'replace') {
        if (!(e.key in pos)) continue;
        const old = pos[e.key];
        close(old, e.ts);
        switches[old].removed = true;
        replaced[e.id] = old;
        const id = 'new:' + e.id;
        newN++;
        switches[id] = { id, origin: null, label: `neuf n°${newN}`, since: e.ts, isNew: true, removed: false, count: 0, byPos: {}, time: {} };
        pos[e.key] = id;
        seg[id] = { pos: e.key, since: e.ts };
      }
    }
    const now = Date.now();
    for (const id of Object.keys(seg)) close(id, now);

    const incidents = events.filter((e) => e.type === kind && swAt[e.id]);
    return { kb, kind, layout, name, pos, switches, keyCount, swAt, replaced, swapped, events, incidents };
  }

  // ---------- Google : authentification
  let token = lsGet(K.token); // { t, exp }
  let user = lsGet(K.user);
  let tokenClient = null;
  const hasToken = () => !!token && token.exp > Date.now();

  function initGis(tries = 0) {
    if (!HAS_CLIENT_ID) return;
    if (!window.google?.accounts?.oauth2) {
      if (tries < 100) setTimeout(() => initGis(tries + 1), 150);
      return;
    }
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CFG.clientId,
      scope: SCOPE,
      callback: onToken,
      error_callback: (err) => {
        if (err?.type !== 'popup_closed') toast('Connexion impossible : ' + (err?.message || err?.type || 'erreur'));
      },
    });
    render();
  }

  function login() {
    if (!tokenClient) return toast(HAS_CLIENT_ID ? 'Google se charge encore, réessayez.' : 'Client ID Google non configuré (config.js).');
    const opts = { prompt: '' };
    if (user?.email) opts.login_hint = user.email;
    tokenClient.requestAccessToken(opts);
  }

  async function onToken(resp) {
    if (resp.error) return toast('Connexion refusée : ' + resp.error);
    if (!google.accounts.oauth2.hasGrantedAllScopes(resp, SCOPE)) {
      return toast("L'accès à Google Drive est nécessaire pour sauvegarder vos données.");
    }
    token = { t: resp.access_token, exp: Date.now() + (Number(resp.expires_in || 3600) - 60) * 1000 };
    lsSet(K.token, token);
    try {
      const j = await (await api(`${DRIVE}/about?fields=user(displayName,emailAddress,photoLink)`)).json();
      user = { name: j.user.displayName, email: j.user.emailAddress, photo: j.user.photoLink };
      lsSet(K.user, user);
    } catch { /* non bloquant */ }
    render();
    sync();
  }

  function logout(wipe) {
    if (token && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(token.t, () => {});
    token = null; user = null;
    lsSet(K.token, null); lsSet(K.user, null); lsSet(K.fileId, null);
    if (wipe) {
      data = normalize(null);
      lsSet(K.data, null); lsSet(K.dirty, null);
    }
    render();
  }

  async function api(url, opts = {}) {
    if (!hasToken()) throw new Error('Non connecté');
    const r = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: 'Bearer ' + token.t } });
    if (r.status === 401) {
      token = null; lsSet(K.token, null);
      throw new Error('Session expirée');
    }
    if (!r.ok && r.status !== 404) throw new Error(`Drive a répondu ${r.status}`);
    return r;
  }

  // ---------- Google Drive : synchronisation
  const sync$ = { running: false, again: false, error: null, last: null, timer: null };
  function scheduleSync(delay = 1200) {
    clearTimeout(sync$.timer);
    sync$.timer = setTimeout(sync, delay);
  }

  async function findFile() {
    const q = encodeURIComponent(`name='${FILE_NAME}' and trashed=false`);
    const j = await (await api(`${DRIVE}/files?q=${q}&orderBy=modifiedTime desc&fields=files(id)&pageSize=1`)).json();
    return j.files?.[0]?.id || null;
  }
  async function download(id) {
    const r = await api(`${DRIVE}/files/${id}?alt=media`);
    if (r.status === 404) return null;
    return normalize(await r.json());
  }
  async function createFile(body) {
    const b = 'dit' + Math.random().toString(36).slice(2);
    const meta = { name: FILE_NAME, mimeType: 'application/json', description: 'Données de Double Input Tracker' };
    const payload = `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n`
      + `--${b}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${b}--`;
    const r = await api(`${UPLOAD}/files?uploadType=multipart&fields=id`, {
      method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${b}` }, body: payload,
    });
    return (await r.json()).id;
  }
  async function updateFile(id, body) {
    const r = await api(`${UPLOAD}/files/${id}?uploadType=media`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body,
    });
    if (r.status === 404) throw Object.assign(new Error('Fichier introuvable'), { gone: true });
  }

  async function sync() {
    if (!hasToken()) return render();
    if (sync$.running) { sync$.again = true; return; }
    sync$.running = true; sync$.error = null;
    renderTop();
    try {
      let fileId = lsGet(K.fileId);
      let remote = fileId ? await download(fileId) : null;
      if (!remote) {
        fileId = await findFile();
        remote = fileId ? await download(fileId) : null;
        if (!remote) fileId = null;
      }
      const merged = remote ? merge(data, remote) : data;
      const versionAtUpload = localVersion;
      // Garde les modifications faites pendant le téléchargement.
      data = merge(merged, data);
      lsSet(K.data, data);
      if (!remote || fingerprint(data) !== fingerprint(remote)) {
        const body = JSON.stringify(data);
        if (fileId) {
          try { await updateFile(fileId, body); } catch (e) { if (!e.gone) throw e; fileId = await createFile(body); }
        } else {
          fileId = await createFile(body);
        }
      }
      lsSet(K.fileId, fileId);
      if (localVersion === versionAtUpload) lsSet(K.dirty, false);
      else sync$.again = true;
      sync$.last = Date.now();
    } catch (e) {
      sync$.error = e.message;
    } finally {
      sync$.running = false;
      render();
      if (sync$.again) { sync$.again = false; scheduleSync(300); }
    }
  }

  // ---------- Rendu
  const content = $('#content');
  let st = null;

  function render() {
    const kb = currentKb();
    st = kb ? computeState(kb, state.kind) : null;
    content.dataset.kind = state.kind;
    renderTop();
    renderBanner();
    renderKbBar();
    if (!kb) {
      content.innerHTML = `
        <div class="card empty">
          <div class="big-ico">⌨️</div>
          <h2>Aucun clavier pour l'instant</h2>
          <p class="muted">Créez votre clavier, puis touchez une touche à chaque double input ou appui manqué pour en garder la trace.</p>
          <button class="btn primary" data-act="new-kb">Créer un clavier</button>
        </div>`;
    } else {
      content.innerHTML = boardHtml() + statsHtml() + trendHtml() + historyHtml();
      drawKeyboard();
    }
    renderSwapBar();
    if ($('#sheet').open && state.sheetKey) renderSheet();
  }

  function renderTop() {
    const el = $('#sync');
    const dirty = lsGet(K.dirty);
    let txt = '', cls = '';
    if (!HAS_CLIENT_ID) { txt = 'Hors ligne'; }
    else if (sync$.running) { txt = '⟳ Synchro…'; }
    else if (!hasToken()) { txt = dirty ? '● Non sauvegardé' : ''; cls = 'warn'; }
    else if (sync$.error) { txt = '⚠ ' + sync$.error; cls = 'warn'; }
    else if (dirty) { txt = '● En attente'; }
    else if (sync$.last) { txt = '✓ Drive à jour'; cls = 'ok'; }
    el.textContent = txt;
    el.className = 'sync ' + cls;
    el.title = sync$.last ? 'Dernière synchro : ' + dtf.format(sync$.last) : '';

    const acc = $('#account');
    if (hasToken() && user) {
      acc.innerHTML = user.photo ? `<img src="${esc(user.photo)}" alt="" referrerpolicy="no-referrer"> ${esc(user.name?.split(' ')[0] || 'Compte')}` : esc(user.name || 'Compte');
    } else if (hasToken()) {
      acc.textContent = 'Compte';
    } else {
      acc.textContent = user ? 'Se reconnecter' : 'Se connecter';
    }
  }

  function renderBanner() {
    const el = $('#banner');
    if (!HAS_CLIENT_ID) {
      el.innerHTML = `<div class="banner warn"><p><b>Configuration requise.</b> Renseignez votre Client ID Google dans <code>config.js</code> (voir README). En attendant, les données restent sur cet appareil.</p></div>`;
    } else if (!hasToken()) {
      const dirty = lsGet(K.dirty);
      el.innerHTML = `<div class="banner"><p>${user
        ? `Session Google expirée.${dirty ? ' <b>Des modifications attendent d\'être sauvegardées.</b>' : ''} Vous pouvez continuer à saisir, elles seront envoyées à la reconnexion.`
        : 'Connectez-vous avec Google pour sauvegarder vos claviers sur votre Drive et les retrouver sur tous vos appareils.'}</p>
        <button class="btn primary" data-act="login">${user ? 'Se reconnecter' : 'Se connecter avec Google'}</button></div>`;
    } else {
      el.innerHTML = '';
    }
  }

  function renderKbBar() {
    const list = keyboards();
    const kb = currentKb();
    const bar = $('#kbBar');
    if (!list.length) { bar.innerHTML = ''; return; }
    bar.innerHTML = `
      <select id="kbSelect" aria-label="Clavier">
        ${list.map((k) => `<option value="${esc(k.id)}" ${k.id === kb?.id ? 'selected' : ''}>${esc(k.name)}</option>`).join('')}
      </select>
      <button class="icon" data-act="rename-kb" title="Renommer" aria-label="Renommer">✎</button>
      <button class="icon" data-act="delete-kb" title="Supprimer" aria-label="Supprimer">🗑</button>
      <button class="btn" data-act="new-kb">＋ Clavier</button>`;
  }

  function boardHtml() {
    const total = st.incidents.length;
    const kd = KINDS[state.kind];
    return `
      <section class="card">
        <div class="seg kinds" role="tablist" aria-label="Type d'incident">
          ${Object.entries(KINDS).map(([k, v]) => `<button class="${state.kind === k ? 'on' : ''}" data-act="kind" data-v="${k}">${v.ico} ${v.title}</button>`).join('')}
        </div>
        <div class="board-head">
          <div class="seg" role="tablist" aria-label="Colorer par">
            <button class="${state.heat === 'position' ? 'on' : ''}" data-act="heat" data-v="position">Par position</button>
            <button class="${state.heat === 'switch' ? 'on' : ''}" data-act="heat" data-v="switch">Par switch</button>
          </div>
          ${total ? '<div class="legend">0 <i></i> max</div>' : ''}
        </div>
        <div class="kb-wrap" id="kbWrap"><div class="kb" id="kb"></div></div>
        <p class="hint">${state.heat === 'position'
          ? `Couleur = ${kd.many} survenus à cet emplacement, quel que soit le switch.`
          : `Couleur = ${kd.many} du switch actuellement installé, où qu'il ait été avant.`}
          Touchez une touche${matchMedia('(hover: hover)').matches ? ' (ou appuyez dessus sur votre clavier)' : ''} pour signaler un incident.</p>
      </section>`;
  }

  function heatOf(code) {
    return state.heat === 'switch' ? st.switches[st.pos[code]].count : st.keyCount[code] || 0;
  }

  function drawKeyboard() {
    const wrap = $('#kbWrap'), kbEl = $('#kb');
    if (!wrap) return;
    const { keys, W, H } = st.layout;
    const u = Math.min(56, Math.max(20, Math.floor((wrap.clientWidth - 2) / W)));
    const max = Math.max(1, ...keys.map((k) => heatOf(k.code)));
    kbEl.style.width = W * u + 'px';
    kbEl.style.height = H * u + 'px';
    kbEl.style.fontSize = Math.max(9, Math.round(u * 0.32)) + 'px';
    kbEl.innerHTML = keys.map((k) => {
      const c = heatOf(k.code);
      const p = c ? 0.22 + 0.78 * (c / max) : 0;
      const label = L.label(k.code, st.kb.variant);
      const long = label.replace('\n', '').length > 3 && !label.includes('\n');
      return `<button class="key${k.iso ? ' iso' : ''}${p > 0.55 ? ' hot' : ''}${state.swapFrom === k.code ? ' sel' : ''}"
        data-key="${k.code}" title="${esc(st.name(k.code))}${c ? ` · ${c}` : ''}"
        style="left:${k.x * u + 2}px;top:${k.y * u + 2}px;width:${k.w * u - 4}px;height:${k.h * u - 4}px;--p:${p.toFixed(3)}">
        <span class="lbl${long ? ' long' : ''}">${esc(label)}</span>${c ? `<span class="cnt">${c}</span>` : ''}</button>`;
    }).join('');
  }

  function statsHtml() {
    const sws = Object.values(st.switches);
    const kd = KINDS[state.kind];
    const total = st.incidents.length;
    if (!total) {
      return `<section class="card"><h2>Statistiques</h2><p class="muted">Aucun ${kd.one} noté pour l'instant. Touchez une touche du clavier ci-dessus dès qu'il s'en produit un.</p></section>`
        + (st.events.length ? `<div class="grid2">${analysisHtml()}</div>` : '');
    }
    const installed = st.layout.keys.length;
    const hitSw = sws.filter((s) => s.count > 0).length;
    const hitPos = Object.keys(st.keyCount).length;
    const last = st.incidents[st.incidents.length - 1];

    const ranked = sws.filter((s) => s.count > 0).sort((a, b) => b.count - a.count);
    const maxC = ranked[0]?.count || 1;
    const where = (s) => {
      const p = Object.keys(st.pos).find((c) => st.pos[c] === s.id);
      if (s.removed) return 'retiré';
      if (!p) return '';
      return p === s.origin ? `sur ${esc(st.name(p))}` : `maintenant sur <b>${esc(st.name(p))}</b>`;
    };
    const rankHtml = ranked.map((s) => {
      const byPos = Object.entries(s.byPos);
      const detail = byPos.length > 1 || (byPos[0] && byPos[0][0] !== s.origin)
        ? `<div class="muted small">${byPos.map(([p, n]) => `${n} sur ${esc(st.name(p))}`).join(' · ')}</div>` : '';
      return `<li><div>Switch ${esc(s.label)} <span class="muted small">${where(s)}</span>${detail}</div>
        <div class="n">${s.count}</div><div class="bar"><i style="width:${(s.count / maxC) * 100}%"></i></div></li>`;
    }).join('');

    return `
      <div class="stats">
        <div class="stat"><b>${total}</b><span>${total > 1 ? kd.many : kd.one}</span></div>
        <div class="stat"><b>${hitSw}<small class="muted"> / ${installed}</small></b><span>switchs concernés (${Math.round((hitSw / installed) * 100)} %)</span></div>
        <div class="stat"><b>${hitPos}</b><span>position${hitPos > 1 ? 's' : ''} concernée${hitPos > 1 ? 's' : ''}</span></div>
        <div class="stat"><b>${last ? ago(last.ts) : '—'}</b><span>dernier ${kd.one}</span></div>
      </div>
      <div class="grid2">
        <section class="card"><h2>Classement des switchs</h2>
          ${ranked.length ? `<ul class="rank">${rankHtml}</ul>` : `<p class="muted">Aucun ${kd.one}.</p>`}
        </section>
        ${analysisHtml()}
      </div>`;
  }

  function analysisHtml() {
    const sws = Object.values(st.switches);
    const spent = (s) => Object.entries(s.time).filter(([, t]) => t > 0);
    const moved = sws.filter((s) => spent(s).length > 1 && (s.count > 0 || spent(s).some(([p]) => st.keyCount[p])));
    const hosts = {};
    for (const s of sws) for (const [p, t] of spent(s)) (hosts[p] ||= []).push({ s, t, n: s.byPos[p] || 0 });
    const positions = Object.entries(hosts).filter(([p, arr]) => arr.length > 1 && arr.some((h) => h.n > 0));

    if (!moved.length && !positions.length) {
      return `<section class="card"><h2>Inversions</h2>
        <p class="explain">Pour savoir si c'est le switch ou l'emplacement (soudure, hotswap, PCB) qui pose problème,
        inversez un switch suspect avec un autre : touchez la touche puis « Inverser… ». L'analyse apparaîtra ici.</p></section>`;
    }
    const table = (rows, head) => `<table><tr><th>${head}</th><th class="num">${KINDS[state.kind].col}</th><th class="num">Durée</th><th class="num">/ sem.</th></tr>${rows}</table>`;

    const movedHtml = moved.sort((a, b) => b.count - a.count).map((s) => {
      const withHits = Object.keys(s.byPos).length;
      const tag = withHits > 1 ? '<span class="tag red">suit le switch</span>' : '';
      const rows = spent(s).map(([p, t]) => `<tr><td>${esc(st.name(p))}</td><td class="num">${s.byPos[p] || 0}</td><td class="num">${dur(t)}</td><td class="num">${rate(s.byPos[p] || 0, t)}</td></tr>`).join('');
      return `<h3>Switch ${esc(s.label)}${tag}</h3>${table(rows, 'Position')}`;
    }).join('');

    const posHtml = positions.map(([p, arr]) => {
      const withHits = arr.filter((h) => h.n > 0).length;
      const tag = withHits > 1 ? '<span class="tag blue">suit la position</span>' : '';
      const rows = arr.map((h) => `<tr><td>${esc(h.s.label)}</td><td class="num">${h.n}</td><td class="num">${dur(h.t)}</td><td class="num">${rate(h.n, h.t)}</td></tr>`).join('');
      return `<h3>Position ${esc(st.name(p))}${tag}</h3>${table(rows, 'Switch')}`;
    }).join('');

    return `<section class="card"><h2>Analyse des inversions</h2>
      <p class="explain">Si les ${KINDS[state.kind].many} <b>suivent le switch</b> après une inversion, le switch est en cause.
      S'ils <b>restent sur la position</b>, regardez plutôt la soudure / le socket hotswap / le PCB ou le debounce du firmware.
      Comparez les taux par semaine : une durée courte n'est pas encore significative.</p>
      ${movedHtml}${posHtml}</section>`;
  }

  // ---------- Graphiques : courbe cumulée des incidents + repères d'intervention
  function markOf(e) {
    const n = (c) => st.name(c);
    const txt = e.type === 'clean' ? `Nettoyage ${n(e.key)}`
      : e.type === 'replace' ? `Switch neuf sur ${n(e.key)}`
      : e.type === 'swap' ? `Inversion ${n(e.a)} ↔ ${n(e.b)}`
      : e.text || 'Événement';
    return { ts: e.ts, ico: MARKS[e.type], txt };
  }

  // Une série par type d'incident : { k, hits: [ts…] }. Les types sans incident sont masqués.
  function seriesOf(keep) {
    const all = Object.keys(KINDS).map((k) => ({
      k, hits: st.events.filter((e) => e.type === k && st.swAt[e.id] && keep(e)).map((e) => e.ts),
    }));
    const some = all.filter((s) => s.hits.length);
    return some.length ? some : all;
  }

  function chartHtml(series, marks, from) {
    const span = Math.max(1, Date.now() - from);
    const x = (t) => Math.min(1000, Math.max(0, ((t - from) / span) * 1000));
    const N = Math.max(1, ...series.map((s) => s.hits.length));
    const y = (n) => (100 - (n / N) * 92).toFixed(1);
    const path = (hits) => {
      let d = `M0 ${y(0)}`;
      hits.forEach((t, i) => { d += `H${x(t).toFixed(1)}V${y(i + 1)}`; });
      return d + 'H1000';
    };
    return `<div class="chart">
      <div class="legend2">${series.map((s) => `<span class="k-${s.k}"><i></i>${KINDS[s.k].title} <b>${s.hits.length}</b></span>`).join('')}</div>
      <div class="plot">
        <svg viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden="true">
          ${series.map((s) => `<path class="line k-${s.k}" d="${path(s.hits)}"/>`).join('')}</svg>
        ${marks.map((m) => `<div class="mark" style="left:${(x(m.ts) / 10).toFixed(2)}%" title="${esc(m.txt)} · ${dtf.format(m.ts)}"><span>${m.ico}</span></div>`).join('')}
        <span class="ymax">${N}</span>
      </div>
      <div class="xaxis"><span>${dday.format(from)}</span><span>aujourd'hui</span></div>
    </div>`;
  }

  // Taux par semaine entre chaque repère et le précédent / le suivant.
  function compareHtml(series, marks, from) {
    if (!marks.length) return '';
    const seg = (a, b) => series.map((s) => {
      const n = s.hits.filter((t) => t >= a && t < b).length;
      return `<div class="k-${s.k}">${KINDS[s.k].ico} <b>${rate(n, b - a)}</b> <span class="muted small">(${n})</span></div>`;
    }).join('') + `<div class="muted small">sur ${dur(b - a)}</div>`;
    const rows = marks.map((m, i) => `<tr><td>${m.ico} ${esc(m.txt)}<div class="muted small">${dday.format(m.ts)}</div></td>
      <td class="num">${seg(i ? marks[i - 1].ts : from, m.ts)}</td>
      <td class="num">${seg(m.ts, marks[i + 1]?.ts ?? Date.now())}</td></tr>`).slice(-6).join('');
    return `<table class="compare"><tr><th>Intervention</th><th class="num">Avant / sem.</th><th class="num">Après / sem.</th></tr>${rows}</table>`;
  }

  function trendHtml() {
    const series = seriesOf(() => true);
    const marks = st.events.filter((e) => e.type === 'clean' || e.type === 'replace' || e.type === 'note').map(markOf);
    const btn = '<div class="btns"><button class="btn" data-act="note">＋ Noter un événement</button>'
      + '<button class="btn" data-act="test" data-keys="">🎯 Test de frappe</button></div>';
    if (!series.some((s) => s.hits.length) && !marks.length) {
      return `<section class="card"><h2>Évolution</h2>
        <p class="explain">Nettoyez un switch (touche → « Nettoyé ») ou notez un événement (firmware, lubrification…)
        pour comparer le nombre d'incidents avant et après.</p>${btn}</section>`;
    }
    return `<section class="card"><h2>Évolution</h2>
      <p class="explain">Totaux cumulés : plus une courbe monte vite, plus il y a d'incidents. Les repères marquent nettoyages,
      remplacements et événements notés. Une durée inférieure à un jour n'affiche pas de taux.</p>
      ${chartHtml(series, marks, st.kb.createdAt)}${compareHtml(series, marks, st.kb.createdAt)}${btn}</section>`;
  }

  function eventHtml(e) {
    const n = (c) => `<b>${esc(st.name(c))}</b>`;
    let ico, txt;
    if (KINDS[e.type]) {
      const s = st.switches[st.swAt[e.id]];
      ico = KINDS[e.type].ico; txt = `${cap(KINDS[e.type].one)} sur ${n(e.key)} <span class="muted small">switch ${esc(s?.label || '?')}</span>`;
    } else if (e.type === 'swap') {
      ico = '⇄'; txt = `Inversion ${n(e.a)} ↔ ${n(e.b)}`;
    } else if (e.type === 'clean') {
      const s = st.switches[st.swAt[e.id]];
      ico = MARKS.clean; txt = `Switch nettoyé sur ${n(e.key)} <span class="muted small">switch ${esc(s?.label || '?')}</span>`;
    } else if (e.type === 'note') {
      ico = MARKS.note; txt = esc(e.text || 'Événement');
    } else if (e.type === 'test') {
      ico = '🎯'; txt = `Test de frappe${e.keys?.length ? ' sur ' + e.keys.map(n).join(', ') : ''} : ${e.n} caractères, ${plural(e.found, 'incident', 'incidents')}`;
    } else if (e.type === 'replace') {
      const old = st.switches[st.replaced[e.id]];
      ico = '♻'; txt = `Switch neuf sur ${n(e.key)}${old ? ` <span class="muted small">remplace ${esc(old.label)}</span>` : ''}`;
    } else return '';
    return `<li><span class="ico">${ico}</span><div class="txt">${txt}<time title="${dtf.format(e.ts)}">${ago(e.ts)} · ${dtf.format(e.ts)}</time></div>
      <button class="icon" data-act="del-event" data-id="${esc(e.id)}" title="Supprimer" aria-label="Supprimer">✕</button></li>`;
  }

  function historyHtml() {
    const evs = st.events.slice().reverse();
    if (!evs.length) return '';
    const shown = evs.slice(0, state.histLimit);
    return `<section class="card"><h2>Historique <span class="muted small">(${evs.length})</span></h2>
      <ul class="events">${shown.map(eventHtml).join('')}</ul>
      ${evs.length > shown.length ? '<button class="btn link" data-act="more">Afficher plus</button>' : ''}</section>`;
  }

  // ---------- Feuille d'une touche
  function openSheet(code) {
    state.sheetKey = code;
    renderSheet();
    const d = $('#sheet');
    if (!d.open) d.showModal();
  }
  function renderSheet() {
    const code = state.sheetKey;
    if (!st || !(code in st.pos)) return $('#sheet').close();
    const sw = st.switches[st.pos[code]];
    const moved = !sw.isNew && sw.origin !== code ? ` <span class="tag">déplacé</span>` : '';
    const evs = st.events.filter((e) => e.key === code || e.a === code || e.b === code || e.keys?.includes(code)).reverse().slice(0, 8);
    // Compteurs par type : position actuelle et switch installé.
    const counts = (k) => {
      const all = st.events.filter((e) => e.type === k && st.swAt[e.id]);
      return { pos: all.filter((e) => e.key === code).length, sw: all.filter((e) => st.swAt[e.id] === sw.id).length };
    };
    const series = seriesOf((e) => st.swAt[e.id] === sw.id);
    const marks = st.events.filter((e) => (e.type === 'clean' && st.swAt[e.id] === sw.id)
      || (e.type === 'swap' && st.swapped[e.id]?.includes(sw.id))).map(markOf);
    const trend = series.some((s) => s.hits.length) || marks.length
      ? `<div><h3 style="margin-top:4px">Évolution du switch ${esc(sw.label)}</h3>
        ${chartHtml(series, marks, sw.since)}${compareHtml(series, marks, sw.since)}</div>` : '';
    const line = (f) => Object.entries(KINDS).map(([k, v]) => `<span class="k-${k}">${v.ico} <b>${counts(k)[f]}</b></span>`).join(' ');
    $('#sheet').innerHTML = `
      <div class="sheet-body">
        <div class="sheet-head">
          <div class="keycap" style="flex:none">${esc(L.label(code, st.kb.variant))}</div>
          <div><h2>${esc(st.name(code))}</h2><p class="muted small">Switch installé : <b>${esc(sw.label)}</b>${moved}</p></div>
          <button class="icon" data-act="close-sheet" aria-label="Fermer">✕</button>
        </div>
        <div class="mini">
          <div><div class="counts">${line('pos')}</div><span>sur cette position</span></div>
          <div><div class="counts">${line('sw')}</div><span>pour ce switch</span></div>
        </div>
        <div class="row2">
          ${Object.entries(KINDS).map(([k, v]) => `<button class="btn primary big k-${k}" data-act="incident" data-v="${k}">${v.ico} ${cap(v.one)}</button>`).join('')}
        </div>
        <div class="row3">
          <button class="btn" data-act="clean">🧽 Nettoyé</button>
          <button class="btn" data-act="swap">⇄ Inverser…</button>
          <button class="btn" data-act="replace">♻ Neuf</button>
        </div>
        <button class="btn" data-act="test">🎯 Tester la frappe</button>
        ${trend}
        ${evs.length ? `<div><h3 style="margin-top:4px">Historique</h3><ul class="events">${evs.map(eventHtml).join('')}</ul></div>` : ''}
      </div>`;
  }

  function renderSwapBar() {
    const bar = $('#swapBar');
    if (!state.swapFrom || !st) { bar.hidden = true; return; }
    bar.hidden = false;
    bar.innerHTML = `<span>Touchez la touche avec laquelle inverser <b>${esc(st.name(state.swapFrom))}</b></span>
      <button data-act="cancel-swap">Annuler</button>`;
  }

  function flash(code) {
    const el = document.querySelector(`.key[data-key="${CSS.escape(code)}"]`);
    if (el) { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }
  }

  // ---------- Test de frappe (génération du texte et détection dans typing.js)
  const T = window.Typing;
  let testTimer;
  const vis = (c) => (c === ' ' ? '␣' : c === '\n' ? '↵' : c);

  // Caractère tapé -> position. Les touches ciblées l'emportent (ex. chiffres du pavé numérique).
  function charMap(targets) {
    const m = {};
    const codes = st.layout.keys.map((k) => k.code).sort((a, b) => a.startsWith('Numpad') - b.startsWith('Numpad'));
    for (const code of [...codes, ...targets]) {
      const c = L.char(code, st.kb.variant);
      if (c && (!(c in m) || targets.includes(code))) m[c] = code;
    }
    return m;
  }

  function openTest(keys) {
    const map = charMap(keys);
    const chars = keys.map((c) => L.char(c, st.kb.variant)).filter((c) => c != null);
    state.test = { keys, map, text: T.text(new Set(Object.keys(map)), chars), typed: '', done: false };
    renderTest();
    const d = $('#testDlg');
    if (!d.open) d.showModal();
    $('#ttInput').focus();
  }

  function testResult() {
    const t = state.test;
    const { ops, end } = T.align(t.text, t.typed.toLowerCase());
    const found = T.findings(t.text, ops).map((f) => ({ ...f, key: t.map[f.c] })).filter((f) => f.key);
    return { ops, end, found, typos: ops.filter((o) => o.op === 'sub').length };
  }

  function testTextHtml(r) {
    const plain = (c) => (c === '\n' ? '↵\n' : esc(c));
    const body = r.ops.map((o) => o.op === '=' ? plain(o.c)
      : o.op === 'ins' ? `<span class="extra">${esc(vis(o.t))}</span>`
      : o.op === 'del' ? `<span class="miss">${esc(vis(o.c))}</span>`
      : `<span class="sub" title="Tapé : ${esc(vis(o.t))}">${esc(vis(o.c))}</span>`).join('');
    return `<span class="done">${body}</span><span class="cur"></span>${[...state.test.text.slice(r.end)].map(plain).join('')}`;
  }

  function updateTest() {
    const r = testResult();
    const n = (k) => r.found.filter((f) => f.kind === k && f.sure).length;
    $('#ttText').innerHTML = testTextHtml(r);
    $('#ttLive').innerHTML = `<span>${r.end} / ${state.test.text.length}</span>`
      + Object.entries(KINDS).map(([k, v]) => `<span class="k-${k}">${v.ico} <b>${n(k)}</b> ${v.many}</span>`).join('');
    $('#ttText .cur').scrollIntoView({ block: 'nearest' });
    return r;
  }

  function finishTest() {
    const t = state.test;
    clearTimeout(testTimer);
    if (!t || t.done) return;
    if (!t.typed) return $('#testDlg').close();
    const r = testResult();
    t.result = { ...r, n: t.typed.length, found: r.found.map((f) => ({ ...f, on: f.sure })) };
    t.done = true;
    renderTest();
  }

  function ctxHtml(f) {
    const E = state.test.text, v = (s) => esc(s.replace(/\n/g, ' '));
    const c = f.kind === 'double' ? f.c : E[f.i];
    return `…${v(E.slice(Math.max(0, f.i - 8), f.i))}<mark class="k-${f.kind}">${esc(vis(c))}</mark>`
      + `${v(E.slice(f.kind === 'double' ? f.i : f.i + 1, f.i + 8))}…`;
  }

  function renderTest() {
    const t = state.test, d = $('#testDlg');
    const names = (codes) => codes.map((c) => `<b>${esc(st.name(c))}</b>`).join(', ');
    const off = t.keys.filter((c) => L.char(c, st.kb.variant) == null);
    const head = `<div class="sheet-head"><div><h2>🎯 Test de frappe</h2>
      <p class="muted small">${t.keys.length ? 'Touches ciblées : ' + names(t.keys) : 'Texte général : toutes les touches'}</p></div>
      <button class="icon" data-act="close-test" aria-label="Fermer">✕</button></div>`;
    if (!t.done) {
      d.innerHTML = `<div class="sheet-body">${head}
        ${off.length ? `<p class="explain">Pas de caractère à taper, donc non testé : ${names(off)}.</p>` : ''}
        <p class="explain">Recopiez le texte sur le clavier, à votre rythme habituel. Sans correction : chaque erreur
        sert à repérer un double input (rouge) ou un appui manqué (bleu).</p>
        <div class="tt-text" id="ttText"></div>
        <textarea id="ttInput" rows="3" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="Tapez ici…"></textarea>
        <div class="tt-live muted small" id="ttLive"></div>
        <div class="row2"><button class="btn" data-act="test-new">↻ Autre texte</button><button class="btn primary" data-act="test-end">Terminer</button></div>
      </div>`;
      $('#ttInput').value = t.typed;
      updateTest();
      return;
    }
    const r = t.result;
    const on = r.found.filter((f) => f.on).length;
    const items = r.found.map((f, i) => `<li><label class="sugg"><input type="checkbox" data-i="${i}" ${f.on ? 'checked' : ''}>
      <span>${KINDS[f.kind].ico} ${cap(KINDS[f.kind].one)} sur <b>${esc(st.name(f.key))}</b>
      ${f.sure ? '' : '<span class="muted small">· caractère en trop, sans répétition proche</span>'}
      <span class="ctx">${ctxHtml(f)}</span></span></label></li>`).join('');
    d.innerHTML = `<div class="sheet-body">${head}
      <div class="tt-text">${testTextHtml(r)}</div>
      <p class="muted small">${t.typed.length} caractères tapés${r.typos ? ` · ${plural(r.typos, 'faute de frappe ignorée', 'fautes de frappe ignorées')} (mauvaise touche)` : ''}</p>
      ${r.found.length
        ? `<p class="explain">Décochez les erreurs qui viennent de vous plutôt que du clavier.</p><ul class="tt-sugg">${items}</ul>`
        : `<p><b>✓ Aucun double input ni appui manqué détecté.</b></p>`}
      <div class="row2"><button class="btn" data-act="test-new">↻ Refaire un test</button>
        <button class="btn primary" data-act="test-save">Enregistrer${on ? ` (${plural(on, 'incident', 'incidents')})` : ' le test'}</button></div>
    </div>`;
  }

  // ---------- Toast
  let toastTimer;
  function toast(msg, undo, test) {
    const el = $('#toast');
    el.innerHTML = `<span>${msg}</span>${test ? `<button data-act="test" data-keys="${esc(test.join(' '))}">Tester</button>` : ''}`
      + `${undo ? '<button data-act="undo">Annuler</button>' : ''}`;
    el.hidden = false;
    el._undo = undo;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; el._undo = null; }, test ? 10000 : undo ? 6000 : 4000);
  }

  // ---------- Actions
  function onKey(code) {
    if (state.swapFrom) {
      const a = state.swapFrom;
      state.swapFrom = null;
      if (a === code) { render(); return; }
      const ev = addEvent({ type: 'swap', kb: st.kb.id, a, b: code });
      toast(`Switchs de ${esc(st.name(a))} et ${esc(st.name(code))} inversés`, () => patch('events', ev.id, { deleted: true }), [a, code]);
      flash(a); flash(code);
      return;
    }
    openSheet(code);
  }

  const actions = {
    login,
    account() {
      if (!hasToken()) return login();
      const d = $('#accountDlg');
      d.innerHTML = `<div class="sheet-body">
        <div class="sheet-head">
          ${user?.photo ? `<img src="${esc(user.photo)}" alt="" width="44" height="44" style="border-radius:50%" referrerpolicy="no-referrer">` : ''}
          <div><h2>${esc(user?.name || 'Compte Google')}</h2><p class="muted small">${esc(user?.email || '')}</p></div>
          <button class="icon" data-act="close-account" aria-label="Fermer">✕</button>
        </div>
        <p class="muted small">Fichier Drive : <code>${esc(FILE_NAME)}</code>${sync$.last ? `<br>Dernière synchro : ${dtf.format(sync$.last)}` : ''}</p>
        <button class="btn" data-act="sync-now">⟳ Synchroniser maintenant</button>
        <button class="btn" data-act="export">⬇ Exporter les données (JSON)</button>
        <button class="btn danger" data-act="logout">Se déconnecter</button>
      </div>`;
      d.showModal();
    },
    'close-account': () => $('#accountDlg').close(),
    'sync-now': () => { $('#accountDlg').close(); sync(); },
    export() {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: FILE_NAME });
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    },
    logout() {
      $('#accountDlg').close();
      const wipe = confirm('Effacer aussi les données gardées sur cet appareil ?\n(Elles restent sur votre Drive.)\n\nOK = effacer, Annuler = garder');
      logout(wipe);
    },
    'new-kb'() {
      const f = $('#newKbForm');
      f.size.innerHTML = Object.entries(L.SIZES).map(([v, n]) => `<option value="${v}" ${v === '65' ? 'selected' : ''}>${n}</option>`).join('');
      f.variant.innerHTML = Object.entries(L.VARIANTS).map(([v, o]) => `<option value="${v}">${o.name}</option>`).join('');
      f.name.value = '';
      $('#newKb').showModal();
    },
    'rename-kb'() {
      const kb = currentKb();
      const name = prompt('Nouveau nom du clavier', kb.name);
      if (name && name.trim()) patch('keyboards', kb.id, { name: name.trim().slice(0, 60) });
    },
    'delete-kb'() {
      const kb = currentKb();
      if (!confirm(`Supprimer « ${kb.name} » et tout son historique ?`)) return;
      const now = Date.now();
      for (const e of kbEvents(kb.id)) data.events[e.id] = { ...e, deleted: true, u: now };
      data.keyboards[kb.id] = { ...kb, deleted: true, u: now };
      state.kbId = null;
      commit();
    },
    heat(btn) { state.heat = btn.dataset.v; lsSet(K.heat, state.heat); render(); },
    kind(btn) { state.kind = btn.dataset.v; lsSet(K.kind, state.kind); render(); },
    more() { state.histLimit += 50; render(); },
    'close-sheet': () => $('#sheet').close(),
    incident(btn) {
      const code = state.sheetKey, k = btn.dataset.v;
      $('#sheet').close();
      const ev = addEvent({ type: k, kb: st.kb.id, key: code });
      toast(`${KINDS[k].ico} ${cap(KINDS[k].one)} noté sur ${esc(st.name(code))}`, () => patch('events', ev.id, { deleted: true }));
      flash(code);
    },
    swap() {
      state.swapFrom = state.sheetKey;
      $('#sheet').close();
      render();
    },
    'cancel-swap'() { state.swapFrom = null; render(); },
    replace() {
      const code = state.sheetKey;
      if (!confirm(`Remplacer le switch de ${st.name(code)} par un switch neuf ?\nSon compteur repartira de zéro.`)) return;
      $('#sheet').close();
      const ev = addEvent({ type: 'replace', kb: st.kb.id, key: code });
      toast(`♻ Switch neuf installé sur ${esc(st.name(code))}`, () => patch('events', ev.id, { deleted: true }), [code]);
    },
    clean() {
      const code = state.sheetKey;
      $('#sheet').close();
      const ev = addEvent({ type: 'clean', kb: st.kb.id, key: code });
      toast(`🧽 Nettoyage noté sur ${esc(st.name(code))}`, () => patch('events', ev.id, { deleted: true }), [code]);
      flash(code);
    },
    note() {
      const text = prompt('Événement à repérer sur le graphique\n(ex. firmware : debounce 8 ms, lubrification, nettoyage complet…)');
      if (!text || !text.trim()) return;
      const ev = addEvent({ type: 'note', kb: st.kb.id, text: text.trim().slice(0, 120) });
      toast(`📝 Événement noté`, () => patch('events', ev.id, { deleted: true }));
    },
    test(btn) {
      const keys = btn.dataset.keys != null ? btn.dataset.keys.split(' ').filter(Boolean) : [state.sheetKey];
      $('#sheet').close();
      $('#toast').hidden = true;
      openTest(keys);
    },
    'test-new'() { openTest(state.test.keys); },
    'test-end': finishTest,
    'close-test': () => $('#testDlg').close(),
    'test-save'() {
      const t = state.test, sel = t.result.found.filter((f) => f.on);
      const now = Date.now(), ids = [];
      const put = (e) => { const ev = { id: uid(), ts: now, kb: st.kb.id, ...e, u: now }; data.events[ev.id] = ev; ids.push(ev.id); };
      for (const f of sel) put({ type: f.kind, key: f.key });
      put({ type: 'test', keys: t.keys, n: t.result.n, found: sel.length });
      $('#testDlg').close();
      commit();
      toast(`🎯 Test enregistré${sel.length ? ` : ${plural(sel.length, 'incident noté', 'incidents notés')}` : ', aucun incident'}`, () => {
        const at = Date.now();
        for (const id of ids) data.events[id] = { ...data.events[id], deleted: true, u: at };
        commit();
      });
      for (const f of sel) flash(f.key);
    },
    'del-event'(btn) {
      const id = btn.dataset.id;
      patch('events', id, { deleted: true });
      toast('Événement supprimé', () => patch('events', id, { deleted: false }));
    },
    undo() {
      const el = $('#toast');
      const fn = el._undo;
      el.hidden = true; el._undo = null;
      if (fn) fn();
    },
  };

  document.addEventListener('click', (e) => {
    const key = e.target.closest('.key');
    if (key) return onKey(key.dataset.key);
    const btn = e.target.closest('[data-act]');
    if (btn && actions[btn.dataset.act]) { e.preventDefault(); actions[btn.dataset.act](btn); }
  });

  document.addEventListener('change', (e) => {
    if (e.target.closest('#testDlg') && e.target.dataset.i) {
      state.test.result.found[e.target.dataset.i].on = e.target.checked;
      return renderTest();
    }
    if (e.target.id === 'kbSelect') {
      state.kbId = e.target.value; lsSet(K.kb, state.kbId);
      state.swapFrom = null; state.histLimit = 30;
      render();
    }
  });

  // Fermer une feuille en touchant le fond
  for (const d of document.querySelectorAll('dialog')) {
    // Sauf le test : un clic à côté ferait perdre la saisie.
    d.addEventListener('click', (e) => { if (e.target === d && d.id !== 'testDlg') d.close(); });
  }
  $('#sheet').addEventListener('close', () => { state.sheetKey = null; });

  // Test de frappe : pas de correction (elle effacerait les doubles inputs), fin automatique au dernier caractère.
  const testDlg = $('#testDlg');
  testDlg.addEventListener('close', () => { state.test = null; clearTimeout(testTimer); });
  testDlg.addEventListener('beforeinput', (e) => {
    if (e.target.id !== 'ttInput' || !/^(delete|history)|FromPaste|FromDrop|ReplacementText/.test(e.inputType)) return;
    e.preventDefault();
    e.target.classList.remove('nope'); void e.target.offsetWidth; e.target.classList.add('nope');
  });
  testDlg.addEventListener('input', (e) => {
    if (e.target.id !== 'ttInput' || !state.test || state.test.done) return;
    state.test.typed = e.target.value;
    const r = updateTest();
    clearTimeout(testTimer);
    // Délai : laisse le temps à un éventuel double input sur le dernier caractère.
    if (r.end === state.test.text.length && r.ops[r.ops.length - 1]?.op === '=') testTimer = setTimeout(finishTest, 800);
  });

  $('#newKb').addEventListener('close', () => {
    const d = $('#newKb'), f = $('#newKbForm');
    if (d.returnValue !== 'ok' || !f.name.value.trim()) return;
    const now = Date.now();
    const kb = { id: uid(), name: f.name.value.trim().slice(0, 60), size: f.size.value, variant: f.variant.value, createdAt: now, u: now };
    data.keyboards[kb.id] = kb;
    state.kbId = kb.id; lsSet(K.kb, kb.id);
    commit();
  });

  // Sur ordinateur : appuyer sur la touche physique la sélectionne.
  document.addEventListener('keydown', (e) => {
    if (e.repeat || !st || document.querySelector('dialog[open]')) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
    if (e.code === 'Escape' && state.swapFrom) { state.swapFrom = null; render(); return; }
    if ((e.ctrlKey || e.metaKey) && !/^(Control|Meta)/.test(e.code)) return;
    if (!(e.code in st.pos)) return;
    e.preventDefault();
    onKey(e.code);
  });

  let resizeTimer;
  addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => st && drawKeyboard(), 120); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (hasToken()) sync(); else render();
  });
  setInterval(() => { if (token && !hasToken()) render(); else renderTop(); }, 60000);

  // ---------- Démarrage
  render();
  initGis();
  if (hasToken()) sync();
})();
