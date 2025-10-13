// Carga las variables de entorno desde el archivo .env
require("dotenv").config();

// Importación de módulos necesarios
const express = require("express"); // Framework para crear el servidor web
const path = require("path"); // Módulo para trabajar con rutas de archivos
const http = require("http"); // Módulo para crear un servidor HTTP, necesario para WebSockets
const os = require("os"); // Módulo para obtener información del sistema operativo (interfaces de red)
const { URL } = require("url"); // Módulo para parsear URLs
const {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
} = require("@aws-sdk/client-s3"); // Clases del SDK de AWS para S3
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner"); // Función para crear URLs prefirmadas
const WebSocket = require("ws"); // Librería para el servidor de WebSockets
const QRCode = require("qrcode"); // Librería para generar códigos QR

// Inicialización de la aplicación Express
const app = express();
// Configuración del puerto: usa el del entorno (ej. Render) o 3000 para desarrollo local
const PORT = process.env.PORT || 3000;

// Configuración del cliente S3 para conectarse a un servicio compatible como iDrive e2
const s3Client = new S3Client({
  endpoint: `https://${process.env.S3_ENDPOINT}`,
  region: "us-west-1", // Puede ser cualquier región si tu endpoint es personalizado
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  },
  forcePathStyle: true,
});
const BUCKET_NAME = process.env.S3_BUCKET_NAME;

// Objeto para almacenar todas las salas de karaoke activas
let rooms = {};

// Función para generar un ID de sala aleatorio de 4 letras mayúsculas
function generateRoomId() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let result = "";
  for (let i = 0; i < 4; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  // Si el ID ya existe (muy improbable), genera uno nuevo recursivamente
  if (rooms[result]) return generateRoomId();
  return result;
}

// --- API Endpoints ---

// Endpoint para obtener la lista de canciones
app.get("/api/songs", async (req, res) => {
  const params = { Bucket: BUCKET_NAME, Prefix: "MP4/" };
  try {
    const command = new ListObjectsV2Command(params);
    const data = await s3Client.send(command);
    const songsList = (data.Contents || [])
      .map((item) => item.Key)
      .filter((key) => key.toLowerCase().endsWith(".mp4") && key !== "MP4/")
      .map((key) => key.substring(4));

    // Organiza la lista de canciones en un objeto estructurado por letra y artista
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
    res.json(structuredSongs); // Devuelve el objeto JSON
  } catch (error) {
    console.error("Error al listar y estructurar archivos:", error);
    res.status(500).json({ error: "No se pudieron obtener las canciones." });
  }
});

// Endpoint para obtener una URL prefirmada para una canción
app.get("/api/song-url", async (req, res) => {
  const { song } = req.query;
  if (!song)
    return res
      .status(400)
      .json({ error: "Nombre de la canción no especificado." });
  const params = { Bucket: BUCKET_NAME, Key: `MP4/${song}` };
  try {
    const command = new GetObjectCommand(params);
    // La URL generada es válida por 15 minutos (900 segundos)
    const url = await getSignedUrl(s3Client, command, { expiresIn: 900 });
    res.json({ url });
  } catch (error) {
    console.error("Error al generar la URL prefirmada:", error);
    res.status(500).json({ error: "No se pudo generar la URL de la canción." });
  }
});

// Endpoint para crear una nueva sala de karaoke
app.post("/api/rooms", (req, res) => {
  const roomId = generateRoomId();
  // Inicializa la sala con una cola vacía y un Set para los clientes
  rooms[roomId] = { songQueue: [], clients: new Set() };
  console.log(`Sala creada: ${roomId}`);
  res.json({ roomId }); // Devuelve el ID de la nueva sala
});

// Endpoint para verificar si una sala existe
app.get("/api/rooms/:roomId", (req, res) => {
  const { roomId } = req.params;
  // Devuelve true si la sala existe en el objeto 'rooms'
  if (rooms[roomId.toUpperCase()]) {
    res.json({ exists: true });
  } else {
    res.json({ exists: false });
  }
});

