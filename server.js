require("dotenv").config();
const express = require("express");
const path = require("path");
const http = require("http");
const os = require("os");
const { URL } = require("url");
const {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const WebSocket = require("ws");
const QRCode = require("qrcode");

const app = express();
const PORT = process.env.PORT || 3000;

const s3Client = new S3Client({
  endpoint: `https://${process.env.S3_ENDPOINT}`,
  region: "us-west-1",
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  },
  forcePathStyle: true,
});
const BUCKET_NAME = process.env.S3_BUCKET_NAME;

let rooms = {};

function generateRoomId() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let result = "";
  for (let i = 0; i < 4; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  if (rooms[result]) return generateRoomId();
  return result;
}

app.get("/api/songs", async (req, res) => {
  const params = { Bucket: BUCKET_NAME, Prefix: "MP4/" };
  try {
    const command = new ListObjectsV2Command(params);
    const data = await s3Client.send(command);
    const songsList = (data.Contents || [])
      .map((item) => item.Key)
      .filter((key) => key.toLowerCase().endsWith(".mp4") && key !== "MP4/")
      .map((key) => key.substring(4));

    const structuredSongs = {};
    songsList.forEach((filename) => {
      const parts = filename.split(" - ");
      if (parts.length < 2) return;
      const artist = parts[0].trim();
      let firstLetter = artist.charAt(0).toUpperCase();
      if (!isNaN(parseInt(firstLetter))) firstLetter = "#";

      if (!structuredSongs[firstLetter]) structuredSongs[firstLetter] = {};
      if (!structuredSongs[firstLetter][artist])
        structuredSongs[firstLetter][artist] = [];
      structuredSongs[firstLetter][artist].push(filename);
    });
    res.json(structuredSongs);
  } catch (error) {
    console.error("Error al listar y estructurar archivos:", error);
    res.status(500).json({ error: "No se pudieron obtener las canciones." });
  }
});

app.get("/api/song-url", async (req, res) => {
  const { song } = req.query;
  if (!song)
    return res
      .status(400)
      .json({ error: "Nombre de la canción no especificado." });
  const params = { Bucket: BUCKET_NAME, Key: `MP4/${song}` };
  try {
    const command = new GetObjectCommand(params);
    // CAMBIO AQUÍ: Duración de la URL prefirmada a 15 minutos (900 segundos)
    const url = await getSignedUrl(s3Client, command, { expiresIn: 900 });
    res.json({ url });
  } catch (error) {
    console.error("Error al generar la URL prefirmada:", error);
    res.status(500).json({ error: "No se pudo generar la URL de la canción." });
  }
});

app.post("/api/rooms", (req, res) => {
  const roomId = generateRoomId();
  rooms[roomId] = {
    songQueue: [],
    clients: new Set(),
  };
  console.log(`Sala creada: ${roomId}`);
  res.json({ roomId });
});

app.get("/api/qr", (req, res) => {
  const { sala } = req.query;
  if (!sala) return res.status(400).send("Falta el ID de la sala");

  let baseUrl;
  const isProduction = process.env.NODE_ENV === "production";
  if (isProduction && req.headers.host) {
    baseUrl = `https://${req.headers.host}`;
  } else {
    const networkInterfaces = os.networkInterfaces();
    let localIp = "localhost";
    const candidates = [];
    for (const name of Object.keys(networkInterfaces)) {
      for (const net of networkInterfaces[name]) {
        if (net.family === "IPv4" && !net.internal)
          candidates.push(net.address);
      }
    }
    if (candidates.length > 0) {
      localIp =
        candidates.find((ip) => ip.startsWith("192.168.")) ||
        candidates.find((ip) => ip.startsWith("10.")) ||
        candidates[0];
    }
    baseUrl = `http://${localIp}:${PORT}`;
  }

  const remoteUrl = `${baseUrl}/remote.html?sala=${sala}`;
  console.log(
    `✅ URL del control remoto generada para la sala ${sala}: ${remoteUrl}`
  );
  QRCode.toDataURL(remoteUrl, (err, url) => {
    if (err) res.status(500).send("Error generando QR");
    else res.send({ qrUrl: url, remoteUrl });
  });
});

app.get("/favicon.ico", (req, res) => res.status(204).send());
app.use(express.static(path.join(__dirname, "public")));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

function broadcastToRoom(roomId, data) {
  const room = rooms[roomId];
  if (room) {
    room.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    });
  }
}

wss.on("connection", (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const roomId = url.searchParams.get("sala");

  const room = rooms[roomId];
  if (!room) {
    console.log(`Intento de conexión a sala inexistente: ${roomId}`);
    ws.close();
    return;
  }

  ws.roomId = roomId;
  room.clients.add(ws);
  console.log(
    `Cliente conectado a la sala: ${roomId}. Total en sala: ${room.clients.size}`
  );

  ws.send(JSON.stringify({ type: "queueUpdate", payload: room.songQueue }));

  ws.on("message", (message) => {
    const data = JSON.parse(message);
    const currentRoom = rooms[ws.roomId];
    if (!currentRoom) return;

    let updateQueue = false;

    switch (data.type) {
      case "addSong":
        currentRoom.songQueue.push({ ...data.payload, id: Date.now() });
        updateQueue = true;
        break;
      case "removeSong":
        currentRoom.songQueue = currentRoom.songQueue.filter(
          (song) =>
            !(song.id === data.payload.id && song.name === data.payload.name)
        );
        updateQueue = true;
        break;
      case "playNext":
        if (currentRoom.songQueue.length > 0) currentRoom.songQueue.shift();
        updateQueue = true;
        break;
      case "controlAction":
        broadcastToRoom(ws.roomId, JSON.stringify(data));
        break;
      case "getQueue":
        ws.send(
          JSON.stringify({
            type: "queueUpdate",
            payload: currentRoom.songQueue,
          })
        );
        break;
      case "timeUpdate":
        broadcastToRoom(ws.roomId, JSON.stringify(data));
        break;
    }

    if (updateQueue) {
      broadcastToRoom(
        ws.roomId,
        JSON.stringify({ type: "queueUpdate", payload: currentRoom.songQueue })
      );
    }
  });

  ws.on("close", () => {
    const room = rooms[ws.roomId];
    if (room) {
      room.clients.delete(ws);
      console.log(
        `Cliente desconectado de la sala: ${ws.roomId}. Clientes restantes: ${room.clients.size}`
      );
      if (room.clients.size === 0) {
        console.log(`Sala ${ws.roomId} vacía. Eliminando sala.`);
        delete rooms[ws.roomId];
      }
    }
  });
});

server.listen(PORT, () =>
  console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`)
);
