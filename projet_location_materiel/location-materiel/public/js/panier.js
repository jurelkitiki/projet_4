// Panier : dates, quantités, estimation du coût (calculée par le serveur) et envoi de la demande
const { api, esc, argent, toast, panier, session, aujourdhui, date } = App;
const debut = document.getElementById('debut');
const fin = document.getElementById('fin');
const zoneArticles = document.getElementById('articles');
const resume = document.getElementById('resume');
let estimation = null;

debut.min = fin.min = aujourdhui();

function sauverDates() {
  const p = panier.lire();
  p.date_debut = debut.value; p.date_fin = fin.value;
  panier.ecrire(p);
}

async function rafraichir() {
  const p = panier.lire();
  debut.value = p.date_debut || '';
  fin.value = p.date_fin || '';
  fin.min = debut.value || aujourdhui();

  if (!p.articles.length) {
    zoneArticles.innerHTML = '<div class="vide">Votre panier est vide. <a href="catalogue.html">Parcourir le catalogue</a></div>';
    resume.innerHTML = '<h2>Récapitulatif</h2><p class="doux">Aucun équipement sélectionné.</p>';
    return;
  }

  estimation = null;
  if (p.date_debut && p.date_fin && p.date_fin >= p.date_debut) {
    try {
      estimation = await api('/reservations/estimation', {
        methode: 'POST',
        corps: { date_debut: p.date_debut, date_fin: p.date_fin, articles: p.articles.map(({ materiel_id, quantite }) => ({ materiel_id, quantite })) },
      });
    } catch (e) { toast(e.message, 'erreur'); }
  }

  zoneArticles.innerHTML = `<table class="reactif"><thead><tr>
      <th>Équipement</th><th class="num">Tarif / jour</th><th>Quantité</th><th class="num">Montant</th><th></th></tr></thead><tbody>
    ${p.articles.map((a) => {
      const l = estimation?.lignes.find((x) => x.materiel_id === a.materiel_id);
      const alerte = l && !l.suffisant
        ? `<br><small style="color:var(--danger)">Seulement ${l.disponible} disponible(s) sur cette période</small>` : '';
      return `<tr>
        <td data-label="Équipement"><strong>${esc(a.nom)}</strong>${alerte}</td>
        <td data-label="Tarif / jour" class="num">${argent(l?.tarif_applique ?? a.tarif)}</td>
        <td data-label="Quantité"><input type="number" min="1" value="${a.quantite}" data-qte="${a.materiel_id}" style="width:80px" aria-label="Quantité"></td>
        <td data-label="Montant" class="num">${l ? argent(l.montant_ligne) : '—'}</td>
        <td class="actions-cell"><button class="btn-icone" data-retirer="${a.materiel_id}" aria-label="Retirer">🗑</button></td></tr>`;
    }).join('')}</tbody></table>`;

  const manque = estimation?.lignes.some((l) => !l.suffisant);
  const estConnecteClient = session.utilisateur?.role === 'client';
  resume.innerHTML = `<h2>Récapitulatif</h2>
    ${estimation ? `<dl>
        <dt>Période</dt><dd>${date(p.date_debut)} → ${date(p.date_fin)}</dd>
        <dt>Durée</dt><dd>${estimation.nb_jours} jour(s)</dd>
        <dt>Équipements</dt><dd>${panier.nombre()} unité(s)</dd>
      </dl>
      <p class="doux" style="font-size:.85rem;margin:.75rem 0 0">Montant = tarif journalier × nombre de jours × quantité</p>
      <div class="total"><span>Total</span><span>${argent(estimation.montant_total)}</span></div>
      <p class="doux" style="font-size:.8rem;margin:.25rem 0 1rem">Avant toute taxe applicable.</p>`
      : '<p class="avertissement">Choisissez une date de début et une date de fin pour calculer le coût.</p>'}
    ${manque ? '<p class="avertissement">Réduisez les quantités indiquées en rouge ou changez de dates.</p>' : ''}
    ${estConnecteClient
      ? `<button class="btn btn-bloc" id="envoyer" ${!estimation || manque ? 'disabled' : ''}>Envoyer la demande de location</button>`
      : '<a class="btn btn-bloc" href="connexion.html?retour=/panier.html">Se connecter pour réserver</a>'}
    <p class="doux" style="font-size:.82rem;margin-top:.75rem">La demande sera vérifiée par un responsable. Vous pourrez payer une fois qu'elle sera validée.</p>`;
}

zoneArticles.addEventListener('change', (e) => {
  const id = Number(e.target.dataset.qte);
  if (!id) return;
  const q = Math.max(1, Math.floor(Number(e.target.value) || 1));
  const p = panier.lire();
  p.articles.find((a) => a.materiel_id === id).quantite = q;
  panier.ecrire(p);
  rafraichir();
});
zoneArticles.addEventListener('click', (e) => {
  const id = Number(e.target.dataset.retirer);
  if (!id) return;
  const p = panier.lire();
  p.articles = p.articles.filter((a) => a.materiel_id !== id);
  panier.ecrire(p);
  rafraichir();
});
[debut, fin].forEach((el) => el.addEventListener('change', () => { sauverDates(); rafraichir(); }));

resume.addEventListener('click', async (e) => {
  if (e.target.id !== 'envoyer') return;
  const p = panier.lire();
  await App.enCours(e.target, async () => {
    try {
      const r = await api('/reservations', {
        methode: 'POST',
        corps: { date_debut: p.date_debut, date_fin: p.date_fin, articles: p.articles.map(({ materiel_id, quantite }) => ({ materiel_id, quantite })) },
      });
      panier.vider();
      toast(r.message);
      setTimeout(() => { location.href = 'mes-reservations.html'; }, 900);
    } catch (err) {
      toast(err.message, 'erreur');
      rafraichir();
    }
  });
});

rafraichir();
