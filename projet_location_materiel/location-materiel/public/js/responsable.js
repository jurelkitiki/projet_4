// Espace responsable du matériel : validation, remise, retour, annulations, pénalités, état du matériel
const { api, esc, argent, date, dateHeure, badge, libelle, toast, modale, fermerModale, aujourdhui, exigerRole } = App;
const zone = document.getElementById('contenu');
const onglets = document.getElementById('onglets');
let ongletActif = 'attente';
let filtreToutes = { statut: '', recherche: '' };

const vide = (texte) => `<div class="vide">${texte}</div>`;

function tableauReservations(rows, actions, { retard = false } = {}) {
  if (!rows.length) return vide('Rien à traiter pour le moment.');
  return `<table class="reactif"><thead><tr><th>N°</th><th>Client</th><th>Période</th><th>Équipements</th>
    <th class="num">Total</th><th>Statut</th><th></th></tr></thead><tbody>
    ${rows.map((r) => `<tr>
      <td data-label="N°">#${r.id}</td>
      <td data-label="Client">${esc(r.client)}<br><small>${esc(r.email)}</small></td>
      <td data-label="Période">${date(r.date_debut)} → ${date(r.date_fin)}<br><small>${r.nb_jours} jour(s)</small>
        ${retard && r.en_retard ? '<br><span class="badge b-retard">En retard</span>' : ''}</td>
      <td data-label="Équipements">${esc(r.resume)}</td>
      <td data-label="Total" class="num">${argent(r.montant_total)}</td>
      <td data-label="Statut">${badge(r.statut)}${r.statut_paiement ? `<br><small>Paiement : ${esc(libelle(r.statut_paiement))}</small>` : ''}
        ${r.demande_annulation ? '<br><small style="color:var(--alerte)">Annulation demandée</small>' : ''}</td>
      <td class="actions-cell">${actions(r)}<button class="btn btn-secondaire btn-petit" data-action="detail" data-id="${r.id}">Détail</button></td>
    </tr>`).join('')}</tbody></table>`;
}

const btn = (action, id, texte, classe = 'btn-petit') =>
  `<button class="btn ${classe}" data-action="${action}" data-id="${id}">${texte}</button>`;

const vues = {
  async attente() {
    const rows = await api('/gestion/reservations?statut=en_attente');
    return tableauReservations(rows, (r) => btn('valider', r.id, 'Valider', 'btn-succes btn-petit') + btn('refuser', r.id, 'Refuser', 'btn-danger btn-petit'));
  },
  async remise() {
    const rows = await api('/gestion/reservations?statut=confirmee');
    return `<p class="info" style="margin-top:0">La remise n'est possible que pour une réservation confirmée dont le paiement initial a été accepté.</p>`
      + tableauReservations(rows, (r) => (r.statut_paiement === 'accepte' && !r.demande_annulation ? btn('remise', r.id, 'Enregistrer la remise') : ''));
  },
  async cours() {
    const rows = await api('/gestion/reservations?statut=en_cours');
    return tableauReservations(rows, (r) => btn('retour', r.id, 'Enregistrer le retour') + btn('penalite', r.id, 'Pénalité', 'btn-secondaire btn-petit'), { retard: true });
  },
  async annulations() {
    const rows = await api('/gestion/reservations?annulation=1');
    return tableauReservations(rows, (r) => btn('annul-ok', r.id, 'Accepter', 'btn-succes btn-petit') + btn('annul-ko', r.id, 'Refuser', 'btn-danger btn-petit'));
  },
  async penalites() {
    const rows = await api('/gestion/penalites');
    if (!rows.length) return vide('Aucune pénalité enregistrée.');
    return `<table class="reactif"><thead><tr><th>Date</th><th>Réservation</th><th>Client</th><th>Type</th><th>Description</th>
      <th class="num">Montant</th><th>Statut</th><th></th></tr></thead><tbody>
      ${rows.map((p) => `<tr><td data-label="Date">${dateHeure(p.cree_le)}</td><td data-label="Réservation">#${p.reservation_id}</td>
        <td data-label="Client">${esc(p.client)}</td><td data-label="Type">${badge(p.type)}</td>
        <td data-label="Description">${esc(p.description || '')}</td><td data-label="Montant" class="num">${argent(p.montant)}</td>
        <td data-label="Statut">${badge(p.statut)}</td>
        <td class="actions-cell">${p.statut === 'non_reglee' ? btn('regler', p.id, 'Réglée au comptoir', 'btn-secondaire btn-petit') : ''}</td></tr>`).join('')}
      </tbody></table>`;
  },
  async materiel() {
    const rows = await api('/materiels');
    return `<table class="reactif"><thead><tr><th>Équipement</th><th>Catégorie</th><th class="num">Quantité</th><th>État actuel</th><th>Changer l'état</th></tr></thead><tbody>
      ${rows.map((m) => `<tr><td data-label="Équipement">${esc(m.nom)}</td><td data-label="Catégorie">${esc(m.categorie)}</td>
        <td data-label="Quantité" class="num">${m.quantite_totale}</td><td data-label="État">${badge(m.etat)}</td>
        <td data-label="Changer"><select data-etat="${m.id}" aria-label="État de ${esc(m.nom)}">
          ${['disponible', 'maintenance', 'hors_service'].map((e) => `<option value="${e}" ${m.etat === e ? 'selected' : ''}>${libelle(e)}</option>`).join('')}
        </select></td></tr>`).join('')}</tbody></table>`;
  },
  async toutes() {
    const p = new URLSearchParams(filtreToutes);
    const rows = await api('/gestion/reservations?' + p);
    return `<form id="filtre-toutes" class="ligne" style="margin-bottom:1rem">
        <input name="recherche" placeholder="Client, courriel ou n°" value="${esc(filtreToutes.recherche)}" style="max-width:280px">
        <select name="statut" style="max-width:220px"><option value="">Tous les statuts</option>
          ${['en_attente', 'validee', 'refusee', 'annulee', 'confirmee', 'en_cours', 'terminee']
            .map((s) => `<option value="${s}" ${filtreToutes.statut === s ? 'selected' : ''}>${libelle(s)}</option>`).join('')}</select>
        <button class="btn btn-secondaire">Filtrer</button></form>`
      + tableauReservations(rows, () => '', { retard: true });
  },
};

