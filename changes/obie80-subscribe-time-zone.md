# The daily verse arrives at your chosen hour where you live, once a day

- The app now sends your device's time zone with a daily-verse subscription, so the verse comes at the hour you picked even after the clocks change for daylight saving. Subscriptions made before this keep their fixed offset until you change the hour or turn the verse off and on again in Settings.
- `/api/subscribe` refuses a time zone or hour it can't use (a 400) instead of quietly picking a default.
- The verse is sent once per local day: on the night the clocks go back, the repeated hour no longer sends it twice.
- A subscriber who picks midnight gets the verse at midnight on every runtime.
- "Download my data" lists the daily verse's time zone and the local date it was last sent; "Delete my data" deletes both.
