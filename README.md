# Cameras IP

Projecte per a la gestió/visualització de càmeres IP.

## Estructura

- `src/` — codi font
- `docs/` — documentació

## Escaneig de xarxa

El projecte inclou una eina per detectar càmeres IP i altres dispositius connectats a la xarxa local.

```
npm run scan
```

o directament:

```
node src/scan.js
```

### Què fa

1. **Detecta la xarxa local** a partir de la interfície IPv4 activa de l'equip.
2. **Cerca càmeres ONVIF** mitjançant WS-Discovery (multicast UDP a `239.255.255.250:3702`) — els dispositius compatibles amb ONVIF responen directament i queden marcats com `[ONVIF]`.
3. **Escaneja tota la subxarxa** (`.1`–`.254`) buscant ports habituals de càmeres IP i DVRs/NVRs: `80`, `443`, `554` (RTSP), `8000`, `8080`, `37777`, `34567`, `2020`, `8899`, `9000`.
4. **Identifica el fabricant de cada dispositiu per MAC**: llegeix la taula ARP local (`arp -a`) per obtenir la MAC de cada IP trobada i consulta el fabricant (OUI) a través de l'API pública [macvendors.com](https://macvendors.com). Això permet distingir, per exemple, una càmera d'un fabricant conegut (Hikvision, Dahua, etc.) d'un router o un altre dispositiu de la xarxa.
5. **Consulta informació del dispositiu ONVIF** (`GetDeviceInformation`): per a cada càmera trobada per ONVIF, es consulta el fabricant, model, versió de firmware i número de sèrie directament al dispositiu, fent servir la `XAddr` (URL del servei ONVIF) retornada pel propi WS-Discovery. Alguns dispositius permeten aquesta consulta sense autenticar-se; altres requereixen credencials.

### Credencials ONVIF

Si la càmera requereix autenticació per a `GetDeviceInformation`, passa l'usuari i la contrasenya per variables d'entorn (recomanat, per no deixar-les a l'historial de la terminal):

```
$env:ONVIF_USER = "admin"
$env:ONVIF_PASS = "la-teva-contrasenya"
node src/scan.js
```

o directament per paràmetre:

```
node src/scan.js --user admin --pass la-teva-contrasenya
```

Les credencials només s'envien al dispositiu ONVIF corresponent (autenticació WS-Security amb digest, no en text pla). Mai es guarden ni es pugen al repositori.

### Sortida

Per cada dispositiu trobat es mostra la IP, els ports oberts, la MAC, el fabricant identificat i si s'ha confirmat com a càmera ONVIF:

```
192.168.0.23  ->  ports: 80, 554, 8899  |  68-B9-D3-0A-6A-D2 (Shenzhen Trolink Technology CO, LTD)  [ONVIF]
```

> Nota: la identificació de fabricant envia la MAC de cada dispositiu trobat a un servei extern (api.macvendors.com) per resoldre'n l'OUI.

## Visualització web dels streams

El projecte inclou un servidor web que mostra en directe les càmeres ONVIF trobades a la xarxa.

Requereix **ffmpeg** instal·lat i disponible al `PATH` (fa la conversió RTSP → MJPEG).

```
npm run web
```

o directament:

```
node src/server.js
```

Després obre **http://localhost:3000** al navegador. La pàgina detecta automàticament les càmeres ONVIF de la xarxa i mostra una graella amb la imatge en directe de cadascuna (MJPEG, sense àudio, uns 1–2 segons de latència).

Si les càmeres requereixen autenticació (habitual per obtenir la URL RTSP mitjançant el servei de mitjans ONVIF), passa les credencials igual que amb l'escaneig:

```
$env:ONVIF_USER = "admin"
$env:ONVIF_PASS = "la-teva-contrasenya"
node src/server.js
```

El port per defecte és `3000` (configurable amb la variable `PORT`).

### Com funciona

1. El navegador demana `/api/cameras`, que fa WS-Discovery + `GetDeviceInformation` per llistar les càmeres (fabricant, model...).
2. Cada targeta de la graella carrega `/stream/<ip>`, que al servidor:
   - obté la URL RTSP real de la càmera via ONVIF (`GetCapabilities` → `GetProfiles` → `GetStreamUri`),
   - hi afegeix les credencials si s'han proporcionat,
   - llança `ffmpeg` per transcodificar el RTSP a MJPEG i el retransmet directament com a resposta HTTP (`multipart/x-mixed-replace`), que el navegador mostra amb una simple etiqueta `<img>`.

## Estat

Escaneig, identificació de dispositius i visualització web dels streams implementats.
