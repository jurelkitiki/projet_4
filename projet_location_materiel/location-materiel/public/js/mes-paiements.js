// Historique des paiements du client + règlement des pénalités dues
const { api, esc, argent, dateHeure, badge, libelle, exigerRole } = App;
const zone = document.getElementById('liste');

async function charger() {
  const [paiements, penalites] = await Promise.all([api('/paiements/mes'), api('/reservations/penalites')]);

  // Pénalités non réglées, à payer en ligne
  const dues = penalites.filter((p) => p.statut === 'non_reglee');
  const blocDues = dues.length
    ? `<div class="avertissement" style="margin-bottom:1rem"><strong>Pénalités à régler</strong>
        ${dues.map((p) => `<div class="ligne espace" style="margin-top:.5rem">
          <span>Réservation #${p.reservation_id} · ${esc(libelle(p.type))} · ${esc(p.description || '')} · <strong>${argent(p.montant)}</strong></span>
          <a class="btn btn-petit" href="paiement.html?penalite=${p.id}">Payer</a></div>`).join('')}</div>`
    : '';

  if (!paiements.length) {
    zone.innerHTML = blocDues + '<div class="vide">Aucun paiement pour le moment.</div>';
    return;
  }
  zone.innerHTML = blocDues + `<table class="reactif"><thead><tr><th>Date</th><th>Réservation</th><th>Type</th><th>Référence</th>
    <th>Statut</th><th class="num">Montant</th><th></th></tr></thead><tbody>
    ${paiements.map((p) => `<tr>
      <td data-label="Date">${dateHeure(p.date_paiement)}</td>
      <td data-label="Réservation">#${p.reservation_id}</td>
      <td data-label="Type">${esc(libelle(p.type === 'location' ? 'Location' : 'Pénalité'))}</td>
      <td data-label="Référence"><code>${esc(p.reference)}</code></td>
      <td data-label="Statut">${badge(p.statut)}</td>
      <td data-label="Montant" class="num">${argent(p.montant)}</td>
      <td class="actions-cell">${p.statut === 'accepte' ? `<a class="btn btn-secondaire btn-petit" href="recu.html?id=${p.id}">Reçu</a>` : ''}</td>
    </tr>`).join('')}</tbody></table>`;
}

if (exigerRole('client')) charger().catch((e) => { zone.innerHTML = `<p>${esc(e.message)}</p>`; });
