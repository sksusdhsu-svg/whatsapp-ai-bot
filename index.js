import express from "express";
import pino from "pino";
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import { GoogleGenAI } from "@google/genai";
import QRCode from "qrcode";

const PORT = process.env.PORT || 10000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const app = express();

let connected = false;
let currentQR = null;
let sock;

app.get("/", (_req, res) => {
  if (connected) {
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>WhatsApp AI Bot</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            text-align: center;
            padding: 40px;
            background: #f5f5f5;
          }
          .box {
            background: white;
            padding: 30px;
            border-radius: 20px;
            max-width: 500px;
            margin: auto;
          }
          .ok {
            color: #16a34a;
            font-size: 22px;
          }
        </style>
      </head>
      <body>
        <div class="box">
          <h1>🤖 WhatsApp AI Bot</h1>
          <p class="ok">✅ WhatsApp est connecté !</p>
          <p>Ton bot est prêt à recevoir des messages.</p>
        </div>
      </body>
      </html>
    `);
    return;
  }

  if (currentQR) {
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>Connecter WhatsApp</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            text-align: center;
            padding: 20px;
            background: #f5f5f5;
          }
          .box {
            background: white;
            padding: 25px;
            border-radius: 20px;
            max-width: 500px;
            margin: auto;
          }
          img {
            width: 100%;
            max-width: 400px;
            image-rendering: pixelated;
          }
          .refresh {
            margin-top: 15px;
            color: #666;
          }
        </style>
      </head>
      <body>
        <div class="box">
          <h1>📱 Connecter WhatsApp</h1>
          <p>Sur ton téléphone :</p>
          <p>
            <b>WhatsApp → Paramètres → Appareils connectés → Connecter un appareil</b>
          </p>

          <img src="${currentQR}" alt="QR Code WhatsApp">

          <p class="refresh">
            Si le QR ne fonctionne plus, actualise cette page.
          </p>
        </div>
      </body>
      </html>
    `);
    return;
  }

  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <meta http-equiv="refresh" content="3">
      <title>WhatsApp AI Bot</title>
    </head>
    <body style="font-family:Arial;text-align:center;padding:40px">
      <h1>🤖 WhatsApp AI Bot</h1>
      <p>⏳ Génération du QR code...</p>
      <p>Actualise dans quelques secondes.</p>
    </body>
    </html>
  `);
});

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    whatsapp: connected
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`HTTP server listening on ${PORT}`);
});

if (!GEMINI_API_KEY) {
  console.error("❌ GEMINI_API_KEY is missing.");
  process.exit(1);
}

const ai = new GoogleGenAI({
  apiKey: GEMINI_API_KEY
});

const SYSTEM = `
Tu es un assistant WhatsApp sympathique et naturel.
Réponds en français sauf si la personne écrit dans une autre langue.
Sois concis et facile à comprendre.
Ne prétends pas être humain.
Ne donne pas de spam, de harcèlement ou de contenu dangereux.
`;

async function askAI(text) {
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: `${SYSTEM}\n\nMessage reçu : ${text}`
  });

  return response.text?.trim() || "Je n'ai pas réussi à répondre.";
}

async function startBot() {
  const { state, saveCreds } =
    await useMultiFileAuthState("./auth");

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
    browser: ["WhatsApp AI Bot", "Chrome", "1.0.0"]
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on(
    "connection.update",
    async ({ connection, lastDisconnect, qr }) => {

      if (qr) {
        console.log("📱 Nouveau QR WhatsApp disponible.");

        try {
          currentQR = await QRCode.toDataURL(qr);
          console.log("✅ QR code disponible sur la page web.");
        } catch (err) {
          console.error("Erreur génération QR:", err);
        }
      }

      if (connection === "open") {
        connected = true;
        currentQR = null;
        console.log("✅ WhatsApp connecté !");
      }

      if (connection === "close") {
        connected = false;

        const code =
          new Boom(lastDisconnect?.error)?.output?.statusCode;

        if (code !== DisconnectReason.loggedOut) {
          console.log("🔄 Connexion perdue, reconnexion...");

          setTimeout(() => {
            startBot();
          }, 3000);
        } else {
          console.log(
            "❌ Session WhatsApp déconnectée."
          );
        }
      }
    }
  );

  sock.ev.on("messages.upsert", async ({ messages }) => {

    for (const msg of messages) {

      if (!msg.message || msg.key.fromMe) {
        continue;
      }

      const jid = msg.key.remoteJid;

      if (!jid || jid === "status@broadcast") {
        continue;
      }

      const text =
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        "";

      if (!text.trim()) {
        continue;
      }

      try {

        if (text.trim().toLowerCase() === "/help") {

          await sock.sendMessage(jid, {
            text:
              "🤖 Commandes :\n" +
              "/help — afficher l'aide\n" +
              "/reset — recommencer la conversation\n\n" +
              "Sinon, écris-moi simplement ce que tu veux 😊"
          });

          continue;
        }

        if (text.trim().toLowerCase() === "/reset") {

          await sock.sendMessage(jid, {
            text: "✅ C'est fait. On repart de zéro !"
          });

          continue;
        }

        await sock.sendPresenceUpdate(
          "composing",
          jid
        );

        const answer = await askAI(text);

        await sock.sendMessage(jid, {
          text: answer
        });

      } catch (err) {

        console.error("Erreur message:", err);

        await sock.sendMessage(jid, {
          text:
            "❌ Désolé, j'ai eu un problème avec l'IA. Réessaie dans un instant."
        }).catch(() => {});

      }
    }
  });
}

startBot().catch(err => {
  console.error("Erreur fatale:", err);
  process.exit(1);
});
