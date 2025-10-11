document.addEventListener("DOMContentLoaded", () => {
  const welcomeModal = document.getElementById("welcome-modal");
  const startBtn = document.getElementById("start-btn");
  const mainContainer = document.querySelector(".main-container");
  const player = document.getElementById("karaokePlayer");
  const songBrowser = document.getElementById("songBrowser");

  // --- SELECTORES PARA LA NUEVA INTERFAZ ---
  const nowPlayingContent = document.getElementById("now-playing-content");
  const upNextContent = document.getElementById("up-next-content");
  const songQueueContainer = document.getElementById("songQueue");
  const qrCodeImg = document.getElementById("qrCode");

  let songData = {},
    currentQueue = [],
    ws,
    lastTimeUpdate = 0;

  startBtn.addEventListener("click", () => {
    welcomeModal.classList.add("hidden");
    mainContainer.classList.remove("hidden");
    player.play().catch((error) => {
      console.log("Permiso de audio/video concedido por el usuario.");
    });
    player.pause();
    connectWebSocket();
    initialize();
  });

  function connectWebSocket() {
    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    ws = new WebSocket(`${protocol}://${window.location.host}`);
    ws.onopen = () => console.log("Host conectado al WebSocket");
    ws.onclose = () => {
      console.log("Host desconectado. Intentando reconectar...");
      setTimeout(connectWebSocket, 3000);
    };
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
    try {
      const qrRes = await fetch("/api/qr");
      const qrData = await qrRes.json();
      qrCodeImg.src = qrData.qrUrl;

      const songsRes = await fetch("/api/songs");
      songData = await songsRes.json();

      renderAlphabet();
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

  // --- NUEVA FUNCIÓN PARA FORMATEAR EL NOMBRE DE LA CANCIÓN ---
  function formatSongTitleForDisplay(fullFilename) {
    const parts = fullFilename.replace(".mp4", "").split(" - ");
    if (parts.length >= 2) {
      const artist = parts[0].trim();
      const songTitle = parts.slice(1).join(" - ").trim(); // Une el resto para canciones con '-' en el título
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
    if (upcoming.length === 0 && currentQueue.length > 1) {
      const div = document.createElement("div");
      div.className = "queue-item";
      div.textContent = "No hay más canciones en cola.";
      songQueueContainer.appendChild(div);
    } else if (currentQueue.length <= 1) {
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
        if (confirm(`¿Añadir "${songTitle}" a la cola?`)) {
          ws.send(
            JSON.stringify({
              type: "addSong",
              payload: { song: filename, name: "Host" },
            })
          );
          renderAlphabet(); // <-- CAMBIO AQUÍ: Vuelve al selector de letra.
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

  player.addEventListener("ended", () => {
    ws.send(JSON.stringify({ type: "playNext" }));
  });

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
