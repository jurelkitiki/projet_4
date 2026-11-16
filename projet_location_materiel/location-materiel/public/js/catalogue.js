// Catalogue : filtre par catégorie, recherche, disponibilités selon les dates, ajout au panier
const { api, esc, argent, badge, toast, panier, session, aujourdhui, date } = App;
const params = new URLSearchParams(location.search);
const form = document.getElementById('f-dates');
const liste = document.getElementById('liste');
const periode = document.getElementById('periode');
const champRecherche = document.getElementById('recherche');
let categorie = params.get('categorie') || '';
let materiels = [];
let categories = [];

// Couleur de fond de l'illustration selon la catégorie (même ordre que l'accueil)
const COULEURS = [
  'background:#25292D;--i1:#0E1114;--i2:#E8344E;--i3:#fff;--i4:#FBBF1A',
  'background:#E8344E;--i1:#1B1E22;--i2:#7A16A8;--i3:#FBBF1A;--i4:#fff',
  'background:#FBBF1A;--i1:#0B2A4A;--i2:#E8344E;--i3:#fff;--i4:#fff',
  'background:#0C47A6;--i1:#fff;--i2:#FBBF1A;--i3:#0B2A4A;--i4:#0A84E8',
  'background:#7A16A8;--i1:#fff;--i2:#FBBF1A;--i3:#fff;--i4:#E8344E',
  'background:#0A84E8;--i1:#0B2A4A;--i2:#FBBF1A;--i3:#fff;--i4:#E8344E',
];

// Dates : celles de l'adresse, sinon celles du panier
const p = panier.lire();
form.debut.min = form.fin.min = aujourdhui();
form.debut.value = params.get('debut') || p.date_debut || '';
form.fin.value = params.get('fin') || p.date_fin || '';
form.debut.addEventListener('change', () => { form.fin.min = form.debut.value || aujourdhui(); });

function afficherCategories() {
  const total = categories.reduce((s, c) => s + c.nb_materiels, 0);
  document.getElementById('liste-cats').innerHTML =
    `<button class="f-cat ${categorie ? '' : 'actif'}" data-cat="">Tout le matériel <span>${total}</span></button>`
    + categories.map((c) => `<button class="f-cat ${String(c.id) === categorie ? 'actif' : ''}" data-cat="${c.id}">${esc(c.nom)} <span>${c.nb_materiels}</span></button>`).join('');
  const c = categories.find((x) => String(x.id) === categorie);
  document.getElementById('fil-cat').textContent = c ? c.nom : 'Catalogue de location';
}

async function charger() {
  const { debut, fin } = App.donneesFormulaire(form);
  if ((debut && !fin) || (!debut && fin)) return toast('Indiquez les deux dates.', 'erreur');
  if (debut && fin && fin < debut) return toast('La date de fin doit suivre la date de début.', 'erreur');

  const q = new URLSearchParams();
  if (categorie) q.set('categorie', categorie);
  if (champRecherche.value.trim()) q.set('recherche', champRecherche.value.trim());
  if (debut && fin) { q.set('debut', debut); q.set('fin', fin); }
  liste.innerHTML = '<p class="doux">Chargement…</p>';
  try {
    materiels = await api('/materiels?' + q);
  } catch (e) {
    liste.innerHTML = `<div class="carte vide">${esc(e.message)}</div>`;
    return;
  }

  // Mémorise la période dans le panier et dans l'adresse (pour partager le lien)
  const adr = new URLSearchParams();
  if (categorie) adr.set('categorie', categorie);
  if (debut && fin) {
    const pa = panier.lire(); pa.date_debut = debut; pa.date_fin = fin; panier.ecrire(pa);
    adr.set('debut', debut); adr.set('fin', fin);
    const jours = Math.round((new Date(fin) - new Date(debut)) / 864e5) + 1;
    periode.className = 'periode';
    periode.textContent = `Disponibilités du ${date(debut)} au ${date(fin)}, soit ${jours} jour(s) de location.`;
  } else {
    periode.className = 'periode neutre';
    periode.textContent = 'Choisissez une période pour afficher les quantités disponibles.';
  }
  history.replaceState(null, '', 'catalogue.html' + (adr.toString() ? '?' + adr : ''));
  afficherCategories();
  afficher(Boolean(debut && fin));
}

function afficher(avecPeriode) {
  if (!materiels.length) { liste.innerHTML = '<div class="carte vide">Aucun équipement ne correspond à votre recherche.</div>'; return; }
  const peutLouer = !session.utilisateur || session.utilisateur.role === 'client';
  liste.innerHTML = materiels.map((m) => {
    const indispo = m.etat === 'maintenance' || m.etat === 'hors_service';
    const dispo = avecPeriode ? m.disponible_periode : null;
    const max = avecPeriode ? dispo : m.quantite_totale;
    const pastille = indispo ? badge(m.etat)
      : avecPeriode ? (dispo > 0 ? `<span class="badge b-disponible">${dispo} disponible(s)</span>` : '<span class="badge b-refusee">Complet sur la période</span>')
        : `<span class="badge">${m.quantite_totale} au parc</span>`;
    const idx = Math.max(0, categories.findIndex((c) => c.id === m.categorie_id));
    return `<article class="prod">
      <div class="prod-ill" style="${COULEURS[idx % COULEURS.length]}"><span class="etat">${pastille}</span>${illustration(m.categorie)}</div>
      <div class="prod-txt">
        <span class="c">${esc(m.categorie)}</span>
        <h3>${esc(m.nom)}</h3>
        <p>${esc(m.description || '')}</p>
        <div class="prod-prix">${argent(m.tarif_journalier)}<small> / jour</small></div>
        ${peutLouer ? `<div class="ajout">
          <input type="number" min="1" max="${Math.max(1, max)}" value="1" aria-label="Quantité" data-qte="${m.id}" ${indispo || max === 0 ? 'disabled' : ''}>
          <button class="btn" data-ajouter="${m.id}" ${indispo || max === 0 ? 'disabled' : ''}>Ajouter au panier</button>
        </div>` : ''}
      </div>
    </article>`;
  }).join('');
}

liste.addEventListener('click', (e) => {
  const id = Number(e.target.dataset.ajouter);
  if (!id) return;
  const m = materiels.find((x) => x.id === id);
  const qte = Number(liste.querySelector(`[data-qte="${id}"]`).value);
  if (!Number.isInteger(qte) || qte < 1) return toast('Quantité invalide.', 'erreur');
  const deja = panier.lire().articles.find((a) => a.materiel_id === id)?.quantite || 0;
  const limite = m.disponible_periode ?? m.quantite_totale;
  if (qte + deja > limite) return toast(`Maximum ${limite} unité(s) pour cet équipement.`, 'erreur');
  panier.ajouter(m, qte);
  App.ouvrirPanier();
});

document.getElementById('liste-cats').addEventListener('click', (e) => {
  const b = e.target.closest('[data-cat]');
  if (!b) return;
  categorie = b.dataset.cat;
  charger();
});
form.addEventListener('submit', (e) => { e.preventDefault(); charger(); });
let minuterie;
champRecherche.addEventListener('input', () => { clearTimeout(minuterie); minuterie = setTimeout(charger, 300); });

api('/categories').then((c) => { categories = c; charger(); }).catch((e) => toast(e.message, 'erreur'));
