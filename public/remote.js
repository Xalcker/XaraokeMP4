document.addEventListener("DOMContentLoaded", () => {
  // --- Selectores de Elementos del DOM ---
  // Modal de nombre
  const nameModal = document.getElementById("name-modal");
  const mainContent = document.getElementById("main-content");
  const initialNameInput = document.getElementById("initialNameInput");
  const saveNameBtn = document.getElementById("saveNameBtn");
  // Interfaz principal
  const userNameDisplay = document.getElementById("userNameDisplay");
  const changeNameBtn = document.getElementById("changeNameBtn");
  const songQueueContainer = document.getElementById("songQueue");
  const songBrowser = document.getElementById("songBrowser");
  const currentSongTitle = document.getElementById("current-song-title");
  const currentSongTime = document.getElementById("current-song-time");
  const playPauseBtn = document.getElementById("playPauseBtn");
  const skipBtn = document.getElementById("skipBtn");
  const remoteRoomCodeDisplay = document.getElementById("remote-room-code");

  // --- Variables de Estado de la Aplicación ---
  let songData = {}; // Objeto con la lista de canciones estructurada
  let ws; // La conexión WebSocket
  let myName = ""; // Nombre del usuario actual
  let upNextSongId = null; // ID de la canción para la que ya se notificó
  let currentQueue = []; // Copia local de la cola de canciones
  let roomId = null; // ID de la sala actual

  // --- LÓGICA DE INICIALIZACIÓN Y GESTIÓN DE SALA/NOMBRE ---

  // Función principal que se ejecuta al cargar la página
  async function initializeAppFlow() {
    // Extrae el ID de la sala de los parámetros de la URL (ej. ?sala=ABCD)
    const urlParams = new URLSearchParams(window.location.search);
    roomId = urlParams.get("sala")?.toUpperCase();

    // Si no hay ID de sala, o es inválido, pide uno nuevo
    if (!roomId) {
      handleInvalidRoom("No se encontró código de sala.");
      return;
    }

    // Verifica si la sala existe en el servidor antes de continuar
    try {
      const response = await fetch(`/api/rooms/${roomId}`);
      const data = await response.json();
      if (!data.exists) {
        handleInvalidRoom(`La sala "${roomId}" no existe o ha expirado.`);
        return;
      }
    } catch (error) {
      console.error("Error verificando la sala:", error);
      handleInvalidRoom(
        "No se pudo conectar con el servidor para verificar la sala."
      );
      return;
    }

    // Si la sala es válida, la muestra en la UI y continúa con la configuración del nombre
    remoteRoomCodeDisplay.textContent = `SALA: ${roomId}`;
    setupName();
    // Si ya tenemos un nombre de usuario guardado, iniciamos la app principal
    if (myName) {
      initializeMainApp();
    }
  }

  // Muestra un error y pide un nuevo código de sala
  function handleInvalidRoom(message) {
    alert(message);
    let newRoomCode = prompt(
      "Por favor, introduce el código de 4 letras de la sala:",
      ""
    );
    if (newRoomCode && newRoomCode.trim().length === 4) {
      // Recarga la página con el nuevo código para reintentar la conexión
      window.location.search = `?sala=${newRoomCode.trim().toUpperCase()}`;
    } else {
      document.body.innerHTML =
        "<h1>Código inválido. Por favor, escanea el QR de nuevo.</h1>";
    }
  }

  // Carga el nombre de usuario desde localStorage o muestra el modal para introducirlo
  function setupName() {
    myName = localStorage.getItem("karaokeUserName") || "";
    if (myName) {
      userNameDisplay.textContent = `Usuario: ${myName}`;
      nameModal.classList.add("hidden");
      mainContent.classList.remove("hidden");
    } else {
      nameModal.classList.remove("hidden");
      mainContent.classList.add("hidden");
    }
  }

  // Se ejecuta al hacer clic en "Guardar" en el modal de nombre
  saveNameBtn.addEventListener("click", () => {
    const name = initialNameInput.value.trim();
    if (name) {
      localStorage.setItem("karaokeUserName", name);
      setupName();
      // Si es la primera vez (no hay WebSocket), inicia la app. Si no, solo pide la cola actualizada.
      if (!ws || ws.readyState === WebSocket.CLOSED) initializeMainApp();
      else if (ws.readyState === WebSocket.OPEN)
        ws.send(JSON.stringify({ type: "getQueue" }));
    } else {
      alert("Por favor, introduce un nombre válido.");
    }
  });

  // Se ejecuta al hacer clic en el botón de editar nombre
  changeNameBtn.addEventListener("click", () => {
    initialNameInput.value = myName; // Precarga el nombre actual
    nameModal.classList.remove("hidden"); // Muestra el modal
  });

  // --- LÓGICA DE WEBSOCKET Y CARGA DE DATOS ---

  // Establece la conexión WebSocket con el servidor para la sala actual
  function connectWebSocket() {
    if (!roomId) return;
    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    ws = new WebSocket(`${protocol}://${window.location.host}?sala=${roomId}`);

    ws.onopen = () =>
      console.log(`Remoto conectado al WebSocket de la sala: ${roomId}`);
    ws.onclose = (event) => {
      // Si la sala fue cerrada por el servidor, muestra el error
      if (event.code === 4004) {
        handleInvalidRoom("La sala ya no existe. Introduce un nuevo código.");
      } else {
        console.log(`Remoto desconectado. Intentando reconectar...`);
        setTimeout(connectWebSocket, 3000);
      }
    };
    // Maneja los mensajes entrantes del servidor
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.type === "queueUpdate") {
        renderQueue(message.payload);
        if (message.payload.length === 0) {
          currentSongTitle.textContent = "La cola está vacía";
          currentSongTime.textContent = "";
        }
      }
      if (message.type === "timeUpdate") {
        updateNowPlaying(message.payload);
        // Lógica de notificación
        const data = message.payload;
        if (!data || !data.duration) return;
        const remainingTime = data.duration - data.currentTime;
        if (remainingTime > 0 && remainingTime <= 10) {
          if (currentQueue.length > 1 && currentQueue[1].name === myName) {
            if (currentQueue[1].id !== upNextSongId) {
              upNextSongId = currentQueue[1].id;
              notifyUser();
            }
          }
        }
      }
    };
    ws.onerror = (error) =>
      console.error("Error de WebSocket en remoto:", error);
  }

  // Conecta el WebSocket y carga la lista de canciones
  async function initializeMainApp() {
    connectWebSocket();
    try {
      const songsRes = await fetch("/api/songs");
      songData = await songsRes.json();
      renderAlphabet();
    } catch (error) {
      console.error("Error cargando la lista de canciones:", error);
      songBrowser.innerHTML = "No se pudieron cargar las canciones.";
    }
  }

  // --- FUNCIONES DE RENDERIZADO Y UTILIDADES ---

  // Dibuja la cola de canciones en la UI
  function renderQueue(queue) {
    currentQueue = queue;
    songQueueContainer.innerHTML = "";
    // Muestra solo las canciones que están "en espera" (ignora la primera)
    queue.slice(1).forEach((item) => {
      const div = document.createElement("div");
      div.className = "queue-item";
      div.innerHTML = `<span><b>${item.song.replace(".mp4", "")}</b> (${
        item.name
      })</span>`;
      // Añade botón "Quitar" si la canción es del usuario actual
      if (item.name === myName && myName !== "") {
        const removeBtn = document.createElement("button");
        removeBtn.textContent = "Quitar";
        removeBtn.className = "remove-btn";
        removeBtn.onclick = () => {
          ws.send(
            JSON.stringify({
              type: "removeSong",
              payload: { id: item.id, name: myName },
            })
          );
        };
        div.appendChild(removeBtn);
      }
      songQueueContainer.appendChild(div);
    });
    // Reinicia el estado de notificación si la siguiente canción ya no es del usuario
    const nextSongIsMine = queue.length > 1 && queue[1].name === myName;
    if (!nextSongIsMine) {
      upNextSongId = null;
    }
  }

  // Actualiza la información de la canción que se está reproduciendo
  function updateNowPlaying(data) {
    if (!data || !data.song) {
      currentSongTitle.textContent = "La cola está vacía";
      currentSongTime.textContent = "";
      return;
    }
    const remainingTime = data.duration - data.currentTime;
    currentSongTitle.textContent = `Ahora suena: 🎵 ${data.song.replace(
      ".mp4",
      ""
    )}`;
    currentSongTime.textContent = `${formatTime(
      data.currentTime
    )} / ${formatTime(data.duration)} (Faltan ${formatTime(remainingTime)})`;
  }

  // Activa la vibración y el sonido de notificación
  function notifyUser() {
    console.log("¡Tu canción sigue en 10 segundos!");
    if ("vibrate" in navigator) navigator.vibrate([200, 100, 200]);
    const audio = new Audio("/notification.mp3");
    audio
      .play()
      .catch((e) =>
        console.error("No se pudo reproducir el sonido de notificación:", e)
      );
  }

  // Formatea segundos a un formato "minutos:segundos"
  function formatTime(seconds) {
    if (isNaN(seconds) || seconds < 0) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60)
      .toString()
      .padStart(2, "0");
    return `${mins}:${secs}`;
  }

  // --- FUNCIONES DEL EXPLORADOR DE CANCIONES ---
  function renderAlphabet() {
    songBrowser.innerHTML = "";
    const container = document.createElement("div");
    container.className = "alphabet-container";
    const alphabet = "#ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
    alphabet.forEach((letter) => {
      if (songData[letter]) {
        const letterEl = document.createElement("div");
        letterEl.className = "alphabet-item";
        letterEl.textContent = letter;
        letterEl.onclick = () => renderArtists(letter);
        container.appendChild(letterEl);
      }
    });
    songBrowser.appendChild(container);
  }

  function renderArtists(letter) {
    songBrowser.innerHTML = "";
    addBackButton(renderAlphabet);
    const artists = Object.keys(songData[letter]).sort();
    artists.forEach((artist) => {
      const artistEl = document.createElement("div");
      artistEl.className = "browser-item";
      artistEl.textContent = `🎤 ${artist}`;
      artistEl.onclick = () => renderSongs(letter, artist);
      songBrowser.appendChild(artistEl);
    });
  }

  function renderSongs(letter, artist) {
    songBrowser.innerHTML = "";
    addBackButton(() => renderArtists(letter));
    const songs = songData[letter][artist];
    songs.forEach((filename) => {
      const songTitle = filename.split(" - ")[1].replace(".mp4", "");
      const songEl = document.createElement("div");
      songEl.className = "browser-item";
      songEl.textContent = `🎵 ${songTitle}`;
      songEl.onclick = () => {
        if (!myName) {
          setupName();
          return;
        }
        if (confirm(`¿Añadir "${songTitle}" a la cola?`)) {
          ws.send(
            JSON.stringify({
              type: "addSong",
              payload: { song: filename, name: myName },
            })
          );
          renderAlphabet(); // Regresa al selector de letras
        }
      };
      songBrowser.appendChild(songEl);
    });
  }

  function addBackButton(onClickAction) {
    const backBtn = document.createElement("div");
    backBtn.className = "back-btn";
    backBtn.textContent = "← Volver";
    backBtn.onclick = onClickAction;
    songBrowser.appendChild(backBtn);
  }

  // --- EVENT LISTENERS DE LOS BOTONES DE CONTROL ---
  playPauseBtn.addEventListener("click", () => {
    if (currentQueue.length === 0) return;
    ws.send(
      JSON.stringify({
        type: "controlAction",
        payload: { action: "playPause" },
      })
    );
  });

  skipBtn.addEventListener("click", () => {
    if (currentQueue.length === 0) return;
    ws.send(
      JSON.stringify({ type: "controlAction", payload: { action: "skip" } })
    );
  });

  // Inicia el flujo de la aplicación al cargar la página
  initializeAppFlow();
});
