// Test de frappe : génération d'un texte à recopier et détection des erreurs.
// Logique pure (aucun accès au DOM ni aux données) ; l'interface est dans app.js.
//
// Le texte est comparé caractère par caractère à la saisie par un alignement
// (distance d'édition). Un caractère en trop qui répète un caractère tapé juste avant
// est un double input probable (« coucouc » pour « coucou ») ; un caractère absent
// est un appui manqué probable. Les substitutions sont des fautes de frappe ordinaires.
(() => {
  const WORDS = `
    le la les un une des de du et au en dans sur sous avec pour par sans chez vers entre comme mais donc car
    il elle on nous vous ils elles mon ton son notre votre leur ce cette tout tous rien personne chaque
    faire dire aller voir savoir pouvoir vouloir venir prendre donner parler aimer passer mettre penser
    trouver rester partir sortir tenir croire laisser porter jouer lire écrire boire manger dormir courir
    ouvrir fermer chanter danser marcher chercher compter regarder écouter tomber monter descendre
    temps jour nuit année semaine matin soir heure minute moment monde pays ville maison porte table chaise
    livre lettre papier crayon clavier touche écran souris bureau travail école classe élève père mère
    frère enfant fille garçon homme femme ami chien chat oiseau poisson cheval vache mouton lapin cochon
    eau feu terre air ciel soleil lune étoile nuage pluie neige vent mer lac rivière montagne arbre fleur
    herbe jardin champ chemin route rue pont gare train avion bateau voiture vélo taxi bus métro
    pain lait beurre fromage sucre sel café thé vin pomme poire orange citron fraise cerise kiwi melon
    tomate salade soupe riz pâte
    grand petit gros long court haut bas beau joli jeune vieux nouveau bon mauvais vrai faux facile simple
    rapide lent fort doux chaud froid blanc noir rouge vert bleu jaune gris rose calme léger
    très après déjà voilà là où ça ici loin près avant toujours jamais souvent parfois encore aussi assez
    trop peu beaucoup moins plus vite mieux bien
    deux trois quatre cinq six sept huit neuf dix onze douze treize quinze vingt cent mille zéro
    exemple texte prix voix choix luxe taxe index boxe saxo exact expert
    yeux style type cycle rayon noyau joyeux voyage payer tuyau yaourt
    zone gaz nez onze zèbre zoo bizarre lézard azur gazon horizon quiz
    kilo kayak ski week parking képi koala wagon web watt
    quand que quoi qui quel coq question quartier musique banque équipe
    jeu juge juin juillet jambe bijou déjeuner
    fièvre lèvre pièce scène siècle problème système thème crème chèvre règle
    leçon façon reçu glaçon maçon français commerçant
    aujourd'hui c'est l'eau j'ai d'accord qu'il arc-en-ciel grand-mère après-midi porte-clés vis-à-vis
    hibou hiver habit huile hache homard
  `.trim().split(/\s+/);

  const pick = (a, rnd) => a[Math.floor(rnd() * a.length)];
  const count = (s, c) => s.split(c).length - 1;

  // Mot tiré au hasard, en favorisant ceux où c revient souvent (« kayak » plutôt que « ski »).
  function dense(pool, c, rnd) {
    const w = pool.map((x) => count(x, c) ** 2 / x.length);
    let r = rnd() * w.reduce((a, b) => a + b, 0);
    return pool[w.findIndex((v) => (r -= v) < 0)] ?? pool[pool.length - 1];
  }

  // Appuis visés par touche ciblée : assez pour qu'un test sans erreur veuille dire quelque chose.
  const NEED = 40;

  // typeable : Set des caractères disponibles ; targets : caractères à faire taper NEED fois au moins.
  // Un caractère absent de tous les mots (ponctuation…) est inséré seul.
  function text(typeable, targets, rnd = Math.random) {
    const ok = WORDS.filter((w) => [...w].every((c) => typeable.has(c)));
    const tg = targets.filter((c) => c !== ' ' && c !== '\n');
    const space = targets.includes(' '), lines = targets.includes('\n');
    const per = lines ? 2 : Infinity;
    // Espace ciblé : des mots courts, donc plus d'espaces pour la même longueur.
    const filler = space ? ok.filter((w) => w.length <= 4) : ok;
    const seen = Object.fromEntries(tg.map((c) => [c, 0]));
    const words = [];
    const seps = () => {
      const n = Math.max(0, words.length - 1), nl = lines ? Math.floor(n / per) : 0;
      return (!space || n - nl >= NEED) && (!lines || nl >= NEED);
    };
    let len = 0;
    while (words.length < 200 && (len < 220 || !seps() || tg.some((c) => seen[c] < NEED))) {
      const low = tg.slice().sort((a, b) => seen[a] - seen[b])[0];
      let w;
      if (low !== undefined && seen[low] < NEED && rnd() < 0.7) {
        const pool = ok.filter((x) => x.includes(low));
        w = pool.length ? dense(pool, low, rnd) : low;
      } else {
        w = pick(filler, rnd);
      }
      if (w === words[words.length - 1] && ok.length > 1) continue;
      words.push(w);
      len += w.length + 1;
      for (const c of tg) seen[c] += count(w, c);
    }
    return words.map((w, i) => (i && i % per === 0 ? '\n' : i ? ' ' : '') + w).join('');
  }

  // Alignement de la saisie T sur le texte attendu E. La fin de E non encore tapée est gratuite.
  // Renvoie { ops: [{ op: '=' | 'sub' | 'ins' | 'del', i, c, t }], end } ; i = indice dans E.
  function align(E, T) {
    const n = E.length, m = T.length, W = m + 1;
    const D = new Int32Array((n + 1) * W);
    for (let i = 0; i <= n; i++) D[i * W] = i;
    for (let j = 0; j <= m; j++) D[j] = j;
    for (let i = 1; i <= n; i++) {
      for (let j = 1; j <= m; j++) {
        const s = D[(i - 1) * W + j - 1] + (E[i - 1] === T[j - 1] ? 0 : 1);
        D[i * W + j] = Math.min(s, D[(i - 1) * W + j] + 1, D[i * W + j - 1] + 1);
      }
    }
    let end = 0;
    for (let i = 1; i <= n; i++) if (D[i * W + m] <= D[end * W + m]) end = i;
    const ops = [];
    let i = end, j = m;
    while (i > 0 || j > 0) {
      const d = D[i * W + j];
      if (i && j && E[i - 1] === T[j - 1] && d === D[(i - 1) * W + j - 1]) { ops.push({ op: '=', i: --i, c: E[i], t: T[--j] }); }
      else if (j && d === D[i * W + j - 1] + 1) { ops.push({ op: 'ins', i, t: T[--j] }); }
      else if (i && d === D[(i - 1) * W + j] + 1) { ops.push({ op: 'del', i: --i, c: E[i] }); }
      else { ops.push({ op: 'sub', i: --i, c: E[i], t: T[--j] }); }
    }
    return { ops: ops.reverse(), end };
  }

  // Incidents probables : { kind: 'double' | 'skip', c, i, sure }.
  // Une suite d'au moins 3 caractères manquants (mot sauté) n'est pas un défaut de switch.
  function findings(E, ops) {
    const out = [];
    for (let k = 0; k < ops.length; k++) {
      const o = ops[k];
      if (o.op === 'ins') {
        const near = E.slice(Math.max(0, o.i - 4), o.i + 1);
        out.push({ kind: 'double', c: o.t, i: o.i, sure: near.includes(o.t) });
      } else if (o.op === 'del') {
        let a = k, b = k;
        while (ops[a - 1]?.op === 'del') a--;
        while (ops[b + 1]?.op === 'del') b++;
        if (b - a < 2) out.push({ kind: 'skip', c: o.c, i: o.i, sure: true });
      }
    }
    return out;
  }

  window.Typing = { text, align, findings };
})();
