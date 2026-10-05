# 🤖 WhatsApp AI Bot

Bot WhatsApp + Gemini, prêt pour un hébergement Node.js.

## Ce qu'il fait
- Répond automatiquement aux messages WhatsApp avec Gemini.
- `/help` affiche les commandes.
- `/reset` permet de repartir de zéro.
- Endpoint `/health` pour vérifier que le serveur fonctionne.

## IMPORTANT
Ce projet utilise Baileys, une bibliothèque communautaire qui se connecte à WhatsApp Web. Elle n'est pas l'API officielle WhatsApp Business. Utilise le bot uniquement avec ton propre compte et sans spam/bulk messaging.

## Mise en ligne gratuite

### 1. Créer la clé Gemini
Va sur Google AI Studio et crée une clé API Gemini.
Ne mets jamais la clé dans le code ni sur GitHub.

### 2. Mettre le dossier sur GitHub
Crée un nouveau dépôt GitHub et envoie tous les fichiers de ce dossier.

### 3. Déployer sur Render
- New > Web Service
- Connecte ton dépôt
- Build Command: `npm install`
- Start Command: `npm start`
- Plan: Free
- Environment Variable:
  - Name: `GEMINI_API_KEY`
  - Value: ta clé Gemini
- Deploy

### 4. Connecter WhatsApp
Regarde les logs du service après le démarrage.
Si un QR est fourni, utilise WhatsApp > Appareils connectés > Connecter un appareil.

## Limitation du gratuit
Render Free peut mettre un service en veille après une période sans trafic et son système de fichiers local est éphémère. Ce projet n'est donc pas garanti 24/7 avec conservation de session sur un simple déploiement Free. Pour une vraie conservation de session après redémarrage, il faut ajouter un stockage externe (par exemple une base de données) ou utiliser une offre avec stockage persistant.

## Node
Baileys demande Node.js 20 ou plus.
