// Fonctions partagées par toutes les pages : API, session, panier, en-tête, pied de page, panier latéral
const App = (() => {
  /* ------------------------------ Session ------------------------------ */
  const session = {
    get jeton() { try { return localStorage.getItem('jeton'); } catch { return null; } },
    get utilisateur() {
      try { return JSON.parse(localStorage.getItem('utilisateur')); } catch { return null; }
    },
    ouvrir(jeton, utilisateur) {
      localStorage.setItem('jeton', jeton);
      localStorage.setItem('utilisateur', JSON.stringify(utilisateur));
    },
    fermer() {
      localStorage.removeItem('jeton');
      localStorage.removeItem('utilisateur');
    },
  };

  /* -------------------------------- API -------------------------------- */
  // Envoie une requête à l'API Express (avec le jeton de connexion s'il existe)
  async function api(url, { methode = 'GET', corps } = {}) {
    const res = await fetch('/api' + url, {
      method: methode,
      headers: {
        'Content-Type': 'application/json',
        ...(session.jeton ? { Authorization: `Bearer ${session.jeton}` } : {}),
      },
      body: corps !== undefined ? JSON.stringify(corps) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && session.jeton) {
      session.fermer();
      location.href = `connexion.html?retour=${encodeURIComponent(location.pathname + location.search)}`;
      throw new Error(data.message || 'Session expirée.');
    }
    if (!res.ok) {
      const err = new Error(data.message || `Erreur ${res.status}`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  // Redirige vers la connexion si l'utilisateur n'a pas le bon rôle
  function exigerRole(...roles) {
    const u = session.utilisateur;
    if (!u) {
      location.href = `connexion.html?retour=${encodeURIComponent(location.pathname + location.search)}`;
      return false;
    }
    if (roles.length && !roles.includes(u.role)) {
      document.querySelector('main').innerHTML =
        '<div class="carte vide"><h2>Accès refusé</h2><p>Cette page n\'est pas accessible avec votre rôle.</p></div>';
      return false;
    }
    return true;
  }

  /* ------------------------------- Panier ------------------------------ */
  // Le panier est gardé dans le navigateur (localStorage) jusqu'à l'envoi de la demande
  const panier = {
    lire() {
      try { return JSON.parse(localStorage.getItem('panier')) || { articles: [], date_debut: '', date_fin: '' }; }
      catch { return { articles: [], date_debut: '', date_fin: '' }; }
    },
    ecrire(p) {
      try { localStorage.setItem('panier', JSON.stringify(p)); } catch { /* stockage indisponible */ }
      majCompteurPanier();
    },
    ajouter(materiel, quantite) {
      const p = panier.lire();
      const a = p.articles.find((x) => x.materiel_id === materiel.id);
      if (a) a.quantite += quantite;
      else p.articles.push({ materiel_id: materiel.id, nom: materiel.nom, categorie: materiel.categorie, tarif: materiel.tarif_journalier, quantite });
      panier.ecrire(p);
    },
    retirer(id) {
      const p = panier.lire();
      p.articles = p.articles.filter((a) => a.materiel_id !== id);
      panier.ecrire(p);
    },
    vider() { panier.ecrire({ articles: [], date_debut: '', date_fin: '' }); },
    nombre() { return panier.lire().articles.reduce((s, a) => s + a.quantite, 0); },
  };

  /* ----------------------------- Affichage ----------------------------- */
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const argent = (n) => Number(n || 0).toLocaleString('fr-CA', { style: 'currency', currency: 'CAD' });

  const date = (s) => {
    if (!s) return '—';
    const [a, m, j] = String(s).slice(0, 10).split('-');
    return `${j}/${m}/${a}`;
  };
  const dateHeure = (s) => (s ? `${date(s)} ${String(s).slice(11, 16)}` : '—');

  const aujourdhui = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  const LIBELLES = {
    en_attente: 'En attente', validee: 'Validée – à payer', refusee: 'Refusée', annulee: 'Annulée',
    confirmee: 'Confirmée', en_cours: 'Matériel remis', terminee: 'Terminée',
    accepte: 'Accepté', refuse: 'Refusé',
    disponible: 'Disponible', loue: 'Loué', maintenance: 'Maintenance', hors_service: 'Hors service',
    non_reglee: 'Non réglée', reglee: 'Réglée', retard: 'Retard', dommage: 'Dommage',
    client: 'Client', responsable: 'Responsable', administrateur: 'Administrateur',
    nouvelle: 'Nouvelle', traitee: 'Traitée',
  };
  const libelle = (s) => LIBELLES[s] || s;
  const badge = (s) => `<span class="badge b-${esc(s)}">${esc(libelle(s))}</span>`;

  function toast(message, type = 'ok') {
    let zone = document.getElementById('toasts');
    if (!zone) {
      zone = document.createElement('div');
      zone.id = 'toasts';
      zone.setAttribute('role', 'status');
      document.body.appendChild(zone);
    }
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.textContent = message;
    zone.appendChild(t);
    setTimeout(() => t.remove(), 4500);
  }

  // Fenêtre modale simple ; renvoie l'élément .modale-corps
  function modale(titre, html) {
    fermerModale();
    const fond = document.createElement('div');
    fond.className = 'modale-fond';
    fond.innerHTML = `<div class="modale" role="dialog" aria-modal="true" aria-label="${esc(titre)}">
        <div class="modale-tete"><h2>${esc(titre)}</h2><button class="btn-icone" data-fermer aria-label="Fermer">✕</button></div>
        <div class="modale-corps">${html}</div></div>`;
    fond.addEventListener('click', (e) => { if (e.target === fond || e.target.closest('[data-fermer]')) fermerModale(); });
    document.body.appendChild(fond);
    return fond.querySelector('.modale-corps');
  }
  function fermerModale() { document.querySelector('.modale-fond')?.remove(); }

  // Remplit un formulaire en objet { nom: valeur }
  const donneesFormulaire = (form) => Object.fromEntries(new FormData(form).entries());

  // Désactive un bouton pendant une action async
  async function enCours(bouton, fn) {
    const texte = bouton.textContent;
    bouton.disabled = true;
    bouton.textContent = 'Patientez…';
    try { return await fn(); } finally { bouton.disabled = false; bouton.textContent = texte; }
  }

  /* ------------------------ Catégories (menu, pied) ------------------------ */
  // Catégories + prix de départ, chargés une fois par page
  let promesseCategories = null;
  function categoriesAvecPrix() {
    if (!promesseCategories) {
      promesseCategories = Promise.all([api('/categories'), api('/materiels')]).then(([cats, mats]) =>
        cats.map((c) => {
          const liste = mats.filter((m) => m.categorie_id === c.id);
          return {
            ...c,
            unites: liste.reduce((s, m) => s + m.quantite_totale, 0),
            prix_min: liste.length ? Math.min(...liste.map((m) => Number(m.tarif_journalier))) : null,
          };
        })).catch(() => []);
    }
    return promesseCategories;
  }

  /* ------------------------------ Icônes ------------------------------ */
  const ICO = {
    logo: '<svg width="34" height="34" viewBox="0 0 34 34" aria-hidden="true"><circle cx="17" cy="17" r="17" fill="#fff"/><rect x="9" y="10" width="16" height="11" rx="2" fill="#0A84E8"/><rect x="7" y="22" width="20" height="3" rx="1.5" fill="#0B2A4A"/></svg>',
    panier: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M3 4h2l2.5 11h11L21 7H6.2"/><circle cx="9" cy="19.5" r="1.4"/><circle cx="17" cy="19.5" r="1.4"/></svg>',
    bulle: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z"/><path d="M8 10h8"/></svg>',
    haut: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" aria-hidden="true"><path d="M6 15l6-6 6 6"/></svg>',
  };
  const marque = () => `<a class="marque" href="index.html">${ICO.logo}<span>Loca<b>Tech</b></span></a>`;

  /* ------------------------------ En-tête ------------------------------ */
  function majCompteurPanier() {
    const el = document.getElementById('compteur-panier');
    if (el) { const n = panier.nombre(); el.textContent = n; el.hidden = n === 0; }
  }

  function entete() {
    const u = session.utilisateur;
    const page = location.pathname.split('/').pop() || 'index.html';
    const peutLouer = !u || u.role === 'client';

    const liensCompte = [];
    if (u?.role === 'client') liensCompte.push(['mes-reservations.html', 'Mes réservations'], ['mes-paiements.html', 'Mes paiements']);
    if (u && ['responsable', 'administrateur'].includes(u.role)) liensCompte.push(['responsable.html', 'Gestion des locations']);
    if (u?.role === 'administrateur') liensCompte.push(['admin.html', 'Administration']);

    const compte = u
      ? `<div class="deroulant" id="menu-compte"><button aria-expanded="false">${esc(u.prenom)} <span class="chevron">▾</span></button>
          <div class="panneau droite">${liensCompte.map(([h, t]) => `<a href="${h}">${t}</a>`).join('')}
          <div class="separateur"></div><button id="deconnexion">Déconnexion</button></div></div>`
      : `<a href="connexion.html" class="${page === 'connexion.html' ? 'actif' : ''}">Connexion</a>`;

    const header = document.createElement('header');
    header.className = 'entete';
    header.innerHTML = `<div class="entete-int">
      ${marque()}
      <button class="btn-icone menu-mobile" aria-label="Menu" aria-expanded="false">☰</button>
      <nav class="menu" aria-label="Navigation principale">
        <div class="deroulant" id="menu-location"><button aria-expanded="false">Location de matériel <span class="chevron">▾</span></button>
          <div class="panneau" id="panneau-categories"><a class="tout" href="catalogue.html">Tout le catalogue</a></div></div>
        <a href="index.html#solutions">Solutions</a>
        ${compte}
      </nav>
      <div class="actions-entete">
        ${peutLouer ? `<button class="pilule pilule-marine" id="btn-panier">Mon panier ${ICO.panier}<span id="compteur-panier" class="pastille" hidden></span></button>` : ''}
        <button class="pilule pilule-blanche" data-conseil>${ICO.bulle} Demander conseil</button>
      </div></div>`;
    document.body.prepend(header);

    // Menus déroulants : ouverture au clic, fermeture au clic ailleurs
    header.querySelectorAll('.deroulant > button').forEach((b) => b.addEventListener('click', (e) => {
      e.stopPropagation();
      const d = b.parentElement;
      const ouvert = !d.classList.contains('ouvert');
      header.querySelectorAll('.deroulant').forEach((x) => x.classList.remove('ouvert'));
      d.classList.toggle('ouvert', ouvert);
      b.setAttribute('aria-expanded', ouvert);
    }));
    document.addEventListener('click', () => header.querySelectorAll('.deroulant').forEach((x) => x.classList.remove('ouvert')));
    header.querySelector('.menu-mobile').addEventListener('click', (e) => {
      const ouvert = header.classList.toggle('ouvert');
      e.currentTarget.setAttribute('aria-expanded', ouvert);
    });
    header.querySelector('#deconnexion')?.addEventListener('click', () => { session.fermer(); location.href = 'index.html'; });
    header.querySelector('#btn-panier')?.addEventListener('click', ouvrirPanier);

    categoriesAvecPrix().then((cats) => {
      const p = document.getElementById('panneau-categories');
      p.innerHTML = cats.map((c) => `<a href="catalogue.html?categorie=${c.id}"><span class="mini">${illustration(c.nom)}</span>
        <span><b>${esc(c.nom)}</b><small>${c.prix_min !== null ? `dès ${argent(c.prix_min)} / jour` : 'Bientôt disponible'}</small></span></a>`).join('')
        + '<div class="separateur"></div><a class="tout" href="catalogue.html">Tout le catalogue</a>';
    });
    majCompteurPanier();
  }

  /* ---------------------------- Pied de page ---------------------------- */
  function piedDePage() {
    const footer = document.createElement('footer');
    footer.className = 'pied';
    footer.innerHTML = `<div class="int pied-grille">
      <div>${marque()}<h4>À propos</h4>
        <p>LocaTech loue du matériel informatique à la journée aux écoles, aux entreprises et aux centres de formation, avec un prix calculé à l'avance et un suivi en ligne.</p>
        <button class="pilule pilule-blanche" data-conseil>${ICO.bulle} Demander conseil</button></div>
      <div><h4>Location de matériel</h4><div id="pied-categories"></div></div>
      <div><h4>Solutions</h4>${['Formation', 'Événementiel', 'Examens et ateliers', 'Nouveaux employés', 'Télétravail', 'Test de matériel']
        .map((s) => `<a href="index.html#solutions">${s}</a>`).join('')}</div>
      <div><a href="catalogue.html" class="pilule pilule-jaune">Parcourir le catalogue</a><h4>Mon compte</h4>
        ${session.utilisateur ? '<a href="mes-reservations.html">Mes réservations</a><a href="mes-paiements.html">Mes paiements</a>'
          : '<a href="connexion.html">Connexion</a><a href="inscription.html">Créer un compte</a>'}</div>
    </div><div class="pied-bas">© ${new Date().getFullYear()} LocaTech. Tous droits réservés.</div>`;
    document.body.appendChild(footer);
    categoriesAvecPrix().then((cats) => {
      document.getElementById('pied-categories').innerHTML = cats.map((c) => `<a href="catalogue.html?categorie=${c.id}">${esc(c.nom)}</a>`).join('');
    });

    // Bouton « remonter en haut »
    const haut = document.createElement('a');
    haut.className = 'haut';
    haut.href = '#';
    haut.setAttribute('aria-label', 'Remonter en haut de la page');
    haut.innerHTML = ICO.haut;
    haut.addEventListener('click', (e) => { e.preventDefault(); scrollTo({ top: 0 }); });
    document.body.appendChild(haut);
    addEventListener('scroll', () => haut.classList.toggle('visible', scrollY > 500), { passive: true });
  }

  /* -------------------------- Panier latéral -------------------------- */
  function creerTiroir() {
    const voile = document.createElement('div');
    voile.className = 'voile';
    const tiroir = document.createElement('aside');
    tiroir.className = 'tiroir';
    tiroir.setAttribute('aria-label', 'Mon panier de location');
    tiroir.innerHTML = `<div class="tiroir-tete"><h2>Mon panier de location</h2><button class="btn-icone" data-fermer-panier aria-label="Fermer">✕</button></div>
      <div class="tiroir-corps" id="tiroir-corps"></div><div class="tiroir-pied" id="tiroir-pied"></div>`;
    document.body.append(voile, tiroir);
    voile.addEventListener('click', fermerPanier);
    tiroir.addEventListener('click', (e) => {
      if (e.target.closest('[data-fermer-panier]')) fermerPanier();
      const id = Number(e.target.closest('[data-retirer]')?.dataset.retirer);
      if (id) { panier.retirer(id); ouvrirPanier(); }
    });
  }

  async function ouvrirPanier() {
    const p = panier.lire();
    const corps = document.getElementById('tiroir-corps');
    const pied = document.getElementById('tiroir-pied');
    document.body.classList.add('panier-ouvert');

    if (!p.articles.length) {
      corps.innerHTML = '<div class="vide"><p>Votre panier est vide pour le moment.</p></div>';
      pied.innerHTML = '<a class="btn btn-bloc btn-grand" href="catalogue.html">Parcourir le catalogue</a>';
      return;
    }
    let est = null;
    if (p.date_debut && p.date_fin && p.date_fin >= p.date_debut) {
      try {
        est = await api('/reservations/estimation', { methode: 'POST',
          corps: { date_debut: p.date_debut, date_fin: p.date_fin, articles: p.articles.map(({ materiel_id, quantite }) => ({ materiel_id, quantite })) } });
      } catch { est = null; }
    }
    corps.innerHTML = (est
      ? `<div class="t-dates">Du ${date(p.date_debut)} au ${date(p.date_fin)}, ${est.nb_jours} jour(s)</div>`
      : '<div class="avertissement">Choisissez vos dates pour calculer le prix.</div>')
      + p.articles.map((a) => {
        const l = est?.lignes.find((x) => x.materiel_id === a.materiel_id);
        return `<div class="t-art"><span class="mini">${illustration(a.categorie || a.nom)}</span>
          <span><b>${esc(a.nom)}</b><small>${a.quantite} × ${argent(l?.tarif_applique ?? a.tarif)}${est ? ` × ${est.nb_jours} jour(s)` : ' / jour'}</small>
          ${l && !l.suffisant ? `<br><small style="color:var(--danger)">Seulement ${l.disponible} disponible(s)</small>` : ''}
          <br><button class="btn-lien" style="font-size:.8rem;color:var(--doux)" data-retirer="${a.materiel_id}">Retirer</button></span>
          <span class="m">${l ? argent(l.montant_ligne) : ''}</span></div>`;
      }).join('');
    pied.innerHTML = `${est ? `<div class="tot"><span>Estimation</span><b>${argent(est.montant_total)}</b></div>` : ''}
      <small>Votre demande sera validée par un responsable avant le paiement.</small>
      <a class="btn btn-bloc btn-grand" href="panier.html">Voir le récapitulatif</a>`;
  }
  function fermerPanier() { document.body.classList.remove('panier-ouvert'); }

  /* ------------------------ Demande de conseil ------------------------ */
  function ouvrirConseil() {
    const corps = modale('Demander conseil', `<p class="sous-titre">Décrivez votre projet : un responsable vous répond dans la journée ouvrable, sans engagement.</p>
      <div id="conseil-erreur" class="erreur-form cache"></div>
      <form class="form-conseil" id="form-conseil">
        <div class="champ"><label for="c-nom">Nom et prénom</label><input id="c-nom" name="nom" required maxlength="120"></div>
        <div class="champ"><label for="c-org">Organisation</label><input id="c-org" name="organisation" maxlength="150"></div>
        <div class="champ"><label for="c-email">Courriel</label><input id="c-email" type="email" name="email" required></div>
        <div class="champ"><label for="c-tel">Téléphone (facultatif)</label><input id="c-tel" name="telephone" maxlength="30"></div>
        <div class="champ"><label for="c-debut">Début de la location</label><input id="c-debut" type="date" name="date_debut" min="${aujourdhui()}"></div>
        <div class="champ"><label for="c-jours">Nombre de jours</label><input id="c-jours" type="number" name="nb_jours" min="1" max="90"></div>
        <div class="champ large"><label for="c-projet">Votre projet</label><textarea id="c-projet" name="message" rows="4" required minlength="10" maxlength="2000"
          placeholder="Ex. : atelier pour 20 personnes, portables et un projecteur pendant 3 jours"></textarea></div>
        <button class="btn btn-bleu btn-grand large">Envoyer ma demande</button>
      </form>`);
    const u = session.utilisateur;
    if (u) { corps.querySelector('#c-nom').value = `${u.prenom} ${u.nom}`; corps.querySelector('#c-email').value = u.email; }
    corps.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = corps.querySelector('#conseil-erreur');
      err.classList.add('cache');
      await enCours(e.target.querySelector('button'), async () => {
        try {
          const r = await api('/contact', { methode: 'POST', corps: donneesFormulaire(e.target) });
          fermerModale();
          toast(r.message);
        } catch (er) { err.textContent = er.message; err.classList.remove('cache'); }
      });
    });
  }

  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { fermerModale(); fermerPanier(); } });
  document.addEventListener('click', (e) => { if (e.target.closest('[data-conseil]')) { e.preventDefault(); ouvrirConseil(); } });
  document.addEventListener('DOMContentLoaded', () => { entete(); piedDePage(); creerTiroir(); });

  return {
    session, api, exigerRole, panier, esc, argent, date, dateHeure, aujourdhui,
    libelle, badge, toast, modale, fermerModale, donneesFormulaire, enCours,
    categoriesAvecPrix, ouvrirPanier, ouvrirConseil,
  };
})();
