// Catalog alignment seed: mirrors the exact services & staff (with the same
// slug IDs) that the Codex `salon` UI uses in app/book/page.tsx, so the UI's
// booking payload resolves directly against this backend with no ID mapping.
//
// Idempotent: fixed IDs + upserts, safe to re-run.

import { PrismaClient } from "@prisma/client";
import argon2 from "argon2";

const prisma = new PrismaClient();

const CATEGORIES = [
  { id: "cat-men", name: "Men", gender: "Male", sortOrder: 10, parentId: null },
  { id: "cat-women", name: "Women", gender: "Female", sortOrder: 20, parentId: null },
  { id: "cat-hair", name: "Hair", gender: "Unisex", sortOrder: 30, parentId: null },
  { id: "cat-nails", name: "Nails", gender: "Unisex", sortOrder: 40, parentId: null },
  { id: "cat-skin", name: "Skin", gender: "Unisex", sortOrder: 50, parentId: null },
  { id: "cat-grooming", name: "Grooming", gender: "Unisex", sortOrder: 60, parentId: null },
  { id: "cat-colour", name: "Colour", gender: "Unisex", sortOrder: 70, parentId: null },

  { id: "cat-men-hair-grooming", name: "Hair & Grooming", gender: "Male", sortOrder: 11, parentId: "cat-men" },
  { id: "cat-men-dtan-bleach", name: "D-Tan & Bleach", gender: "Male", sortOrder: 12, parentId: "cat-men" },
  { id: "cat-men-cleanup", name: "Clean-Up", gender: "Male", sortOrder: 13, parentId: "cat-men" },
  { id: "cat-men-facials", name: "Facials", gender: "Male", sortOrder: 14, parentId: "cat-men" },
  { id: "cat-men-hair-colour", name: "Hair Colour", gender: "Male", sortOrder: 15, parentId: "cat-men" },
  { id: "cat-men-hair-treatments", name: "Hair Treatments", gender: "Male", sortOrder: 16, parentId: "cat-men" },
  { id: "cat-men-waxing", name: "Waxing", gender: "Male", sortOrder: 17, parentId: "cat-men" },

  { id: "cat-women-dtan", name: "D-Tan", gender: "Female", sortOrder: 21, parentId: "cat-women" },
  { id: "cat-women-body-treatments", name: "Body Treatments", gender: "Female", sortOrder: 22, parentId: "cat-women" },
  { id: "cat-women-facials", name: "Facials", gender: "Female", sortOrder: 23, parentId: "cat-women" },
  { id: "cat-women-cleanup", name: "Clean-Up", gender: "Female", sortOrder: 24, parentId: "cat-women" },
  { id: "cat-women-special-treatments", name: "Special Treatments", gender: "Female", sortOrder: 25, parentId: "cat-women" },
  { id: "cat-women-thread-work", name: "Thread Work", gender: "Female", sortOrder: 26, parentId: "cat-women" },
  { id: "cat-women-face-wax", name: "Face Wax", gender: "Female", sortOrder: 27, parentId: "cat-women" },
  { id: "cat-women-waxing", name: "Waxing", gender: "Female", sortOrder: 28, parentId: "cat-women" },
  { id: "cat-women-bleach", name: "Bleach", gender: "Female", sortOrder: 29, parentId: "cat-women" },

  { id: "cat-nails-manicure", name: "Manicure", gender: "Unisex", sortOrder: 41, parentId: "cat-nails" },
  { id: "cat-nails-pedicure", name: "Pedicure", gender: "Unisex", sortOrder: 42, parentId: "cat-nails" },
  { id: "cat-nails-combos", name: "Mani + Pedi Combos", gender: "Unisex", sortOrder: 43, parentId: "cat-nails" },
  { id: "cat-nails-addons", name: "Add-on Massages", gender: "Unisex", sortOrder: 44, parentId: "cat-nails" },
  { id: "cat-nails-extension", name: "Nail Extension", gender: "Female", sortOrder: 45, parentId: "cat-nails" },
  { id: "cat-nails-art", name: "Nail Art Work", gender: "Female", sortOrder: 46, parentId: "cat-nails" },
  { id: "cat-nails-toe-extension", name: "Toe Extension", gender: "Female", sortOrder: 47, parentId: "cat-nails" },

  { id: "cat-hair-chemical", name: "Hair Chemical Services", gender: "Unisex", sortOrder: 31, parentId: "cat-hair" },
  { id: "cat-hair-rituals", name: "Hair Rituals", gender: "Unisex", sortOrder: 32, parentId: "cat-hair" },
  { id: "cat-hair-color-services", name: "Color Services", gender: "Unisex", sortOrder: 33, parentId: "cat-hair" },
];

