# The daily verse arrives at your chosen hour where you live, once a day

- When the app sends your time zone with a daily-verse subscription, the verse comes at the hour you picked even after the clocks change for daylight saving. Subscriptions made before this keep their fixed offset.
- `/api/subscribe` refuses a time zone or hour it can't use (a 400) instead of quietly picking a default.
- The verse is sent once per local day: on the night the clocks go back, the repeated hour no longer sends it twice.
- A subscriber who picks midnight gets the verse at midnight on every runtime.
