# Kit d'intégration — Formulaire web → Zammad (docker-compose officiel)

Ce kit **ajoute un formulaire web** (hébergé à part) au **projet `zammad-docker-compose` officiel** et **injecte tous vos champs** dans les tickets Zammad via l'API, y compris les fichiers joints.

```bash
# 0) cloner le dossier en https ou ssh
git clone https://github.com/CentipedeRTK/ticket-management-zammad.git
git clone git@github.com:CentipedeRTK/ticket-management-zammad.git
cd ticket-management-zammad

# 1) Copier le .env et saisir votre token
cp .env.form.dist .env.form
$EDITOR .env.form   # ZAMMAD_TOKEN=...

# 2) Démarrer Zammad si ce n'est pas déjà fait
docker compose -f docker-compose.yml --env-file .env.form up -d

# 3) Se connecter à l'interface
* Se connecter à localhost:8080
* créer une nouvelle infra
* renseigner ses identifiants
* nom et logo
* mail: passer
* Connecter des canaux: passer

* cliquer sur le logo du profil > Profil
* Jeton d accès > créer les jetons avec les bons droits

* copier les jetons et es coller dans .env.form sur:
  * ZAMMAD_ADMIN_TOKEN
  * ZAMMAD_SUBMIT_TOKEN

* revenir dans la console ssh

# 4) Démarrer le formulaire + bootstrap
docker compose -f docker-compose.yml -f zammad-form-kit/docker-compose.override.yml --env-file .env.form up -d --build zammad-bootstrap form-api form-web
```

- Formulaire : http://localhost:9899
- Zammad (par défaut) : http://localhost:8080

> Le service `zammad-bootstrap` crée le **groupe** choisi et les **attributs personnalisés** requis (`mount_point`, `country_alpha3`, `latitude`, `longitude`, `epoch`, `e_h`, `e_e`, `organization`, `contact_name`, `notes`,...) puis exécute les **migrations**. Vous pouvez en ajouter d'autres ensuite (via Admin → Objets) et ils seront pris en charge **automatiquement** par l'API (clé = nom du champ).

# 3) Appliquer des modifications

## Personnaliser le formulaire

```bash
# 4) Appliquer des modifications du Formulaire
docker compose -f docker-compose.yml -f zammad-form-kit/docker-compose.override.yml --env-file .env.form kill form-api form-web
docker compose -f docker-compose.yml -fs zammad-form-kit/docker-compose.override.yml --env-file .env.form rm form-api form-web
docker compose -f docker-compose.yml -f zammad-form-kit/docker-compose.override.yml --env-file .env.form build --no-cache form-api form-web
docker compose -f docker-compose.yml -f zammad-form-kit/docker-compose.override.yml --env-file .env.form up -d form-api form-web
docker compose -f docker-compose.yml -f zammad-form-kit/docker-compose.override.yml --env-file .env.form logs -f form-api
```

## Sécurité / Bonnes pratiques
- Créez un **compte API dédié** avec des droits limités au groupe cible (principe du moindre privilège).  
- Ajoutez un **reverse proxy** HTTPS en frontal (Caddy/Traefik/Nginx) si vous exposez le formulaire.  
- Limitez la taille et le type de fichiers joints dans `form-api/server.js` (multer).  
- Activez reCAPTCHA côté formulaire si besoin (non inclus par défaut).

## Comment ça marche ?
- `form-web` sert l'UI statique et **proxy** `/api/*` vers `form-api` (pas de CORS navigateur).
- `form-api` reçoit le POST, crée le ticket avec `article.type=web`, ajoute vos **attributs** au même niveau que les champs natifs, puis poste une note avec les **pièces jointes** (base64).
- `zammad-bootstrap` prépare le terrain (groupe + attributs + migrations).

## Références
- Limites du **Form** natif (pas de champs custom) : admin-docs › Channels › Web › Form → Limitations.  
- Gestion des **Objets / attributs** par l’API + migrations.  
- Création de **tickets** / **articles** (avec pièces jointes) par l’API.
