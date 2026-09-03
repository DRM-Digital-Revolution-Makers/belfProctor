# BelfProctor — Полное описание работы системы

> Документ описывает как работает каждая часть системы, как данные движутся от клиента к серверу, как администратор видит результат.

---

## Архитектура системы

```
┌─────────────────────────────────────────────────────────────────────┐
│                   ПК СОТРУДНИКА (Windows)                          │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │               BelfProctor Agent (.NET 8 Service)             │  │
│  │                                                              │  │
│  │  ActivityMonitor  ScreenshotService  SystemMonitor          │  │
│  │  BrowserActivity  WorkTracking       PcSessionService        │  │
│  │  CommandHandler   StreamingService   PolicyService           │  │
│  │                                                              │  │
│  │              DataTransmissionService                         │  │
│  │         (шифрует всё → отправляет → retry queue)            │  │
│  └──────────────────────────┬───────────────────────────────────┘  │
└─────────────────────────────│───────────────────────────────────────┘
                              │ HTTPS + WebSocket
                              │ AES-256-CBC шифрование
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       СЕРВЕР (Node.js + Express)                    │
│                                                                     │
│  /api/heartbeat   /api/screenshots   /api/events                   │
│  /api/activity    /api/browser-activity   /api/work/events         │
│  /api/pc-session  /api/logs   /api/policies   /api/reports         │
│  /api/commands    ws:// (команды + стриминг)                       │
│                                                                     │
│  ┌──────────────┐    ┌──────────────────────────────────────────┐  │
│  │  PostgreSQL  │    │         Файловая система                  │  │
│  │  (Prisma)    │    │  storage/screenshots/  storage/logs/      │  │
│  │              │    │  storage/reports/      storage/commands/  │  │
│  └──────────────┘    └──────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              │ HTTP API
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                   ПАНЕЛЬ АДМИНИСТРАТОРА (React)                     │
│                                                                     │
│  Список клиентов  →  Карточка сотрудника  →  Скриншоты            │
│  Табель  →  События  →  Браузер  →  Проекты  →  Файлы             │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Часть 1 — Запуск клиентского агента

### 1.1 Установка и запуск как Windows Service

```
install-client.bat
  └─→ sc.exe create "Microsoft One Drive" ...   (маскировка под системный процесс)
  └─→ sc.exe start "Microsoft One Drive"
  └─→ Program.cs запускается
```

**Program.cs при старте:**

1. Читает конфиг в порядке приоритета:
   - `appsettings.json` (базовые настройки, рядом с .exe)
   - `%LOCALAPPDATA%\BelfProctor\appsettings.json` (переопределения от сервера)
   - ENV-переменные (наивысший приоритет)

2. Проверяет наличие `ClientId` и `ServerUrl`:
   - Если отсутствуют → открывает WinForms диалог настройки
   - Если запущен с `--auto-start` и нет конфига → выходит (не показывает UI)

3. Регистрирует все сервисы в DI-контейнере

4. Запускает все `IHostedService` параллельно

### 1.2 Инициализация сервисов (порядок)

```
StartAsync():
  1. ProctorWorker.StartAsync
     ├─ Создаёт директории (Screenshots, Logs, Reports)
     ├─ StabilityService.StartAsync     (watchdog)
     ├─ SystemMonitorService.StartAsync (USB, процессы, сеть)
     ├─ ActivityMonitorService.StartAsync (клавиши/мышь)
     └─ PolicyService.LoadPoliciesAsync (локальный policies.json)

  2. ProctorWorker.ExecuteAsync (фоновый loop)
     ├─ RunScreenshotLoop()    → немедленный снимок + таймер 5 мин
     ├─ _heartbeatTimer        → немедленно, потом каждые 60 сек
     ├─ _activityReportTimer   → немедленно, потом каждую минуту
     ├─ _dirListingTimer       → немедленно, потом каждые 10 мин
     └─ policyUpdateTimer      → немедленно, потом каждые 5 мин

  3. Параллельно стартуют отдельные HostedService:
     ├─ CommandChannelWorker   (WebSocket подключение к серверу)
     ├─ ClientLogUploadWorker  (загрузка логов каждые 5 мин)
     ├─ BrowserActivityService (история браузера каждую минуту)
     └─ PcSessionService       (регистрация загрузки ПК)
