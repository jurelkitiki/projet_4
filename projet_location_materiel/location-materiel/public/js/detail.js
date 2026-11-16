// Affiche le détail complet d'une réservation dans une fenêtre modale (client et responsable)
App.afficherDetail = async function afficherDetail(id) {
  const { api, esc, argent, date, dateHeure, badge, libelle, modale, toast } = App;
  let r;
  try { r = await api(`/reservations/${id}`); } catch (e) { return toast(e.message, 'erreur'); }

  const lignes = r.details.map((d) => `<tr>
      <td data-label="Équipement">${esc(d.materiel)}</td>
      <td data-label="Qté" class="num">${d.quantite}</td>
      <td data-label="Tarif" class="num">${argent(d.tarif_applique)}</td>
      <td data-label="Jours" class="num">${d.nb_jours}</td>
      <td data-label="Montant" class="num">${argent(d.montant_ligne)}</td></tr>`).join('');

  const paiements = r.paiements.length
    ? `<table class="reactif"><thead><tr><th>Date</th><th>Type</th><th>Référence</th><th>Statut</th><th class="num">Montant</th><th></th></tr></thead><tbody>
      ${r.paiements.map((p) => `<tr><td data-label="Date">${dateHeure(p.date_paiement)}</td><td data-label="Type">${esc(libelle(p.type))}</td>
        <td data-label="Référence"><code>${esc(p.reference)}</code></td><td data-label="Statut">${badge(p.statut)}</td>
        <td data-label="Montant" class="num">${argent(p.montant)}</td>
        <td class="actions-cell">${p.statut === 'accepte' ? `<a class="btn btn-secondaire btn-petit" href="recu.html?id=${p.id}">Reçu</a>` : ''}</td></tr>`).join('')}
      </tbody></table>`
    : '<p class="doux">Aucun paiement.</p>';

  const penalites = r.penalites.length
    ? `<table class="reactif"><tbody>${r.penalites.map((p) => `<tr><td data-label="Type">${badge(p.type)}</td>
        <td data-label="Description">${esc(p.description || '')}</td><td data-label="Statut">${badge(p.statut)}</td>
        <td data-label="Montant" class="num">${argent(p.montant)}</td></tr>`).join('')}</tbody></table>`
    : '<p class="doux">Aucune pénalité.</p>';

  modale(`Réservation n° ${r.id}`, `
    <div class="ligne espace" style="margin-bottom:1rem">${badge(r.statut)}
      <span class="doux">Demandée le ${dateHeure(r.cree_le)}</span></div>
    ${r.motif ? `<p class="avertissement">Motif : ${esc(r.motif)}</p>` : ''}
    ${r.demande_annulation ? '<p class="avertissement">Demande d\'annulation en attente de traitement.</p>' : ''}
    <p><strong>${esc(r.prenom)} ${esc(r.nom)}</strong> · ${esc(r.email)}${r.telephone ? ' · ' + esc(r.telephone) : ''}<br>
      Du <strong>${date(r.date_debut)}</strong> au <strong>${date(r.date_fin)}</strong> (${r.nb_jours} jour(s))</p>
    <div class="tableau-wrap"><table class="reactif"><thead><tr><th>Équipement</th><th class="num">Qté</th><th class="num">Tarif/jour</th>
      <th class="num">Jours</th><th class="num">Montant</th></tr></thead><tbody>${lignes}</tbody>
      <tfoot><tr><td colspan="4">Total</td><td class="num">${argent(r.montant_total)}</td></tr></tfoot></table></div>
    <h3 style="margin-top:1.25rem">Paiements</h3><div class="tableau-wrap">${paiements}</div>
    <h3 style="margin-top:1.25rem">Pénalités</h3>${penalites}
    ${r.remise ? `<p><strong>Remise :</strong> ${dateHeure(r.remise.date_remise)}${r.remise.observations ? ' – ' + esc(r.remise.observations) : ''}</p>` : ''}
    ${r.retour ? `<p><strong>Retour :</strong> ${date(r.retour.date_retour_effective)} – état ${esc(r.retour.etat_materiel === 'bon' ? 'bon' : 'endommagé')}
      ${r.retour.jours_retard ? ` – ${r.retour.jours_retard} jour(s) de retard` : ''}${r.retour.observations ? ' – ' + esc(r.retour.observations) : ''}</p>` : ''}
    <h3 style="margin-top:1.25rem">Historique</h3>
    <ul class="chronologie">${r.historique.map((h) => `<li><strong>${esc(h.action.replace(/_/g, ' ').toLowerCase())}</strong>
      <span class="doux">· ${dateHeure(h.date_action)}${h.auteur ? ' · ' + esc(h.auteur) : ''}</span>${h.details ? `<br>${esc(h.details)}` : ''}</li>`).join('')}</ul>`);
};
