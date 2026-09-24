import type { Tender, TenderStatus, TenderType } from "@/lib/types";

const departments = [
  "Ministry of Railways",
  "Ministry of Health & Family Welfare",
  "Ministry of Defence",
  "Public Works Department, Maharashtra",
  "National Highways Authority of India",
  "Greater Chennai Corporation",
  "Delhi Jal Board",
  "Bharat Sanchar Nigam Limited",
  "Indian Oil Corporation Limited",
  "Municipal Corporation of Greater Mumbai",
  "Uttar Pradesh Power Corporation",
  "Airports Authority of India",
  "Ministry of New and Renewable Energy",
  "Central Public Works Department",
  "State Bank of India",
  "Karnataka Rural Infrastructure Development",
];

const categories = [
  "Civil Construction",
  "IT Services",
  "Medical Equipment",
  "Road Works",
  "Solar & Renewable Energy",
  "Electrical Works",
  "Water Supply & Sanitation",
  "Consultancy Services",
  "Security Services",
  "Facility Management",
];

const industries = [
  "Construction",
  "Information Technology",
  "Healthcare",
  "Infrastructure",
  "Energy",
  "Manufacturing",
  "Telecom",
  "Other",
];

const states = [
  "Maharashtra",
  "Delhi",
  "Karnataka",
  "Tamil Nadu",
  "Uttar Pradesh",
  "Gujarat",
  "Rajasthan",
  "West Bengal",
  "Telangana",
  "Punjab",
];

const cityByState: Record<string, string> = {
  Maharashtra: "Mumbai",
  Delhi: "New Delhi",
  Karnataka: "Bengaluru",
  "Tamil Nadu": "Chennai",
  "Uttar Pradesh": "Lucknow",
  Gujarat: "Ahmedabad",
  Rajasthan: "Jaipur",
  "West Bengal": "Kolkata",
  Telangana: "Hyderabad",
  Punjab: "Chandigarh",
};

const tenderTypes: TenderType[] = ["Open Tender", "Limited Tender", "EOI", "RFP", "Single Tender", "Global Tender"];

const sources = [
  "GeM Portal",
  "CPPP eProcurement",
  "State eTender Portal",
  "IREPS",
  "MSTC eProcurement",
  "Company Website",
];

const titleTemplates = [
  (c: string, d: string) => `Construction of ${c} at ${d} Regional Office`,
  (c: string, _d: string) => `Supply, Installation & Commissioning of ${c}`,
  (c: string, _d: string) => `Annual Maintenance Contract for ${c} Services`,
  (c: string, d: string) => `Procurement of ${c} for ${d}`,
  (c: string, _d: string) => `Design, Build and Operate ${c} Project`,
  (c: string, _d: string) => `Empanelment of Vendors for ${c}`,
  (c: string, _d: string) => `Upgradation and Modernization of ${c} Infrastructure`,
];

function seededRandom(seed: number) {
  let value = seed;
  return () => {
    value = (value * 9301 + 49297) % 233280;
    return value / 233280;
  };
}

function pick<T>(arr: T[], rand: () => number): T {
  return arr[Math.floor(rand() * arr.length)];
}

