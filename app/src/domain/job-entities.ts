/** The uuid keys of a job's `payload.data` that name the record it belongs to, in the order the screen reads them. */
export const jobEntityKeys = [
  "submission_id",
  "property_id",
  "payment_id",
  "asset_id",
  "inquiry_id",
  "subscriber_id",
  "request_id",
] as const;
