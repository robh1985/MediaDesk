# MediaDesk

One web portal for **Radarr, Sonarr, NZBGet, Jellyfin, Plex and PiKVM**, laid out like a desktop OS: draggable and resizable windows, a dock, a menu bar with live status, desktop widgets, notifications and a universal search launcher.

## Features

- **Desktop shell**: windows that snap to screen edges (drag to the left/right edge, or the top to maximise), minimise to the dock, and remember their positions. Includes a light/dark theme, accent colours, built-in wallpapers or your own pictures (Fill, Fit, Stretch, Centre or Tile), and a mobile layout.
- **Dock, like macOS**: by default it shows Search & apps, the apps you have open, and Settings. Turn off *Show only open apps* in Settings → Dock & Desktop to keep your chosen apps in it instead; then you can drag apps to reorder them, drag one off to remove it, or use *Keep in Dock* on an open app. You can also choose its size, magnification and screen edge (left, bottom or right), hide it automatically, and show or hide open-app dots.
- **Arrange the desktop**: drag icons anywhere. Drop one app onto another to make a named group, like folders on Android; tap a group to open it, rename it, or drag apps back out. Drop a desktop icon onto the dock to add it. On phones, hold an icon and then drag it.
- **Launcher**: press `Ctrl+Space`, `Ctrl+K` or `/` to search apps, your Radarr/Sonarr libraries, Jellyfin and Plex in one place, run commands ("pause", "scan", "missing"), or type `add <title>` to add a movie or show.
- **Overview**: library counts, download speed, active streams, health warnings, what's airing this week, the download queue and recently added items.
- **Radarr / Sonarr**: browse and filter the library, see movie or series details (including seasons and episodes), search, monitor or unmonitor, refresh, delete, add new titles, manage the queue, and view the calendar, health and disk space.
- **NZBGet**: a live speed graph, pause and resume (everything or one download), a speed limit, move to top, delete, history (including retrying failed downloads), adding an NZB by URL or file upload, the message log, and server stats.
- **Jellyfin**: continue watching, next up, recently added, library browsing and search, item details (mark watched, favourite, refresh metadata), now playing (pause, stop or message a viewer), library scans, scheduled tasks, the activity log, and restart.
- **Notification badges**: when a download finishes or fails, a movie or episode is imported, or Radarr/Sonarr report a problem, a number appears on that app's icon instead of a pop-up. Opening the app clears it, and the bell lists everything. The server keeps watching even when no browser is open.
- **Plex**: manage your Plex Media Server: an overview (version, Plex Pass, library sizes, running activity), *Now Playing* with direct play / direct stream / transcode details, hardware transcoding, bandwidth and local or remote, plus *Stop stream* with a message to the viewer (Plex Pass). Also library scans, metadata refresh, empty trash, a library browser with item details (mark watched, refresh, delete), watch history, scheduled tasks you can run now, and maintenance (clean bundles, optimise the database, check for updates).
- **Plex Viewer**: watch Plex in the browser. A home screen with Continue watching, On deck and Recently added; library grids with sort, genre and unwatched filters; search; show pages with seasons and episodes. The player resumes where you left off, reports progress back to Plex (so it carries over to your other Plex apps), has quality, audio and subtitle choices, and plays the next episode automatically. Plex converts the video when the browser can't play it as is.
- **Upcoming widget**: the desktop's *Upcoming* widget lists this week's TV episodes from Sonarr and the next month's movie releases from Radarr (in cinemas, digital and physical).
- **PiKVM**: the remote computer's live screen, with your keyboard and mouse (or touch, with an on-screen keyboard on phones); power on, shut down, force off and reset with the power LEDs; Ctrl+Alt+Del and other key combinations; paste text as typing (for long passwords or a BIOS); virtual media — upload, attach and detach ISO images as a CD-ROM or USB stick; GPIO switches; screenshots and full screen. MediaDesk signs in to the PiKVM, so its password never reaches the browser.
- **Log Viewer**: reads log files like Microsoft's CMTrace — Configuration Manager logs (both formats), Windows logs such as CBS.log, and any other text log. Errors are red and warnings yellow, with columns for component, date/time and thread, the whole entry underneath, and the elapsed time between selected lines. It follows a log as it grows, merges several logs into one timeline, and has Find (F3), Highlight, Filter (by text, component, thread or level) and an error-code lookup for Windows, HRESULT and ConfigMgr codes. Opens logs from the shared folders or your computer (drop files on it).
- **The Game Console**: an all-in-one game console for the games in a folder on your server: NES, Super NES, N64, Game Boy / Color / Advance, DS, Virtual Boy, Genesis / Mega Drive, Master System, Sega CD, 32X, Game Gear, Saturn, PlayStation, PSP, TurboGrafx-16, Atari 2600 / 5200 / 7800 / Lynx / Jaguar, Neo Geo Pocket, WonderSwan, ColecoVision, 3DO and arcade. Play with the keyboard or any USB or Bluetooth controller, remap every button per console and per player (up to four), and pick from ten looks: a 1980s–90s living-room entertainment centre, one inspired by Apple TV, and eight more inspired by easy console and TV menus. Saves, save states (with pictures) and *Continue where you left off* are kept on the server, so they follow you between devices. Each console has its own settings: emulator, BIOS, screen filter (including CRT looks), rewind, fast-forward and on-screen touch controls you can lay out yourself.
- **Settings for each app**: connection details, which events to count, and preferences such as the default quality profile and root folder for new titles, Sonarr's monitoring choice, the calendar range, the NZBGet category and priority, which Jellyfin user to browse as, and which home rows to show.
- **Music**: a Winamp-style player for your Jellyfin music library and the audio files in your shared folders. It has a green LCD display with a spectrum analyser, a 10-band equalizer with Winamp's presets, balance, shuffle/repeat, and a playlist editor. Its visualizer works like MilkDrop: GPU-rendered feedback warps react to bass, mids, treble and beats, with presets that blend into one another, and it can go full screen. Phones get lock-screen and headphone controls. Albums, songs and audio files can be sent to it from Jellyfin and Files.
- **Calculator**: basic, scientific (trigonometry in degrees, radians or gradians, powers, roots, logs, factorials, memory and history) and graphing (up to eight functions, with pan, zoom and tracing).
- **Notes**: a text and code editor like Notepad++, with tabs, syntax colours for about 40 languages and formats (code, config, logs, subtitles, CSV and more), line numbers, word wrap, find and replace with regular expressions, line tools (duplicate, move, sort, comment) and control over line endings and the BOM. It opens and saves files in your shared folders or on your device, and remembers open tabs, including unsaved ones.
- **Archive Expander**: a 7-Zip File Manager for the shared folders. Open an archive and browse it like a folder (archives inside archives too), view files inside it, and **Add**, **Extract**, **Test**, **Delete**, **Rename** and view **Properties**, as 7-Zip does. *Add to Archive* has 7-Zip's options: 7z, ZIP, TAR, WIM, GZip, BZip2 and XZ; compression level, method (LZMA2, LZMA, PPMd, BZip2, Deflate, Deflate64), dictionary and word size, solid blocks, CPU threads, split volumes, update modes (add/replace, update, freshen, synchronize), AES-256 encryption with encrypted file names, ZipCrypto, delete-after-compressing and extra `-m` parameters. *Extract* has full/no pathnames, the four overwrite modes, *eliminate duplication of root folder* and passwords. It also calculates checksums (CRC32/64, XXH64, SHA-1/256/384/512, SHA3-256, MD5, BLAKE2sp) and runs 7-Zip's benchmark. It opens everything 7-Zip opens (7z, ZIP, RAR/RAR5, TAR, GZ, BZ2, XZ, ISO, UDF, CAB, CHM, MSI, DMG, HFS, APFS, VHD/VHDX, VMDK, VDI, QCOW, WIM, NSIS, RPM, DEB, CPIO, ARJ, LZH, squashfs, split `.001` files, …; *Tools → Supported formats* lists them). Files gets *Open in Archive Expander*, *Extract Here*, *Extract to “name/”* and *Add to archive…*. Needs 7-Zip on the server; see [Helper programs](#preview-helpers).
- **Convert**: a unit converter in the style of Josh Madison's Convert, with 26 categories and 474 units: acceleration, amount of substance, angle, area, computer storage and data rate, concentration (molar and mass), density, distance, energy, flow, force, frequency, fuel economy, light (illuminance and luminance), mass, power, pressure, speed, temperature (Celsius, Fahrenheit, Kelvin, Rankine, Réaumur, Rømer, Newton, Delisle), time, torque, volume and dry volume. The answer updates as you type (sums like `5*12+11` work), with decimal places, scientific notation and digit grouping, a swap button, a table of the value in every unit, and your own units and categories (saved in the browser). Factors come from the exact definitions (international inch and pound, US and imperial gallon, standard gravity, IT BTU and calorie).
- **Paint**: a classic Windows 98 Paint, after jspaint. It has all 16 tools (free-form and rectangle select, eraser and colour eraser, fill, pick colour, magnifier, pencil, brush, airbrush, text, line, curve, rectangle, polygon, ellipse, rounded rectangle) with their size and fill options, and the 28-colour palette with *Edit Colors*. Selections can be moved, copied (Ctrl-drag) and smeared (Shift-drag), opaque or transparent. The Image menu flips, rotates, stretches, skews and inverts, and sets the size in *Attributes*; you can also drag the canvas edges. There are zoom levels with a grid, undo and redo, the clipboard, *Copy To*/*Paste From* and *Set As Wallpaper* (tiled or centred). It opens pictures from the shared folders and saves PNG, JPEG, BMP or WebP.
- **Paint Pro**: a layered image editor modelled on Pinta. It has 22 tools: the four selection tools with replace, union, exclude, xor and intersect modes; magic wand; move selected/selection; zoom; pan; paintbrush; pencil; eraser; paint bucket; gradient (linear, reflected, diamond, radial, conical; colour or transparency); colour picker; text; line/curve; rectangle; rounded rectangle; ellipse; freeform shape; clone stamp; and recolour. Shapes stay editable with handles until you finish them. Layers have opacity, blend modes, hiding, reorder, duplicate and merge down, and there is a history panel you can click back through. There are 9 adjustments (auto level, black and white, brightness/contrast, curves, hue/saturation, invert, levels, posterize, sepia) and 32 effects in Artistic, Blurs, Distort, Noise, Photo, Render and Stylize, all with a live preview limited to the selection. It also has tabs for several images, resize, canvas size, crop, flip and rotate, and screenshots. Files are saved as OpenRaster (`.ora`, which keeps layers), PNG, JPEG, WebP or BMP. Files gets *Edit in Paint* and *Edit in Paint Pro*.
- **Family Organizer**: a family hub like a Skylight Calendar, shared by every device in the house (it's kept on the MediaDesk server).
  - **Calendar**: month, week, day (a column for each person) and schedule views, colour-coded by person, with the weather on each day and countdowns to big days. Events can repeat (daily, weekly on chosen days, monthly by date or "second Tuesday", yearly), have reminders, a place and notes. Repeating events can be changed or deleted one at a time, from one onwards, or all together. Drag events to move them or drag their bottom edge to resize them. *Quick add* turns what you type ("Soccer every Tuesday 4:30-6pm for Leo") into events, several at once, and reads `.ics` files.
  - **Connected calendars**: Google, Outlook, iCloud, Yahoo, Cozi, school and team calendars, added by their iCal address and read every 10 minutes. The family's own events have a private subscription address for phones.
  - **Chores and routines**: a chore chart with a column per person, chores that repeat on chosen days, "up for grabs" chores, morning, afternoon and evening routines, a week-at-a-glance chart and a celebration when a chore is ticked off.
  - **Rewards**: stars earned from chores are spent on rewards. Parents can give or take stars, and there's a star history.
  - **Meals**: a weekly meal plan (breakfast, lunch, dinner, snack), a recipe box, meal ideas and *Plan dinners for me* from the recipe box, and ingredients sent to the grocery list.
  - **Lists**: grocery lists sorted into aisles as you add to them, to-do lists with a person and a due date, and any other list.
  - **Photos**: a photo frame slideshow from uploaded photos or a shared folder, showing the time, weather and what's next. It can start by itself when nobody's using the organizer.
  - **Sleep mode** at night, and a **parent PIN** for settings, chores, rewards and stars.
  - Weather comes from Open-Meteo, which needs no account. Two-way sync with Google or Outlook needs their sign-in, which MediaDesk doesn't have, so connected calendars are read-only. Events added in the organizer reach phones through the subscription address instead.
- **Preview**: opens files from Files. You can flick through pictures in a folder, zoom and rotate them, and see TIFF, HEIC and PSD files. Video and audio play in any format, converted on the server while they play when the browser can't handle them, with audio-track choice. PDFs have selectable text. Word, Excel and PowerPoint files open too. See [Preview helpers](#preview-helpers).
- **Screensaver**: eleven classics: Flying Toasters (in isometric 3D), 3D Maze (Windows 98), 3D Pipes, Starfield, Mystify, 3D Text, Bubbles, Ribbons, Flurry, Hello (macOS) and Matrix (the falling green code from The Matrix), or a random one each time. Turn it on and pick the delay in Settings → Screensaver. With *Require password to return* on, it locks MediaDesk in every tab until the portal password is entered again; music from Jellyfin keeps playing. The MediaDesk menu can also start the screensaver or lock the screen right away.
- **Files**: a file manager for folders you choose on the MediaDesk server. You can browse, upload (drag and drop, any size), download, create folders, rename, cut/copy/paste, drag files between folders and delete. Pictures, video, PDFs and Office files open in Preview, `.log` files in Log Viewer, other text files in Notes, and any picture can become the wallpaper. Shared folders can have an alias (a friendlier name, shown with the full path under it) and colour tags you create, so you can group them and filter the sidebar by tag.
- **Web UI windows**: open any service's own interface inside a window for anything MediaDesk doesn't cover.

Your API keys stay on the MediaDesk server. The browser only talks to MediaDesk, which adds the credentials when it forwards each request. This also avoids CORS problems.

## Quick start

### Try the demo first (no servers needed)

```bash
npm run demo        # or: node server.js --mock
# open http://localhost:8080
```

### Docker Compose

```bash
docker compose up -d --build
# open http://<your-server>:8080, then open Settings and connect each app
```

Edit `PORTAL_PASSWORD` in `docker-compose.yml` first. Settings you save in the UI are stored in `./config/config.json`.

If your media apps run in the same Compose project or Docker network, use their container names as URLs (for example `http://radarr:7878`).

### Plain Node.js (18+)

```bash
PORTAL_PASSWORD=change-me node server.js
```

There are no dependencies and nothing to `npm install`.

### Windows

1. Install **Node.js LTS** from <https://nodejs.org> (the default options are fine).
2. Download MediaDesk: either `git clone https://github.com/robh1985/MediaDesk.git`, or on GitHub click *Code → Download ZIP* and extract it. A permanent spot like `C:\MediaDesk` works best.
3. Pick how you want to run it:

| | How | Good for |
| --- | --- | --- |
| **Try it** | Double-click `start-windows.cmd`. To use sample data instead, run `start-windows.cmd --mock` from a command prompt. | Testing. It stops when you close the window. |
| **Run all the time** | Double-click `install-windows.cmd` and approve the admin prompt. | Everyday use. It starts with Windows (even before anyone logs in) and restarts if it crashes. |

`install-windows.cmd` does the following:
- asks for a portal password
- registers a startup task called **MediaDesk**
- opens the port in Windows Firewall for Private networks
- starts the portal and opens it in your browser
- prints the address other devices on your network can use

To use a different port, run it from a command prompt as `install-windows.cmd -Port 8081`. Run it again at any time to change the password or port.

Notes for Windows:
- **Service URLs:** if Radarr, Sonarr, NZBGet or Jellyfin run on the same PC, use `http://localhost:7878` and so on on each app's page in *Settings*.
- **Other devices can't connect:** check that the network is set to *Private* in Windows Settings → Network. The firewall rule doesn't apply to *Public* networks.
- **Update:** double-click `update-windows.cmd`. It downloads the latest version from the `main` branch (switching to `main` if you're on another branch) and restarts MediaDesk. If you installed from a ZIP, extract the new ZIP over the old folder and double-click `restart-windows.cmd`. Your settings are kept either way. Settings → About shows which version is running.
- **Restart:** double-click `restart-windows.cmd`. This stops any leftover copy of MediaDesk before starting it again; ending the task in Task Scheduler doesn't always do that.
- **Logs:** the background version writes to `logs\mediadesk.log`, including the version it started with and any startup errors.
- **Remove:** double-click `uninstall-windows.cmd`. Your settings are kept.
- **Docker Desktop** also works with `docker compose up -d --build`. In that case, services running on the Windows host are reached at `http://host.docker.internal:7878`, not `localhost`.

## Configuration

You can configure MediaDesk in three ways. Environment variables override the config file.

1. **Settings app** (easiest): open *Settings*, pick an app in the sidebar, fill in its connection fields and click *Save & reconnect*. *Settings → General* tests every connection at once.
2. **`config/config.json`**: see `config/config.example.json`.
3. **Environment variables**:

| Variable | Purpose |
| --- | --- |
| `PORTAL_PASSWORD` | Turns on the lock screen. **Set this** if anyone else can reach the portal. |
| `RADARR_URL`, `RADARR_API_KEY` | Radarr → *Settings → General → API Key* |
| `SONARR_URL`, `SONARR_API_KEY` | Sonarr → *Settings → General → API Key* |
| `NZBGET_URL`, `NZBGET_USERNAME`, `NZBGET_PASSWORD` | NZBGet → *Settings → Security* (`ControlUsername` / `ControlPassword`) |
| `JELLYFIN_URL`, `JELLYFIN_API_KEY` | Jellyfin → *Dashboard → API Keys → +* |
| `PLEX_URL`, `PLEX_TOKEN` | Easier: *Settings → Plex → Sign in with Plex*. Otherwise the server address (`http://<ip>:32400`) and an `X-Plex-Token` |
| `FILE_ROOTS` | Optional. Folders the Files app may manage (also settable in *Settings → Files*) |
| `PIKVM_URL`, `PIKVM_USERNAME`, `PIKVM_PASSWORD` | PiKVM's address (for example `https://192.168.1.50`) and its web login (user `admin` by default) |
| `GAMES_DIR` | Optional. The Game Console's games folder (also settable in *Settings → The Game Console*) |
| `JELLYFIN_USER_ID` | Optional. Which user's view to browse (defaults to the first admin) |
| `*_PUBLIC_URL` | Optional. The browser-facing URL used for "Open in…" links and Web UI windows, if it differs from the server-side URL |
| `PORT`, `HOST`, `CONFIG_PATH` | Server settings (defaults: `8080`, `0.0.0.0`, `./config/config.json`). The port can also be set as `"port"` in the config file. |

**Server URL compared with public URL:** the *server URL* is how the MediaDesk server reaches a service (for example `http://radarr:7878` inside Docker). The *public URL* is what your browser uses (for example `https://radarr.example.com`) and only matters for links and embedded web UIs.

## Files

The Files app only works with folders you've shared in **Settings → Files**, which takes one full path per line, such as `D:\Media` or `/mnt/media`. You can also set them with the `FILE_ROOTS` environment variable (separate paths with `;` on Windows or `:` on Linux/macOS). Settings suggests folders from Radarr, Sonarr and NZBGet.

- **Password required:** anyone who can open Files can change or delete anything in the shared folders, so Files stays switched off until a portal password is set.
- **Contained to shared folders:** paths can't escape the shared folders, including through symlinks or Windows junctions.
- **Large uploads:** files of any size upload in 8 MB pieces. If the connection drops, the current piece is retried automatically, so a big upload doesn't start over. Free space is checked before anything is sent. While an upload is running, phones keep the screen awake (where the browser supports it), and closing the tab asks for confirmation first.
- **Permanent deletes:** deleting is permanent. Nothing goes to the Recycle Bin.
- **Whole folders can't be downloaded:** you can download files, but not a folder in one go.
- **Network shares on Windows:** the startup task runs as the SYSTEM account, which can't see mapped drive letters such as `Z:`. Use the share's full address, such as `\\NAS\Media`, and make sure the share allows the PC's computer account.
- **Docker:** Files only sees folders mounted into the container. Add each one under `volumes:` in `docker-compose.yml` (for example `- /mnt/media:/media`), then share the container path (`/media`).

### Preview helpers

Preview handles pictures, PDFs, most Office files and the video and audio formats your browser supports by itself. Free programs on the MediaDesk computer let it, and the Archive Expander, do more. **Settings → Files** shows whether each one was found and how to install it.

| Program | Adds | Install |
| --- | --- | --- |
| **ffmpeg** | Any video or audio format (AVI, WMV, FLV, MPEG-TS, HEVC or AC3 in MKV, WMA, APE, …), plus TIFF/HEIC/PSD pictures. Video already in H.264 is passed through without re-encoding, so it uses little CPU. | Windows: `winget install Gyan.FFmpeg`, then run `restart-windows.cmd`. Linux: `sudo apt install ffmpeg`. Included in the Docker image. |
| **LibreOffice** | Word, Excel and PowerPoint files shown exactly as they print, including old `.doc`, `.xls` and `.ppt` files. Converted documents are cached for a few days. | Windows: `winget install TheDocumentFoundation.LibreOffice`. Linux: `sudo apt install libreoffice-core libreoffice-writer libreoffice-calc libreoffice-impress`. Docker: build with `--build-arg WITH_OFFICE=true`. |
| **7-Zip** | The Archive Expander (and the archive commands in Files). MediaDesk uses an installed 7-Zip and never downloads one. | Windows: `winget install 7zip.7zip` (or 7-zip.org). Linux: `sudo apt install 7zip` (older: `p7zip-full`; RAR support: `7zip-rar`). macOS: `brew install sevenzip`. Included in the Docker image. |

Without LibreOffice, `.docx`, `.xlsx` and `.pptx` files are shown by libraries in the browser (see `public/vendor/README.md`). They run in an isolated worker, so a damaged or hostile file can't affect MediaDesk. If a program is installed somewhere unusual, set its path (or its folder) under *Installed somewhere unusual?* in Settings → Files.

On Windows, MediaDesk runs as the SYSTEM account, which doesn't share your PATH. It therefore looks for ffmpeg in every user's winget, Scoop and Chocolatey folders, for LibreOffice and 7-Zip in Program Files. After installing, run `restart-windows.cmd` (or press **Check again** in Settings → Files). The startup log lines `Preview helpers: …` and `Archive Expander: …` show where each program was found. The 7-Zip location can also be set with the `SEVENZIP_PATH` environment variable.

## The Game Console

Choose the folder that holds your games in **Settings → The Game Console** (or set `GAMES_DIR`). MediaDesk only reads it. It works out each game's console from its file type, the folder it's in and, for disc images, the disc itself; sub-folders named after the consoles (`NES`, `SNES`, `N64`, `Genesis`, `PlayStation`, `Game Boy`, …) settle anything ambiguous, such as `.bin` files. Zipped games work. Multi-file discs work as `.cue` (with their `.bin` tracks), `.m3u` playlists or, best, a single `.chd` per disc — browsers have to load the whole disc into memory, so compressed images help.

- **BIOS files:** consoles that need one (Sega CD, Saturn, 3DO, Lynx, ColecoVision, Atari 5200, and the PlayStation for the more accurate emulator) look for it in a `BIOS` sub-folder; pick it in the app under *Settings → Consoles*.
- **Box art:** a picture with the same name as the game (next to it, or in a `boxart` / `covers` folder) is used first. Otherwise the server fetches covers from the libretro-thumbnails project when it can reach the internet, and draws one when it can't. Box art is shown on its own, whole and in its own shape, with nothing behind it. Covers take the shape of each console's usual game box: wider than tall for the Super NES and N64; tall for the NES, Genesis, Master System, Saturn, Atari consoles and most others; square, like a CD case, for the PlayStation, TurboGrafx-16 and Dreamcast; tall UMD cases for the PSP; small near-square boxes for Game Boy and DS. A game's real box art uses its own shape, so PlayStation jewel cases show square and long boxes tall. Where a theme uses tiles of one shape, the art is centred in the tile. To change a game's box art, open the game and choose **Box art…**. You can pick a picture from the shared folders or this device (large pictures are scaled down smoothly), download it again, or use none.
- **Console backgrounds:** a console's section shows a picture of that console behind it. By default this is a public-domain photo from Wikimedia Commons (most are by Evan Amos), which the server downloads the first time and keeps; the photo's credit is shown in the corner. When the server can't reach Commons, a drawing of the console is shown instead. Under *Settings → Consoles* you can choose the photo, the drawing, your own picture or no background for each console.
- **Settings:** changes are saved as you make them. **Save & exit** (or B / Esc) closes Settings.
- **Emulators:** games run in your browser with [EmulatorJS](https://emulatorjs.org) (GPL-3.0) and the libretro cores it packages. MediaDesk doesn't include them: the first time a console is played, the server downloads its emulator from the npm registry (`NPM_REGISTRY` changes where) into its config folder, so it needs internet access once per console. *Settings → Consoles → Download emulator now* fetches one ahead of time.
- **Controllers:** any controller the browser sees as a standard gamepad works (Xbox, PlayStation, Switch Pro, 8BitDo…). Press a button on it once so the browser notices it. In a game, **Home** or **Select + Start** (or **Esc** on the keyboard) opens the game menu: save and load states, restart, change disc, full screen, and quit.
- **On-screen controls:** touch screens get a pad laid out like each console's own controller (six buttons for the Genesis, a stick and C buttons for the N64, and so on). Every finger is tracked separately, so you can hold one button while tapping another (hold B to run and tap A to jump), rest a thumb between two buttons to press both, or slide from one button onto another. To change the layout, use **On-screen controls** in the game menu, or **Customize on-screen controls** under Settings → Consoles. Drag a control to move it; tap it to change its label, shape, size, rotation, colour, colour when pressed, label colour and what it presses. Turn a control with its ↻ handle, or with the rotation slider and its ±15° buttons. To move or turn several controls together, select them with **Select several** (or Shift-click), or drag a box around them. Then drag any one of them to move the group, or turn the group with the ↻ handle or the group panel, which keeps them at the same angle to each other. A turned D-pad or stick turns its directions with it. A button can press several inputs at once (a "B + A" button), map to a hotkey such as fast-forward, or repeat while held (turbo). You can also add D-pads, analogue sticks and buttons, hide or delete them, and change the size and opacity of the whole pad. The N64's C buttons can be four buttons or an analogue stick. Portrait and landscape keep separate layouts. Layouts are saved in the browser, so each device keeps its own.
- **Not playable here:** Dreamcast games are listed, but no Dreamcast emulator runs in a browser yet. PSP games open in their own tab, because their emulator needs a page to itself.
- **Docker:** mount your games folder into the container (for example `- /mnt/games:/games:ro`) and set `GAMES_DIR=/games`.

## Custom wallpapers

In Settings → Appearance, choose **Add picture…** to upload one from your device or pick one from the shared folders. You can also right-click a picture in Files and choose **Set as desktop wallpaper**. Pictures are kept in a `wallpapers` folder next to `config.json` (up to 24 pictures, 40 MB each), so every device can use them.

## Security notes

- Logging in to MediaDesk gives full API access to every connected service. Treat the portal password like an admin password.
- For access from outside your network, put MediaDesk behind a reverse proxy with HTTPS (Caddy, Traefik, nginx, or SWAG). If the proxy sends `X-Forwarded-Proto: https`, the session cookie is marked `Secure`.
- To sign out, click the MediaDesk logo at the top left and choose **Log out**. Login attempts are rate-limited, and sessions last 30 days. Changing the password signs everyone out.
- The config file is written with `0600` permissions.

## Compatibility

- Radarr v3+ and Sonarr v3/v4 (API v3)
- NZBGet v18+ and nzbget-ng
- Jellyfin 10.8+
- PiKVM (kvmd) 3.x and 4.x — PiKVM V2/V3/V4, and DIY builds
- The Game Console: a recent Chrome, Edge, Firefox or Safari (WebAssembly and WebGL 2)
- Plex Media Server 1.30+ (Stop stream and full watch history need Plex Pass on the server owner's account)

## Phones and tablets

Everything works on touch screens too:

- **Same features:** phones and tablets get every feature desktop has, including the widgets (which appear under the desktop icons on phones) and every value in the download queues (shown as labelled cards).
- **Long-press = right-click:** press and hold anywhere you'd right-click with a mouse (files, dock icons, the wallpaper) to open the same menu. Holding an icon-only button shows its name.
- **Selecting in Files:** use the checkboxes, or **Select all** in the header. Once something is selected, tapping other items adds them to the selection; with nothing selected, a tap opens the item. To move files, use Cut and Paste, since dragging isn't available on touch screens.
- **Arranging icons:** hold a desktop icon for a moment, then drag it. Drop it on another icon to make a group, or on the dock to add it. Swiping without holding still scrolls the page.
- **Windows:** on phones every app fills the screen. Switch between apps with the dock.

## Keyboard shortcuts

| Keys | Action |
| --- | --- |
| `Ctrl+Space`, `Ctrl+K`, `/` | Open the launcher / search |
| `Alt+W` | Close the focused window |
| `Esc` | Close the launcher, dialog or menu |
| Double-click a title bar | Maximise or restore (or minimise, in Settings → Dock & Desktop) |
| `Ctrl+S`, `Ctrl+O`, `Ctrl+F`, `Ctrl+H`, `Ctrl+G`, `F3` | In Notes: save, open, find, replace, go to line, find next |
| `Ctrl+D`, `Alt+↑/↓`, `Ctrl+/`, `Alt+Z`, `Alt+N` | In Notes: duplicate line, move line, comment, word wrap, new tab |
| `←` `→`, `+` `−` `0` | In Preview: previous/next picture, zoom, fit |

## Troubleshooting

**Behind Cloudflare or another proxy/CDN:** MediaDesk loads its scripts and styles from addresses that include the build (`/v/<build>/…`), and the page itself is never cached, so updates reach every device even when a proxy caches `.js` and `.css` files. After updating from a version older than this, clear MediaDesk's site data once on each phone (Chrome: ⋮ → Settings → Site settings → All sites → your MediaDesk address → Delete data), or wait a few hours for the old copies to expire. In Cloudflare you can also set **Caching → Configuration → Browser Cache TTL** to *Respect Existing Headers*.

To see what a touch screen is doing, open MediaDesk with `?touchdebug` at the end of the address. A panel then logs each swipe, and **Copy log** copies it.

- **"Could not reach radarr: ECONNREFUSED"**: the URL is wrong *from the MediaDesk server's point of view*. Inside Docker, `localhost` means the MediaDesk container itself, so use the host's LAN IP or the container name instead.
- **A Web UI window is blank**: the service may block being embedded in a frame, or your browser can't reach the public URL. Use "Open in new tab".
- **Plex sign-in finds the server but it won't connect**: pick an address the *MediaDesk server* can reach (usually the `local` one), or type one such as `http://192.168.1.20:32400`. If Plex requires secure connections, choose the `https://…plex.direct` address.
- **Plex video stutters**: lower the quality in the player (⚙) or in *Settings → Plex*.
- **PiKVM shows a picture that updates slowly**: something between your browser and MediaDesk (some reverse proxies) doesn't pass on the live video stream, so the app switched to pictures. You can choose pictures yourself in *Settings → PiKVM* for slow connections.
- **PiKVM keyboard or mouse does nothing**: your reverse proxy must pass WebSockets through to MediaDesk (Cloudflare Tunnel and most proxies do by default; nginx needs `proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade";`).
- **A game says it couldn't load the emulator**: the MediaDesk server couldn't download it from `registry.npmjs.org`. Check the server's internet access (or set `NPM_REGISTRY` to a mirror), then try again.
- **A game is under the wrong console**: move it into a folder named after the right console, then *Settings → Games & storage → Look for new games* in The Game Console.
- **Deleting in Plex fails**: turn on *Allow media deletion* in Plex → *Settings → Library*.
- **Jellyfin shows the wrong user's watch state**: set `JELLYFIN_USER_ID` (or the field in Settings) to your own user ID.
