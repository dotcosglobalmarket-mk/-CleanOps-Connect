const ServiceType = require('../models/ServiceType');

// Idempotent default catalogue so /service-types is never empty on a fresh
// deploy. Upserts on `name`, so re-running (e.g. on every server boot) never
// duplicates or overwrites an admin's edits to these entries beyond the
// fields listed here.
const DEFAULT_SERVICE_TYPES = [
  { name: 'Domestic Deep Clean', category: 'domestic', description: 'One-off deep clean of a home, including kitchens and bathrooms.', requiresCoshh: false },
  { name: 'Domestic Regular Clean', category: 'domestic', description: 'Recurring weekly or fortnightly home cleaning.', requiresCoshh: false },
  { name: 'End of Tenancy Clean', category: 'domestic', description: 'Full clean for moving out of a rented property.', requiresCoshh: false },
  { name: 'Office Clean', category: 'industrial', description: 'Routine cleaning of office and commercial workspaces.', requiresCoshh: true },
  { name: 'Industrial Deep Clean', category: 'industrial', description: 'Deep clean of industrial or warehouse premises.', requiresCoshh: true },
  { name: 'Post-Construction Clean', category: 'industrial', description: 'Clean-up of a site after building or renovation work.', requiresCoshh: true },
];

async function seedDefaultServiceTypes() {
  await Promise.all(
    DEFAULT_SERVICE_TYPES.map((serviceType) =>
      ServiceType.findOneAndUpdate(
        { name: serviceType.name },
        { $setOnInsert: serviceType },
        { upsert: true }
      )
    )
  );
}

module.exports = {
  DEFAULT_SERVICE_TYPES,
  seedDefaultServiceTypes,
};
