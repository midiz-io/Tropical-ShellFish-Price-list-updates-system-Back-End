// routes/customerAuth.js
import express from "express";
import bcrypt from "bcrypt";
import crypto from "crypto";
import supabase from "../db.js";

const router = express.Router();

// ── REGISTER ──────────────────────────────
router.post("/register", async (req, res) => {
  const { name, email, password, phone, company, address, city, country } =
    req.body;

  if (!name || !email || !password)
    return res
      .status(400)
      .json({ message: "Name, email and password are required" });

  if (password.length < 6)
    return res
      .status(400)
      .json({ message: "Password must be at least 6 characters" });

  // Check duplicate
  const { data: existing } = await supabase
    .from("customer_accounts")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  if (existing)
    return res
      .status(409)
      .json({ message: "An account with this email already exists" });

  const hashedPassword = await bcrypt.hash(password, 10);

  const { data, error } = await supabase
    .from("customer_accounts")
    .insert({
      name,
      email,
      password: hashedPassword,
      phone,
      company,
      address,
      city,
      country,
    })
    .select(
      "id, name, email, phone, company, address, city, country, created_at",
    )
    .single();

  if (error)
    return res
      .status(500)
      .json({ message: "Registration failed", details: error.message });

  res
    .status(201)
    .json({ message: "Account created successfully", customer: data });
});

// ── LOGIN ──────────────────────────────────
router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ message: "Email and password are required" });

  const { data: customer } = await supabase
    .from("customer_accounts")
    .select("*")
    .eq("email", email)
    .maybeSingle();

  if (!customer)
    return res
      .status(404)
      .json({ message: "No account found with that email" });

  if (!customer.is_active)
    return res.status(403).json({
      message: "Your account has been deactivated. Please contact us.",
    });

  const valid = await bcrypt.compare(password, customer.password);
  if (!valid) return res.status(401).json({ message: "Incorrect password" });

  const { password: _pw, ...safeCustomer } = customer;
  res.json({ message: "Login successful", customer: safeCustomer });
});

// ── GET PROFILE ────────────────────────────
router.get("/profile/:id", async (req, res) => {
  const { data, error } = await supabase
    .from("customer_accounts")
    .select(
      "id, name, email, phone, company, address, city, country, created_at",
    )
    .eq("id", req.params.id)
    .single();

  if (error || !data)
    return res.status(404).json({ message: "Customer not found" });
  res.json(data);
});

// ── UPDATE PROFILE ─────────────────────────
router.put("/profile/:id", async (req, res) => {
  const { name, phone, company, address, city, country, password } = req.body;
  const updatePayload = { name, phone, company, address, city, country };

  if (password) {
    if (password.length < 6)
      return res
        .status(400)
        .json({ message: "Password must be at least 6 characters" });
    updatePayload.password = await bcrypt.hash(password, 10);
  }

  const { error } = await supabase
    .from("customer_accounts")
    .update(updatePayload)
    .eq("id", req.params.id);

  if (error)
    return res.status(500).json({ message: "Failed to update profile" });
  res.json({ message: "Profile updated successfully" });
});

// ── FORGOT PASSWORD ────────────────────────
router.post("/forgot-password", async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ message: "Email is required" });

  const { data: customer } = await supabase
    .from("customer_accounts")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  if (!customer)
    return res
      .status(404)
      .json({ message: "No account found with that email" });

  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

  await supabase
    .from("customer_reset_tokens")
    .upsert([{ email, token, expires_at: expiresAt }], { onConflict: "email" });

  const resetLink = `${process.env.FRONTEND_URL}/customer/reset-password?token=${token}&email=${encodeURIComponent(email)}`;
  res.json({ message: "Reset link generated", resetLink });
});

// ── RESET PASSWORD ─────────────────────────
router.post("/reset-password", async (req, res) => {
  const { email, token, newPassword } = req.body;
  if (!email || !token || !newPassword)
    return res.status(400).json({ message: "All fields are required" });

  const { data: record } = await supabase
    .from("customer_reset_tokens")
    .select("*")
    .eq("email", email)
    .eq("token", token)
    .single();

  if (!record)
    return res.status(400).json({ message: "Invalid or expired reset link" });
  if (new Date() > new Date(record.expires_at))
    return res.status(400).json({ message: "Reset link has expired" });

  const hashed = await bcrypt.hash(newPassword, 10);
  await supabase
    .from("customer_accounts")
    .update({ password: hashed })
    .eq("email", email);
  await supabase.from("customer_reset_tokens").delete().eq("email", email);

  res.json({ message: "Password reset successfully" });
});

// ── ADMIN: GET ALL CUSTOMERS ───────────────
router.get("/all", async (req, res) => {
  const { data, error } = await supabase
    .from("customer_accounts")
    .select(
      "id, name, email, phone, company, city, country, is_active, created_at",
    )
    .order("created_at", { ascending: false });

  if (error)
    return res.status(500).json({ message: "Failed to fetch customers" });
  res.json(data);
});

// ── ADMIN: TOGGLE ACTIVE ───────────────────
router.patch("/toggle-active/:id", async (req, res) => {
  const { is_active } = req.body;
  const { error } = await supabase
    .from("customer_accounts")
    .update({ is_active })
    .eq("id", req.params.id);

  if (error)
    return res.status(500).json({ message: "Failed to update status" });
  res.json({ message: "Status updated" });
});

export default router;
