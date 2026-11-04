import bcrypt from "bcrypt";
import express from "express";
import crypto from "crypto";
import supabase from "../db.js";

const router = express.Router();

// REGISTER
router.post("/register", async (req, res) => {
  const { name, email, password, position } = req.body;
  const hashedPassword = await bcrypt.hash(password, 10);
  const { data, error } = await supabase
    .from("users")
    .insert([{ name, email, password: hashedPassword, position }]);
  if (error) return res.status(400).json(error);
  res.json({ message: "User created successfully" });
});

// LOGIN
router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  const { data } = await supabase
    .from("users")
    .select("*")
    .eq("email", email)
    .single();
  if (!data) return res.status(404).json({ message: "User not found" });
  const validPassword = await bcrypt.compare(password, data.password);
  if (!validPassword)
    return res.status(401).json({ message: "Invalid password" });
  res.json({ message: "Login success", user: data });
});

// FORGOT PASSWORD
router.post("/forgot-password", async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ message: "Email is required" });

  const { data: user } = await supabase
    .from("users")
    .select("*")
    .eq("email", email)
    .single();

  if (!user)
    return res
      .status(404)
      .json({ message: "No account found with that email" });

  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

  const { error } = await supabase
    .from("password_reset_tokens")
    .upsert([{ email, token, expires_at: expiresAt }], { onConflict: "email" });

  if (error)
    return res.status(500).json({ message: "Failed to generate reset token" });

  const resetLink = `${process.env.FRONTEND_URL}/reset-password?token=${token}&email=${encodeURIComponent(email)}`;

  console.log(`[Reset Link] ${resetLink}`);

  // Return resetLink — EmailJS sends the email from frontend
  res.json({ message: "Token generated", resetLink });
});

// RESET PASSWORD
router.post("/reset-password", async (req, res) => {
  const { email, token, newPassword } = req.body;

  if (!email || !token || !newPassword)
    return res.status(400).json({ message: "All fields are required" });

  const { data: resetRecord } = await supabase
    .from("password_reset_tokens")
    .select("*")
    .eq("email", email)
    .eq("token", token)
    .single();

  if (!resetRecord)
    return res.status(400).json({ message: "Invalid or expired reset link" });

  if (new Date() > new Date(resetRecord.expires_at))
    return res.status(400).json({ message: "Reset link has expired" });

  const hashedPassword = await bcrypt.hash(newPassword, 10);

  const { error: updateError } = await supabase
    .from("users")
    .update({ password: hashedPassword })
    .eq("email", email);

  if (updateError)
    return res.status(500).json({ message: "Failed to update password" });

  await supabase.from("password_reset_tokens").delete().eq("email", email);

  res.json({ message: "Password reset successfully" });
});

// ── Add these routes to your existing auth.js router ──
// Place them BEFORE the export default router line

// GET all users (for user management page)
router.get("/users", async (req, res) => {
  const { data, error } = await supabase
    .from("users")
    .select("id, name, email, position, created_at")
    .order("created_at", { ascending: false });

  if (error) return res.status(500).json({ message: "Failed to fetch users" });
  res.json(data);
});

// PUT - Update user (name, email, position, optional new password)
router.put("/users/:id", async (req, res) => {
  const { id } = req.params;
  const { name, email, position, password } = req.body;

  if (!name || !email || !position)
    return res
      .status(400)
      .json({ message: "Name, email and position are required" });

  const updatePayload = { name, email, position };

  if (password) {
    if (password.length < 6)
      return res
        .status(400)
        .json({ message: "Password must be at least 6 characters" });
    updatePayload.password = await bcrypt.hash(password, 10);
  }

  const { error } = await supabase
    .from("users")
    .update(updatePayload)
    .eq("id", id);

  if (error) return res.status(500).json({ message: "Failed to update user" });
  res.json({ message: "User updated successfully" });
});

// DELETE - Remove user
router.delete("/users/:id", async (req, res) => {
  const { id } = req.params;

  const { error } = await supabase.from("users").delete().eq("id", id);

  if (error) return res.status(500).json({ message: "Failed to delete user" });
  res.json({ message: "User deleted successfully" });
});

// GET single user by ID
router.get("/users/:id", async (req, res) => {
  const { id } = req.params;

  const { data, error } = await supabase
    .from("users")
    .select("id, name, email, position, created_at")
    .eq("id", id)
    .single();

  if (error) return res.status(404).json({ message: "User not found" });
  res.json(data);
});

export default router;
