# Publier le site sur GitHub

## Situation actuelle

Le site est un site statique simple :

- `index.html`
- `formation.html`
- `templates.html`
- `coaching.html`
- `styles.css`

Il peut etre publie gratuitement avec GitHub Pages.

Sur ce Mac, la commande `git` n'est pas encore disponible parce que les Command Line Tools d'Apple ne sont pas installes. Tu as donc deux options.

## Option 1 - Le plus simple : upload manuel sur GitHub

1. Va sur https://github.com
2. Cree un compte ou connecte-toi.
3. Clique sur `New repository`.
4. Nom du repository :

   `the-business-model-experiment`

5. Mets le repository en `Public`.
6. Ne coche pas forcement `Add a README`, car il existe deja dans le dossier.
7. Clique sur `Create repository`.
8. Sur la page du repository, clique sur `uploading an existing file`.
9. Glisse tous les fichiers du dossier `the-business-model-experiment` dans GitHub.
10. Clique sur `Commit changes`.

Ensuite :

1. Va dans `Settings`.
2. Va dans `Pages`.
3. Dans `Build and deployment`, choisis :
   - Source : `Deploy from a branch`
   - Branch : `main`
   - Folder : `/root`
4. Clique sur `Save`.

GitHub donnera une URL du type :

`https://ton-compte.github.io/the-business-model-experiment/`

## Option 2 - Installer Git sur le Mac

Si tu veux travailler proprement avec Git ensuite :

1. Ouvre le Terminal.
2. Tape :

   `xcode-select --install`

3. Accepte l'installation des Command Line Tools.
4. Une fois installe, la commande `git` devrait fonctionner.

Ensuite, Codex pourra t'aider a :

- initialiser le depot ;
- faire un commit ;
- connecter GitHub ;
- pousser les changements.

## Recommandation

Pour ton premier test, utilise l'option 1 : upload manuel GitHub.

C'est suffisant pour publier gratuitement une premiere version.