```

---

## Часть 2 — Шифрование всех данных

**Каждый пакет данных клиент → сервер шифруется:**

```
Ключ шифрования (EncryptionKey из appsettings.json)
         ↓
PBKDF2-SHA256 (10 000 итераций, соль "BelfProctorSalt")
         ↓
32-байтный AES-ключ
         ↓
AES-256-CBC с случайным IV (16 байт)
         ↓
[IV (16 байт)] + [зашифрованные данные]
         ↓
Отправляется как application/octet-stream
```

Сервер при получении:
1. Берёт первые 16 байт → это IV
2. Дешифрует остаток тем же ключом
3. Если первичный ключ не подошёл → пробует `ENCRYPTION_KEYS` (список запасных)
4. Если ни один не подошёл → `400 Decryption failed`

---

## Часть 3 — Поток Heartbeat (каждые 60 секунд)

```
ProctorWorker._heartbeatTimer срабатывает
         ↓
SendHeartbeatAsync()
  Собирает данные:
  ├─ ClientId, Version, Machine, OS
  ├─ UptimeSeconds (время работы процесса)
  ├─ WS-статус (ConnectivityState.WsConnected)
  └─ Memory (WorkingSet, PrivateMemory)
         ↓
Шифрует → POST /api/heartbeat
         ↓
Сервер:
  ├─ Расшифровывает
  ├─ Если клиент новый → auto-регистрация (saveClient)
  ├─ Обновляет Client.lastSeen, Client.lastHeartbeat
  ├─ Создаёт запись в Heartbeat table
  ├─ Если version совпадает с UpdateDeployment → помечает как "confirmed"
  └─ Проверяет очередь uninstall → если есть, возвращает в ответе
         ↓
Клиент получает ответ:
  ├─ Если ok: true → следующий heartbeat через 60 сек
  │    └─→ HeartbeatSucceeded event → PcSessionService отправляет Boot
  │    └─→ FlushPendingAsync() (отправить накопленные данные)
  └─ Если ошибка → retry через 5 секунд
```

**HeartbeatGapDetector (фоновый job, каждые 60 сек на сервере):**
```
Ищет клиентов где lastHeartbeat > 10 минут назад
         ↓
Для каждого такого клиента:
  ├─ Есть открытая PcSession? → закрывает (shutdownAt = lastHeartbeat)
  └─ Нет PcSession? → создаёт синтетическую сессию
       (bootAt = lastHeartbeat - 1 мин, shutdownAt = lastHeartbeat)
```

---

## Часть 4 — Поток PC Session (загрузка/выключение ПК)

```
ПК включается → Windows Service стартует
         ↓
PcSessionService.StartAsync()
  ├─ Читает last_boot.json из %LOCALAPPDATA%\BelfProctor\
  ├─ Вычисляет время загрузки: DateTime.UtcNow - Environment.TickCount64
  ├─ Если сохранённый bootId совпадает с текущим временем загрузки (±30 сек)
  │    → повторный запуск агента без перезагрузки ПК → bootId тот же
  └─ Иначе → новый bootId (GUID), _bootSent = false
         ↓
HeartbeatSucceeded срабатывает (первый успешный heartbeat)
         ↓
SendPcSessionEventAsync("Boot", bootAt, bootId)
  └─→ POST /api/pc-session
         ↓
Сервер:
  └─ prisma.pcSession.upsert(where: {bootId})
       Idempotent: повторная отправка с тем же bootId — безопасна

ПК выключается / пользователь выходит:
         ↓
SystemEvents.SessionEnding срабатывает
         ↓
SendPcSessionEventAsync("Shutdown", DateTime.UtcNow, bootId)
  Синхронный вызов с таймаутом 3 сек (ОС ждёт завершения)
         ↓
Сервер: обновляет PcSession.shutdownAt для этого bootId
```

---

## Часть 5 — Поток активности пользователя

```
ActivityMonitorService (таймер 1 секунда):
  └─ GetLastInputInfo() — Win32 API
  └─ Считает сколько мс прошло с последнего ввода
         ↓
  Если idle < InactivityThreshold (3 мин по умолчанию):
    → IsUserActive = true
    → activeStopwatch.Start()
  Иначе:
    → IsUserActive = false
    → inactiveStopwatch.Start()
         ↓
  При смене состояния → ActivityChanged event
    └─→ ProctorWorker.OnActivityChanged → SendActivitySnapshot()

