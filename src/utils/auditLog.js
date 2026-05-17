const { query } = require('../config/db');

const auditLog = async ({ entity_type, entity_id, action, changed_by, old_value, new_value, notes, client }) => {
  const q = `
    INSERT INTO audit_logs (entity_type, entity_id, action, changed_by, old_value, new_value, notes)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
  `;
  const params = [
    entity_type,
    entity_id,
    action,
    changed_by,
    old_value ? JSON.stringify(old_value) : null,
    new_value ? JSON.stringify(new_value) : null,
    notes || null,
  ];
  if (client) {
    return client.query(q, params); // use existing transaction client
  }
  return query(q, params);
};

module.exports = { auditLog };
