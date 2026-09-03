# BelfProctor — current production workflow

Актуально на 2026-09-02.

## Топология

```text
Windows agent ── HTTPS/WSS ──> nginx :443 ── private HTTP ──> backend :4000
Admin browser ── HTTPS ──────> nginx :443 ── private HTTP ──> backend :4000
                                                      └─────> PostgreSQL :5432
```

Снаружи публикуются 443 и порт 80 только для redirect на HTTPS. Backend и БД
остаются в private Compose network. Production требует canonical
`PUBLIC_BASE_URL=https://...`; HTTP/WS agent transport fail closed.

## Provisioning и ingestion

Администратор создаёт устройство и передаёт ему уникальные `ClientId` и
`EncryptionKey` длиной не менее 32 байт. Production не принимает общий/default
ключ. Новые payloads имеют envelope `BPG1`: random salt, random nonce,
PBKDF2-SHA256 210 000 и AES-256-GCM. Изменённый ciphertext отклоняется; legacy
CBC читается только для миграции существующей offline queue.

## WebSocket

Command и live-view соединения используют WSS URL с `clientId`, timestamp,
случайным nonce и HMAC-SHA256 от canonical payload. Сервер проверяет clock window,
подпись constant-time и одноразовость nonce. Повтор URL отклоняется.

Команды для offline-клиента сохраняются на диске. Uninstall claim выполняется
атомарным rename и доставляется не более одного раза. Download URL обновления
строится из canonical HTTPS `PUBLIC_BASE_URL` при фактической отправке.

## Admin authentication/authorization

Login устанавливает session JWT в cookie `HttpOnly; Secure; SameSite=Strict`;
JavaScript не видит токен. Есть отдельный login limiter и глобальный limiter,
который нельзя обойти подменой `X-Client-Id`. Mutating operations требуют ADMIN;
VIEWER имеет только read-only доступ.

## Update chain

1. `build-release.ps1` публикует self-contained single-file EXE и встраивает
   trusted publisher thumbprint в assembly metadata.
2. EXE, installer и uninstaller подписываются Authenticode; manifest содержит
   SHA-256 каждого файла. Unsigned batch wrappers и альтернативный unsigned
   publish/install flow в production release отсутствуют; mutable config не
   поставляется и создаётся подписанным installer из safe template.
3. Агент принимает только HTTPS download URL, повторно проверяет конечный URL
   после redirect, SHA-256, `Valid` Authenticode и точный embedded thumbprint.
   Download, lock и одноразовый PowerShell размещаются в защищённом `.update`
   внутри install root; пользовательский `%TEMP%` для privileged handoff не
   используется, reparse-point staging отклоняется.
4. Новая версия размещается в versioned directory. Service `ImagePath`
   переключается атомарно; версия должна удерживать Running 15 секунд.
5. При ошибке возвращается предыдущий `ImagePath` и запускается прежняя версия.

Writable config не может заменить embedded trust anchor другим сертификатом.

## Windows service lifecycle

Поддерживаемое имя продукта и службы — `BelfProctor`. Из-за Windows Session 0
служба запускается с `--service-host` и работает как supervisor. Реальный worker
запускается задачей `BelfProctor-Desktop` с interactive logon token и
`--auto-start`; supervisor перезапускает задачу, если desktop-agent исчез.
Таким образом screenshot/activity/live-view получают настоящий пользовательский
desktop, а SCM сохраняет automatic start и recovery.

Installer до изменения системы проверяет собственную Authenticode-подпись,
подписи EXE/uninstaller, elevation, HTTPS и уникальные credentials. Он копирует
только эти подписанные payloads, повторно проверяет staged copies и создаёт config
из покрытого подписью safe template. Имя службы и каталог установки фиксированы;
reparse root и foreign same-name service отклоняются.
Установка идёт через staging/backup, включает recovery actions и раздельный ACL;
upgrade сохраняет SCM service object, а при ошибке восстанавливаются прежние файлы,
задача, `ImagePath`, startup type, failure actions и running state.
Uninstaller также проверяет собственную подпись и ограничивает удаление канонической
границей Program Files. Release-конфигурация читается только из защищённого install root;
self-install, `HKCU\Run` и пользовательский watchdog удалены. Старые Windows 8,
PM2, plaintext HTTP и чужие/маскировочные имена не поддерживаются.

## Validation

Авторитетный список автоматических и полевых release gates находится в
`TEST_PLAN.md`. Текущее доказанное состояние и остаточные внешние gates — в
`FULL_AUDIT_REPORT_2026-08-31.md`.
