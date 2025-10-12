document.addEventListener("DOMContentLoaded", () => {
  const welcomeModal = document.getElementById("welcome-modal");
  const startBtn = document.getElementById("start-btn");
  const mainContainer = document.querySelector(".main-container");
  const player = document.getElementById("karaokePlayer");

  const nowPlayingContent = document.getElementById("now-playing-content");
  const upNextContent = document.getElementById("up-next-content");
  const songQueueContainer = document.getElementById("songQueue");
  const qrCodeImg = document.getElementById("qrCode");
  const roomCodeDisplay = document.getElementById("room-code");

  let currentQueue = [],
    ws,
    lastTimeUpdate = 0;
  let roomId = null;

  startBtn.addEventListener("click", async () => {
    welcomeModal.classList.add("hidden");
    mainContainer.classList.remove("hidden");
    player.play().catch((e) => console.log("Permiso de audio concedido."));
    player.pause();
    try {
      const response = await fetch("/api/rooms", { method: "POST" });
      const data = await response.json();
      roomId = data.roomId;
      roomCodeDisplay.textContent = roomId;
      connectWebSocket();
      initialize();
    } catch (error) {
      console.error("No se pudo crear la sala:", error);
      alert("Error al crear la sala. Por favor, refresca la página.");
    }
  });

  function connectWebSocket() {
    if (!roomId) return;
    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    ws = new WebSocket(`${protocol}://${window.location.host}?sala=${roomId}`);

    ws.onopen = () => console.log(`Host conectado a la sala: ${roomId}`);
    ws.onclose = () => setTimeout(connectWebSocket, 3000);
    ws.onerror = (err) => console.error("Error de WebSocket en Host:", err);
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.type === "queueUpdate") {
        currentQueue = message.payload;
        renderAllSections();
        checkAndPlayNext();
      }
      if (message.type === "controlAction") {
        handleControlAction(message.payload);
      }
    };
  }

  async function initialize() {
    if (!roomId) return;
    try {
      const qrRes = await fetch(`/api/qr?sala=${roomId}`);
      const qrData = await qrRes.json();
      qrCodeImg.src = qrData.qrUrl;
    } catch (error) {
      console.error("Error durante la inicialización:", error);
    }
  }

  function renderAllSections() {
    renderNowPlaying();
    renderUpNext();
    renderUpcomingQueue();
  }

  function formatTime(seconds) {
    if (isNaN(seconds) || seconds < 0) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60)
      .toString()
      .padStart(2, "0");
    return `${mins}:${secs}`;
  }

  function formatSongTitleForDisplay(fullFilename) {
    const parts = fullFilename.replace(".mp4", "").split(" - ");
    if (parts.length >= 2) {
      const artist = parts[0].trim();
      const songTitle = parts.slice(1).join(" - ").trim();
      return { artist, songTitle };
    }
    return {
      artist: "Desconocido",
      songTitle: fullFilename.replace(".mp4", ""),
    };
  }

  function renderNowPlaying() {
    const nowPlaying = currentQueue.length > 0 ? currentQueue[0] : null;
    if (nowPlaying) {
      const { artist, songTitle } = formatSongTitleForDisplay(nowPlaying.song);
      nowPlayingContent.innerHTML = `
                <div class="info-card-title">${artist}</div>
                <div class="info-card-subtitle">${songTitle}</div>
                <div class="info-card-user">por ${nowPlaying.name}</div>
                <div class="info-card-subtitle" id="song-duration"></div>
            `;
    } else {
      nowPlayingContent.innerHTML =
        '<div class="info-card-title">La cola está vacía</div>';
      const durationEl = document.getElementById("song-duration");
      if (durationEl) durationEl.textContent = "";
    }
  }

  function renderUpNext() {
    const upNext = currentQueue.length > 1 ? currentQueue[1] : null;
    if (upNext) {
      const { artist, songTitle } = formatSongTitleForDisplay(upNext.song);
      upNextContent.innerHTML = `
                <div class="info-card-title">${artist}</div>
                <div class="info-card-subtitle">${songTitle}</div>
                <div class="info-card-user">por ${upNext.name}</div>
            `;
    } else {
      upNextContent.innerHTML =
        '<div class="info-card-title">Nadie en espera</div>';
    }
  }

  function renderUpcomingQueue() {
    songQueueContainer.innerHTML = "";
    const upcoming = currentQueue.slice(2, 7);
    upcoming.forEach((item) => {
      const { artist, songTitle } = formatSongTitleForDisplay(item.song);
      const div = document.createElement("div");
      div.className = "queue-item";
      div.innerHTML = `<span class="song-name">${songTitle}</span><span class="user-name">(${artist}) por ${item.name}</span>`;
      songQueueContainer.appendChild(div);
    });
    if (upcoming.length === 0 && currentQueue.length > 2) {
      // No hacemos nada, ya que la lista está vacía
    } else if (currentQueue.length <= 2) {
      const div = document.createElement("div");
      div.className = "queue-item";
      div.textContent = "No hay más canciones en cola.";
      songQueueContainer.appendChild(div);
    }
  }

  function handleControlAction(payload) {
    switch (payload.action) {
      case "playPause":
        if (player.src) {
          if (player.paused) player.play();
          else player.pause();
        }
        break;
      case "skip":
        player.pause();
        player.src = "";
        ws.send(JSON.stringify({ type: "playNext" }));
        break;
    }
  }

  function checkAndPlayNext() {
    const isPlaying =
      player.currentTime > 0 &&
      !player.paused &&
      !player.ended &&
      player.readyState > 2;
    if (!isPlaying && currentQueue.length > 0) {
      playSong(currentQueue[0].song);
    }
  }

  async function playSong(songFilename) {
    try {
      const res = await fetch(
        `/api/song-url?song=${encodeURIComponent(songFilename)}`
      );
      const data = await res.json();
      player.src = data.url;
      await player.play();
    } catch (e) {
      console.error("Error al reproducir la canción:", e);
    }
  }

  player.addEventListener("ended", () =>
    ws.send(JSON.stringify({ type: "playNext" }))
  );

  player.addEventListener("loadedmetadata", () => {
    const durationEl = document.getElementById("song-duration");
    if (durationEl) {
      durationEl.textContent = `Duración: ${formatTime(player.duration)}`;
    }
  });

  player.addEventListener("timeupdate", () => {
    const now = Date.now();
    if (now - lastTimeUpdate > 1000) {
      lastTimeUpdate = now;
      if (ws?.readyState === WebSocket.OPEN && player.duration) {
        ws.send(
          JSON.stringify({
            type: "timeUpdate",
            payload: {
              currentTime: player.currentTime,
              duration: player.duration,
              song: currentQueue.length > 0 ? currentQueue[0].song : null,
            },
          })
        );
      }
    }
  });
});
