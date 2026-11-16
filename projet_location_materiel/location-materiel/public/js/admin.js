// Administration : statistiques, parc et tarifs, catégories, utilisateurs, transactions, historique
const { api, esc, argent, date, dateHeure, badge, libelle, toast, modale, fermerModale, session, exigerRole } = App;
const zone = document.getElementById('contenu');
const onglets = document.getElementById('onglets');
let ongletActif = 'stats';
let categories = [];
let filtreTx = { statut: '', type: '' };

const pct = (x) => `${Math.round(x * 100)} %`;
const carte = (html) => `<div class="carte">${html}</div>`;

const vues = {
  async stats() {
    const s = await api('/admin/statistiques');
    const nb = (st) => s.reservations_par_statut.find((x) => x.statut === st)?.nb || 0;
    const penalDues = s.penalites.filter((p) => p.statut === 'non_reglee').reduce((t, p) => t + Number(p.montant), 0);
    const maxQte = Math.max(1, ...s.equipements_plus_demandes.map((m) => Number(m.quantite_louee)));
    return `
      <div class="kpis">
        <div class="carte kpi"><div class="etiquette">Revenus des locations</div><div class="valeur">${argent(s.revenus.locations)}</div></div>
        <div class="carte kpi"><div class="etiquette">Pénalités encaissées</div><div class="valeur">${argent(s.revenus.penalites)}</div></div>
        <div class="carte kpi"><div class="etiquette">Pénalités à encaisser</div><div class="valeur">${argent(penalDues)}</div></div>
        <div class="carte kpi"><div class="etiquette">Taux de disponibilité aujourd'hui</div><div class="valeur">${pct(s.taux_disponibilite_global)}</div></div>
        <div class="carte kpi"><div class="etiquette">Demandes en attente</div><div class="valeur">${nb('en_attente')}</div></div>
        <div class="carte kpi"><div class="etiquette">Locations en cours</div><div class="valeur">${nb('en_cours')}</div>
          ${s.locations_en_retard ? `<small style="color:var(--danger)">${s.locations_en_retard} en retard</small>` : ''}</div>
      </div>
      <div class="deux-col">
        ${carte(`<h2>Équipements les plus demandés</h2>${s.equipements_plus_demandes.length ? `<table class="reactif"><thead><tr><th>Équipement</th>
          <th class="num">Unités louées</th><th class="num">Réservations</th><th class="num">Revenus</th><th></th></tr></thead><tbody>
          ${s.equipements_plus_demandes.map((m) => `<tr><td data-label="Équipement">${esc(m.nom)}</td>
            <td data-label="Unités" class="num">${m.quantite_louee}</td><td data-label="Réservations" class="num">${m.nb_reservations}</td>
            <td data-label="Revenus" class="num">${argent(m.revenus)}</td>
            <td><div class="barre"><span style="width:${(m.quantite_louee / maxQte) * 100}%"></span></div></td></tr>`).join('')}</tbody></table>`
          : '<p class="doux">Pas encore de location confirmée.</p>'}`)}
        ${carte(`<h2>Réservations par statut</h2><table><tbody>
          ${s.reservations_par_statut.map((x) => `<tr><td>${badge(x.statut)}</td><td class="num">${x.nb}</td></tr>`).join('') || '<tr><td class="doux">Aucune</td></tr>'}
          </tbody></table>
          <h2 style="margin-top:1.25rem">Revenus par mois</h2><table><tbody>
          ${s.revenus_par_mois.map((m) => `<tr><td>${esc(m.mois)}</td><td class="num">${argent(m.montant)}</td></tr>`).join('') || '<tr><td class="doux">Aucun</td></tr>'}
          </tbody></table>
          ${s.revenus.rembourse ? `<p class="doux" style="font-size:.85rem">Remboursements simulés (annulations) : ${argent(s.revenus.rembourse)}</p>` : ''}`)}
      </div>
      ${carte(`<h2>Disponibilité du parc aujourd'hui</h2><div class="tableau-wrap"><table class="reactif"><thead><tr><th>Équipement</th><th>État</th>
        <th class="num">Total</th><th class="num">Sorties</th><th class="num">Disponibles</th><th>Taux</th></tr></thead><tbody>
        ${s.disponibilite.map((m) => `<tr><td data-label="Équipement">${esc(m.nom)}</td><td data-label="État">${badge(m.etat)}</td>
          <td data-label="Total" class="num">${m.quantite_totale}</td><td data-label="Sorties" class="num">${m.sorties}</td>
          <td data-label="Disponibles" class="num">${m.disponibles}</td>
          <td data-label="Taux"><div class="ligne"><div class="barre" style="flex:1"><span style="width:${m.taux * 100}%"></span></div>${pct(m.taux)}</div></td></tr>`).join('')}
        </tbody></table></div>`)}`;
  },

  async materiel() {
    const [rows, cats] = await Promise.all([api('/materiels'), api('/categories')]);
    categories = cats;
    return carte(`<div class="ligne espace" style="margin-bottom:1rem"><h2 style="margin:0">Parc d'équipements</h2>
        <button class="btn" data-action="nouveau-materiel">+ Ajouter un équipement</button></div>
      <div class="tableau-wrap"><table class="reactif"><thead><tr><th>Équipement</th><th>Catégorie</th><th class="num">Quantité</th>
        <th class="num">Tarif / jour</th><th>État</th><th></th></tr></thead><tbody>
        ${rows.map((m) => `<tr><td data-label="Équipement"><strong>${esc(m.nom)}</strong><br><small>${esc(m.description || '')}</small></td>
          <td data-label="Catégorie">${esc(m.categorie)}</td><td data-label="Quantité" class="num">${m.quantite_totale}</td>
          <td data-label="Tarif" class="num">${argent(m.tarif_journalier)}</td><td data-label="État">${badge(m.etat)}</td>
          <td class="actions-cell"><button class="btn btn-secondaire btn-petit" data-action="modifier-materiel" data-id="${m.id}">Modifier</button>
            <button class="btn btn-danger btn-petit" data-action="retirer-materiel" data-id="${m.id}">Retirer</button></td></tr>`).join('')}
      </tbody></table></div>`);
  },

  async categories() {
    categories = await api('/categories');
    return carte(`<div class="ligne espace" style="margin-bottom:1rem"><h2 style="margin:0">Catégories</h2>
        <button class="btn" data-action="nouvelle-categorie">+ Ajouter une catégorie</button></div>
      <table class="reactif"><thead><tr><th>Nom</th><th>Description</th><th class="num">Équipements</th><th></th></tr></thead><tbody>
        ${categories.map((c) => `<tr><td data-label="Nom"><strong>${esc(c.nom)}</strong></td><td data-label="Description">${esc(c.description || '')}</td>
          <td data-label="Équipements" class="num">${c.nb_materiels}</td>
          <td class="actions-cell"><button class="btn btn-secondaire btn-petit" data-action="modifier-categorie" data-id="${c.id}">Modifier</button>
            <button class="btn btn-danger btn-petit" data-action="supprimer-categorie" data-id="${c.id}">Supprimer</button></td></tr>`).join('')}
      </tbody></table>`);
  },

  async utilisateurs() {
    const rows = await api('/admin/utilisateurs');
    const moi = session.utilisateur.id;
    return carte(`<h2>Utilisateurs et rôles</h2><div class="tableau-wrap"><table class="reactif"><thead><tr><th>Nom</th><th>Courriel</th>
        <th>Inscrit le</th><th class="num">Réservations</th><th>Rôle</th><th>Compte</th></tr></thead><tbody>
      ${rows.map((u) => `<tr><td data-label="Nom">${esc(u.prenom)} ${esc(u.nom)}</td><td data-label="Courriel">${esc(u.email)}</td>
        <td data-label="Inscrit le">${date(u.cree_le)}</td><td data-label="Réservations" class="num">${u.nb_reservations}</td>
        <td data-label="Rôle">${u.id === moi ? badge(u.role) : `<select data-role="${u.id}" aria-label="Rôle">
          ${['client', 'responsable', 'administrateur'].map((r) => `<option value="${r}" ${u.role === r ? 'selected' : ''}>${libelle(r)}</option>`).join('')}</select>`}</td>
        <td data-label="Compte">${u.id === moi ? '<small>Vous</small>'
          : `<button class="btn btn-petit ${u.actif ? 'btn-danger' : 'btn-secondaire'}" data-action="basculer-actif" data-id="${u.id}" data-actif="${u.actif}">
              ${u.actif ? 'Désactiver' : 'Réactiver'}</button>`}</td></tr>`).join('')}
      </tbody></table></div>`);
  },

  async transactions() {
    const rows = await api('/admin/transactions?' + new URLSearchParams(filtreTx));
    const total = rows.filter((p) => p.statut === 'accepte').reduce((s, p) => s + Number(p.montant), 0);
    return carte(`<div class="ligne espace" style="margin-bottom:1rem"><h2 style="margin:0">Transactions</h2>
      <form id="filtre-tx" class="ligne">
        <select name="type" style="width:auto"><option value="">Tous les types</option>
          <option value="location" ${filtreTx.type === 'location' ? 'selected' : ''}>Locations</option>
          <option value="penalite" ${filtreTx.type === 'penalite' ? 'selected' : ''}>Pénalités</option></select>
        <select name="statut" style="width:auto"><option value="">Tous les statuts</option>
          ${['accepte', 'refuse', 'en_attente'].map((s) => `<option value="${s}" ${filtreTx.statut === s ? 'selected' : ''}>${libelle(s)}</option>`).join('')}</select>
        <button class="btn btn-secondaire">Filtrer</button></form></div>
      ${rows.length ? `<div class="tableau-wrap"><table class="reactif"><thead><tr><th>Date</th><th>Référence</th><th>Client</th><th>Réservation</th>
        <th>Type</th><th>Statut</th><th class="num">Montant</th><th></th></tr></thead><tbody>
        ${rows.map((p) => `<tr><td data-label="Date">${dateHeure(p.date_paiement)}</td><td data-label="Référence"><code>${esc(p.reference)}</code></td>
          <td data-label="Client">${esc(p.client)}</td><td data-label="Réservation">#${p.reservation_id} ${badge(p.statut_reservation)}</td>
          <td data-label="Type">${p.type === 'location' ? 'Location' : 'Pénalité'}</td><td data-label="Statut">${badge(p.statut)}</td>
          <td data-label="Montant" class="num">${argent(p.montant)}</td>
          <td class="actions-cell">${p.statut === 'accepte' ? `<a class="btn btn-secondaire btn-petit" href="recu.html?id=${p.id}">Reçu</a>` : ''}</td></tr>`).join('')}
        </tbody><tfoot><tr><td colspan="6">Total accepté (sélection)</td><td class="num">${argent(total)}</td><td></td></tr></tfoot></table></div>`
        : '<div class="vide">Aucune transaction.</div>'}`);
  },

  async contacts() {
    const rows = await api('/admin/contacts');
    return carte(`<h2>Demandes de conseil</h2><p class="sous-titre">Envoyées par les visiteurs avec le bouton « Demander conseil ». Répondez par courriel, puis marquez la demande comme traitée.</p>
      ${rows.length ? `<div class="tableau-wrap"><table class="reactif"><thead><tr><th>Reçue le</th><th>Contact</th><th>Besoin</th><th>Projet</th><th>Statut</th><th></th></tr></thead><tbody>
      ${rows.map((c) => `<tr><td data-label="Reçue le">${dateHeure(c.cree_le)}</td>
        <td data-label="Contact"><strong>${esc(c.nom)}</strong>${c.organisation ? `<br><small>${esc(c.organisation)}</small>` : ''}<br>
          <a href="mailto:${esc(c.email)}">${esc(c.email)}</a>${c.telephone ? `<br><small>${esc(c.telephone)}</small>` : ''}</td>
        <td data-label="Besoin">${c.date_debut ? `Dès le ${date(c.date_debut)}` : '<span class="doux">Date libre</span>'}${c.nb_jours ? `<br><small>${c.nb_jours} jour(s)</small>` : ''}</td>
        <td data-label="Projet" style="max-width:340px">${esc(c.message)}</td>
        <td data-label="Statut">${badge(c.statut)}</td>
        <td class="actions-cell"><button class="btn btn-secondaire btn-petit" data-action="statut-contact" data-id="${c.id}" data-statut="${c.statut === 'nouvelle' ? 'traitee' : 'nouvelle'}">
          ${c.statut === 'nouvelle' ? 'Marquer traitée' : 'Remettre à traiter'}</button></td></tr>`).join('')}</tbody></table></div>`
        : '<div class="vide">Aucune demande de conseil pour le moment.</div>'}`);
  },

  async historique() {
    const rows = await api('/admin/historique');
    return carte(`<h2>Dernières actions</h2>${rows.length ? `<div class="tableau-wrap"><table class="reactif"><thead><tr><th>Date</th><th>Action</th>
        <th>Réservation</th><th>Auteur</th><th>Détails</th></tr></thead><tbody>
      ${rows.map((h) => `<tr><td data-label="Date">${dateHeure(h.date_action)}</td><td data-label="Action"><code>${esc(h.action)}</code></td>
        <td data-label="Réservation">${h.reservation_id ? '#' + h.reservation_id : '—'}</td><td data-label="Auteur">${esc(h.auteur || 'Système')}</td>
        <td data-label="Détails">${esc(h.details || '')}</td></tr>`).join('')}</tbody></table></div>` : '<div class="vide">Aucune action.</div>'}`);
  },
};

