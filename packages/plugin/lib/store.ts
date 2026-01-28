export interface ConfirmState {
  origin: string
  hosts: string[]
  tabId?: number
}

const PopupStoreKey = 'popupParams'
export const popupStore = {
  setParams: async (params: ConfirmState) => {
    await browser.storage.session.set({
      [PopupStoreKey]: params,
    })
  },
  getParams: async () => {
    return (
      await browser.storage.session.get<{
        [PopupStoreKey]: ConfirmState
      }>(PopupStoreKey)
    )[PopupStoreKey]
  },
  removeParams: async () => {
    await browser.storage.session.remove(PopupStoreKey)
  },
}
