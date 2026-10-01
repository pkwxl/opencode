// Public API of @opencode-ai/quota (plan 0066 §6). The CLI lives in ./cli.js
// (bin "quota"); other packages consume the functions below.

export type {
  AdapterOptions,
  ProviderId,
  QuotaSnapshot,
  QuotaSubscription,
  QuotaWindow,
  Result,
  WindowScope,
} from "./types.js"
export { queryQuota, listAccounts } from "./query.js"
export type { AccountList, AccountResult, ListedAccount, QueryQuotaOptions, QuotaReport } from "./query.js"
export { queryKimi } from "./kimi.js"
export { queryZhipu } from "./zhipu.js"
export {
  clearToken,
  isValidLabel,
  listStoredAccounts,
  quotaHome,
  readMeta,
  readToken,
  saveToken,
} from "./store.js"
export type { StoredAccount } from "./store.js"
export { expiryInfo, jwtExp, jwtPayload, maskText, maskToken } from "./jwt.js"
