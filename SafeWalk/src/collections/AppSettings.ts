import type { CollectionConfig } from 'payload'

export const AppSettings: CollectionConfig = {
  slug: 'app-settings',
  admin: { hidden: true },
  access: {
    create: () => false,
    read: () => false,
    update: () => false,
    delete: () => false,
  },
  fields: [
    { name: 'adminPinHash', type: 'text', required: true, hidden: true },
    { name: 'adminFailedAttempts', type: 'number', defaultValue: 0, hidden: true },
    { name: 'adminLockedUntil', type: 'date', hidden: true },
  ],
  versions: false,
}