async function afficher() {
  onglets.querySelectorAll('button').forEach((b) => b.classList.toggle('actif', b.dataset.onglet === ongletActif));
  zone.innerHTML = '<p class="doux">Chargement…</p>';
  try { zone.innerHTML = await vues[ongletActif](); } catch (e) { zone.innerHTML = carte(`<p>${esc(e.message)}</p>`); }
}

async function executer(promesse) {
  try { const r = await promesse; toast(r.message); fermerModale(); afficher(); return true; }
  catch (e) { toast(e.message, 'erreur'); return false; }
}

function formulaireMateriel(m = {}) {
  const corps = modale(m.id ? `Modifier – ${m.nom}` : 'Nouvel équipement', `<form>
    <div class="champ"><label for="fn">Nom</label><input id="fn" name="nom" required maxlength="120" value="${esc(m.nom || '')}"></div>
    <div class="champ"><label for="fd">Description</label><textarea id="fd" name="description" rows="2">${esc(m.description || '')}</textarea></div>
    <div class="champs">
      <div class="champ"><label for="fc">Catégorie</label><select id="fc" name="categorie_id" required>
        ${categories.map((c) => `<option value="${c.id}" ${m.categorie_id === c.id ? 'selected' : ''}>${esc(c.nom)}</option>`).join('')}</select></div>
      <div class="champ"><label for="fq">Quantité au parc</label><input type="number" id="fq" name="quantite_totale" min="0" required value="${m.quantite_totale ?? 1}"></div>
      <div class="champ"><label for="ft">Tarif journalier ($)</label><input type="number" id="ft" name="tarif_journalier" min="0" step="0.01" required value="${m.tarif_journalier ?? ''}"></div>
      <div class="champ"><label for="fe">État</label><select id="fe" name="etat">
        ${['disponible', 'loue', 'maintenance', 'hors_service'].map((e) => `<option value="${e}" ${(m.etat || 'disponible') === e ? 'selected' : ''}>${libelle(e)}</option>`).join('')}</select></div>
    </div>
    ${m.id ? '<p class="info">Un changement de tarif s\'applique aux nouvelles demandes ; les réservations existantes gardent leur tarif.</p>' : ''}
    <button class="btn btn-bloc" style="margin-top:1rem">${m.id ? 'Enregistrer' : 'Ajouter'}</button></form>`);
  corps.querySelector('form').addEventListener('submit', (e) => {
    e.preventDefault();
    const d = App.donneesFormulaire(e.target);
    d.categorie_id = Number(d.categorie_id); d.quantite_totale = Number(d.quantite_totale); d.tarif_journalier = Number(d.tarif_journalier);
    executer(m.id ? api(`/materiels/${m.id}`, { methode: 'PUT', corps: d }) : api('/materiels', { methode: 'POST', corps: d }));
  });
}

