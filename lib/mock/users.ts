export const currentUser = {
  id: "usr-1",
  name: "Harshit Sharma",
  email: "ai.atgc.org@gmail.com",
  role: "Procurement Manager",
  avatarInitials: "HS",
  phone: "+91 98765 43210",
  company: "ATGC Infrastructure Pvt. Ltd.",
  plan: "Professional",
};

export const adminUsers = [
  { id: "u1", name: "Rohan Mehta", email: "rohan.mehta@buildtech.in", company: "BuildTech Constructions", plan: "Enterprise", status: "active" as const, joined: "2025-11-02", lastActive: "2026-09-23" },
  { id: "u2", name: "Ananya Iyer", email: "ananya.iyer@infracorp.in", company: "InfraCorp Solutions", plan: "Professional", status: "active" as const, joined: "2025-12-14", lastActive: "2026-09-22" },
  { id: "u3", name: "Vikram Singh", email: "vikram@bharatworks.co", company: "BharatWorks", plan: "Free", status: "invited" as const, joined: "2026-09-01", lastActive: "2026-09-01" },
  { id: "u4", name: "Priya Nair", email: "priya.nair@techsystems.in", company: "TechSystems India", plan: "Business", status: "active" as const, joined: "2026-02-18", lastActive: "2026-09-21" },
  { id: "u5", name: "Karan Malhotra", email: "karan@enterprise-co.in", company: "Enterprise Co.", plan: "Business", status: "suspended" as const, joined: "2025-08-09", lastActive: "2026-07-11" },
  { id: "u6", name: "Sneha Reddy", email: "sneha.reddy@medisys.in", company: "MediSys Devices", plan: "Professional", status: "active" as const, joined: "2026-04-27", lastActive: "2026-09-20" },
];
