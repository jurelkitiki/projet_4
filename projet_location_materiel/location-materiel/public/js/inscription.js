const form = document.getElementById('form');
const erreur = document.getElementById('erreur');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  erreur.classList.add('cache');
  const donnees = App.donneesFormulaire(form);
  if (donnees.mot_de_passe !== donnees.confirmation) {
    erreur.textContent = 'Les mots de passe ne correspondent pas.';
    erreur.classList.remove('cache');
    return;
  }
  delete donnees.confirmation;
  await App.enCours(form.querySelector('button'), async () => {
    try {
      const { jeton, utilisateur } = await App.api('/auth/inscription', { methode: 'POST', corps: donnees });
      App.session.ouvrir(jeton, utilisateur);
      location.href = 'index.html';
    } catch (err) {
      erreur.textContent = err.message;
      erreur.classList.remove('cache');
    }
  });
});
