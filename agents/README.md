# Agents: Developer + Reviewer

Два агента работят по плана един след друг. Използват Claude Code (`claude`).

## Файлове

- `PLAN.md` — задачите. Developer взима първата `- [ ]`.
- `WORKLOG.md` — общ файл. Двамата пишат тук какво са направили.
- `developer.js` — прави задачата, пише отчет, спира.
- `reviewer.js` — тества (`npm test`), прави review, пише отговор.

## Как работи

1. Developer взима задача от `PLAN.md`, пише код и отчет в `WORKLOG.md` → `STATUS: DEV_DONE`.
2. Reviewer вижда `DEV_DONE`, тества и прави review → пише в `WORKLOG.md`.
3. Ако има забележки → `REVIEW_CHANGES` → Developer поправя същата задача.
4. Ако няма забележки → задачата става `- [x]`, прави се git commit → следваща задача.
5. Когато няма повече задачи → `ALL_DONE`, двамата спират.

Двамата проверяват `WORKLOG.md` на всеки 10 секунди.

## Старт

Трябва ти Claude Code (`claude`), влязъл в акаунта.

```
npm run agents
```

Или в два отделни терминала:

```
npm run agent:dev
npm run agent:review
```

Спиране: `Ctrl+C`. При ново пускане продължават от последния `STATUS:`.

## Настройки (env)

| Променлива | По подразбиране | Какво прави |
|---|---|---|
| `AGENT_POLL_MS` | `10000` | колко често проверяват файла |
| `AGENT_MAX_ROUNDS` | `5` | максимум кръга review за една задача, после `BLOCKED` |
| `AGENT_AUTO_COMMIT` | `1` | `0` = без git commit след одобрение |
| `AGENT_MODEL` | — | модел за Claude, напр. `sonnet` |
| `AGENT_TIMEOUT_MS` | `1800000` | максимално време за една стъпка (30 мин) |

## BLOCKED

Ако нещо се счупи 3 пъти или задачата мине 5 кръга без одобрение, пише се `STATUS: BLOCKED`.
Оправи проблема, изтрий реда `BLOCKED` в `WORKLOG.md` и пусни агентите пак.

## Сигурност

- Агентите нямат право да четат `.env` и да правят `git push`.
- Reviewer не може да променя файлове.
- Правата са в `dev-settings.json` и `review-settings.json`.
