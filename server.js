require("dotenv").config();
const express = require("express");
const path = require("path");
const http = require("http");
const os = require("os"); // Módulo para obtener interfaces de red (solo para desarrollo local)
const {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const WebSocket = require("ws");
const QRCode = require("qrcode"); // Módulo para generar códigos QR

const app = express();
const PORT = process.env.PORT || 3000; // Usa el puerto de entorno o 3000 por defecto

// Configuración del cliente S3 para iDrive e2
const s3Client = new S3Client({
  endpoint: `https://${process.env.S3_ENDPOINT}`, // Endpoint de iDrive e2
  region: "us-west-1", // Tu región de iDrive e2
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  },
  forcePathStyle: true, // Importante para iDrive e2
});
const BUCKET_NAME = process.env.S3_BUCKET_NAME; // Nombre de tu bucket
let songQueue = []; // Cola de canciones global

// Endpoint para obtener la lista de canciones
app.get("/api/songs", async (req, res) => {
  const params = { Bucket: BUCKET_NAME, Prefix: "MP4/" }; // Prefijo para tus MP4
  try {
    const command = new ListObjectsV2Command(params);
    const data = await s3Client.send(command);
    // Filtra y mapea los nombres de archivo
    const songsList = (data.Contents || [])
      .map((item) => item.Key)
      .filter((key) => key.toLowerCase().endsWith(".mp4") && key !== "MP4/")
      .map((key) => key.substring(4)); // Quita el "MP4/" del inicio

    // Estructura las canciones por letra inicial del artista
    const structuredSongs = {};
    songsList.forEach((filename) => {
      const parts = filename.split(" - ");
      if (parts.length < 2) return; // Ignora archivos que no siguen el formato "Artista - Canción.mp4"
      const artist = parts[0].trim();
      let firstLetter = artist.charAt(0).toUpperCase();
      if (!isNaN(parseInt(firstLetter))) firstLetter = "#"; // Agrupa números bajo '#'

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

// Endpoint para obtener la URL prefirmada de una canción
app.get("/api/song-url", async (req, res) => {
  const { song } = req.query;
  if (!song)
    return res
      .status(400)
      .json({ error: "Nombre de la canción no especificado." });

  const params = { Bucket: BUCKET_NAME, Key: `MP4/${song}` }; // La clave completa en S3
  try {
    const command = new GetObjectCommand(params);
    // Genera una URL prefirmada válida por 1 hora (3600 segundos)
    const url = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
    res.json({ url });
  } catch (error) {
    console.error("Error al generar la URL prefirmada:", error);
    res.status(500).json({ error: "No se pudo generar la URL de la canción." });
  }
});

// Endpoint para generar el QR del control remoto
app.get("/api/qr", (req, res) => {
  let baseUrl;

  // Detecta si estamos en un entorno de hosting (como Render) usando el header 'host'
  // 'req.headers.host' contiene el dominio público (ej. xaraokemp4.onrender.com)
  if (req.headers.host) {
    // Para producción, siempre usamos HTTPS
    baseUrl = `https://${req.headers.host}`;
  } else {
    // Para desarrollo local, detecta la IP local
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
    baseUrl = `http://${localIp}:${PORT}`; // En local, usamos HTTP y el puerto local
  }

  const remoteUrl = `${baseUrl}/remote.html`; // Ruta a la interfaz remota
  console.log(`✅ URL del control remoto generada: ${remoteUrl}`);
  QRCode.toDataURL(remoteUrl, (err, url) => {
    if (err) res.status(500).send("Error generando QR");
    else res.send({ qrUrl: url, remoteUrl });
  });
});

// Sirve el favicon (para evitar errores 404 en el navegador)
app.get("/favicon.ico", (req, res) => res.status(204).send());

// Sirve archivos estáticos desde la carpeta 'public'
app.use(express.static(path.join(__dirname, "public")));

// Crea el servidor HTTP
const server = http.createServer(app);

// Configura el servidor WebSocket sobre el servidor HTTP
const wss = new WebSocket.Server({ server });

// Función para enviar un mensaje a todos los clientes WebSocket conectados
wss.broadcast = (data) =>
  wss.clients.forEach((c) => {
    if (c.readyState === WebSocket.OPEN) c.send(data);
  });

// Manejo de conexiones WebSocket
wss.on("connection", (ws) => {
  console.log("Cliente WebSocket conectado");
  // Al conectarse un nuevo cliente, le envía el estado actual de la cola
  ws.send(JSON.stringify({ type: "queueUpdate", payload: songQueue }));

  ws.on("message", (message) => {
    const data = JSON.parse(message);
    let updateQueue = false; // Flag para saber si la cola necesita ser actualizada a todos

    switch (data.type) {
      case "addSong":
        songQueue.push({ ...data.payload, id: Date.now() }); // Añade canción con ID único
        updateQueue = true;
        break;
      case "removeSong":
        // Elimina la canción por ID y nombre del usuario
        songQueue = songQueue.filter(
          (song) =>
            !(song.id === data.payload.id && song.name === data.payload.name)
        );
        updateQueue = true;
        break;
      case "playNext":
        if (songQueue.length > 0) songQueue.shift(); // Elimina la primera canción de la cola
        updateQueue = true;
        break;
      case "controlAction":
        // Reenvía las acciones de control (play/pausa/skip) a todos los clientes
        wss.broadcast(JSON.stringify(data));
        break;
      case "getQueue":
        // Solicita el estado actual de la cola (por ejemplo, al cambiar de nombre de usuario)
        ws.send(JSON.stringify({ type: "queueUpdate", payload: songQueue }));
        break;
      case "timeUpdate":
        // Reenvía las actualizaciones de tiempo de reproducción a todos los clientes
        wss.broadcast(JSON.stringify(data));
        break;
    }

    // Si la cola ha cambiado, notifica a todos los clientes
    if (updateQueue) {
      wss.broadcast(
        JSON.stringify({ type: "queueUpdate", payload: songQueue })
      );
    }
  });
});

// Inicia el servidor HTTP y WebSocket
server.listen(PORT, () =>
  console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`)
);