// id, categoryId, name, durationMin, priceRupees, eligible staff slugs
const SERVICES = [
  { id: "cut-style", categoryId: "cat-hair", name: "Signature cut & style", durationMin: 60, price: 799, staff: ["riya", "arjun"] },
  { id: "global-colour", categoryId: "cat-colour", name: "Global colour ritual", durationMin: 120, price: 2499, staff: ["riya"] },
  { id: "hair-spa", categoryId: "cat-hair", name: "Restorative hair spa", durationMin: 75, price: 1299, staff: ["riya", "arjun"] },
  { id: "skin-reset", categoryId: "cat-skin", name: "Skin reset facial", durationMin: 75, price: 1499, staff: ["meher"] },
  { id: "beard-sculpt", categoryId: "cat-grooming", name: "Beard sculpt & care", durationMin: 35, price: 499, staff: ["arjun"] },
  { id: "manicure", categoryId: "cat-nails", name: "Essential manicure", durationMin: 45, price: 699, staff: ["meher"] },

  { id: "menu-men-haircut", categoryId: "cat-men-hair-grooming", name: "Men Haircut", durationMin: 30, price: 150, staff: ["arjun"] },
  { id: "menu-men-beard", categoryId: "cat-men-hair-grooming", name: "Beard", durationMin: 20, price: 100, staff: ["arjun"] },
  { id: "menu-men-head-wash", categoryId: "cat-men-hair-grooming", name: "Head Wash", durationMin: 15, price: 50, staff: ["arjun", "riya"] },
  { id: "menu-men-head-massage", categoryId: "cat-men-hair-grooming", name: "Head Massage", durationMin: 25, price: 200, staff: ["arjun", "riya"] },
  { id: "menu-men-dtan-o3", categoryId: "cat-men-dtan-bleach", name: "Men O3+ D-Tan", durationMin: 35, price: 400, staff: ["arjun", "meher"] },
  { id: "menu-men-ozone-dtan", categoryId: "cat-men-dtan-bleach", name: "Men Ozone D-Tan", durationMin: 35, price: 400, staff: ["arjun", "meher"] },
  { id: "menu-men-sara-dtan", categoryId: "cat-men-dtan-bleach", name: "Men Sara D-Tan", durationMin: 35, price: 350, staff: ["arjun", "meher"] },
  { id: "menu-men-raga-dtan", categoryId: "cat-men-dtan-bleach", name: "Men Raga D-Tan", durationMin: 35, price: 350, staff: ["arjun", "meher"] },
  { id: "menu-men-oxy-bleach", categoryId: "cat-men-dtan-bleach", name: "Men Oxy Bleach", durationMin: 30, price: 250, staff: ["arjun", "meher"] },
  { id: "menu-men-o3-cleanup", categoryId: "cat-men-cleanup", name: "Men O3+ Clean-Up", durationMin: 45, price: 1000, staff: ["meher"] },
  { id: "menu-men-lotus-cleanup", categoryId: "cat-men-cleanup", name: "Men Lotus Clean-Up", durationMin: 45, price: 800, staff: ["meher"] },
  { id: "menu-men-fruit-cleanup", categoryId: "cat-men-cleanup", name: "Men Fruit Clean-Up", durationMin: 35, price: 250, staff: ["meher"] },
  { id: "menu-men-o3-facial", categoryId: "cat-men-facials", name: "Men O3+ Facial", durationMin: 75, price: 2200, staff: ["meher"] },
  { id: "menu-men-lotus-facial", categoryId: "cat-men-facials", name: "Men Lotus Facial", durationMin: 70, price: 1500, staff: ["meher"] },
  { id: "menu-men-hydra-facial", categoryId: "cat-men-facials", name: "Men Hydra Facial", durationMin: 70, price: 1000, staff: ["meher"] },
  { id: "menu-men-raga-facial", categoryId: "cat-men-facials", name: "Men Raga Facial", durationMin: 70, price: 1000, staff: ["meher"] },
  { id: "menu-men-machine-hydra-facial", categoryId: "cat-men-facials", name: "Men Machine Hydra Facial", durationMin: 80, price: 2500, staff: ["meher"] },
  { id: "menu-men-kanpeki-facial", categoryId: "cat-men-facials", name: "Men Kanpeki Facial", durationMin: 80, price: 2500, staff: ["meher"] },
  { id: "menu-men-loreal-majirel", categoryId: "cat-men-hair-colour", name: "Men L'Oreal Majirel Hair Colour", durationMin: 75, price: 500, staff: ["riya", "arjun"] },
  { id: "menu-men-nova-colour", categoryId: "cat-men-hair-colour", name: "Men Nova Hair Colour", durationMin: 75, price: 700, staff: ["riya", "arjun"] },
  { id: "menu-men-streaks", categoryId: "cat-men-hair-colour", name: "Men Streaks", durationMin: 75, price: 350, staff: ["riya", "arjun"] },
  { id: "menu-men-beard-colour", categoryId: "cat-men-hair-colour", name: "Beard Colour", durationMin: 35, price: 300, staff: ["arjun"] },
  { id: "menu-men-loreal-hair-spa", categoryId: "cat-men-hair-treatments", name: "Men L'Oreal Hair Spa", durationMin: 60, price: 500, staff: ["riya", "arjun"] },
  { id: "menu-men-schwarzkopf-hair-spa", categoryId: "cat-men-hair-treatments", name: "Men Schwarzkopf Hair Spa", durationMin: 60, price: 500, staff: ["riya", "arjun"] },
  { id: "menu-men-smoothing", categoryId: "cat-men-hair-treatments", name: "Men Smoothing", durationMin: 120, price: 1000, staff: ["riya", "arjun"] },
  { id: "menu-men-botox", categoryId: "cat-men-hair-treatments", name: "Men Botox", durationMin: 120, price: 1000, staff: ["riya", "arjun"] },
  { id: "menu-men-keratin", categoryId: "cat-men-hair-treatments", name: "Men Keratin", durationMin: 120, price: 1000, staff: ["riya", "arjun"] },
  { id: "menu-men-ear-wax", categoryId: "cat-men-waxing", name: "Ear Wax", durationMin: 15, price: 100, staff: ["arjun", "meher"] },
  { id: "menu-men-nose-wax", categoryId: "cat-men-waxing", name: "Nose Wax", durationMin: 15, price: 100, staff: ["arjun", "meher"] },

  { id: "menu-basic-manicure", categoryId: "cat-nails-manicure", name: "Basic Manicure", durationMin: 35, price: 250, staff: ["meher"] },
  { id: "menu-lemon-manicure", categoryId: "cat-nails-manicure", name: "Lemon Manicure", durationMin: 45, price: 500, staff: ["meher"] },
  { id: "menu-sara-manicure", categoryId: "cat-nails-manicure", name: "Sara Manicure", durationMin: 45, price: 600, staff: ["meher"] },
  { id: "menu-o3-manicure", categoryId: "cat-nails-manicure", name: "O3+ Manicure", durationMin: 50, price: 700, staff: ["meher"] },
  { id: "menu-lotus-manicure", categoryId: "cat-nails-manicure", name: "Lotus Manicure", durationMin: 50, price: 800, staff: ["meher"] },
  { id: "menu-basic-pedicure", categoryId: "cat-nails-pedicure", name: "Basic Pedicure", durationMin: 40, price: 350, staff: ["meher"] },
  { id: "menu-lemon-pedicure", categoryId: "cat-nails-pedicure", name: "Lemon Pedicure", durationMin: 50, price: 600, staff: ["meher"] },
  { id: "menu-sara-pedicure", categoryId: "cat-nails-pedicure", name: "Sara Pedicure", durationMin: 55, price: 800, staff: ["meher"] },
  { id: "menu-o3-pedicure", categoryId: "cat-nails-pedicure", name: "O3+ Pedicure", durationMin: 60, price: 1000, staff: ["meher"] },
  { id: "menu-lotus-pedicure", categoryId: "cat-nails-pedicure", name: "Lotus Pedicure", durationMin: 60, price: 1200, staff: ["meher"] },
  { id: "menu-basic-mani-pedi-combo", categoryId: "cat-nails-combos", name: "Basic Mani-Pedi Combo", durationMin: 75, price: 700, staff: ["meher"] },
  { id: "menu-lemon-mani-pedi-combo", categoryId: "cat-nails-combos", name: "Lemon Mani-Pedi Combo", durationMin: 85, price: 900, staff: ["meher"] },
  { id: "menu-sara-mani-pedi-combo", categoryId: "cat-nails-combos", name: "Sara Mani-Pedi Combo", durationMin: 90, price: 1100, staff: ["meher"] },
  { id: "menu-o3-mani-pedi-combo", categoryId: "cat-nails-combos", name: "O3+ Mani-Pedi Combo", durationMin: 100, price: 1400, staff: ["meher"] },
  { id: "menu-lotus-mani-pedi-combo", categoryId: "cat-nails-combos", name: "Lotus Mani-Pedi Combo", durationMin: 110, price: 1700, staff: ["meher"] },
  { id: "menu-foot-massage", categoryId: "cat-nails-addons", name: "Foot Massage", durationMin: 20, price: 200, staff: ["meher"] },
  { id: "menu-nails-head-massage", categoryId: "cat-nails-addons", name: "Head Massage Add-on", durationMin: 20, price: 350, staff: ["meher", "riya"] },
  { id: "menu-gel-power-polish", categoryId: "cat-nails-extension", name: "Gel Power Polish", durationMin: 45, price: 400, staff: ["meher"] },
  { id: "menu-acrylic-extension", categoryId: "cat-nails-extension", name: "Acrylic Extension", durationMin: 90, price: 1000, staff: ["meher"] },
  { id: "menu-gel-extension", categoryId: "cat-nails-extension", name: "Gel Extension", durationMin: 80, price: 700, staff: ["meher"] },
  { id: "menu-extension-removal", categoryId: "cat-nails-extension", name: "Extension Removal", durationMin: 30, price: 200, staff: ["meher"] },
  { id: "menu-ombre-nails", categoryId: "cat-nails-art", name: "Ombre Nails", durationMin: 20, price: 40, staff: ["meher"] },
  { id: "menu-marble-art", categoryId: "cat-nails-art", name: "Marble Nail Art", durationMin: 20, price: 30, staff: ["meher"] },
  { id: "menu-cat-eye", categoryId: "cat-nails-art", name: "Cat Eye Nail Art", durationMin: 20, price: 30, staff: ["meher"] },
  { id: "menu-stone-nail-art", categoryId: "cat-nails-art", name: "Stone Nail Art", durationMin: 20, price: 30, staff: ["meher"] },
  { id: "menu-glitter-nail-art", categoryId: "cat-nails-art", name: "Glitter Nail Art", durationMin: 15, price: 10, staff: ["meher"] },
  { id: "menu-chrome-nail-art", categoryId: "cat-nails-art", name: "Chrome Nail Art", durationMin: 20, price: 40, staff: ["meher"] },
  { id: "menu-toe-gel-polish", categoryId: "cat-nails-toe-extension", name: "Toe Gel Polish", durationMin: 35, price: 300, staff: ["meher"] },
  { id: "menu-toe-extension", categoryId: "cat-nails-toe-extension", name: "Toe Extension", durationMin: 70, price: 800, staff: ["meher"] },

  { id: "menu-women-ozone-dtan", categoryId: "cat-women-dtan", name: "Women Ozone D-Tan", durationMin: 30, price: 300, staff: ["meher"] },
  { id: "menu-women-raga-dtan", categoryId: "cat-women-dtan", name: "Women Raga D-Tan", durationMin: 30, price: 400, staff: ["meher"] },
  { id: "menu-women-sara-dtan", categoryId: "cat-women-dtan", name: "Women Sara D-Tan", durationMin: 30, price: 450, staff: ["meher"] },
  { id: "menu-body-polishing", categoryId: "cat-women-body-treatments", name: "Body Polishing", durationMin: 90, price: 3000, staff: ["meher"] },
  { id: "menu-body-massage", categoryId: "cat-women-body-treatments", name: "Body Massage", durationMin: 75, price: 2000, staff: ["meher"] },
  { id: "menu-women-fruit-facial", categoryId: "cat-women-facials", name: "Women Fruit Facial", durationMin: 50, price: 400, staff: ["meher"] },
  { id: "menu-women-vlcc-facial", categoryId: "cat-women-facials", name: "Women VLCC Facial", durationMin: 55, price: 500, staff: ["meher"] },
  { id: "menu-women-korean-facial", categoryId: "cat-women-facials", name: "Women Korean Facial", durationMin: 70, price: 1000, staff: ["meher"] },
  { id: "menu-women-raga-facial", categoryId: "cat-women-facials", name: "Women Raga Facial", durationMin: 75, price: 1500, staff: ["meher"] },
  { id: "menu-women-wine-facial", categoryId: "cat-women-facials", name: "Women Wine Facial", durationMin: 70, price: 1000, staff: ["meher"] },
  { id: "menu-women-rice-facial", categoryId: "cat-women-facials", name: "Women Rice Facial", durationMin: 75, price: 1800, staff: ["meher"] },
  { id: "menu-women-lotus-facial", categoryId: "cat-women-facials", name: "Women Lotus Facial", durationMin: 70, price: 1300, staff: ["meher"] },
  { id: "menu-women-hydra-facial", categoryId: "cat-women-facials", name: "Women Hydra Facial", durationMin: 80, price: 3000, staff: ["meher"] },
  { id: "menu-women-kanpeki-facial", categoryId: "cat-women-facials", name: "Women Kanpeki Facial", durationMin: 75, price: 2000, staff: ["meher"] },
  { id: "menu-women-o3-facial", categoryId: "cat-women-facials", name: "Women O3+ Facial", durationMin: 80, price: 2500, staff: ["meher"] },
  { id: "menu-women-ozone-facial", categoryId: "cat-women-facials", name: "Women Ozone Facial", durationMin: 75, price: 1800, staff: ["meher"] },
  { id: "menu-women-fruit-cleanup", categoryId: "cat-women-cleanup", name: "Women Fruit Clean-Up", durationMin: 35, price: 300, staff: ["meher"] },
  { id: "menu-women-vlcc-cleanup", categoryId: "cat-women-cleanup", name: "Women VLCC Clean-Up", durationMin: 40, price: 400, staff: ["meher"] },
  { id: "menu-women-lotus-cleanup", categoryId: "cat-women-cleanup", name: "Women Lotus Clean-Up", durationMin: 45, price: 800, staff: ["meher"] },
  { id: "menu-women-o3-cleanup", categoryId: "cat-women-cleanup", name: "Women O3+ Clean-Up", durationMin: 45, price: 1200, staff: ["meher"] },
  { id: "menu-anti-ageing-treatment", categoryId: "cat-women-special-treatments", name: "Anti-Ageing Treatment", durationMin: 60, price: 1500, staff: ["meher"] },
  { id: "menu-acne-treatment", categoryId: "cat-women-special-treatments", name: "Acne Treatment", durationMin: 60, price: 1500, staff: ["meher"] },

  { id: "menu-eyebrow-threading", categoryId: "cat-women-thread-work", name: "Eyebrow Threading", durationMin: 10, price: 50, staff: ["meher"] },
  { id: "menu-forehead-threading", categoryId: "cat-women-thread-work", name: "Forehead Threading", durationMin: 10, price: 30, staff: ["meher"] },
  { id: "menu-upperlip-threading", categoryId: "cat-women-thread-work", name: "Upperlip Threading", durationMin: 10, price: 30, staff: ["meher"] },
  { id: "menu-chin-threading", categoryId: "cat-women-thread-work", name: "Chin Threading", durationMin: 10, price: 30, staff: ["meher"] },
  { id: "menu-sidelocks-wax", categoryId: "cat-women-face-wax", name: "Sidelocks Wax", durationMin: 10, price: 50, staff: ["meher"] },
  { id: "menu-upperlip-wax", categoryId: "cat-women-face-wax", name: "Upperlip Wax", durationMin: 10, price: 50, staff: ["meher"] },
  { id: "menu-forehead-wax", categoryId: "cat-women-face-wax", name: "Forehead Wax", durationMin: 10, price: 80, staff: ["meher"] },
  { id: "menu-nose-wax", categoryId: "cat-women-face-wax", name: "Nose Wax", durationMin: 10, price: 50, staff: ["meher"] },
  { id: "menu-chin-wax", categoryId: "cat-women-face-wax", name: "Chin Wax", durationMin: 10, price: 50, staff: ["meher"] },
  { id: "menu-full-face-wax", categoryId: "cat-women-face-wax", name: "Full Face Wax", durationMin: 30, price: 300, staff: ["meher"] },
  { id: "menu-full-arms-honey-wax", categoryId: "cat-women-waxing", name: "Full Arms Honey Wax", durationMin: 35, price: 250, staff: ["meher"] },
  { id: "menu-full-arms-white-chocolate-wax", categoryId: "cat-women-waxing", name: "Full Arms White Chocolate Wax", durationMin: 35, price: 350, staff: ["meher"] },
  { id: "menu-full-arms-rica-wax", categoryId: "cat-women-waxing", name: "Full Arms Rica Wax", durationMin: 35, price: 500, staff: ["meher"] },
  { id: "menu-underarms-honey-wax", categoryId: "cat-women-waxing", name: "Underarms Honey Wax", durationMin: 20, price: 80, staff: ["meher"] },
  { id: "menu-underarms-white-chocolate-wax", categoryId: "cat-women-waxing", name: "Underarms White Chocolate Wax", durationMin: 20, price: 100, staff: ["meher"] },
  { id: "menu-underarms-rica-wax", categoryId: "cat-women-waxing", name: "Underarms Rica Wax", durationMin: 20, price: 150, staff: ["meher"] },
  { id: "menu-front-honey-wax", categoryId: "cat-women-waxing", name: "Front Honey Wax", durationMin: 35, price: 300, staff: ["meher"] },
  { id: "menu-front-white-chocolate-wax", categoryId: "cat-women-waxing", name: "Front White Chocolate Wax", durationMin: 35, price: 400, staff: ["meher"] },
  { id: "menu-front-rica-wax", categoryId: "cat-women-waxing", name: "Front Rica Wax", durationMin: 35, price: 500, staff: ["meher"] },
  { id: "menu-back-honey-wax", categoryId: "cat-women-waxing", name: "Back Honey Wax", durationMin: 35, price: 400, staff: ["meher"] },
  { id: "menu-back-white-chocolate-wax", categoryId: "cat-women-waxing", name: "Back White Chocolate Wax", durationMin: 35, price: 400, staff: ["meher"] },
  { id: "menu-back-rica-wax", categoryId: "cat-women-waxing", name: "Back Rica Wax", durationMin: 35, price: 500, staff: ["meher"] },
  { id: "menu-half-legs-honey-wax", categoryId: "cat-women-waxing", name: "Half Legs Honey Wax", durationMin: 35, price: 250, staff: ["meher"] },
  { id: "menu-half-legs-white-chocolate-wax", categoryId: "cat-women-waxing", name: "Half Legs White Chocolate Wax", durationMin: 35, price: 350, staff: ["meher"] },
  { id: "menu-half-legs-rica-wax", categoryId: "cat-women-waxing", name: "Half Legs Rica Wax", durationMin: 35, price: 500, staff: ["meher"] },
  { id: "menu-full-legs-honey-wax", categoryId: "cat-women-waxing", name: "Full Legs Honey Wax", durationMin: 50, price: 400, staff: ["meher"] },
  { id: "menu-full-legs-white-chocolate-wax", categoryId: "cat-women-waxing", name: "Full Legs White Chocolate Wax", durationMin: 50, price: 500, staff: ["meher"] },
  { id: "menu-full-legs-rica-wax", categoryId: "cat-women-waxing", name: "Full Legs Rica Wax", durationMin: 50, price: 1000, staff: ["meher"] },
  { id: "menu-full-body-honey-wax", categoryId: "cat-women-waxing", name: "Full Body Honey Wax", durationMin: 120, price: 1000, staff: ["meher"] },
  { id: "menu-full-body-white-chocolate-wax", categoryId: "cat-women-waxing", name: "Full Body White Chocolate Wax", durationMin: 120, price: 1500, staff: ["meher"] },
  { id: "menu-full-body-rica-wax", categoryId: "cat-women-waxing", name: "Full Body Rica Wax", durationMin: 120, price: 2000, staff: ["meher"] },
  { id: "menu-b-wax-honey", categoryId: "cat-women-waxing", name: "B. Wax Honey", durationMin: 45, price: 1000, staff: ["meher"] },
  { id: "menu-b-wax-white-chocolate", categoryId: "cat-women-waxing", name: "B. Wax White Chocolate", durationMin: 45, price: 1200, staff: ["meher"] },
  { id: "menu-b-wax-rica", categoryId: "cat-women-waxing", name: "B. Wax Rica", durationMin: 45, price: 1500, staff: ["meher"] },
  { id: "menu-face-fruit-bleach", categoryId: "cat-women-bleach", name: "Face Fruit Bleach", durationMin: 25, price: 200, staff: ["meher"] },
  { id: "menu-face-oxy-bleach", categoryId: "cat-women-bleach", name: "Face Oxy Bleach", durationMin: 25, price: 350, staff: ["meher"] },
  { id: "menu-face-o3-bleach", categoryId: "cat-women-bleach", name: "Face O3+ Bleach", durationMin: 25, price: 400, staff: ["meher"] },
  { id: "menu-front-fruit-bleach", categoryId: "cat-women-bleach", name: "Front Fruit Bleach", durationMin: 35, price: 200, staff: ["meher"] },
  { id: "menu-front-oxy-bleach", categoryId: "cat-women-bleach", name: "Front Oxy Bleach", durationMin: 35, price: 300, staff: ["meher"] },
  { id: "menu-front-o3-bleach", categoryId: "cat-women-bleach", name: "Front O3+ Bleach", durationMin: 35, price: 500, staff: ["meher"] },
  { id: "menu-back-fruit-bleach", categoryId: "cat-women-bleach", name: "Back Fruit Bleach", durationMin: 35, price: 300, staff: ["meher"] },
  { id: "menu-back-oxy-bleach", categoryId: "cat-women-bleach", name: "Back Oxy Bleach", durationMin: 35, price: 400, staff: ["meher"] },
  { id: "menu-back-o3-bleach", categoryId: "cat-women-bleach", name: "Back O3+ Bleach", durationMin: 35, price: 700, staff: ["meher"] },
  { id: "menu-arms-fruit-bleach", categoryId: "cat-women-bleach", name: "Arms Fruit Bleach", durationMin: 35, price: 400, staff: ["meher"] },
  { id: "menu-arms-oxy-bleach", categoryId: "cat-women-bleach", name: "Arms Oxy Bleach", durationMin: 35, price: 500, staff: ["meher"] },
  { id: "menu-arms-o3-bleach", categoryId: "cat-women-bleach", name: "Arms O3+ Bleach", durationMin: 35, price: 700, staff: ["meher"] },
  { id: "menu-full-body-fruit-bleach", categoryId: "cat-women-bleach", name: "Full Body Fruit Bleach", durationMin: 90, price: 1000, staff: ["meher"] },
  { id: "menu-full-body-oxy-bleach", categoryId: "cat-women-bleach", name: "Full Body Oxy Bleach", durationMin: 90, price: 1500, staff: ["meher"] },
  { id: "menu-full-body-o3-bleach", categoryId: "cat-women-bleach", name: "Full Body O3+ Bleach", durationMin: 90, price: 1800, staff: ["meher"] },

  { id: "menu-hair-chemical-keratin", categoryId: "cat-hair-chemical", name: "Keratin", durationMin: 150, price: 1500, staff: ["riya", "arjun"] },
  { id: "menu-hair-chemical-botox", categoryId: "cat-hair-chemical", name: "Botox", durationMin: 150, price: 2000, staff: ["riya", "arjun"] },
  { id: "menu-hair-chemical-neoplasia", categoryId: "cat-hair-chemical", name: "Neoplasia", durationMin: 160, price: 2500, staff: ["riya"] },
  { id: "menu-hair-chemical-smoothing", categoryId: "cat-hair-chemical", name: "Smoothing", durationMin: 180, price: 3000, staff: ["riya"] },
  { id: "menu-hair-chemical-kerasmooth", categoryId: "cat-hair-chemical", name: "Kerasmooth", durationMin: 180, price: 4000, staff: ["riya"] },
  { id: "menu-hair-chemical-kerashine", categoryId: "cat-hair-chemical", name: "Kerashine", durationMin: 180, price: 4500, staff: ["riya"] },
  { id: "menu-hair-ritual-ola-plex", categoryId: "cat-hair-rituals", name: "Ola Plex", durationMin: 75, price: 1500, staff: ["riya"] },
  { id: "menu-hair-ritual-loreal-spa", categoryId: "cat-hair-rituals", name: "Loreal Hair Spa", durationMin: 60, price: 500, staff: ["riya", "arjun"] },
  { id: "menu-hair-ritual-loreal-power-booster", categoryId: "cat-hair-rituals", name: "Loreal Hair Spa With Power Booster", durationMin: 70, price: 700, staff: ["riya"] },
  { id: "menu-hair-ritual-deep-conditioning", categoryId: "cat-hair-rituals", name: "Deep Conditioning With Steam", durationMin: 45, price: 350, staff: ["riya", "arjun"] },
  { id: "menu-color-global", categoryId: "cat-hair-color-services", name: "Global Colour", durationMin: 120, price: 2000, staff: ["riya"] },
  { id: "menu-color-highlights", categoryId: "cat-hair-color-services", name: "Highlights", durationMin: 120, price: 2500, staff: ["riya"] },
  { id: "menu-color-balayage", categoryId: "cat-hair-color-services", name: "Balayage", durationMin: 140, price: 2500, staff: ["riya"] },
  { id: "menu-color-ombre", categoryId: "cat-hair-color-services", name: "Ombre", durationMin: 140, price: 2500, staff: ["riya"] },
  { id: "menu-color-global-highlights", categoryId: "cat-hair-color-services", name: "Global & Highlights", durationMin: 180, price: 4000, staff: ["riya"] },
  { id: "menu-color-global-balayage", categoryId: "cat-hair-color-services", name: "Global + Balayage", durationMin: 180, price: 4000, staff: ["riya"] },
];