ProctorWorker._activityReportTimer (каждые 1 мин):
  └─→ SendActivitySnapshot()
         ↓
DataTransmissionService.SendActivityAsync(isActive, activeMs, inactiveMs)
  └─ Шифрует → POST /api/activity
         ↓
Сервер:
  ├─ appendActivity() → запись в Activity table
  └─ ingestActivityToTimesheetAndClient():
       ├─ Считает дельту с предыдущей записью
       └─ TimesheetDay.upsert(clientId, date) → прибавляет миллисекунды
```

---

## Часть 6 — Поток скриншотов

```
ProctorWorker.RunScreenshotLoop():
  ├─ Немедленный снимок при старте
  └─ PeriodicTimer (5 минут)
         ↓
ScreenshotService.CaptureScreenshotAsync()
  ├─ GetSystemInformation.VirtualScreen → границы всех мониторов
  ├─ Bitmap(width, height)
  ├─ Graphics.CopyFromScreen() для каждого экрана
  ├─ Сохраняет как JPEG (quality из настроек, default 75)
  └─ Путь: %LOCALAPPDATA%\BelfProctor\Screenshots\screenshot_{clientId}_{timestamp}.jpg
         ↓
DataTransmissionService.SendScreenshotAsync(filePath)
  ├─ Берёт DateTime.UtcNow как timestamp
  ├─ Шифрует файл потоково (CombinedStream: IV + CryptoStream)
  ├─ POST /api/screenshots (multipart/form-data)
  │    fields: screenshot (file), clientId, timestamp
  └─ Если успешно → удаляет локальный файл
     Если ошибка → перемещает в Pending/Screenshots/ → retry
         ↓
Сервер (routes/files.ts):
  ├─ Multer сохраняет во временную папку
  ├─ Определяет правильный ключ дешифрования
  ├─ decryptFileStream() → storage/screenshots/{clientId}/{timestamp}.jpg
  ├─ Разбирает timestamp из запроса, reconcile с авторитетным временем
  └─ prisma.screenshot.create() → запись в БД
         ↓
Отображение в UI:
  └─ GET /api/screenshots (список, пагинация 50/страница)
  └─ GET /api/screenshots/{filename}/file → отдаёт файл
```

**Поток pending при недоступном сервере:**
```
Нет соединения с сервером
         ↓
Скриншот не отправился
         ↓
Перемещается в Pending/Screenshots/{clientId}_{UTC_timestamp}Z.jpg
  └─ Сохраняется sidecar: .jpg.json (метаданные)
  └─ TrimPendingDirectory → хранится максимум 5 штук (старые удаляются)
         ↓
При восстановлении соединения (heartbeat success / network event):
  └─ FlushPendingAsync()
       └─ Отправляет 1 pending скриншот за flush
       └─ Timestamp берётся из имени файла (оригинальное время захвата)
```

---

## Часть 7 — Поток системных событий (USB, процессы, сеть)

```
SystemMonitorService.StartAsync()
  ├─ WMI EventWatcher: __InstanceCreationEvent Win32_Process
  │    → ProcessStarted/ProcessStopped события
  │    └─ Фильтрует системные процессы (60+ в whitelist)
  │
  ├─ WMI EventWatcher: Win32_VolumeChangeEvent
  │    → USBConnected / USBDisconnected
  │    └─ При подключении: сканирует содержимое диска (ScanUsbDrive)
  │         └─ Сохраняет snapshot файлов
  │    └─ При отключении: сравнивает snapshot → фиксирует изменения
  │
  └─ Таймер 1 минута: MonitorNetworkConnections()
       └─ TCPTable через GetExtendedTcpTable Win32 API
       └─ Фиксирует новые внешние соединения
         ↓
OnSystemEventOccurred(SystemEvent):
  └─→ _dataTransmissionService.SendSystemEventAsync(event)
       └─ Добавляет в ConcurrentQueue
         ↓
