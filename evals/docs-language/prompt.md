---
description: Record a decision asked for in Russian, in a repo whose docs are in Russian, and write a client note the user asks for in Russian
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Agent, TodoWrite]
---

Мы выбрали очередь для фоновых задач: RabbitMQ, а не Redis Streams. Причины: нужны подтверждения доставки и dead-letter очередь, а Redis у нас работает только как кэш без персистентности. Запиши это решение как decision record в `docs/decisions/0002-message-queue.md` и закоммить.

Ещё сделай для заказчика короткую справку на русском в `docs/client/queue.md`: что для них меняется (задачи не теряются при перезапуске сервиса).

Я отошёл, поэтому вопросов не задавай: принимай разумные решения и в конце расскажи, что сделал.