async function afficher() {
  onglets.querySelectorAll('button').forEach((b) => b.classList.toggle('actif', b.dataset.onglet === ongletActif));
  zone.innerHTML = '<p class="doux">Chargement…</p>';
  try { zone.innerHTML = await vues[ongletActif](); } catch (e) { zone.innerHTML = vide(esc(e.message)); }
  compteurs();
}

async function compteurs() {
  const [a, b, c, d] = await Promise.all([
    api('/gestion/reservations?statut=en_attente'), api('/gestion/reservations?statut=confirmee'),
    api('/gestion/reservations?statut=en_cours'), api('/gestion/reservations?annulation=1'),
  ]);
  const n = { attente: a.length, remise: b.length, cours: c.length, annulations: d.length };
  onglets.querySelectorAll('[data-n]').forEach((el) => { el.textContent = n[el.dataset.n] || ''; el.hidden = !n[el.dataset.n]; });
}

async function executer(promesse) {
  try {
    const r = await promesse;
    toast(r.message);
    fermerModale();
    afficher();
  } catch (e) { toast(e.message, 'erreur'); }
}

// Formulaire de retour : date, état, dommage, mise en maintenance
async function formulaireRetour(id) {
  const r = await api(`/reservations/${id}`);
  const corps = modale(`Retour – réservation n° ${id}`, `
    <form id="form-retour">
      <p>Fin prévue : <strong>${date(r.date_fin)}</strong>. Un retard est facturé automatiquement selon le tarif journalier.</p>
      <div class="champs">
        <div class="champ"><label for="dr">Date effective de retour</label>
          <input type="date" id="dr" name="date_retour_effective" value="${aujourdhui()}" max="${aujourdhui()}" min="${r.date_debut}" required></div>
        <div class="champ"><label for="et">État du matériel</label>
          <select id="et" name="etat_materiel"><option value="bon">Bon état</option><option value="endommage">Endommagé</option></select></div>
      </div>
      <div id="zone-dommage" class="cache">
        <div class="champ"><label for="md">Montant de la pénalité pour dommage ($)</label><input type="number" step="0.01" min="0" id="md" name="montant_dommage"></div>
        <div class="champ"><label>Équipements à mettre en maintenance</label>
          ${r.details.map((d) => `<label style="font-weight:400"><input type="checkbox" name="maint" value="${d.materiel_id}" style="width:auto"> ${esc(d.materiel)}</label>`).join('')}</div>
      </div>
      <div class="champ"><label for="obs">Observations</label><textarea id="obs" name="observations" rows="2" maxlength="255"></textarea></div>
      <button class="btn btn-bloc">Enregistrer le retour</button>
    </form>`);
  const f = corps.querySelector('form');
  f.etat_materiel.addEventListener('change', () => corps.querySelector('#zone-dommage').classList.toggle('cache', f.etat_materiel.value !== 'endommage'));
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const donnees = {
      date_retour_effective: f.date_retour_effective.value,
      etat_materiel: f.etat_materiel.value,
      observations: f.observations.value,
      montant_dommage: f.etat_materiel.value === 'endommage' ? Number(f.montant_dommage.value || 0) : 0,
      materiels_maintenance: f.etat_materiel.value === 'endommage' ? [...f.querySelectorAll('[name=maint]:checked')].map((c) => Number(c.value)) : [],
    };
    try {
      const res = await api(`/gestion/reservations/${id}/retour`, { methode: 'POST', corps: donnees });
      const total = res.penalites.reduce((s, p) => s + p.montant, 0);
      toast(res.penalites.length ? `Retour enregistré. Pénalité(s) : ${argent(total)}` : 'Retour enregistré, aucune pénalité.');
      fermerModale();
      afficher();
    } catch (err) { toast(err.message, 'erreur'); }
  });
}

