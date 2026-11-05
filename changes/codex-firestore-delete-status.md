Account data deletion now verifies each Firestore batch-write status before reporting success. A failed, missing, or malformed write status stops the operation and reports an incomplete deletion.