_eventBatchTimer (каждые 10 секунд):
  └─ FlushEventBatchAsync()
       ├─ Если очередь пустая → пропускает
       ├─ Берёт до 50 событий
       ├─ Шифрует → POST /api/events
       └─ Если ошибка → сохраняет в Pending/Events/
         ↓
Сервер (routes/events.ts):
  ├─ ProcessStarted → фильтруется (не сохраняется в Event)
  ├─ AppUsage → upsertAppStat(clientId, processName) → AppUsage table
  └─ Остальные → appendEvent() → Event table
```

---

## Часть 8 — Поток истории браузера

```
BrowserActivityService (каждую минуту):
  ├─ Ищет профили Chrome: %LOCALAPPDATA%\Google\Chrome\User Data\*\History
  ├─ Ищет профили Firefox: %APPDATA%\Mozilla\Firefox\Profiles\*\places.sqlite
  └─ Ищет профили Edge: %LOCALAPPDATA%\Microsoft\Edge\User Data\*\History

Для каждого найденного профиля:
  ├─ Копирует SQLite файл во temp (браузер держит оригинал залоченным)
  ├─ Читает visits где last_visit_time > последнее сохранённое время
  ├─ Конвертирует Chrome-время (microseconds since 1601) → UTC DateTime
  ├─ Firefox: microseconds since Unix epoch
  └─ Обновляет _lastSeenMicros[profile] → сохраняет в state.json
         ↓
Накапливает визиты → отправляет пачкой:
  └─ POST /api/browser-activity (зашифрованный JSON массив)
         ↓
Сервер (routes/browserActivity.ts):
  ├─ Для каждого визита: extractDomain(url) → domain
  ├─ reconcileTime(visitedAt) → проверка что timestamp реалистичный
  └─ prisma.browserActivity.create() по одному
       └─ Дубли отклоняются через functional index md5(url) (P2002 → skip)
         ↓
Отображение в UI:
  └─ Модал "История браузера" в карточке сотрудника
  └─ Группировка по доменам, топ-10 сайтов
```

---

## Часть 9 — Поток рабочих сессий (Work Tracking)

```
WorkTrackingService (каждые 2 секунды):
  └─ ForegroundWindowSnapshot.Capture()
       ├─ GetForegroundWindow() Win32 → HWND
       ├─ GetWindowText() → заголовок окна
       └─ GetWindowThreadProcessId() → Process.GetProcessById() → имя процесса
         ↓
Resolve(snapshot) через цепочку адаптеров:
  1. AutoCadComAdapter  → открытые файлы AutoCAD через COM-интерфейс
  2. BrowserAdapter     → URL из заголовка вкладки (Chrome, Firefox, Edge)
  3. OfficeGenericAdapter → открытый файл Excel/Word/PowerPoint из заголовка
  4. PdfGenericAdapter  → имя PDF из заголовка Acrobat/Foxit
  5. GenericForegroundAdapter → просто имя процесса + заголовок окна
         ↓
Получаем WorkArtifactCandidate:
  {SessionKey, ProcessName, WindowTitle, FilePath, FolderPath, ProjectName}
         ↓
Если SessionKey изменился (другое приложение/файл):
  ├─ EndCurrentAsync("switch") → отправляет "end" событие предыдущей сессии
  └─ Начинает новую ActiveWorkSession
       └─ SendEventAsync(session, "start") → POST /api/work/events
         ↓
Каждые 2 секунды пока сессия активна:
  └─ Обновляет openedMs, focusedMs, activeFocusedMs (если пользователь активен)
  └─ Каждые 30 секунд → SendEventAsync(session, "snapshot")
         ↓
Сервер (routes/work.ts):
  ├─ resolveProjectFromPath(filePath, roots, aliases)
  │    └─ Проверяет ProjectRoot таблицу → находит проект по пути
  ├─ classifyActivity({processName, windowTitle, filePath})
  │    └─ Определяет category (productive/meeting/communication/etc.)
  │    └─ Определяет confidence (high/medium/low)
  ├─ prisma.workSession.upsert(where: {id: sessionId})
  └─ prisma.workSessionEvent.create({eventId, ...})
       └─ Дубли по eventId → skip (P2002)
         ↓
