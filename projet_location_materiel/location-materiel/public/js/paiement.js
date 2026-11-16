// Paiement simulé d'une location (?reservation=ID) ou d'une pénalité (?penalite=ID)
const { api, esc, argent, date, dateHeure, toast, exigerRole } = App;
const params = new URLSearchParams(location.search);
const reservationId = params.get('reservation');
const penaliteId = params.get('penalite');
const form = document.getElementById('form');
const erreur = document.getElementById('erreur');
const recap = document.getElementById('recap');

// Mise en forme automatique des champs
form.numero_carte.addEventListener('input', (e) => {
  e.target.value = e.target.value.replace(/\D/g, '').slice(0, 16).replace(/(\d{4})(?=\d)/g, '$1 ');
});
form.expiration.addEventListener('input', (e) => {
  const v = e.target.value.replace(/\D/g, '').slice(0, 4);
  e.target.value = v.length > 2 ? `${v.slice(0, 2)}/${v.slice(2)}` : v;
});
form.cvv.addEventListener('input', (e) => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 4); });

function lignesTableau(details) {
  return `<table class="reactif"><thead><tr><th>Équipement</th><th class="num">Qté</th><th class="num">Tarif/jour</th>
    <th class="num">Jours</th><th class="num">Montant</th></tr></thead><tbody>
    ${details.map((d) => `<tr><td data-label="Équipement">${esc(d.materiel)}</td><td data-label="Qté" class="num">${d.quantite}</td>
      <td data-label="Tarif/jour" class="num">${argent(d.tarif_applique)}</td><td data-label="Jours" class="num">${d.nb_jours}</td>
      <td data-label="Montant" class="num">${argent(d.montant_ligne)}</td></tr>`).join('')}</tbody></table>`;
}

async function chargerLocation() {
  const r = await api(`/reservations/${reservationId}`);
  document.getElementById('titre').textContent = `Paiement de la réservation n° ${r.id}`;
  document.getElementById('a-payer').textContent = argent(r.montant_total);
  recap.innerHTML = `<h2>Récapitulatif</h2>
    <p>Du <strong>${date(r.date_debut)}</strong> au <strong>${date(r.date_fin)}</strong> · ${r.nb_jours} jour(s)</p>
    <div class="tableau-wrap">${lignesTableau(r.details)}</div>
    <div class="total"><span>Total</span><span>${argent(r.montant_total)}</span></div>
    <p class="doux" style="font-size:.85rem">Montant avant toute taxe applicable.</p>`;
  if (r.statut !== 'validee') {
    form.querySelector('button').disabled = true;
    erreur.textContent = r.statut === 'confirmee'
      ? 'Cette réservation est déjà payée.'
      : 'Le paiement n\'est possible que pour une demande validée par le responsable.';
    erreur.classList.remove('cache');
  } else if (r.expiration_paiement) {
    const delai = document.getElementById('delai');
    delai.textContent = `Le matériel est réservé pour vous jusqu'à ${dateHeure(r.expiration_paiement).slice(11)}. Passé ce délai, la demande sera annulée.`;
    delai.classList.remove('cache');
  }
}

async function chargerPenalite() {
  const penalites = await api('/reservations/penalites');
  {
    const p = penalites.find((x) => String(x.id) === penaliteId);
    if (p) {
      document.getElementById('titre').textContent = 'Règlement d\'une pénalité';
      document.getElementById('a-payer').textContent = argent(p.montant);
      recap.innerHTML = `<h2>Pénalité – réservation n° ${p.reservation_id}</h2>
        <p>Type : <strong>${p.type === 'retard' ? 'Retard' : 'Dommage'}</strong></p>
        <p>${esc(p.description || '')}</p>
        <p class="doux">Cette pénalité est un montant supplémentaire, distinct du paiement initial de la location.</p>
        <div class="total"><span>Montant</span><span>${argent(p.montant)}</span></div>`;
      if (p.statut === 'reglee') { form.querySelector('button').disabled = true; toast('Cette pénalité est déjà réglée.'); }
      return;
    }
  }
  recap.innerHTML = '<p>Pénalité introuvable.</p>';
  form.querySelector('button').disabled = true;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  erreur.classList.add('cache');
  const url = reservationId ? `/paiements/reservations/${reservationId}` : `/paiements/penalites/${penaliteId}`;
  await App.enCours(form.querySelector('button'), async () => {
    try {
      const r = await api(url, { methode: 'POST', corps: App.donneesFormulaire(form) });
      form.reset();
      toast(r.message);
      setTimeout(() => { location.href = `recu.html?id=${r.paiement_id}`; }, 700);
    } catch (err) {
      // 402 = paiement refusé (simulation) ; l'utilisateur peut réessayer tant que le délai court
      erreur.textContent = err.message;
      erreur.classList.remove('cache');
      if (err.status === 410) form.querySelector('button').disabled = true;
    }
  });
});

if (exigerRole('client')) {
  (reservationId ? chargerLocation() : chargerPenalite()).catch((e) => { recap.innerHTML = `<p>${esc(e.message)}</p>`; });
}
