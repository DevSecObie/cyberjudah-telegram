- Stage the actual Bible Strong application with CyberJudah content and standalone Firebase accounts. The app uses Apple, Google and email sign-in; its Telegram linking, session restoration and shared balance lookup are removed. Existing backend Telegram accounts and balances remain unchanged.

Keep Bible Strong’s original public dictionary catalog, definitions and attribution on the staging port. The fixed read-only gateway sends no account headers and translates shared Apocrypha passage identities. Verify the actual Expo reader routes and include the final Apocrypha books in Old Testament search on the Bible Strong port only; the Mini App’s Old Testament filter stays Genesis to Malachi.

Retain Bible Strong’s original Nave Thematic Bible alongside its dictionary. Staging forwards those public reference reads to the original service, preserving topic descriptions and Scripture links; CyberJudah classes are not substituted into Nave. The live release check verifies an original Nave topic as well.

Pin the standalone app to 4a04c2e, which also fixes native Downloads with a smaller published offline catalog and initialization of the new-account study migration checkpoint. This hosting change updates staging only.
