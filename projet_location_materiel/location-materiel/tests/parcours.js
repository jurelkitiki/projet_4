// Test de bout en bout du parcours complet (serveur démarré + base initialisée avec npm run init-db).
// Utilisation : npm test
const BASE = process.env.API || 'http://localhost:3000/api';
let ok = 0;
let ko = 0;

function verifier(cond, libelle) {
  if (cond) { ok++; console.log('  ✔', libelle); } else { ko++; console.log('  ✘', libelle); }
}
async function api(methode, url, corps, jeton) {
  const res = await fetch(BASE + url, {
    method: methode,
    headers: { 'Content-Type': 'application/json', ...(jeton ? { Authorization: `Bearer ${jeton}` } : {}) },
    body: corps ? JSON.stringify(corps) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}
const jour = (decalage) => {
  const d = new Date(); d.setDate(d.getDate() + decalage);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const connexion = async (email) => (await api('POST', '/auth/connexion', { email, mot_de_passe: 'Motdepasse123!' })).data.jeton;
const CARTE_OK = { titulaire: 'Test', numero_carte: '4242 4242 4242 4242', expiration: '12/30', cvv: '123' };
const CARTE_KO = { ...CARTE_OK, numero_carte: '4000 0000 0000 0002' };

(async () => {
  console.log('Connexion des comptes de test');
  const client = await connexion('client@location.test');
  const client2 = await connexion('client2@location.test');
  const resp = await connexion('responsable@location.test');
  const admin = await connexion('admin@location.test');
  verifier(client && resp && admin && client2, 'jetons obtenus');

  console.log('Calcul du coût (exemple du cahier des charges)');
  const d1 = jour(3); const d2 = jour(5);
  const est = await api('POST', '/reservations/estimation', {
    date_debut: d1, date_fin: d2, articles: [{ materiel_id: 1, quantite: 2 }, { materiel_id: 4, quantite: 1 }] });
  verifier(est.data.nb_jours === 3, '3 jours');
  verifier(est.data.lignes?.[0].montant_ligne === 90 && est.data.lignes?.[1].montant_ligne === 30, 'lignes 90 $ et 30 $');
  verifier(est.data.montant_total === 120, 'total 120 $');

  console.log('Règles de gestion');
  let r = await api('POST', '/reservations', { date_debut: d2, date_fin: d1, articles: [{ materiel_id: 1, quantite: 1 }] }, client);
  verifier(r.status === 400, 'date de fin avant date de début refusée');
  r = await api('POST', '/reservations', { date_debut: d1, date_fin: d2, articles: [{ materiel_id: 5, quantite: 1 }] }, client);
  verifier(r.status === 409, 'matériel en maintenance non réservable');
  r = await api('POST', '/reservations', { date_debut: d1, date_fin: d2, articles: [{ materiel_id: 1, quantite: 11 }] }, client);
  verifier(r.status === 409, 'quantité supérieure au stock refusée');
  r = await api('POST', '/reservations', { date_debut: d1, date_fin: d2, articles: [{ materiel_id: 1, quantite: 1 }] }, resp);
  verifier(r.status === 403, 'un responsable ne peut pas créer de demande client');

  console.log('Parcours : demande → validation → paiement → remise → retour');
  r = await api('POST', '/reservations', { date_debut: jour(0), date_fin: jour(2), articles: [{ materiel_id: 1, quantite: 2 }, { materiel_id: 4, quantite: 1 }] }, client);
  verifier(r.status === 201, 'demande créée');
  const id = r.data.id;
  r = await api('POST', `/paiements/reservations/${id}`, CARTE_OK, client);
  verifier(r.status === 409, 'paiement impossible avant validation');
  r = await api('POST', `/gestion/reservations/${id}/remise`, {}, resp);
  verifier(r.status === 409, 'remise impossible avant paiement');
  r = await api('POST', `/gestion/reservations/${id}/valider`, {}, resp);
  verifier(r.status === 200, 'demande validée');
  r = await api('POST', `/paiements/reservations/${id}`, CARTE_KO, client);
  verifier(r.status === 402 && r.data.statut === 'refuse', 'carte de test refusée');
  r = await api('POST', `/paiements/reservations/${id}`, { ...CARTE_OK, numero_carte: '1234 5678 9012 3456' }, client);
  verifier(r.status === 400, 'numéro de carte invalide (Luhn) rejeté');
  r = await api('POST', `/paiements/reservations/${id}`, CARTE_OK, client);
  verifier(r.status === 201 && r.data.statut === 'accepte', 'paiement accepté');
  const paiementId = r.data.paiement_id;
  r = await api('GET', `/reservations/${id}`, null, client);
  verifier(r.data.statut === 'confirmee', 'réservation confirmée');
  r = await api('GET', `/paiements/${paiementId}/recu`, null, client);
  verifier(r.data.paiement?.montant === 120, 'reçu consultable (120 $)');
  r = await api('GET', `/paiements/${paiementId}/recu`, null, client2);
  verifier(r.status === 403, 'un autre client ne voit pas le reçu');

  console.log('Prévention des conflits sur une période qui se chevauche');
  r = await api('GET', `/materiels?debut=${jour(1)}&fin=${jour(1)}`);
  verifier(r.data.find((m) => m.id === 4).disponible_periode === 4, 'projecteurs : 4 sur 5 disponibles');
  r = await api('POST', '/reservations', { date_debut: jour(1), date_fin: jour(4), articles: [{ materiel_id: 1, quantite: 9 }] }, client2);
  verifier(r.status === 409, 'client2 ne peut pas réserver 9 portables (8 restants)');
  r = await api('POST', '/reservations', { date_debut: jour(1), date_fin: jour(4), articles: [{ materiel_id: 1, quantite: 8 }] }, client2);
  const id2 = r.data.id;
  verifier(r.status === 201, 'client2 réserve 8 portables');
  r = await api('POST', '/reservations', { date_debut: jour(2), date_fin: jour(2), articles: [{ materiel_id: 1, quantite: 1 }] }, client);
  const id3 = r.data.id;
  await api('POST', `/gestion/reservations/${id2}/valider`, {}, resp);
  r = await api('POST', `/gestion/reservations/${id3}/valider`, {}, resp);
  verifier(r.status === 409, 'validation refusée : stock bloqué par une autre demande validée');
  r = await api('POST', `/reservations/${id2}/annuler`, {}, client2);
  verifier(r.status === 200, 'client2 annule sa demande validée');
  r = await api('POST', `/gestion/reservations/${id3}/valider`, {}, resp);
  verifier(r.status === 200, 'le matériel libéré permet de valider la demande suivante');

  console.log('Remise et retour avec pénalités');
  r = await api('POST', `/gestion/reservations/${id}/remise`, { observations: 'Chargeurs inclus' }, resp);
  verifier(r.status === 200, 'remise enregistrée');
  r = await api('POST', `/gestion/reservations/${id}/retour`, { date_retour_effective: jour(0), etat_materiel: 'endommage',
    montant_dommage: 45, observations: 'Écran rayé', materiels_maintenance: [4] }, resp);
  verifier(r.status === 200 && r.data.penalites.length === 1 && r.data.penalites[0].montant === 45, 'retour + pénalité de dommage 45 $');
  r = await api('GET', '/materiels/4');
  verifier(r.data.etat === 'maintenance', 'projecteur endommagé mis en maintenance');
  r = await api('GET', `/reservations/${id}`, null, client);
  verifier(r.data.statut === 'terminee' && r.data.penalites[0].statut === 'non_reglee', 'réservation terminée, pénalité due');
  r = await api('POST', `/paiements/penalites/${r.data.penalites[0].id}`, CARTE_OK, client);
  verifier(r.status === 201, 'pénalité réglée en ligne');

  console.log('Demande de conseil');
  r = await api('POST', '/contact', { nom: 'Amélie Test', email: 'amelie@exemple.test', message: 'Trop court' });
  verifier(r.status === 201, 'demande de conseil envoyée sans compte');
  r = await api('POST', '/contact', { nom: '', email: 'pas-un-courriel', message: 'x' });
  verifier(r.status === 400, 'demande de conseil invalide refusée');
  r = await api('GET', '/admin/contacts', null, admin);
  verifier(r.status === 200 && r.data.length === 1, 'l\'administrateur voit la demande');
  r = await api('GET', '/admin/contacts', null, client);
  verifier(r.status === 403, 'un client ne voit pas les demandes de conseil');

  console.log('Administration');
  r = await api('GET', '/admin/statistiques', null, admin);
  verifier(r.data.revenus?.locations === 120 && r.data.revenus?.penalites === 45, 'revenus : 120 $ + 45 $ de pénalités');
  r = await api('GET', '/admin/statistiques', null, client);
  verifier(r.status === 403, 'statistiques interdites aux clients');
  r = await api('PUT', '/materiels/1', { nom: 'Ordinateur portable Dell Latitude 5440', categorie_id: 1, quantite_totale: 10, tarif_journalier: 16 }, admin);
  verifier(r.status === 200, 'modification du tarif');
  r = await api('GET', `/reservations/${id}`, null, client);
  verifier(r.data.details[0].tarif_applique === 15, 'les réservations existantes gardent leur tarif');
  await api('PUT', '/materiels/1', { nom: 'Ordinateur portable Dell Latitude 5440', categorie_id: 1, quantite_totale: 10, tarif_journalier: 15 }, admin);
  await api('PATCH', '/materiels/4/etat', { etat: 'disponible' }, resp);

  console.log(`\n${ok} réussi(s), ${ko} échec(s)`);
  process.exit(ko ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
