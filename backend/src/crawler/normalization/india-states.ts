/**
 * State/UT name → two-letter code (28 states + 8 UTs), matching the codes used by the frontend map
 * and the planned `states` table. Includes common historical spellings seen on portals.
 */
const STATES: Record<string, string> = {
  'andhra pradesh': 'AP', 'arunachal pradesh': 'AR', assam: 'AS', bihar: 'BR', chhattisgarh: 'CG',
  goa: 'GA', gujarat: 'GJ', haryana: 'HR', 'himachal pradesh': 'HP', jharkhand: 'JH', karnataka: 'KA',
  kerala: 'KL', 'madhya pradesh': 'MP', maharashtra: 'MH', manipur: 'MN', meghalaya: 'ML', mizoram: 'MZ',
  nagaland: 'NL', odisha: 'OD', orissa: 'OD', punjab: 'PB', rajasthan: 'RJ', sikkim: 'SK',
  'tamil nadu': 'TN', telangana: 'TS', tripura: 'TR', 'uttar pradesh': 'UP', uttarakhand: 'UK',
  uttaranchal: 'UK', 'west bengal': 'WB',
  'andaman and nicobar islands': 'AN', 'andaman and nicobar': 'AN', chandigarh: 'CH',
  'dadra and nagar haveli and daman and diu': 'DH', delhi: 'DL', 'nct of delhi': 'DL', 'new delhi': 'DL',
  'jammu and kashmir': 'JK', ladakh: 'LA', lakshadweep: 'LD', puducherry: 'PY', pondicherry: 'PY',
};

function key(name: string): string {
  return name.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function stateCodeFor(name: string | undefined): string | undefined {
  return name ? STATES[key(name)] : undefined;
}
