// Réservations du client : statut, paiement, annulation, détail
const { api, esc, argent, date, dateHeure, badge, toast, exigerRole } = App;
const zone = document.getElementById('liste');

async function charger() {
  let rows;
  try { rows = await api('/reservations/mes'); } catch (e) { zone.innerHTML = `<p>${esc(e.message)}</p>`; return; }
  if (!rows.length) {
    zone.innerHTML = '<div class="vide">Aucune réservation pour le moment. <a href="catalogue.html">Louer du matériel</a></div>';
    return;
  }
  zone.innerHTML = `<table class="reactif"><thead><tr><th>N°</th><th>Période</th><th>Équipements</th><th class="num">Total</th>
    <th>Statut</th><th>Paiement</th><th></th></tr></thead><tbody>
    ${rows.map((r) => {
      const actions = [`<button class="btn btn-secondaire btn-petit" data-detail="${r.id}">Détail</button>`];
      if (r.statut === 'validee') actions.unshift(`<a class="btn btn-succes btn-petit" href="paiement.html?reservation=${r.id}">Payer</a>`);
      if (['en_attente', 'validee'].includes(r.statut) || (r.statut === 'confirmee' && !r.demande_annulation)) {
        actions.push(`<button class="btn btn-danger btn-petit" data-annuler="${r.id}" data-statut="${r.statut}">Annuler</button>`);
      }
      const extra = [];
      if (r.statut === 'validee' && r.expiration_paiement) extra.push(`<small>Payer avant ${dateHeure(r.expiration_paiement).slice(11)}</small>`);
      if (r.demande_annulation) extra.push('<small>Annulation demandée</small>');
      if (r.penalites_dues > 0) extra.push(`<small style="color:var(--danger)">Pénalité due : ${argent(r.penalites_dues)}</small>`);
      return `<tr>
        <td data-label="N°">#${r.id}</td>
        <td data-label="Période">${date(r.date_debut)} → ${date(r.date_fin)}<br><small>${r.nb_jours} jour(s)</small></td>
        <td data-label="Équipements">${esc(r.resume)}</td>
        <td data-label="Total" class="num">${argent(r.montant_total)}</td>
        <td data-label="Statut">${badge(r.statut)}${extra.length ? '<br>' + extra.join('<br>') : ''}</td>
        <td data-label="Paiement">${r.statut_paiement ? badge(r.statut_paiement) : '<span class="doux">—</span>'}</td>
        <td class="actions-cell">${actions.join('')}</td></tr>`;
    }).join('')}</tbody></table>`;
}

zone.addEventListener('click', async (e) => {
  const detail = e.target.dataset.detail;
  if (detail) return App.afficherDetail(detail);

  const id = e.target.dataset.annuler;
  if (!id) return;
  const payee = e.target.dataset.statut === 'confirmee';
  const question = payee
    ? 'Cette réservation est déjà payée. Envoyer une demande d\'annulation au responsable ?'
    : 'Annuler cette réservation ?';
  if (!confirm(question)) return;
  const motif = prompt('Motif (facultatif) :') || '';
  try {
    const r = await api(`/reservations/${id}/annuler`, { methode: 'POST', corps: { motif } });
    toast(r.message);
    charger();
  } catch (err) { toast(err.message, 'erreur'); }
});

if (exigerRole('client')) charger();
