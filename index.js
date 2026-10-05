import express from "express";
import pino from "pino";

import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  Browsers
} from "@whiskeysockets/baileys";

import { Boom } from "@hapi/boom";
import { GoogleGenAI } from "@google/genai";

const PORT = process.env.PORT || 10000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const app = express();
app.use(express.urlencoded({ extended: true }));

let sock = null;
let connected = false;
let pairingCode = null;

app.get("/", (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>WhatsApp AI Bot</title>
<style>
body {
  font-family: Arial;
  background: #f3f4f6;
  text-align: center;
  padding: 40px 15px;
}
.box {
  background: white;
  max-width: 450px;
  margin: auto;
  padding: 30px;
  border-radius: 20px;
  box-shadow: 0 5px 20px #ddd;
}
input {
  width: 90%;
  padding: 15px;
  font-size: 18px;
  border: 1px solid #ccc;
  border-radius: 10px;
  margin: 15px 0;
}
button {
  width: 95%;
  padding: 15px;
  background: #25D366;
  color: white;
  border: 0;
  border-radius: 10px;
  font-size: 18px;
  font-weight: bold;
}
.code {
  font-size: 32px;
  font-weight: bold;
  letter-spacing: 5px;
  margin: 25px 0;
}
</style>
</head>
<body>
<div class="box">
<h1>🤖 WhatsApp AI Bot</h1>

${
  connected
    ? `
      <h2>✅ WhatsApp connecté !</h2>
      <p>Ton bot est prêt.</p>
    `
    : pairingCode
      ? `
        <h2>📱 Ton code</h2>
        <div class="code">${pairingCode}</div>
        <p>Sur ton téléphone :</p>
        <p><b>WhatsApp → Réglages → Appareils connectés → Connecter un appareil → Connecter avec un numéro de téléphone</b></p>
        <p>Entre ensuite le code ci-dessus.</p>
      `
      : `
        <h2>📱 Connecter WhatsApp</h2>
        <p>Entre ton numéro avec le code pays.</p>
        <p>Exemple France : <b>33612345678</b></p>
        <form method="POST" action="/pair">
          <input name="phone" type="tel" placeholder="33612345678" required>
          <br>
          <button type="submit">🔗 Générer le code</button>
        </form>
      `
}

</div>
</body>
</html>
`);
});

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    whatsapp: connected
  });
});

app.post("/pair", async (req, res) => {
  try {
    if (!sock) {
      return res.send("⏳ WhatsApp est encore en démarrage. Actualise dans quelques secondes.");
    }

    if (connected) {
      return res.send("✅ WhatsApp est déjà connecté.");
    }

    let phone = String(req.body.phone || "").replace(/\D/g, "");

    if (!phone) {
      return res.send("❌ Numéro invalide.");
    }

    if (phone.startsWith("0")) {
      phone = "33" + phone.substring(1);
    }

    if (!phone.startsWith("33")) {
      return res.send("❌ Pour la France, utilise par exemple : 33612345678");
    }

    console.log("📱 Demande de code pour :", phone);

    pairingCode = await sock.requestPairingCode(phone);

    console.log("📱 CODE WHATSAPP :", pairingCode);

    res.redirect("/");
  } catch (error) {
    console.error("❌ Erreur pairing :", error);
    pairingCode = null;
    res.send("❌ Impossible de générer le code. Actualise puis réessaie.");
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`HTTP server listening on ${PORT}`);
});

if (!GEMINI_API_KEY) {
  console.error("❌ GEMINI_API_KEY manquante.");
  process.exit(1);
}

const ai = new GoogleGenAI({
  apiKey: GEMINI_API_KEY
});

async function askAI(text) {
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: `
Tu es un assistant WhatsApp sympathique.
Réponds en français sauf si la personne parle une autre langue.
Réponds naturellement et simplement.

Message :
${text}
`
  });

  return response.text?.trim() || "Je n'ai pas réussi à répondre.";
}

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState("./auth");

  let version;

  try {
    ({ version } = await fetchLatestBaileysVersion());
  } catch {
    version = undefined;
  }

  sock = makeWASocket({
    auth: state,
    version,
    logger: pino({ level: "silent" }),
    markOnlineOnConnect: false,
    browser: Browsers.macOS("Chrome")
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async ({ connection, lastDisconnect }) => {

    if (connection === "open") {
      connected = true;
      pairingCode = null;
      console.log("✅ WHATSAPP CONNECTÉ !");
    }

    if (connection === "close") {
      connected = false;

      const code =
        new Boom(lastDisconnect?.error)?.output?.statusCode;

      if (code !== DisconnectReason.loggedOut) {
        console.log("🔄 Reconnexion...");
        setTimeout(startBot, 3000);
      } else {
        console.log("❌ WhatsApp déconnecté.");
      }
    }
  });

  sock.ev.on("messages.upsert", async ({ messages }) => {

    for (const msg of messages) {

      if (!msg.message || msg.key.fromMe) continue;

      const jid = msg.key.remoteJid;

      if (!jid || jid === "status@broadcast") continue;

      const text =
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        "";

      if (!text.trim()) continue;

      try {

        if (text.trim().toLowerCase() === "/help") {
          await sock.sendMessage(jid, {
            text:
`🤖 Commandes :

/help - aide
/reset - recommencer

Sinon écris-moi simplement ton message 😊`
          });
          continue;
        }

        if (text.trim().toLowerCase() === "/reset") {
          await sock.sendMessage(jid, {
            text: "✅ Conversation réinitialisée !"
          });
          continue;
        }

        await sock.sendPresenceUpdate("composing", jid);

        const answer = await askAI(text);

        await sock.sendMessage(jid, {
          text: answer
        });

      } catch (error) {

        console.error("❌ Erreur message :", error);

        await sock.sendMessage(jid, {
          text: "❌ Une erreur est survenue. Réessaie."
        }).catch(() => {});
      }
    }
  });
}

startBot().catch(error => {
  console.error("❌ Erreur fatale :", error);
  process.exit(1);
});
