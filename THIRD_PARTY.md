# Локальные компоненты TextMask

Библиотеки хранятся в `vendor/`, загружаются только с локального сервера по необходимости. CDN и платных API нет; `npm install` не требуется. Декоративных изображений и шрифтов интерфейса не добавлено.

| Компонент | Версия / фиксация | Источник | Лицензия в проекте |
| --- | --- | --- | --- |
| Mammoth | 1.13.0 | [mwilliamson/mammoth.js](https://github.com/mwilliamson/mammoth.js) | `vendor/mammoth/LICENSE` — BSD-2-Clause |
| PDF.js / pdfjs-dist | 6.4.299 | [mozilla/pdf.js](https://github.com/mozilla/pdf.js) | `vendor/pdfjs/LICENSE` — Apache-2.0 |
| Tesseract.js | 7.0.0 | [naptha/tesseract.js](https://github.com/naptha/tesseract.js) | `vendor/tesseract/LICENSE.md` — Apache-2.0; дополнительные уведомления `dist/*.LICENSE.txt` |
| Tesseract.js core | 6.1.2 | [naptha/tesseract.js-core](https://github.com/naptha/tesseract.js-core) | `vendor/ocr-core/LICENSE` — Apache-2.0 |
| Модели rus и eng | commit `87416418657359cb625c412a48b6e1d6d41c29bd` | [tesseract-ocr/tessdata_fast](https://github.com/tesseract-ocr/tessdata_fast/tree/87416418657359cb625c412a48b6e1d6d41c29bd) | `vendor/tessdata/LICENSE` — Apache-2.0 |

Вспомогательные CMaps, стандартные шрифты и WebAssembly-декодеры PDF.js скопированы из того же архива pdfjs-dist. Их уведомления находятся в `vendor/pdfjs/cmaps/LICENSE`, `vendor/pdfjs/standard_fonts/LICENSE_*`, `vendor/pdfjs/wasm/LICENSE_*`. Эти шрифты нужны рендереру документов, интерфейс использует системные шрифты.

Точные URL архивов npm, версии, SHA-512 integrity и SHA-256 моделей зафиксированы в `vendor/SOURCES.json`. Архивы проверены до извлечения; package scripts не запускались. Выбранные файлы перенесены без изменения из проверенных архивов.

При обновлении сохраняйте уведомления и лицензии, обновляйте manifest и повторяйте импорт DOCX, текстового PDF, скана PDF, PNG/JPEG, русское OCR, отмену и отсутствие внешних запросов. Библиотеки поставляются на условиях их собственных лицензий.

## Windows portable

Сборка включает официальный **Node.js 24.22.1 win-x64** из [архива Node.js](https://nodejs.org/dist/v24.22.1/node-v24.22.1-win-x64.zip). SHA-256 архива сверяется со значением из [официального SHASUMS256.txt](https://nodejs.org/dist/v24.22.1/SHASUMS256.txt): `d2046d28c2c3dcd211ac5145c0bf30e2047ef9dfb306693c8c6e2eccd8b95fa5`.

В ZIP перенесены неизменённый `runtime/node.exe` и полный `runtime/LICENSE`, включая уведомления компонентов Node.js. Версия, источник, хеш архива и самого EXE записаны в `BUILD.json`. Сам Node.js не добавлен в Git: его скачивает сценарий сборки после проверки SHA-256. Загрузка требуется только разработчику при сборке; готовое приложение работает без неё.

Оболочка `packaging/Launcher.cs` написана для TextMask, лицензия MIT проекта. Она компилируется штатным C#-компилятором .NET Framework, без NuGet и Electron. Windows Forms и .NET Framework используются из Windows и не копируются в ZIP. Значок EXE повторяет собственную геометрию `favicon.svg`.