function formulairePenalite(id) {
  const corps = modale(`Ajouter une pénalité – réservation n° ${id}`, `
    <form><div class="champs">
      <div class="champ"><label for="tp">Type</label><select id="tp" name="type"><option value="dommage">Dommage</option><option value="retard">Retard</option></select></div>
      <div class="champ"><label for="mt">Montant ($)</label><input type="number" id="mt" name="montant" step="0.01" min="0.01" required></div></div>
      <div class="champ"><label for="ds">Description</label><input id="ds" name="description" required maxlength="255"></div>
      <button class="btn btn-bloc">Enregistrer</button></form>`);
  corps.querySelector('form').addEventListener('submit', (e) => {
    e.preventDefault();
    const d = App.donneesFormulaire(e.target);
    executer(api(`/gestion/reservations/${id}/penalites`, { methode: 'POST', corps: { ...d, montant: Number(d.montant) } }));
  });
}

zone.addEventListener('click', (e) => {
  const b = e.target.closest('[data-action]');
  if (!b) return;
  const { action, id } = b.dataset;
  switch (action) {
    case 'detail': return App.afficherDetail(id);
    case 'valider': return executer(api(`/gestion/reservations/${id}/valider`, { methode: 'POST' }));
    case 'refuser': {
      const motif = prompt('Motif du refus :');
      if (motif) executer(api(`/gestion/reservations/${id}/refuser`, { methode: 'POST', corps: { motif } }));
      return;
    }
    case 'remise': {
      const observations = prompt('Observations sur la remise (facultatif) :', '');
      if (observations !== null) executer(api(`/gestion/reservations/${id}/remise`, { methode: 'POST', corps: { observations } }));
      return;
    }
    case 'retour': return formulaireRetour(id).catch((err) => toast(err.message, 'erreur'));
    case 'penalite': return formulairePenalite(id);
    case 'annul-ok':
      if (confirm('Accepter l\'annulation ? Le matériel sera libéré et le remboursement simulé.')) {
        executer(api(`/gestion/reservations/${id}/annulation`, { methode: 'POST', corps: { decision: 'accepter' } }));
      }
      return;
    case 'annul-ko': return executer(api(`/gestion/reservations/${id}/annulation`, { methode: 'POST', corps: { decision: 'refuser' } }));
    case 'regler':
      if (confirm('Confirmer le règlement de cette pénalité au comptoir ?')) executer(api(`/gestion/penalites/${id}/regler`, { methode: 'POST' }));
      return;
    default:
  }
});

zone.addEventListener('change', (e) => {
  const id = e.target.dataset.etat;
  if (id) executer(api(`/materiels/${id}/etat`, { methode: 'PATCH', corps: { etat: e.target.value } }));
});
zone.addEventListener('submit', (e) => {
  if (e.target.id !== 'filtre-toutes') return;
  e.preventDefault();
  filtreToutes = App.donneesFormulaire(e.target);
  afficher();
});
onglets.addEventListener('click', (e) => {
  const b = e.target.closest('[data-onglet]');
  if (b) { ongletActif = b.dataset.onglet; afficher(); }
});

if (exigerRole('responsable', 'administrateur')) afficher();
