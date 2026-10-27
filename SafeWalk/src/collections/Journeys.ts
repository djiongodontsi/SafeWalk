import type { Access, CollectionConfig, Where } from 'payload'

const canReadJourney: Access = ({ req }) => {
  if (req.user?.collection !== 'users') return false
  const filters: Where[] = [
    { owner: { equals: req.user.id } },
    { participants: { contains: req.user.id } },
  ]
  return { or: filters }
}

const ownsJourney: Access = ({ req }) =>
  req.user?.collection === 'users'
    ? { owner: { equals: req.user.id } }
    : false

export const Journeys: CollectionConfig = {
  slug: 'journeys',
  admin: { hidden: true, useAsTitle: 'name' },
  access: {
    create: ({ req }) => req.user?.collection === 'users',
    read: canReadJourney,
    update: ownsJourney,
    delete: ownsJourney,
  },
  hooks: {
    beforeValidate: [
      ({ data }) => {
        if (data?.checkpoints) {
          data.totalMinutes =
            Number(data.departureMinutes ?? 0) +
            data.checkpoints.reduce(
            (total: number, checkpoint: { minutesToNext?: number }) =>
              total + Number(checkpoint.minutesToNext ?? 0),
            0,
          )
        }
        return data
      },
    ],
  },
  fields: [
    { name: 'name', type: 'text', required: true },
    {
      name: 'owner',
      type: 'relationship',
      relationTo: 'users',
      required: true,
      index: true,
    },
    { name: 'departure', type: 'text' },
    { name: 'arrival', type: 'text' },
    { name: 'departureMinutes', type: 'number', min: 0 },
    {
      name: 'checkpoints',
      type: 'array',
      required: true,
      minRows: 3,
      fields: [
        { name: 'label', type: 'text', required: true },
        {
          name: 'minutesToNext',
          type: 'number',
          required: true,
          min: 0,
        },
      ],
    },
    { name: 'totalMinutes', type: 'number', required: true, min: 0 },
    {
      name: 'contacts',
      type: 'relationship',
      relationTo: 'close-contacts',
      hasMany: true,
    },
    {
      name: 'participants',
      type: 'relationship',
      relationTo: 'users',
      hasMany: true,
      index: true,
    },
    {
      name: 'status',
      type: 'select',
      defaultValue: 'planned',
      options: [
        { label: 'Planifié', value: 'planned' },
        { label: 'En cours', value: 'active' },
        { label: 'Terminé', value: 'completed' },
      ],
    },
    { name: 'startedAt', type: 'date' },
    { name: 'completedAt', type: 'date' },
    { name: 'segmentEndsAt', type: 'date' },
    { name: 'currentIndex', type: 'number', min: 0, defaultValue: 0 },
    { name: 'favorite', type: 'checkbox', defaultValue: true },
  ],
  versions: false,
}