Отображение в UI:
  └─ Вкладка "Проекты/Файлы" в карточке сотрудника
  └─ Таймлайн сессий, суммарное время по проектам
```

---

## Часть 10 — Поток команд (сервер → клиент)

### 10.1 WebSocket подключение

```
CommandChannelWorker.ExecuteAsync():
  └─ ConnectAsync() — перебирает кандидатов:
       1. ws://{ServerUrl}:{port}/ws?clientId={id}
       2. ws://localhost:8080/ws?clientId={id}
       3. ws://127.0.0.1:8080/ws?clientId={id}
         ↓
  Устанавливает WebSocket соединение
  └─ KeepAliveInterval = 20 секунд (пинг-понг)
  └─ ConnectivityState.SetWsConnected(true)
         ↓
  Loop: ждёт сообщения от сервера
  При получении JSON → CommandHandler.HandleAsync(cmd)
```

### 10.2 Типы команд

```
"setIntervals" — изменить интервалы опроса:
  ├─ screenshotMs, heartbeatMs, policyMs, directoryMs
  └─ Сохраняет в %LOCALAPPDATA%\BelfProctor\appsettings.json

"list" — листинг директории:
  ├─ basePath (по умолчанию %LOCALAPPDATA%\BelfProctor)
  ├─ pattern (маска файлов)
  ├─ recursive (рекурсивно)
  └─ Возвращает: {files: [...], directories: [...]}

"file" — скачать файл:
  └─ POST /api/commands/{id}/result (зашифрованный файл)

"folder" — скачать папку:
  └─ Архивирует в .zip → POST /api/commands/{id}/result

"stream.start" / "stream.stop" — управление стримингом экрана

"update" — обновить клиент:
  ├─ downloadUrl + sha256
  ├─ Скачивает → верифицирует sha256
  └─ Запускает новый установщик → перезапускает сервис

"uninstall" — удалить клиент:
  └─ UninstallHelper.StartUninstall() → PowerShell sc.exe delete
```

### 10.3 Отправка команды из UI

```
Администратор нажимает кнопку в UI
         ↓
POST /api/commands/send
  └─ {clientId, type, payload, commandId}
         ↓
wsHub.sendCommandToClient(clientId, command)
  └─ Находит WebSocket соединение клиента
  └─ ws.send(JSON.stringify(command))
         ↓
Клиент получает → обрабатывает → отправляет результат:
  └─ POST /api/commands/{id}/json или /api/commands/{id}/result
         ↓
Сервер сохраняет → UI опрашивает:
  └─ GET /api/commands/{id}/file/latest → возвращает файл или 202 Pending
```

---

## Часть 11 — Поток стриминга экрана (LiveView)

```
Администратор открывает LiveView в UI
         ↓
WebSocket подключение браузера: ws://server/ws/admin/stream/{clientId}
         ↓
Сервер: registerStreamViewer(clientId, viewer_ws)
  └─ sendCommandToClient(clientId, {type: "stream.start", fps: 10})
         ↓
Клиент: StreamingService.StartAsync(fps=10)
  └─ Таймер: 1000/fps = 100 мс (10 fps)
  └─ CaptureFrame():
       ├─ ScreenshotService.CaptureScreenshotToFileAsync() → файл
       ├─ Сжимает до width px (из команды)
       └─ Конвертирует в Base64 JPEG
         ↓
Клиент отправляет frame по WebSocket:
  └─ ws.send(JSON.stringify({type: "frame", data: "base64..."}))
         ↓
Сервер перенаправляет всем viewer'ам этого клиента
         ↓
Браузер администратора получает → отображает в <img src="data:...">
         ↓
При закрытии UI → WebSocket закрывается
  └─ Сервер: unregisterStreamViewer() → если viewer'ов 0:
       └─ sendCommandToClient(clientId, {type: "stream.stop"})
```

---

## Часть 12 — Поток обновления клиента

```
Администратор загружает новый .exe в UI
         ↓
POST /api/updates (multipart, бинарник)
  ├─ Вычисляет SHA256 хэш файла
  ├─ Сохраняет в storage/updates/{version}/BelfProctor.exe
  └─ prisma.agentVersion.create({version, sha256, size})
         ↓
