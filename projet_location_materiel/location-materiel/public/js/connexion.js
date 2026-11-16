const form = document.getElementById('form');
const erreur = document.getElementById('erreur');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  erreur.classList.add('cache');
  await App.enCours(form.querySelector('button'), async () => {
    try {
      const { jeton, utilisateur } = await App.api('/auth/connexion', { methode: 'POST', corps: App.donneesFormulaire(form) });
      App.session.ouvrir(jeton, utilisateur);
      const retour = new URLSearchParams(location.search).get('retour');
      const parDefaut = { client: 'index.html', responsable: 'responsable.html', administrateur: 'admin.html' }[utilisateur.role];
      // On n'accepte qu'un chemin local pour éviter les redirections externes
      location.href = retour && retour.startsWith('/') && !retour.startsWith('//') ? retour : parDefaut;
    } catch (err) {
      erreur.textContent = err.message;
      erreur.classList.remove('cache');
    }
  });
});
