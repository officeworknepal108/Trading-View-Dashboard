let namespace = 'signed-out';
export function selectUserStorage(userId: string) { namespace = userId; }
// Never read the old shared browser keys into another user's session.
export const userStorage = {
  getItem: (key: string) => window.localStorage.getItem(`dashboard:${namespace}:${key}`),
  setItem: (key: string, value: string) => window.localStorage.setItem(`dashboard:${namespace}:${key}`, value),
  removeItem: (key: string) => window.localStorage.removeItem(`dashboard:${namespace}:${key}`),
};
