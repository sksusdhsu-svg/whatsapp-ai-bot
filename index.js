import express from "express";
import pino from "pino";
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import { GoogleGenAI } from "@google/genai";
import fs from "node:fs";
import qrcode from "qrcode-terminal";

const PORT = process.env.PORT || 10000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const app = express();

app.get("/", (_req, res) => {
  res.send("🤖 WhatsApp AI Bot is running.");
});
app.get("/health", (_req, res) => {
  res.json({ ok: true, whatsapp: connected });
});
app.listen(PORT, "0.0.0.0", () => {
  console.log(`HTTP server listening on ${PORT}`);
});

if (!GEMINI_API_KEY) {
  console.error("❌ GEMINI_API_KEY is missing.");
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
let connected = false;
let sock;

const SYSTEM = `Tu es un assistant WhatsApp sympathique et naturel.
Réponds en français sauf si la personne écrit dans une autre langue.
Sois concis et facile à comprendre. Ne prétends pas être humain.
Ne donne pas de spam, de harcèlement ou de contenu dangereux.`;

async function askAI(text) {
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: `${SYSTEM}\n\nMessage reçu : ${text}`
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
    browser: ["WhatsApp AI Bot", "Chrome", "1.0.0"]
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      console.log("\n📱 QR CODE DISPONIBLE");
      console.log("Ouvre WhatsApp > Appareils connectés > Connecter un appareil.");
      console.log("Le QR est affiché ci-dessous :\n");
      qrcode.generate(qr, { small: true });
    }

    if (connection === "open") {
      connected = true;
      console.log("✅ WhatsApp connecté !");
    }

    if (connection === "close") {
      connected = false;
      const code = new Boom(lastDisconnect?.error)?.output?.statusCode;
      if (code !== DisconnectReason.loggedOut) {
        console.log("🔄 Connexion perdue, reconnexion...");
        setTimeout(startBot, 3000);
      } else {
        console.log("❌ Session WhatsApp déconnectée. Supprime ./auth et reconnecte.");
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
            text: "🤖 Commandes :\n/help — afficher l'aide\n/reset — recommencer la conversation\n\nSinon, écris-moi simplement ce que tu veux 😊"
          });
          continue;
        }

        if (text.trim().toLowerCase() === "/reset") {
          await sock.sendMessage(jid, { text: "✅ C'est fait. On repart de zéro !" });
          continue;
        }

        await sock.sendPresenceUpdate("composing", jid);
        const answer = await askAI(text);
        await sock.sendMessage(jid, { text: answer });
      } catch (err) {
        console.error("Erreur message:", err);
        await sock.sendMessage(jid, {
          text: "❌ Désolé, j'ai eu un problème avec l'IA. Réessaie dans un instant."
        }).catch(() => {});
      }
    }
  });
}

startBot().catch(err => {
  console.error("Erreur fatale:", err);
  process.exit(1);
});
