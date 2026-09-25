import type { Prisma } from '../../generated/prisma/client';

/**
 * 28 states + 8 union territories. Codes match the frontend map and the crawler's own name→code
 * lookup (`crawler/normalization/india-states.ts`) — keep the two in sync if a code ever changes.
 */
export const STATE_SEED_DATA: Prisma.StateCreateInput[] = [
  { code: 'AP', name: 'Andhra Pradesh', type: 'STATE' },
  { code: 'AR', name: 'Arunachal Pradesh', type: 'STATE' },
  { code: 'AS', name: 'Assam', type: 'STATE' },
  { code: 'BR', name: 'Bihar', type: 'STATE' },
  { code: 'CG', name: 'Chhattisgarh', type: 'STATE' },
  { code: 'GA', name: 'Goa', type: 'STATE' },
  { code: 'GJ', name: 'Gujarat', type: 'STATE' },
  { code: 'HR', name: 'Haryana', type: 'STATE' },
  { code: 'HP', name: 'Himachal Pradesh', type: 'STATE' },
  { code: 'JH', name: 'Jharkhand', type: 'STATE' },
  { code: 'KA', name: 'Karnataka', type: 'STATE' },
  { code: 'KL', name: 'Kerala', type: 'STATE' },
  { code: 'MP', name: 'Madhya Pradesh', type: 'STATE' },
  { code: 'MH', name: 'Maharashtra', type: 'STATE' },
  { code: 'MN', name: 'Manipur', type: 'STATE' },
  { code: 'ML', name: 'Meghalaya', type: 'STATE' },
  { code: 'MZ', name: 'Mizoram', type: 'STATE' },
  { code: 'NL', name: 'Nagaland', type: 'STATE' },
  { code: 'OD', name: 'Odisha', type: 'STATE' },
  { code: 'PB', name: 'Punjab', type: 'STATE' },
  { code: 'RJ', name: 'Rajasthan', type: 'STATE' },
  { code: 'SK', name: 'Sikkim', type: 'STATE' },
  { code: 'TN', name: 'Tamil Nadu', type: 'STATE' },
  { code: 'TS', name: 'Telangana', type: 'STATE' },
  { code: 'TR', name: 'Tripura', type: 'STATE' },
  { code: 'UP', name: 'Uttar Pradesh', type: 'STATE' },
  { code: 'UK', name: 'Uttarakhand', type: 'STATE' },
  { code: 'WB', name: 'West Bengal', type: 'STATE' },
  { code: 'AN', name: 'Andaman and Nicobar Islands', type: 'UT' },
  { code: 'CH', name: 'Chandigarh', type: 'UT' },
  { code: 'DH', name: 'Dadra and Nagar Haveli and Daman and Diu', type: 'UT' },
  { code: 'DL', name: 'Delhi', type: 'UT' },
  { code: 'JK', name: 'Jammu and Kashmir', type: 'UT' },
  { code: 'LA', name: 'Ladakh', type: 'UT' },
  { code: 'LD', name: 'Lakshadweep', type: 'UT' },
  { code: 'PY', name: 'Puducherry', type: 'UT' },
];

/** docs/DATABASE.md §3: `tender_types` lookup. */
export const TENDER_TYPE_SEED_DATA: Prisma.TenderTypeCreateInput[] = [
  { key: 'OPEN', name: 'Open Tender' },
  { key: 'LIMITED', name: 'Limited Tender' },
  { key: 'EOI', name: 'Expression of Interest' },
  { key: 'RFP', name: 'Request for Proposal' },
  { key: 'SINGLE', name: 'Single Tender' },
  { key: 'GLOBAL', name: 'Global Tender' },
];

interface CategorySeed {
  slug: string;
  name: string;
  children?: { slug: string; name: string }[];
}

/** A representative starting set, not an exhaustive taxonomy — admins extend this over time. */
export const CATEGORY_SEED_DATA: CategorySeed[] = [
  {
    slug: 'construction-infrastructure',
    name: 'Construction & Infrastructure',
    children: [
      { slug: 'roads-bridges', name: 'Roads & Bridges' },
      { slug: 'buildings-civil-works', name: 'Buildings & Civil Works' },
      { slug: 'water-sanitation', name: 'Water & Sanitation' },
    ],
  },
  {
    slug: 'it-electronics',
    name: 'IT & Electronics',
    children: [
      { slug: 'software-services', name: 'Software Services' },
      { slug: 'hardware-networking', name: 'Hardware & Networking' },
      { slug: 'cctv-security-systems', name: 'CCTV & Security Systems' },
    ],
  },
  {
    slug: 'healthcare-medical',
    name: 'Healthcare & Medical',
    children: [
      { slug: 'medical-equipment', name: 'Medical Equipment' },
      { slug: 'pharmaceuticals', name: 'Pharmaceuticals' },
      { slug: 'hospital-services', name: 'Hospital Services' },
    ],
  },
  {
    slug: 'energy-power',
    name: 'Energy & Power',
    children: [
      { slug: 'solar-renewable', name: 'Solar & Renewable' },
      { slug: 'transmission-distribution', name: 'Transmission & Distribution' },
    ],
  },
  {
    slug: 'consultancy-services',
    name: 'Consultancy Services',
    children: [
      { slug: 'engineering-consultancy', name: 'Engineering Consultancy' },
      { slug: 'management-consultancy', name: 'Management Consultancy' },
    ],
  },
  {
    slug: 'transport-logistics',
    name: 'Transport & Logistics',
    children: [
      { slug: 'vehicle-supply', name: 'Vehicle Supply' },
      { slug: 'freight-warehousing', name: 'Freight & Warehousing' },
    ],
  },
];
