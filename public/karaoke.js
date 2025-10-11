document.addEventListener("DOMContentLoaded", () => {
  const player = document.getElementById("karaokePlayer");
  const songQueueContainer = document.getElementById("songQueue");
  const qrCodeImg = document.getElementById("qrCode");
  const songBrowser = document.getElementById("songBrowser");

  let songData = {};
  let currentQueue = [];
  let ws;
  let lastTimeUpdate = 0;

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
        renderQueue();
        checkAndPlayNext();
      }
      if (message.type === "controlAction") {
        handleControlAction(message.payload);
      }
    };
  }

  function handleControlAction(payload) {
    switch (payload.action) {
      case "playPause":
        if (player.src) {
          // Solo funciona si hay una canción cargada
          if (player.paused) player.play();
          else player.pause();
        }
        break;
      case "skip":
        // --- CAMBIO Y CORRECCIÓN AQUÍ ---
        // 1. Detenemos el reproductor actual para que el salto sea inmediato.
        player.pause();
        player.src = ""; // Limpiamos la fuente para asegurar que se detenga.
        // 2. Le pedimos al servidor que actualice la cola y pase a la siguiente.
        ws.send(JSON.stringify({ type: "playNext" }));
        break;
    }
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

  function renderQueue() {
    songQueueContainer.innerHTML = "";
    currentQueue.forEach((item) => {
      const div = document.createElement("div");
      div.className = "queue-item";
      div.innerHTML = `<span class="song-name">${item.song.replace(
        ".mp4",
        ""
      )}</span><span class="user-name">${item.name}</span>`;
      songQueueContainer.appendChild(div);
    });
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

  connectWebSocket();
  initialize();
});