POST /api/updates/{version}/deploy
  └─ Для выбранных клиентов:
       └─ prisma.updateDeployment.create({clientId, version, status: "queued"})
         ↓
При следующем heartbeat клиента:
  └─ Сервер видит pending UpdateDeployment
  └─ Отправляет через WebSocket:
       {type: "update", downloadUrl: "...", sha256: "...", version: "..."}
         ↓
Клиент: UpdateHelper.DownloadAndInstall()
  ├─ Скачивает файл по URL
  ├─ Верифицирует SHA256
  ├─ Сохраняет рядом с текущим .exe
  ├─ Запускает установщик (bat-скрипт)
  └─ Перезапускает Windows Service

Клиент перезапустился с новой версией:
  └─ heartbeat содержит новую Version
  └─ Сервер: UpdateDeployment.status → "confirmed"
```

---

## Часть 13 — Поток политик безопасности

```
При старте клиента:
  └─ PolicyService.LoadPoliciesAsync()
       └─ Читает %LOCALAPPDATA%\BelfProctor\policies.json (локальный кэш)
         ↓
policyUpdateTimer (каждые 5 минут):
  └─ GET /api/policies/{policyId} (зашифрованный ответ)
  └─ Расшифровывает → обновляет локальный кэш
         ↓
При каждом системном событии:
  └─ PolicyService.EvaluateEvent(systemEvent)
       ├─ Проверяет правила (Type: Process/USB, Action: Block/Allow)
       ├─ Если нарушение → SystemEvent(PolicyViolation) → отправляется на сервер
       └─ Если Action: Block → предпринимает действие (kill process, eject drive)
```

---

## Часть 14 — Поток логов клиента

```
.NET ILogger → RollingFileLoggerProvider
  └─ Пишет в %LOCALAPPDATA%\BelfProctor\Logs\client_{date}.log
         ↓
ClientLogUploadWorker (каждые 5 минут):
  ├─ Читает лог-файл от последней позиции (отслеживает через state.json)
  ├─ Разбивает на чанки по 50KB
  └─ Для каждого чанка:
       └─ POST /api/logs (зашифрованный JSON: {fileName, text, timestamp})
         ↓
Сервер (routes/logs.ts):
  ├─ Расшифровывает
  ├─ Определяет дату по Tashkent-времени (UTC+5)
  └─ Дозаписывает в storage/logs/clients/{clientId}/{date}.log
         ↓
Администратор:
  └─ GET /api/logs?clientId=...&date=... → читает файл целиком
```

---

## Часть 15 — Auto-Discovery сервера (при неизвестном IP)

```
Если ServerUrl не задан или недоступен:
         ↓
TryInitializeBaseAddress():
  1. Пробует настроенный ServerUrl (таймаут 2 сек)
  2. localhost:8080/api/heartbeat/latest
  3. 127.0.0.1:8080
  4. IP-адрес шлюза сети (из сетевых интерфейсов) :8080
  5. {subnet}.1:8080 и {subnet}.254:8080
         ↓
Каждый кандидат: GET /api/heartbeat/latest (таймаут 1 сек)
  └─ Если 200 OK → сохраняет как _currentBaseUrl
  └─ Если нет → следующий кандидат
         ↓
Если найден → все запросы идут на этот URL
Если не найден → данные копятся в Pending, retry при следующем сетевом событии
```

---

## Часть 16 — Табель и статистика (Admin UI)

### Как считается табель

```
Данные Activity из БД (ActiveMs, InactiveMs за каждый отчётный период)
         ↓
TimesheetDay таблица (создаётся/обновляется при каждой записи Activity):
  ├─ clientId + date (уникально)
  ├─ activeMs = сумма активных миллисекунд за день
  └─ presenceMs = activeMs + inactiveMs (всё время за ПК)
         ↓
GET /api/clients/{id}/daily-summary?date=YYYY-MM-DD
  ├─ Читает TimesheetDay за дату
  ├─ Читает первую и последнюю Activity за день (начало/конец рабочего дня)
  └─ Вычисляет:
       ├─ activePercent = activeMs / presenceMs * 100
       ├─ workStart = min(timestamp) за день
       ├─ workEnd = max(timestamp) за день
       └─ lateArrival = workStart > scheduleStart (9:00 по умолчанию)
         ↓
