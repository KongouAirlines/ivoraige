// SPDX-License-Identifier: MIT
// Copyright (c) 2026 ivoraige contributors; see LICENSE for the full notice.

import { KernelError, isPublicErrorCode } from './errors.mjs'

// Host API 1 adapters may be installed as independent packages. Their Error
// constructor is not the host's constructor, even when both call it KernelError.
// Convert only errors thrown by adapter callbacks, and only known public codes.
export function normalizeAdapterError(error) {
  if (error instanceof KernelError || !(error instanceof Error) ||
      error.constructor?.name !== 'KernelError' ||
      !isPublicErrorCode(error.code) || typeof error.message !== 'string' || !error.message) return error
  const details = error.details && typeof error.details === 'object' && !Array.isArray(error.details)
    ? error.details : {}
  const normalized = new KernelError(error.code, error.message, details, { cause: error.cause ?? error })
  // Adapter cleanup diagnostics remain local and must not replace the primary
  // failure or leak through the protocol envelope.
  if (Object.hasOwn(error, 'cleanupErrors')) Object.defineProperty(normalized, 'cleanupErrors',
    Object.getOwnPropertyDescriptor(error, 'cleanupErrors'))
  return normalized
}

export function invokeAdapter(callback, receiver, args) {
  try {
    const result = Reflect.apply(callback, receiver, args)
    return result && typeof result.then === 'function'
      ? Promise.resolve(result).catch(error => { throw normalizeAdapterError(error) }) : result
  } catch (error) { throw normalizeAdapterError(error) }
}

export function callAdapter(adapter, name, args = []) {
  try { return invokeAdapter(adapter[name], adapter, args) }
  catch (error) { throw normalizeAdapterError(error) }
}
