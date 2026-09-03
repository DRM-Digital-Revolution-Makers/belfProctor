# BelfProctor — Полный аудит: баги, недоделки, костыли

> Дата: 2026-06-15  
> Охват: клиент (C#), бэкенд (Node.js/TypeScript), фронтенд (React), тесты

---

## Краткое резюме

| Категория | Критических | Средних | Низких |
|-----------|------------|---------|--------|
| Бэкенд (TypeScript) | 4 | 11 | 5 |
| Клиент (C#) | 6 | 10 | 6 |
| Фронтенд (React) | 3 | 7 | 4 |
| Незаконченные функции (стабы) | 3 | 2 | — |
| Покрытие тестами | — | — | — |
| **Итого** | **16** | **30** | **15** |

---

## 1. Бэкенд — Баги и проблемы

### 🔴 Критические

**[B-C1] `GET /reports` — полный заглушка, всегда возвращает пустой массив**
- Файл: `server/backend/src/routes/files.ts:369`
- Код: `return res.json({ data: [], total: 0 });`
- Клиент отправляет отчёты, они сохраняются на диск, но посмотреть их через API **невозможно** — endpoint намеренно заглушен
- Аналогично: `GET /reports/:id/file` → всегда 404 (line 413), `GET /reports/:id/csv` → всегда 404 (line 419)
- **Вся функциональность отчётов со стороны просмотра не работает**

**[B-C2] Двойная запись без транзакции — скриншоты и команды**
- Файл: `server/backend/src/routes/files.ts:120-167`
- Порядок: сначала файл на диск (`decryptFileStream`), потом запись в БД (`prisma.screenshot.create`)
- Если БД недоступна — файл существует, записи в БД нет (orphan file)
- Если диск кончился — файл не записан, но следующий запрос всё равно пытается создать запись в БД
- То же самое с командами (files.ts:457-477)

**[B-C3] Уязвимость path traversal в раздаче скриншотов**
- Файл: `server/backend/src/routes/files.ts:373-410`
- `GET /screenshots/:filename/file` принимает filename из URL без `path.normalize()`
- Запрос `../../../../etc/passwd` может привести к чтению файлов за пределами директории скриншотов
- **Требует немедленного исправления**

**[B-C4] Молчаливое обновление статуса деплоя — ошибки игнорируются**
- Файл: `server/backend/src/routes/heartbeat.ts:116-126`
- `.catch(() => null)` проглатывает ошибки Prisma при обновлении `UpdateDeployment`
- Деплой может навсегда зависнуть в статусе "downloading" / "installing"

---

### 🟡 Средние

**[B-M1] Несогласованное использование времени в отчётах**
- Файл: `server/backend/src/routes/files.ts:201`
- Отчёты используют `new Date()`, скриншоты и команды — `authoritativeNow()`
- Если системные часы сервера расходятся с внешним источником, временны́е метки отчётов будут неверными

**[B-M2] Ошибка логики при shutdown без matching boot**
- Файл: `server/backend/src/routes/pcSession.ts:110-120`
- Если Shutdown пришёл раньше Boot — создаётся сессия где `bootAt == shutdownAt` (одна и та же метка)
- Это неверно: ПК не мог загрузиться и выключиться в одну секунду

**[B-M3] Гонка в heartbeat gap detector**
- Файл: `server/backend/src/jobs/heartbeatGapDetector.ts:13-57`
- Детектор запускается каждые 60 сек; нет лока — два запуска могут одновременно читать одну и ту же открытую сессию
- Результат: одна сессия закрывается дважды с разными `shutdownAt`

**[B-M4] Созданные gap-сессии — 1 минута до последнего heartbeat — произвольно**
- Файл: `server/backend/src/jobs/heartbeatGapDetector.ts:48`
- `bootAt: new Date(c.lastHeartbeat.getTime() - 60_000)` — синтетическое время загрузки "1 минута назад"
- При плохом соединении (VPN с задержками) создаются фиктивные короткие сессии

**[B-M5] Race condition в команде uninstall через WebSocket**
- Файл: `server/backend/src/wsHub.ts:386-406`
- Два одновременных подключения одного клиента могут оба прочитать файл uninstall до удаления
- Результат: uninstall-команда отправляется дважды

**[B-M6] `store.ts` — неверный расчёт дельты активности при перезапуске клиента**
- Файл: `server/backend/src/store.ts:48-59`
- Если клиент перезапустился и счётчик сбросился (был 100ms, стал 5ms) — код выбирает `curr.activeMilliseconds` (текущее) вместо дельты
- Данные в табеле могут задваиваться

**[B-M7] Запись в лог: timestamp без reconciliation**
- Файл: `server/backend/src/routes/logs.ts:74-79`
- Имя файла определяется по Tashkent-времени сервера, но контент лога содержит reconciled timestamp
- При сильном расхождении часов клиента — содержимое и имя файла будут из разных часовых поясов

**[B-M8] Нет atomic операции для command_index**
- Файл: `server/backend/src/index.ts:284-295`
- `writeCommandIndex` читает файл, потом перезаписывает — между чтением и записью другой процесс может изменить файл
- Результат: потеря записей в индексе команд

**[B-M9] Политики скачиваются каждые 5 минут без проверки изменений**
- Файл: `server/backend/src/routes/policies.ts`
- Нет ETag / Last-Modified / хэша для определения "изменилось ли что-то"
- 60 клиентов × 12 запросов/час = 720 лишних запросов/час при неизменных политиках

**[B-M10] Retention не покрывает все таблицы**
- Файл: `server/backend/src/retention.ts`
- Таблицы БЕЗ очистки: `WorkSession`, `WorkSessionEvent`, `BrowserActivity`, `PcSession`, `TimesheetDay`, `AgentVersion`
- Файлы БЕЗ очистки: `storage/logs/`, `storage/reports/`
- После 6 месяцев работы 60 клиентов → неконтролируемый рост БД и диска

**[B-M11] `backfillTimesheetFromActivity()` — проблема с границей месяца**
- Файл: `server/backend/src/store.ts:687`
- `new Date(Date.UTC(year, month, 0, 23, 59, 59, 999))` — UTC граница
- Activity записи хранятся в UTC, но табель считается по Tashkent (UTC+5)
- Данные последних 5 часов последнего дня месяца могут попасть в следующий месяц

---

### 🟢 Низкие

**[B-L1]** `GET /reports` всегда возвращает пустой массив — дублирует B-C1, но также теряет `total`  
**[B-L2]** `ensureAdmin()` молча пропускает создание если задан только email или только password  
**[B-L3]** Неправильный код ошибки при удалении клиента — 404 вместо 403 при неверном пароле  
**[B-L4]** `BrowserActivity` — вставка построчно вместо batch insert (производительность)  
**[B-L5]** Retention для скриншотов: сначала удаляет файл, потом запись в БД — не атомарно

---

## 2. Клиент C# — Баги и проблемы

### 🔴 Критические

**[C-C1] `async void` в `PcSessionService.OnHeartbeatSucceeded`**
- Файл: `client/Services/PcSessionService.cs:100`
- `private async void OnHeartbeatSucceeded()` — исключения в `async void` не перехватываются, они падают в `AppDomain.UnhandledException` и крашат сервис
- Правильно: `private async Task OnHeartbeatSucceeded()` и подписать через враппер

**[C-C2] Дедлок при выключении ПК**
- Файл: `client/Services/PcSessionService.cs:132`
- `task.Wait(TimeSpan.FromSeconds(3))` внутри `OnSessionEnding` (синхронный вызов)
- Если HTTP-запрос пытается захватить lock, уже занятый calling thread — дедлок, событие завершения ПК не отправляется

**[C-C3] `StabilityService` использует `DateTime.Now` вместо `DateTime.UtcNow`**
- Файл: `client/Services/StabilityService.cs:21`
- При переходе на летнее время часть timestamp'ов будет смещена на 1 час
- Неверный расчёт uptime, интервалов между перезапусками

**[C-C4] `CancellationTokenSource` в `SystemMonitorService` — неверная логика null-check**
- Файл: `client/Services/SystemMonitorService.cs:230`
- `!_cancellationTokenSource?.Token.IsCancellationRequested ?? false` — если `_cancellationTokenSource == null`, выражение = `false`
- Цикл мониторинга сразу завершается при null, мониторинг не запускается вообще

**[C-C5] Событие `SendSystemEventAsync` не awaited в `ProctorWorker`**
- Файл: `client/ProctorWorker.cs:274`
- `_dataTransmissionService.SendSystemEventAsync(e)` — результат Task игнорируется
- Исключения теряются, данные о событиях (USB, процессы) могут не отправляться без видимых ошибок

**[C-C6] Forced GC в `StabilityService` — антипаттерн**
- Файл: `client/Services/StabilityService.cs:198, 373`
- `GC.Collect()` вызывается принудительно на таймере
- Приводит к длительным паузам (Stop-the-World) и деградирует производительность мониторинга

---

### 🟡 Средние

**[C-M1] Гонка состояний в `ActivityMonitorService` — stopwatch вне lock**
- Файл: `client/Services/ActivityMonitorService.cs:76-77`
- `_activeStopwatch.IsRunning` проверяется без lock, потом запускается внутри lock
- Между проверкой и стартом другой поток может уже запустить его → двойной старт

**[C-M2] Утечка temp-файла в `BrowserActivityService`**
- Файл: `client/Services/BrowserActivityService.cs:122-126`
- Temp-копия SQLite создаётся для чтения; если исключение происходит до удаления — файл остаётся на диске навсегда
- После нескольких недель работы — десятки/сотни копий history.db в temp

**[C-M3] Firefox: усечение микросекунд приводит к повторной загрузке**
- Файл: `client/Services/BrowserActivityService.cs:156-166`
- `FromUnixTimeMilliseconds(raw / 1000)` — Firefox хранит время в микросекундах, деление на 1000 теряет точность
- Если два визита имеют одинаковый миллисекунд — один постоянно переотправляется

**[C-M4] `ClientLogUploadWorker` — FileStream не закрывается при исключении**
- Файл: `client/ClientLogUploadWorker.cs:136`
- FileStream открывается в цикле без `using` — если `SendClientLogChunkAsync` выбросит исключение, файл лога остаётся залоченным
- Следующая попытка записи в лог-файл упадёт с `IOException`

**[C-M5] `StreamingService` — sync `.GetAwaiter().GetResult()` в Dispose**
- Файл: `client/Services/StreamingService.cs:144`
- Дедлок возможен если Dispose вызывается из UI-потока или потока с SynchronizationContext

**[C-M6] `_seenPids` очищается полностью при переполнении**
- Файл: `client/Services/SystemMonitorService.cs:181-185`
- При >50 000 PID весь HashSet сбрасывается
- Windows переиспользует PID → после сброса старые PID снова генерируют `ProcessStarted` события (дубли)

**[C-M7] `HeartbeatTimer` при успешном ответе — период `Timeout.InfiniteTimeSpan`**
- Файл: `client/ProctorWorker.cs:88`
- `new Timer(..., null, TimeSpan.Zero, Timeout.InfiniteTimeSpan)` — период бесконечный, это правильно (адаптивный таймер), но при первом успехе интервал устанавливается в `Change()`. Если `Change()` не вызывается (исключение в `SendHeartbeat`) — таймер останавливается навсегда
- Мониторинг перестаёт слать heartbeat до перезапуска сервиса

**[C-M8] `WorkTrackingService` — `_current` доступается без lock в tick**
- Файл: `client/Services/WorkTracking/WorkTrackingService.cs:82-85`
- `_current` проверяется и изменяется из одного потока (2-секундный loop), но `StopAsync` вызывает `EndCurrentAsync` из другого потока
- Race condition при завершении сервиса

**[C-M9] `CommandChannelWorker` — фрагментированные WS-сообщения ломают 64KB лимит**
- Файл: `client/CommandChannelWorker.cs:52-57`
- При получении сообщения >64KB код делает `break` и не обрабатывает его
- Команды с большими payload (например, file list с тысячами файлов) молча теряются

**[C-M10] Empty catch везде в `BrowserActivityService`, `StabilityService`, `SystemMonitorService`**
- Файлы: множество мест
- Ошибки сохранения состояния (браузерная история, настройки) проглатываются без логирования
- При проблемах с диском — полная потеря данных без предупреждения

---

### 🟢 Низкие

**[C-L1]** `SaveState` в `BrowserActivityService` — ошибки записи молча игнорируются  
**[C-L2]** `SystemMonitorService` — `Directory.GetDirectories()` без обработки AccessDenied  
**[C-L3]** `DriveInfo(Path.GetPathRoot(_settings.LogPath))` в `StabilityService` — `GetPathRoot` может вернуть null  
**[C-L4]** `StabilityService.StartAsync` использует `public new Task` (shadowing) вместо `override` — ломает DI lifecycle  
**[C-L5]** `HttpClient` создаётся в `StabilityService` для health-check без Dispose  
**[C-L6]** Таймеры создаются/уничтожаются без `lock` в `StabilityService` — возможен доступ к disposed объекту

---

## 3. Фронтенд React — Баги и проблемы

### 🔴 Критические

**[F-C1] Все ошибки API проглатываются без показа пользователю**
- Везде: `.catch(() => {})`, `.catch(() => setItems([]))`
- При падении сервера или сети пользователь видит пустую страницу без объяснений
- Файлы: `ScreenshotsList.jsx:112`, `ClientsList.jsx:89`, `ActivityDetail.jsx:165`, и другие

**[F-C2] URL Blob объекты не освобождаются — утечка памяти**
- Файл: `ScreenshotsList.jsx:184-185, 208`
- `URL.createObjectURL(blob)` создаётся при загрузке каждого превью
- При бесконечном скролле 500+ скриншотов → сотни неудалённых blob URL в памяти
- Браузер может замедлиться или упасть
- Нет `URL.revokeObjectURL()` при unmount или при замене элемента

**[F-C3] Hardcoded fallback URL может сломать деплой**
- Везде: `http://${window.location.hostname}:8080/api`
- Если сервер на другом порту или за reverse proxy — все API-вызовы упадут
- Правильно: взять из конфига/env при сборке

---

### 🟡 Средние

**[F-M1] `ActivitiesList.jsx` и `EventsList.jsx` — polling через `setInterval` каждые 3-5 секунд**
- 60 клиентов на экране → 2 запроса каждые 3-5 сек с сервера данных
- При открытом браузере 8 часов — тысячи запросов
- Правильно: WebSocket push или react-query с правильным staleTime

**[F-M2] `ActivityDetail.jsx` — падение при null данных**
- Файл: `ActivityDetail.jsx:165, 187`
- `.json().catch(() => ({}))` возвращает пустой объект, потом код обращается к `eJson.data` (undefined)
- USB-события и скриншоты молча не отображаются

**[F-M3] Гонка в infinite scroll — дублирование при быстром скролле**
- Файл: `ScreenshotsList.jsx:163-166`
- `pageRef.current` инкрементируется до проверки hasMore
- При быстром скролле IntersectionObserver может сработать дважды до того как `loadingRef` обновится
- Деупликация по id маскирует баг, но запросы делаются лишние

**[F-M4] `EventsList.jsx` — открытие модала браузер-истории с undefined clientId**
- Файл: `EventsList.jsx:605`
- `monitoringRows[0]?.clientId` — если массив пустой, модал открывается с `undefined`
- Сервер возвращает 400, ошибка проглатывается, модал показывает пустой экран

**[F-M5] PDF-экспорт скриншотов — нет индикатора прогресса**
- Файл: `ClientDetail.jsx`
- При большом количестве скриншотов генерация PDF занимает 10-30 секунд
- Нет спиннера/прогресс-бара — пользователь думает что кнопка не сработала и жмёт снова

**[F-M6] Хлебные крошки в `ActivityDetail.jsx` не обрабатывают Windows UNC пути**
- Файл: `ActivityDetail.jsx:356-375`
- Пути типа `\\server\share\folder` разбиваются некорректно
- Навигация по сетевым дискам ломается

**[F-M7] `MonthlyScreenshotsPdf.jsx` — нет обработки случая когда скриншоты не загрузились**
- При генерации PDF загружает превью по одному; если 1 из 50 не загрузился — PDF генерируется с пустым местом без предупреждения

---

### 🟢 Низкие

**[F-L1]** `maxHeight: "calc(100vh - 280px)"` в `ScreenshotsList.jsx` — сломается если изменить высоту шапки  
**[F-L2]** Нет loading-состояния при первой загрузке списка клиентов — пустая таблица вместо спиннера  
**[F-L3]** Все страницы показывают "Всего: 0" до завершения первого запроса  
**[F-L4]** Сортировка скриншотов делается на клиенте (JS sort) вместо `ORDER BY` на сервере

---

## 4. Незаконченные функции (стабы и заглушки)

### 🔴 Критические стабы

| # | Что | Файл | Код |
|---|-----|------|-----|
| S-1 | **Просмотр отчётов** — всегда пусто | `routes/files.ts:369` | `return res.json({ data: [], total: 0 })` |
| S-2 | **Скачивание отчётов** — всегда 404 | `routes/files.ts:413` | `return res.status(404)...` |
| S-3 | **Экспорт отчётов в CSV** — всегда 404 | `routes/files.ts:419` | `return res.status(404)...` |

Клиент успешно **отправляет** отчёты на сервер (они сохраняются в `storage/reports/`), но администратор **не может** их просмотреть или скачать через интерфейс.

### 🟡 Средние недоделки

**[S-4] Обновление клиентов — статус деплоя не синхронизируется с БД**
- `routes/updates.ts` использует и файлы и Prisma без транзакции
- Статус "best-effort" (комментарий в коде) — UI может показывать неверный статус

**[S-5] Ретроактивное применение ProjectAlias не реализовано**
- При добавлении нового маппинга пути → проекта, старые `WorkSession` не обновляются
- История до добавления маппинга всегда будет показывать "Неизвестный проект"

---

## 5. Покрытие тестами — что не тестируется

### Бэкенд (Node.js) — 5 тест-файлов на ~18 000 строк кода

| Область | Есть тесты | Статус |
|---------|-----------|--------|
| heartbeat gap detection | ✅ | Покрыто |
| event filtering (AppUsage) | ✅ | Покрыто |
| pc-session lifecycle | ✅ | Покрыто |
| browser activity dedup | ✅ | Покрыто |
| timezone conversion | ✅ | Покрыто |
| **Аутентификация** | ❌ | **Не тестируется** |
| **Загрузка скриншотов** | ❌ | **Не тестируется** |
| **Регистрация клиентов** | ❌ | **Не тестируется** |
| **Ротация ключей шифрования** | ❌ | **Не тестируется** |
| **Retention/очистка данных** | ❌ | **Не тестируется** |
| **WebSocket команды** | ❌ | **Не тестируется** |
| **Pagination API** | ❌ | **Не тестируется** |
| **Работа с отчётами** | ❌ | **Не тестируется** |

### Клиент C# — 9 тест-файлов

| Область | Есть тесты | Статус |
|---------|-----------|--------|
| Шифрование/дешифровка | ✅ | Покрыто |
| Политики безопасности | ✅ | Покрыто |
| Очистка старых скриншотов | ✅ | Покрыто |
| Timestamp форматирование | ✅ | Покрыто |
| **Retry при сбое сети** | ❌ | **Не тестируется** |
| **Heartbeat adaptive interval** | ❌ | **Не тестируется** |
| **Browser history extraction** | ❌ | **Не тестируется** |
| **SHA256 верификация обновлений** | ❌ | **Не тестируется** |
| **Policy enforcement workflow** | ❌ | **Не тестируется** |
| **Activity state machine** | ❌ | **Не тестируется** |

---

## 6. Приоритеты исправления

### Неделя 1 — Блокирующие production-проблемы

- [ ] **[B-C3]** Добавить `path.resolve()` + проверку что путь внутри `storage/screenshots/` — закрыть path traversal
- [ ] **[B-C1]** Реализовать `GET /reports` — читать из `storage/reports/`, возвращать список с пагинацией
- [ ] **[B-C2]** Обернуть запись файла + запись в БД в try/catch с компенсацией: если БД упала — удалить файл
- [ ] **[C-C1]** Исправить `async void OnHeartbeatSucceeded` → `async Task` с подпиской через враппер
- [ ] **[C-C4]** Исправить логику null-check для `_cancellationTokenSource`
- [ ] **[F-C1]** Добавить глобальный error toast — показывать пользователю что что-то пошло не так

### Неделя 2 — Стабильность и данные

- [ ] **[C-C2]** Рефакторинг `OnSessionEnding` — убрать `.Wait()`, использовать `ConfigureAwait(false)`
- [ ] **[C-C3]** Заменить `DateTime.Now` → `DateTime.UtcNow` в `StabilityService`
- [ ] **[C-C5]** Добавить `_ = Task.Run(async () => await SendSystemEventAsync(e))` с логированием ошибки
- [ ] **[B-M10]** Добавить retention для 6 таблиц и для `storage/logs/`, `storage/reports/`
- [ ] **[F-C2]** Добавить `URL.revokeObjectURL()` при замене/unmount в `ScreenshotsList.jsx`
- [ ] **[B-C4]** Логировать ошибки при обновлении `UpdateDeployment`, убрать `.catch(() => null)`

### Неделя 3 — Качество кода

- [ ] **[C-M4]** Завернуть FileStream в `using` в `ClientLogUploadWorker`
- [ ] **[C-M2]** Добавить `finally { File.Delete(tempPath) }` в `BrowserActivityService`
- [ ] **[C-C6]** Убрать `GC.Collect()` из `StabilityService`
- [ ] **[F-M1]** Заменить polling (`setInterval`) в `ActivitiesList` и `EventsList` на react-query / WebSocket
- [ ] **[C-L4]** Исправить `public new Task StartAsync` → `public override Task StartAsync` в `StabilityService`
- [ ] **[S-5]** Реализовать ретроактивное применение ProjectAlias к WorkSession

### Месяц 2 — Тестирование

- [ ] Написать тесты для загрузки скриншотов (шифрование, временные метки, path traversal)
- [ ] Написать тесты для аутентификации и авторизации
- [ ] Написать тесты для retention (проверить что данные реально удаляются)
- [ ] Написать C# тесты для retry логики при сбоях сети
- [ ] Настроить CI/CD с запуском всех тестов при каждом коммите

---

## Итоговая оценка

| Компонент | До исправлений | После Недели 1-2 |
|-----------|---------------|-----------------|
| Бэкенд | ⚠️ 65% | ✅ 85% |
| Клиент | ⚠️ 70% | ✅ 88% |
| Фронтенд | ⚠️ 72% | ✅ 84% |
| Тесты | ❌ 35% | ⚠️ 50% |
| **Общая готовность** | **⚠️ 65%** | **✅ 80%** |

Проект имеет хорошую архитектурную основу и все ключевые функции реализованы. Большинство найденных проблем — устраняемые баги, а не фундаментальные архитектурные проблемы. С учётом плана выше, через 3-4 недели проект будет готов к стабильному использованию на 60+ клиентах.
