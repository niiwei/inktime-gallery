// Time-sorted candidates only compare with photos within the burst window.
// Missing perceptual hashes are singleton groups and incur no pair comparisons.
export function groupBurstCandidates(rows, fields, similar) {
  const groups = [];
  let active = [];
  const undated = new Map();
  for (const row of rows) {
    if (!row[fields.hash]) { groups.push([row]); continue; }
    const time = Date.parse(row[fields.time] || '');
    const date = row[fields.date] || '';
    let candidates;
    if (Number.isFinite(time)) {
      active = active.filter(entry => time-entry.time <= 120000);
      candidates = active;
    } else candidates = undated.get(date) || [];
    const match = candidates.find(entry => similar(entry.row,row));
    const group = match?.group || [];
    if (!match) groups.push(group);
    group.push(row);
    const entry = { row,group,time };
    if (Number.isFinite(time)) active.push(entry);
    else { candidates.push(entry); undated.set(date,candidates); }
  }
  return groups;
}