function formulaireCategorie(c = {}) {
  const corps = modale(c.id ? 'Modifier la catégorie' : 'Nouvelle catégorie', `<form>
    <div class="champ"><label for="cn">Nom</label><input id="cn" name="nom" required maxlength="80" value="${esc(c.nom || '')}"></div>
    <div class="champ"><label for="cd">Description</label><input id="cd" name="description" maxlength="255" value="${esc(c.description || '')}"></div>
    <button class="btn btn-bloc">${c.id ? 'Enregistrer' : 'Ajouter'}</button></form>`);
  corps.querySelector('form').addEventListener('submit', (e) => {
    e.preventDefault();
    const d = App.donneesFormulaire(e.target);
    executer(c.id ? api(`/categories/${c.id}`, { methode: 'PUT', corps: d }) : api('/categories', { methode: 'POST', corps: d }));
  });
}

zone.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-action]');
  if (!b) return;
  const id = Number(b.dataset.id);
  switch (b.dataset.action) {
    case 'nouveau-materiel': return formulaireMateriel();
    case 'modifier-materiel': return formulaireMateriel(await api(`/materiels/${id}`));
    case 'retirer-materiel':
      if (confirm('Retirer cet équipement du parc ? Il restera visible dans l\'historique des locations.')) executer(api(`/materiels/${id}`, { methode: 'DELETE' }));
      return;
    case 'nouvelle-categorie': return formulaireCategorie();
    case 'modifier-categorie': return formulaireCategorie(categories.find((c) => c.id === id));
    case 'supprimer-categorie':
      if (confirm('Supprimer cette catégorie ?')) executer(api(`/categories/${id}`, { methode: 'DELETE' }));
      return;
    case 'statut-contact':
      return executer(api(`/admin/contacts/${id}`, { methode: 'PATCH', corps: { statut: b.dataset.statut } }));
    case 'basculer-actif': {
      const actif = b.dataset.actif === '1';
      if (confirm(actif ? 'Désactiver ce compte ? L\'utilisateur ne pourra plus se connecter.' : 'Réactiver ce compte ?')) {
        executer(api(`/admin/utilisateurs/${id}`, { methode: 'PATCH', corps: { actif: !actif } }));
      }
      return;
    }
    default:
  }
});

zone.addEventListener('change', (e) => {
  const id = e.target.dataset.role;
  if (id) executer(api(`/admin/utilisateurs/${id}`, { methode: 'PATCH', corps: { role: e.target.value } }));
});
zone.addEventListener('submit', (e) => {
  if (e.target.id !== 'filtre-tx') return;
  e.preventDefault();
  filtreTx = App.donneesFormulaire(e.target);
  afficher();
});
onglets.addEventListener('click', (e) => {
  const b = e.target.closest('[data-onglet]');
  if (b) { ongletActif = b.dataset.onglet; afficher(); }
});

if (exigerRole('administrateur')) afficher();