const STAFF = [
  { id: "faizan", name: "Faizan", designation: "Female Hair Dresser", salaryMinor: 30_00_000, startMin: 11 * 60, endMin: 21 * 60 },
  { id: "farman", name: "Farman", designation: "Male Hair Dresser", salaryMinor: 20_00_000, startMin: 10 * 60, endMin: 20 * 60 + 30, weekendEndMin: 21 * 60 },
  { id: "khushi", name: "Khushi", designation: "Nail Artist", salaryMinor: 15_00_000, startMin: 10 * 60, endMin: 20 * 60 + 30 },
  { id: "pooja", name: "Pooja", designation: "Beautician", salaryMinor: 14_00_000, startMin: 11 * 60, endMin: 21 * 60 },
  { id: "nitin", name: "Nitin", designation: "Manicure Pedicure", salaryMinor: 14_00_000, startMin: 10 * 60 + 40, endMin: 21 * 60 },
  { id: "shanti", name: "Shanti (didi)", designation: "Cleaning Staff", salaryMinor: 12_00_000, startMin: 9 * 60 + 30, endMin: 21 * 60 },
];

const DEMO_STAFF_IDS = ["riya", "arjun", "meher"];

function staffForService(service: { id: string; categoryId: string; name: string }) {
  const category = service.categoryId.toLowerCase();
  const name = service.name.toLowerCase();
  if (category.includes("manicure") || category.includes("pedicure") || name.includes("pedicure") || name.includes("manicure") || name.includes("foot massage")) return ["nitin"];
  if (category.includes("nail") || name.includes("nail") || name.includes("extension")) return ["khushi"];
  if (category.startsWith("cat-men") || category === "cat-grooming" || name.includes("beard")) return ["farman"];
  if (category.includes("hair") || name.includes("hair") || name.includes("keratin") || name.includes("botox") || name.includes("smooth") || name.includes("global") || name.includes("highlight") || name.includes("colour") || name.includes("color")) return ["faizan"];
  if (category.includes("facial") || category.includes("wax") || category.includes("thread") || category.includes("bleach") || category.includes("tan") || category.includes("clean") || category.includes("body")) return ["pooja"];
  return ["pooja"];
}

