# XaraokeMP4 🎤🎶

Un reproductor de karaoke interactivo basado en la web, construido con HTML5, Node.js y WebSockets. Los usuarios pueden explorar una biblioteca de canciones y añadir colaborativamente canciones a una cola en tiempo real desde sus dispositivos móviles usando un código QR.

---
## ✨ Características

* **Almacenamiento en S3:** Las canciones de karaoke (videos MP4) se almacenan en un bucket compatible con S3 (como iDrive e2 o AWS S3).
* **Control Remoto en Tiempo Real:** La interfaz del reproductor y los controles remotos se sincronizan instantáneamente usando WebSockets.
* **Conexión por QR:** Escanea un código QR en la pantalla principal para abrir la interfaz remota en cualquier teléfono, sin necesidad de instalar una app.
* **Explorador de Canciones Alfabético:** Navega por la biblioteca de canciones de forma intuitiva, filtrando por artista y luego seleccionando la canción.
* **Cola de Reproducción Compartida:** Múltiples usuarios pueden ver y añadir canciones a la misma cola de reproducción en tiempo real.
* **Controles de Reproducción:** Los controles remotos pueden pausar, reanudar y saltar canciones.
* **Notificaciones Inteligentes:** El control remoto vibra y suena para avisar al usuario cuando su canción está a punto de empezar.

---
## 🛠️ Stack Tecnológico

* **Backend:** Node.js, Express, WebSockets (`ws`)
* **Frontend:** HTML5, CSS3, JavaScript (Vanilla)
* **Almacenamiento:** Cualquier servicio de Object Storage compatible con S3.
* **Dependencias Clave:** `aws-sdk v3`, `qrcode`, `dotenv`.

---
## 🚀 Cómo Empezar (Desarrollo Local)

Sigue estos pasos para ejecutar el proyecto en tu máquina local.

### Pre-requisitos

* Node.js (v16 o superior)
* npm
* Un bucket S3 compatible (ej. iDrive e2) con tus videos de karaoke y credenciales de acceso (Access Key).

### Instalación

1.  **Clona el repositorio:**
    ```bash
    git clone [https://github.com/Xalcker/XaraokeMP4.git](https://github.com/Xalcker/XaraokeMP4.git)
    ```
2.  **Navega al directorio del proyecto:**
    ```bash
    cd XaraokeMP4
    ```
3.  **Instala las dependencias:**
    ```bash
    npm install
    ```
4.  **Crea un archivo `.env`** en la raíz del proyecto. Copia el contenido de abajo y reemplaza los valores con tus credenciales.
    ```env
    # Credenciales de tu bucket S3 compatible
    S3_ENDPOINT=tu-endpoint.idrivee2.com
    S3_ACCESS_KEY_ID=TU_ACCESS_KEY
    S3_SECRET_ACCESS_KEY=TU_SECRET_KEY
    S3_BUCKET_NAME=nombre-de-tu-bucket
    ```
5.  **Sube tus archivos de karaoke** a tu bucket, dentro de una "carpeta" llamada `MP4/`. Asegúrate de que los nombres sigan el formato: `"Artista - Cancion.mp4"`.

6.  **Inicia el servidor:**
    ```bash
    npm start
    ```
7.  Abre tu navegador y ve a `http://localhost:3000`.

---
## 💡 Cómo Usar

1.  Abre la aplicación en un navegador en tu computadora o TV (el **Host**).
2.  Escanea el código QR con la cámara de tu teléfono para abrir el **Control Remoto**.
3.  Introduce tu nombre en la interfaz remota.
4.  Usa el explorador alfabético para encontrar tu canción favorita y añadirla a la cola.
5.  La cola se actualizará en la pantalla principal y en todos los remotos conectados.
6.  ¡Espera tu turno y canta!

---
## ☁️ Despliegue

Esta aplicación está lista para ser desplegada en plataformas PaaS como **Render**.

1.  Conecta tu repositorio de GitHub a un nuevo "Web Service" en Render.
2.  Usa `npm install` como **Build Command** y `node server.js` como **Start Command**.
3.  **No subas tu archivo `.env`**. En su lugar, añade las variables de entorno en el panel de control de Render, en la sección "Environment".
4.  Una vez desplegado, no olvides **actualizar la política CORS** de tu bucket S3 para incluir la URL de tu aplicación en Render (ej. `https://xaraokemp4.onrender.com`).

---
## 📄 Licencia

Este proyecto está bajo la Licencia ISC.