// Endpoint para generar el código QR
app.get("/api/qr", (req, res) => {
  const { sala } = req.query;
  if (!sala) return res.status(400).send("Falta el ID de la sala");

  let baseUrl;
  const isProduction = process.env.NODE_ENV === "production";

  // Construye la URL base dependiendo del entorno (producción o desarrollo)
  if (isProduction && req.headers.host) {
    baseUrl = `https://${req.headers.host}`; // ej. https://xaraokemp4.onrender.com
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
    baseUrl = `http://${localIp}:${PORT}`; // ej. http://192.168.1.10:3000
  }

  // Genera la URL completa para el remoto, incluyendo el ID de la sala
  const remoteUrl = `${baseUrl}/remote.html?sala=${sala}`;
  console.log(
    `✅ URL del control remoto generada para la sala ${sala}: ${remoteUrl}`
  );
  QRCode.toDataURL(remoteUrl, (err, url) => {
    if (err) res.status(500).send("Error generando QR");
    else res.send({ qrUrl: url, remoteUrl });
  });
});

// --- Configuración del Servidor ---

// Ignora las peticiones de favicon para evitar errores 404 en la consola
app.get("/favicon.ico", (req, res) => res.status(204).send());
// Sirve todos los archivos de la carpeta 'public' (index.html, karaoke.js, etc.)
app.use(express.static(path.join(__dirname, "public")));

// Crea el servidor HTTP y el servidor WebSocket
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Función para enviar mensajes a todos los clientes de una sala específica
function broadcastToRoom(roomId, data) {
  const room = rooms[roomId];
  if (room) {
    room.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) client.send(data);
    });
  }
}

// Lógica que se ejecuta cuando un nuevo cliente se conecta al WebSocket
wss.on("connection", (ws, req) => {
  // Extrae el ID de la sala de la URL de conexión (ej. ws://.../?sala=ABCD)
  const url = new URL(req.url, `http://${req.headers.host}`);
  const roomId = url.searchParams.get("sala");
  const room = rooms[roomId];

  // Si la sala no existe, cierra la conexión
  if (!room) {
    console.log(
      `Intento de conexión a sala inexistente: ${roomId}. Cerrando conexión.`
    );
    ws.close(4004, "Room not found");
    return;
  }

  // Asigna el ID de la sala a la conexión y añade el cliente a la sala
  ws.roomId = roomId;
  room.clients.add(ws);
  console.log(
    `Cliente conectado a la sala: ${roomId}. Total en sala: ${room.clients.size}`
  );

  // Envía la cola de canciones actual de la sala al nuevo cliente
  ws.send(JSON.stringify({ type: "queueUpdate", payload: room.songQueue }));

  // Lógica que se ejecuta cuando se recibe un mensaje de un cliente
  ws.on("message", (message) => {
    const data = JSON.parse(message);
    const currentRoom = rooms[ws.roomId];
    if (!currentRoom) return;

    let updateQueue = false; // Flag para determinar si se necesita notificar un cambio de cola

    // Procesa el mensaje según su tipo
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

    // Si la cola cambió, envía la nueva cola a todos en la sala
    if (updateQueue) {
      broadcastToRoom(
        ws.roomId,
        JSON.stringify({ type: "queueUpdate", payload: currentRoom.songQueue })
      );
    }
  });

  // Lógica que se ejecuta cuando un cliente se desconecta
  ws.on("close", () => {
    const room = rooms[ws.roomId];
    if (room) {
      room.clients.delete(ws); // Elimina al cliente de la sala
      console.log(
        `Cliente desconectado de la sala: ${ws.roomId}. Clientes restantes: ${room.clients.size}`
      );
      // Si no quedan clientes, elimina la sala para liberar memoria
      if (room.clients.size === 0) {
        console.log(`Sala ${ws.roomId} vacía. Eliminando sala.`);
        delete rooms[ws.roomId];
      }
    }
  });
});

// Inicia el servidor
server.listen(PORT, () =>
  console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`)
);