async function main() {
  await prisma.branch.upsert({
    where: { id: "main" },
    create: { id: "main", name: "Cutz & Bangs — Sector 15 Dwarka", timezone: "Asia/Kolkata", currency: "INR", latitude: 28.6166967, longitude: 77.0283703, address: "First Floor, Plot No. 118, Main Kakrola Road, Patel Garden, Sector 15 Dwarka, New Delhi, Delhi 110059" },
    update: { name: "Cutz & Bangs — Sector 15 Dwarka", latitude: 28.6166967, longitude: 77.0283703, address: "First Floor, Plot No. 118, Main Kakrola Road, Patel Garden, Sector 15 Dwarka, New Delhi, Delhi 110059" },
  });

  const ownerEmail = process.env.SEED_OWNER_EMAIL?.trim().toLowerCase();
  const ownerPassword = process.env.SEED_OWNER_PASSWORD;
  if (Boolean(ownerEmail) !== Boolean(ownerPassword)) throw new Error("SEED_OWNER_EMAIL and SEED_OWNER_PASSWORD must be supplied together");
  if (ownerEmail && ownerPassword) {
    if (ownerEmail.endsWith("@cutzbangs.local")) throw new Error("SEED_OWNER_EMAIL must be a real non-@cutzbangs.local address");
    if (ownerPassword.length < 12) throw new Error("SEED_OWNER_PASSWORD must be at least 12 characters");
    await prisma.user.upsert({
      where: { email: ownerEmail },
      create: { email: ownerEmail, role: "OWNER", branchId: "main", passwordHash: await argon2.hash(ownerPassword, { type: argon2.argon2id }) },
      update: { role: "OWNER", branchId: "main", isActive: true, passwordHash: await argon2.hash(ownerPassword, { type: argon2.argon2id }) },
    });
  }

  for (const c of CATEGORIES) {
    await prisma.serviceCategory.upsert({
      where: { id: c.id },
      create: c,
      update: { name: c.name, gender: c.gender, sortOrder: c.sortOrder, parentId: c.parentId },
    });
  }

  for (const s of SERVICES) {
    await prisma.service.upsert({
      where: { id: s.id },
      create: {
        id: s.id,
        categoryId: s.categoryId,
        name: s.name,
        durationMin: s.durationMin,
        bufferMin: 5,
        priceMinor: s.price * 100,
        taxRateBps: 1800,
      },
      update: { categoryId: s.categoryId, name: s.name, durationMin: s.durationMin, priceMinor: s.price * 100, isActive: true, deletedAt: null },
    });
  }

  for (const st of STAFF) {
    await prisma.staff.upsert({
      where: { id: st.id },
      create: {
        id: st.id,
        userId: null,
        branchId: "main",
        displayName: st.name,
        designation: st.designation,
        baseSalaryMinor: st.salaryMinor,
        commissionRate: 0,
        commissionThresholdMinor: 0,
        lateGraceMinutes: 15,
        lateDeductionMinor: Math.round(st.salaryMinor / 60),
        halfDayAfterMinutes: 240,
      },
      update: {
        userId: null,
        displayName: st.name,
        designation: st.designation,
        baseSalaryMinor: st.salaryMinor,
        commissionRate: 0,
        commissionThresholdMinor: 0,
        lateGraceMinutes: 15,
        lateDeductionMinor: Math.round(st.salaryMinor / 60),
        halfDayAfterMinutes: 240,
        isActive: true,
        deletedAt: null,
      },
    });
    // Exact team shifts supplied by the salon owner. Staff login is created only through an invite.
    await prisma.shift.deleteMany({ where: { staffId: st.id } });
    await prisma.shift.createMany({
      data: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
        staffId: st.id,
        weekday,
        startMin: st.startMin,
        endMin: "weekendEndMin" in st && (weekday === 0 || weekday === 6) ? st.weekendEndMin : st.endMin,
        breakStartMin: 14 * 60,
        breakEndMin: 14 * 60 + 30,
      })),
    });
  }

  // Disable known legacy placeholder accounts without deleting any business data.
  await prisma.user.updateMany({
    where: { email: { endsWith: "@cutzbangs.local" } },
    data: { isActive: false, passwordHash: null },
  });

  for (const staffId of DEMO_STAFF_IDS) {
    await prisma.staff.updateMany({ where: { id: staffId }, data: { isActive: false, deletedAt: new Date() } });
    await prisma.user.updateMany({ where: { email: `${staffId}@cutzbangs.local` }, data: { isActive: false } });
  }
  await prisma.staff.updateMany({
    where: { branchId: "main", displayName: { in: ["Asha", "Riya Sen", "Arjun Khanna", "Meher Malik"] } },
    data: { isActive: false, deletedAt: new Date() },
  });
  await prisma.serviceStaff.deleteMany({ where: { staff: { isActive: false } } });
  await prisma.staffSkill.deleteMany({ where: { staff: { isActive: false } } });

  // Skill + eligibility mappings (idempotent).
  for (const s of SERVICES) {
    await prisma.serviceStaff.deleteMany({ where: { serviceId: s.id } });
    await prisma.staffSkill.deleteMany({ where: { serviceId: s.id } });
    for (const staffId of staffForService(s)) {
      await prisma.serviceStaff.upsert({
        where: { serviceId_staffId: { serviceId: s.id, staffId } },
        create: { serviceId: s.id, staffId },
        update: {},
      });
      await prisma.staffSkill.upsert({
        where: { staffId_serviceId: { staffId, serviceId: s.id } },
        create: { staffId, serviceId: s.id },
        update: {},
      });
    }
  }

  const MEMBERSHIPS = [
    { id: "membership-basic", name: "Basic", payMinor: 300_000, creditMinor: 500_000 },
    { id: "membership-premium", name: "Premium", payMinor: 1_000_000, creditMinor: 1_500_000 },
    { id: "membership-super-premium", name: "Super Premium", payMinor: 2_000_000, creditMinor: 3_200_000 },
  ];
  for (const plan of MEMBERSHIPS) {
    await prisma.membershipPlan.upsert({
      where: { id: plan.id },
      create: { ...plan, validityDays: 365, memberDiscountBps: 0 },
      update: { name: plan.name, payMinor: plan.payMinor, creditMinor: plan.creditMinor, validityDays: 365, isActive: true },
    });
  }

  await prisma.servicePackagePlan.upsert({
    where: { id: "package-hair-essentials" },
    create: {
      id: "package-hair-essentials",
      name: "Hair Essentials",
      priceMinor: 349_900,
      validityDays: 180,
      items: {
        create: [
          { serviceId: "cut-style", qty: 3 },
          { serviceId: "hair-spa", qty: 1 },
        ],
      },
    },
    update: { name: "Hair Essentials", priceMinor: 349_900, validityDays: 180, isActive: true },
  });

  await prisma.setting.upsert({
    where: { key: "branch:main:loyalty" },
    create: {
      key: "branch:main:loyalty",
      value: { enabled: true, welcomePoints: 50, earnPoints: 1, earnEveryMinor: 10_000, redeemMinorPerPoint: 100, minRedeemPoints: 50 },
    },
    update: {},
  });

  console.log(`Codex catalog seeded: ${CATEGORIES.length} categories, ${SERVICES.length} services, ${STAFF.length} staff, ${MEMBERSHIPS.length} memberships and 1 service package.`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