GET /api/clients/{id}/monthly-summary?month=YYYY-MM
  ├─ Агрегирует TimesheetDay за все дни месяца
  └─ Считает среднее по всем клиентам для сравнения
```

### Экспорт данных

```
Excel (табель):
  └─ GET /api/clients/monthly-export
       ├─ Читает TimesheetDay за месяц для всех клиентов
       └─ Генерирует XLSX через библиотеку xlsx

PDF (скриншоты):
  └─ MonthlyScreenshotsPdf компонент (клиентская генерация)
       ├─ Загружает скриншоты за период
       ├─ pdf-lib добавляет изображения на страницы
       └─ Скачивает как .pdf файл
```

---

## Часть 17 — Жизненный цикл данных и хранение

### Что где хранится и сколько

```
PostgreSQL (Prisma):
  ┌──────────────────────────┬──────────────┬─────────────────┐
  │ Таблица                  │ Кол-во строк │ Срок хранения   │
  │                          │ (60 клиентов)│                 │
  ├──────────────────────────┼──────────────┼─────────────────┤
  │ Heartbeat                │ ~86 400/сут  │ 2 дня           │
  │ Activity                 │ ~86 400/сут  │ 30 дней         │
  │ Event                    │ ~50 000/сут  │ 30 дней         │
  │ AppUsage                 │ ~5 000 всего │ 30 дней         │
  │ BrowserActivity          │ ~10 000/сут  │ нет очистки ⚠️  │
  │ Screenshot               │ ~720/сут     │ 30 дней         │
  │ WorkSession              │ ~3 000/сут   │ нет очистки ⚠️  │
  │ TimesheetDay             │ 60/сут       │ нет очистки ⚠️  │
  │ PcSession                │ ~60/сут      │ нет очистки ⚠️  │
  └──────────────────────────┴──────────────┴─────────────────┘

Файловая система:
  storage/screenshots/ → ~28 MB/час, ~20 GB/месяц (30-day retention)
  storage/logs/        → ~50 MB/месяц (нет retention ⚠️)
  storage/reports/     → зависит от частоты (нет retention ⚠️)
```

### Retention job

```
При запуске сервера + каждые 6 часов:
  └─ runRetentionOnce():
       ├─ Скриншоты > 30 дней → File.Delete + prisma.screenshot.delete
       ├─ Activity > 30 дней → prisma.activity.deleteMany
       ├─ Heartbeat > 2 дней → prisma.heartbeat.deleteMany
       ├─ AppUsage (Event) > 30 дней → prisma.event.deleteMany
       └─ CommandResult > 7 дней → prisma.commandResult.deleteMany
```

---

## Итоговая схема потоков данных

```
                    ┌──────────────────────────────────────┐
                    │         ПК СОТРУДНИКА                │
                    │                                      │
  Клавиши/мышь ──→ │ ActivityMonitor ─────────────────────┼──→ /activity (60 сек)
  Процессы ──────→ │ SystemMonitor (WMI) ─────────────────┼──→ /events (10 сек batch)
  USB-диски ─────→ │ SystemMonitor (WMI) ─────────────────┼──→ /events (при событии)
  Экран ─────────→ │ ScreenshotService ───────────────────┼──→ /screenshots (5 мин)
  Браузер ───────→ │ BrowserActivityService ──────────────┼──→ /browser-activity (60 сек)
  Активное окно ─→ │ WorkTrackingService ─────────────────┼──→ /work/events (30 сек)
  Загрузка/выкл ─→ │ PcSessionService ────────────────────┼──→ /pc-session (при событии)
  Здоровье ──────→ │ ProctorWorker ───────────────────────┼──→ /heartbeat (60 сек)
  Логи ──────────→ │ ClientLogUploadWorker ───────────────┼──→ /logs (5 мин)
  Политики ←─────→ │ PolicyService ←──────────────────────┼──← /policies (5 мин)
  Команды ←──────→ │ CommandChannelWorker ←───────────────┼──↔ WebSocket (постоянно)
                    └──────────────────────────────────────┘
```

---

*Документ описывает состояние системы на 2026-06-15. При изменении компонентов документ должен обновляться.*