function addDays(base: Date, days: number): string {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

function addDaysAt(base: Date, days: number, hoursUtc: number): string {
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(Math.floor(hoursUtc), Math.round((hoursUtc % 1) * 60), 0, 0);
  return d.toISOString();
}

// Typical portal cut-offs in IST: 11:00, 15:00, 17:30, 16:00.
const closingHoursUtc = [5.5, 9.5, 12, 10.5];

const departmentState: Record<string, string> = {
  "Public Works Department, Maharashtra": "Maharashtra",
  "Municipal Corporation of Greater Mumbai": "Maharashtra",
  "Greater Chennai Corporation": "Tamil Nadu",
  "Delhi Jal Board": "Delhi",
  "Uttar Pradesh Power Corporation": "Uttar Pradesh",
  "Karnataka Rural Infrastructure Development": "Karnataka",
};

function deriveStatus(daysToClose: number): TenderStatus {
  if (daysToClose < 0) return "closed";
  if (daysToClose <= 5) return "closing_soon";
  return "open";
}

function generateTender(index: number): Tender {
  const rand = seededRandom(index * 7919 + 13);
  const department = pick(departments, rand);
  const category = pick(categories, rand);
  const randomState = pick(states, rand);
  const state = departmentState[department] ?? randomState;
  const location = cityByState[state];
  const industry = pick(industries, rand);
  let tenderType = pick(tenderTypes, rand);
  const source = pick(sources, rand);
  const title = pick(titleTemplates, rand)(category, department);

  const now = new Date("2026-09-24T00:00:00.000Z");
  const publishedOffset = -Math.floor(rand() * 30);
  const closeOffset = Math.floor(rand() * 40) - 8;
  const publishedDate = addDays(now, publishedOffset);
  const submissionDeadline = addDaysAt(now, closeOffset, closingHoursUtc[index % closingHoursUtc.length]);
  const documentDownloadStart = addDays(now, publishedOffset + 1);
  const bidOpeningDate = addDaysAt(now, closeOffset + 2, 6);

  let status = deriveStatus(closeOffset);
  if (index % 11 === 0) {
    status = "eoi";
    tenderType = "EOI";
  } else if (index % 13 === 0) {
    status = "rfp";
    tenderType = "RFP";
  } else if (index % 9 === 0 && status !== "closed") {
    status = "limited";
    tenderType = "Limited Tender";
  }

  const estimatedValue = Math.floor(rand() * 950_00_000) + 5_00_000;
  const emdAmount = Math.round(estimatedValue * 0.02);
  const documentFee = [500, 1000, 2000, 5000][Math.floor(rand() * 4)];

  return {
    id: `tnd-${index}`,
    tenderId: `ATS/${state.slice(0, 2).toUpperCase()}/2026/${(1000 + index).toString()}`,
    title,
    department,
    organization: department,
    location,
    state,
    category,
    industry,
    tenderType,
    status,
    estimatedValue,
    emdAmount,
    documentFee,
    publishedDate,
    documentDownloadStart,
    submissionDeadline,
    bidOpeningDate,
    source,
    description: `${department} invites bids from eligible and experienced contractors/vendors for "${title}". The scope includes planning, execution, quality assurance and post-completion support as per the technical specifications attached in the tender document. Interested bidders must review all annexures carefully before submission.`,
    eligibility: [
      "Bidder must be registered under GST and hold a valid PAN.",
      "Minimum average annual turnover of ₹1 Crore in the last 3 financial years.",
      "Prior experience of at least 2 similar projects in the last 5 years.",
      "No blacklisting by any Central/State Government department in the last 3 years.",
    ],
    technicalRequirements: [
      "Detailed technical proposal with methodology and timelines.",
      "List of key personnel with relevant qualifications and CVs.",
      "Equipment and machinery deployment plan.",
      "Compliance certificate for applicable quality and safety standards.",
    ],
    financialRequirements: [
      `Earnest Money Deposit (EMD) of ₹${emdAmount.toLocaleString("en-IN")} payable via demand draft or bank guarantee.`,
      `Tender document fee of ₹${documentFee.toLocaleString("en-IN")} (non-refundable).`,
      "Performance bank guarantee of 5% of contract value upon award.",
      "Price bid to be submitted in the prescribed BOQ format only.",
    ],
    termsAndConditions: [
      "Bids submitted after the deadline will not be considered under any circumstances.",
      "The department reserves the right to accept or reject any/all bids without assigning reasons.",
      "Conditional bids shall be summarily rejected.",
      "Successful bidder must sign the agreement within 15 days of the award letter.",
    ],
    biddingProcess: [
      "Online registration and document download from the e-procurement portal.",
      "Submission of technical and financial bids in separate sealed envelopes (or online cover system).",
      "Technical evaluation followed by financial bid opening for qualified bidders.",
      "Award of contract (L1/QCBS as applicable) and issuance of work order.",
    ],
    documents: [
      { id: `${index}-doc-1`, name: "Tender Notice.pdf", type: "pdf", sizeKb: 420 },
      { id: `${index}-doc-2`, name: "Detailed Tender Document.pdf", type: "pdf", sizeKb: 2140 },
      { id: `${index}-doc-3`, name: "BOQ.xlsx", type: "xlsx", sizeKb: 88 },
      { id: `${index}-doc-4`, name: "Drawings & Specifications.zip", type: "zip", sizeKb: 15600 },
    ],
  };
}

export const tenders: Tender[] = Array.from({ length: 64 }, (_, i) => generateTender(i + 1));

export function getTenderById(id: string): Tender | undefined {
  return tenders.find((t) => t.id === id || t.tenderId === id);
}

export function getSimilarTenders(tender: Tender, limit = 4): Tender[] {
  return tenders
    .filter((t) => t.id !== tender.id && (t.category === tender.category || t.department === tender.department))
    .slice(0, limit);
}

export const tenderCategories = categories;
export const tenderStates = states;
export const tenderIndustries = industries;
export const tenderDepartments = departments;
export const tenderSources = sources;
