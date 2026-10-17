// Keep the model's first verified tourist choice; other categories retain their slots.
export function touristHighlightIds(records, ids) {
  const routes=new Set(records.filter(record=>record.category==='route').map(record=>record.id));
  let chosen=false;
  return ids.filter(id=>{if(!routes.has(id))return true;if(chosen)return false;chosen=true;return true;});
}
