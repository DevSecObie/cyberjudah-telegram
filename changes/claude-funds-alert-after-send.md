# Claude funds alert: admins marked told only after Telegram delivers

- When Claude's money runs out, the admins are now marked as told only after Telegram delivers the alert to an admin, as the free-budget alert already does. Before, the six-hour marker was written before the send, so a failed send left the admins untold and every later alert silent for six hours.
- A failed send is tried again at most every ten minutes, so readers' questions do not each wait on Telegram and a burst of errors is not a burst of messages.
- The AskHealth screen's "out of money since" time is written on the first error, as before, whether or not the alert is delivered.
