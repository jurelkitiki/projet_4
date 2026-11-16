// Reçu / confirmation de paiement consultable et imprimable
const { api, esc, argent, date, dateHeure, badge, exigerRole } = App;
const zone = document.getElementById('recu');
const id = new URLSearchParams(location.search).get('id');

async function charger() {
  const { paiement: p, reservation: r, penalite } = await api(`/paiements/${id}/recu`);
  const lignes = penalite
    ? `<tr><td>Pénalité (${penalite.type === 'retard' ? 'retard' : 'dommage'}) – ${esc(penalite.description || '')}</td><td class="num">${argent(penalite.montant)}</td></tr>`
    : r.details.map((d) => `<tr><td>${esc(d.materiel)}<br><small>${d.quantite} × ${argent(d.tarif_applique)} × ${d.nb_jours} jour(s)</small></td>
        <td class="num">${argent(d.montant_ligne)}</td></tr>`).join('');

  zone.innerHTML = `
    <div class="recu-tete">
      <div><div class="logo"><span class="logo-marque">◧</span> LocaTech</div>
        <small>Location de matériel informatique</small></div>
      <div style="text-align:right"><h2 style="margin:0">${p.statut === 'accepte' ? 'Reçu de paiement' : 'Avis de transaction'}</h2>
        <small>Référence <code>${esc(p.reference)}</code></small><br>${badge(p.statut)}</div>
    </div>
    <div class="ligne espace" style="align-items:flex-start;margin-bottom:1rem">
      <div><strong>Client</strong><br>${esc(r.prenom)} ${esc(r.nom)}<br>${esc(r.email)}</div>
      <div style="text-align:right"><strong>Réservation n° ${r.id}</strong><br>Du ${date(r.date_debut)} au ${date(r.date_fin)}<br>
        Payé le ${dateHeure(p.date_paiement)}</div>
    </div>
    <table><thead><tr><th>Description</th><th class="num">Montant</th></tr></thead><tbody>${lignes}</tbody>
      <tfoot><tr><td>Total payé</td><td class="num">${argent(p.montant)}</td></tr></tfoot></table>
    <p class="doux" style="font-size:.82rem;margin-top:1.5rem">Mode : paiement simulé (${p.mode === 'comptoir_simule' ? 'comptoir' : 'carte'}).
      Aucune transaction bancaire réelle n'a été effectuée et aucune donnée de carte n'a été conservée. Montants avant toute taxe applicable.</p>`;
}

if (exigerRole()) charger().catch((e) => { zone.innerHTML = `<p>${esc(e.message)}</p>`; });
