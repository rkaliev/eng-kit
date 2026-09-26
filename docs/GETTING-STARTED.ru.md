# Быстрый старт: eng-kit для Claude Code

Репозиторий: [github.com/rkaliev/eng-kit](https://github.com/rkaliev/eng-kit).

## 0. Что нужно

- **Claude Code** последней версии. Проверить: `claude --version`; обновить: `claude update`. Установка описана на [code.claude.com/docs](https://code.claude.com/docs/en/setup).
- **Node.js ≥ 22.18** (`node --version`). Хуки кита — это `.ts`-файлы, и Node запускает их без сборки. На более старом Node Claude Code будет работать, но без guard и verify-гейта.
- **git**: на нём держатся ревью по диапазону коммитов и финиш ветки.

---

## 1. Что такое плагин, на простом примере

Хорошая аналогия — магазин приложений на телефоне:

| Телефон | Claude Code | В нашем случае |
|---|---|---|
| Магазин приложений | **Маркетплейс** — git-репозиторий с каталогом `.claude-plugin/marketplace.json` | `rkaliev/eng-kit` |
| Приложение | **Плагин** — папка с `.claude-plugin/plugin.json` и компонентами | `eng-kit` |
| Установка приложения | `claude plugin install <плагин>@<маркетплейс>` | `eng-kit@eng-kit` |

В нашем репозитории маркетплейс и плагин лежат вместе: каталог из одного плагина, и этот плагин — сам репозиторий. Поэтому имя дважды: `eng-kit@eng-kit`.

### Что внутри плагина

```
eng-kit/
├── .claude-plugin/plugin.json      паспорт: имя, версия, описание
├── .claude-plugin/marketplace.json каталог: «в этом репозитории есть плагин eng-kit»
├── skills/<имя>/SKILL.md           скиллы: инструкции, которые агент подгружает по ситуации
├── agents/*.md                     сабагенты: отдельные «сотрудники» со своей моделью и инструментами
└── hooks/hooks.json                хуки: код, который Claude Code запускает сам на событиях
```

- **Скилл** — это методичка. У каждого скилла есть описание вида «Use when…». Claude видит все описания и сам подгружает нужный скилл, когда ситуация совпадает (например, «баг» → `systematic-debugging`). Любой скилл можно вызвать и вручную: `/eng-kit:systematic-debugging`. Префикс `eng-kit:` — это namespace плагина, он защищает от конфликтов имён с другими плагинами.
- **Агент** — исполнитель со свежим контекстом. Claude отдаёт ему задачу, а назад получает только результат. У нас их два: `reviewer` (ревьюер: только чтение, opus) и `implementer` (исполнитель одной задачи плана: sonnet).
- **Хук** — это не текст, а программа. Модель не может её «забыть» или «переубедить»: Claude Code запускает её сам. У нас хуки делают три вещи: загружают правила в начале сессии, блокируют опасные команды и не дают закончить работу без прогона тестов.

### Куда ставится и где живёт

| Область (`--scope`) | Где записано | Кто получает плагин |
|---|---|---|
| `user` (по умолчанию) | `~/.claude/settings.json` | Ты, во всех проектах |
| `project` | `.claude/settings.json` проекта (коммитится) | Все, кто откроет проект |
| `local` | `.claude/settings.local.json` (не коммитится) | Только ты, только в этом проекте |

Файлы плагина Claude Code копирует в кэш `~/.claude/plugins/cache/…`, а в настройках остаётся одна строка: `"enabledPlugins": {"eng-kit@eng-kit": true}`. Поэтому в сам проект ничего не копируется.

### Что происходит в сессии

```
claude ─▶ SessionStart-хук ─▶ в контекст: правила using-skills + пути к скриптам кита
   │
   ├─ ты: «добавь скидку в корзину» ─▶ Claude видит описание brainstorming ─▶ подгружает скилл
   │                                    (или ты сам: /eng-kit:implement tasks/01.md)
   │
   ├─ каждый вызов инструмента ─▶ PreToolUse-хук (guard)
   │        git push           ─▶ «спросить человека»
   │        git push --force   ─▶ «запрещено»
   │        Read .env          ─▶ «запрещено»
   │        npm test           ─▶ без мнения (решают обычные разрешения)
   │
   ├─ Edit / Write ─▶ PostToolUse-хук: «рабочая копия не проверена»
   │  npm test ✓     ─▶ «проверено»
   │
   ├─ ревью ─▶ агент eng-kit:reviewer (свежий контекст, opus) ─▶ отчёт
   │
   └─ Claude хочет закончить ─▶ Stop-хук: есть непроверенные правки?
                                  да  ─▶ «сначала прогони проверки» (один раз на промпт)
                                  нет ─▶ ответ тебе
```

### Как обновлять

```bash
claude plugin marketplace update eng-kit     # подтянуть свежий каталог
claude plugin update eng-kit@eng-kit          # обновить плагин (затем перезапусти сессию)
```

Номер версии берётся из `plugin.json`. Список изменений лежит в [CHANGELOG.md](../CHANGELOG.md).

---

## 2. Новый проект за 5 минут (рекомендуемый путь)

**Шаг 1. Один раз на машине** поставь плагин себе, во все проекты:

```bash
claude plugin marketplace add rkaliev/eng-kit
claude plugin install eng-kit@eng-kit
claude plugin list                            # eng-kit@eng-kit · ✔ enabled
```

**Шаг 2. Новый проект:**

```bash
mkdir shop-api && cd shop-api
git init
claude
```

**Шаг 3. Внутри Claude Code:**

```
/eng-kit:brainstorming REST API корзины для интернет-магазина: товары, скидки, итог
```

Агент классифицирует работу. Новый проект — это «Architectural», поэтому дальше он будет задавать вопросы по одному. Выбор стека — это развилка, и агент предложит 2–3 варианта с рекомендацией. Потом он запишет spec и попросит его подтвердить. Код до этого момента не пишется.

**Шаг 4.** Когда проект создан (есть `package.json`, `go.mod` и т. п.):

```
/eng-kit:kit-init
```

Агент покажет план и по твоему «да» создаст `.claude/verify.json` (команды тестов, найденные в проекте), `.claude/guard.json` и deny-правила на секреты. Если нет CLAUDE.md, он предложит `/eng-kit:onboarding-existing-codebase`, чтобы собрать CLAUDE.md из кода.

**Шаг 5. Дальше рабочий цикл:**

```
/eng-kit:writing-plans docs/specs/…-cart-api.md     план из маленьких TDD-задач
/eng-kit:implement docs/plans/…-cart-api.md         исполнение с тестами и отчётом
/eng-kit:requesting-code-review                     ревью агентом reviewer
/eng-kit:finish                                     merge / PR / keep / discard — на твой выбор
```

Для мелкой правки хватит одной строки: `/eng-kit:implement добавить валидацию количества > 0`.

Подробный разбор всех шагов с примерами диалога: [WALKTHROUGH.ru.md](WALKTHROUGH.ru.md).

**Почему этот путь самый удобный:** ставишь один раз, и плагин работает во всех проектах. В репозитории проекта нет чужих файлов, кроме `.claude/verify.json` и `.claude/guard.json`. Обновление — одна команда.

---

## 3. Проверить, что всё установилось

Добавить маркетплейс — ещё не значит поставить плагин: `marketplace add` только подключает каталог, скиллы появляются после `install`.

**Из терминала:**
```bash
claude plugin list                 # eng-kit@eng-kit · Status: ✔ enabled · Version: 0.2.x
claude plugin details eng-kit      # Skills (27), Agents (2), Hooks (6)
```

**Внутри Claude Code** (после перезапуска сессии или `/reload-plugins`):

| Что проверить | Как | Что должно быть |
|---|---|---|
| Скиллы | набери `/eng-kit:` | в меню `implement`, `brainstorming`, `kit-init`, `verify`, … |
| Хуки | `/hooks` | SessionStart, PreToolUse, PostToolUse, Stop, UserPromptSubmit → `…/eng-kit/…/hooks/hook.ts` |
| Агенты | `/agents` | `eng-kit:reviewer`, `eng-kit:implementer` |
| Правила загружены | «Ответь только строкой из контекста, которая начинается с 'Kit root'» | `Kit root: …/.claude/plugins/cache/eng-kit/eng-kit/0.2.x` |
| Guard | «Выполни git push --force origin main» | отказ «Guard: Force-pushing rewrites shared history…»; обычный `git push` — окно подтверждения |
| Verify-гейт | `/eng-kit:kit-init`, затем мелкая правка без тестов | в конце «Verify gate: files changed…», и агент прогонит тесты перед отчётом |

Если скиллы видны, а guard и гейт не срабатывают, проверь `node --version` (нужен ≥ 22.18) и доверие к папке. Ошибки хуков показывает `claude --debug`.

## 4. Для команды

В корне проекта:

```bash
claude plugin marketplace add rkaliev/eng-kit --scope project
claude plugin install eng-kit@eng-kit --scope project
git add .claude/settings.json && git commit -m "chore: enable eng-kit"
```

В `.claude/settings.json` появится:

```json
{
  "extraKnownMarketplaces": { "eng-kit": { "source": { "source": "github", "repo": "rkaliev/eng-kit" } } },
  "enabledPlugins": { "eng-kit@eng-kit": true }
}
```

**Что увидит коллега:** он клонирует проект, запускает `claude` и подтверждает доверие к папке. После этого Claude Code предложит поставить маркетплейс и плагин. Пока доверия нет, плагины из файла проекта не ставятся: чужой репозиторий не может ничего установить тебе молча.

Закоммить и остальную часть `.claude/` (кроме `settings.local.json`): тогда у команды одинаковые проверки и правила.

---

## 5. Альтернатива: папка `.claude/` в проекте

Этот вариант нужен, когда плагины использовать нельзя (закрытый контур, политика компании) или когда скиллы нужно править под конкретный проект. Всё лежит в репозитории, скиллы вызываются без префикса (`/implement`).

```bash
git clone https://github.com/rkaliev/eng-kit
node eng-kit/scripts/install-project.ts <папка проекта>          # dry run: покажет, что будет сделано
node eng-kit/scripts/install-project.ts <папка проекта> --yes    # установить
```

Что появится:
- `.claude/skills/*` — 27 скиллов;
- `.claude/agents/reviewer.md`, `implementer.md`;
- `.claude/eng-kit/` — код хуков, скрипты, шаблоны, `manifest.json`;
- `.claude/settings.json` — хуки и deny-правила на секреты;
- `.claude/verify.json`, `.claude/guard.json`, если их не было.

**Обновление:** та же команда с `--yes` из свежего клона. Файлы, которые записал кит, обновятся. Файлы проекта с теми же именами останутся нетронутыми и будут перечислены как `conflict`.

**Не смешивай способы:** если в проекте стоит папка, не включай там плагин, иначе хуки сработают дважды.

| | Плагин | Папка `.claude/` |
|---|---|---|
| Установка | одна команда, один раз | скрипт в каждый проект |
| В репозитории проекта | 2–3 небольших файла | ~50 файлов кита |
| Обновление | `claude plugin update` | повторный запуск скрипта |
| Команды | `/eng-kit:implement` | `/implement` |
| Правка скиллов под проект | нет (форкни плагин) | да, прямо в `.claude/skills/` |

---

## 6. Попробовать на демо-проекте

```bash
git clone https://github.com/rkaliev/eng-kit
cp -r eng-kit/examples/demo /tmp/kit-demo
cd /tmp/kit-demo && git init -q && git add -A && git commit -qm init
npm test            # 2 теста, зелёные
claude
```

| Шаг | Что ввести | Что увидишь |
|---|---|---|
| 1 | `/eng-kit:kit-init` | План, затем `verify.json` с `npm test`: агент взял его из CLAUDE.md |
| 2 | `/eng-kit:implement tasks/01-percent-discount.md` | План до 7 строк, затем TDD: сначала падающий тест на каждый критерий. Задача про деньги, поэтому подключится `payments-and-money`: только целочисленная арифметика и округление half-up |
| 3 | (агент говорит «готово») | Если проверок после правок не было, Stop-хук вернёт агента («Verify gate: files changed…»), и отчёт будет с реальными результатами |
| 4 | `/eng-kit:requesting-code-review` | Агент `reviewer`: Criteria / Confirmed / Assumptions / Questions / Verdict |
| 5 | `/eng-kit:finish` | Варианты merge / PR / keep / discard. Push и merge — только после твоего выбора |

**Как проверить guard:**
- `git push --force` — отказ с подсказкой про `--force-with-lease`;
- `git push` — вопрос;
- `git commit --no-verify` — отказ.

`/hooks` показывает зарегистрированные хуки, `claude plugin details eng-kit` — всё, что загрузил плагин.

---

## 7. Модели

- **Агенты:** `reviewer` работает на `opus`, `implementer` — на `sonnet`. Всех сабагентов на одну модель переводят `CLAUDE_CODE_SUBAGENT_MODEL` и `CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1` в `env` настроек.
- **Скиллы:** у скиллов с тяжёлыми рассуждениями (brainstorming, writing-plans, systematic-debugging, security-review) стоит `effort: high`.
- **Основная сессия:** `/model`, `--model` — всё встроенное.

## 8. Частые вопросы

- **Добавил маркетплейс, а скиллов нет.** Плагин не установлен: `claude plugin install eng-kit@eng-kit`, затем перезапусти сессию или `/reload-plugins`. Проверка — раздел 3.
- **Хуки не срабатывают.** Проверь `node --version` (нужен ≥ 22.18) и `/hooks`. Хукам проекта нужно доверие к папке. Отладка: `claude --debug`.
- **Verify-гейт пишет, что команд нет.** Заполни `.claude/verify.json` или секцию `## Commands` в CLAUDE.md.
- **Нужен push без вопроса.** Узкое правило в `.claude/guard.json`: `"allow": ["^git push origin (feat|fix)/"]`. Блоки (`--force`, `--no-verify`) это правило не снимает.
- **Хочу временно выключить плагин.** `claude plugin disable eng-kit@eng-kit`, обратно — `enable`.
- **Удалить.** `claude plugin uninstall eng-kit@eng-kit`, затем `claude plugin marketplace remove eng-kit`.
- **Windows.** Хуки — это Node-скрипты, guard понимает инструмент PowerShell. На Windows этот сценарий пока не прогонялся.

Как всё устроено и почему: [ARCHITECTURE.ru.md](ARCHITECTURE.ru.md).
