import { internalMessaging } from './internal'

export function getAllowedInfo() {
  return internalMessaging.sendMessage('getAllowedInfo', undefined)
}

export function requestHosts(data: { hosts: string[] }) {
  return internalMessaging.sendMessage('requestHosts', data)
}

export function hasInstall() {
  return document.documentElement.dataset.corsUnblock
}

export function install() {
  // Redirection removed as per user request
  console.log('Install requested but redirection disabled.')
}
