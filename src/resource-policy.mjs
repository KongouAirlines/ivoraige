// File upload leaves room for Base64 and JSON overhead in the HTTP body limit.
export const resourcePolicy = Object.freeze({ requestJsonBytes: 10 * 1024 * 1024, uploadFileBytes: 7 * 1024 * 1024 })
