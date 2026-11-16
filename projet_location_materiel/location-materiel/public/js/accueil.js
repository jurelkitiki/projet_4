// Page d'accueil : catégories dynamiques, recherche par dates, services et solutions
const { esc, argent, aujourdhui } = App;

// Illustrations décoratives
document.getElementById('collage').innerHTML =
  `<div class="d d1">${ILL.laptop}</div><div class="d d2">${ILL.tablet}</div><div class="d d3">${ILL.projector}</div><div class="d d4">${ILL.audio}</div>`;
document.getElementById('conseil-ill').innerHTML = ILL.laptop;

// Recherche : dates par défaut = demain → après-demain
const form = document.getElementById('recherche');
const plusJours = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
form.debut.min = form.fin.min = aujourdhui();
form.debut.value = plusJours(1);
form.fin.value = plusJours(3);
form.debut.addEventListener('change', () => { form.fin.min = form.debut.value; if (form.fin.value < form.debut.value) form.fin.value = form.debut.value; });
form.addEventListener('submit', (e) => {
  e.preventDefault();
  const p = new URLSearchParams();
  if (form.categorie.value) p.set('categorie', form.categorie.value);
  p.set('debut', form.debut.value);
  p.set('fin', form.fin.value);
  location.href = 'catalogue.html?' + p;
});

// Catégories : cartes de couleur + liste de la recherche
App.categoriesAvecPrix().then((cats) => {
  form.categorie.innerHTML += cats.map((c) => `<option value="${c.id}">${esc(c.nom)}</option>`).join('');
  document.getElementById('cats').innerHTML = cats.map((c, k) => `
    <a class="cat c-${k % 6}" href="catalogue.html?categorie=${c.id}">
      <h3>Location de ${esc(c.nom.toLowerCase())}</h3>
      <p>${esc(c.description || '')}</p>
      ${c.prix_min !== null ? `<span class="prix-cat">dès ${argent(c.prix_min)} / jour</span>` : ''}
      <span class="go" aria-hidden="true"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M4 12h15M13 6l6 6-6 6"/></svg></span>
      <div class="ci" aria-hidden="true">${illustration(c.nom)}</div>
    </a>`).join('') || '<p class="doux">Aucune catégorie pour le moment.</p>';
});

// Services compris dans chaque location
const SERVICES = [
  ['laptop', 'Réponse dans la journée', 'Chaque demande est vérifiée par un responsable du matériel, qui la valide ou vous explique pourquoi elle est refusée.'],
  ['tablet', 'Prix calculé à l\'avance', 'Tarif journalier × nombre de jours × quantité : le montant s\'affiche ligne par ligne avant même de réserver.'],
  ['projector', 'Matériel vérifié au retour', 'Chaque équipement est contrôlé à son retour. S\'il est endommagé, il passe en maintenance avant d\'être reloué.'],
  ['audio', 'Suivi en ligne et reçus', 'Statut de vos réservations, historique des paiements et reçus imprimables, directement dans votre compte.'],
];
document.getElementById('services').innerHTML = SERVICES.map(([i, h, p]) =>
  `<div class="serv"><div class="serv-img" aria-hidden="true">${ILL[i]}</div><h3>${h}<i></i></h3><p>${p}</p></div>`).join('');

// Solutions par usage
const SOLUTIONS = [
  ['laptop', 'Formation', 'Portables'], ['projector', 'Événementiel', 'Projecteurs'], ['audio', 'Examens et ateliers', 'Casques'],
  ['tablet', 'Nouveaux employés', 'Tablettes'], ['audio', 'Télétravail', 'Casques'], ['laptop', 'Test de matériel', 'Portables'],
  ['cable', 'Salles de réunion', 'Câbles'], ['tablet', 'Projets étudiants', 'Tablettes'],
];
document.getElementById('sol').innerHTML = SOLUTIONS.map(([i, n, c]) =>
  `<a class="sol" href="catalogue.html"><small>${c}</small><div class="si" aria-hidden="true">${ILL[i]}</div><h3>${n}</h3></a>`).join('');
