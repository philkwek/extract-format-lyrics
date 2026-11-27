export function accountsEnabled(): boolean {
  return import.meta.env.VITE_ACCOUNTS_ENABLED === 'true'
}
