document.addEventListener("DOMContentLoaded", () => {
  const nameModal = document.getElementById("name-modal");
  const mainContent = document.getElementById("main-content");
  const initialNameInput = document.getElementById("initialNameInput");
  const saveNameBtn = document.getElementById("saveNameBtn");
  const userNameDisplay = document.getElementById("userNameDisplay");
  const changeNameBtn = document.getElementById("changeNameBtn");
  const songQueueContainer = document.getElementById("songQueue");
  const songBrowser = document.getElementById("songBrowser");
  const currentSongTitle = document.getElementById("current-song-title");
  const currentSongTime = document.getElementById("current-song-time");
  const playPauseBtn = document.getElementById("playPauseBtn");
  const skipBtn = document.getElementById("skipBtn");

  let songData = {},
    ws,
    myName = "",
    upNextSongId = null,
    currentQueue = [];

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

  saveNameBtn.addEventListener("click", () => {
    const name = initialNameInput.value.trim();
    if (name) {
      localStorage.setItem("karaokeUserName", name);
      setupName();
      if (!ws) initializeMainApp();
      else if (ws.readyState === WebSocket.OPEN)
        ws.send(JSON.stringify({ type: "getQueue" }));
    } else {
      alert("Por favor, introduce un nombre válido.");
    }
  });

  changeNameBtn.addEventListener("click", () => {
    initialNameInput.value = myName;
    nameModal.classList.remove("hidden");
  });

  function connectWebSocket() {
    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    ws = new WebSocket(`${protocol}://${window.location.host}`);
    ws.onopen = () => console.log("Remoto conectado al WebSocket");
    ws.onclose = () => setTimeout(connectWebSocket, 3000);
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.type === "queueUpdate") {
        const queue = message.payload;
        renderQueue(queue);
        if (queue.length === 0) {
          currentSongTitle.textContent = "La cola está vacía";
          currentSongTime.textContent = "";
        }
      }
      if (message.type === "timeUpdate") {
        updateNowPlaying(message.payload);
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

  function renderQueue(queue) {
    currentQueue = queue;
    songQueueContainer.innerHTML = "";
    // CAMBIO AQUÍ: Usamos .slice(1) para mostrar solo a partir del segundo elemento.
    queue.slice(1).forEach((item) => {
      const div = document.createElement("div");
      div.className = "queue-item";
      div.innerHTML = `<span><b>${item.song.replace(".mp4", "")}</b> (${
        item.name
      })</span>`;
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
    const nextSongIsMine = queue.length > 1 && queue[1].name === myName;
    if (!nextSongIsMine) {
      upNextSongId = null;
    }
  }

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

  function formatTime(seconds) {
    if (isNaN(seconds) || seconds < 0) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60)
      .toString()
      .padStart(2, "0");
    return `${mins}:${secs}`;
  }

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
          renderArtists(letter);
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

  setupName();
  if (myName) {
    initializeMainApp();
  }
});
